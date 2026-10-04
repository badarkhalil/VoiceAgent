"""Central orchestrator: STT → RAG → LLM → TTS with streaming and timing."""

from __future__ import annotations

import asyncio
import json
import logging
import re
import time
from typing import TYPE_CHECKING, AsyncIterator

from backend.booking.booking_service import BookingService, SLOT_EXTRACTION_PROMPT
from backend.config import (
    LLM_SYSTEM_PROMPT, LLM_SYSTEM_PROMPT_UR, LLM_PROVIDER,
    AUDIO_ENERGY_THRESHOLD, MIN_AUDIO_DURATION_MS,
)
from backend.core.session import Session
from backend.stt.audio_utils import compute_rms, audio_duration_ms
from backend.tts.edge_tts_client import EdgeTTSClient

if TYPE_CHECKING:
    from fastapi import WebSocket

    from backend.rag.qdrant_rag import QdrantRAG
    from backend.stt.whisper_stt import WhisperSTT
    from backend.tts.piper_tts import PiperTTS

logger = logging.getLogger(__name__)

SENTENCE_END_RE = re.compile(r'(?<=[.!?।۔])\s+')



def split_sentences(text: str) -> list[str]:
    sentences = SENTENCE_END_RE.split(text)
    return [s.strip() for s in sentences if s.strip()]


def _ms(start: float) -> int:
    return int((time.perf_counter() - start) * 1000)


