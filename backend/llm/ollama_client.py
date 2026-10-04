"""Ollama HTTP client for chat (streaming) and embeddings."""

from __future__ import annotations

import asyncio
import json
import logging
from typing import AsyncIterator

import httpx

from backend.config import (
    OLLAMA_BASE_URL,
    OLLAMA_CHAT_MODEL,
    OLLAMA_EMBED_MODEL,
    OLLAMA_NUM_CTX,
)

logger = logging.getLogger(__name__)


class OllamaClient:
    """Async client for Ollama REST API."""

    def __init__(self) -> None:
        self._base = OLLAMA_BASE_URL
        self._chat_model = OLLAMA_CHAT_MODEL
        self._embed_model = OLLAMA_EMBED_MODEL
        self._num_ctx = OLLAMA_NUM_CTX
        self._http = httpx.AsyncClient(base_url=self._base, timeout=120.0)
        logger.info(
            "OllamaClient ready  chat=%s  embed=%s  num_ctx=%d",
            self._chat_model,
            self._embed_model,
            self._num_ctx,
        )

    async def chat_stream(
        self,
        messages: list[dict[str, str]],
        cancel_event: asyncio.Event | None = None,
        model: str | None = None,
    ) -> AsyncIterator[str]:
        """Stream chat completion token-by-token.

        Args:
            model: Override the default chat model (e.g. for slot extraction).
        """
        payload = {
            "model": model or self._chat_model,
            "messages": messages,
            "stream": True,
            "options": {
                "num_ctx": self._num_ctx,
            },
        }

        try:
            async with self._http.stream(
                "POST", "/api/chat", json=payload
            ) as resp:
                resp.raise_for_status()
                async for line in resp.aiter_lines():
                    if cancel_event and cancel_event.is_set():
                        logger.debug("LLM stream cancelled")
                        return

                    if not line.strip():
                        continue

                    try:
                        data = json.loads(line)
                    except json.JSONDecodeError:
                        continue

                    if data.get("done"):
                        return

                    token = data.get("message", {}).get("content", "")
                    if token:
                        yield token

        except httpx.HTTPStatusError as e:
            logger.error("Ollama chat error: %s", e)
            raise
        except Exception:
            if cancel_event and cancel_event.is_set():
                return
            raise

    async def embed(self, text: str) -> list[float]:
        """Generate embedding vector for text using nomic-embed-text."""
        payload = {
            "model": self._embed_model,
            "input": text,
        }

        resp = await self._http.post("/api/embed", json=payload)
        resp.raise_for_status()
        data = resp.json()
        return data.get("embeddings", [[]])[0]

    async def embed_batch(self, texts: list[str]) -> list[list[float]]:
        """Generate embeddings for multiple texts."""
        payload = {
            "model": self._embed_model,
            "input": texts,
        }

        resp = await self._http.post("/api/embed", json=payload)
        resp.raise_for_status()
        data = resp.json()
        return data.get("embeddings", [])

    async def close(self) -> None:
        await self._http.aclose()
