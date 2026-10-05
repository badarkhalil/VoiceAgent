# Voice Agent - Hotel Booking System

A fully local, production-grade voice-based AI chatbot for hotel booking. Uses WebSocket for real-time voice communication, RAG for hotel knowledge, and supports barge-in (interruption). The agent ("Azure") appears as a **photorealistic talking head rendered entirely client-side** — no per-response cloud video. All components are open source and run locally.

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the system design and [`docs/AVATAR.md`](docs/AVATAR.md) for the avatar engine (rig, animation JSON, sync, replacing providers).

## Architecture

```
Browser (Web Audio API) <--WebSocket--> FastAPI Backend
                                            |
                        +-------------------+-------------------+
                        |         |         |         |         |
                     STT       VAD       LLM       RAG       TTS
                (faster-whisper) (silero) (Ollama) (Qdrant) (Piper binary)
```

## Prerequisites

- Python 3.10+
- Node.js (for serving frontend, optional)
- [Ollama](https://ollama.ai) with models pulled:
  ```
  ollama pull qwen2.5:7b
  ollama pull nomic-embed-text
  ```
- [Docker](https://docker.com) (for Qdrant)

## Setup

### 1. Start Qdrant

```bash
docker run -d -p 6333:6333 qdrant/qdrant
```

### 2. Install Python dependencies

```bash
pip install -r backend/requirements.txt
```

### 3. Download Piper TTS engine

```bash
python scripts/setup.py
```

This downloads the Piper binary and English voice model to `tts_engine/`.

### 4. Seed hotel data into Qdrant

```bash
python scripts/seed_qdrant.py
```

### 5. Start the server

```bash
uvicorn backend.main:app --host 0.0.0.0 --port 8000
```

### 6. Open in browser

Navigate to `http://localhost:8000`

## Usage

1. Enter your name and click "Start Call" to begin a voice session (the agent
   already knows your name, so it never asks for it again)
2. Speak naturally - the AI assistant (Azure) will respond with voice and a
   synchronized talking-head avatar
3. Ask about rooms, amenities, services, or policies
4. To make a booking, provide your details through conversation
5. The booking panel on the left shows collected information in real-time
6. Interrupt the AI at any time by speaking while it's responding

## Features

- Real-time voice conversation via WebSocket
- Photorealistic client-side talking avatar (WebGL mesh warp, Canvas2D fallback)
- Audio-clock-accurate lip-sync driven by a versioned animation timeline
- Speech-to-text with faster-whisper
- Voice activity detection with Silero VAD
- High-pass + noise-gate mic processing and gated, sustained barge-in (no false
  interrupts from background noise)
- Instant fillers ("Hmm, let me check.") to remove dead air before the LLM replies
- RAG-powered hotel knowledge base via Qdrant
- LLM responses via Ollama (qwen2.5:7b)
- Text-to-speech with Piper (local, fast)
- Call-style UI: booking panel + live transcript + agent video tile
- Automatic booking slot extraction
- Sentence-level streaming for low-latency responses

## Avatar

The avatar engine renders a single photo with a triangulated mesh warp, synced to
the audio clock. It works out of the box with a bundled placeholder face — to use
your own:

1. Drop a front-facing photo into `frontend/avatars/azure/`.
2. Open `frontend/prepare.html` to place landmarks and export `rig.json` (+ a
   `mouthMask.png` for the mouth interior).
3. Reload. See [`docs/AVATAR.md`](docs/AVATAR.md) for the full workflow, the
   animation JSON schema, and how to replace any provider.

Developer pages:

- `frontend/avatar-lab.html` — play/scrub a sample timeline, expression selector,
  head/blink toggles, debug overlay, and the "Run Animation Test" sequence.
- `frontend/prepare.html` — landmark rig + mouth-mask generator (dev only).

## Project Structure

```
VoiceAgent/
├── backend/
│   ├── main.py                 # FastAPI app, WebSocket endpoint
│   ├── config.py               # Configuration
│   ├── core/
│   │   ├── pipeline.py         # STT→RAG→LLM→TTS orchestrator
│   │   ├── fillers.py          # Pre-synthesized "hmm, let me check" pool
│   │   └── session.py          # Session state management
│   ├── animation/              # text → viseme/animation timeline
│   │   ├── providers/          # VisemeProvider interface + rule-based default
│   │   ├── g2p.py              # grapheme/phoneme conversion (en + ur)
│   │   ├── viseme_map.py
│   │   ├── timeline_builder.py
│   │   └── normalizer.py
│   ├── stt/
│   │   ├── whisper_stt.py      # faster-whisper transcription
│   │   └── vad.py              # Silero VAD
│   ├── tts/
│   │   └── piper_tts.py        # Piper TTS subprocess
│   ├── llm/
│   │   └── ollama_client.py    # Ollama streaming client
│   ├── rag/
│   │   └── qdrant_rag.py       # Qdrant vector search
│   ├── booking/
│   │   └── booking_service.py  # Booking slot management
│   └── data/
│       ├── hotel_data.json     # Hotel knowledge base
│       └── bookings/           # Saved bookings
├── frontend/
│   ├── index.html              # Call UI (booking panel + video tile)
│   ├── prepare.html            # Dev: landmark rig + mouth mask generator
│   ├── avatar-lab.html         # Dev: avatar test bench
│   ├── css/styles.css
│   ├── avatars/azure/          # avatar.json, rig.json, photo, masks, sample JSON
│   └── js/
│       ├── app.js              # WebSocket + UI logic
│       ├── audio-handler.js    # Capture + barge-in detection
│       ├── audio-processor.worklet.js  # High-pass + noise gate
│       ├── audio/              # AudioPlayer (clock) + AudioAnalyzer
│       ├── avatar/             # Runtime, renderers, mesh, rig, controllers
│       ├── animation/          # VisemeTimeline + interpolator
│       ├── models/             # AnimationFrame, Viseme, Expression, Definitions
│       ├── providers/          # AvatarProvider + client VisemeProvider
│       └── debug/              # DebugOverlay
├── docs/
│   ├── ARCHITECTURE.md         # System design
│   └── AVATAR.md               # Avatar engine documentation
├── scripts/
│   ├── setup.py                # Download Piper
│   └── seed_qdrant.py          # Seed hotel data
└── tts_engine/                 # Piper binary + voice models
```
