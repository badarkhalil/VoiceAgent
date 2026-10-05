/**
 * Small easing / interpolation helpers shared by timelines and controllers.
 */

export function clamp01(v) {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

export function smoothstep(t) {
  const x = clamp01(t);
  return x * x * (3 - 2 * x);
}

export function easeInOutCubic(t) {
  const x = clamp01(t);
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
}

export function lerp(a, b, t) {
  return a + (b - a) * t;
}

/**
 * Frame-rate independent exponential smoothing.
 * `halfLife` in seconds: fraction of the gap remaining after halfLife is 0.5.
 */
export function damp(current, target, halfLife, dt) {
  if (halfLife <= 0) return target;
  const t = 1 - Math.pow(0.5, dt / halfLife);
  return current + (target - current) * t;
}

/** Sample a list of keyframes (each with `time` + numeric fields) at time t. */
export function sampleKeyframes(keys, t, fields) {
  if (!keys || keys.length === 0) return null;
  if (t <= keys[0].time) return keys[0];
  if (t >= keys[keys.length - 1].time) return keys[keys.length - 1];

  for (let i = 0; i < keys.length - 1; i++) {
    const a = keys[i];
    const b = keys[i + 1];
    if (t >= a.time && t <= b.time) {
      const span = b.time - a.time || 1e-6;
      const u = smoothstep((t - a.time) / span);
      const out = { time: t };
      for (const f of fields) out[f] = lerp(a[f] ?? 0, b[f] ?? 0, u);
      return out;
    }
  }
  return keys[keys.length - 1];
}
