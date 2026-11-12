"""In-memory repos with the same surface as the Postgres ones in app/repos.py."""
from dataclasses import replace
from datetime import datetime, timezone

from app.models import Document, User, Version
from app.security import hash_password


class FakeUsers:
    def __init__(self):
        self._users: dict[int, User] = {}

    def add(self, email: str, name: str, password: str = "demo1234") -> User:
        u = User(id=len(self._users) + 1, email=email, name=name,
                 password_hash=hash_password(password))
        self._users[u.id] = u
        return u

    def get_by_email(self, email: str):
        return next((u for u in self._users.values() if u.email == email.lower()), None)

    def get_by_id(self, user_id: int):
        return self._users.get(user_id)


class FakeDocs:
    def __init__(self):
        self._docs: dict[int, Document] = {}
        self._versions: dict[int, list[Version]] = {}
        self._next = 1

    def create(self, owner_id: int, title: str, content_html: str) -> Document:
        d = Document(id=self._next, owner_id=owner_id, title=title,
                     content_html=content_html, revision=1,
                     updated_at=datetime.now(timezone.utc))
        self._docs[d.id] = d
        self._next += 1
        return replace(d)

    def get(self, doc_id: int):
        d = self._docs.get(doc_id)
        return replace(d) if d else None

    def list_owned(self, user_id: int):
        return [replace(d) for d in self._docs.values() if d.owner_id == user_id]

    def list_shared(self, user_id: int):
        return [replace(d) for d in self._docs.values() if user_id in d.shared_with]

    def update_content(self, doc_id: int, content_html: str, expected_revision: int):
        d = self._docs.get(doc_id)
        if d is None or d.revision != expected_revision:
            return None  # stale: someone else saved first
        d.content_html, d.revision = content_html, d.revision + 1
        d.updated_at = datetime.now(timezone.utc)
        return replace(d)

    def rename(self, doc_id: int, title: str) -> Document:
        d = self._docs[doc_id]
        d.title = title
        return replace(d)

    def add_share(self, doc_id: int, user_id: int) -> None:
        d = self._docs[doc_id]
        d.shared_with = d.shared_with | {user_id}

    # --- versions (stretch) ---
    def add_version(self, doc_id: int, title: str, content_html: str, created_at=None) -> Version:
        vs = self._versions.setdefault(doc_id, [])
        v = Version(id=sum(len(x) for x in self._versions.values()) + 1, document_id=doc_id,
                    title=title, content_html=content_html,
                    created_at=created_at or datetime.now(timezone.utc))
        vs.append(v)
        return v

    def latest_version(self, doc_id: int):
        vs = self._versions.get(doc_id, [])
        return max(vs, key=lambda v: v.created_at) if vs else None

    def list_versions(self, doc_id: int):
        return sorted(self._versions.get(doc_id, []), key=lambda v: v.created_at, reverse=True)

    def get_version(self, doc_id: int, version_id: int):
        return next((v for v in self._versions.get(doc_id, []) if v.id == version_id), None)


class FakeRepos:
    def __init__(self):
        self.users = FakeUsers()
        self.docs = FakeDocs()
        self.alice = self.users.add("alice@demo.com", "Alice")
        self.bob = self.users.add("bob@demo.com", "Bob")
        self.carol = self.users.add("carol@demo.com", "Carol")
