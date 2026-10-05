/**
 * Applies the active expression as additive, intensity-scaled rig deltas.
 * Keeps a low-level friendly base so the resting face is never flat (spec §10).
 */

import { expressionTarget } from "../../models/Expression.js";

export class ExpressionController {
  compose(frame, timeline, t, idleExpression = "friendly", idleIntensity = 0.25) {
    const active = timeline ? timeline.expressionAt(t) : null;
    if (active) {
      frame.applyExpression(expressionTarget(active.type), active.intensity ?? 0.25);
    } else {
      frame.applyExpression(expressionTarget(idleExpression), idleIntensity);
    }
    return frame;
  }
}
