# Architecture

## Overview

Voice Agent is a real-time voice chatbot built around a WebSocket-based pipeline. A single WebSocket connection multiplexes binary audio frames and JSON control messages between the browser and the FastAPI backend.

## Data Flow

```
User speaks
  → Browser captures audio (AudioWorklet: high-pass + noise gate, 16kHz mono PCM)
  → Binary frames sent via WebSocket
  → Server-side VAD (Silero) detects speech end
  → STT (faster-whisper) transcribes audio buffer
  → (filler sentence may stream immediately to cover LLM latency)
  → RAG (Qdrant + nomic-embed-text) retrieves hotel context
  → LLM (Ollama qwen2.5:7b) generates response (streaming)
  → TTS (Piper) converts each sentence to audio
  → For each sentence the backend emits:
       response.text → audio.begin → binary PCM → audio.end → timing.tts
       → animation.timeline (visemes / expressions / head / blinks)
  → Browser plays audio via Web Audio API (AudioContext clock is the playhead)
  → Avatar runtime samples the timeline at the audibly-current time and renders
```

## Animation Pipeline (avatar)

The TTS engines (Piper, Edge) give no per-phoneme timestamps, but they do give
the *exact* sentence duration (`bytes / sample_width / sample_rate`). The backend
`backend/animation/` package turns `(text, duration, language)` into a versioned
AnimationTimeline:

```
text → normalize → G2P → phonemes → visemes → timeline spans (exact duration)
                              ↘ expressions (rule cues)
                              ↘ head keyframes (seeded)
                              ↘ blinks (seeded)
```

`alignment` is reported as `estimated-rule-based`. A future forced-aligner or a
TTS-with-timestamps provider can replace it behind the same `VisemeProvider`
interface without touching the pipeline or the client.

The client (`frontend/js/avatar/`) never invents motion on its own: the
`AudioPlayer`'s `AudioContext.currentTime − sentenceStartTime` is the authoritative
playhead, timelines are sampled at that time, and controllers compose a target
rig frame that the runtime damps toward (no snapping, zero per-frame allocation).

## Interruption (Barge-in)

When the user speaks during AI playback:
1. Frontend worklet emits a *gated* speech flag (hysteresis noise gate), and the
   `BargeInDetector` requires that flag **plus** a dBFS threshold **plus** a
   sustained minimum duration — raw RMS alone is not enough.
2. Frontend stops audio playback immediately
3. Frontend sends `interrupt` JSON message
4. Backend sets `cancel_event` on the session
5. Each pipeline stage checks `cancel_event` and aborts
6. Backend acknowledges with `interrupted` message
7. New speech is processed through VAD → pipeline normally

The backend independently requires genuine VAD speech (`speech_ms >= MIN_INTERRUPT_MS`)
and a minimum payload size before honoring an interrupt, so background noise
cannot truncate the agent.

## Component Details

### STT (faster-whisper)
- Model: `base` for speed, `int8` quantization for CPU
- Runs in thread pool via `asyncio.to_thread()` (CPU-bound)
- Built-in VAD filter enabled for cleaner transcripts

### VAD (Silero)
- Processes 512-sample chunks (32ms at 16kHz)
- Speech onset: minimum 250ms of speech activity
- Speech end: 600ms of silence after speech
- Runs inline on audio chunks as they arrive
- Tracks accumulated `speech_ms`; interrupts require a sustained minimum

### Fillers (`backend/core/fillers.py`)
- A small pool of short phrases is pre-synthesized with the active TTS at
  startup and cached as PCM.
- On each real transcript the pipeline races a filler sentence against the LLM's
  first token (`FILLER_MAX_WAIT_MS`); if the model answers quickly the filler is
  cancelled, otherwise it plays immediately to remove dead air.

### Noise handling (frontend worklet + backend)
- The `AudioWorklet` applies an ~85 Hz biquad high-pass, then a hysteresis noise
  gate with attack/release smoothing, and posts `{pcm, rms, speech}`.
- Barge-in uses the gated `speech` flag from the worklet plus a dBFS threshold
  and a sustained-duration requirement — not raw RMS.
