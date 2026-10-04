"""RAG service using Qdrant for hotel knowledge retrieval."""

from __future__ import annotations

import logging
from typing import TYPE_CHECKING

from qdrant_client import QdrantClient
from qdrant_client.models import Distance, PointStruct, VectorParams

from backend.config import (
    QDRANT_COLLECTION,
    QDRANT_EMBED_DIM,
    QDRANT_HOST,
    QDRANT_PORT,
    RAG_SCORE_THRESHOLD,
    RAG_TOP_K,
)

if TYPE_CHECKING:
    from typing import Any

logger = logging.getLogger(__name__)


class QdrantRAG:
    """Retrieve hotel knowledge from Qdrant vector store."""

    def __init__(self, embedder: Any) -> None:
        self._embedder = embedder
        self._client = QdrantClient(host=QDRANT_HOST, port=QDRANT_PORT)
        self._collection = QDRANT_COLLECTION
        logger.info(
            "QdrantRAG ready  host=%s:%d  collection=%s",
            QDRANT_HOST,
            QDRANT_PORT,
            self._collection,
        )

    def ensure_collection(self) -> None:
        """Create collection if it doesn't exist."""
        collections = [c.name for c in self._client.get_collections().collections]
        if self._collection not in collections:
            self._client.create_collection(
                collection_name=self._collection,
                vectors_config=VectorParams(
                    size=QDRANT_EMBED_DIM,
                    distance=Distance.COSINE,
                ),
            )
            logger.info("Created Qdrant collection: %s", self._collection)

    async def search(self, query: str) -> list[dict]:
        """Search for relevant hotel knowledge.

        Returns list of dicts with 'text' and 'score' keys.
        """
        query_vector = await self._embedder.embed(query)

        results = self._client.query_points(
            collection_name=self._collection,
            query=query_vector,
            limit=RAG_TOP_K,
        ).points

        docs = []
        for point in results:
            score = point.score
            if score < RAG_SCORE_THRESHOLD:
                continue
            docs.append({
                "text": point.payload.get("text", ""),
                "category": point.payload.get("category", ""),
                "score": score,
            })

        logger.debug(
            "RAG search for '%.50s' → %d results (of %d)",
            query,
            len(docs),
            len(results),
        )
        return docs

    def format_context(self, docs: list[dict]) -> str:
        """Format retrieved documents into context string for LLM."""
        if not docs:
            return ""

        parts = ["Here is relevant information about The Grand Azure Hotel:\n"]
        for doc in docs:
            parts.append(f"- {doc['text']}")

        return "\n".join(parts)

    async def get_context(self, query: str) -> str:
        """One-shot: search + format context for a user query."""
        docs = await self.search(query)
        return self.format_context(docs)
