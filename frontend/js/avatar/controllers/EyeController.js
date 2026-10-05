/**
 * Subtle eye life: slow lid openness variation and tiny asymmetric motion so
 * the face never looks frozen (spec §11). Blink is owned by BlinkController.
 */

export class EyeController {
  constructor() {
    this._phase = Math.random() * Math.PI * 2;
  }

  compose(frame, dt) {
    this._phase += dt * 0.8;
    frame.eyeOpen += Math.sin(this._phase) * 0.03;
    return frame;
  }
}
