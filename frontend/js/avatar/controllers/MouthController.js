/**
 * Composes viseme mouth targets into the frame.
 * When no timeline is active it returns to a relaxed neutral mouth.
 */

import { blendVisemeInto } from "../../models/Viseme.js";

export class MouthController {
  compose(frame, timeline, t) {
    if (timeline) {
      timeline.sampleMouthInto(frame, t);
    } else {
      // Relaxed neutral mouth when nothing is being spoken.
      blendVisemeInto(frame, "neutral", "neutral", 0);
    }
    return frame;
  }
}
