/**
 * WebGL renderer: layered draw of a deformed photo (spec §2.3, §15, §26).
 *
 * One shader, one draw call per layer, one bufferSubData per frame. Facial
 * deformation happens on the CPU (AvatarRig -> mesh positions); head pose is a
 * single mat3 uniform so the whole face rotates/shears for free.
 *
 * Layer order (back to front): innerMouth -> teeth -> face. The face layer
 * multiplies its alpha by the mouth mask, so as the lip ring deforms apart the
 * layers behind are revealed.
 */

import { mat3Ortho2D, mat3Multiply } from "./math.js";

const VERT = `
attribute vec2 aPos;
attribute vec2 aUV;
uniform mat3 uMVP;
varying vec2 vUV;
void main() {
  // UVs are already image-space (v=0 at the top); with UNPACK_FLIP_Y off the
  // texture's t=0 row is the image top, so no flip is needed here.
  vUV = aUV;
  vec3 p = uMVP * vec3(aPos, 1.0);
  gl_Position = vec4(p.xy, 0.0, 1.0);
}
`;

const FRAG = `
precision highp float;
uniform sampler2D uTexture;
uniform sampler2D uMask;
uniform float uUseMask;
uniform float uOpacity;
varying vec2 vUV;
void main() {
  vec4 c = texture2D(uTexture, vUV);
  if (uUseMask > 0.5) c.a *= texture2D(uMask, vUV).r;
  gl_FragColor = vec4(c.rgb, c.a * uOpacity);
}
`;

