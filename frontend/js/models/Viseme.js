/**
 * Viseme definitions (spec §8).
 *
 * Each viseme maps to normalized rig targets (0..1). The renderer never sees
 * "move lips N pixels" — only these semantic parameters (spec §7, §31).
 */

export const VISEME_TARGETS = {
  neutral: { mouthOpen: 0.05, mouthWidth: 0.44, jawOpen: 0.02, lipRound: 0.0, smile: 0.0 },
  closed:  { mouthOpen: 0.00, mouthWidth: 0.30, jawOpen: 0.00, lipRound: 0.05, smile: 0.0 },
  fv:      { mouthOpen: 0.12, mouthWidth: 0.42, jawOpen: 0.05, lipRound: 0.0, smile: 0.0 },
  th:      { mouthOpen: 0.20, mouthWidth: 0.40, jawOpen: 0.10, lipRound: 0.0, smile: 0.0 },
  td:      { mouthOpen: 0.22, mouthWidth: 0.42, jawOpen: 0.12, lipRound: 0.0, smile: 0.0 },
  kg:      { mouthOpen: 0.30, mouthWidth: 0.40, jawOpen: 0.18, lipRound: 0.0, smile: 0.0 },
  s:       { mouthOpen: 0.10, mouthWidth: 0.50, jawOpen: 0.04, lipRound: 0.0, smile: 0.15 },
  sh:      { mouthOpen: 0.18, mouthWidth: 0.36, jawOpen: 0.08, lipRound: 0.25, smile: 0.0 },
  aa:      { mouthOpen: 0.62, mouthWidth: 0.48, jawOpen: 0.40, lipRound: 0.0, smile: 0.0 },
  ae:      { mouthOpen: 0.40, mouthWidth: 0.58, jawOpen: 0.24, lipRound: 0.0, smile: 0.10 },
  eh:      { mouthOpen: 0.34, mouthWidth: 0.56, jawOpen: 0.20, lipRound: 0.0, smile: 0.0 },
  ee:      { mouthOpen: 0.18, mouthWidth: 0.66, jawOpen: 0.10, lipRound: 0.0, smile: 0.20 },
  ah:      { mouthOpen: 0.46, mouthWidth: 0.50, jawOpen: 0.30, lipRound: 0.0, smile: 0.0 },
  oh:      { mouthOpen: 0.52, mouthWidth: 0.34, jawOpen: 0.34, lipRound: 0.45, smile: 0.0 },
  oo:      { mouthOpen: 0.30, mouthWidth: 0.22, jawOpen: 0.18, lipRound: 0.70, smile: 0.0 },
  HH:      { mouthOpen: 0.30, mouthWidth: 0.46, jawOpen: 0.16, lipRound: 0.0, smile: 0.0 },
  L:       { mouthOpen: 0.26, mouthWidth: 0.46, jawOpen: 0.14, lipRound: 0.0, smile: 0.0 },
};

export const DEFAULT_VISEME = "neutral";

export function visemeTarget(name) {
  return VISEME_TARGETS[name] || VISEME_TARGETS[DEFAULT_VISEME];
}

/** Blend two viseme target objects into `out` by alpha. */
export function blendVisemeInto(out, aName, bName, alpha) {
  const a = visemeTarget(aName);
  const b = visemeTarget(bName);
  for (const k of Object.keys(a)) {
    const bv = b[k] !== undefined ? b[k] : a[k];
    out[k] = a[k] + (bv - a[k]) * alpha;
  }
  return out;
}
