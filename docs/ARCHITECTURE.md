# Architecture

## Overview

Voice Agent is a real-time voice chatbot built around a WebSocket-based pipeline. A single WebSocket connection multiplexes binary audio frames and JSON control messages between the browser and the FastAPI backend.

## Data Flow

```
User speaks
  → Browser captures audio (AudioWorklet, 16kHz mono PCM)
  → Binary frames sent via WebSocket
  → Server-side VAD (Silero) detects speech end
  → STT (faster-whisper) transcribes audio buffer
  → RAG (Qdrant + nomic-embed-text) retrieves hotel context
  → LLM (Ollama qwen2.5:7b) generates response (streaming)
  → TTS (Piper) converts each sentence to audio
  → Audio streamed back as binary frames
  → Browser plays audio via Web Audio API
```

## Interruption (Barge-in)

When the user speaks during AI playback:
1. Frontend detects RMS above threshold in incoming mic audio
2. Frontend stops audio playback immediately
3. Frontend sends `interrupt` JSON message
4. Backend sets `cancel_event` on the session
5. Each pipeline stage checks `cancel_event` and aborts
6. Backend acknowledges with `interrupted` message
7. New speech is processed through VAD → pipeline normally

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
| C→S | (audio) | binary | Raw PCM 16kHz 16-bit mono |
| C→S | `interrupt` | text/JSON | User barge-in |
| S→C | `transcript` | text/JSON | STT result |
| S→C | `response.text` | text/JSON | LLM sentence |
| S→C | (audio) | binary | TTS PCM 22050Hz 16-bit mono |
| S→C | `response.end` | text/JSON | Response complete |
| S→C | `interrupted` | text/JSON | Acknowledge interrupt |
| S→C | `booking.status` | text/JSON | Slot fill state |
| C→S | `booking.confirm` | text/JSON | Confirm booking |
| S→C | `booking.saved` | text/JSON | Booking ID |

## Session Management

Each WebSocket connection gets a `Session` object with:
- Unique session ID
- Conversation history (for LLM context)
- Audio buffer (accumulated PCM between speech boundaries)
- Booking slots (progressive extraction)
- Cancel event (asyncio.Event for interruption)
- Response state flag

## Concurrency Model

- One asyncio event loop (uvicorn)
- WebSocket handler runs as a coroutine per connection
- Pipeline runs as an asyncio Task (can be cancelled)
- CPU-bound work (STT, embedding) dispatched to thread pool
- Piper TTS runs as async subprocess
