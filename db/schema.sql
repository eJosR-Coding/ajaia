-- Ajaia Docs schema. Safe to re-run.
CREATE TABLE IF NOT EXISTS users (
    id            BIGSERIAL PRIMARY KEY,
    email         TEXT NOT NULL UNIQUE,
    name          TEXT NOT NULL,
    password_hash TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS documents (
    id           BIGSERIAL PRIMARY KEY,
    owner_id     BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title        TEXT NOT NULL DEFAULT 'Untitled document',
    content_html TEXT NOT NULL DEFAULT '',
    revision     INTEGER NOT NULL DEFAULT 1,  -- optimistic lock counter
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS documents_owner_idx ON documents(owner_id);

CREATE TABLE IF NOT EXISTS document_shares (
    document_id BIGINT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    user_id     BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    PRIMARY KEY (document_id, user_id)
);
CREATE INDEX IF NOT EXISTS document_shares_user_idx ON document_shares(user_id);

CREATE TABLE IF NOT EXISTS document_versions (
    id          BIGSERIAL PRIMARY KEY,
    document_id BIGINT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    title       TEXT NOT NULL,
    content_html TEXT NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS document_versions_doc_idx ON document_versions(document_id, created_at DESC);
