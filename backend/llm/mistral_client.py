"""Mistral AI REST API client for chat (streaming) and embeddings."""

from __future__ import annotations

import asyncio
import json
import logging
from typing import AsyncIterator

import httpx

from backend.config import MISTRAL_API_KEY, MISTRAL_CHAT_MODEL, MISTRAL_EMBED_MODEL

logger = logging.getLogger(__name__)

MISTRAL_BASE = "https://api.mistral.ai/v1"
MAX_RETRIES = 3


class MistralClient:
    """Async streaming client for Mistral AI API."""

    def __init__(
        self,
        api_key: str = MISTRAL_API_KEY,
        model: str = MISTRAL_CHAT_MODEL,
    ) -> None:
        self._api_key = api_key
        self._model = model
        self._embed_model = MISTRAL_EMBED_MODEL
        self._http = httpx.AsyncClient(
            base_url=MISTRAL_BASE,
            headers={
                "Authorization": f"Bearer {self._api_key}",
                "Content-Type": "application/json",
            },
            timeout=60.0,
        )
        logger.info("MistralClient ready  chat=%s  embed=%s", self._model, self._embed_model)

    async def chat_stream(
        self,
        messages: list[dict[str, str]],
        cancel_event: asyncio.Event | None = None,
        model: str | None = None,
    ) -> AsyncIterator[str]:
        """Stream chat completion token-by-token via Mistral API.

        Accepts OpenAI-style messages (same as OllamaClient/GeminiClient).
        """
        payload = {
            "model": model or self._model,
            "messages": messages,
            "stream": True,
            "max_tokens": 200,
            "temperature": 0.7,
        }

        for attempt in range(MAX_RETRIES):
            try:
                async with self._http.stream(
                    "POST", "/chat/completions", json=payload
                ) as resp:
                    if resp.status_code == 429:
                        await resp.aread()
                        wait = 2 ** attempt + 1
                        logger.warning(
                            "Mistral 429 rate-limited, retrying in %ds (attempt %d/%d)",
                            wait, attempt + 1, MAX_RETRIES,
                        )
                        await asyncio.sleep(wait)
                        continue

                    resp.raise_for_status()

                    async for line in resp.aiter_lines():
                        if cancel_event and cancel_event.is_set():
                            logger.debug("Mistral stream cancelled")
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

                        choices = data.get("choices", [])
                        for choice in choices:
                            delta = choice.get("delta", {})
                            token = delta.get("content", "")
                            if token:
                                yield token

                    return  # success

            except httpx.HTTPStatusError as e:
                await e.response.aread()
                body = e.response.text[:200]
                logger.error("Mistral API error: %s - %s", e.response.status_code, body)
                raise
            except Exception:
                if cancel_event and cancel_event.is_set():
                    return
                raise

        logger.error("Mistral API: exhausted %d retries (429 rate limit)", MAX_RETRIES)

    async def embed(self, text: str) -> list[float]:
        """Generate embedding vector for a single text."""
        return (await self.embed_batch([text]))[0]

    async def embed_batch(self, texts: list[str]) -> list[list[float]]:
        """Generate embeddings for multiple texts in a single API call."""
        payload = {
            "model": self._embed_model,
            "input": texts,
        }

        for attempt in range(MAX_RETRIES):
            try:
                resp = await self._http.post("/embeddings", json=payload)

                if resp.status_code == 429:
                    wait = 2 ** attempt + 1
                    logger.warning(
                        "Mistral embed 429, retrying in %ds (attempt %d/%d)",
                        wait, attempt + 1, MAX_RETRIES,
                    )
                    await asyncio.sleep(wait)
                    continue

                resp.raise_for_status()
                data = resp.json()
                # Mistral returns {"data": [{"embedding": [...], "index": 0}, ...]}
                items = sorted(data.get("data", []), key=lambda x: x.get("index", 0))
                return [item["embedding"] for item in items]

            except httpx.HTTPStatusError:
                raise

        logger.error("Mistral embed: exhausted %d retries", MAX_RETRIES)
        return [[] for _ in texts]

    async def close(self) -> None:
        await self._http.aclose()
