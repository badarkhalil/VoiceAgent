"""FastAPI application with WebSocket voice endpoint."""

from __future__ import annotations

import asyncio
import json
import logging

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.staticfiles import StaticFiles

from backend.booking.booking_service import BookingService
from backend.config import (
    EMBED_PROVIDER,
    FRONTEND_DIR,
    GEMINI_API_KEY,
    GEMINI_MODEL,
    LLM_PROVIDER,
    MISTRAL_API_KEY,
    MISTRAL_CHAT_MODEL,
    MIN_AUDIO_DURATION_MS,
)
from backend.core.pipeline import VoicePipeline
from backend.core.session import Session
from backend.llm.ollama_client import OllamaClient
from backend.rag.qdrant_rag import QdrantRAG
from backend.stt.audio_utils import compute_rms, audio_duration_ms, is_interrupt_energy
from backend.stt.vad import SileroVAD
from backend.stt.whisper_stt import WhisperSTT
from backend.tts.piper_tts import PiperTTS

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-7s  %(name)s  %(message)s",
)
logger = logging.getLogger(__name__)

# ── App & shared services ──────────────────────────────────────────────
app = FastAPI(title="Voice Agent - Hotel Booking")

stt: WhisperSTT | None = None
tts: PiperTTS | None = None
llm = None  # OllamaClient, GeminiClient, or MistralClient
embedder = None  # client used for RAG embeddings
rag: QdrantRAG | None = None
booking: BookingService | None = None
pipeline: VoicePipeline | None = None

SILENCE_RESUME_TIMEOUT = 2.0   # seconds to wait before auto-resuming after interrupt
MIN_INTERRUPT_BYTES = 9600     # ~300ms at 16kHz s16le — minimum audio to consider for interrupt


@app.on_event("startup")
async def startup() -> None:
    global stt, tts, llm, embedder, rag, booking, pipeline

    logger.info("Initializing services ...")
    tts = PiperTTS()

    # ── Embedder: Mistral (1024-dim) or Ollama (768-dim) ────────────────
    if EMBED_PROVIDER == "mistral":
        from backend.llm.mistral_client import MistralClient
        embedder = MistralClient(api_key=MISTRAL_API_KEY, model=MISTRAL_CHAT_MODEL)
        logger.info("Using Mistral for embeddings")
    else:
        embedder = OllamaClient()
        logger.info("Using Ollama for embeddings")

    # ── Chat LLM: Gemini (preferred) / Mistral / Ollama ──────────────
    if LLM_PROVIDER == "gemini":
        from backend.llm.gemini_client import GeminiClient
        llm = GeminiClient(api_key=GEMINI_API_KEY, model=GEMINI_MODEL)
        logger.info("Using Gemini (%s) as chat LLM", GEMINI_MODEL)
    elif LLM_PROVIDER == "mistral":
        from backend.llm.mistral_client import MistralClient
        if isinstance(embedder, MistralClient):
            llm = embedder  # reuse the same client
        else:
            llm = MistralClient(api_key=MISTRAL_API_KEY, model=MISTRAL_CHAT_MODEL)
        logger.info("Using Mistral (%s) as chat LLM", MISTRAL_CHAT_MODEL)
    else:
        if isinstance(embedder, OllamaClient):
            llm = embedder
        else:
            llm = OllamaClient()
        logger.info("Using Ollama as chat LLM")

    rag = QdrantRAG(embedder)
    try:
        rag.ensure_collection()
    except Exception:
        logger.warning("Could not connect to Qdrant — RAG will be unavailable")
    booking = BookingService()

    stt = await asyncio.to_thread(WhisperSTT)

    pipeline = VoicePipeline(stt, tts, llm, rag, booking)

    # Slot extraction uses the main LLM (works for Gemini, Mistral, Ollama)
    # No separate slot LLM needed since we removed the model= override for non-Ollama

    logger.info("All services ready  (LLM=%s)", LLM_PROVIDER)


@app.on_event("shutdown")
async def shutdown() -> None:
    if llm:
        await llm.close()
    if embedder and embedder is not llm:
        await embedder.close()
    logger.info("Shutdown complete")


# ── WebSocket endpoint ─────────────────────────────────────────────────

