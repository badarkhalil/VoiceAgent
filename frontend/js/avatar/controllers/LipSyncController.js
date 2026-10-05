/**
 * Gates and modulates mouth motion using the actual audio envelope (spec §17).
 * This closes residual gaps between the estimated timeline and the real audio:
 * during silence the mouth is suppressed; during loud speech it opens a little
 * more. It never creates motion on its own.
 */

export class LipSyncController {
  constructor(analyzer = null) {
    this.analyzer = analyzer;
    this.enabled = true;
    this.floor = 0.35;   // never fully suppress the timeline motion
    this.amount = 1.1;   // mild upward gain
    this.lastLevel = 0;  // exposed for the debug overlay
  }

  compose(frame) {
    if (!this.enabled || !this.analyzer) return frame;

    const level = this.analyzer.level(); // 0..1
    this.lastLevel = level;
    const gain = this.floor + Math.min(1, level * this.amount) * (1 - this.floor);

    frame.mouthOpen *= gain;
    frame.jawOpen *= gain;
    return frame;
  }
}
