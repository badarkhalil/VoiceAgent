/**
 * Rig definition: named facial landmarks in normalized image space (0..1,
 * origin top-left) plus optional per-region overrides.
 *
 * A hand-authored rig only needs `landmarks`; everything else has defaults so
 * a missing rig.json still produces a plausible face (spec §6).
 */

export const DEFAULT_LANDMARKS = {
  faceCenter: [0.500, 0.500],

  mouthCenter: [0.500, 0.720],
  mouthLeft: [0.400, 0.720],
  mouthRight: [0.600, 0.720],
  mouthTop: [0.500, 0.690],
  mouthBottom: [0.500, 0.750],

  chin: [0.500, 0.860],
  jawLeft: [0.360, 0.800],
  jawRight: [0.640, 0.800],

  leftEye: [0.400, 0.450],
  rightEye: [0.600, 0.450],
  leftEyeTop: [0.400, 0.418],
  leftEyeBottom: [0.400, 0.482],
  rightEyeTop: [0.600, 0.418],
  rightEyeBottom: [0.600, 0.482],

  leftBrow: [0.400, 0.388],
  rightBrow: [0.600, 0.388],
  leftBrowInner: [0.452, 0.392],
  rightBrowInner: [0.548, 0.392],

  leftCheek: [0.360, 0.620],
  rightCheek: [0.640, 0.620],
};

export class AvatarRigDefinition {
  constructor(data = {}) {
    this.version = data.version || "1.0";
    this.landmarks = Object.assign({}, DEFAULT_LANDMARKS, data.landmarks || {});
    // Per-region radius overrides, keyed by parameter name -> {rx, ry}. Most
    // rigs omit this and use the renderer's built-in lobe geometry.
    this.regions = data.regions || {};
  }

  /** Landmark in normalized coords, falling back to face center. */
  point(name) {
    return this.landmarks[name] || this.landmarks.faceCenter;
  }
}
