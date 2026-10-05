/**
 * Rig: normalized parameters -> per-vertex mesh offsets (spec §7, §15).
 *
 * Every facial parameter is expressed as one or more radially-weighted "lobes"
 * anchored at a named landmark. Because the base mesh and the rig are static,
 * the per-vertex basis for every parameter is precomputed once; each frame the
 * offsets are just a weighted sum of those bases — no allocation, no trig, no
 * square roots in the hot loop.
 *
 * Head pose is a single affine matrix applied in the vertex shader, keeping the
 * 2D-photo approximation (small yaw/pitch/roll) convincing without a 3D model.
 */

import { clamp } from "./math.js";

const FACE_CENTER = "faceCenter";

// direction is in normalized image fractions (x right, y down). radius is the
// compact-support ellipse half-extent, also normalized.
const LOBES = {
  mouthOpen: [
    { lm: "mouthBottom", r: [0.11, 0.060], dir: [0.000, 0.045] },
    { lm: "mouthTop", r: [0.11, 0.050], dir: [0.000, -0.016] },
  ],
  jawOpen: [
    { lm: "chin", r: [0.22, 0.170], dir: [0.000, 0.070] },
    { lm: "jawLeft", r: [0.16, 0.140], dir: [-0.005, 0.050] },
    { lm: "jawRight", r: [0.16, 0.140], dir: [0.005, 0.050] },
    { lm: "mouthBottom", r: [0.12, 0.060], dir: [0.000, 0.022] },
  ],
  mouthWidth: [
    { lm: "mouthLeft", r: [0.09, 0.070], dir: [-0.100, 0.000] },
    { lm: "mouthRight", r: [0.09, 0.070], dir: [0.100, 0.000] },
  ],
  lipRound: [
    { lm: "mouthLeft", r: [0.08, 0.060], dir: [0.020, 0.000] },
    { lm: "mouthRight", r: [0.08, 0.060], dir: [-0.020, 0.000] },
    { lm: "mouthTop", r: [0.09, 0.050], dir: [0.000, -0.006] },
    { lm: "mouthBottom", r: [0.09, 0.050], dir: [0.000, 0.006] },
  ],
  smile: [
    { lm: "mouthLeft", r: [0.10, 0.080], dir: [-0.014, -0.024] },
    { lm: "mouthRight", r: [0.10, 0.080], dir: [0.014, -0.024] },
    { lm: "leftCheek", r: [0.10, 0.090], dir: [-0.006, -0.012] },
    { lm: "rightCheek", r: [0.10, 0.090], dir: [0.006, -0.012] },
  ],
  cheek: [
    { lm: "leftCheek", r: [0.12, 0.100], dir: [-0.010, -0.016] },
    { lm: "rightCheek", r: [0.12, 0.100], dir: [0.010, -0.016] },
  ],
  browLeft: [{ lm: "leftBrow", r: [0.10, 0.050], dir: [0.000, -0.028] }],
  browRight: [{ lm: "rightBrow", r: [0.10, 0.050], dir: [0.000, -0.028] }],
  browInnerUp: [
    { lm: "leftBrowInner", r: [0.07, 0.050], dir: [0.000, -0.022] },
    { lm: "rightBrowInner", r: [0.07, 0.050], dir: [0.000, -0.022] },
  ],
  eyeBlinkLeft: [
    { lm: "leftEyeTop", r: [0.055, 0.035], dir: [0.000, 0.020] },
    { lm: "leftEyeBottom", r: [0.055, 0.030], dir: [0.000, -0.006] },
  ],
  eyeBlinkRight: [
    { lm: "rightEyeTop", r: [0.055, 0.035], dir: [0.000, 0.020] },
    { lm: "rightEyeBottom", r: [0.055, 0.030], dir: [0.000, -0.006] },
  ],
  eyeOpen: [
    { lm: "leftEyeTop", r: [0.050, 0.035], dir: [0.000, -0.008] },
    { lm: "rightEyeTop", r: [0.050, 0.035], dir: [0.000, -0.008] },
    { lm: "leftEyeBottom", r: [0.050, 0.030], dir: [0.000, 0.008] },
    { lm: "rightEyeBottom", r: [0.050, 0.030], dir: [0.000, 0.008] },
  ],
};

// mouthWidth is authored around a relaxed baseline; the rig needs the delta.
const MOUTH_WIDTH_BASELINE = 0.44;

// The lobe geometry above is authored for a face that fills a portrait frame.
// prepare.html's DEFAULT landmarks define that reference face: interocular
// (eye-to-eye) = 0.162 and face height (brow->chin) = 0.471 of the image. A
// wide photo with a small face (e.g. a landscape shot) would otherwise apply
// portrait-sized lobes to a tiny face, smearing motion across the jaw and
// torso. So every lobe radius and offset is scaled by the actual face size;
// for a face-filling portrait the scale is ~1 and nothing changes.
const REF_INTEROCULAR = 0.162;
const REF_FACE_HEIGHT = 0.471;

