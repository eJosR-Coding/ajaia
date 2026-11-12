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

## Concurrency

The app has no real-time channel, so concurrency risk comes from two people saving the same document and from async requests finishing out of order. I audited both and kept the fixes small.

| Concern | How it is handled |
|---|---|
| Lost updates / write races | `UPDATE ... WHERE id = ? AND revision = ?` is one atomic statement. The second writer gets HTTP 409 instead of overwriting, and the UI keeps their text recoverable. |
| Stale closures and stale responses | The editor save flow is a pure state machine (`saveMachine.ts`, 61 frontend tests). Every async result carries an `epoch`; results from before a server replace (reload, restore, keep-mine) are ignored. |
| Double submits | Share is idempotent (`PRIMARY KEY (document_id, user_id)` + `ON CONFLICT DO NOTHING`); create/import buttons are disabled while busy. |
| Lost response after a committed save | A later 409 is verified against the server content. Identical content counts as saved; anything else shows the conflict banner (fail safe, never lose data). |
| Out-of-order UI updates | Load effects use `alive` guards; the share list merges instead of replacing. |
| Shared mutable state, deadlocks | None server-side: one DB connection per request, single-statement writes, no locks. |
| Caching | No cache layer in the code; only the browser can serve an old JS bundle. |
| Memory leaks | No WebSockets; two window listeners, both removed on cleanup. |

Known and intentionally left open (low impact for this scope): rename is last-write-wins, restore does not send a client revision or snapshot first, a lost session cookie after 7 days is not handled mid-edit, leaving and instantly re-opening a document can load stale content once, and two near-simultaneous saves can create two snapshots in the same 5-minute window. Real-time co-editing would need a stateful service (Yjs) and is described in the README as the next step.
