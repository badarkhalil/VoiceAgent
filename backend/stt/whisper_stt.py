"""Speech-to-text using faster-whisper with noise/hallucination filtering."""

from __future__ import annotations

import asyncio
import logging
import re

import numpy as np
from faster_whisper import WhisperModel

from backend.config import (
    STT_SAMPLE_RATE,
    WHISPER_BEAM_SIZE,
    WHISPER_COMPUTE_TYPE,
    WHISPER_DEVICE,
    WHISPER_MODEL_SIZE,
    WHISPER_NO_SPEECH_THRESHOLD,
    WHISPER_AVG_LOGPROB_THRESHOLD,
)
from backend.stt.audio_utils import compute_rms, audio_duration_ms

logger = logging.getLogger(__name__)

# ── Whisper hallucination filter ──────────────────────────────────────
# Phrases Whisper commonly hallucinates on silence / noise.
# Only matched when they are the ENTIRE transcript (not part of longer speech).
_HALLUCINATION_PHRASES: set[str] = {
    "thank you", "thanks", "thank you very much", "thank you so much",
    "thanks for watching", "thanks for listening",
    "thank you for watching", "thank you for listening",
    "bye", "bye bye", "goodbye", "bye-bye",
    "subscribe", "like and subscribe",
    "see you next time", "see you later", "see you",
    "the end", "you", "so", "i",
    "please subscribe", "please like and subscribe",
    "silence", "applause", "music",
    "sil", "mm", "hmm", "uh", "um", "huh", "ah", "oh",
}

# Pattern: single repeated word/phrase is likely hallucination
_REPEAT_RE = re.compile(r"^(.{2,20}?)(?:[.,!?\s]+\1){2,}[.,!?\s]*$", re.IGNORECASE)


def _is_hallucination(text: str) -> bool:
    """Check if transcript looks like a Whisper hallucination."""
    normalised = text.strip().lower().rstrip(".!?,;:")
    if normalised in _HALLUCINATION_PHRASES:
        return True
    # "It's a problem. It's a problem. It's a problem." → repetition
    if _REPEAT_RE.match(text.strip()):
        return True
    return False


class WhisperSTT:
    """Wrapper around faster-whisper for transcription."""

    def __init__(self) -> None:
        logger.info(
            "Loading Whisper model  size=%s  device=%s  compute=%s",
            WHISPER_MODEL_SIZE,
            WHISPER_DEVICE,
            WHISPER_COMPUTE_TYPE,
        )
        self._model = WhisperModel(
            WHISPER_MODEL_SIZE,
            device=WHISPER_DEVICE,
            compute_type=WHISPER_COMPUTE_TYPE,
        )
        logger.info("Whisper model loaded")

    def transcribe_sync(self, audio_bytes: bytes, language: str = "en") -> str:
        """Transcribe raw PCM audio (s16le, 16 kHz, mono) to text.

        Returns empty string if audio is noise, too quiet, or a
        hallucination.  This is a blocking call — use `transcribe()`
        for async.
        """
        if len(audio_bytes) < 1600:  # less than 50ms
            return ""

        # ── Energy pre-check ─────────────────────────────────────────
        rms = compute_rms(audio_bytes)
        dur = audio_duration_ms(audio_bytes)
        if rms < 80:  # near-silence, skip entirely
            logger.debug("Audio rejected: near-silence (rms=%.0f, dur=%.0fms)", rms, dur)
            return ""

        # Convert s16le bytes to float32 numpy array in [-1, 1]
        audio_np = np.frombuffer(audio_bytes, dtype=np.int16).astype(np.float32) / 32768.0

        segments, info = self._model.transcribe(
            audio_np,
            beam_size=WHISPER_BEAM_SIZE,
            language=language,
            vad_filter=True,
            condition_on_previous_text=False,  # reduces hallucination chaining
        )

        # ── Per-segment confidence filtering ─────────────────────────
        text_parts: list[str] = []
        for seg in segments:
            # Skip segments Whisper itself thinks are not speech
            if seg.no_speech_prob > WHISPER_NO_SPEECH_THRESHOLD:
                logger.debug(
                    "Segment rejected: no_speech_prob=%.2f  text='%s'",
                    seg.no_speech_prob, seg.text.strip(),
                )
                continue
            # Skip very low confidence segments
            if seg.avg_logprob < WHISPER_AVG_LOGPROB_THRESHOLD:
                logger.debug(
                    "Segment rejected: avg_logprob=%.2f  text='%s'",
                    seg.avg_logprob, seg.text.strip(),
                )
                continue
            text = seg.text.strip()
            if text:
                text_parts.append(text)

        result = " ".join(text_parts).strip()

        # ── Hallucination filter ─────────────────────────────────────
        if result and _is_hallucination(result):
            logger.info("Transcript rejected as hallucination: '%s' (rms=%.0f)", result, rms)
            return ""

        if result:
            logger.debug(
                "Transcribed (%.1fs, lang=%s, rms=%.0f): %s",
                info.duration, language, rms, result,
            )
        return result

    async def transcribe(self, audio_bytes: bytes, language: str = "en") -> str:
        """Async wrapper — runs transcription in a thread."""
        return await asyncio.to_thread(self.transcribe_sync, audio_bytes, language)
