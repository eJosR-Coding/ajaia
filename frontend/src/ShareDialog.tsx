import { FormEvent, useEffect, useRef, useState } from "react";
import { api, ApiError, User } from "./api";

export default function ShareDialog({ docId, onClose }: { docId: number; onClose: () => void }) {
  const [shares, setShares] = useState<User[]>([]);
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const inputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    api.shares(docId)
      .then(setShares)
      .catch((e) => setError(e instanceof ApiError ? e.message : "Could not load shares"))
      .finally(() => setLoading(false));
  }, [docId]);

  useEffect(() => {
    const d = dialogRef.current;
    if (d && !d.open) d.showModal(); // guard: strict mode runs effects twice and showModal throws if already open
    inputRef.current?.focus();
  }, []);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const value = email.trim();
    if (!value) return;
    setBusy(true);
    setError(null);
    try {
      const u = await api.share(docId, value);
      // sharing the same person twice is a no-op server side, so dedupe here too
      setShares((cur) => (cur.some((s) => s.id === u.id) ? cur : [...cur, u]));
      setEmail("");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not share");
    } finally {
      setBusy(false);
      inputRef.current?.focus();
    }
  }

  return (
    <dialog ref={dialogRef} className="card dialog" aria-labelledby="share-title"
      onClose={onClose}
      onClick={(e) => { if (e.target === e.currentTarget) dialogRef.current?.close(); }}>
      <div className="dialog-body">
        <div className="dialog-head">
          <h2 id="share-title">Share document</h2>
          <button onClick={() => dialogRef.current?.close()} aria-label="Close share dialog">Close</button>
        </div>
        <p className="hint">People you share with can read and edit this document.</p>
        <form onSubmit={submit}>
          <label htmlFor="share-email">Add person by email</label>
          <div className="row">
            <input id="share-email" ref={inputRef} type="email" value={email} placeholder="bob@demo.com"
              onChange={(e) => setEmail(e.target.value)} aria-describedby={error ? "share-error" : undefined} />
            <button className="primary" type="submit" disabled={busy || !email.trim()}>
              {busy ? "Adding..." : "Share"}
            </button>
          </div>
        </form>
        {error && <p id="share-error" className="error" role="alert">{error}</p>}
        <h3 style={{ marginTop: "1.25rem", fontSize: "1rem" }}>People with access</h3>
        {loading ? (
          <p className="muted" role="status">Loading...</p>
        ) : shares.length === 0 ? (
          <p className="muted">Only you, for now.</p>
        ) : (
          <ul className="plainlist">
            {shares.map((s) => (
              <li key={s.id}><span>{s.name}</span><span className="muted">{s.email}</span></li>
            ))}
          </ul>
        )}
      </div>
    </dialog>
  );
}
