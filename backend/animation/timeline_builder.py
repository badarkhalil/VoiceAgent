"""Turn a phoneme token stream + exact duration into an AnimationTimeline.

The TTS gives us the *exact* sentence duration (bytes / 2 / sample_rate), so
the builder distributes that duration across weighted visemes and produces
contiguous spans.  Expressions, head keyframes and blinks are rule cues; the
whole thing is labelled `estimated-rule-based` because Piper/Edge provide no
per-phoneme timestamps.
"""

from __future__ import annotations

import random

from backend.animation.g2p import LONG_PAUSE, SHORT_PAUSE, SIL
from backend.animation.providers.base import AnimationTimeline
from backend.animation.viseme_map import phoneme_to_viseme, viseme_weight

LEAD_SECONDS = 0.06          # brief neutral before the first phoneme
PAUSE_WEIGHTS = {SIL: 0.35, SHORT_PAUSE: 1.2, LONG_PAUSE: 2.5}

_GREETINGS = (
    "hi", "hello", "hey", "welcome", "greetings", "good morning",
    "good afternoon", "good evening", "سلام", "خوش",
)


def build_visemes(tokens: list[str], duration: float) -> list[dict]:
    """Distribute `duration` seconds across the token stream as viseme spans."""
    if duration <= 0:
        duration = 0.01

    weighted: list[tuple[str, float]] = []
    for tok in tokens:
        if tok in PAUSE_WEIGHTS:
            weighted.append(("neutral", PAUSE_WEIGHTS[tok]))
        else:
            vis = phoneme_to_viseme(tok)
            weighted.append((vis, viseme_weight(vis)))

    spans: list[dict] = []
    lead = min(LEAD_SECONDS, duration * 0.3)
    t = 0.0
    if lead > 0:
        spans.append({"start": 0.0, "end": round(lead, 4), "value": "neutral"})
        t = lead

    available = max(duration - lead, 0.0)
    total_weight = sum(w for _, w in weighted) or 1.0

    if not weighted:
        spans.append({"start": round(lead, 4), "end": round(duration, 4), "value": "neutral"})
    else:
        for vis, w in weighted:
            d = available * (w / total_weight)
            spans.append({"start": round(t, 4), "end": round(t + d, 4), "value": vis})
            t += d
        spans[-1]["end"] = round(duration, 4)

    # Merge adjacent spans that share the same viseme (smoother, fewer keys).
    merged: list[dict] = []
    for s in spans:
        if merged and merged[-1]["value"] == s["value"]:
            merged[-1]["end"] = s["end"]
        else:
            merged.append(dict(s))
    return merged


def build_expressions(text: str, duration: float) -> list[dict]:
    """Rule-based expression cues, always keeping a low-level friendly base."""
    exprs = [{"start": 0.0, "end": round(duration, 4), "type": "friendly", "intensity": 0.25}]

    lowered = text.lower()
    if any(g in lowered for g in _GREETINGS):
        exprs.append({"start": 0.0, "end": round(duration, 4), "type": "friendly", "intensity": 0.45})

    if "!" in text:
        exprs.append({"start": 0.0, "end": round(duration, 4), "type": "happy", "intensity": 0.5})
    elif "?" in text or "؟" in text:
        exprs.append({"start": 0.0, "end": round(duration, 4), "type": "thinking", "intensity": 0.4})

    return exprs


def build_head(duration: float, seed: int = 0) -> list[dict]:
    """1-3 gentle head keyframes within the small ranges the photo supports."""
    rng = random.Random(seed)
    yaw = round(rng.uniform(1.5, 5.0), 2) * rng.choice((1, -1))
    pitch = round(rng.uniform(0.8, 3.0), 2)
    roll = round(rng.uniform(0.3, 1.5), 2) * rng.choice((1, -1))

    if duration < 1.2:
        return [
            {"time": 0.0, "yaw": 0.0, "pitch": 0.0, "roll": 0.0},
            {"time": round(duration, 3), "yaw": 0.0, "pitch": 0.0, "roll": 0.0},
        ]

    mid = round(duration / 2, 3)
    return [
        {"time": 0.0, "yaw": 0.0, "pitch": 0.0, "roll": 0.0},
        {"time": mid, "yaw": yaw, "pitch": pitch, "roll": roll},
        {"time": round(duration, 3), "yaw": 0.0, "pitch": 0.0, "roll": 0.0},
    ]


def build_blinks(duration: float, seed: int = 0) -> list[dict]:
    """Natural-ish blinks: first after 1-2.5 s, then every ~2.5-4 s (seeded)."""
    rng = random.Random(seed ^ 0x5EED)
    blinks: list[dict] = []
    t = rng.uniform(1.0, 2.5)
    while t < duration:
        blinks.append({"time": round(t, 3), "duration": round(rng.uniform(0.10, 0.16), 3)})
        t += rng.uniform(2.5, 4.0)
    return blinks


def build_timeline(
    tokens: list[str],
    text: str,
    duration: float,
    sentence_index: int,
    avatar_id: str,
    version: str,
    alignment: str,
) -> AnimationTimeline:
    seed = (sentence_index * 2654435761) ^ (len(text) * 40503)
    return AnimationTimeline(
        version=version,
        avatar_id=avatar_id,
        sentence_index=sentence_index,
        duration=round(duration, 4),
        visemes=build_visemes(tokens, duration),
        expressions=build_expressions(text, duration),
        head=build_head(duration, seed),
        blinks=build_blinks(duration, seed),
        alignment=alignment,
    )
