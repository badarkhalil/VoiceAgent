"""Seed Qdrant with hotel knowledge base documents."""

from __future__ import annotations

import asyncio
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from qdrant_client.models import PointStruct

from backend.config import HOTEL_DATA_PATH, MISTRAL_API_KEY, QDRANT_COLLECTION, QDRANT_EMBED_DIM
from backend.rag.qdrant_rag import QdrantRAG


def build_documents(data: dict) -> list[dict]:
    """Convert hotel data into text documents for embedding."""
    docs = []

    # Hotel overview
    hotel = data["hotel"]
    docs.append({
        "text": (
            f"{hotel['name']} is a {hotel['rating']} hotel located at {hotel['location']}. "
            f"It has {hotel['floors']} floors and {hotel['total_rooms']} rooms. "
            f"{hotel['description']}"
        ),
        "category": "overview",
    })

    # Room types
    for room in data["rooms"]:
        docs.append({
            "text": (
                f"Room type: {room['type']}. "
                f"Price: ${room['price_per_night']} per night. "
                f"Located on floors {room['floors']}. "
                f"Size: {room['size']}. Bed: {room['bed']}. "
                f"Maximum guests: {room['max_guests']}. "
                f"Number of {room['type']} rooms available: {room['count']}."
            ),
            "category": "rooms",
        })
        docs.append({
            "text": (
                f"{room['type']} room features and amenities: "
                + ", ".join(room["features"])
                + "."
            ),
            "category": "rooms",
        })

    # Room comparison
    room_list = data["rooms"]
    comparison = "Room comparison: "
    for r in room_list:
        comparison += f"{r['type']} (${r['price_per_night']}/night, {r['size']}, {r['bed']}), "
    docs.append({
        "text": comparison.rstrip(", ") + ".",
        "category": "rooms",
    })

    # Cheapest/most expensive
    docs.append({
        "text": (
            f"The most affordable room is the Standard room at ${room_list[0]['price_per_night']} per night. "
            f"The most luxurious option is the Presidential suite at ${room_list[-1]['price_per_night']} per night."
        ),
        "category": "rooms",
    })

    # Amenities
    for amenity in data["amenities"]:
        docs.append({
            "text": (
                f"Amenity: {amenity['name']}. "
                f"Located on floor {amenity['floor']}. "
                f"Hours: {amenity['hours']}. "
                f"{amenity['description']}"
            ),
            "category": "amenities",
        })

    # Amenities summary
    amenity_names = [a["name"] for a in data["amenities"]]
    docs.append({
        "text": (
            f"The Grand Azure Hotel amenities include: {', '.join(amenity_names)}. "
            "All amenities are available to hotel guests."
        ),
        "category": "amenities",
    })

    # Services
    for service in data["services"]:
        docs.append({
            "text": (
                f"Service: {service['name']}. {service['description']}"
            ),
            "category": "services",
        })

    # Policies
    for policy in data["policies"]:
        docs.append({
            "text": (
                f"Policy - {policy['name']}: {policy['details']}"
            ),
            "category": "policies",
        })

    # FAQ
    for faq in data["faq"]:
        docs.append({
            "text": (
                f"Q: {faq['question']} A: {faq['answer']}"
            ),
            "category": "faq",
        })

    return docs


async def main() -> None:
    print("=" * 50)
    print("Seeding Qdrant with hotel knowledge")
    print("=" * 50)

    # Load hotel data
    print(f"\nLoading hotel data from {HOTEL_DATA_PATH} ...")
    with open(HOTEL_DATA_PATH) as f:
        data = json.load(f)

    # Build documents
    docs = build_documents(data)
    print(f"Built {len(docs)} documents")

    # Initialize embedder: prefer Mistral, fall back to Ollama
    if MISTRAL_API_KEY:
        from backend.llm.mistral_client import MistralClient
        embedder = MistralClient()
        provider_name = "Mistral"
    else:
        from backend.llm.ollama_client import OllamaClient
        embedder = OllamaClient()
        provider_name = "Ollama"

    print(f"Using {provider_name} for embeddings (dim={QDRANT_EMBED_DIM})")
    print("Connecting to Qdrant ...")

    rag = QdrantRAG(embedder)

    # Delete existing collection and recreate with correct dimensions
    try:
        rag._client.delete_collection(QDRANT_COLLECTION)
        print(f"Deleted existing collection '{QDRANT_COLLECTION}'")
    except Exception:
        pass  # collection may not exist yet
    rag.ensure_collection()

    # Generate embeddings in batches
    print("Generating embeddings ...")
    batch_size = 10
    all_embeddings = []
    for i in range(0, len(docs), batch_size):
        batch = docs[i : i + batch_size]
        texts = [d["text"] for d in batch]
        embeddings = await embedder.embed_batch(texts)
        all_embeddings.extend(embeddings)
        print(f"  Embedded {min(i + batch_size, len(docs))}/{len(docs)}")

    # Upsert to Qdrant
    print("Upserting to Qdrant ...")
    points = []
    for idx, (doc, embedding) in enumerate(zip(docs, all_embeddings)):
        points.append(
            PointStruct(
                id=idx,
                vector=embedding,
                payload={
                    "text": doc["text"],
                    "category": doc["category"],
                },
            )
        )

    rag._client.upsert(
        collection_name=QDRANT_COLLECTION,
        points=points,
    )

    print(f"\n[OK] Seeded {len(points)} documents into '{QDRANT_COLLECTION}' collection")
    await embedder.close()


if __name__ == "__main__":
    asyncio.run(main())
