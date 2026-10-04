"""Google Gemini REST API client for chat (streaming)."""

from __future__ import annotations

import asyncio
import json
import logging
import os
from typing import AsyncIterator

import httpx

logger = logging.getLogger(__name__)

GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta"


class GeminiClient:
    """Async streaming client for Gemini free-tier API."""

    def __init__(self, api_key: str, model: str = "gemini-2.0-flash") -> None:
        self._api_key = api_key
        self._model = model
        self._http = httpx.AsyncClient(timeout=60.0)
        logger.info("GeminiClient ready  model=%s", self._model)

    async def chat_stream(
        self,
        messages: list[dict[str, str]],
        cancel_event: asyncio.Event | None = None,
        model: str | None = None,
    ) -> AsyncIterator[str]:
        """Stream chat response token-by-token from Gemini.

        Accepts the same message format as OllamaClient (OpenAI-style):
          [{"role": "system", "content": "..."}, {"role": "user", ...}, ...]
        and converts to Gemini format internally.
        """
        use_model = model or self._model

        # Separate system prompt from conversation
        system_text = ""
        contents = []
        for msg in messages:
            role = msg["role"]
            text = msg["content"]
            if role == "system":
                system_text += text + "\n"
            elif role == "user":
                contents.append({"role": "user", "parts": [{"text": text}]})
            elif role == "assistant":
                contents.append({"role": "model", "parts": [{"text": text}]})

        # Ensure conversation starts with a user message (Gemini requirement)
        if not contents or contents[0]["role"] != "user":
            contents.insert(0, {"role": "user", "parts": [{"text": "Hello"}]})

        # Ensure alternating roles (Gemini requires strict alternation)
        merged: list[dict] = []
        for c in contents:
            if merged and merged[-1]["role"] == c["role"]:
                # Merge consecutive same-role messages
                merged[-1]["parts"][0]["text"] += "\n" + c["parts"][0]["text"]
            else:
                merged.append(c)
        contents = merged

        payload: dict = {
            "contents": contents,
            "generationConfig": {
                "maxOutputTokens": 256,
                "temperature": 0.7,
                "thinkingConfig": {"thinkingBudget": 0},
            },
        }
        if system_text.strip():
            payload["systemInstruction"] = {
                "parts": [{"text": system_text.strip()}]
            }

        url = f"{GEMINI_BASE}/models/{use_model}:streamGenerateContent?alt=sse&key={self._api_key}"

        max_retries = 3
        for attempt in range(max_retries):
            try:
                async with self._http.stream("POST", url, json=payload) as resp:
                    if resp.status_code == 429:
                        await resp.aread()
                        wait = 2 ** attempt + 1
                        logger.warning("Gemini 429 rate-limited, retrying in %ds (attempt %d/%d)", wait, attempt + 1, max_retries)
                        await asyncio.sleep(wait)
                        continue

                    resp.raise_for_status()
                    async for line in resp.aiter_lines():
                        if cancel_event and cancel_event.is_set():
                            logger.debug("Gemini stream cancelled")
                            return

                        line = line.strip()
                        if not line or not line.startswith("data: "):
                            continue

                        json_str = line[6:]  # strip "data: "
                        if json_str == "[DONE]":
                            return

                        try:
                            data = json.loads(json_str)
                        except json.JSONDecodeError:
                            continue

                        # Extract text from Gemini response
                        candidates = data.get("candidates", [])
                        for candidate in candidates:
                            content = candidate.get("content", {})
                            for part in content.get("parts", []):
                                text = part.get("text", "")
                                if text:
                                    yield text
                    return  # success, exit retry loop

            except httpx.HTTPStatusError as e:
                await e.response.aread()
                body = e.response.text[:200]
                logger.error("Gemini API error: %s — %s", e.response.status_code, body)
                raise
            except Exception:
                if cancel_event and cancel_event.is_set():
                    return
                raise

        logger.error("Gemini API: exhausted %d retries (429 rate limit)", max_retries)

    async def close(self) -> None:
        await self._http.aclose()