export class AvatarRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.gl = null;
    this.program = null;
    this.loc = {};
    this.mesh = null;
    this.layers = [];      // { key, layer, texture }
    this._posBuf = null;
    this._uvBuf = null;
    this._idxBuf = null;
    this._quadPos = null;
    this._quadUV = null;
    this._quadIdx = null;
    this._dpr = 1;
  }

  init(mesh) {
    const gl = this.canvas.getContext("webgl2", { premultipliedAlpha: false, alpha: true })
      || this.canvas.getContext("webgl", { premultipliedAlpha: false, alpha: true });
    if (!gl) return false;
    this.gl = gl;
    this.mesh = mesh;

    const vs = this._shader(gl.VERTEX_SHADER, VERT);
    const fs = this._shader(gl.FRAGMENT_SHADER, FRAG);
    if (!vs || !fs) return false;
    const program = gl.createProgram();
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      console.error("Avatar program link failed:", gl.getProgramInfoLog(program));
      return false;
    }
    this.program = program;
    gl.useProgram(program);

    this.loc = {
      aPos: gl.getAttribLocation(program, "aPos"),
      aUV: gl.getAttribLocation(program, "aUV"),
      uMVP: gl.getUniformLocation(program, "uMVP"),
      uTexture: gl.getUniformLocation(program, "uTexture"),
      uMask: gl.getUniformLocation(program, "uMask"),
      uUseMask: gl.getUniformLocation(program, "uUseMask"),
      uOpacity: gl.getUniformLocation(program, "uOpacity"),
    };

    // Mesh (deformed face) buffers.
    this._posBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this._posBuf);
    gl.bufferData(gl.ARRAY_BUFFER, mesh.positions, gl.DYNAMIC_DRAW);
    this._uvBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this._uvBuf);
    gl.bufferData(gl.ARRAY_BUFFER, mesh.uv, gl.STATIC_DRAW);
    this._idxBuf = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this._idxBuf);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, mesh.indices, gl.STATIC_DRAW);

    // Full-image quad (undeformed layers).
    const W = mesh.width;
    const H = mesh.height;
    this._quadPos = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this._quadPos);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, W, 0, 0, H, W, H]), gl.STATIC_DRAW);
    this._quadUV = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this._quadUV);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);
    this._quadIdx = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this._quadIdx);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array([0, 1, 2, 2, 1, 3]), gl.STATIC_DRAW);

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.clearColor(0, 0, 0, 0);
    return true;
  }

  _shader(type, src) {
    const gl = this.gl;
    const sh = gl.createShader(type);
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
      console.error("Avatar shader compile failed:", gl.getShaderInfoLog(sh));
      return null;
    }
    return sh;
  }

  /** Create a texture from an image; returns null on failure. */
  createTexture(image) {
    const gl = this.gl;
    if (!image) return null;
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 0);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
    return tex;
  }

  setLayers(layers) {
    this.layers = layers;
  }

  /** Resize the drawing buffer to match CSS size at the given DPR. */
  resize(dpr) {
    const gl = this.gl;
    const w = Math.max(1, Math.round(this.canvas.clientWidth * dpr));
    const h = Math.max(1, Math.round(this.canvas.clientHeight * dpr));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    this._dpr = dpr;
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
  }

  _fitMatrix(imgW, imgH) {
    const cw = this.canvas.width;
    const ch = this.canvas.height;
    const scale = Math.max(cw / imgW, ch / imgH); // cover
    const offX = (cw - imgW * scale) / 2;
    const offY = (ch - imgH * scale) / 2;
    return new Float32Array([scale, 0, 0, 0, scale, 0, offX, offY, 1]);
  }

  _bindMesh() {
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, this._posBuf);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.mesh.positions);
    gl.enableVertexAttribArray(this.loc.aPos);
    gl.vertexAttribPointer(this.loc.aPos, 2, gl.FLOAT, false, 0, 0);

    gl.bindBuffer(gl.ARRAY_BUFFER, this._uvBuf);
    gl.enableVertexAttribArray(this.loc.aUV);
    gl.vertexAttribPointer(this.loc.aUV, 2, gl.FLOAT, false, 0, 0);

    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this._idxBuf);
  }

  _bindQuad() {
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, this._quadPos);
    gl.enableVertexAttribArray(this.loc.aPos);
    gl.vertexAttribPointer(this.loc.aPos, 2, gl.FLOAT, false, 0, 0);

    gl.bindBuffer(gl.ARRAY_BUFFER, this._quadUV);
    gl.enableVertexAttribArray(this.loc.aUV);
    gl.vertexAttribPointer(this.loc.aUV, 2, gl.FLOAT, false, 0, 0);

    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this._quadIdx);
  }

  draw(headMatrix) {
    const gl = this.gl;
    if (!gl || !this.program) return;

    this._bindMesh();
    const projection = mat3Ortho2D(this.canvas.width, this.canvas.height);
    const fit = this._fitMatrix(this.mesh.width, this.mesh.height);
    const model = mat3Multiply(fit, headMatrix);
    const mvp = mat3Multiply(projection, model);

    gl.useProgram(this.program);
    gl.uniformMatrix3fv(this.loc.uMVP, false, mvp);

    gl.clear(gl.COLOR_BUFFER_BIT);

    for (const entry of this.layers) {
      const { layer, texture, mask } = entry;
      if (!texture) continue;

      if (layer.deformed) this._bindMesh();
      else this._bindQuad();

      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.uniform1i(this.loc.uTexture, 0);

      if (mask) {
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, mask);
        gl.uniform1i(this.loc.uMask, 1);
        gl.uniform1f(this.loc.uUseMask, 1);
      } else {
        gl.uniform1f(this.loc.uUseMask, 0);
      }

      gl.uniform1f(this.loc.uOpacity, layer.opacity != null ? layer.opacity : 1);

      const count = layer.deformed ? this.mesh.indices.length : 6;
      gl.drawElements(gl.TRIANGLES, count, gl.UNSIGNED_SHORT, 0);
    }
  }

  isGL() {
    return !!this.gl;
  }

  dispose() {
    const gl = this.gl;
    if (!gl) return;
    for (const e of this.layers) {
      if (e.texture) gl.deleteTexture(e.texture);
      if (e.mask) gl.deleteTexture(e.mask);
    }
    this.layers = [];
    for (const b of [this._posBuf, this._uvBuf, this._idxBuf, this._quadPos, this._quadUV, this._quadIdx]) {
      if (b) gl.deleteBuffer(b);
    }
    if (this.program) gl.deleteProgram(this.program);
    this.program = null;
  }
}
