/**
 * Viseme spans + sampling with cross-fade (never snaps between visemes).
 */

import { blendVisemeInto } from "../models/Viseme.js";

export class VisemeTimeline {
  constructor(spans = []) {
    this.spans = spans
      .filter((s) => s && typeof s.start === "number" && typeof s.end === "number")
      .slice()
      .sort((a, b) => a.start - b.start);
    this.crossFade = 0.06; // seconds of blend at each boundary
  }

  get duration() {
    return this.spans.length ? this.spans[this.spans.length - 1].end : 0;
  }

  /** Fill `out` (an AnimationFrame) with the blended mouth targets at time t. */
  sampleInto(out, t) {
    const spans = this.spans;
    if (!spans.length) {
      return blendVisemeInto(out, "neutral", "neutral", 0);
    }

    let i = 0;
    while (i < spans.length && t >= spans[i].end) i++;
    if (i >= spans.length) i = spans.length - 1;

    const cur = spans[i];
    const next = spans[i + 1];
    const dur = cur.end - cur.start;
    const cfw = Math.min(this.crossFade, dur * 0.5);

    if (next && cfw > 0 && t > cur.end - cfw) {
      const alpha = (t - (cur.end - cfw)) / cfw;
      return blendVisemeInto(out, cur.value, next.value, Math.min(1, Math.max(0, alpha)));
    }
    return blendVisemeInto(out, cur.value, cur.value, 0);
  }
}
