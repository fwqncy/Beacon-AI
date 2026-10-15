# Arachne

**AI knowledge assistant.** An internal assistant that answers staff questions from company documents and shows the exact page each answer came from.

Built with **Python**, **FastAPI**, **pgvector** and the **Claude API**. It ships with a seeded dataset of sample company documents, and every answer links back to its source page.

## Run it

You need Python 3.9+, Postgres with the [pgvector](https://github.com/pgvector/pgvector) extension, and a Claude API key.

```bash
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env              # then set ANTHROPIC_API_KEY (and DATABASE_URL if needed)
python -m arachne.seed             # creates the database, indexes data/docs, adds demo users
uvicorn arachne.api:app --reload   # http://localhost:8000
```

No local Postgres? Run `docker compose up -d` and set
`DATABASE_URL=postgresql://arachne:arachne@localhost:5433/arachne_app`.

Demo accounts (password `arachne123`):

| Email | Team | Sees |
|---|---|---|
| `demo@arachne.dev` | engineering | company-wide docs + Engineering Onboarding Guide |
| `finance@arachne.dev` | finance | company-wide docs + Finance Approval Matrix |

You can also create an account from the sign-in page.

## Features

* **Grounded, cited answers.** Every claim cites a numbered source; click a citation to read the
  exact passage, or open the sources list under the answer.
* **Your Web** (`/web`). Your knowledge, drawn as an orb web in Three.js. Each document anchors a
  spoke, the capture spiral gains rings as you ask more, each chat hangs on it as a dewdrop, and the
  sections Arachne has cited for you light up. Threads join sections cited in the same answer. Your
  rank grows with you (Spiderling → Thread Spinner → Web Weaver → Orb Weaver → Silk Architect →
  Arachne Sentinel).
* **What Arachne has learned.** Topics you ask about, when you ask, how you use the model (tokens,
  grounded rate, helpful votes). With **Tailor Answers to You** on, Arachne adds a short
  `<about_user>` block (name, team, top topics, preferred answer length) to each question, and the
  Your Web page shows exactly what that block says. It's derived from your own chats, so deleting a
  chat forgets it, and the toggle turns it off.
* **Spider-Sense.** After each answer, up to three neighbouring passages you'll probably need next
  (found by embedding distance from what was cited). One click asks about them.
* **Holes in Your Web.** Questions the documents couldn't answer, plus answers marked unhelpful, collected
  in one place: a ready-made list of documentation gaps for document owners.
* **Colour schemes.** Maroon & Knight (the default: Dark Void, Dark Maroon, Maui Mist & Shining
  Knight), Gold & Navy, Spider Rose, Midnight Violet, or **any colour** from the colour wheel. A custom
  accent generates a full, legible dark theme (in OKLCH). Saved to your account.
* **Keyboard first.** <kbd>⌘K</kbd> / <kbd>Ctrl+K</kbd> searches chats, switches themes, or asks
  Arachne directly; <kbd>⇧⌘O</kbd> starts a new chat; <kbd>Esc</kbd> stops an answer.
* **Undo instead of "are you sure?"** Deleting a chat can be undone for a few seconds; feedback and
  settings save optimistically and roll back on failure.
* **Export** any chat as Markdown, with renumbered citations and a source list.
* The chat backdrop is a live Three.js web that **trembles while Arachne is answering**. All motion
  respects reduced-motion (system or the in-app setting), and long animations have pause controls.

The UI follows the [Vercel Web Interface Guidelines](https://vercel.com/design/guidelines); see `AGENTS.md`.

## How it works

```
question ─▶ embed (bge-small, local) ─▶ pgvector search, filtered to the user's team
         ─▶ no hits?  answer: None, "no matching documents"
         ─▶ build_prompt(question, numbered sources) ─▶ Claude, streamed ─▶ text … then cite(hits)
```

* `arachne/api.py`: the `/ask` endpoint and `search()`. Answers stream as plain text; after the
  answer, a `\x1e` separator is followed by a JSON list of sources. Passages that a hit refers to
  ("see Procurement policy §3.2") are pulled in as extra sources.
* `arachne/prompts.py`: the system prompt, the numbered-source prompt and the citation payload.
* `arachne/ingest.py`: indexes Markdown/text (with `@@ p.12` / `@@ §3.2` page/section markers) and
  PDFs (page by page). Each passage keeps its locator, so a citation says *IT Handbook · p.12*.
* `arachne/insights.py`: preferences, the learned profile, Spider-Sense, and the data behind Your Web.
  None of it calls the model.
* `arachne/auth.py`, `arachne/chats.py`: accounts, cookie sessions, chat history, feedback, soft delete.
* `arachne/static/`: the web app. It's plain HTML/CSS and ES modules, with no build step:
  * `js/theme.js` presets & OKLCH theme generation, `js/colorwheel.js`, `js/settings.js`
  * `js/threads.js` Three.js web shaders, the chat backdrop & login orb; `js/constellation.js` Your Web
  * `vendor/` pinned copies of Three.js r186 and GSAP 3.15 (served locally, no CDN at runtime)

## Add your own documents

```bash
python -m arachne.ingest path/to/folder               # .md .txt .pdf, recursively
python -m arachne.ingest finance-handbook.pdf --team finance
```

Re-ingesting a file replaces its previous passages. Documents are visible to everyone (`team: all`)
unless they're restricted to a team, either through front matter or with `--team`.

## Configuration

See `.env.example`. The defaults are `claude-opus-5-5` at `low` effort, 6 passages per question, and a
0.55 similarity floor. Below that floor, Arachne says it couldn't find an answer instead of guessing.
