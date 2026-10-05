/**
 * Blinking (spec §11): uses timeline blink events when playing, otherwise
 * schedules natural procedural blinks (~2.5-4 s, slight randomness).
 */

export class BlinkController {
  constructor() {
    this.enabled = true;
    this._nextBlink = 1.5 + Math.random() * 1.5;
    this._activeUntil = 0;
    this._activeStart = -1;
    this._activeDur = 0.12;
    this._now = 0;
  }

  compose(frame, timeline, t, dt) {
    if (!this.enabled) return frame;

    let blink = 0;
    if (timeline) {
      blink = timeline.blinkAt(t);
    } else {
      this._now += dt;
      if (this._now >= this._nextBlink && this._now > this._activeUntil) {
        this._activeStart = this._now;
        this._activeDur = 0.10 + Math.random() * 0.06;
        this._activeUntil = this._now + this._activeDur;
        this._nextBlink = this._activeUntil + 2.5 + Math.random() * 1.5;
      }
      if (this._activeStart >= 0 && this._now >= this._activeStart && this._now <= this._activeStart + this._activeDur) {
        const u = (this._now - this._activeStart) / this._activeDur;
        blink = u < 0.5 ? u * 2 : (1 - u) * 2;
      }
    }

    frame.eyeBlinkLeft = Math.max(frame.eyeBlinkLeft, blink);
    frame.eyeBlinkRight = Math.max(frame.eyeBlinkRight, blink);
    return frame;
  }
}
