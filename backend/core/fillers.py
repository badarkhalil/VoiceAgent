"""Pre-synthesized filler / backchannel phrases.

The pipeline has to wait for RAG + the LLM's first token before any real
reply audio exists.  To avoid dead air we pre-synthesize a small pool of
short utterances at startup and stream one immediately when a real
transcript arrives but the reply is slow to start.

Piper/Edge have no timestamps, so fillers are fixed pre-rendered PCM and
are not part of the avatar lip-sync timeline.
"""

from __future__ import annotations

import logging

from backend.config import FILLER_EN, FILLER_UR

logger = logging.getLogger(__name__)

CHUNK_SIZE = 8192


class FillerCache:
    """Holds pre-synthesized PCM for a handful of short phrases per language."""

    def __init__(self, tts_en, tts_ur) -> None:
        self._tts = {"en": tts_en, "ur": tts_ur}
        self._phrases = {"en": list(FILLER_EN), "ur": list(FILLER_UR)}
        # lang -> list[(text, pcm_bytes)]
        self._pool: dict[str, list[tuple[str, bytes]]] = {"en": [], "ur": []}
        self._idx: dict[str, int] = {"en": 0, "ur": 0}

    async def _render(self, tts, phrase: str) -> bytes:
        """Render one phrase to PCM, supporting both TTS client shapes.

        Piper exposes `synthesize()`; Edge only exposes `synthesize_streaming()`.
        """
        synth = getattr(tts, "synthesize", None)
        if callable(synth):
            return await synth(phrase) or b""
        chunks: list[bytes] = []
        async for chunk in tts.synthesize_streaming(phrase):
            chunks.append(chunk)
        return b"".join(chunks)

    async def warmup(self) -> None:
        """Synthesize every filler once so runtime playback is instant."""
        for lang, tts in self._tts.items():
            pool: list[tuple[str, bytes]] = []
            for phrase in self._phrases.get(lang, []):
                try:
                    pcm = await self._render(tts, phrase)
                except Exception:
                    logger.exception("Filler synthesis failed for %r", phrase)
                    continue
                if pcm:
                    pool.append((phrase, pcm))
            self._pool[lang] = pool
            logger.info(
                "FillerCache[%s]: %d/%d phrases ready",
                lang, len(pool), len(self._phrases.get(lang, [])),
            )

    def has(self, lang: str) -> bool:
        return bool(self._pool.get(lang))

    def next(self, lang: str) -> tuple[str, bytes] | None:
        """Return the next (text, pcm) filler, cycling through the pool."""
        pool = self._pool.get(lang) or self._pool.get("en")
        if not pool:
            return None
        i = self._idx.get(lang, 0) % len(pool)
        self._idx[lang] = i + 1
        return pool[i]
