# Submission contents

- **Live app:** https://ajaia-docs-gray.vercel.app (health: `/api/health`)
- **Walkthrough video:** URL in `VIDEO_URL.txt`
- **Demo accounts:** `alice@demo.com`, `bob@demo.com`, `carol@demo.com`, password `demo1234`

## Files

| Path | What it is |
|---|---|
| `README.md` | Overview, features, local setup, deploy, API, scope cuts, next steps |
| `ARCHITECTURE.md` | Architecture note: priorities, layers, decisions, limitations |
| `AI_WORKFLOW.md` | AI tools used, what I changed or rejected, how I verified |
| `VIDEO_URL.txt` | Walkthrough video link |
| `app/`, `api/`, `db/` | FastAPI backend, Vercel entry point, Postgres schema and seed |
| `frontend/` | React + Vite + TypeScript + TipTap app |
| `tests/` | 48 backend tests (no database required) |
| `vercel.json`, `pyproject.toml`, `requirements*.txt`, `.env.example` | Config |

## Status

- **Working:** create, rename, edit with rich text, autosave, reopen, `.md`/`.txt` import, sharing by email, owned vs shared lists, 409 conflict handling, version history with restore.
- **Not built:** real-time co-editing, revoking access, roles, `.docx` import, comments, PDF export.
- **Next (2-4 h):** see "What I would build next" in `README.md`.
