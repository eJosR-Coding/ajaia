import { useCallback, useEffect, useRef, useState } from "react";
import { EditorContent, useEditor, Editor as TipTap } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Underline from "@tiptap/extension-underline";
import { api, ApiError, Doc, User, VersionMeta } from "./api";
import { navigate } from "./App";
import ShareDialog from "./ShareDialog";

type Status = "idle" | "saving" | "saved" | "error";
const AUTOSAVE_MS = 1000;

// wrapper: fetch the doc first so TipTap boots with real content (no flash of empty editor)
export default function EditorPage({ docId, user, onLogout }: { docId: number; user: User; onLogout: () => void }) {
  const [doc, setDoc] = useState<Doc | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    api.get(docId)
      .then((d) => alive && setDoc(d))
      .catch((e) => {
        if (!alive) return;
        if (e instanceof ApiError && e.status === 404) setNotFound(true);
        else setError(e instanceof ApiError ? e.message : "Could not load document");
      });
    return () => { alive = false; };
  }, [docId]);

  const bar = (
    <header className="topbar">
      <a href="#/" className="brand" style={{ color: "inherit", textDecoration: "none" }}>Ajaia Docs</a>
      <span className="spacer" />
      <span className="muted who">{user.name}</span>
      <button onClick={onLogout}>Log out</button>
    </header>
  );

  if (notFound) {
    return (
      <div className="page">{bar}
        <main className="container notfound">
          <h1>Document not found</h1>
          <p className="muted">It may not exist, or you may not have access to it.</p>
          <button className="primary" onClick={() => navigate("#/")}>Back to documents</button>
        </main>
      </div>
    );
  }
  if (error) {
    return (
      <div className="page">{bar}
        <main className="container"><p className="error" role="alert">{error}</p>
          <a href="#/">Back to documents</a></main>
      </div>
    );
  }
  if (!doc) return <div className="page">{bar}<p className="center muted" role="status">Loading document...</p></div>;
  return <div className="page">{bar}<EditorBody initial={doc} /></div>;
}

function ToolButton(props: { label: string; active?: boolean; onClick: () => void; children: React.ReactNode; title?: string }) {
  return (
    <button type="button" aria-label={props.label} title={props.title ?? props.label}
      aria-pressed={props.active ?? false}
      // mousedown preventDefault keeps the caret in the editor when clicking toolbar
      onMouseDown={(e) => e.preventDefault()} onClick={props.onClick}>
      {props.children}
    </button>
  );
}

function Toolbar({ editor }: { editor: TipTap }) {
  const c = () => editor.chain().focus();
  return (
    <div className="toolbar" role="toolbar" aria-label="Formatting">
      <ToolButton label="Bold" title="Bold (Ctrl+B)" active={editor.isActive("bold")} onClick={() => c().toggleBold().run()}><strong>B</strong></ToolButton>
      <ToolButton label="Italic" title="Italic (Ctrl+I)" active={editor.isActive("italic")} onClick={() => c().toggleItalic().run()}><em>I</em></ToolButton>
      <ToolButton label="Underline" title="Underline (Ctrl+U)" active={editor.isActive("underline")} onClick={() => c().toggleUnderline().run()}><u>U</u></ToolButton>
      <span className="sep" aria-hidden="true" />
      <ToolButton label="Heading 1" active={editor.isActive("heading", { level: 1 })} onClick={() => c().toggleHeading({ level: 1 }).run()}>H1</ToolButton>
      <ToolButton label="Heading 2" active={editor.isActive("heading", { level: 2 })} onClick={() => c().toggleHeading({ level: 2 }).run()}>H2</ToolButton>
      <span className="sep" aria-hidden="true" />
      <ToolButton label="Bulleted list" active={editor.isActive("bulletList")} onClick={() => c().toggleBulletList().run()}>&bull; List</ToolButton>
      <ToolButton label="Numbered list" active={editor.isActive("orderedList")} onClick={() => c().toggleOrderedList().run()}>1. List</ToolButton>
    </div>
  );
}

