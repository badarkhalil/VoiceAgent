/**
 * Head motion (spec §12): small yaw/pitch/roll from the timeline, plus a
 * gentle idle sway when nothing is playing. Values are degrees.
 */

export class HeadController {
  constructor() {
    this._idlePhase = 0;
    this.enabled = true;
  }

  compose(frame, timeline, t, dt) {
    if (!this.enabled) return frame;

    if (timeline) {
      const h = timeline.headAt(t);
      if (h) {
        frame.headYaw += h.yaw;
        frame.headPitch += h.pitch;
        frame.headRoll += h.roll;
      }
    } else {
      // Slow, subtle idle sway.
      this._idlePhase += dt * 0.6;
      frame.headYaw += Math.sin(this._idlePhase) * 1.4;
      frame.headPitch += Math.sin(this._idlePhase * 0.7 + 1.0) * 0.8;
      frame.headRoll += Math.sin(this._idlePhase * 0.5 + 2.0) * 0.5;
    }
    return frame;
  }
}
