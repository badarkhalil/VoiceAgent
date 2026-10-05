/**
 * Parsed, queryable animation timeline for a single sentence.
 *
 * Wraps the raw server payload and answers "what should the face be doing at
 * time t?" for each channel. All sampling is allocation-free into scratch
 * objects owned by the caller.
 */

import { VisemeTimeline } from "../animation/VisemeTimeline.js";
import { sampleKeyframes } from "../animation/AnimationInterpolator.js";

export class AnimationTimeline {
  constructor(data) {
    this.version = data.version || "1.0";
    this.avatarId = data.avatarId || "azure";
    this.sentenceIndex = data.sentence_index ?? 0;
    this.duration = data.duration || 0;
    this.alignment = data.alignment || "estimated-rule-based";

    this.visemes = new VisemeTimeline(data.visemes || []);
    this.expressions = Array.isArray(data.expressions) ? data.expressions : [];
    this.head = Array.isArray(data.head) ? data.head : [];
    this.blinks = Array.isArray(data.blinks) ? data.blinks : [];
    this._headScratch = { time: 0, yaw: 0, pitch: 0, roll: 0 };
  }

  sampleMouthInto(frame, t) {
    return this.visemes.sampleInto(frame, t);
  }

  expressionAt(t) {
    let chosen = null;
    for (const e of this.expressions) {
      if (t >= e.start && t <= e.end) chosen = e;
    }
    return chosen;
  }

  headAt(t) {
    const k = sampleKeyframes(this.head, t, ["yaw", "pitch", "roll"]);
    if (!k) return null;
    this._headScratch.yaw = k.yaw || 0;
    this._headScratch.pitch = k.pitch || 0;
    this._headScratch.roll = k.roll || 0;
    return this._headScratch;
  }

  blinkAt(t) {
    for (const b of this.blinks) {
      if (t >= b.time && t <= b.time + b.duration) {
        const u = (t - b.time) / b.duration;
        return u < 0.5 ? u * 2 : (1 - u) * 2;
      }
    }
    return 0;
  }
}
