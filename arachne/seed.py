"""Create the database, index the sample company documents and add demo accounts.

    python -m arachne.seed
"""
import asyncio

from arachne import db
from arachne.auth import create_user
from arachne.config import DOCS_DIR
from arachne.ingest import ingest

DEMO_USERS = [
    # (name, email, password, team)
    ("Sam Rivera", "demo@arachne.dev", "arachne123", "engineering"),
    ("Jordan Lee", "finance@arachne.dev", "arachne123", "finance"),
]


async def seed() -> None:
    await db.connect()
    try:
        print(f"Indexing sample documents from {DOCS_DIR} …")
        await ingest([str(DOCS_DIR)])
        for name, email, password, team in DEMO_USERS:
            if await db.pool.fetchval("SELECT 1 FROM users WHERE email = $1", email):
                continue
            await create_user(name, email, password, team)
            print(f"  created user {email} / {password} ({team})")
        docs = await db.pool.fetchval("SELECT count(*) FROM documents")
        chunks = await db.pool.fetchval("SELECT count(*) FROM chunks")
        print(f"Done: {docs} documents, {chunks} passages.")
    finally:
        await db.close()


if __name__ == "__main__":
    asyncio.run(seed())