export class AvatarRig {
  constructor(rigDefinition, mesh) {
    this.rig = rigDefinition;
    this.mesh = mesh;
    this.facialParams = Object.keys(LOBES);
    this._basis = {};
    this._faceScale = this._computeFaceScale();
    this._buildBasis();
  }

  /** Per-axis face size relative to the reference portrait (clamped). */
  _computeFaceScale() {
    const lm = this.rig.landmarks;
    const get = (n) => lm[n] || lm[FACE_CENTER];
    const eyeSpan = Math.abs(get("rightEye")[0] - get("leftEye")[0]);
    const browY = (get("leftBrow")[1] + get("rightBrow")[1]) / 2;
    const faceH = Math.abs(get("chin")[1] - browY);
    const sx = eyeSpan > 1e-4 ? eyeSpan / REF_INTEROCULAR : 1;
    const sy = faceH > 1e-4 ? faceH / REF_FACE_HEIGHT : 1;
    return { sx: clamp(sx, 0.15, 3), sy: clamp(sy, 0.15, 3) };
  }

  _buildBasis() {
    const lm = this.rig.landmarks;
    const W = this.mesh.width;
    const H = this.mesh.height;
    const count = this.mesh.count;
    const { sx, sy } = this._faceScale;

    for (const param of this.facialParams) {
      const basis = new Float32Array(count * 2);
      for (const lobe of LOBES[param]) {
        const center = lm[lobe.lm] || lm[FACE_CENTER];
        const cx = center[0] * W;
        const cy = center[1] * H;
        const rx = Math.max(lobe.r[0] * sx * W, 1e-3);
        const ry = Math.max(lobe.r[1] * sy * H, 1e-3);
        const dirX = lobe.dir[0] * sx * W;
        const dirY = lobe.dir[1] * sy * H;

        const base = this.mesh.base;
        for (let i = 0; i < count; i++) {
          const dx = (base[i * 2] - cx) / rx;
          const dy = (base[i * 2 + 1] - cy) / ry;
          let w = 1 - dx * dx - dy * dy; // compact-support bump
          if (w <= 0) continue;
          w = w * w * (3 - 2 * w); // smoothstep for a softer edge
          basis[i * 2] += dirX * w;
          basis[i * 2 + 1] += dirY * w;
        }
      }
      this._basis[param] = basis;
    }
  }

  /** Signed multiplier converting a frame value to lobe strength. */
  _scale(param, value) {
    if (param === "mouthWidth") return value - MOUTH_WIDTH_BASELINE;
    return value;
  }

  /**
   * Fold `frame` into the mesh's offset buffer and commit it.
   * Returns nothing; the mesh is left dirty for the renderer to upload.
   */
  apply(frame) {
    const off = this.mesh.offsets;
    for (const param of this.facialParams) {
      const m = this._scale(param, frame[param]);
      if (m === 0) continue;
      const basis = this._basis[param];
      for (let i = 0; i < off.length; i++) off[i] += basis[i] * m;
    }
    this.mesh.commit();
  }

  /** Head-pose affine (pixel space), applied on top of facial deformation. */
  headMatrix(frame) {
    const W = this.mesh.width;
    const H = this.mesh.height;
    const center = this.rig.point(FACE_CENTER);
    const cx = center[0] * W;
    const cy = center[1] * H;

    const yaw = frame.headYaw * Math.PI / 180;
    const pitch = frame.headPitch * Math.PI / 180;
    const roll = frame.headRoll * Math.PI / 180;

    const tx = -Math.sin(yaw) * 0.18 * W + frame.headX * 0.03 * W;
    const ty = -Math.sin(pitch) * 0.10 * H + frame.headY * 0.03 * H;
    const sx = clamp(1 - 0.06 * Math.sin(yaw) * Math.sin(yaw), 0.85, 1.15);
    const sy = clamp(1 - 0.06 * Math.sin(pitch) * Math.sin(pitch), 0.85, 1.15);
    const theta = -roll;

    const c = Math.cos(theta);
    const s = Math.sin(theta);
    const a00 = sx * c;
    const a01 = -sy * s;
    const a10 = sx * s;
    const a11 = sy * c;

    const m02 = cx + tx - (a00 * cx + a01 * cy);
    const m12 = cy + ty - (a10 * cx + a11 * cy);

    // column-major 3x3
    return new Float32Array([a00, a10, 0, a01, a11, 0, m02, m12, 1]);
  }
}
