"""Edge TTS client for languages not supported by Piper (e.g. Urdu)."""

from __future__ import annotations

import asyncio
import io
import logging
from typing import AsyncIterator

import edge_tts

logger = logging.getLogger(__name__)

# Voice mapping for edge-tts
EDGE_VOICES = {
    "ur": "ur-PK-UzmaNeural",  # Female Urdu (Pakistan)
    "ur-male": "ur-PK-AsadNeural",  # Male Urdu (Pakistan)
}


class EdgeTTSClient:
    """Wrapper for Microsoft Edge TTS (neural, free, no API key)."""

    def __init__(self, voice: str = "ur-PK-UzmaNeural") -> None:
        self.voice = voice
        logger.info("EdgeTTSClient ready  voice=%s", self.voice)

    async def synthesize_streaming(
        self,
        text: str,
        cancel_event: asyncio.Event | None = None,
        chunk_size: int = 8192,
    ) -> AsyncIterator[bytes]:
        """Yield raw PCM s16le 22050Hz chunks from Edge TTS.

        Edge TTS outputs mp3, so we convert to raw PCM on the fly.
        For simplicity, we collect the audio then yield in chunks.
        """
        text = text.strip()
        if not text:
            return

        try:
            communicate = edge_tts.Communicate(text, self.voice)

            # Collect audio bytes (mp3 format)
            mp3_chunks = []
            async for chunk in communicate.stream():
                if cancel_event and cancel_event.is_set():
                    return
                if chunk["type"] == "audio":
                    mp3_chunks.append(chunk["data"])

            if not mp3_chunks:
                return

            mp3_data = b"".join(mp3_chunks)

            # Convert MP3 to raw PCM s16le 22050Hz using ffmpeg (available on most systems)
            # or use a simpler approach with io.BytesIO
            pcm_data = await self._mp3_to_pcm(mp3_data)

            if cancel_event and cancel_event.is_set():
                return

            # Yield in chunks
            for i in range(0, len(pcm_data), chunk_size):
                if cancel_event and cancel_event.is_set():
                    return
                yield pcm_data[i:i + chunk_size]

        except Exception:
            logger.exception("EdgeTTS synthesis failed for: %.60s", text)

    async def _mp3_to_pcm(self, mp3_data: bytes) -> bytes:
        """Convert MP3 bytes to raw PCM s16le 22050Hz mono using ffmpeg."""
        try:
            proc = await asyncio.create_subprocess_exec(
                "ffmpeg",
                "-i", "pipe:0",
                "-f", "s16le",
                "-acodec", "pcm_s16le",
                "-ar", "22050",
                "-ac", "1",
                "pipe:1",
                stdin=asyncio.subprocess.PIPE,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )

            stdout, stderr = await proc.communicate(input=mp3_data)
            if proc.returncode != 0:
                logger.error("ffmpeg conversion failed: %s", stderr.decode()[:200])
                return b""
            return stdout
        except FileNotFoundError:
            logger.error("ffmpeg not found — required for Edge TTS audio conversion")
            return b""
