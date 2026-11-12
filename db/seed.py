"""Idempotent demo data: python -m db.seed (reads DATABASE_URL)."""
import os

import psycopg
from psycopg.rows import dict_row

from app.security import hash_password

USERS = [("alice@demo.com", "Alice"), ("bob@demo.com", "Bob"), ("carol@demo.com", "Carol")]
PASSWORD = "demo1234"
PLAN_TITLE = "Team Plan"
PLAN_HTML = ("<h1>Team Plan</h1><p>Goals for the quarter:</p>"
             "<ul><li>Ship the editor</li><li>Invite the team</li></ul>")


def seed(conn) -> None:
    ids = {}
    for email, name in USERS:
        row = conn.execute("SELECT id FROM users WHERE email = %s", (email,)).fetchone()
        if row is None:  # only hash + insert when missing, keeps reruns cheap and stable
            row = conn.execute(
                "INSERT INTO users (email, name, password_hash) VALUES (%s, %s, %s) RETURNING id",
                (email, name, hash_password(PASSWORD))).fetchone()
        ids[email] = row["id"]

    doc = conn.execute("SELECT id FROM documents WHERE owner_id = %s AND title = %s",
                       (ids["alice@demo.com"], PLAN_TITLE)).fetchone()
    if doc is None:
        doc = conn.execute(
            "INSERT INTO documents (owner_id, title, content_html) VALUES (%s, %s, %s) RETURNING id",
            (ids["alice@demo.com"], PLAN_TITLE, PLAN_HTML)).fetchone()
    conn.execute("INSERT INTO document_shares (document_id, user_id) VALUES (%s, %s) "
                 "ON CONFLICT DO NOTHING", (doc["id"], ids["bob@demo.com"]))


def main() -> None:
    url = os.environ["DATABASE_URL"]
    with psycopg.connect(url, autocommit=True, prepare_threshold=None, row_factory=dict_row) as conn:
        seed(conn)
    print("Seeded demo users and the Team Plan document.")


if __name__ == "__main__":
    main()
