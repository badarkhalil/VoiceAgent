/**
 * Expression definitions (spec §10).
 *
 * Expressions are additive deltas on top of the neutral rig, scaled by an
 * intensity (0..1) so they blend rather than snap between states.
 */

export const EXPRESSION_TARGETS = {
  neutral:   {},
  friendly:  { smile: 0.30, browLeft: 0.05, browRight: 0.05, eyeOpen: 0.02 },
  happy:     { smile: 0.75, browLeft: 0.10, browRight: 0.10, eyeOpen: -0.15, cheek: 0.35 },
  sad:       { smile: -0.45, browLeft: 0.05, browRight: 0.05, eyeOpen: -0.10, browInnerUp: 0.35 },
  serious:   { smile: -0.10, browLeft: -0.15, browRight: -0.15, eyeOpen: 0.05 },
  surprised: { browLeft: 0.55, browRight: 0.55, eyeOpen: 0.45, mouthOpen: 0.20, smile: 0.05 },
  thinking:  { browLeft: 0.20, browRight: -0.05, eyeOpen: -0.05, smile: 0.05, cheek: 0.10 },
  confused:  { browLeft: 0.35, browRight: -0.10, eyeOpen: 0.10, smile: -0.05 },
};

export const DEFAULT_EXPRESSION = "neutral";

export function expressionTarget(name) {
  return EXPRESSION_TARGETS[name] || EXPRESSION_TARGETS[DEFAULT_EXPRESSION];
}
