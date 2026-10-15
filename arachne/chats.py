"""Chat and message persistence."""
import json
import uuid
from typing import List, Literal, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from arachne import db
from arachne.auth import User, current_user

router = APIRouter(prefix="/chats", tags=["chats"])
messages_router = APIRouter(prefix="/messages", tags=["chats"])

HISTORY_TURNS = 10  # previous messages sent back to Claude for follow-up context


def _title(text: str) -> str:
    text = " ".join(text.split())
    return text if len(text) <= 60 else text[:59].rstrip() + "…"


async def _owned_chat(chat_id: str, user: User, include_deleted: bool = False) -> str:
    try:
        uuid.UUID(chat_id)
    except ValueError:
        raise HTTPException(status_code=404, detail="Chat not found")
    found = await db.pool.fetchval(
        "SELECT id::text FROM chats WHERE id = $1 AND user_id = $2 AND ($3 OR deleted_at IS NULL)",
        chat_id, user.id, include_deleted,
    )
    if not found:
        raise HTTPException(status_code=404, detail="Chat not found")
    return found


async def open_chat(chat_id: Optional[str], user: User, first_message: str) -> str:
    """Return an existing chat owned by the user, or start a new one."""
    if chat_id:
        return await _owned_chat(chat_id, user)
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


async def add_message(
    chat_id: str, role: str, content: str, sources: Optional[list] = None, usage: Optional[dict] = None
) -> int:
    async with db.pool.acquire() as conn, conn.transaction():
        message_id = await conn.fetchval(
            """INSERT INTO messages (chat_id, role, content, sources, usage)
               VALUES ($1, $2, $3, $4::jsonb, $5::jsonb) RETURNING id""",
            chat_id, role, content, json.dumps(sources or []), json.dumps(usage) if usage else None,
        )
        await conn.execute("UPDATE chats SET updated_at = now() WHERE id = $1", chat_id)
    return message_id


async def set_related(message_id: int, related: list) -> None:
    await db.pool.execute("UPDATE messages SET related = $2::jsonb WHERE id = $1", message_id, json.dumps(related))


@router.get("")
async def list_chats(user: User = Depends(current_user)) -> list:
    rows = await db.pool.fetch(
        """SELECT id::text, title, updated_at FROM chats
           WHERE user_id = $1 AND deleted_at IS NULL ORDER BY updated_at DESC LIMIT 200""",
        user.id,
    )
    return [dict(r) for r in rows]


@router.get("/{chat_id}")
async def get_chat(chat_id: str, user: User = Depends(current_user)) -> dict:
    chat_id = await _owned_chat(chat_id, user)
    chat = await db.pool.fetchrow("SELECT id::text, title, created_at FROM chats WHERE id = $1", chat_id)
    rows = await db.pool.fetch(
        "SELECT id, role, content, sources, related, feedback FROM messages WHERE chat_id = $1 ORDER BY id",
        chat_id,
    )
    messages = [
        {
            "id": r["id"], "role": r["role"], "content": r["content"], "feedback": r["feedback"],
            "sources": json.loads(r["sources"]), "related": json.loads(r["related"]),
        }
        for r in rows
    ]
    return {**dict(chat), "messages": messages}


@router.delete("/{chat_id}")
async def delete_chat(chat_id: str, user: User = Depends(current_user)) -> dict:
    """Soft delete, so the client can offer Undo."""
    chat_id = await _owned_chat(chat_id, user)
    await db.pool.execute("UPDATE chats SET deleted_at = now() WHERE id = $1", chat_id)
    return {"ok": True}


@router.post("/{chat_id}/restore")
async def restore_chat(chat_id: str, user: User = Depends(current_user)) -> dict:
    chat_id = await _owned_chat(chat_id, user, include_deleted=True)
    await db.pool.execute("UPDATE chats SET deleted_at = NULL WHERE id = $1", chat_id)
    return {"ok": True}


class Feedback(BaseModel):
    value: Literal[-1, 0, 1]  # 0 clears it


@messages_router.post("/{message_id}/feedback")
async def feedback(message_id: int, body: Feedback, user: User = Depends(current_user)) -> dict:
    updated = await db.pool.fetchval(
        """UPDATE messages m SET feedback = $3
           FROM chats c
           WHERE m.id = $1 AND m.chat_id = c.id AND c.user_id = $2 AND m.role = 'assistant'
           RETURNING m.id""",
        message_id, user.id, body.value or None,
    )
    if not updated:
        raise HTTPException(status_code=404, detail="Message not found")
    return {"ok": True, "value": body.value}