@app.websocket("/ws/voice")
async def voice_ws(ws: WebSocket) -> None:
    await ws.accept()

    session = Session()
    vad = SileroVAD()
    pipeline_task: asyncio.Task | None = None
    resume_timer: asyncio.Task | None = None

    logger.info("Session %s connected", session.session_id)

    async def _silence_resume():
        """Wait for silence after an interrupt; if no real speech arrives, resume."""
        await asyncio.sleep(SILENCE_RESUME_TIMEOUT)
        # Only resume if still in interrupted state (no real speech was processed)
        if session.was_interrupted and not session.is_responding and not session.booking_confirmed:
            logger.info("Session %s: silence timeout, resuming response", session.session_id)
            session.was_interrupted = False
            assert pipeline is not None
            await pipeline.resume_response(session, ws)

    async def _run_pipeline_with_resume_fallback(audio_data_unused=None):
        """Run pipeline; if STT returns empty (noise), restart resume timer."""
        nonlocal resume_timer
        assert pipeline is not None
        await pipeline.process_utterance(session, ws)
        # After pipeline finishes: if was_interrupted is still True,
        # it means STT returned nothing (noise). Restart resume timer.
        if session.was_interrupted and not session.is_responding:
            if not resume_timer or resume_timer.done():
                resume_timer = asyncio.create_task(_silence_resume())

    try:
        while True:
            message = await ws.receive()

            # ── Binary frame: audio data ─────────────────────────────
            if message.get("type") == "websocket.receive" and "bytes" in message:
                audio_chunk = message["bytes"]
                session.audio_buffer.extend(audio_chunk)

                speech_started, speech_ended = vad.process_chunk(audio_chunk)

                if speech_ended:
                    vad.reset()
                    audio_data = bytes(session.audio_buffer)
                    dur = audio_duration_ms(audio_data)
                    rms = compute_rms(audio_data) if len(audio_data) >= 2 else 0.0

                    logger.debug(
                        "Session %s: speech ended (%d bytes, %.0fms, rms=%.0f)",
                        session.session_id, len(audio_data), dur, rms,
                    )

                    # ── If agent is currently speaking, only interrupt for
                    #    loud, sustained audio (real speech, not noise) ────
                    if session.is_responding:
                        if len(audio_data) < MIN_INTERRUPT_BYTES or not is_interrupt_energy(audio_data):
                            # Not loud/long enough — this is noise, ignore it
                            logger.debug(
                                "Session %s: ignoring noise during response (rms=%.0f, dur=%.0fms)",
                                session.session_id, rms, dur,
                            )
                            session.reset_audio()
                            continue

                        # Genuine interrupt — cancel agent speech
                        session.cancel()
                        if pipeline_task and not pipeline_task.done():
                            await asyncio.sleep(0.1)
                        session.reset_cancel()
                        session.was_interrupted = True
                        await ws.send_json({"type": "interrupted"})
                        logger.info(
                            "Session %s: interrupted by user (rms=%.0f)",
                            session.session_id, rms,
                        )

                    assert pipeline is not None

                    # ── Check if audio is worth sending to STT ───────────
                    if dur < MIN_AUDIO_DURATION_MS:
                        session.reset_audio()
                        if session.was_interrupted:
                            if not resume_timer or resume_timer.done():
                                resume_timer = asyncio.create_task(_silence_resume())
                        continue

                    # ── Run pipeline (STT will do its own energy + hallucination checks)
                    pipeline_task = asyncio.create_task(
                        _run_pipeline_with_resume_fallback(audio_data)
                    )

            # ── Text frame: JSON control message ─────────────────────
            elif message.get("type") == "websocket.receive" and "text" in message:
                try:
                    data = json.loads(message["text"])
                except json.JSONDecodeError:
                    continue

                msg_type = data.get("type", "")

                if msg_type == "session.start":
                    # Extract user name and language if provided
                    user_name = data.get("user_name", "").strip()
                    language = data.get("language", "en").strip()
                    if user_name:
                        session.user_name = user_name
                        # Pre-fill guest name for booking
                        session.slots.guest_name = user_name
                    if language in ("en", "ur"):
                        session.language = language
                    logger.info("Session %s: start (user=%s, lang=%s)", session.session_id, session.user_name or "anonymous", session.language)
                    await ws.send_json({
                        "type": "session.ready",
                        "session_id": session.session_id,
                    })
                    assert pipeline is not None
                    pipeline_task = asyncio.create_task(
                        pipeline.send_greeting(session, ws)
                    )

                elif msg_type == "interrupt":
                    logger.info("Session %s: interrupt", session.session_id)
                    session.cancel()
                    if pipeline_task and not pipeline_task.done():
                        await asyncio.sleep(0.1)
                    session.reset_cancel()
                    session.was_interrupted = True
                    session.reset_audio()
                    vad.reset()
                    await ws.send_json({"type": "interrupted"})
                    # Start silence resume timer
                    if resume_timer and not resume_timer.done():
                        resume_timer.cancel()
                    resume_timer = asyncio.create_task(_silence_resume())

                elif msg_type == "booking.confirm":
                    logger.info("Session %s: booking confirm", session.session_id)
                    assert pipeline is not None
                    await pipeline.confirm_booking(session, ws)

            elif message.get("type") == "websocket.disconnect":
                break

    except WebSocketDisconnect:
        logger.info("Session %s disconnected", session.session_id)
    except Exception:
        logger.exception("Session %s error", session.session_id)
    finally:
        if resume_timer and not resume_timer.done():
            resume_timer.cancel()
        if pipeline_task and not pipeline_task.done():
            session.cancel()
            pipeline_task.cancel()
        logger.info("Session %s cleanup done", session.session_id)


# ── Static files (frontend) ───────────────────────────────────────────
app.mount("/", StaticFiles(directory=str(FRONTEND_DIR), html=True), name="frontend")
