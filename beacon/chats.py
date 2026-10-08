"""Chat and message persistence."""
import json
import uuid
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException

from beacon import db
from beacon.auth import User, current_user

router = APIRouter(prefix="/chats", tags=["chats"])

HISTORY_TURNS = 10  # previous messages sent back to Claude for follow-up context


def _title(text: str) -> str:
    text = " ".join(text.split())
    return text if len(text) <= 60 else text[:57].rstrip() + "…"


async def open_chat(chat_id: Optional[str], user: User, first_message: str) -> str:
    """Return an existing chat owned by the user, or start a new one."""
    if chat_id:
        try:
            uuid.UUID(chat_id)
        except ValueError:
            raise HTTPException(status_code=404, detail="Chat not found")
        found = await db.pool.fetchval(
            "SELECT id::text FROM chats WHERE id = $1 AND user_id = $2", chat_id, user.id
        )
        if not found:
            raise HTTPException(status_code=404, detail="Chat not found")
        return found
    return await db.pool.fetchval(
        "INSERT INTO chats (user_id, title) VALUES ($1, $2) RETURNING id::text",
        user.id, _title(first_message),
    )


async def history(chat_id: str) -> List[dict]:
    rows = await db.pool.fetch(
        """SELECT role, content FROM (
               SELECT id, role, content FROM messages WHERE chat_id = $1 ORDER BY id DESC LIMIT $2
           ) recent ORDER BY id""",
        chat_id, HISTORY_TURNS,
    )
    turns = [{"role": r["role"], "content": r["content"]} for r in rows if r["content"].strip()]
    while turns and turns[0]["role"] != "user":  # the API expects the first turn to be the user's
        turns.pop(0)
    return turns


async def add_message(chat_id: str, role: str, content: str, sources: Optional[list] = None) -> None:
    async with db.pool.acquire() as conn, conn.transaction():
        await conn.execute(
            "INSERT INTO messages (chat_id, role, content, sources) VALUES ($1, $2, $3, $4::jsonb)",
            chat_id, role, content, json.dumps(sources or []),
        )
        await conn.execute("UPDATE chats SET updated_at = now() WHERE id = $1", chat_id)


@router.get("")
async def list_chats(user: User = Depends(current_user)) -> list:
    rows = await db.pool.fetch(
        "SELECT id::text, title, updated_at FROM chats WHERE user_id = $1 ORDER BY updated_at DESC LIMIT 100",
        user.id,
    )
    return [dict(r) for r in rows]


@router.get("/{chat_id}")
async def get_chat(chat_id: str, user: User = Depends(current_user)) -> dict:
    chat_id = await open_chat(chat_id, user, "")
    chat = await db.pool.fetchrow("SELECT id::text, title FROM chats WHERE id = $1", chat_id)
    rows = await db.pool.fetch(
        "SELECT role, content, sources FROM messages WHERE chat_id = $1 ORDER BY id", chat_id
    )
    messages = [
        {"role": r["role"], "content": r["content"], "sources": json.loads(r["sources"])} for r in rows
    ]
    return {**dict(chat), "messages": messages}


@router.delete("/{chat_id}")
async def delete_chat(chat_id: str, user: User = Depends(current_user)) -> dict:
    chat_id = await open_chat(chat_id, user, "")
    await db.pool.execute("DELETE FROM chats WHERE id = $1", chat_id)
    return {"ok": True}