class VoicePipeline:
    def __init__(self, stt, tts: PiperTTS, llm, rag, booking: BookingService) -> None:
        self._stt = stt
        self._tts = tts  # Piper (English)
        self._tts_ur = EdgeTTSClient("ur-PK-UzmaNeural")  # Edge (Urdu)
        self._llm = llm
        self._rag = rag
        self._booking = booking
        # Use Ollama for slot extraction if using Gemini for chat
        self._slot_llm = llm  # will be overridden in main.py if needed

    def set_slot_llm(self, slot_llm) -> None:
        """Set a separate LLM client for slot extraction (e.g. local Ollama)."""
        self._slot_llm = slot_llm

    def _get_tts(self, session: Session):
        """Return the appropriate TTS engine based on session language."""
        if session.language == "ur":
            return self._tts_ur
        return self._tts

    async def process_utterance(self, session: Session, ws: WebSocket) -> None:
        cancel = session.cancel_event
        audio_data = bytes(session.audio_buffer)
        session.reset_audio()

        # ── Minimum duration gate ────────────────────────────────────
        dur = audio_duration_ms(audio_data)
        if dur < MIN_AUDIO_DURATION_MS:
            logger.debug("Audio too short (%.0fms), ignoring", dur)
            return

        # ── Energy gate — reject quiet background noise ──────────────
        rms = compute_rms(audio_data)
        if rms < AUDIO_ENERGY_THRESHOLD:
            logger.debug("Audio too quiet (rms=%.0f, dur=%.0fms), ignoring", rms, dur)
            return

        session.is_responding = True
        pipeline_start = time.perf_counter()
        timing: dict = {"audio_bytes": len(audio_data), "rms": round(rms)}

        try:
            # ── STT ──────────────────────────────────────────────────
            if cancel.is_set():
                return
            t0 = time.perf_counter()
            transcript = await self._stt.transcribe(audio_data, language=session.language)
            timing["stt_ms"] = _ms(t0)
            timing["audio_duration_ms"] = int(dur)

            if not transcript or len(transcript.strip()) < 2 or cancel.is_set():
                # STT returned nothing meaningful — this was noise, not speech.
                # Keep was_interrupted=True so the resume timer can fire.
                return

            # Real speech — clear interrupt state
            session.was_interrupted = False
            await ws.send_json({"type": "transcript", "text": transcript})
            session.add_message("user", transcript)

            # ── RAG ──────────────────────────────────────────────────
            if cancel.is_set():
                return
            t0 = time.perf_counter()
            try:
                context = await self._rag.get_context(transcript)
            except Exception:
                logger.warning("RAG search failed, proceeding without context")
                context = ""
            timing["rag_ms"] = _ms(t0)

            if cancel.is_set():
                return

            # Build system prompt based on language
            if session.language == "ur":
                system_prompt = LLM_SYSTEM_PROMPT_UR
            else:
                system_prompt = LLM_SYSTEM_PROMPT

            # Add user name context if available
            if session.user_name:
                if session.language == "ur":
                    system_prompt += (
                        f"\n\nاہم: مہمان کا نام {session.user_name} ہے۔ "
                        f"آپ کو ان کا نام پہلے سے معلوم ہے۔ کبھی نام نہ پوچھیں۔ "
                        f"بکنگ کے لیے \"{session.user_name}\" استعمال کریں۔ "
                        f"سیدھا تاریخوں، کمرے کی قسم، اور مہمانوں کی تعداد پوچھیں۔"
                    )
                else:
                    system_prompt += (
                        f"\n\nIMPORTANT: The guest's name is {session.user_name}. "
                        f"You already know their name. NEVER ask for their name. "
                        f"Use \"{session.user_name}\" for the booking. "
                        f"Skip directly to asking about dates, room type, and number of guests."
                    )

            if context:
                system_prompt += f"\n\n{context}"

            if session.slots.filled_slots:
                status = session.slots.status_dict()
                required_missing = [
                    s for s in session.slots.required_slots
                    if getattr(session.slots, s) is None
                ]
                system_prompt += (
                    f"\n\nCurrent booking status: {json.dumps(status['filled'])}"
                )
                if required_missing:
                    system_prompt += f"\nStill needed: {', '.join(required_missing)}"
                else:
                    system_prompt += "\nAll required info collected. Wrap up the conversation."

            # ── LLM (streaming, sentence-by-sentence TTS) ────────────
            if cancel.is_set():
                return
            messages = session.get_messages(system_prompt)

            full_response = ""
            sentence_buffer = ""
            llm_start = time.perf_counter()
            first_token_time = None
            token_count = 0
            sentence_index = 0

            async for token in self._llm.chat_stream(messages, cancel):
                if cancel.is_set():
                    break

                token_count += 1
                if first_token_time is None:
                    first_token_time = time.perf_counter()
                    timing["llm_first_token_ms"] = _ms(llm_start)

                full_response += token
                sentence_buffer += token

                # Stream sentence-by-sentence: as soon as we have a
                # complete sentence, send its text + TTS immediately
                sentences = split_sentences(sentence_buffer)
                if len(sentences) > 1:
                    for sentence in sentences[:-1]:
                        if cancel.is_set():
                            break
                        await self._send_sentence(
                            session, ws, sentence, cancel, timing, sentence_index
                        )
                        if cancel.is_set():
                            break  # don't increment — this sentence was cut short
                        sentence_index += 1
                    sentence_buffer = sentences[-1]

            timing["llm_total_ms"] = _ms(llm_start)
            timing["llm_tokens"] = token_count

            # Flush remaining text
            if sentence_buffer.strip() and not cancel.is_set():
                await self._send_sentence(
                    session, ws, sentence_buffer.strip(), cancel, timing, sentence_index
                )
                if not cancel.is_set():
                    sentence_index += 1

            if cancel.is_set():
                # Store state for potential resume
                session.last_response = full_response
                session.last_spoken_sentences = sentence_index
                return

            if full_response:
                session.add_message("assistant", full_response)
                # Store for potential resume
                session.last_response = full_response
                session.last_spoken_sentences = sentence_index

            # ── Slot extraction (fire-and-forget) ─────────────────────
            if full_response and not session.booking_confirmed:
                asyncio.create_task(self._extract_slots(session, ws))

            # ── Timing ────────────────────────────────────────────────
            timing["total_pipeline_ms"] = _ms(pipeline_start)
            timing["sentence_count"] = sentence_index

            if not cancel.is_set():
                await ws.send_json({"type": "response.end", "timing": timing})
                logger.info(
                    "Pipeline: STT=%dms  RAG=%dms  LLM_first=%sms  LLM=%dms(%dtok)  total=%dms",
                    timing.get("stt_ms", 0),
                    timing.get("rag_ms", 0),
                    timing.get("llm_first_token_ms", "?"),
                    timing.get("llm_total_ms", 0),
                    timing.get("llm_tokens", 0),
                    timing.get("total_pipeline_ms", 0),
                )

        except Exception:
            logger.exception("Pipeline error")
            try:
                await ws.send_json({"type": "error", "message": "Processing error occurred"})
            except Exception:
                pass
        finally:
            session.is_responding = False

    async def resume_response(self, session: Session, ws: WebSocket) -> None:
        """Resume speaking the last response from where it was interrupted."""
        if not session.last_response:
            return

        sentences = split_sentences(session.last_response)
        spoken = session.last_spoken_sentences

        if spoken >= len(sentences):
            return  # Everything was already spoken

        remaining = sentences[spoken:]
        if not remaining:
            return

        session.is_responding = True
        cancel = session.cancel_event

        try:
            logger.info(
                "Session %s: resuming from sentence %d/%d",
                session.session_id, spoken, len(sentences)
            )

            tts = self._get_tts(session)
            for sentence in remaining:
                if cancel.is_set():
                    break
                await ws.send_json({"type": "response.text", "text": sentence})

                async for chunk in tts.synthesize_streaming(sentence, cancel):
                    if cancel.is_set():
                        return
                    await ws.send_bytes(chunk)

                session.last_spoken_sentences += 1

            if not cancel.is_set():
                await ws.send_json({"type": "response.end"})

        except Exception:
            logger.exception("Resume error")
        finally:
            session.is_responding = False

    async def _send_sentence(
        self, session, ws, sentence, cancel, timing, sentence_index
    ) -> None:
        if cancel.is_set():
            return

        await ws.send_json({"type": "response.text", "text": sentence})

        tts = self._get_tts(session)
        t0 = time.perf_counter()
        tts_bytes = 0
        async for chunk in tts.synthesize_streaming(sentence, cancel):
            if cancel.is_set():
                return
            tts_bytes += len(chunk)
            await ws.send_bytes(chunk)

        tts_ms = _ms(t0)
        timing[f"tts_sentence_{sentence_index}_ms"] = tts_ms

        await ws.send_json({
            "type": "timing.tts",
            "sentence_index": sentence_index,
            "tts_ms": tts_ms,
            "tts_bytes": tts_bytes,
            "text_length": len(sentence),
        })

    async def _extract_slots(self, session: Session, ws: WebSocket) -> None:
        if len(session.history) < 2:
            return

        recent = session.history[-4:]
        conversation_text = "\n".join(
            f"{m['role'].upper()}: {m['content']}" for m in recent
        )

        messages = [
            {"role": "system", "content": SLOT_EXTRACTION_PROMPT},
            {"role": "user", "content": conversation_text},
        ]

        try:
            extraction_text = ""
            # Only pass model override for Ollama (local model switching)
            kwargs: dict = {}
            if LLM_PROVIDER == "ollama":
                from backend.config import SLOT_EXTRACTION_MODEL
                kwargs["model"] = SLOT_EXTRACTION_MODEL
            async for token in self._slot_llm.chat_stream(
                messages, **kwargs
            ):
                extraction_text += token

            if extraction_text:
                session.slots = self._booking.parse_extraction(
                    extraction_text, session.slots
                )

                status = session.slots.status_dict()
                await ws.send_json({
                    "type": "booking.status",
                    **status,
                })

                # Auto-confirm if all slots are filled
                if session.slots.is_complete and not session.booking_confirmed:
                    logger.info("Session %s: slots complete, auto-confirming", session.session_id)
                    await self._auto_confirm_booking(session, ws)

        except Exception:
            logger.exception("Slot extraction failed")

    async def _auto_confirm_booking(self, session: Session, ws: WebSocket) -> None:
        """Auto-confirm and save booking when all slots are filled."""
        booking_id = self._booking.save_booking(session.slots)
        session.booking_confirmed = True

        # Build confirmation message based on language
        slots = session.slots
        guest_name = slots.guest_name or "guest"

        if session.language == "ur":
            summary = (
                f"میرے پاس تمام معلومات ہیں۔ آپ کی بکنگ کی تصدیق کرتا ہوں۔ "
                f"{guest_name}، چیک ان {slots.check_in}، "
                f"چیک آؤٹ {slots.check_out}، "
                f"{slots.room_type} کمرہ {slots.num_guests} مہمانوں کے لیے۔ "
                f"آپ کی بکنگ آئی ڈی {booking_id} ہے۔ "
                f"گرینڈ ایزور ہوٹل کا انتخاب کرنے کا شکریہ، {guest_name}! "
                f"آپ کا دن اچھا گزرے۔ خدا حافظ!"
            )
        else:
            summary = (
                f"I have everything I need. Let me confirm your booking. "
                f"{guest_name}, checking in on {slots.check_in}, "
                f"checking out on {slots.check_out}, "
                f"{slots.room_type} room for {slots.num_guests} "
                f"{'guest' if slots.num_guests == 1 else 'guests'}. "
                f"Your booking ID is {booking_id}. "
                f"Thank you for choosing The Grand Azure Hotel, {guest_name}! "
                f"Have a wonderful day. Goodbye!"
            )

        session.add_message("assistant", summary)
        await ws.send_json({"type": "response.text", "text": summary})

        # TTS the confirmation
        tts = self._get_tts(session)
        async for chunk in tts.synthesize_streaming(summary):
            if session.cancel_event.is_set():
                return
            await ws.send_bytes(chunk)

        await ws.send_json({
            "type": "booking.saved",
            "booking_id": booking_id,
            "details": session.slots.filled_slots,
        })

        await ws.send_json({"type": "response.end"})

        # Signal the frontend to end the call gracefully
        await asyncio.sleep(1.0)
        await ws.send_json({"type": "session.end"})

    async def confirm_booking(self, session: Session, ws: WebSocket) -> None:
        if not session.slots.is_complete:
            await ws.send_json({
                "type": "error",
                "message": "Booking incomplete. Missing: " + ", ".join(
                    session.slots.missing_slots
                ),
            })
            return

        await self._auto_confirm_booking(session, ws)

    async def send_greeting(self, session: Session, ws: WebSocket) -> None:
        t0 = time.perf_counter()

        # Personalized greeting based on language
        if session.language == "ur":
            if session.user_name:
                greeting = (
                    f"السلام علیکم {session.user_name}! میں ایزور ہوں گرینڈ ایزور ہوٹل سے۔ "
                    f"آج میں آپ کی کیا مدد کر سکتی ہوں؟"
                )
            else:
                greeting = (
                    "السلام علیکم! میں ایزور ہوں گرینڈ ایزور ہوٹل سے۔ "
                    "آج میں آپ کی کیا مدد کر سکتی ہوں؟"
                )
        else:
            if session.user_name:
                greeting = (
                    f"Hi {session.user_name}! I'm Azure from The Grand Azure Hotel. "
                    f"How can I help you today?"
                )
            else:
                greeting = (
                    "Hi there! I'm Azure from The Grand Azure Hotel. "
                    "How can I help you today?"
                )

        session.add_message("assistant", greeting)
        await ws.send_json({"type": "response.text", "text": greeting})

        tts = self._get_tts(session)
        tts_start = time.perf_counter()
        async for chunk in tts.synthesize_streaming(greeting):
            if session.cancel_event.is_set():
                return
            await ws.send_bytes(chunk)

        await ws.send_json({
            "type": "response.end",
            "timing": {"greeting_tts_ms": _ms(tts_start), "total_pipeline_ms": _ms(t0)},
        })
