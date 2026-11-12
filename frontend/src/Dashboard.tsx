import { ChangeEvent, useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError, DocMeta, User } from "./api";
import { navigate } from "./App";
import Wordmark from "./Wordmark";

const FULL = { dateStyle: "medium", timeStyle: "short" } as const;
const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: "auto", style: "short" });

// "2h ago" style label; falls back to a plain date once it's older than ~a month
function relative(iso: string | null) {
  if (!iso) return "";
  const diff = new Date(iso).getTime() - Date.now(); // negative = past
  const steps: [Intl.RelativeTimeFormatUnit, number][] = [
    ["minute", 60_000], ["hour", 3_600_000], ["day", 86_400_000], ["week", 604_800_000],
  ];
  const abs = Math.abs(diff);
  if (abs < 60_000) return "just now";
  if (abs >= 30 * 86_400_000) return new Date(iso).toLocaleDateString(undefined, { dateStyle: "medium" });
  let pick = steps[0];
  for (const st of steps) if (abs >= st[1]) pick = st;
  return rtf.format(Math.round(diff / pick[1]), pick[0]);
}

function DocList({ docs, empty, action, onAction, shared, disabled }: {
  docs: DocMeta[]; empty: string; action: string; onAction: () => void; shared?: boolean; disabled?: boolean;
}) {
  if (docs.length === 0) {
    return (
      <div className="empty">
        <p className="muted">{empty}</p>
        <button onClick={onAction} disabled={disabled}>{action}</button>
      </div>
    );
  }
  return (
    <ul className="doclist">
      {docs.map((d, i) => (
        <li key={d.id} data-i={Math.min(i, 8)}>
          <a href={`#/doc/${d.id}`}>
            <span className="doctitle">{d.title || "Untitled"}</span>
            <span className="docmeta">
              {shared && <span>Shared with you</span>}
              {d.updated_at && <time dateTime={d.updated_at} title={new Date(d.updated_at).toLocaleString(undefined, FULL)}>Edited {relative(d.updated_at)}</time>}
            </span>
          </a>
        </li>
      ))}
    </ul>
  );
}

export default function Dashboard({ user, onLogout }: { user: User; onLogout: () => void }) {
  const [owned, setOwned] = useState<DocMeta[]>([]);
  const [shared, setShared] = useState<DocMeta[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const alive = useRef(true); // false once we unmount, so a slow create/import never yanks the user to a doc
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []); // set true again for strict mode remounts

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setLoadFailed(false);
    try {
      const r = await api.list();
      setOwned(r.owned);
      setShared(r.shared);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not load documents");
      setLoadFailed(true); // so we dont show "no documents" next to the error
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function createDoc() {
    if (busy) return; // double-click guard
    setBusy(true);
    setError(null);
    try {
      const d = await api.create();
      if (!alive.current) return; // user left the dashboard meanwhile
      navigate(`#/doc/${d.id}`);
    } catch (e) {
      if (!alive.current) return;
      setError(e instanceof ApiError ? e.message : "Could not create document");
      setBusy(false);
    }
  }

  async function onFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // so picking the same file again still fires onChange
    if (!file || busy) return;
    setImportError(null);
    // client-side guard mirrors the server so the user gets instant feedback
    if (file.size > 2 * 1024 * 1024) { setImportError("File is larger than 2 MB."); return; }
    setBusy(true);
    try {
      const text = await file.text();
      const d = await api.importFile(file.name, text);
      if (!alive.current) return;
      navigate(`#/doc/${d.id}`);
    } catch (err) {
      if (!alive.current) return;
      setImportError(err instanceof ApiError ? err.message : "Could not read that file");
      setBusy(false);
    }
  }

  return (
    <div className="page">
      <header className="topbar">
        <Wordmark />
        <span className="spacer" />
        <span className="muted who">{user.name}</span>
        <button onClick={onLogout}>Log out</button>
      </header>
      <main className="container">
        <h1>Your documents</h1>
        <div className="actions">
          <button className="primary" onClick={createDoc} disabled={busy}>New document</button>
          <div className="import">
            <button onClick={() => fileRef.current?.click()} disabled={busy} aria-describedby="import-help">
              Import .md or .txt
            </button>
            <span id="import-help" className="helper">Max 2 MB</span>
          </div>
          <input ref={fileRef} type="file" accept=".md,.txt,text/markdown,text/plain" hidden
            aria-label="Import .md or .txt file" onChange={onFile} />
        </div>
        {importError && <p className="error" role="alert">{importError}</p>}
        {error && (
          <p className="error" role="alert">
            {error} <button className="link" onClick={load}>Retry</button>
          </p>
        )}
        {loading ? (
          <p className="muted" role="status">Loading documents...</p>
        ) : loadFailed ? null : (
          <>
            <section aria-labelledby="h-mine">
              <h2 id="h-mine">My documents <span className="count">{owned.length}</span></h2>
              <DocList docs={owned} empty="No documents yet. Start with a blank page." action="Create your first document"
                onAction={createDoc} disabled={busy} />
            </section>
            <section aria-labelledby="h-shared">
              <h2 id="h-shared">Shared with me <span className="count">{shared.length}</span></h2>
              <DocList docs={shared} shared empty="Nobody has shared a document with you yet." action="Refresh"
                onAction={load} />
            </section>
          </>
        )}
      </main>
    </div>
  );
}
