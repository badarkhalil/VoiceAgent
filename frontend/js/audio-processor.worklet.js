/**
 * AudioWorklet processor for capturing microphone audio.
 * Resamples from browser sample rate to 16 kHz and outputs s16le PCM.
 */
class AudioCaptureProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.targetRate = 16000;
    this.sourceRate = options.processorOptions?.sampleRate || sampleRate;
    this.ratio = this.sourceRate / this.targetRate;
    this.resampleBuffer = [];
    this.resampleIndex = 0;
  }

  process(inputs) {
    const input = inputs[0];
    if (!input || !input[0] || input[0].length === 0) return true;

    const samples = input[0]; // Float32, mono

    // Resample by linear interpolation
    for (let i = 0; i < samples.length; i++) {
      this.resampleBuffer.push(samples[i]);
    }

    const outputSamples = [];
    while (this.resampleIndex < this.resampleBuffer.length - 1) {
      const idx = Math.floor(this.resampleIndex);
      const frac = this.resampleIndex - idx;
      const sample =
        this.resampleBuffer[idx] * (1 - frac) +
        this.resampleBuffer[idx + 1] * frac;
      outputSamples.push(sample);
      this.resampleIndex += this.ratio;
    }

    // Keep remaining samples
    const consumed = Math.floor(this.resampleIndex);
    this.resampleBuffer = this.resampleBuffer.slice(consumed);
    this.resampleIndex -= consumed;

    if (outputSamples.length > 0) {
      // Convert to s16le
      const pcm = new Int16Array(outputSamples.length);
      for (let i = 0; i < outputSamples.length; i++) {
        const s = Math.max(-1, Math.min(1, outputSamples[i]));
        pcm[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
      }
      this.port.postMessage(pcm.buffer, [pcm.buffer]);
    }

    return true;
  }
}

registerProcessor("audio-capture-processor", AudioCaptureProcessor);
