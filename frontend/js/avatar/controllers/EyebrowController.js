/**
 * Adds a small speech-linked brow lift on top of expression-driven brows, so
 * the face reads as engaged while talking (spec §10).
 */

export class EyebrowController {
  compose(frame) {
    const lift = Math.max(0, frame.mouthOpen - 0.15) * 0.25;
    frame.browLeft += lift;
    frame.browRight += lift;
    return frame;
  }
}
