/**
 * Audio capture and playback handler.
 * Handles microphone capture via AudioWorklet and scheduled playback
 * with barge-in detection.
 */

// ── Audio Capture ─────────────────────────────────────────────────────

export class AudioCapture {
  constructor(onAudioData) {
    this.onAudioData = onAudioData;
    this.context = null;
    this.stream = null;
    this.workletNode = null;
    this.active = false;
  }

  async start() {
    if (this.active) return;

    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        sampleRate: { ideal: 16000 },
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });

    const trackRate = this.stream.getAudioTracks()[0].getSettings().sampleRate || 48000;
    this.context = new AudioContext({ sampleRate: trackRate });

    await this.context.audioWorklet.addModule("/js/audio-processor.worklet.js");

    const source = this.context.createMediaStreamSource(this.stream);
    this.workletNode = new AudioWorkletNode(
      this.context,
      "audio-capture-processor",
      { processorOptions: { sampleRate: this.context.sampleRate } }
    );

    this.workletNode.port.onmessage = (e) => {
      if (this.active && e.data) {
        this.onAudioData(e.data);
      }
    };

    source.connect(this.workletNode);
    this.active = true;
  }

  stop() {
    this.active = false;
    if (this.workletNode) { this.workletNode.disconnect(); this.workletNode = null; }
    if (this.stream) { this.stream.getTracks().forEach((t) => t.stop()); this.stream = null; }
    if (this.context) { this.context.close(); this.context = null; }
  }
}

// ── Audio Playback (scheduled, gapless) ───────────────────────────────

export class AudioPlayback {
  constructor(onPlaybackStart, onPlaybackEnd) {
    this.onPlaybackStart = onPlaybackStart || (() => {});
    this.onPlaybackEnd = onPlaybackEnd || (() => {});
    this.context = null;
    this.isPlaying = false;
    this.nextStartTime = 0;
    this.pendingBuffers = 0;
    this.inputSampleRate = 22050; // Piper output rate
  }

  _ensureContext() {
    if (!this.context || this.context.state === "closed") {
      // Use default sample rate — browser will resample from buffer rate
      this.context = new AudioContext();
    }
    if (this.context.state === "suspended") {
      this.context.resume();
    }
  }

  enqueue(pcmArrayBuffer) {
    this._ensureContext();

    // Convert s16le to float32
    const int16 = new Int16Array(pcmArrayBuffer);
    if (int16.length === 0) return;

    // Create buffer at the input sample rate — browser handles resampling
    const audioBuffer = this.context.createBuffer(1, int16.length, this.inputSampleRate);
    const channelData = audioBuffer.getChannelData(0);
    for (let i = 0; i < int16.length; i++) {
      channelData[i] = int16[i] / 32768;
    }

    const source = this.context.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(this.context.destination);

    // Schedule gaplessly
    const now = this.context.currentTime;
    if (this.nextStartTime < now) {
      this.nextStartTime = now + 0.02; // tiny buffer to avoid glitch
    }

    source.start(this.nextStartTime);
    this.nextStartTime += audioBuffer.duration;

    this.pendingBuffers++;
    if (!this.isPlaying) {
      this.isPlaying = true;
      this.onPlaybackStart();
    }

    source.onended = () => {
      this.pendingBuffers--;
      if (this.pendingBuffers <= 0) {
        this.pendingBuffers = 0;
        // Small delay to see if more audio arrives
        setTimeout(() => {
          if (this.pendingBuffers <= 0) {
            this.isPlaying = false;
            this.onPlaybackEnd();
          }
        }, 200);
      }
    };
  }

  stop() {
    if (this.context && this.context.state !== "closed") {
      // Close and recreate to stop all scheduled audio instantly
      this.context.close();
      this.context = null;
    }
    this.pendingBuffers = 0;
    this.nextStartTime = 0;
    this.isPlaying = false;
  }

  get playing() {
    return this.isPlaying;
  }
}

// ── Barge-in Detector ─────────────────────────────────────────────────

export class BargeInDetector {
  constructor(threshold = 0.06) {
    this.threshold = threshold;
    this.consecutiveFrames = 0;
    this.requiredFrames = 2; // Require 2 consecutive frames above threshold
  }

  check(pcmArrayBuffer) {
    const int16 = new Int16Array(pcmArrayBuffer);
    if (int16.length === 0) return false;

    let sum = 0;
    for (let i = 0; i < int16.length; i++) {
      const s = int16[i] / 32768;
      sum += s * s;
    }
    const rms = Math.sqrt(sum / int16.length);

    if (rms > this.threshold) {
      this.consecutiveFrames++;
      if (this.consecutiveFrames >= this.requiredFrames) {
        this.consecutiveFrames = 0;
        return true;
      }
    } else {
      this.consecutiveFrames = 0;
    }
    return false;
  }
}
