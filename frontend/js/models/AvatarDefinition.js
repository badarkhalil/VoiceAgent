/**
 * Avatar definition: which images to draw, in what order, and mesh density.
 *
 * Loaded from `avatars/<id>/avatar.json`. Layering follows spec §2.4:
 * innerMouth (back) -> teeth -> face (front, with a baked mouth-interior
 * alpha mask). Missing optional layers are simply skipped.
 */

const DEFAULT_LAYOUT = {
  mesh: { cols: 32, rows: 32 },
  photo: "photo.jpg",
  placeholder: "placeholder.svg",
  innerMouth: "innerMouth.png",
  teeth: "teeth.png",
  mouthMask: "mouthMask.png",
  expressions: { default: "friendly", idleIntensity: 0.25 },
};

export class AvatarDefinition {
  constructor(id, data = {}) {
    this.id = id;
    this.name = data.name || "Azure";
    const merged = Object.assign({}, DEFAULT_LAYOUT, data);
    this.mesh = Object.assign({ cols: 32, rows: 32 }, data.mesh || {});
    this.photo = merged.photo;
    this.placeholder = merged.placeholder;
    this.innerMouth = merged.innerMouth;
    this.teeth = merged.teeth;
    this.mouthMask = merged.mouthMask;
    this.expressions = merged.expressions;
    this.basePath = data.basePath || "";
  }

  /** Layer draw order, back to front. `image` is a key resolved by the loader. */
  layers() {
    const out = [];
    if (this.innerMouth) out.push({ key: "innerMouth", deformed: false });
    if (this.teeth) out.push({ key: "teeth", deformed: false });
    out.push({ key: "photo", deformed: true, mask: this.mouthMask ? "mouthMask" : null });
    return out;
  }
}
