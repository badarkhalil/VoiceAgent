/**
 * Triangulated grid mesh over the face image.
 *
 * Base positions and UVs are uploaded once; per frame we only write the
 * preallocated `positions`/`offsets` buffers and do a single bufferSubData
 * (spec §15, §26).
 */

export class AvatarMesh {
  constructor(cols, rows, width, height) {
    this.cols = cols;
    this.rows = rows;
    this.width = width;
    this.height = height;

    const vw = cols + 1;
    const vh = rows + 1;
    this.count = vw * vh;

    this.base = new Float32Array(this.count * 2);
    this.uv = new Float32Array(this.count * 2);
    this.offsets = new Float32Array(this.count * 2);
    this.positions = new Float32Array(this.count * 2);

    let p = 0;
    for (let r = 0; r < vh; r++) {
      for (let c = 0; c < vw; c++) {
        const u = c / cols;
        const v = r / rows;
        this.base[p] = u * width;
        this.base[p + 1] = v * height;
        this.uv[p] = u;
        this.uv[p + 1] = v;
        p += 2;
      }
    }

    this.indices = new Uint16Array(cols * rows * 6);
    let i = 0;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const a = r * vw + c;
        const b = a + 1;
        const d = a + vw;
        const e = d + 1;
        this.indices[i++] = a;
        this.indices[i++] = d;
        this.indices[i++] = b;
        this.indices[i++] = b;
        this.indices[i++] = d;
        this.indices[i++] = e;
      }
    }

    this.dirty = true;
  }

  /** Fold base + offsets into the positions buffer. */
  commit() {
    const n = this.count * 2;
    const base = this.base;
    const off = this.offsets;
    const pos = this.positions;
    for (let i = 0; i < n; i++) pos[i] = base[i] + off[i];
    this.offsets.fill(0);
    this.dirty = true;
  }
}
