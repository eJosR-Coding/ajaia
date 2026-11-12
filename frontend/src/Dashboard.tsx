import { ChangeEvent, useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError, DocMeta, User } from "./api";
import { navigate } from "./App";

function fmt(iso: string | null) {
  if (!iso) return "";
  return new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

function DocList({ docs, empty }: { docs: DocMeta[]; empty: string }) {
  if (docs.length === 0) return <p className="muted empty">{empty}</p>;
  return (
    <ul className="doclist">
      {docs.map((d) => (
        <li key={d.id}>
          <a href={`#/doc/${d.id}`}>
            <span className="doctitle">{d.title || "Untitled"}</span>
            <span className="docmeta">{d.updated_at ? `Edited ${fmt(d.updated_at)}` : ""}</span>
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
  const [importError, setImportError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await api.list();
      setOwned(r.owned);
      setShared(r.shared);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not load documents");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function createDoc() {
    setBusy(true);
    setError(null);
    try {
      const d = await api.create();
      navigate(`#/doc/${d.id}`);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not create document");
      setBusy(false);
    }
  }

  async function onFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // so picking the same file again still fires onChange
    if (!file) return;
    setImportError(null);
    // client-side guard mirrors the server so the user gets instant feedback
    if (file.size > 2 * 1024 * 1024) { setImportError("File is larger than 2 MB."); return; }
    setBusy(true);
    try {
      const text = await file.text();
      const d = await api.importFile(file.name, text);
      navigate(`#/doc/${d.id}`);
    } catch (err) {
      setImportError(err instanceof ApiError ? err.message : "Could not read that file");
      setBusy(false);
    }
  }

  return (
    <div className="page">
      <header className="topbar">
        <strong className="brand">Ajaia Docs</strong>
        <span className="spacer" />
        <span className="muted who">{user.name}</span>
        <button onClick={onLogout}>Log out</button>
      </header>
      <main className="container">
        <div className="actions">
          <button className="primary" onClick={createDoc} disabled={busy}>New document</button>
          <button onClick={() => fileRef.current?.click()} disabled={busy}>
            Import .md or .txt (max 2 MB)
          </button>
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
        ) : (
          <>
            <section aria-labelledby="h-mine">
              <h2 id="h-mine">My documents</h2>
              <DocList docs={owned} empty="Nothing here yet. Create a document or import one." />
            </section>
            <section aria-labelledby="h-shared">
              <h2 id="h-shared">Shared with me</h2>
              <DocList docs={shared} empty="Nobody has shared a document with you yet." />
            </section>
          </>
        )}
      </main>
    </div>
  );
}
