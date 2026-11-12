# AI workflow note

## Tools used

- **Claude** in a planning conversation (scope, stack, risks) and **Claude Code** for implementation. The working pattern was: one session coordinates, one sub-agent writes at a time on its own feature branch, and the coordinator re-runs the checks itself before merging. I never merged on a sub-agent's report alone.
- **Review skills** inside Claude Code: an `impeccable` critique and audit for the UI, and two read-only code audits (implicit state machines, race conditions) run by separate agents that were not allowed to edit files.
- Context7 / docs lookups for library behavior when needed.
- Git flow: `main` for releases, `dev` as integration branch, one `feat/*` branch per change merged with `--no-ff`, conventional commits.

## Where AI materially sped me up

- Scaffolding the FastAPI layers, the TipTap editor wiring and the Postgres schema/seed in one pass each.
- Writing the access-matrix and import tests quickly, test-first (red, then green).
- Drafting the Vercel + Supabase deploy steps and the live smoke script.
- Running independent audits in parallel. The two code audits produced evidence-backed findings (file, line, interleaving) in minutes, which is where AI paid off most: finding race windows I would not have enumerated by hand.

## What I changed or rejected

- **Stack:** the assistant recommended Next.js. I chose Python/FastAPI because it is what I can debug fastest under time pressure.
- **Hosting:** the assistant proposed Render. I rejected it because of free-tier sleep and cross-origin (CORS) overhead; Vercel serves frontend and API on one origin.
- **Scope (YAGNI):** I cut `.docx` import, bcrypt, pyjwt, a router library and a Strategy class the assistant had suggested. Each added a dependency or abstraction the brief did not need.
- **UI critique, partly rejected:** the design review scored the first UI 24/40 and listed five issues. I fixed the two P1s (conflict recovery that destroyed local edits; dialogs without focus management) first, because they affect trust, then chose an editorial minimalist direction for the visual pass. I did not take every suggestion.
- **Audit scope:** the state-machine audit proposed seven refactor phases and the race audit ten findings. I approved only phases 1-4 plus two quick wins, and for the races only the lost-response self-conflict (N1) and the cheap guards. I deliberately left open: rename last-write-wins, restore without a client revision, 7-day cookie expiry mid-edit, duplicate snapshots in one 5-minute window. These are listed in `ARCHITECTURE.md`.
- **AI output corrected:** the audit said a state machine library was optional; I followed its recommendation to use a plain pure function instead of adding XState. One sub-agent also had to pin vitest to v2 because the latest release conflicted with Vite 5.
- **Deploy config:** Vercel auto-detected the repo as a FastAPI project and returned 404 for the frontend. I fixed it with `"framework": "vite"` in `vercel.json` after inspecting the build output.

## How I verified correctness and reliability

- Backend: `pytest` (54 tests, no database) covering policy, sanitization, conflicts, import limits, version previews, a failing snapshot not breaking a save, and the Alice/Bob/Carol sharing flow. New behavior was written test-first and I saw each test fail before it passed.
- Frontend: `vitest` (61 tests) on the pure save state machine, including race cases (stale responses, double "keep mine", edits typed during a re-sync, a lost response followed by a 409). `tsc` plus `vite build` with zero type errors, and the `impeccable` detector with zero findings.
- Every merge: I re-ran tests, build and detector myself on the merged branch and deployed to a preview URL before promoting to production.
- Live: after deploy I ran an end-to-end script against the production URL: health check, three logins, owned vs shared lists, a stranger getting 404 then 200 after sharing, a stale save returning 409, Markdown import, and a rejected `.exe` upload. Test data was deleted afterwards.
- **Not verified automatically:** there is no jsdom or browser test, so browser UX (toolbar states, autosave status, the conflict banner, dialog focus, the history preview) and the `alive` guards in the Share and Dashboard components are checked by hand, not by tests. The race findings that were traced from code but never reproduced in a browser or against a real pooler are labelled as such in the audit notes.
