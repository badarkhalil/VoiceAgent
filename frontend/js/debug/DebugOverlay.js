/**
 * Lightweight debug HUD drawn into a DOM element over the canvas (spec §27).
 * Reads the runtime's `getDebugState()` each frame; we update at a throttled
 * rate so text layout never costs more than the render.
 */

export class DebugOverlay {
  constructor(container) {
    this.container = container;
    this.el = document.createElement("pre");
    this.el.className = "avatar-debug";
    Object.assign(this.el.style, {
      position: "absolute",
      top: "8px",
      left: "8px",
      margin: "0",
      padding: "8px 10px",
      font: "11px/1.45 ui-monospace, Menlo, Consolas, monospace",
      color: "#b8f7c8",
      background: "rgba(6, 12, 10, 0.72)",
      borderRadius: "8px",
      pointerEvents: "none",
      whiteSpace: "pre",
      zIndex: "5",
      maxWidth: "60%",
    });
    this.el.style.display = "none";
    container.appendChild(this.el);

    this.visible = false;
    this._last = 0;
    this._interval = 100; // ms between text updates
  }

  setVisible(v) {
    this.visible = v;
    this.el.style.display = v ? "block" : "none";
  }

  update(state, now) {
    if (!this.visible) return;
    if (now - this._last < this._interval) return;
    this._last = now;

    const f = (n, d = 2) => (typeof n === "number" ? n.toFixed(d) : "-");
    const lines = [
      `fps        ${f(state.fps, 1)}`,
      `time       ${state.audioTime != null ? f(state.audioTime, 3) + "s" : "idle"}`,
      `sentence   ${state.sentenceIndex ?? "-"}`,
      `viseme     ${state.viseme || "-"}`,
      `expression ${state.expression || "-"} (${f(state.expressionIntensity)})`,
      `mouthOpen  ${f(state.mouthOpen)}`,
      `jawOpen    ${f(state.jawOpen)}`,
      `head       yaw ${f(state.headYaw, 1)}  pitch ${f(state.headPitch, 1)}  roll ${f(state.headRoll, 1)}`,
      `blink      ${state.blinking ? "closed" : "open"}  (${f(state.blink)})`,
      `lipSync    ${state.lipLevel != null ? f(state.lipLevel) : "n/a"}`,
      `alignment  ${state.alignment || "-"}`,
    ];
    this.el.textContent = lines.join("\n");
  }

  dispose() {
    if (this.el && this.el.parentElement) this.el.parentElement.removeChild(this.el);
    this.el = null;
  }
}
