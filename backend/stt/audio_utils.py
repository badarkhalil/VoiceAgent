"""Audio utility functions for energy gating and noise rejection."""

from __future__ import annotations

import numpy as np

from backend.config import AUDIO_ENERGY_THRESHOLD, INTERRUPT_ENERGY_THRESHOLD, STT_SAMPLE_RATE


def compute_rms(pcm_bytes: bytes) -> float:
    """Compute RMS energy of PCM audio (s16le, 16 kHz, mono).

    Returns a value in range [0, 32768].  Typical values:
      - Silence / ambient:   0 – 50
      - Background noise:    50 – 200
      - Quiet speech:        200 – 800
      - Normal speech:       800 – 5000
      - Loud speech:         5000 – 15000
    """
    if len(pcm_bytes) < 2:
        return 0.0
    samples = np.frombuffer(pcm_bytes, dtype=np.int16).astype(np.float64)
    return float(np.sqrt(np.mean(samples ** 2)))


def audio_duration_ms(pcm_bytes: bytes) -> float:
    """Duration of PCM audio in milliseconds (s16le, 16 kHz, mono)."""
    return len(pcm_bytes) / 2 / STT_SAMPLE_RATE * 1000


def is_speech_energy(pcm_bytes: bytes) -> bool:
    """Check if audio has enough energy to be considered speech."""
    return compute_rms(pcm_bytes) >= AUDIO_ENERGY_THRESHOLD


def is_interrupt_energy(pcm_bytes: bytes) -> bool:
    """Check if audio has enough energy to justify interrupting the agent."""
    return compute_rms(pcm_bytes) >= INTERRUPT_ENERGY_THRESHOLD
