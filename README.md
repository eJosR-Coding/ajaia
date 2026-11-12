# Ajaia Docs — a lightweight collaborative document editor

A small full-stack document editor inspired by Google Docs: create and edit rich-text
documents, import Markdown/text files, and share documents with other users.

- **Live app:** https://ajaia-docs-gray.vercel.app
- **Walkthrough video:** see `VIDEO_URL.txt`
- **Architecture note:** [`ARCHITECTURE.md`](./ARCHITECTURE.md)
- **AI workflow note:** [`AI_WORKFLOW.md`](./AI_WORKFLOW.md)

---

## Demo accounts

All seeded accounts use the password **`demo1234`**.

| User  | Email            | Seeded state |
|-------|------------------|--------------|
| Alice | `alice@demo.com` | Owns "Team Plan", shared with Bob |
| Bob   | `bob@demo.com`   | Sees "Team Plan" under **Shared with me** |
| Carol | `carol@demo.com` | No access: use her to verify a non-shared document returns *Not found* |

**Testing the sharing flow in 2 minutes**
1. Log in as Alice, create a document, write something, and share it with `carol@demo.com`.
2. Open a private window, log in as Carol: the document appears under **Shared with me**.
3. Edit in both windows: the second save gets a *"This document was changed elsewhere"* banner
   instead of silently overwriting the first save.

---

## Features

| Area | What works |
|---|---|
| Documents | Create, rename (inline title), edit, autosave (1 s debounce, *Saving / Saved / Error* status), reopen |
| Formatting | Bold, italic, underline, H1/H2, bulleted and numbered lists |
| Import | Upload **`.md` or `.txt` (max 2 MB)** -> becomes a new editable document. Markdown headings, lists and emphasis are preserved |
| Sharing | Owner shares by email; shared users can read and edit; only the owner can share. Dashboard separates **My documents** from **Shared with me** |
| Persistence | Postgres (Supabase). Content stored as sanitized HTML, so formatting survives refresh |
| Concurrency | Optimistic locking on a `revision` number -> HTTP 409 on conflicting saves |
| Version history *(stretch)* | Snapshots on save (at most one per 5 min) with restore |

**Supported upload types:** `.md`, `.txt` only. This is stated in the upload button too.
`.docx` is intentionally not supported (see *Scope cuts*).

---

## Tech stack