function EditorBody({ initial }: { initial: Doc }) {
  const id = initial.id;
  const [title, setTitle] = useState(initial.title);
  const [titleError, setTitleError] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>("idle");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [showVersions, setShowVersions] = useState(false);

  // refs hold the mutable save machinery so re-renders never mess with timers
  const revision = useRef(initial.revision);
  const savedTitle = useRef(initial.title);
  const timer = useRef<number | null>(null);
  const inflight = useRef(false);
  const queued = useRef(false);
  const conflictRef = useRef(false);
  const latestHtml = useRef(initial.content_html);
  const lastSavedHtml = useRef(initial.content_html);
  const editorRef = useRef<TipTap | null>(null);

  const save = useCallback(async () => {
    const editor = editorRef.current;
    if (!editor || conflictRef.current) return;
    if (inflight.current) { queued.current = true; return; } // one request at a time, no revision races
    const html = editor.getHTML();
    if (html === lastSavedHtml.current) { setStatus("saved"); return; }
    inflight.current = true;
    setStatus("saving");
    try {
      const res = await api.save(id, html, revision.current);
      revision.current = res.revision;
      lastSavedHtml.current = html;
      setSaveError(null);
      setStatus("saved");
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        // someone else won the race. do NOT overwrite, just stop and tell the user
        conflictRef.current = true;
        setConflict(true);
        setStatus("idle");
      } else {
        setSaveError(e instanceof ApiError ? e.message : "Save failed");
        setStatus("error");
      }
    } finally {
      inflight.current = false;
      if (queued.current && !conflictRef.current) { queued.current = false; void save(); }
      else queued.current = false;
    }
  }, [id]);

  const schedule = useCallback(() => {
    if (conflictRef.current) return;
    if (timer.current) window.clearTimeout(timer.current);
    setStatus("saving");
    timer.current = window.setTimeout(() => { timer.current = null; void save(); }, AUTOSAVE_MS);
  }, [save]);

  const editor = useEditor({
    extensions: [StarterKit, Underline],
    content: initial.content_html,
    editorProps: { attributes: { "aria-label": "Document body", role: "textbox", "aria-multiline": "true" } },
    onUpdate: ({ editor }) => { latestHtml.current = editor.getHTML(); schedule(); },
  });
  editorRef.current = editor;

  // flush a pending save when leaving the page so the last keystrokes survive
  useEffect(() => {
    return () => {
      if (timer.current) {
        window.clearTimeout(timer.current);
        if (!conflictRef.current && latestHtml.current !== lastSavedHtml.current) {
          api.save(id, latestHtml.current, revision.current).catch(() => {});
        }
      }
    };
  }, [id]);

  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (timer.current || inflight.current || status === "error") e.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [status]);

  function applyServerDoc(d: Doc) {
    if (timer.current) { window.clearTimeout(timer.current); timer.current = null; }
    queued.current = false;
    revision.current = d.revision;
    lastSavedHtml.current = d.content_html;
    latestHtml.current = d.content_html;
    savedTitle.current = d.title;
    setTitle(d.title);
    editor?.commands.setContent(d.content_html, false); // false = don't fire onUpdate, we're not dirty
    conflictRef.current = false;
    setConflict(false);
    setSaveError(null);
    setStatus("saved");
  }

  async function reload() {
    try { applyServerDoc(await api.get(id)); }
    catch (e) { setSaveError(e instanceof ApiError ? e.message : "Reload failed"); }
  }

  async function commitTitle() {
    const next = title.trim();
    if (!next) { setTitle(savedTitle.current); return; }
    if (next === savedTitle.current) return;
    try {
      const d = await api.rename(id, next);
      savedTitle.current = d.title; // server may normalise it
      setTitle(d.title);
      setTitleError(null);
    } catch (e) {
      setTitleError(e instanceof ApiError ? e.message : "Could not rename");
    }
  }

  return (
    <>
      <div className="editor-head">
        <button type="button" aria-label="Back to documents" onClick={() => navigate("#/")}>&larr; Documents</button>
        <input className="title-input" type="text" value={title} aria-label="Document title" maxLength={200}
          onChange={(e) => setTitle(e.target.value)} onBlur={commitTitle}
          onKeyDown={(e) => {
            if (e.key === "Enter") { e.preventDefault(); (e.target as HTMLInputElement).blur(); }
            if (e.key === "Escape") { setTitle(savedTitle.current); }
          }} />
        <span className="badge">{initial.is_owner ? "Owner" : "Shared with you"}</span>
        <span className={`status ${status === "saved" ? "ok" : status === "error" ? "bad" : "muted"}`}
          role="status" aria-live="polite">
          {status === "saving" && "Saving..."}
          {status === "saved" && "Saved"}
          {status === "error" && (
            <>Error <button className="link" onClick={() => void save()}>Retry</button></>
          )}
        </span>
        <button onClick={() => setShowVersions(true)}>History</button>
        {initial.is_owner && <button className="primary" onClick={() => setSharing(true)}>Share</button>}
      </div>
      {titleError && <div className="banner-wrap"><p className="error" role="alert" style={{ maxWidth: 860, margin: ".5rem auto 0" }}>{titleError}</p></div>}
      {status === "error" && saveError && (
        <div className="banner-wrap"><p className="error" role="alert" style={{ maxWidth: 860, margin: ".5rem auto 0" }}>{saveError}</p></div>
      )}
      {conflict && (
        <div className="banner-wrap">
          <div className="banner" role="alert">
            <strong>This document was changed elsewhere.</strong>
            <span>Your latest edits were not saved so nothing got overwritten.</span>
            <button onClick={reload}>Reload</button>
          </div>
        </div>
      )}
      <div className="editor-shell">
        {editor && <Toolbar editor={editor} />}
        <div className="paper" onClick={() => editor?.commands.focus()}>
          <EditorContent editor={editor} />
        </div>
      </div>
      {sharing && <ShareDialog docId={id} onClose={() => setSharing(false)} />}
      {showVersions && (
        <VersionsDialog docId={id} busy={status === "saving" || conflict}
          onClose={() => setShowVersions(false)}
          onRestored={(d) => { applyServerDoc(d); setShowVersions(false); }} />
      )}
    </>
  );
}

