/**
 * Client-side viseme provider (fallback).
 *
 * The server is the primary provider; this runs only when a sentence has audio
 * but no `animation.timeline` (e.g. an older backend). It is deliberately
 * simple — grapheme -> viseme with weighted timing — and is labelled as a
 * client estimate so the UI never claims more accuracy than it has.
 */

const DIGRAPHS = [
  ["th", "th"], ["sh", "sh"], ["ch", "sh"], ["ph", "fv"],
  ["ng", "kg"], ["ck", "kg"], ["qu", "oo"], ["oo", "oo"],
];
const SINGLES = {
  a: "aa", e: "eh", i: "ee", o: "oh", u: "oo", y: "ee",
  m: "closed", b: "closed", p: "closed",
  f: "fv", v: "fv",
  t: "td", d: "td", n: "td", l: "L", r: "L",
  k: "kg", g: "kg", c: "kg",
  s: "s", z: "s", j: "sh", x: "s",
  w: "oo", h: "HH", q: "oo",
};
const VOWELS = new Set(["aa", "eh", "ee", "oh", "oo", "ah", "ae"]);
const PAUSE_CHARS = new Set([" ", ",", ".", "!", "?", ";", ":", "\n", "\t", "-", "\u2014"]);

function weightOf(viseme) {
  return VOWELS.has(viseme) ? 1.6 : 1.0;
}

export class VisemeProvider {
  /** @returns {object} a timeline payload compatible with AnimationTimeline. */
  build(text, duration, language = "en") {
    const tokens = this._toVisemes(text);
    const spans = this._distribute(tokens, duration || 0.01);
    return {
      version: "1.0",
      avatarId: "azure",
      sentence_index: -1,
      duration: duration || 0.01,
      visemes: spans,
      expressions: [],
      head: [],
      blinks: [],
      alignment: "estimated-client",
    };
  }

  _toVisemes(text) {
    const out = [];
    const src = String(text || "").toLowerCase();
    let i = 0;
    while (i < src.length) {
      const ch = src[i];
      if (PAUSE_CHARS.has(ch)) { out.push({ v: "neutral", pause: true }); i++; continue; }

      let matched = false;
      for (const [seq, vis] of DIGRAPHS) {
        if (src.startsWith(seq, i)) { out.push({ v: vis }); i += seq.length; matched = true; break; }
      }
      if (matched) continue;

      const vis = SINGLES[ch];
      if (vis) out.push({ v: vis });
      i++;
    }
    if (out.length === 0) out.push({ v: "neutral" });
    return out;
  }

  _distribute(tokens, duration) {
    const lead = Math.min(0.06, duration * 0.3);
    const spans = [{ start: 0, end: round(lead), value: "neutral" }];

    const weighted = tokens.map((t) => ({
      value: t.pause ? "neutral" : t.v,
      w: t.pause ? 1.2 : weightOf(t.v),
    }));
    const total = weighted.reduce((a, b) => a + b.w, 0) || 1;
    const available = Math.max(duration - lead, 0);

    let t = lead;
    for (const w of weighted) {
      const d = available * (w.w / total);
      spans.push({ start: round(t), end: round(t + d), value: w.value });
      t += d;
    }
    if (spans.length) spans[spans.length - 1].end = round(duration);

    // Merge adjacent identical visemes.
    const merged = [];
    for (const s of spans) {
      if (merged.length && merged[merged.length - 1].value === s.value) {
        merged[merged.length - 1].end = s.end;
      } else {
        merged.push(Object.assign({}, s));
      }
    }
    return merged;
  }
}

function round(v) {
  return Math.round(v * 10000) / 10000;
}
