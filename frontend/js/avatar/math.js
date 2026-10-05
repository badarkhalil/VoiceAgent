/**
 * Tiny hand-rolled 3x3 matrix helpers (column-major, WebGL convention).
 * No external dependency.
 */

export function mat3Identity() {
  return new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1]);
}

/** Map pixel coordinates (origin top-left) to clip space (-1..1). */
export function mat3Ortho2D(width, height) {
  return new Float32Array([
    2 / width, 0, 0,
    0, -2 / height, 0,
    -1, 1, 1,
  ]);
}

/** Returns a * b (both column-major). */
export function mat3Multiply(a, b) {
  const out = new Float32Array(9);
  for (let c = 0; c < 3; c++) {
    for (let r = 0; r < 3; r++) {
      out[c * 3 + r] =
        a[0 * 3 + r] * b[c * 3 + 0] +
        a[1 * 3 + r] * b[c * 3 + 1] +
        a[2 * 3 + r] * b[c * 3 + 2];
    }
  }
  return out;
}

/** 2D affine transform matrix: scale, rotate (rad), then translate. */
export function mat3FromTransform({ sx = 1, sy = 1, rot = 0, tx = 0, ty = 0 } = {}) {
  const c = Math.cos(rot);
  const s = Math.sin(rot);
  // column-major: col0, col1, col2
  return new Float32Array([
    sx * c, sy * s, 0,
    -sx * s, sy * c, 0,
    tx, ty, 1,
  ]);
}

export function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

export function lerp(a, b, t) {
  return a + (b - a) * t;
}
