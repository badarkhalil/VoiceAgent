/**
 * Canvas2D fallback renderer (spec §15, §23).
 *
 * Same interface as AvatarRenderer, but maps the mesh with piecewise-affine
 * triangle texture warping instead of WebGL. It is slower (~1 drawImage per
 * triangle) but works on any device with no GPU/WebGL, and shares the exact
 * mesh, rig and layer definitions so the two renderers stay visually aligned.
 */

export class CanvasRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.mesh = null;
    this.layers = [];
    this._screen = null;       // per-vertex canvas-space positions
    this._triSrcX = null;      // flat source (image-space) triangles
    this._triSrcY = null;
    this._triIdx = null;       // vertex indices per triangle
    this._off = null;
    this._offCtx = null;
  }

  init(mesh) {
    if (!this.ctx) return false;
    this.mesh = mesh;
    this._screen = new Float32Array(mesh.count * 2);

    const idx = mesh.indices;
    const triCount = idx.length / 3;
    this._triIdx = new Uint16Array(idx);       // triangle vertex ids
    this._triSrcX = new Float32Array(triCount * 3);
    this._triSrcY = new Float32Array(triCount * 3);
    for (let t = 0; t < triCount; t++) {
      for (let k = 0; k < 3; k++) {
        const vi = idx[t * 3 + k];
        this._triSrcX[t * 3 + k] = mesh.base[vi * 2];
        this._triSrcY[t * 3 + k] = mesh.base[vi * 2 + 1];
      }
    }
    return true;
  }

  /** In Canvas2D a "texture" is just the source image. */
  createTexture(image) {
    return image || null;
  }

  setLayers(layers) {
    this.layers = layers;
  }

  resize(dpr) {
    const w = Math.max(1, Math.round(this.canvas.clientWidth * dpr));
    const h = Math.max(1, Math.round(this.canvas.clientHeight * dpr));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
      this._off = null; // invalidate offscreen
    }
  }

  _fitParams() {
    const cw = this.canvas.width;
    const ch = this.canvas.height;
    const iw = this.mesh.width;
    const ih = this.mesh.height;
    const scale = Math.max(cw / iw, ch / ih);
    return { scale, offX: (cw - iw * scale) / 2, offY: (ch - ih * scale) / 2 };
  }

  _project(head) {
    const pos = this.mesh.positions;
    const out = this._screen;
    const { scale, offX, offY } = this._fitParams();
    for (let i = 0; i < this.mesh.count; i++) {
      const x = pos[i * 2];
      const y = pos[i * 2 + 1];
      // head is a column-major 3x3 affine on image pixels
      const hx = head[0] * x + head[3] * y + head[6];
      const hy = head[1] * x + head[4] * y + head[7];
      out[i * 2] = hx * scale + offX;
      out[i * 2 + 1] = hy * scale + offY;
    }
    return out;
  }

  draw(headMatrix) {
    const ctx = this.ctx;
    if (!ctx) return;
    const screen = this._project(headMatrix);
    const W = this.canvas.width;
    const H = this.canvas.height;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, W, H);

    for (const entry of this.layers) {
      const { layer, texture: image, mask } = entry;
      if (!image) continue;

      if (!layer.deformed) {
        // Static behind-layer: fit to the canvas.
        const { scale, offX, offY } = this._fitParams();
        ctx.drawImage(image, offX, offY, this.mesh.width * scale, this.mesh.height * scale);
        continue;
      }

      if (mask) {
        const off = this._ensureOffscreen(W, H);
        this._warp(this._offCtx, image, screen);
        this._offCtx.globalCompositeOperation = "destination-in";
        this._warp(this._offCtx, mask, screen);
        this._offCtx.globalCompositeOperation = "source-over";
        ctx.drawImage(this._off, 0, 0);
      } else {
        this._warp(ctx, image, screen);
      }
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }

  _ensureOffscreen(W, H) {
    if (!this._off || this._off.width !== W || this._off.height !== H) {
      this._off = document.createElement("canvas");
      this._off.width = W;
      this._off.height = H;
      this._offCtx = this._off.getContext("2d");
    }
    this._offCtx.setTransform(1, 0, 0, 1, 0, 0);
    this._offCtx.clearRect(0, 0, W, H);
    return this._off;
  }

  _warp(ctx, image, screen) {
    const n = this._triIdx.length / 3;
    const sx = this._triSrcX;
    const sy = this._triSrcY;
    const ids = this._triIdx;

    for (let t = 0; t < n; t++) {
      const i0 = ids[t * 3] * 2;
      const i1 = ids[t * 3 + 1] * 2;
      const i2 = ids[t * 3 + 2] * 2;
      const d = [
        screen[i0], screen[i0 + 1],
        screen[i1], screen[i1 + 1],
        screen[i2], screen[i2 + 1],
      ];
      const s = [sx[t * 3], sy[t * 3], sx[t * 3 + 1], sy[t * 3 + 1], sx[t * 3 + 2], sy[t * 3 + 2]];
      const m = affine(s, d);
      if (!m) continue;

      ctx.save();
      // Slightly inflate the clip to hide hairline seams between triangles.
      ctx.beginPath();
      const cx = (d[0] + d[2] + d[4]) / 3;
      const cy = (d[1] + d[3] + d[5]) / 3;
      const grow = 1.02;
      ctx.moveTo(cx + (d[0] - cx) * grow, cy + (d[1] - cy) * grow);
      ctx.lineTo(cx + (d[2] - cx) * grow, cy + (d[3] - cy) * grow);
      ctx.lineTo(cx + (d[4] - cx) * grow, cy + (d[5] - cy) * grow);
      ctx.closePath();
      ctx.clip();
      ctx.setTransform(m[0], m[1], m[2], m[3], m[4], m[5]);
      ctx.drawImage(image, 0, 0);
      ctx.restore();
    }
  }

  isGL() { return false; }

  dispose() {
    this.layers = [];
    this.mesh = null;
    this._off = null;
    this._offCtx = null;
  }
}

/** Affine matrix mapping three source points to three destination points. */
function affine(s, d) {
  const [x0, y0, x1, y1, x2, y2] = s;
  const [u0, v0, u1, v1, u2, v2] = d;
  const den = x0 * (y1 - y2) - x1 * (y0 - y2) + x2 * (y0 - y1);
  if (Math.abs(den) < 1e-9) return null;
  const a = (u0 * (y1 - y2) + u1 * (y2 - y0) + u2 * (y0 - y1)) / den;
  const b = (v0 * (y1 - y2) + v1 * (y2 - y0) + v2 * (y0 - y1)) / den;
  const c = (u0 * (x2 - x1) + u1 * (x0 - x2) + u2 * (x1 - x0)) / den;
  const dd = (v0 * (x2 - x1) + v1 * (x0 - x2) + v2 * (x1 - x0)) / den;
  const e = (u0 * (x1 * y2 - x2 * y1) + u1 * (x2 * y0 - x0 * y2) + u2 * (x0 * y1 - x1 * y0)) / den;
  const f = (v0 * (x1 * y2 - x2 * y1) + v1 * (x2 * y0 - x0 * y2) + v2 * (x0 * y1 - x1 * y0)) / den;
  return [a, b, c, dd, e, f];
}
