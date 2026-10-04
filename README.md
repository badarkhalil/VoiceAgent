# Voice Agent - Hotel Booking System

A fully local, production-grade voice-based AI chatbot for hotel booking. Uses WebSocket for real-time voice communication, RAG for hotel knowledge, and supports barge-in (interruption). All components are open source and run locally.

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

1. Click "Start Call" to begin a voice session
2. Speak naturally - the AI assistant (Azure) will respond with voice
3. Ask about rooms, amenities, services, or policies
4. To make a booking, provide your details through conversation
5. The booking panel shows collected information in real-time
6. Click "Confirm Booking" when all details are filled
7. Interrupt the AI at any time by speaking while it's responding

## Features

- Real-time voice conversation via WebSocket
- Speech-to-text with faster-whisper
- Voice activity detection with Silero VAD
- RAG-powered hotel knowledge base via Qdrant
- LLM responses via Ollama (qwen2.5:7b)
- Text-to-speech with Piper (local, fast)
- Barge-in / interruption support
- Automatic booking slot extraction
- Sentence-level streaming for low-latency responses

## Project Structure

```
VoiceAgent/
├── backend/
│   ├── main.py                 # FastAPI app, WebSocket endpoint
│   ├── config.py               # Configuration
│   ├── core/
│   │   ├── pipeline.py         # STT→RAG→LLM→TTS orchestrator
│   │   └── session.py          # Session state management
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
│   ├── index.html
│   ├── css/styles.css
│   └── js/
│       ├── app.js              # WebSocket + UI logic
│       ├── audio-handler.js    # Capture + playback + barge-in
│       └── audio-processor.worklet.js
├── scripts/
│   ├── setup.py                # Download Piper
│   └── seed_qdrant.py          # Seed hotel data
└── tts_engine/                 # Piper binary + voice models
```
