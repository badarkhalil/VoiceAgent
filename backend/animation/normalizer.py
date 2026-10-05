"""Text normalization for G2P: expand numbers, currency and symbols to words.

Keeps the phoneme estimate sane for booking-style utterances ("$120", "3
guests", "2026").  This is deliberately lightweight — it is a pre-step for a
rule-based estimator, not a full text-normalization library.
"""

from __future__ import annotations

import re

_ONES = [
    "zero", "one", "two", "three", "four", "five", "six", "seven", "eight",
    "nine", "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen",
    "sixteen", "seventeen", "eighteen", "nineteen",
]
_TENS = [
    "", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy",
    "eighty", "ninety",
]

_CURRENCY = {"$": "dollars", "£": "pounds", "€": "euros", "₨": "rupees"}

_SYMBOL_WORDS = {
    "%": " percent",
    "&": " and ",
    "+": " plus ",
    "=": " equals ",
    "@": " at ",
}


def _under_1000(n: int) -> str:
    if n < 20:
        return _ONES[n]
    if n < 100:
        tens, rem = divmod(n, 10)
        return _TENS[tens] + (f" {_ONES[rem]}" if rem else "")
    hundreds, rem = divmod(n, 100)
    out = f"{_ONES[hundreds]} hundred"
    if rem:
        out += f" {_under_1000(rem)}"
    return out


def number_to_words(n: int) -> str:
    if n < 0:
        return "minus " + number_to_words(-n)
    if n < 1000:
        return _under_1000(n)
    if n < 1_000_000:
        thousands, rem = divmod(n, 1000)
        out = f"{number_to_words(thousands)} thousand"
        if rem:
            out += f" {_under_1000(rem)}"
        return out
    millions, rem = divmod(n, 1_000_000)
    out = f"{number_to_words(millions)} million"
    if rem:
        out += f" {number_to_words(rem)}"
    return out


def _currency_repl(match: re.Match) -> str:
    symbol, integer, frac = match.group(1), match.group(2), match.group(3)
    out = f"{number_to_words(int(integer))} {_CURRENCY.get(symbol, 'dollars')}"
    if frac:
        out += f" and {number_to_words(int(frac))}"
    return out


def _year_repl(match: re.Match) -> str:
    y = int(match.group(0))
    if 1900 <= y <= 2099:
        hi, lo = divmod(y, 100)
        hi_w = _ONES[hi] if hi < 20 else _under_1000(hi)
        if lo == 0:
            return f"{hi_w} hundred"
        if lo < 10:
            return f"{hi_w} oh {_ONES[lo]}"
        return f"{hi_w} {_under_1000(lo)}"
    return number_to_words(y)


def normalize_text(text: str) -> str:
    """Return a spoken-word-ish version of `text` suitable for G2P."""
    if not text:
        return ""

    out = text

    # Currency first (e.g. $120, $120.50)
    out = re.sub(
        r"([$£€₨])(\d+)(?:\.(\d{1,2}))?", _currency_repl, out
    )

    # Years
    out = re.sub(r"\b(1[89]\d{2}|20\d{2})\b", _year_repl, out)

    # Remaining integers / decimals
    out = re.sub(
        r"\b(\d+)\b",
        lambda m: number_to_words(int(m.group(1))),
        out,
    )

    for sym, word in _SYMBOL_WORDS.items():
        out = out.replace(sym, word)

    # Collapse whitespace
    out = re.sub(r"\s+", " ", out).strip()
    return out