- **Frontend:** React + Vite + TypeScript, [TipTap](https://tiptap.dev) editor
- **Backend:** Python 3.12, FastAPI, served as a Vercel Python function under `/api/*`
- **Database:** Supabase Postgres, accessed only from the backend through the transaction pooler
- **Hosting:** Vercel (frontend + API on the same origin) and Supabase (database). Both on free tiers, so reviewers pay nothing

Backend runtime dependencies: `fastapi`, `psycopg[binary]`, `markdown`, `nh3`.
Everything else (password hashing, session signing, config) uses the Python standard library.

---

## Run locally

**Prerequisites:** Python 3.12+, Node 20+, and a Postgres 13+ database
(a free Supabase project or `docker run -e POSTGRES_PASSWORD=postgres -p 5432:5432 postgres:16`).

```bash
# 1. Configure
cp .env.example .env            # then edit DATABASE_URL and SESSION_SECRET

# 2. Backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt -r requirements-dev.txt
psql "$DATABASE_URL" -f db/schema.sql
python -m db.seed
uvicorn app.main:app --reload --port 8000

# 3. Frontend (new terminal) — Vite proxies /api to :8000
cd frontend
npm install
npm run dev                      # http://localhost:5173
```

### Environment variables

| Variable | Example | Notes |
|---|---|---|
| `DATABASE_URL` | `postgresql://postgres.xxx:pwd@aws-0-us-east-1.pooler.supabase.com:6543/postgres` | Use the **transaction pooler** (port 6543) in serverless deployments |
| `SESSION_SECRET` | 32+ random characters | Signs the session cookie (`python -c "import secrets;print(secrets.token_urlsafe(32))"`) |
| `COOKIE_SECURE` | `true` in production, `false` locally | Cookie is `HttpOnly`, `SameSite=Lax` |

---

## Tests

```bash
pytest
```

Tests run **without a database**: FastAPI's `dependency_overrides` swaps the Postgres
repositories for in-memory ones.

| Test | What it proves |
|---|---|
| `test_policy.py` | Access matrix: owner / shared user / stranger x read / write / share |
| `test_documents_service.py` | Conflicting revision raises a conflict; `<script>` and `on*` attributes are stripped |
| `test_api_sharing.py` | End-to-end through HTTP: Alice creates and shares -> Bob sees it in *shared* -> Carol gets 404 |
| `test_import.py` | Markdown becomes headings/lists; unsupported extensions and files over 2 MB are rejected |

---

## Deploy

1. **Supabase:** create a project in the region closest to your Vercel region (e.g. `us-east-1`).
   Run `db/schema.sql` in the SQL editor, then run `python -m db.seed` locally against that database.
2. **Vercel:** import the repository. Set `DATABASE_URL` (pooler URL), `SESSION_SECRET`
   and `COOKIE_SECURE=true`. The function region is pinned in `vercel.json` to match Supabase.
3. Verify `GET https://ajaia-docs-gray.vercel.app/api/health` returns `{"status":"ok","db":"ok"}`.

> **Note for reviewers:** Supabase free-tier projects pause after a period of inactivity.
> If the app reports a database error, contact me and I will resume it within minutes.

---

## CI/CD

`.github/workflows/ci.yml` runs `pytest` and the frontend build on every push to `dev`/`main` and on pull requests. `deploy.yml` deploys to Vercel production after CI passes on `main`; it needs the repo secrets `VERCEL_TOKEN`, `VERCEL_ORG_ID` and `VERCEL_PROJECT_ID`.

---

## API

```
POST   /api/auth/login                {email, password}
POST   /api/auth/logout
GET    /api/me
GET    /api/documents                 -> {owned: [...], shared: [...]}  (metadata only)
POST   /api/documents                 {title?}
GET    /api/documents/{id}
PATCH  /api/documents/{id}            {title}
PUT    /api/documents/{id}            {content_html, revision}   -> 409 on stale revision
POST   /api/documents/import          {filename, text}           -> new document
GET    /api/documents/{id}/shares     (owner only)
POST   /api/documents/{id}/shares     {email}
GET    /api/documents/{id}/versions                   (stretch)
POST   /api/documents/{id}/versions/{vid}/restore     (stretch)
GET    /api/health
```

Errors always use one shape: `{"error": {"code": "...", "message": "..."}}`.
Documents you cannot access return **404**, not 403, so the API does not reveal that they exist.

---

## Project structure

```
api/index.py          Vercel entry point
app/
  main.py             app factory, routers, single error handler
  deps.py             composition root (FastAPI Depends): connection -> repos -> services
  policy.py           can(user, doc, action): all authorization in one place
  services.py         documents, sharing, import, versions
  repos.py            Postgres repositories (+ in-memory fakes in tests/fakes.py)
  importers.py        {".md": md_to_html, ".txt": txt_to_html}
  security.py         scrypt password hashing, HMAC-signed session cookie (stdlib)
  sanitize.py         nh3 allowlist for all stored HTML
  routes.py           HTTP layer + Pydantic request/response models
db/schema.sql, db/seed.py
frontend/src/         App.tsx (hash routing), Login, Dashboard, Editor, ShareDialog, api.ts
tests/
```

---

## Scope cuts (intentional)

| Not built | Why |
|---|---|
| Real-time co-editing (OT/CRDT, live cursors) | Needs a stateful WebSocket service that serverless functions cannot host. Optimistic locking makes concurrent edits *detected*, not lost |
| `.docx` import | One supported format meets the requirement. `.md` keeps structure with zero binary parsing, and `.docx` would add a dependency and a parsing edge-case surface |
| Revoking access, viewer/editor roles | Granting access is the required behavior. Revocation and roles are next on the list |
| Comments, PDF export, email invites | Outside the core flow for this timebox |

## What I would build next (2–4 hours)

1. Revoke access + viewer/editor roles (the policy function already centralizes the rule).
2. `.docx` import via `mammoth`.
3. Real-time collaboration with Yjs on a small stateful WebSocket service; the `revision` model becomes the persistence layer for snapshots.
4. ETag / `If-Match` headers instead of the revision in the request body (HTTP-native optimistic locking).
5. Preview deployments per pull request.
