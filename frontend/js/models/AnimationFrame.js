/**
 * One reusable scratch frame of normalized rig parameters.
 *
 * The runtime reuses a single instance forever — `reset()` then mutate — so
 * the render loop performs zero per-frame allocation (spec §16, §26).
 */

export const RIG_PARAMS = [
  // mouth
  "mouthOpen", "mouthWidth", "jawOpen", "lipRound", "smile", "cheek",
  // brows / eyes
  "browLeft", "browRight", "browInnerUp", "eyeBlinkLeft", "eyeBlinkRight", "eyeOpen",
  // head
  "headYaw", "headPitch", "headRoll", "headX", "headY",
];

export class AnimationFrame {
  constructor() {
    for (const k of RIG_PARAMS) this[k] = 0;
    // sensible neutral baselines
    this.mouthWidth = 0.44;
  }

  reset() {
    for (const k of RIG_PARAMS) this[k] = 0;
    this.mouthWidth = 0.44;
    return this;
  }

  applyExpression(deltas, intensity) {
    if (!deltas) return;
    for (const k of Object.keys(deltas)) {
      if (k in this) this[k] += deltas[k] * intensity;
    }
    return this;
  }

  lerpTo(other, t) {
    for (const k of RIG_PARAMS) {
      this[k] += (other[k] - this[k]) * t;
    }
    return this;
  }
}
