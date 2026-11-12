"""Business logic: documents, sharing, import. No HTTP, no SQL in here."""
from __future__ import annotations

from dataclasses import replace
from datetime import datetime, timedelta, timezone
from pathlib import PurePosixPath

from app.errors import AppError, conflict, not_found
from app.importers import IMPORTERS, derive_title
from app.models import Document, User, Version
from app.policy import can
from app.sanitize import clean_html

MAX_IMPORT_BYTES = 2 * 1024 * 1024
SNAPSHOT_EVERY = timedelta(minutes=5)


def validate_import(filename: str, text: str) -> str:
    """Returns the lowercase extension if the upload is acceptable."""
    ext = PurePosixPath(filename.replace("\\", "/")).suffix.lower()
    if ext not in IMPORTERS:
        raise AppError(415, "unsupported_type", "Only .md and .txt files can be imported")
    if len(text.encode("utf-8")) > MAX_IMPORT_BYTES:
        raise AppError(413, "file_too_large", "File is larger than the 2 MB limit")
    if not text.strip():
        raise AppError(400, "empty_file", "The file is empty")
    return ext


def _clean_title(title: str | None) -> str:
    t = (title or "").strip()
    if not t:
        raise AppError(400, "invalid_title", "Title cannot be empty")
    return t[:200]


class DocumentService:
    def __init__(self, docs, users):
        self.docs, self.users = docs, users

    def _load(self, user: User, doc_id: int, action: str) -> Document:
        doc = self.docs.get(doc_id)
        if doc is None or not can(user.id, doc, "read"):
            raise not_found()  # strangers get the same answer as a missing doc
        if not can(user.id, doc, action):
            raise AppError(403, "forbidden", "Only the owner can do that")
        return doc

    def create(self, user: User, title: str | None = None) -> Document:
        return self.docs.create(user.id, (title or "").strip()[:200] or "Untitled document", "")

    def list(self, user: User):
        return self.docs.list_owned(user.id), self.docs.list_shared(user.id)

    def get(self, user: User, doc_id: int) -> Document:
        return self._load(user, doc_id, "read")

    def rename(self, user: User, doc_id: int, title: str) -> Document:
        self._load(user, doc_id, "write")
        return self.docs.rename(doc_id, _clean_title(title))

    def save(self, user: User, doc_id: int, content_html: str, revision: int) -> Document:
        before = self._load(user, doc_id, "write")
        saved = self.docs.update_content(doc_id, clean_html(content_html), revision)
        if saved is None:
            raise conflict()
        self._snapshot(before)
        return saved

    def _snapshot(self, before: Document) -> None:
        """Stretch: keep the pre-save state, at most one snapshot per 5 minutes."""
        if not before.content_html:
            return
        last = self.docs.latest_version(before.id)
        now = datetime.now(timezone.utc)
        if last is None or now - last.created_at >= SNAPSHOT_EVERY:
            self.docs.add_version(before.id, before.title, before.content_html)

    def share(self, user: User, doc_id: int, email: str) -> User:
        self._load(user, doc_id, "share")
        target = self.users.get_by_email(email.strip().lower())
        if target is None:
            raise AppError(404, "user_not_found", "No user with that email")
        if target.id == user.id:
            raise AppError(400, "invalid_share", "You already own this document")
        self.docs.add_share(doc_id, target.id)
        return target

    def list_shares(self, user: User, doc_id: int) -> list[User]:
        doc = self._load(user, doc_id, "share")
        return [u for u in (self.users.get_by_id(i) for i in sorted(doc.shared_with)) if u]

    def import_file(self, user: User, filename: str, text: str) -> Document:
        ext = validate_import(filename, text)
        html = clean_html(IMPORTERS[ext](text))
        return self.docs.create(user.id, derive_title(filename, text), html)

    # --- versions (stretch) ---
    def list_versions(self, user: User, doc_id: int) -> list[Version]:
        self._load(user, doc_id, "read")
        return self.docs.list_versions(doc_id)

    def get_version(self, user: User, doc_id: int, version_id: int) -> Version:
        self._load(user, doc_id, "read")
        v = self.docs.get_version(doc_id, version_id)  # repo scopes by doc id, so foreign ids miss
        if v is None:
            raise not_found()
        # defense in depth: re-sanitize on read even though writes already did
        return replace(v, content_html=clean_html(v.content_html))

    def restore_version(self, user: User, doc_id: int, version_id: int) -> Document:
        doc = self._load(user, doc_id, "write")
        v = self.docs.get_version(doc_id, version_id)
        if v is None:
            raise AppError(404, "version_not_found", "Version not found")
        saved = self.docs.update_content(doc_id, v.content_html, doc.revision)
        if saved is None:
            raise conflict()
        return saved
