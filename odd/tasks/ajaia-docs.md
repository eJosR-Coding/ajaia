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
- [x] T7 Impeccable P1 fixes: conflict recovery keeps local edit + sticky banner + visible status; dialogs via native <dialog> (focus trap/return, no global Esc), in-dialog restore confirm. No frontend test runner (TDD n/a: verify by tsc+build+manual/live smoke)
- [x] T8 Editorial minimalist redesign (iminimalist-ui + impeccable typeset/layout/adapt): identity, type pairing, 2-tier editor header, dashboard rows, h1s, 44px targets. Verify: tsc+build, detector, preview deploy
- [x] T9 Version preview: GET /documents/{id}/versions/{vid} (content_html, TDD) + clickable history rows with read-only preview and restore from preview

## State-machine audit refactor (user chose phases 1-4 + quick wins)
- [x] T10 Phase 1: vitest + smoke test + CI step (branch feat/test-tooling)
- [x] T11 Quick wins: backend _snapshot best-effort (F5, TDD) + Dashboard double-create guard (F8) (branch feat/quick-wins)
- [x] T12 Phase 3: pure saveMachine.ts transition/selectors + tests, not wired (branch feat/save-machine)
- [x] T13 Phase 4: wire useSaveMachine into EditorBody, UI identical; fixes F1, F4 (branch feat/save-machine)

## Race audit follow-up (user approved steps 1 and 4 only)
- [x] T14 N1: after an ambiguous save failure (lost response), a later 409 is verified against the server content; identical content = success (branch feat/n1-self-conflict, TDD in saveMachine.test.ts)
- [x] T15 N5/N6/N9: alive guards in ShareDialog and Dashboard, concurrency key in deploy.yml (branch feat/race-guards; no jsdom so no component tests, say so)
