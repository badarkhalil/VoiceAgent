"""Voice Activity Detection using Silero VAD."""

from __future__ import annotations

import logging

import numpy as np
import torch

from backend.config import (
    STT_SAMPLE_RATE,
    VAD_MIN_SILENCE_MS,
    VAD_MIN_SPEECH_MS,
    VAD_THRESHOLD,
)

logger = logging.getLogger(__name__)

# Silero VAD expects 512-sample chunks at 16 kHz (32ms per chunk)
SILERO_CHUNK_SAMPLES = 512


class SileroVAD:
    """Silero VAD for detecting speech boundaries in audio streams."""

    def __init__(self) -> None:
        # silero-vad >= 5.1 exposes load() directly
        try:
            from silero_vad import load_silero_vad
            self._model = load_silero_vad()
        except ImportError:
            # Fallback for older versions via torch.hub
            model, _ = torch.hub.load(
                repo_or_dir="snakers4/silero-vad",
                model="silero_vad",
                trust_repo=True,
            )
            self._model = model

        self._threshold = VAD_THRESHOLD
        self._min_silence_chunks = int(
            VAD_MIN_SILENCE_MS / (SILERO_CHUNK_SAMPLES / STT_SAMPLE_RATE * 1000)
        )
        self._min_speech_chunks = int(
            VAD_MIN_SPEECH_MS / (SILERO_CHUNK_SAMPLES / STT_SAMPLE_RATE * 1000)
        )
        self.reset()
        logger.info(
            "SileroVAD ready  threshold=%.2f  min_silence=%dms  min_speech=%dms",
            self._threshold,
            VAD_MIN_SILENCE_MS,
            VAD_MIN_SPEECH_MS,
        )

    def reset(self) -> None:
        """Reset VAD state for a new utterance."""
        self._model.reset_states()
        self._speech_chunks = 0
        self._silence_chunks = 0
        self._is_speaking = False
        self._audio_buffer = bytearray()

    def process_chunk(self, pcm_bytes: bytes) -> tuple[bool, bool]:
        """Process a chunk of PCM audio (s16le, 16 kHz, mono).

        Returns (speech_started, speech_ended):
        - speech_started: True when speech onset is first detected
        - speech_ended: True when enough silence follows speech
        """
        self._audio_buffer.extend(pcm_bytes)

        speech_started = False
        speech_ended = False

        # Process in SILERO_CHUNK_SAMPLES-sized windows
        while len(self._audio_buffer) >= SILERO_CHUNK_SAMPLES * 2:  # 2 bytes per sample
            raw = bytes(self._audio_buffer[: SILERO_CHUNK_SAMPLES * 2])
            del self._audio_buffer[: SILERO_CHUNK_SAMPLES * 2]

            audio_np = np.frombuffer(raw, dtype=np.int16).astype(np.float32) / 32768.0
            tensor = torch.from_numpy(audio_np)

            prob = self._model(tensor, STT_SAMPLE_RATE).item()

            if prob >= self._threshold:
                self._speech_chunks += 1
                self._silence_chunks = 0

                if not self._is_speaking and self._speech_chunks >= self._min_speech_chunks:
                    self._is_speaking = True
                    speech_started = True
                    logger.debug("Speech started (prob=%.2f)", prob)
            else:
                if self._is_speaking:
                    self._silence_chunks += 1
                    if self._silence_chunks >= self._min_silence_chunks:
                        speech_ended = True
                        logger.debug(
                            "Speech ended after %d chunks of silence", self._silence_chunks
                        )
                        # Don't reset here — caller will reset after consuming audio

        return speech_started, speech_ended

    @property
    def is_speaking(self) -> bool:
        return self._is_speaking
