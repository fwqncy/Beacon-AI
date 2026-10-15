"""What Arachne learns: preferences, the user's knowledge web, Spider-Sense suggestions.

Everything here is derived from the user's own chats, so it's explainable and
disappears when they delete those chats. Nothing calls the model.
"""
import json
import re
from collections import Counter, defaultdict
from datetime import date, datetime, timedelta, timezone
from typing import Dict, List, Literal, Optional, Tuple

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field

from arachne import db
from arachne.auth import User, current_user
from arachne.config import EFFORT, MODEL, TOP_K
from arachne.prompts import NO_ANSWER, Hit, cited_numbers

router = APIRouter(tags=["insights"])

# ---------------------------------------------------------------- preferences

Theme = Literal["maroon", "goldnavy", "rose", "violet", "custom"]
Style = Literal["concise", "balanced", "detailed"]
Motion = Literal["system", "reduce", "full"]
HEX = r"^#[0-9a-fA-F]{6}$"


class Prefs(BaseModel):
    theme: Theme = "maroon"
    accent: str = Field("#a3213a", pattern=HEX)  # used when theme == "custom"
    tailor: bool = True  # add the learned profile to each question
    style: Style = "balanced"
    motion: Motion = "system"


class PrefsPatch(BaseModel):
    theme: Optional[Theme] = None
    accent: Optional[str] = Field(None, pattern=HEX)
    tailor: Optional[bool] = None
    style: Optional[Style] = None
    motion: Optional[Motion] = None


async def get_prefs(user_id: int) -> Prefs:
    raw = await db.pool.fetchval("SELECT prefs FROM users WHERE id = $1", user_id)
    stored = json.loads(raw) if raw else {}
    return Prefs(**{k: v for k, v in stored.items() if k in Prefs.model_fields})


@router.patch("/me/prefs")
async def update_prefs(body: PrefsPatch, user: User = Depends(current_user)) -> Prefs:
    prefs = (await get_prefs(user.id)).model_copy(update=body.model_dump(exclude_none=True))
    await db.pool.execute("UPDATE users SET prefs = $2::jsonb WHERE id = $1", user.id, prefs.model_dump_json())
    return prefs


# ---------------------------------------------------------------- ranks

RANKS = [  # (questions needed, name)
    (0, "Spiderling"), (3, "Thread Spinner"), (10, "Web Weaver"),
    (25, "Orb Weaver"), (50, "Silk Architect"), (100, "Arachne Sentinel"),
]


def rank_for(questions: int) -> dict:
    level = max(i for i, (need, _) in enumerate(RANKS) if questions >= need)
    need, name = RANKS[level]
    nxt = RANKS[level + 1] if level + 1 < len(RANKS) else None
    return {
        "level": level + 1, "name": name, "questions": questions,
        "next_name": nxt[1] if nxt else None, "next_at": nxt[0] if nxt else None, "floor": need,
    }


# ---------------------------------------------------------------- activity

STYLE_HINTS = {
    "concise": "Prefers concise answers: the answer first, in as few sentences as possible.",
    "balanced": "Prefers balanced answers: the answer first, then only the steps that matter.",
    "detailed": "Prefers detailed answers: walk through each step and mention related rules.",
}


def _heading(content: str) -> str:
    first = content.strip().splitlines()[0] if content.strip() else ""
    return re.sub(r"^#+\s*", "", first).strip() if first.startswith("#") else ""


async def _activity(user_id: int, limit: int = 2000) -> List[dict]:
    """The user's recent messages, oldest first, with chat info."""
    rows = await db.pool.fetch(
        """SELECT * FROM (
               SELECT m.id, m.chat_id::text, c.title AS chat_title, c.created_at AS chat_created,
                      m.role, m.content, m.sources, m.feedback, m.usage, m.created_at
               FROM messages m JOIN chats c ON c.id = m.chat_id
               WHERE c.user_id = $1 AND c.deleted_at IS NULL
               ORDER BY m.id DESC LIMIT $2
           ) recent ORDER BY id""",
        user_id, limit,
    )
    return [dict(r) for r in rows]


