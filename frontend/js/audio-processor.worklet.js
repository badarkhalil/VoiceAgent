/**
 * AudioWorklet processor for capturing microphone audio.
 *
 * Chain: source samples -> biquad high-pass (~85 Hz, kills rumble/HVAC) ->
 * noise gate (hysteresis + attack/release smoothing) -> linear resample to
 * 16 kHz -> s16le PCM.
 *
 * It posts { pcm, rms, speech } per frame so barge-in can use the *gated*
 * speech flag instead of a raw energy value, which is what caused
 * background noise to falsely interrupt the agent.
 */
const HPF_CUTOFF_HZ = 85;
const Q = 0.707;             // Butterworth
const GATE_OPEN_DB = -42;    // open the gate above this level
const GATE_CLOSE_DB = -50;   // ...and only close it below this (hysteresis)
const GATE_ATTACK = 0.5;     // fast open
const GATE_RELEASE = 0.02;   // slow close — avoids chopping quiet speech
const GATE_FLOOR = 0.1;      // attenuate, don't fully mute, so quiet speech survives

class AudioCaptureProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.targetRate = 16000;
    this.sourceRate = options.processorOptions?.sampleRate || sampleRate;
    this.ratio = this.sourceRate / this.targetRate;
    this.resampleBuffer = [];
    this.resampleIndex = 0;

    // ── Biquad high-pass (RBJ cookbook) ─────────────────────────────
    const w0 = (2 * Math.PI * HPF_CUTOFF_HZ) / this.sourceRate;
    const cosw0 = Math.cos(w0);
    const sinw0 = Math.sin(w0);
    const alpha = sinw0 / (2 * Q);
    const a0 = 1 + alpha;
    this.b0 = ((1 + cosw0) / 2) / a0;
    this.b1 = (-(1 + cosw0)) / a0;
    this.b2 = ((1 + cosw0) / 2) / a0;
    this.a1 = (-2 * cosw0) / a0;
    this.a2 = (1 - alpha) / a0;
    this.x1 = 0; this.x2 = 0; this.y1 = 0; this.y2 = 0;

    // ── Noise gate ──────────────────────────────────────────────────
    this.gateOpen = false;
    this.gateGain = 1;
  }

  process(inputs) {
    const input = inputs[0];
    if (!input || !input[0] || input[0].length === 0) return true;

    const samples = input[0]; // Float32, mono
    const n = samples.length;
    const filtered = new Float32Array(n);

    // High-pass + accumulate energy of the filtered signal.
    let sumSq = 0;
    for (let i = 0; i < n; i++) {
      const x0 = samples[i];
      const y0 =
        this.b0 * x0 + this.b1 * this.x1 + this.b2 * this.x2 -
        this.a1 * this.y1 - this.a2 * this.y2;
      this.x2 = this.x1; this.x1 = x0;
      this.y2 = this.y1; this.y1 = y0;
      filtered[i] = y0;
      sumSq += y0 * y0;
    }

    const rms = Math.sqrt(sumSq / n);
    const db = 20 * Math.log10(rms + 1e-9);

    // Hysteresis: open easily, close only well below the open threshold.
    if (!this.gateOpen && db > GATE_OPEN_DB) {
      this.gateOpen = true;
    } else if (this.gateOpen && db < GATE_CLOSE_DB) {
      this.gateOpen = false;
    }

    // Attack/release smoothing toward the gate target gain.
    const target = this.gateOpen ? 1 : GATE_FLOOR;
    const coeff = this.gateOpen ? GATE_ATTACK : GATE_RELEASE;
    this.gateGain += (target - this.gateGain) * coeff;

    // Apply gate gain and append for resampling.
    for (let i = 0; i < n; i++) {
      this.resampleBuffer.push(filtered[i] * this.gateGain);
    }

    // Resample by linear interpolation.
    const outputSamples = [];
    while (this.resampleIndex < this.resampleBuffer.length - 1) {
      const idx = Math.floor(this.resampleIndex);
      const frac = this.resampleIndex - idx;
      outputSamples.push(
        this.resampleBuffer[idx] * (1 - frac) +
        this.resampleBuffer[idx + 1] * frac
      );
      this.resampleIndex += this.ratio;
    }

    const consumed = Math.floor(this.resampleIndex);
    this.resampleBuffer = this.resampleBuffer.slice(consumed);
    this.resampleIndex -= consumed;

    if (outputSamples.length > 0) {
      const pcm = new Int16Array(outputSamples.length);
      for (let i = 0; i < outputSamples.length; i++) {
        const s = Math.max(-1, Math.min(1, outputSamples[i]));
        pcm[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
      }
      // speech = gate is open (VAD-ish), rms = filtered energy (linear 0..1)
      this.port.postMessage(
        { pcm: pcm.buffer, rms, speech: this.gateOpen },
        [pcm.buffer]
      );
    }

    return true;
  }
}

registerProcessor("audio-capture-processor", AudioCaptureProcessor);
