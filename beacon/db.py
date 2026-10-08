"""Postgres + pgvector connection pool and schema."""
from typing import Optional
from urllib.parse import urlparse, urlunparse

import asyncpg
from pgvector.asyncpg import register_vector

from beacon.config import DATABASE_URL, EMBED_DIM

pool: Optional[asyncpg.Pool] = None

SCHEMA = f"""
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS users (
    id            SERIAL PRIMARY KEY,
    email         TEXT UNIQUE NOT NULL,
    name          TEXT NOT NULL,
    team          TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id    INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS chats (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id    INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title      TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS chats_user_idx ON chats (user_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS messages (
    id         SERIAL PRIMARY KEY,
    chat_id    UUID NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
    role       TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
    content    TEXT NOT NULL,
    sources    JSONB NOT NULL DEFAULT '[]',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS messages_chat_idx ON messages (chat_id, id);

CREATE TABLE IF NOT EXISTS documents (
    id         SERIAL PRIMARY KEY,
    title      TEXT NOT NULL,
    path       TEXT UNIQUE NOT NULL,
    team       TEXT NOT NULL DEFAULT 'all',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS chunks (
    id          SERIAL PRIMARY KEY,
    document_id INT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    locator     TEXT NOT NULL,          -- "p.12", "§3.2" ... where the passage lives
    content     TEXT NOT NULL,
    embedding   vector({EMBED_DIM}) NOT NULL
);
CREATE INDEX IF NOT EXISTS chunks_embedding_idx
    ON chunks USING hnsw (embedding vector_cosine_ops);
"""


async def ensure_database() -> None:
    """Create the target database if it doesn't exist yet."""
    try:
        conn = await asyncpg.connect(DATABASE_URL)
    except asyncpg.InvalidCatalogNameError:
        parts = urlparse(DATABASE_URL)
        name = parts.path.lstrip("/")
        admin = await asyncpg.connect(urlunparse(parts._replace(path="/postgres")))
        try:
            await admin.execute(f'CREATE DATABASE "{name}"')
        finally:
            await admin.close()
        conn = await asyncpg.connect(DATABASE_URL)
    try:
        await conn.execute(SCHEMA)
    finally:
        await conn.close()


async def connect() -> asyncpg.Pool:
    global pool
    if pool is None:
        await ensure_database()
        pool = await asyncpg.create_pool(DATABASE_URL, init=register_vector, min_size=1, max_size=10)
    return pool


async def close() -> None:
    global pool
    if pool is not None:
        await pool.close()
        pool = None
