"""Piper TTS via persistent subprocess."""

from __future__ import annotations

import asyncio
import logging
import struct
import subprocess
from pathlib import Path

from backend.config import PIPER_EXE, PIPER_VOICE_MODEL, TTS_SAMPLE_RATE

logger = logging.getLogger(__name__)

# Piper outputs a WAV header (44 bytes) before raw PCM data.
WAV_HEADER_SIZE = 44


class PiperTTS:
    """Manage Piper as a one-shot-per-sentence subprocess.

    Each call to `synthesize` spawns piper with --output_raw, reads all PCM
    from stdout, and returns it.  We use --output_raw so Piper writes raw
    s16le PCM to stdout with no WAV header.
    """

    def __init__(self) -> None:
        self._exe = str(PIPER_EXE)
        self._model = str(PIPER_VOICE_MODEL)
        if not Path(self._exe).exists():
            raise FileNotFoundError(
                f"Piper executable not found at {self._exe}. Run scripts/setup.py first."
            )
        if not Path(self._model).exists():
            raise FileNotFoundError(
                f"Piper voice model not found at {self._model}. Run scripts/setup.py first."
            )
        logger.info("PiperTTS ready  exe=%s  model=%s", self._exe, self._model)

    async def synthesize(
        self,
        text: str,
        cancel_event: asyncio.Event | None = None,
    ) -> bytes | None:
        """Convert text to raw PCM audio (s16le, 22050 Hz, mono).

        Returns None if cancelled.
        """
        text = text.strip()
        if not text:
            return b""

        try:
            proc = await asyncio.create_subprocess_exec(
                self._exe,
                "--model", self._model,
                "--output_raw",
                stdin=asyncio.subprocess.PIPE,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )

            # Feed text and close stdin so Piper starts processing.
            assert proc.stdin is not None
            proc.stdin.write(text.encode("utf-8"))
            proc.stdin.write(b"\n")
            await proc.stdin.drain()
            proc.stdin.close()

            # Read output while checking for cancellation.
            chunks: list[bytes] = []
            assert proc.stdout is not None
            while True:
                if cancel_event and cancel_event.is_set():
                    proc.kill()
                    logger.debug("TTS cancelled mid-synthesis")
                    return None

                try:
                    chunk = await asyncio.wait_for(
                        proc.stdout.read(8192), timeout=0.1
                    )
                except asyncio.TimeoutError:
                    continue

                if not chunk:
                    break
                chunks.append(chunk)

            await proc.wait()
            pcm = b"".join(chunks)
            logger.debug("TTS synthesized %d bytes for: %.40s...", len(pcm), text)
            return pcm

        except Exception:
            logger.exception("TTS synthesis failed for: %.60s", text)
            return b""

    async def synthesize_streaming(
        self,
        text: str,
        cancel_event: asyncio.Event | None = None,
        chunk_size: int = 8192,
    ):
        """Yield PCM chunks as they arrive from Piper.

        Allows sending audio to the client before the full sentence is done.
        """
        text = text.strip()
        if not text:
            return

        try:
            proc = await asyncio.create_subprocess_exec(
                self._exe,
                "--model", self._model,
                "--output_raw",
                stdin=asyncio.subprocess.PIPE,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )

            assert proc.stdin is not None
            proc.stdin.write(text.encode("utf-8"))
            proc.stdin.write(b"\n")
            await proc.stdin.drain()
            proc.stdin.close()

            assert proc.stdout is not None
            while True:
                if cancel_event and cancel_event.is_set():
                    proc.kill()
                    logger.debug("TTS streaming cancelled")
                    return

                try:
                    chunk = await asyncio.wait_for(
                        proc.stdout.read(chunk_size), timeout=0.1
                    )
                except asyncio.TimeoutError:
                    continue

                if not chunk:
                    break
                yield chunk

            await proc.wait()

        except Exception:
            logger.exception("TTS streaming failed for: %.60s", text)
