"""Phoneme -> viseme mapping and per-viseme timing weights (spec §8).

The viseme set is intentionally small (12-20).  Each viseme also carries a
relative *weight* used by the timeline builder to distribute the sentence
duration: vowels hold longer, plosives and fricatives are shorter.
"""

from __future__ import annotations

# Phoneme (ARPAbet-ish, no stress digits) -> viseme id
PHONEME_TO_VISEME: dict[str, str] = {
    # Closures
    "P": "closed", "B": "closed", "M": "closed",
    # Labiodental
    "F": "fv", "V": "fv",
    # Dental
    "TH": "th", "DH": "th",
    # Alveolar stops / nasals
    "T": "td", "D": "td", "N": "td",
    # Velar
    "K": "kg", "G": "kg", "NG": "kg",
    # Sibilants
    "S": "s", "Z": "s",
    # Post-alveolar
    "SH": "sh", "CH": "sh", "JH": "sh", "ZH": "sh",
    # Vowels
    "AA": "aa",
    "AE": "ae",
    "EH": "eh",
    "IY": "ee", "IH": "ee",
    "AH": "ah", "ER": "ah",
    "OW": "oh", "AO": "oh",
    "UW": "oo", "UH": "oo",
    # Approximants
    "L": "L",
    "W": "oo",
    "R": "ah",
    "Y": "ee",
    # Glottal
    "HH": "HH",
    # Silence / rest
    "REST": "neutral",
    "SIL": "neutral",
}

# Every viseme the runtime understands (spec §8 + §30 HH/L).
VISEMES: tuple[str, ...] = (
    "closed", "fv", "th", "td", "kg", "s", "sh",
    "aa", "ae", "eh", "ee", "ah", "oh", "oo",
    "HH", "L", "neutral",
)

# Relative duration weight per viseme.
VISEME_WEIGHT: dict[str, float] = {
    "closed": 0.7,
    "fv": 0.8,
    "th": 0.8,
    "td": 0.7,
    "kg": 0.7,
    "s": 0.8,
    "sh": 0.85,
    "aa": 1.2,
    "ae": 1.1,
    "eh": 1.0,
    "ee": 1.0,
    "ah": 1.0,
    "oh": 1.1,
    "oo": 1.1,
    "HH": 0.6,
    "L": 0.85,
    "neutral": 1.0,
}

DEFAULT_WEIGHT = 0.9


def phoneme_to_viseme(phoneme: str) -> str:
    """Map a single phoneme to its viseme; unknown phonemes fall back to neutral."""
    p = phoneme.upper().rstrip("0123456789")
    return PHONEME_TO_VISEME.get(p, "neutral")


def viseme_weight(viseme: str) -> float:
    return VISEME_WEIGHT.get(viseme, DEFAULT_WEIGHT)