function VersionsDialog({ docId, busy, onClose, onRestored }: {
  docId: number; busy: boolean; onClose: () => void; onRestored: (d: Doc) => void;
}) {
  const [versions, setVersions] = useState<VersionMeta[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [working, setWorking] = useState<number | null>(null);

  useEffect(() => {
    api.versions(docId).then(setVersions)
      .catch((e) => setError(e instanceof ApiError ? e.message : "Could not load history"));
  }, [docId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function restore(v: VersionMeta) {
    if (!window.confirm("Restore this version? The current text will be replaced.")) return;
    setWorking(v.id);
    setError(null);
    try { onRestored(await api.restore(docId, v.id)); }
    catch (e) { setError(e instanceof ApiError ? e.message : "Restore failed"); setWorking(null); }
  }

  return (
    <div className="overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="card dialog" role="dialog" aria-modal="true" aria-labelledby="hist-title">
        <div className="dialog-head">
          <h2 id="hist-title">Version history</h2>
          <button onClick={onClose} aria-label="Close version history">Close</button>
        </div>
        {error && <p className="error" role="alert">{error}</p>}
        {busy && <p className="muted">Restore is available once saving finishes.</p>}
        {!versions && !error && <p className="muted" role="status">Loading...</p>}
        {versions && versions.length === 0 && <p className="muted">No earlier versions yet. Snapshots appear as you edit.</p>}
        {versions && versions.length > 0 && (
          <ul className="plainlist">
            {versions.map((v) => (
              <li key={v.id}>
                <span>{new Date(v.created_at).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}</span>
                <button disabled={busy || working !== null} onClick={() => restore(v)}>
                  {working === v.id ? "Restoring..." : "Restore"}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
