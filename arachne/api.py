# arachne/api.py: grounded answers, streamed with citations
import asyncio
import re
from contextlib import asynccontextmanager
from typing import List, Optional

import anthropic
from anthropic import AsyncAnthropic
from fastapi import Depends, FastAPI
from fastapi.responses import FileResponse, RedirectResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from arachne import auth, chats, db, insights
from arachne.auth import User, current_user, optional_user
from arachne.config import EFFORT, MIN_SCORE, MODEL, STATIC_DIR, TOP_K
from arachne.embed import embed, warm
from arachne.prompts import NO_ANSWER, SYSTEM_PROMPT, Hit, build_prompt, cite, sources_payload


@asynccontextmanager
async def lifespan(_: FastAPI):
    await db.connect()
    asyncio.get_running_loop().run_in_executor(None, warm)  # load the embedding model in the background
    yield
    await db.close()


app = FastAPI(title="Arachne", lifespan=lifespan)
app.include_router(auth.router)
app.include_router(chats.router)
app.include_router(chats.messages_router)
app.include_router(insights.router)
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")


@app.middleware("http")
async def revalidate(request, call_next):
    """Browsers must re-check our own pages & scripts (cheap 304s via ETag), so updates show up on reload.
    Pinned third-party libraries in /static/vendor can be cached for a long time."""
    response = await call_next(request)
    path = request.url.path
    if path.startswith("/static/vendor/"):
        response.headers["Cache-Control"] = "public, max-age=31536000, immutable"
    elif path.startswith("/static/") or response.headers.get("content-type", "").startswith("text/html"):
        response.headers["Cache-Control"] = "no-cache"
    return response

client = AsyncAnthropic()


class Question(BaseModel):
    text: str = Field(min_length=1, max_length=4000)
    chat_id: Optional[str] = None


@app.post("/ask")
async def ask(q: Question, user: User = Depends(current_user)):
    chat_id = await chats.open_chat(q.chat_id, user, first_message=q.text)
    history = await chats.history(chat_id)
    await chats.add_message(chat_id, "user", q.text)

    hits = await search(retrieval_query(q.text, history), team=user.team, k=TOP_K)
    if not hits:
        message_id = await chats.add_message(chat_id, "assistant", NO_ANSWER)
        return {
            "answer": None, "reason": "no matching documents",
            "message": NO_ANSWER, "chat_id": chat_id, "message_id": message_id,
        }

    prompt = build_prompt(q.text, hits, profile=await insights.prompt_profile(user))

    async def stream():
        answer, usage = [], None
        try:
            async with client.messages.stream(
                model=MODEL,
                max_tokens=800,
                system=SYSTEM_PROMPT,
                messages=[*history, {"role": "user", "content": prompt}],
                # Claude Opus 5.5 always thinks; low effort keeps grounded Q&A fast and inside the token cap.
                # Server-side fallback reroutes a safety-classifier refusal instead of returning nothing.
                extra_body={"output_config": {"effort": EFFORT}, "fallbacks": "default"},
                extra_headers={"anthropic-beta": "server-side-fallback-2026-07-01"},
            ) as s:
                async for text in s.text_stream:
                    answer.append(text)
                    yield text
                final = await s.get_final_message()
            usage = {"input_tokens": final.usage.input_tokens, "output_tokens": final.usage.output_tokens}
            if final.stop_reason == "refusal" and not answer:
                answer.append("Arachne can't help with that request.")
                yield answer[-1]
            elif final.stop_reason == "max_tokens":
                answer.append(" …")
                yield answer[-1]
        except (anthropic.AuthenticationError, TypeError) as e:
            if isinstance(e, TypeError) and "authentication" not in str(e):
                raise  # a real bug, not the SDK reporting missing credentials
            answer.append("Arachne isn't connected to Claude yet: set `ANTHROPIC_API_KEY` in `.env` and restart.")
            yield answer[-1]
        except anthropic.RateLimitError:
            answer.append("Arachne is getting a lot of questions right now. Please try again in a moment.")
            yield answer[-1]
        except (anthropic.APIStatusError, anthropic.APIConnectionError) as e:
            answer.append(f"Arachne couldn't reach Claude ({type(e).__name__}). Please try again.")
            yield answer[-1]
        finally:
            message_id = await chats.add_message(chat_id, "assistant", "".join(answer), sources_payload(hits), usage)
        related = await insights.spider_sense("".join(answer), hits, user.team)
        await chats.set_related(message_id, related)
        yield cite(hits, related, message_id)

    return StreamingResponse(
        stream(), media_type="text/plain; charset=utf-8", headers={"X-Chat-Id": chat_id}
    )


async def search(text: str, team: str, k: int) -> List[Hit]:
    vec = await embed(text)
    rows = await db.pool.fetch(
        """SELECT c.id, d.title, c.locator, c.content, 1 - (c.embedding <=> $1) AS score
           FROM chunks c JOIN documents d ON d.id = c.document_id
           WHERE d.team IN ('all', $2)
           ORDER BY c.embedding <=> $1
           LIMIT $3""",
        vec, team, k,
    )
    hits = [Hit(**dict(r)) for r in rows if r["score"] >= MIN_SCORE]
    return hits + await follow_references(hits, team)


REFERENCE = re.compile(r"\b([A-Z][\w&]*(?: [\w&]+){0,4}) (§\d+(?:\.\d+)*|p\.\d+)")


async def follow_references(hits: List[Hit], team: str, limit: int = 2) -> List[Hit]:
    """Pull in passages that a hit points to, e.g. "see Procurement policy §3.2"."""
    have = {(h.title.lower(), h.locator) for h in hits}
    extra: List[Hit] = []
    for name, locator in (m.groups() for h in hits for m in REFERENCE.finditer(h.content)):
        name = name.removeprefix("see ").removeprefix("See ")
        if len(extra) >= limit or (name.lower(), locator) in have:
            continue
        row = await db.pool.fetchrow(
            """SELECT c.id, d.title, c.locator, c.content, 0.0::float8 AS score
               FROM chunks c JOIN documents d ON d.id = c.document_id
               WHERE lower(d.title) = lower($1) AND c.locator = $2 AND d.team IN ('all', $3)
               LIMIT 1""",
            name, locator, team,
        )
        if row:
            have.add((name.lower(), locator))
            extra.append(Hit(**dict(row)))
    return extra


FOLLOW_UP = re.compile(
    r"^(and|but|also|so|then|what about|how about|what if)\b|\b(it|its|that|this|they|them|those|these|there)\b",
    re.I,
)


def retrieval_query(text: str, history: List[dict]) -> str:
    """Follow-ups ("what about contractors?") search better with the previous question attached."""
    previous = [m["content"] for m in history if m["role"] == "user"]
    if previous and len(text.split()) < 12 and FOLLOW_UP.search(text):
        return f"{previous[-1]}\n{text}"
    return text


@app.get("/")
async def index(user: Optional[User] = Depends(optional_user)):
    if user is None:
        return RedirectResponse("/login")
    return FileResponse(STATIC_DIR / "app.html")


@app.get("/c/{chat_id}")
async def chat_page(chat_id: str, user: Optional[User] = Depends(optional_user)):
    return await index(user)


@app.get("/web")
async def web_page(user: Optional[User] = Depends(optional_user)):
    if user is None:
        return RedirectResponse("/login")
    return FileResponse(STATIC_DIR / "web.html")


@app.get("/login")
async def login_page(user: Optional[User] = Depends(optional_user)):
    if user is not None:
        return RedirectResponse("/")
    return FileResponse(STATIC_DIR / "login.html")
