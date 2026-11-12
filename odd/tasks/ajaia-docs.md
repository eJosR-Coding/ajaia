# Feature: ajaia-docs

Objective: build the Ajaia Docs take-home (README.md is the spec) on branches: `feat/*` off `dev`, merged --no-ff into `dev`; `main` only for releases.
TDD: enabled (orchestrator config), runner: `uv run pytest` (backend); `npm run build` for frontend.
Delivery strategy: ask-on-risk. Forecast: ~1800 authored lines. Route: delegated direct, one writer at a time.
Authorized scope: local code, tests, docs in this repo. NOT authorized: Supabase/Vercel remote ops (need explicit destination + credentials).

## Tasks
- [x] T1 Backend core (TDD): security, sanitize, importers, policy, services, repos, routes, main, deps, fakes, 4 test files
- [x] T2 DB: db/schema.sql, db/seed.py, .env.example, requirements*.txt, api/index.py, vercel.json
- [x] T3 Frontend: Vite+React+TS+TipTap (Login, Dashboard, Editor, ShareDialog, api.ts), build passes
- [x] T4 Stretch: version history (only if time)
- [x] T5 Docs: ARCHITECTURE.md, AI_WORKFLOW.md, SUBMISSION.md, VIDEO_URL.txt (user reviews)
- [x] T6 Deploy (blocked on user: Supabase + Vercel credentials)

## Evidence
T1,T2,T4: commits 0e8238f aeea846 7427a7c 6962f3f; uv run pytest -q = 48 passed (parent re-ran). Postgres paths untested against a real DB.

## Next step
T5 docs on feat/docs (user reviews)

T6: deployed https://ajaia-docs-gray.vercel.app (Vercel prod + new Supabase ajaia-docs, us-east-1). Live smoke: health ok, login x3, owned/shared, share->404 to 200, stale PUT 409, import md, .exe 415. vercel.json needs framework=vite (autodetect picked FastAPI and 404'd root).
