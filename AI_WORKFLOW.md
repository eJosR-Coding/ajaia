# AI workflow note

## Tools used

- **Claude** in a planning conversation (scope, stack, risks) and **Claude Code** for implementation, with one agent writing at a time and a parent session reviewing and re-running checks.
- Context7 / docs lookups for library behavior when needed.

## Where AI materially sped me up

- Scaffolding the FastAPI layers, the TipTap editor wiring and the Postgres schema/seed in one pass each.
- Writing the access-matrix and import tests quickly, test-first (red, then green).
- Drafting the Vercel + Supabase deploy steps and the live smoke script.

## What I changed or rejected

- **Stack:** the assistant recommended Next.js. I chose Python/FastAPI because it is what I can debug fastest under time pressure.
- **Hosting:** the assistant proposed Render. I rejected it because of free-tier sleep and cross-origin (CORS) overhead; Vercel serves frontend and API on one origin.
- **Scope (YAGNI):** I cut `.docx` import, bcrypt, pyjwt, a router library and a Strategy class the assistant had suggested. Each added a dependency or abstraction the brief did not need.
- **Deploy config:** Vercel auto-detected the repo as a FastAPI project and returned 404 for the frontend. I fixed it with `"framework": "vite"` in `vercel.json` after inspecting the build output.

## How I verified correctness and reliability

- Backend: `pytest` (48 tests, no database) covering policy, sanitization, conflicts, import limits and the Alice/Bob/Carol sharing flow.
- Frontend: `tsc` plus `vite build` with zero type errors.
- Live: after deploy I ran an end-to-end script against the production URL: health check, three logins, owned vs shared lists, a stranger getting 404 then 200 after sharing, a stale save returning 409, Markdown import, and a rejected `.exe` upload. Test data was deleted afterwards.
- **Not verified automatically:** browser UX (toolbar states, autosave status, conflict banner) was not covered by automated tests. I check those by hand before recording the video.
