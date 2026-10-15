# Agent notes for Arachne

## UI rules

The web app follows the [Vercel Web Interface Guidelines](https://vercel.com/design/guidelines).
Keep these when changing `arachne/static/`:

- **Keyboard & focus:** everything works by keyboard, focus rings are visible (`:focus-visible`), and
  dialogs use native `<dialog>` so focus is trapped & restored.
- **Hit targets:** at least 24px, or 44px on touch (`--hit`); small targets like `.cite` get a
  `::before` hit area.
- **Inputs:** 16px or larger (no iOS zoom). Labels on every control, `autocomplete` and `name` set,
  `spellcheck="false"` on emails & codes.
- **Forms:** don't pre-disable submit. Show errors next to the field and focus the first one. A
  submit in progress keeps its label and adds a spinner after 150ms.
- **Destructive actions** offer Undo (chats are soft-deleted, see `POST /chats/{id}/restore`).
  Mutations are optimistic and roll back with a toast.
- **URL is state:** `/c/{id}` for chats, `?settings=<section>` for the settings dialog, `?ask=` to
  prefill a question. Links are real `<a>` elements (modifier-click works).
- **Motion:**
  - Honour `motionReduced()` from `js/theme.js` (system setting or the in-app Motion setting).
  - Animate only transform & opacity, and never use `transition: all`.
  - Long loops need a pause control.
  - Prefer CSS; GSAP is for orchestrated sequences and the Three.js uniforms.
- **Content:**
  - Title Case for headings & buttons.
  - Use "&" over "and" in UI copy, the `…` character, and curly quotes.
  - Use tabular numbers for stats and `Intl` for numbers & dates.
  - Design the empty, error & dense states.
- **Colour:**
  - All colours come from CSS tokens set by `applyTheme()`. Never hard-code a hex in components.
  - The 3D scenes read the same tokens via `readTokens()` and repaint on the `arachne:theme` event.
- **Announce async updates:** use `announce()` (polite live region) and `toast()`.

## Backend

- Python 3.9-compatible (no `X | Y` types, no `match`).
- Claude calls stay in `arachne/api.py`: model `claude-opus-5-5`, streamed, effort from `ARACHNE_EFFORT`.
- The dev database is `arachne_app`. A separate, unrelated `beacon` database exists on the author's
  machine, so don't touch it.
