"""Grapheme-to-phoneme for English and Urdu.

English uses a compact bundled lexicon with a grapheme-rule fallback; Urdu
uses a direct phonetic grapheme table.  Output is a flat token stream of
phonemes plus pause markers, consumed by `timeline_builder`.
"""

from __future__ import annotations

import re

from backend.animation.data.english_lexicon import LEXICON
from backend.animation.data.urdu_graphemes import (
    URDU_DIACRITICS,
    URDU_LETTER_TO_PHONEMES,
)

# Pause markers (not phonemes).
SIL = "SIL"            # short inter-word gap
SHORT_PAUSE = "P_S"    # comma / semicolon
LONG_PAUSE = "P_L"     # . ! ? — sentence-final

# Ordered digraph rules for the English fallback.
_DIGRAPHS: list[tuple[str, str]] = [
    ("tch", "CH"), ("dge", "JH"), ("igh", "AY"),
    ("ch", "CH"), ("sh", "SH"), ("ph", "F"), ("th", "TH"),
    ("wh", "W"), ("ck", "K"), ("ng", "NG"), ("qu", "K W"),
    ("oo", "UW"), ("ee", "IY"), ("ea", "IY"), ("ai", "EY"),
    ("ay", "EY"), ("ou", "AW"), ("ow", "OW"), ("oi", "OY"),
    ("oy", "OY"),
]

_SINGLES: dict[str, str] = {
    "a": "AE", "b": "B", "c": "K", "d": "D", "e": "EH", "f": "F",
    "g": "G", "h": "HH", "i": "IH", "j": "JH", "k": "K", "l": "L",
    "m": "M", "n": "N", "o": "AA", "p": "P", "q": "K", "r": "R",
    "s": "S", "t": "T", "u": "AH", "v": "V", "w": "W", "x": "K S",
    "y": "Y", "z": "Z",
}

_EN_TOKEN_RE = re.compile(r"[A-Za-z']+|[.,!?;:]")
_UR_TOKEN_RE = re.compile(r"[\u0600-\u06FF]+|[.,!?;:،۔]")


def _english_rules(word: str) -> list[str]:
    """Approximate English pronunciation for unknown words."""
    out: list[str] = []
    w = word.lower()
    i, n = 0, len(w)
    while i < n:
        matched = False
        for graph, phon in _DIGRAPHS:
            if w.startswith(graph, i):
                out.extend(phon.split())
                i += len(graph)
                matched = True
                break
        if matched:
            continue

        ch = w[i]
        if ch == "'":
            i += 1
            continue
        # Silent final 'e'
        if ch == "e" and i == n - 1 and n > 2:
            i += 1
            continue
        phon = _SINGLES.get(ch)
        if phon:
            out.extend(phon.split())
        # Collapse doubled letters
        if i + 1 < n and w[i + 1] == ch:
            i += 1
        i += 1
    return out


def _urdu_rules(word: str) -> list[str]:
    out: list[str] = []
    for ch in word:
        if ch in URDU_DIACRITICS:
            out.extend(URDU_DIACRITICS[ch])
            continue
        phen = URDU_LETTER_TO_PHONEMES.get(ch)
        if phen:
            out.extend(phen)
    return out


def english_word_to_phonemes(word: str) -> list[str]:
    key = word.lower().strip("'")
    if key in LEXICON:
        return list(LEXICON[key])
    return _english_rules(word)


def urdu_word_to_phonemes(word: str) -> list[str]:
    return _urdu_rules(word)


def g2p(text: str, language: str = "en") -> list[str]:
    """Convert text to a token stream of phonemes + pause markers."""
    if not text:
        return []

    tokens: list[str] = []
    pattern = _UR_TOKEN_RE if language == "ur" else _EN_TOKEN_RE

    for tok in pattern.findall(text):
        if tok == ".":
            tokens.append(LONG_PAUSE)
            continue
        if tok in (",", ";", ":", "،"):
            tokens.append(SHORT_PAUSE)
            continue
        if tok in ("!", "?", "۔"):
            tokens.append(LONG_PAUSE)
            continue

        if language == "ur":
            phonemes = urdu_word_to_phonemes(tok)
        else:
            phonemes = english_word_to_phonemes(tok)

        if phonemes:
            tokens.extend(phonemes)
            tokens.append(SIL)

    return tokens