- Browser mic constraints enable `echoCancellation`, `noiseSuppression` and
  `autoGainControl`.

### LLM (Ollama)
- Streaming via `/api/chat` HTTP endpoint
- Tokens yielded individually, accumulated into sentences
- Sentence boundaries detected at `.!?` followed by whitespace
- Cancel event checked per-token

### RAG (Qdrant)
- Collection: `hotel_knowledge` with cosine similarity
- Embeddings: `nomic-embed-text` (768 dimensions)
- Top-5 results with score threshold 0.3
- Context formatted as natural text injected into system prompt

### TTS (Piper)
- Runs as subprocess per sentence (`--output_raw` flag)
- Outputs raw s16le PCM at 22050 Hz
- Audio streamed in chunks as it's produced
- Process killed on cancellation

### Booking Service
- Pydantic model for slot tracking
- LLM-based slot extraction after each turn
- Extraction runs on last 3 conversation turns
- Slots: name, contact, check-in, check-out, room_type, num_guests
- Completed bookings saved as JSON files

## WebSocket Protocol

| Direction | Type | Frame | Purpose |
|-----------|------|-------|---------|
| C→S | `session.start` | text/JSON | Initialize session |
| S→C | `session.ready` | text/JSON | Confirm ready |
| C→S | (audio) | binary | Raw PCM 16kHz 16-bit mono (post noise-gate) |
| C→S | `interrupt` | text/JSON | User barge-in |
| S→C | `transcript` | text/JSON | STT result |
| S→C | `response.text` | text/JSON | LLM sentence (`{text, sentence_index}`, `filler:true` for fillers) |
| S→C | `audio.begin` | text/JSON | Start of a sentence's PCM (`{sentence_index, sample_rate, channels, format}`) |
| S→C | (audio) | binary | TTS PCM 22050Hz 16-bit mono |
| S→C | `audio.end` | text/JSON | End of sentence PCM (`{sentence_index, bytes}`) |
| S→C | `animation.timeline` | text/JSON | Visemes / expressions / head / blinks for a sentence |
| S→C | `timing.tts` | text/JSON | Per-sentence TTS timing |
| S→C | `response.end` | text/JSON | Response complete |
| S→C | `interrupted` | text/JSON | Acknowledge interrupt |
| S→C | `booking.status` | text/JSON | Slot fill state |
| C→S | `booking.confirm` | text/JSON | Confirm booking |
| S→C | `booking.saved` | text/JSON | Booking ID |

## Session Management

Each WebSocket connection gets a `Session` object with:
- Unique session ID
- Conversation history (for LLM context)
- Audio buffer (accumulated PCM between speech boundaries; capped at
  `MAX_AUDIO_BUFFER_SECONDS` so stuck noise cannot grow it without bound)
- Booking slots (progressive extraction)
- Cancel event (asyncio.Event for interruption)
- Response state flag (`is_responding`, set for greetings too)

## Frontend Avatar Runtime

`frontend/js/avatar/AvatarRuntime.js` owns the single `requestAnimationFrame`
loop. Each frame:

```
getClock() → { sentenceIndex, time }   (AudioPlayer.getPlayhead)
  → look up AnimationTimeline for that sentence
  → controllers compose a target AnimationFrame
       Mouth (visemes) → Expression (additive) → Eyebrow → Head → Blink → Eye → LipSync
  → damp current frame toward target (per-parameter half-life)
  → AvatarRig maps params → per-vertex offsets; mesh.commit()
  → AvatarRenderer.draw(headMatrix)
```

Two renderers implement the same interface and are selected automatically:
`AvatarRenderer` (WebGL, one draw call per layer) and `CanvasRenderer`
(Canvas2D piecewise-affine triangle warp). Layers are drawn back-to-front:
`innerMouth → teeth → face`, with the face alpha-multiplied by a prepared mouth
mask so the inner mouth is revealed as the lips deform apart.

## Concurrency Model

- One asyncio event loop (uvicorn)
- WebSocket handler runs as a coroutine per connection
- Pipeline runs as an asyncio Task (can be cancelled)
- CPU-bound work (STT, embedding) dispatched to thread pool
- Piper TTS runs as async subprocess
