# Architecture note

## What I prioritized (and why)

The brief rewards a coherent slice over breadth, so I optimized for one thing: **a document you can create, edit, import and share that never silently loses data, on a link a reviewer can open without paying for anything.**

1. **Editing feel.** TipTap gives a real rich-text model. Autosave has a visible *Saving / Saved / Error* state, the toolbar shows active formatting, and the title is edited inline.
2. **Data safety over features.** Optimistic locking on a `revision` number: a stale save returns HTTP 409 and the UI shows a banner instead of overwriting. Real-time co-editing was cut, but conflicts are *detected*, not lost.
3. **One place for authorization.** `app/policy.py` holds `can(user, doc, action)`. Routes and services never re-implement access rules. Documents a user cannot access return 404 so existence is not leaked.
4. **Few dependencies.** Runtime: `fastapi`, `psycopg`, `markdown`, `nh3`. Password hashing (scrypt) and session signing (HMAC) use the standard library.
5. **Shippable.** One Vercel project serves the Vite build and the FastAPI function on the same origin (no CORS), backed by Supabase Postgres through the transaction pooler.

## Layers

```
routes.py    HTTP only: parse, call a service, map errors to {"error":{code,message}}
services.py  business rules: revisions, sharing, import, version snapshots
policy.py    access matrix (owner / shared user / stranger x read / write / share)
repos.py     Postgres access; tests/fakes.py swaps in in-memory repos
deps.py      composition root (FastAPI Depends)
```

Because repositories are injected, the whole API is tested without a database.

## Key decisions

| Decision | Reason |
|---|---|
| Content stored as sanitized HTML (nh3 allowlist) | Preserves formatting across refresh; sanitizing on write means stored data is safe to render |
| Session cookie (HttpOnly, SameSite=Lax) instead of JWT | Same origin, no token handling in JS, simpler to reason about |
| `.md`/`.txt` import only | Meets the requirement with zero binary parsing; stated in the UI and README |
| Rename does not bump `revision` | Renaming should not cause an editing conflict |
| Version snapshots throttled to one per 5 min | Cheap history without a row per autosave |
| Python/FastAPI rather than Node | The stack I can reason about and debug fastest under a timebox |

## Known limitations

- No real-time collaboration, no revoking access, no viewer/editor roles (see README scope cuts).
- Title rename is last-write-wins (it is not revision-checked).
- Supabase free projects pause after inactivity; reviewers are told to contact me if the DB errors.
- The frontend has no automated tests; backend has 48.
