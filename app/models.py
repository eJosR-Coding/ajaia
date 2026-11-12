"""Plain dataclasses shared by repos, services and routes."""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime


@dataclass(frozen=True)
class User:
    id: int
    email: str
    name: str
    password_hash: str = ""


@dataclass
class Document:
    id: int
    owner_id: int
    title: str
    content_html: str
    revision: int
    shared_with: frozenset[int] = field(default_factory=frozenset)
    updated_at: datetime | None = None


@dataclass(frozen=True)
class Version:
    id: int
    document_id: int
    title: str
    content_html: str
    created_at: datetime
