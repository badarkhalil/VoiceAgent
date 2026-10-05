/**
 * The single animation loop (spec §16, §17, §26).
 *
 * Audio is the clock: every frame we ask the AudioPlayer where it is
 * (`getClock()` -> { sentenceIndex, time }), look up that sentence's timeline,
 * sample it, and compose a target rig frame. Controllers only ever write into
 * a *target*; the runtime then damps the *current* frame toward it, so nothing
 * snaps. The whole loop allocates nothing per frame.
 */

import { AvatarProvider } from "../providers/AvatarProvider.js";
import { AvatarMesh } from "./AvatarMesh.js";
import { AvatarRig } from "./AvatarRig.js";
import { AvatarRenderer } from "./AvatarRenderer.js";
import { CanvasRenderer } from "./CanvasRenderer.js";
import { AnimationTimeline } from "./AnimationTimeline.js";
import { AnimationFrame, RIG_PARAMS } from "../models/AnimationFrame.js";
import { damp } from "../animation/AnimationInterpolator.js";
import { DebugOverlay } from "../debug/DebugOverlay.js";

import { MouthController } from "./controllers/MouthController.js";
import { ExpressionController } from "./controllers/ExpressionController.js";
import { EyebrowController } from "./controllers/EyebrowController.js";
import { HeadController } from "./controllers/HeadController.js";
import { BlinkController } from "./controllers/BlinkController.js";
import { EyeController } from "./controllers/EyeController.js";
import { LipSyncController } from "./controllers/LipSyncController.js";

// Per-parameter smoothing half-life (seconds). Mouth is snappy; head drifts.
const HALF_LIFE = {
  mouthOpen: 0.035, mouthWidth: 0.050, jawOpen: 0.045, lipRound: 0.050,
  smile: 0.090, cheek: 0.100,
  browLeft: 0.080, browRight: 0.080, browInnerUp: 0.080,
  eyeBlinkLeft: 0.020, eyeBlinkRight: 0.020, eyeOpen: 0.120,
  headYaw: 0.140, headPitch: 0.140, headRoll: 0.160, headX: 0.160, headY: 0.160,
};

export class AvatarRuntime {
  constructor({ canvas, avatarId = "azure", getClock, getAnalyzer, debug = false, basePath = "/avatars" } = {}) {
    this.canvas = canvas;
    this.avatarId = avatarId;
    this.getClock = getClock || (() => null);
    this.getAnalyzer = getAnalyzer || (() => null);
    this.debug = debug;
    this.basePath = basePath;

    this.provider = new AvatarProvider(basePath);
    this.renderer = null;
    this.backend = null;
    this.overlay = null;

    this.mesh = null;
    this.rig = null;
    this.definition = null;

    this.target = new AnimationFrame();
    this.current = new AnimationFrame();

    this.timelines = new Map(); // sentenceIndex -> AnimationTimeline
    this._order = [];

    this.mouth = new MouthController();
    this.expression = new ExpressionController();
    this.eyebrow = new EyebrowController();
    this.head = new HeadController();
    this.blink = new BlinkController();
    this.eye = new EyeController();
    this.lipSync = new LipSyncController(null);

    this._raf = null;
    this._last = 0;
    this._fps = 0;
    this._fpsAccum = 0;
    this._fpsFrames = 0;
    this._running = false;
    this._debugState = {};
    this._tick = this._tick.bind(this);
  }

  async init() {
    const loaded = await this.provider.load(this.avatarId);
    this.definition = loaded.definition;
    this.images = loaded.images;

    const { cols, rows } = this.definition.mesh;
    const photo = loaded.images.photo;
    const W = photo.naturalWidth || photo.width;
    const H = photo.naturalHeight || photo.height;

    this.mesh = new AvatarMesh(cols, rows, W, H);
    this.rig = new AvatarRig(loaded.rigDefinition, this.mesh);

    // Prefer WebGL; fall back to the Canvas2D triangle warp (spec §15, §23).
    const glRenderer = new AvatarRenderer(this.canvas);
    if (glRenderer.init(this.mesh)) {
      this.renderer = glRenderer;
      this.backend = "webgl";
    } else {
      const cRenderer = new CanvasRenderer(this.canvas);
      if (!cRenderer.init(this.mesh)) throw new Error("no renderer available");
      this.renderer = cRenderer;
      this.backend = "canvas2d";
    }

    // Build render layers (back to front); textures that failed to load are dropped.
    const layers = [];
    for (const spec of this.definition.layers()) {
      const texture = this.renderer.createTexture(this.images[spec.key]);
      if (!texture) continue;
      const mask = spec.mask ? this.renderer.createTexture(this.images[spec.mask]) : null;
      layers.push({ layer: spec, texture, mask });
    }
    if (!layers.length) throw new Error("no renderable layers");
    this.renderer.setLayers(layers);

    this.lipSync.analyzer = this.getAnalyzer();
    this.overlay = new DebugOverlay(this.canvas.parentElement || document.body);
    this.overlay.setVisible(this.debug);

    return true;
  }

