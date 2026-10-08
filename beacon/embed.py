"""Local text embeddings (BAAI/bge-small-en-v1.5 via fastembed, 384 dims).

Runs on CPU with no extra API key. The model (~130 MB) downloads on first use.
"""
import asyncio
from functools import lru_cache
from typing import List

import numpy as np
from fastembed import TextEmbedding

from beacon.config import EMBED_MODEL


@lru_cache(maxsize=1)
def _model() -> TextEmbedding:
    return TextEmbedding(EMBED_MODEL)


def warm() -> None:
    _model()


async def embed(text: str) -> np.ndarray:
    """Embed a search query (bge adds its query instruction prefix)."""
    return await asyncio.to_thread(lambda: next(iter(_model().query_embed([text]))))


def embed_passages(texts: List[str]) -> List[np.ndarray]:
    """Embed document passages for indexing."""
    return list(_model().passage_embed(texts, batch_size=32))
