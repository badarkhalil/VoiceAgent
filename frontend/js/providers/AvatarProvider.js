/**
 * Loads an avatar definition, its rig, and its images.
 *
 * All heavy authoring (landmark detection, mask generation) happens offline in
 * prepare.html and is committed as rig.json + PNGs, so at runtime this is just
 * a couple of fetches and image decodes — no MediaPipe, no model download.
 */

import { AvatarDefinition } from "../models/AvatarDefinition.js";
import { AvatarRigDefinition } from "../models/AvatarRigDefinition.js";

async function fetchJSON(url) {
  const res = await fetch(url, { cache: "no-cache" });
  if (!res.ok) throw new Error(`Failed to load ${url}: ${res.status}`);
  return res.json();
}

function loadImage(url) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

export class AvatarProvider {
  constructor(basePath = "/avatars") {
    this.basePath = basePath.replace(/\/$/, "");
  }

  async load(avatarId) {
    const dir = `${this.basePath}/${avatarId}`;

    const avatarJson = await fetchJSON(`${dir}/avatar.json`);
    const definition = new AvatarDefinition(avatarId, avatarJson);

    let rigDefinition;
    try {
      const rigJson = await fetchJSON(`${dir}/rig.json`);
      rigDefinition = new AvatarRigDefinition(rigJson);
    } catch {
      // Hand-authored fallback: default landmarks are good enough to animate.
      rigDefinition = new AvatarRigDefinition({});
    }

    const keys = ["photo", "innerMouth", "teeth", "mouthMask"];
    const images = {};
    await Promise.all(keys.map(async (k) => {
      const file = definition[k];
      images[k] = file ? await loadImage(`${dir}/${file}`) : null;
    }));

    // If the user hasn't dropped in their photo yet, fall back to the bundled
    // placeholder so the engine still runs end-to-end.
    if (!images.photo && definition.placeholder) {
      images.photo = await loadImage(`${dir}/${definition.placeholder}`);
      // Placeholder has no mouth mask; the face layer stays opaque.
      images.mouthMask = null;
    }

    if (!images.photo) throw new Error(`Avatar ${avatarId}: photo failed to load`);

    return { definition, rigDefinition, images, dir };
  }
}
