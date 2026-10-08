"""Index documents into pgvector.

    python -m beacon.ingest data/docs            # a folder (recursively)
    python -m beacon.ingest handbook.pdf --team finance

Supported formats:
  * PDF  - one passage set per page, cited as "p.N".
  * Markdown / text - optional front matter (title, team) and "@@ <locator>" lines that
    mark where each page or section starts, e.g. "@@ p.12" or "@@ §3.2".
"""
import argparse
import asyncio
import re
from pathlib import Path
from typing import Iterable, List, Optional, Tuple

import asyncpg

from beacon import db
from beacon.embed import embed_passages

MAX_CHARS = 1200
SUFFIXES = {".md", ".markdown", ".txt", ".pdf"}

Section = Tuple[str, str]  # (locator, text)


def parse_text(path: Path) -> Tuple[dict, List[Section]]:
    raw = path.read_text(encoding="utf-8")
    meta = {}
    front = re.match(r"^---\n(.*?)\n---\n", raw, re.S)
    if front:
        for line in front.group(1).splitlines():
            key, _, value = line.partition(":")
            meta[key.strip()] = value.strip()
        raw = raw[front.end():]

    sections: List[Section] = []
    locator, lines = "", []
    for line in raw.splitlines():
        if line.startswith("@@ "):
            if "".join(lines).strip():
                sections.append((locator, "\n".join(lines).strip()))
            locator, lines = line[3:].strip(), []
        else:
            lines.append(line)
    if "".join(lines).strip():
        sections.append((locator, "\n".join(lines).strip()))
    return meta, sections


def parse_pdf(path: Path) -> Tuple[dict, List[Section]]:
    from pypdf import PdfReader

    reader = PdfReader(str(path))
    meta = {}
    if reader.metadata and reader.metadata.title:
        meta["title"] = reader.metadata.title
    sections = [
        (f"p.{n}", text.strip())
        for n, page in enumerate(reader.pages, start=1)
        if (text := page.extract_text() or "").strip()
    ]
    return meta, sections


def split(text: str, max_chars: int = MAX_CHARS) -> Iterable[str]:
    """Pack paragraphs into passages of at most ~max_chars."""
    buf = ""
    for para in re.split(r"\n\s*\n", text):
        para = para.strip()
        if not para:
            continue
        if buf and len(buf) + len(para) + 2 > max_chars:
            yield buf
            buf = ""
        while len(para) > max_chars:
            yield para[:max_chars]
            para = para[max_chars:]
        buf = f"{buf}\n\n{para}" if buf else para
    if buf:
        yield buf


async def ingest_file(conn: asyncpg.Connection, path: Path, team: Optional[str] = None) -> int:
    meta, sections = parse_pdf(path) if path.suffix.lower() == ".pdf" else parse_text(path)
    title = meta.get("title") or path.stem.replace("-", " ").replace("_", " ").title()
    team = team or meta.get("team") or "all"

    passages = [(loc or "p.1", chunk) for loc, text in sections for chunk in split(text)]
    if not passages:
        return 0
    # Embed "title + location + text" so a passage still carries its context on its own.
    vectors = embed_passages([f"{title} · {loc}\n{chunk}" for loc, chunk in passages])

    async with conn.transaction():
        await conn.execute("DELETE FROM documents WHERE path = $1", str(path))
        doc_id = await conn.fetchval(
            "INSERT INTO documents (title, path, team) VALUES ($1, $2, $3) RETURNING id",
            title, str(path), team,
        )
        await conn.executemany(
            "INSERT INTO chunks (document_id, locator, content, embedding) VALUES ($1, $2, $3, $4)",
            [(doc_id, loc, chunk, vec) for (loc, chunk), vec in zip(passages, vectors)],
        )
    return len(passages)


def collect(paths: Iterable[str]) -> List[Path]:
    files: List[Path] = []
    for p in map(Path, paths):
        if p.is_dir():
            files += sorted(f for f in p.rglob("*") if f.suffix.lower() in SUFFIXES)
        elif p.suffix.lower() in SUFFIXES:
            files.append(p)
    return [f.resolve() for f in files]


async def ingest(paths: Iterable[str], team: Optional[str] = None) -> None:
    pool = await db.connect()
    async with pool.acquire() as conn:
        for path in collect(paths):
            count = await ingest_file(conn, path, team)
            print(f"  indexed {count:>3} passages  {path.name}")


def main() -> None:
    parser = argparse.ArgumentParser(description="Index documents for Beacon")
    parser.add_argument("paths", nargs="+")
    parser.add_argument("--team", help="restrict these documents to one team (default: front matter or 'all')")
    args = parser.parse_args()

    async def run():
        try:
            await ingest(args.paths, args.team)
        finally:
            await db.close()

    asyncio.run(run())


if __name__ == "__main__":
    main()
