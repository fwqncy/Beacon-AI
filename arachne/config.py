"""Runtime settings, read from the environment (and .env if present)."""
import os
from pathlib import Path

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parent.parent
load_dotenv(ROOT / ".env")

DATABASE_URL = os.getenv("DATABASE_URL", "postgresql://localhost/arachne_app")

# Claude
MODEL = os.getenv("ARACHNE_MODEL", "claude-opus-5-5")
EFFORT = os.getenv("ARACHNE_EFFORT", "low")  # short, grounded answers don't need deep thinking

# Retrieval
EMBED_MODEL = "BAAI/bge-small-en-v1.5"
EMBED_DIM = 384
TOP_K = int(os.getenv("ARACHNE_TOP_K", "6"))
MIN_SCORE = float(os.getenv("ARACHNE_MIN_SCORE", "0.55"))  # cosine similarity floor for a "hit"

# Auth
SESSION_COOKIE = "arachne_session"
SESSION_DAYS = int(os.getenv("ARACHNE_SESSION_DAYS", "14"))
COOKIE_SECURE = os.getenv("ARACHNE_COOKIE_SECURE", "false").lower() == "true"

# Every user belongs to one team; documents are visible to "all" or to a single team.
TEAMS = ["engineering", "finance", "people", "sales", "operations"]

DOCS_DIR = ROOT / "data" / "docs"
STATIC_DIR = Path(__file__).resolve().parent / "static"
