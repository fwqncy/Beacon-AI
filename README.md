# Beacon

**AI knowledge assistant.** An internal assistant that answers staff questions from company documents and shows the exact page each answer came from.

Built with **Python**, **FastAPI**, **pgvector** and the **Claude API**. It ships with a seeded dataset of sample company documents, and every answer links back to its source page.

## Run it

You need Python 3.9+, Postgres with the [pgvector](https://github.com/pgvector/pgvector) extension, and a Claude API key.

```bash
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env              # then set ANTHROPIC_API_KEY (and DATABASE_URL if needed)
python -m beacon.seed             # creates the database, indexes data/docs, adds demo users
uvicorn beacon.api:app --reload   # http://localhost:8000
```

No local Postgres? Run `docker compose up -d` and set
`DATABASE_URL=postgresql://beacon:beacon@localhost:5433/beacon_app`.

Demo accounts (password `beacon123`):

| Email | Team | Sees |
|---|---|---|
| `demo@beacon.dev` | engineering | company-wide docs + Engineering Onboarding Guide |
| `finance@beacon.dev` | finance | company-wide docs + Finance Approval Matrix |

You can also create an account from the sign-in page.

## How it works

```
question ─▶ embed (bge-small, local) ─▶ pgvector search, filtered to the user's team
         ─▶ no hits?  answer: None, "no matching documents"
         ─▶ build_prompt(question, numbered sources) ─▶ Claude, streamed ─▶ text … then cite(hits)
```

* `beacon/api.py`: the `/ask` endpoint and `search()`. Answers stream as plain text; after the
  answer, a `\x1e` separator is followed by a JSON list of sources. Passages that a hit refers to
  ("see Procurement policy §3.2") are pulled in as extra sources.
* `beacon/prompts.py`: the system prompt, the numbered-source prompt and the citation payload.
* `beacon/ingest.py`: indexes Markdown/text (with `@@ p.12` / `@@ §3.2` page/section markers) and
  PDFs (page by page). Each passage keeps its locator, so a citation says *IT Handbook · p.12*.
* `beacon/auth.py`, `beacon/chats.py`: accounts, cookie sessions, and chat history.
* `beacon/static/`: the web app (vanilla HTML/CSS/JS, no build step).

## Add your own documents

```bash
python -m beacon.ingest path/to/folder               # .md .txt .pdf, recursively
python -m beacon.ingest finance-handbook.pdf --team finance
```

Re-ingesting a file replaces its previous passages. Documents are visible to everyone (`team: all`)
unless they're restricted to a team, either through front matter or with `--team`.

## Configuration

See `.env.example`. The defaults are `claude-opus-5-5` at `low` effort, 6 passages per question, and a
0.55 similarity floor. Below that floor, Beacon says it couldn't find an answer instead of guessing.
