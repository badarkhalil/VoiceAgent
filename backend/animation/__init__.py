"""Client-side avatar animation: text -> viseme/expression/head/blink timeline."""

from backend.animation.providers.base import AnimationTimeline, VisemeProvider
from backend.animation.providers.rule_based import RuleBasedVisemeProvider

__all__ = ["AnimationTimeline", "VisemeProvider", "RuleBasedVisemeProvider"]