def _cited_sections(message: dict) -> List[Tuple[str, str]]:
    """(title, locator) pairs an assistant answer cited."""
    sources = {s["n"]: s for s in json.loads(message["sources"] or "[]")}
    return [(sources[n]["title"], sources[n]["locator"]) for n in sorted(cited_numbers(message["content"])) if n in sources]


async def learned_profile(user: User, prefs: Prefs, messages: Optional[List[dict]] = None) -> dict:
    messages = messages if messages is not None else await _activity(user.id, limit=400)
    topics = Counter(title for m in messages if m["role"] == "assistant" for title, _ in _cited_sections(m))
    top = [t for t, _ in topics.most_common(3)]
    lines = [f"Name: {user.name}. Team: {user.team}."]
    if top:
        lines.append("Often asks about: " + ", ".join(top) + ".")
    lines.append(STYLE_HINTS[prefs.style])
    return {
        "topics": [{"title": t, "count": c} for t, c in topics.most_common(6)],
        "context": "<about_user>\n" + "\n".join(lines) + "\n</about_user>",
    }


async def prompt_profile(user: User) -> Optional[str]:
    """The <about_user> block added to each question, or None if the user turned tailoring off."""
    prefs = await get_prefs(user.id)
    if not prefs.tailor:
        return None
    return (await learned_profile(user, prefs))["context"]


# ---------------------------------------------------------------- Spider-Sense

def _question_for(title: str, heading: str, locator: str) -> str:
    topic = re.sub(r"^\d+(\.\d+)*\s+", "", heading).strip() or locator
    if len(topic) > 1 and topic[1:2].islower():
        topic = topic[0].lower() + topic[1:]
    return f"What does the {title} say about {topic}?"


async def spider_sense(answer: str, hits: List[Hit], team: str, limit: int = 3) -> List[dict]:
    """Passages that sit next to what the answer cited, but weren't part of it."""
    cited = [hits[n - 1].id for n in cited_numbers(answer) if 1 <= n <= len(hits)]
    if not cited:
        return []
    rows = await db.pool.fetch(
        """WITH centre AS (SELECT avg(embedding) AS v FROM chunks WHERE id = ANY($1::int[]))
           SELECT d.title, c.locator, c.content, 1 - (c.embedding <=> centre.v) AS score
           FROM chunks c JOIN documents d ON d.id = c.document_id, centre
           WHERE d.team IN ('all', $2) AND c.id <> ALL($3::int[])
           ORDER BY c.embedding <=> centre.v
           LIMIT 12""",
        cited, team, [h.id for h in hits],
    )
    seen = {(h.title, h.locator) for h in hits}
    related = []
    for r in rows:
        key = (r["title"], r["locator"])
        if key in seen or r["score"] < 0.5:
            continue
        seen.add(key)
        heading = _heading(r["content"])
        related.append({
            "title": r["title"], "locator": r["locator"], "heading": heading or r["locator"],
            "question": _question_for(r["title"], heading, r["locator"]),
        })
        if len(related) == limit:
            break
    return related


# ---------------------------------------------------------------- the web

async def _knowledge_base(team: str) -> List[dict]:
    rows = await db.pool.fetch(
        """SELECT d.id, d.title, d.team, c.locator, c.content
           FROM documents d JOIN chunks c ON c.document_id = d.id
           WHERE d.team IN ('all', $1)
           ORDER BY d.title, c.id""",
        team,
    )
    docs: Dict[int, dict] = {}
    for r in rows:
        doc = docs.setdefault(r["id"], {"id": r["id"], "title": r["title"], "team": r["team"], "sections": {}})
        doc["sections"].setdefault(r["locator"], _heading(r["content"]) or r["locator"])
    return [
        {**d, "sections": [{"locator": loc, "heading": h} for loc, h in d["sections"].items()]}
        for d in docs.values()
    ]


async def kb_stats(team: str) -> dict:
    row = await db.pool.fetchrow(
        """SELECT count(DISTINCT d.id) AS documents, count(c.id) AS passages
           FROM documents d JOIN chunks c ON c.document_id = d.id WHERE d.team IN ('all', $1)""",
        team,
    )
    return dict(row)