  start() {
    if (this._running) return;
    this._running = true;
    this._last = performance.now();
    this._raf = requestAnimationFrame(this._tick);
  }

  stop() {
    this._running = false;
    if (this._raf) cancelAnimationFrame(this._raf);
    this._raf = null;
  }

  /** Register a server timeline payload for a sentence. */
  attachTimeline(msg) {
    if (!msg) return;
    const tl = new AnimationTimeline(msg);
    const idx = tl.sentenceIndex;
    if (!this.timelines.has(idx)) this._order.push(idx);
    this.timelines.set(idx, tl);

    // Bound memory: drop oldest beyond a small window.
    while (this._order.length > 12) {
      const old = this._order.shift();
      if (old !== idx) this.timelines.delete(old);
    }
  }

  _timelineFor(sentenceIndex) {
    if (sentenceIndex === null || sentenceIndex === undefined) return null;
    return this.timelines.get(sentenceIndex) || null;
  }

  _visemeNameAt(timeline, t) {
    if (!timeline) return "neutral";
    const spans = timeline.visemes.spans;
    let name = "neutral";
    for (const s of spans) {
      if (t >= s.start && t <= s.end) { name = s.value; break; }
      if (t > s.end) name = s.value;
    }
    return name;
  }

  _tick(now) {
    if (!this._running) return;
    this._raf = requestAnimationFrame(this._tick);

    let dt = (now - this._last) / 1000;
    this._last = now;
    if (dt > 0.1) dt = 0.1; // tab was hidden; don't over-damp
    if (dt < 0) dt = 0;

    // FPS sample.
    this._fpsAccum += dt;
    this._fpsFrames++;
    if (this._fpsAccum >= 0.5) {
      this._fps = this._fpsFrames / this._fpsAccum;
      this._fpsAccum = 0;
      this._fpsFrames = 0;
    }

    const clock = this.getClock();
    const timeline = clock ? this._timelineFor(clock.sentenceIndex) : null;
    const t = clock ? clock.time : 0;

    // Compose target (order matters; mouth writes, expression is additive).
    const target = this.target.reset();
    this.mouth.compose(target, timeline, t);
    this.expression.compose(
      target, timeline, t,
      this.definition.expressions.default,
      this.definition.expressions.idleIntensity,
    );
    this.eyebrow.compose(target);
    this.head.compose(target, timeline, t, dt);
    this.blink.compose(target, timeline, t, dt);
    this.eye.compose(target, dt);
    this.lipSync.compose(target);

    // Damp current -> target per parameter.
    for (const k of RIG_PARAMS) {
      this.current[k] = damp(this.current[k], target[k], HALF_LIFE[k] || 0.1, dt);
    }

    // Deform + draw.
    this.rig.apply(this.current);
    const head = this.rig.headMatrix(this.current);
    this.renderer.resize(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.draw(head);

    if (this.debug && this.overlay) {
      this._debugState = this._buildDebugState(t, timeline);
      this.overlay.update(this._debugState, now);
    }
  }

  _buildDebugState(t, timeline) {
    const c = this.current;
    const exp = timeline ? timeline.expressionAt(t) : null;
    return {
      fps: this._fps,
      audioTime: timeline ? t : null,
      sentenceIndex: timeline ? timeline.sentenceIndex : null,
      viseme: this._visemeNameAt(timeline, t),
      expression: exp ? exp.type : this.definition.expressions.default,
      expressionIntensity: exp ? (exp.intensity ?? 0.25) : this.definition.expressions.idleIntensity,
      mouthOpen: c.mouthOpen,
      jawOpen: c.jawOpen,
      headYaw: c.headYaw,
      headPitch: c.headPitch,
      headRoll: c.headRoll,
      blink: c.eyeBlinkLeft,
      blinking: c.eyeBlinkLeft > 0.5,
      lipLevel: this.lipSync.lastLevel,
      alignment: timeline ? timeline.alignment : null,
    };
  }

  getDebugState() {
    return this._debugState;
  }

  setDebug(enabled) {
    this.debug = !!enabled;
    if (this.overlay) this.overlay.setVisible(this.debug);
  }

  destroy() {
    this.stop();
    if (this.overlay) { this.overlay.dispose(); this.overlay = null; }
    if (this.renderer) { this.renderer.dispose(); this.renderer = null; }
    this.timelines.clear();
    this._order = [];
    this.mesh = null;
    this.rig = null;
  }
}
