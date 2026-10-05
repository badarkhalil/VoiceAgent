"""Per-connection session state."""

from __future__ import annotations

import asyncio
import uuid

from backend.booking.booking_service import BookingSlots
from backend.config import LLM_MAX_HISTORY, MAX_AUDIO_BUFFER_SECONDS, STT_SAMPLE_RATE, AUDIO_SAMPLE_WIDTH

# Hard cap on buffered client PCM so a stuck noise source can't grow it forever.
MAX_AUDIO_BUFFER_BYTES = STT_SAMPLE_RATE * AUDIO_SAMPLE_WIDTH * MAX_AUDIO_BUFFER_SECONDS


class Session:
    """Holds state for a single WebSocket connection."""

    def __init__(self) -> None:
        self.session_id: str = str(uuid.uuid4())[:8]
        self.history: list[dict[str, str]] = []  # chat messages
        self.audio_buffer: bytearray = bytearray()  # accumulated PCM from client
        self.slots: BookingSlots = BookingSlots()
        self.cancel_event: asyncio.Event = asyncio.Event()
        self.is_responding: bool = False  # True while pipeline is generating
        self.booking_confirmed: bool = False

        # User personalization
        self.user_name: str = ""
        self.language: str = "en"  # "en" or "ur"

        # Resume after noise interrupt
        self.last_response: str = ""
        self.last_spoken_sentences: int = 0
        self.was_interrupted: bool = False

    def add_message(self, role: str, content: str) -> None:
        """Append a message to conversation history."""
        self.history.append({"role": role, "content": content})

    def get_messages(self, system_prompt: str) -> list[dict[str, str]]:
        """Build message list for LLM with system prompt.

        Only includes the last LLM_MAX_HISTORY messages to keep the
        prompt small and reduce LLM first-token latency.
        """
        recent = self.history[-LLM_MAX_HISTORY:] if len(self.history) > LLM_MAX_HISTORY else self.history
        return [{"role": "system", "content": system_prompt}] + recent

    def append_audio(self, chunk: bytes) -> None:
        """Append client PCM, trimming the oldest data past the hard cap."""
        self.audio_buffer.extend(chunk)
        overflow = len(self.audio_buffer) - MAX_AUDIO_BUFFER_BYTES
        if overflow > 0:
            del self.audio_buffer[:overflow]

    def reset_audio(self) -> None:
        """Clear audio buffer for next utterance."""
        self.audio_buffer = bytearray()

    def cancel(self) -> None:
        """Signal cancellation of current pipeline run."""
        self.cancel_event.set()

    def reset_cancel(self) -> None:
        """Reset cancellation for new pipeline run."""
        self.cancel_event = asyncio.Event()
