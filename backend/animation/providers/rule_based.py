"""Default viseme provider: text -> G2P -> weighted viseme timeline.

Because Piper and Edge TTS return no timestamps, timing is *estimated*: the
known exact sentence duration is distributed across phonemes by relative
viseme weight.  The result is labelled accordingly so the UI can be honest
about provenance.
"""

from __future__ import annotations

from backend.config import (
    ANIMATION_ALIGNMENT,
    ANIMATION_VERSION,
    AVATAR_ID,
)
from backend.animation.g2p import g2p
from backend.animation.normalizer import normalize_text
from backend.animation.providers.base import AnimationTimeline
from backend.animation.timeline_builder import build_timeline


class RuleBasedVisemeProvider:
    """Estimate a viseme/expression/head/blink timeline from text + duration."""

    def __init__(
        self,
        avatar_id: str = AVATAR_ID,
        version: str = ANIMATION_VERSION,
        alignment: str = ANIMATION_ALIGNMENT,
    ) -> None:
        self._avatar_id = avatar_id
        self._version = version
        self._alignment = alignment

    def build(
        self, text: str, duration_s: float, language: str = "en"
    ) -> AnimationTimeline:
        normalized = normalize_text(text)
        tokens = g2p(normalized, language=language)
        return build_timeline(
            tokens=tokens,
            text=text,
            duration=duration_s,
            sentence_index=0,
            avatar_id=self._avatar_id,
            version=self._version,
            alignment=self._alignment,
        )
