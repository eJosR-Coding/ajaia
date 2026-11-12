"""Postgres repositories (psycopg 3, dict rows). Same surface as tests/fakes.py."""
from app.models import Document, User, Version


def _doc(row, shared=frozenset()) -> Document:
    return Document(id=row["id"], owner_id=row["owner_id"], title=row["title"],
                    content_html=row["content_html"], revision=row["revision"],
                    shared_with=frozenset(shared), updated_at=row["updated_at"])


class PgUsers:
    def __init__(self, conn):
        self.conn = conn

    def _one(self, sql, arg):
        r = self.conn.execute(sql, (arg,)).fetchone()
        return User(r["id"], r["email"], r["name"], r["password_hash"]) if r else None

    def get_by_email(self, email: str):
        return self._one("SELECT * FROM users WHERE email = %s", email.lower())

    def get_by_id(self, user_id: int):
        return self._one("SELECT * FROM users WHERE id = %s", user_id)


class PgDocs:
    def __init__(self, conn):
        self.conn = conn

    def create(self, owner_id: int, title: str, content_html: str) -> Document:
        r = self.conn.execute(
            "INSERT INTO documents (owner_id, title, content_html) VALUES (%s, %s, %s) RETURNING *",
            (owner_id, title, content_html)).fetchone()
        return _doc(r)

    def get(self, doc_id: int):
        r = self.conn.execute("SELECT * FROM documents WHERE id = %s", (doc_id,)).fetchone()
        if not r:
            return None
        ids = self.conn.execute(
            "SELECT user_id FROM document_shares WHERE document_id = %s", (doc_id,)).fetchall()
        return _doc(r, [x["user_id"] for x in ids])

    def list_owned(self, user_id: int):
        rows = self.conn.execute(
            "SELECT * FROM documents WHERE owner_id = %s ORDER BY updated_at DESC", (user_id,))
        return [_doc(r) for r in rows.fetchall()]

    def list_shared(self, user_id: int):
        rows = self.conn.execute(
            "SELECT d.* FROM documents d JOIN document_shares s ON s.document_id = d.id "
            "WHERE s.user_id = %s ORDER BY d.updated_at DESC", (user_id,))
        return [_doc(r, [user_id]) for r in rows.fetchall()]

    def update_content(self, doc_id: int, content_html: str, expected_revision: int):
        # the WHERE revision = ... is the whole optimistic lock, atomic in one statement
        r = self.conn.execute(
            "UPDATE documents SET content_html = %s, revision = revision + 1, updated_at = now() "
            "WHERE id = %s AND revision = %s RETURNING *",
            (content_html, doc_id, expected_revision)).fetchone()
        return _doc(r) if r else None

    def rename(self, doc_id: int, title: str) -> Document:
        r = self.conn.execute(
            "UPDATE documents SET title = %s, updated_at = now() WHERE id = %s RETURNING *",
            (title, doc_id)).fetchone()
        return _doc(r)

    def add_share(self, doc_id: int, user_id: int) -> None:
        self.conn.execute(
            "INSERT INTO document_shares (document_id, user_id) VALUES (%s, %s) "
            "ON CONFLICT DO NOTHING", (doc_id, user_id))

    # --- versions (stretch) ---
    @staticmethod
    def _version(r) -> Version:
        return Version(r["id"], r["document_id"], r["title"], r["content_html"], r["created_at"])

    def add_version(self, doc_id: int, title: str, content_html: str) -> Version:
        r = self.conn.execute(
            "INSERT INTO document_versions (document_id, title, content_html) "
            "VALUES (%s, %s, %s) RETURNING *", (doc_id, title, content_html)).fetchone()
        return self._version(r)

    def latest_version(self, doc_id: int):
        r = self.conn.execute(
            "SELECT * FROM document_versions WHERE document_id = %s "
            "ORDER BY created_at DESC LIMIT 1", (doc_id,)).fetchone()
        return self._version(r) if r else None

    def list_versions(self, doc_id: int):
        rows = self.conn.execute(
            "SELECT * FROM document_versions WHERE document_id = %s ORDER BY created_at DESC",
            (doc_id,))
        return [self._version(r) for r in rows.fetchall()]

    def get_version(self, doc_id: int, version_id: int):
        r = self.conn.execute(
            "SELECT * FROM document_versions WHERE document_id = %s AND id = %s",
            (doc_id, version_id)).fetchone()
        return self._version(r) if r else None


class PgRepos:
    def __init__(self, conn):
        self.users, self.docs = PgUsers(conn), PgDocs(conn)
