/**
 * Per-sentence, gapless PCM player whose AudioContext clock is authoritative
 * for avatar lip-sync (spec §17).
 *
 * The AudioContext is created once and never closed; interruption uses
 * `source.stop()` + `ctx.suspend()` so the clock (and thus the avatar's sense
 * of time) survives pauses and interruptions.
 *
 * It also owns an AudioAnalyzer: every scheduled buffer is registered with its
 * absolute start time so the avatar lip-sync can read the true audible envelope.
 */

import { AudioAnalyzer } from "./AudioAnalyzer.js";

export class AudioPlayer {
  constructor({ onStart, onEnd, sampleRate = 22050 } = {}) {
    this.onStart = onStart || (() => {});
    this.onEnd = onEnd || (() => {});
    this.inputSampleRate = sampleRate;

    this.ctx = null;
    this.sentences = new Map(); // sentence_index -> { startTime, duration, bytes, timeline }
    this.sources = [];
    this.activeIndex = null;
    this.nextStartTime = 0;
    this.pending = 0;
    this.playing = false;
    this._endTimer = null;
    this.analyzer = new AudioAnalyzer(null);
  }

  _ensureContext() {
    if (!this.ctx || this.ctx.state === "closed") {
      this.ctx = new AudioContext();
    }
    if (this.ctx.state === "suspended") {
      this.ctx.resume();
    }
    this.analyzer.ctx = this.ctx;
    return this.ctx;
  }

  beginSentence(sentenceIndex, meta = {}) {
    const ctx = this._ensureContext();
    const now = ctx.currentTime;
    const start = Math.max(now + 0.02, this.nextStartTime);
    this.sentences.set(sentenceIndex, {
      startTime: start,
      duration: 0,
      bytes: 0,
      timeline: meta.timeline || null,
    });
    this.activeIndex = sentenceIndex;
    this.nextStartTime = start;
  }

  enqueue(pcmArrayBuffer) {
    const ctx = this._ensureContext();
    const int16 = new Int16Array(pcmArrayBuffer);
    if (int16.length === 0) return;

    const buffer = ctx.createBuffer(1, int16.length, this.inputSampleRate);
    const channel = buffer.getChannelData(0);
    for (let i = 0; i < int16.length; i++) channel[i] = int16[i] / 32768;

    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(ctx.destination);

    const now = ctx.currentTime;
    if (this.nextStartTime < now) this.nextStartTime = now + 0.02;

    // Filler / unattributed audio: create an implicit sentence bucket.
    if (this.activeIndex === null) {
      this.sentences.set(-1, { startTime: this.nextStartTime, duration: 0, bytes: 0, timeline: null });
      this.activeIndex = -1;
    }
    const s = this.sentences.get(this.activeIndex);
    if (s) s.duration += buffer.duration;

    this.analyzer.schedule(this.nextStartTime, channel, buffer.duration);
    source.start(this.nextStartTime);
    this.nextStartTime += buffer.duration;
    this.sources.push(source);

    this.pending++;
    if (!this.playing) {
      this.playing = true;
      this.onStart();
    }

    source.onended = () => {
      const idx = this.sources.indexOf(source);
      if (idx >= 0) this.sources.splice(idx, 1);
      this.pending--;
      if (this.pending <= 0) {
        this.pending = 0;
        clearTimeout(this._endTimer);
        this._endTimer = setTimeout(() => {
          if (this.pending <= 0) {
            this.playing = false;
            this.onEnd();
          }
        }, 200);
      }
    };
  }

  endSentence(sentenceIndex, meta = {}) {
    const s = this.sentences.get(sentenceIndex);
    if (s && typeof meta.bytes === "number") s.bytes = meta.bytes;
  }

  attachTimeline(sentenceIndex, timeline) {
    const s = this.sentences.get(sentenceIndex);
    if (s) s.timeline = timeline;
    else this.sentences.set(sentenceIndex, { startTime: 0, duration: 0, bytes: 0, timeline });
  }

  getTimeline(sentenceIndex) {
    const s = this.sentences.get(sentenceIndex);
    return s ? s.timeline : null;
  }

  /** Authoritative playhead for the active sentence. */
  getPlayhead() {
    if (!this.ctx || this.activeIndex === null || !this.playing) return null;
    const s = this.sentences.get(this.activeIndex);
    if (!s) return null;
    return { sentenceIndex: this.activeIndex, time: this.ctx.currentTime - s.startTime };
  }

  /** Stop everything now (barge-in / interrupt) but keep the AudioContext. */
  stopAll() {
    clearTimeout(this._endTimer);
    for (const src of this.sources) {
      try { src.stop(); } catch { /* already stopped */ }
    }
    this.sources = [];
    this.pending = 0;
    this.nextStartTime = 0;
    this.activeIndex = null;
    this.playing = false;
    this.analyzer.reset();
    if (this.ctx && this.ctx.state === "running") {
      this.ctx.suspend();
    }
  }

  interrupt() {
    this.stopAll();
  }

  pause() {
    if (this.ctx && this.ctx.state === "running") this.ctx.suspend();
  }

  resume() {
    if (this.ctx && this.ctx.state === "suspended") this.ctx.resume();
  }

  dispose() {
    this.stopAll();
    if (this.ctx && this.ctx.state !== "closed") this.ctx.close();
    this.ctx = null;
    this.sentences.clear();
  }

  get playingState() {
    return this.playing;
  }
}
