"""Provider interface + the data model shared by every viseme provider.

A provider turns (text, exact duration, language) into an AnimationTimeline
that fully describes *what the face should do* — never how to draw pixels
(spec §7, §31).  The rule-based provider is the default; a future
forced-aligner (e.g. MFA) or TTS-with-timestamps provider can replace it
without touching the pipeline or the client runtime.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Protocol


@dataclass
class AnimationTimeline:
    """A versioned animation description for a single spoken sentence."""

    version: str
    avatar_id: str
    sentence_index: int
    duration: float
    visemes: list[dict] = field(default_factory=list)
    expressions: list[dict] = field(default_factory=list)
    head: list[dict] = field(default_factory=list)
    blinks: list[dict] = field(default_factory=list)
    alignment: str = "estimated-rule-based"

    def to_dict(self) -> dict:
        return {
            "version": self.version,
            "avatarId": self.avatar_id,
            "sentence_index": self.sentence_index,
            "duration": round(self.duration, 4),
            "visemes": self.visemes,
            "expressions": self.expressions,
            "head": self.head,
            "blinks": self.blinks,
            "alignment": self.alignment,
        }


class VisemeProvider(Protocol):
    """Interface every viseme/timeline provider must implement."""

    def build(
        self, text: str, duration_s: float, language: str = "en"
    ) -> AnimationTimeline:  # pragma: no cover - protocol
        ...
