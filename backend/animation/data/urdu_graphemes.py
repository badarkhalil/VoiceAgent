"""Phonetic grapheme table for Urdu -> ARPAbet-ish phonemes.

Urdu is largely phonetic, so a direct character table gives a usable viseme
estimate without an external lexicon.  Output phoneme names reuse the same
inventory as the English lexicon so `viseme_map` is shared.
"""

from __future__ import annotations

# Base letters.
URDU_LETTER_TO_PHONEMES: dict[str, list[str]] = {
    "ا": ["AA"], "آ": ["AA"], "أ": ["AA"], "إ": ["IH"],
    "ب": ["B"], "پ": ["P"],
    "ت": ["T"], "ٹ": ["T"], "ث": ["S"],
    "ج": ["JH"], "چ": ["CH"],
    "ح": ["HH"], "خ": ["K"], "ھ": ["HH"],
    "د": ["D"], "ڈ": ["D"], "ذ": ["Z"],
    "ر": ["R"], "ڑ": ["R"], "ز": ["Z"], "ژ": ["ZH"],
    "س": ["S"], "ش": ["SH"], "ص": ["S"], "ض": ["Z"],
    "ط": ["T"], "ظ": ["Z"],
    "ع": ["AH"], "غ": ["G"],
    "ف": ["F"], "ق": ["K"], "ک": ["K"], "گ": ["G"],
    "ل": ["L"], "م": ["M"], "ن": ["N"], "ں": ["N"],
    "و": ["W", "UW"], "ہ": ["HH"], "ۃ": ["T"],
    "ی": ["Y", "IY"], "ے": ["IY"], "ئ": ["Y"], "ء": ["HH"],
    # Common Arabic/loan letters used in Urdu
    "ؤ": ["W"],
}

# Harakaat (short-vowel diacritics) override the preceding consonant's vowel.
URDU_DIACRITICS: dict[str, list[str]] = {
    "\u064e": ["AE"],   # zabar (fatha)
    "\u0650": ["IH"],   # zer (kasra)
    "\u064f": ["UH"],   # pesh (damma)
    "\u0652": [],       # sukun — no vowel
    "\u0651": [],       # shadda — length handled by repetition
}

# Long vowels written with alif/wao/ye following a consonant are already
# covered by the letter table above.
