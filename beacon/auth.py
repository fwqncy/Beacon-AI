"""Email/password accounts with server-side cookie sessions."""
import hashlib
import hmac
import os
import secrets
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, Field

from beacon import db
from beacon.config import COOKIE_SECURE, SESSION_COOKIE, SESSION_DAYS, TEAMS

router = APIRouter(prefix="/auth", tags=["auth"])


class User(BaseModel):
    id: int
    email: str
    name: str
    team: str


class Login(BaseModel):
    email: str
    password: str


class Signup(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    email: str = Field(min_length=3, max_length=200)
    password: str = Field(min_length=6, max_length=200)
    team: str


PBKDF2_ITERATIONS = 600_000


def hash_password(password: str) -> str:
    salt = os.urandom(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, PBKDF2_ITERATIONS)
    return f"pbkdf2_sha256${PBKDF2_ITERATIONS}${salt.hex()}${digest.hex()}"


def verify_password(password: str, stored: str) -> bool:
    try:
        _, iterations, salt, digest = stored.split("$")
        check = hashlib.pbkdf2_hmac("sha256", password.encode(), bytes.fromhex(salt), int(iterations))
    except ValueError:
        return False
    return hmac.compare_digest(check.hex(), digest)


def _token_hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


async def create_user(name: str, email: str, password: str, team: str) -> User:
    row = await db.pool.fetchrow(
        """INSERT INTO users (name, email, team, password_hash) VALUES ($1, $2, $3, $4)
           RETURNING id, email, name, team""",
        name.strip(), email.strip().lower(), team, hash_password(password),
    )
    return User(**dict(row))


async def _start_session(response: Response, user_id: int) -> None:
    token = secrets.token_urlsafe(32)
    expires = datetime.now(timezone.utc) + timedelta(days=SESSION_DAYS)
    await db.pool.execute(
        "INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ($1, $2, $3)",
        _token_hash(token), user_id, expires,
    )
    response.set_cookie(
        SESSION_COOKIE, token, max_age=SESSION_DAYS * 86400,
        httponly=True, samesite="lax", secure=COOKIE_SECURE,
    )


async def optional_user(request: Request) -> Optional[User]:
    token = request.cookies.get(SESSION_COOKIE)
    if not token:
        return None
    row = await db.pool.fetchrow(
        """SELECT u.id, u.email, u.name, u.team FROM sessions s
           JOIN users u ON u.id = s.user_id
           WHERE s.token_hash = $1 AND s.expires_at > now()""",
        _token_hash(token),
    )
    return User(**dict(row)) if row else None


async def current_user(user: Optional[User] = Depends(optional_user)) -> User:
    if user is None:
        raise HTTPException(status_code=401, detail="Not signed in")
    return user


@router.post("/login")
async def login(body: Login, response: Response) -> User:
    row = await db.pool.fetchrow(
        "SELECT id, email, name, team, password_hash FROM users WHERE email = $1",
        body.email.strip().lower(),
    )
    if not row or not verify_password(body.password, row["password_hash"]):
        raise HTTPException(status_code=401, detail="Incorrect email or password")
    await _start_session(response, row["id"])
    return User(id=row["id"], email=row["email"], name=row["name"], team=row["team"])


@router.post("/signup")
async def signup(body: Signup, response: Response) -> User:
    if body.team not in TEAMS:
        raise HTTPException(status_code=400, detail="Unknown team")
    if "@" not in body.email:
        raise HTTPException(status_code=400, detail="Enter a valid email address")
    exists = await db.pool.fetchval("SELECT 1 FROM users WHERE email = $1", body.email.strip().lower())
    if exists:
        raise HTTPException(status_code=409, detail="An account with that email already exists")
    user = await create_user(body.name, body.email, body.password, body.team)
    await _start_session(response, user.id)
    return user


@router.post("/logout")
async def logout(request: Request, response: Response) -> dict:
    token = request.cookies.get(SESSION_COOKIE)
    if token:
        await db.pool.execute("DELETE FROM sessions WHERE token_hash = $1", _token_hash(token))
    response.delete_cookie(SESSION_COOKIE)
    return {"ok": True}


@router.get("/teams")
async def teams() -> list:
    return TEAMS