async def question_count(user_id: int) -> int:
    return await db.pool.fetchval(
        """SELECT count(*) FROM messages m JOIN chats c ON c.id = m.chat_id
           WHERE c.user_id = $1 AND c.deleted_at IS NULL AND m.role = 'user'""",
        user_id,
    )


def _streak(days: List[date]) -> int:
    have = set(days)
    today = datetime.now(timezone.utc).date()
    day = today if today in have else today - timedelta(days=1)
    streak = 0
    while day in have:
        streak += 1
        day -= timedelta(days=1)
    return streak


@router.get("/web/data")
async def web_data(user: User = Depends(current_user)) -> dict:
    prefs = await get_prefs(user.id)
    messages = await _activity(user.id)
    docs = await _knowledge_base(user.team)

    visits: Counter = Counter()
    edges: Counter = Counter()
    chats: Dict[str, dict] = {}
    gaps, asked_at = [], []
    answered = grounded = helpful = unhelpful = tokens_in = tokens_out = 0
    last_question: Dict[str, dict] = {}

    for m in messages:
        chat = chats.setdefault(m["chat_id"], {
            "id": m["chat_id"], "title": m["chat_title"], "created_at": m["chat_created"],
            "questions": 0, "cited": [],
        })
        if m["role"] == "user":
            chat["questions"] += 1
            asked_at.append(m["created_at"])
            last_question[m["chat_id"]] = m
            continue

        answered += 1
        sections = _cited_sections(m)
        keys = sorted({f"{t}|{loc}" for t, loc in sections})
        if keys:
            grounded += 1
        visits.update(keys)
        for i, a in enumerate(keys):
            for b in keys[i + 1:]:
                edges[(a, b)] += 1
        chat["cited"] = sorted(set(chat["cited"]) | set(keys))

        if m["feedback"] == 1:
            helpful += 1
        elif m["feedback"] == -1:
            unhelpful += 1
        usage = json.loads(m["usage"]) if m["usage"] else {}
        tokens_in += usage.get("input_tokens", 0)
        tokens_out += usage.get("output_tokens", 0)

        question = last_question.get(m["chat_id"])
        no_sources = m["content"] == NO_ANSWER
        if question and (no_sources or m["feedback"] == -1):
            gaps.append({
                "question": question["content"], "chat_id": m["chat_id"], "at": m["created_at"],
                "reason": "No Sources" if no_sources else "Marked Unhelpful",
            })

    for doc in docs:
        for s in doc["sections"]:
            s["visits"] = visits.get(f"{doc['title']}|{s['locator']}", 0)

    questions = len(asked_at)
    profile = await learned_profile(user, prefs, messages)
    sections_total = sum(len(d["sections"]) for d in docs)
    return {
        "user": {"name": user.name, "team": user.team},
        "documents": docs,
        "chats": sorted(chats.values(), key=lambda c: c["created_at"]),
        "edges": [{"a": a, "b": b, "weight": w} for (a, b), w in edges.most_common(60)],
        "gaps": list(reversed(gaps))[:12],
        "activity": [t.isoformat() for t in asked_at[-500:]],
        "stats": {
            "questions": questions,
            "chats": len(chats),
            "answers": answered,
            "grounded": grounded,
            "helpful": helpful,
            "unhelpful": unhelpful,
            "documents_explored": len({k.split("|", 1)[0] for k in visits}),
            "documents_total": len(docs),
            "sections_explored": len(visits),
            "sections_total": sections_total,
            "streak": _streak([t.date() for t in asked_at]),
            "tokens_in": tokens_in,
            "tokens_out": tokens_out,
        },
        "rank": rank_for(questions),
        "profile": {
            "tailor": prefs.tailor, "style": prefs.style,
            "topics": profile["topics"], "context": profile["context"],
        },
        "engine": {"model": MODEL, "effort": EFFORT, "top_k": TOP_K},
    }


@router.get("/me")
async def me(user: User = Depends(current_user)) -> dict:
    return {
        **user.model_dump(),
        "prefs": (await get_prefs(user.id)).model_dump(),
        "kb": await kb_stats(user.team),
        "rank": rank_for(await question_count(user.id)),
    }
