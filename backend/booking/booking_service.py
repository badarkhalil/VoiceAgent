"""Booking service for slot extraction, validation, and storage."""

from __future__ import annotations

import json
import logging
import uuid
from datetime import datetime
from pathlib import Path
from typing import Any

from pydantic import BaseModel, Field

from backend.config import BOOKINGS_DIR, ROOM_TYPES

logger = logging.getLogger(__name__)


class BookingSlots(BaseModel):
    """Booking information extracted from conversation."""

    guest_name: str | None = None
    contact: str | None = None  # phone or email
    check_in: str | None = None  # date string
    check_out: str | None = None  # date string
    room_type: str | None = None
    num_guests: int | None = None

    @property
    def filled_slots(self) -> dict[str, Any]:
        """Return only non-None slots."""
        return {k: v for k, v in self.model_dump().items() if v is not None}

    @property
    def missing_slots(self) -> list[str]:
        """Return names of slots that are still None."""
        return [k for k, v in self.model_dump().items() if v is None]

    @property
    def required_slots(self) -> list[str]:
        """Slots required for a valid booking (contact is optional for demo)."""
        return ["guest_name", "check_in", "check_out", "room_type", "num_guests"]

    @property
    def is_complete(self) -> bool:
        """True when all required slots are filled (contact is optional)."""
        return all(getattr(self, s) is not None for s in self.required_slots)

    def status_dict(self) -> dict:
        """Return status for WebSocket message."""
        return {
            "filled": self.filled_slots,
            "missing": self.missing_slots,
            "complete": self.is_complete,
        }


SLOT_EXTRACTION_PROMPT = """You are a slot extraction assistant. Extract booking details from the conversation.
Return a JSON object with ONLY these keys (use null for unknown values):
- guest_name: full name of the guest
- contact: phone number or email address
- check_in: check-in date (format: YYYY-MM-DD if possible, otherwise the date as stated)
- check_out: check-out date (format: YYYY-MM-DD if possible, otherwise the date as stated)
- room_type: one of "standard", "deluxe", "suite", "presidential" (lowercase)
- num_guests: number of guests (integer)

IMPORTANT: Only extract information that is explicitly stated. Do not guess or infer.
Return ONLY the JSON object, no other text."""


class BookingService:
    """Manage booking slot extraction and persistence."""

    def __init__(self) -> None:
        BOOKINGS_DIR.mkdir(parents=True, exist_ok=True)
        logger.info("BookingService ready  storage=%s", BOOKINGS_DIR)

    def parse_extraction(self, llm_response: str, existing: BookingSlots) -> BookingSlots:
        """Parse LLM extraction response and merge with existing slots."""
        # Try to extract JSON from the response
        text = llm_response.strip()

        # Handle markdown code blocks
        if "```" in text:
            parts = text.split("```")
            for part in parts:
                part = part.strip()
                if part.startswith("json"):
                    part = part[4:].strip()
                if part.startswith("{"):
                    text = part
                    break

        try:
            data = json.loads(text)
        except json.JSONDecodeError:
            # Try to find JSON in the text
            start = text.find("{")
            end = text.rfind("}") + 1
            if start >= 0 and end > start:
                try:
                    data = json.loads(text[start:end])
                except json.JSONDecodeError:
                    logger.warning("Failed to parse slot extraction: %.100s", text)
                    return existing
            else:
                return existing

        # Merge: only overwrite None slots with non-None extracted values
        updated = existing.model_copy()
        for field in BookingSlots.model_fields:
            extracted = data.get(field)
            if extracted is not None and getattr(updated, field) is None:
                # Validate room_type
                if field == "room_type":
                    extracted = str(extracted).lower().strip()
                    if extracted not in ROOM_TYPES:
                        continue
                # Validate num_guests
                if field == "num_guests":
                    try:
                        extracted = int(extracted)
                        if extracted < 1:
                            continue
                    except (ValueError, TypeError):
                        continue

                setattr(updated, field, extracted)

        return updated

    def save_booking(self, slots: BookingSlots) -> str:
        """Save completed booking to JSON file. Returns booking ID."""
        booking_id = str(uuid.uuid4())[:8].upper()

        room_info = ROOM_TYPES.get(slots.room_type or "", {})
        booking = {
            "booking_id": booking_id,
            "guest_name": slots.guest_name,
            "contact": slots.contact,
            "check_in": slots.check_in,
            "check_out": slots.check_out,
            "room_type": slots.room_type,
            "num_guests": slots.num_guests,
            "price_per_night": room_info.get("price"),
            "created_at": datetime.now().isoformat(),
        }

        path = BOOKINGS_DIR / f"{booking_id}.json"
        path.write_text(json.dumps(booking, indent=2))
        logger.info("Booking saved: %s → %s", booking_id, path)
        return booking_id
