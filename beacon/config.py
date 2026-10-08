"""Runtime settings, read from the environment (and .env if present)."""
import os
from pathlib import Path

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parent.parent
load_dotenv(ROOT / ".env")

DATABASE_URL = os.getenv("DATABASE_URL", "postgresql://localhost/beacon_app")

# Claude
MODEL = os.getenv("BEACON_MODEL", "claude-opus-5-5")
EFFORT = os.getenv("BEACON_EFFORT", "low")  # short, grounded answers don't need deep thinking

# Retrieval
EMBED_MODEL = "BAAI/bge-small-en-v1.5"
EMBED_DIM = 384
TOP_K = int(os.getenv("BEACON_TOP_K", "6"))
MIN_SCORE = float(os.getenv("BEACON_MIN_SCORE", "0.55"))  # cosine similarity floor for a "hit"

# Auth
SESSION_COOKIE = "beacon_session"
SESSION_DAYS = int(os.getenv("BEACON_SESSION_DAYS", "14"))
COOKIE_SECURE = os.getenv("BEACON_COOKIE_SECURE", "false").lower() == "true"

# Every user belongs to one team; documents are visible to "all" or to a single team.
TEAMS = ["engineering", "finance", "people", "sales", "operations"]

DOCS_DIR = ROOT / "data" / "docs"
STATIC_DIR = Path(__file__).resolve().parent / "static"
