/**
 * RMS envelope derived from the scheduled playback buffers.
 *
 * AudioPlayer schedules buffers ahead of time; every buffer is registered here
 * with its absolute AudioContext start time so `level()` can return the true
 * envelope at the *currently audible* moment — gating mouth motion during
 * silence and modestly modulating mouthOpen during loud speech (spec §17).
 */

const REF_RMS = 0.22; // ~normal loud speech in float samples

export class AudioAnalyzer {
  constructor(context) {
    this.ctx = context || null;
    this.blocks = []; // { start, end, rms }
    this.lastLevel = 0;
  }

  schedule(startTime, float32, duration) {
    let sum = 0;
    for (let i = 0; i < float32.length; i++) {
      sum += float32[i] * float32[i];
    }
    const rms = float32.length ? Math.sqrt(sum / float32.length) : 0;
    this.blocks.push({ start: startTime, end: startTime + duration, rms });
    // Bound memory: keep only recent blocks.
    if (this.blocks.length > 512) this.blocks.splice(0, this.blocks.length - 512);
  }

  level() {
    if (!this.ctx) return this.lastLevel;
    const now = this.ctx.currentTime;

    // Prune blocks entirely in the past.
    while (this.blocks.length && this.blocks[0].end < now - 0.5) this.blocks.shift();

    let rms = 0;
    for (const b of this.blocks) {
      if (now >= b.start && now <= b.end) { rms = b.rms; break; }
    }
    // Light smoothing to avoid jitter.
    const target = Math.min(1, rms / REF_RMS);
    this.lastLevel += (target - this.lastLevel) * 0.25;
    return this.lastLevel;
  }

  reset() {
    this.blocks.length = 0;
    this.lastLevel = 0;
  }
}
