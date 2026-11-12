"""Composition root: settings -> connection -> repos -> services -> current user."""
import os
from dataclasses import dataclass

from fastapi import Depends, Request

from app.errors import AppError
from app.models import User
from app.security import read_session
from app.services import DocumentService

COOKIE_NAME = "ajaia_session"


@dataclass(frozen=True)
class Settings:
    database_url: str
    session_secret: str
    cookie_secure: bool


def get_settings() -> Settings:
    return Settings(
        database_url=os.environ.get("DATABASE_URL", ""),
        session_secret=os.environ.get("SESSION_SECRET", "dev-only-change-me"),
        cookie_secure=os.environ.get("COOKIE_SECURE", "false").lower() == "true",
    )


def _connect(url: str):
    import psycopg
    from psycopg.rows import dict_row

    # prepare_threshold=None: the Supabase transaction pooler does not support prepared stmts
    return psycopg.connect(url, autocommit=True, prepare_threshold=None, row_factory=dict_row)


def get_repos(settings: Settings = Depends(get_settings)):
    from app.repos import PgRepos

    conn = _connect(settings.database_url)
    try:
        yield PgRepos(conn)
    finally:
        conn.close()


def check_db(settings: Settings = Depends(get_settings)) -> bool:
    try:
        with _connect(settings.database_url) as conn:
            conn.execute("SELECT 1")
        return True
    except Exception:
        return False


def get_service(repos=Depends(get_repos)) -> DocumentService:
    return DocumentService(repos.docs, repos.users)


def current_user(request: Request, repos=Depends(get_repos),
                 settings: Settings = Depends(get_settings)) -> User:
    uid = read_session(request.cookies.get(COOKIE_NAME), settings.session_secret)
    user = repos.users.get_by_id(uid) if uid else None
    if user is None:
        raise AppError(401, "unauthorized", "Please log in")
    return user
