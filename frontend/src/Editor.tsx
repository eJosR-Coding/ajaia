import { useCallback, useEffect, useRef, useState } from "react";
import { EditorContent, useEditor, Editor as TipTap } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Underline from "@tiptap/extension-underline";
import { api, ApiError, Doc, User, VersionDetail, VersionMeta } from "./api";
import { navigate } from "./App";
import ShareDialog from "./ShareDialog";
import Wordmark from "./Wordmark";

type Status = "idle" | "saving" | "saved" | "error" | "conflict";
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
      <a href="#/" className="brand" aria-label="Ajaia Docs home"><Wordmark /></a>
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
  // "my version": local html that lost a 409 race. stays recoverable until the user dismisses it
  const [mine, setMine] = useState<string | null>(null);
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

  // resolves true when the doc is in sync with the server afterwards
  const save = useCallback(async (): Promise<boolean> => {
    const editor = editorRef.current;
    if (!editor || conflictRef.current) return false;
    if (inflight.current) { queued.current = true; return false; } // one request at a time, no revision races
    const html = editor.getHTML();
    if (html === lastSavedHtml.current) { setStatus("saved"); return true; }
    inflight.current = true;
    setStatus("saving");
    try {
      const res = await api.save(id, html, revision.current);
      revision.current = res.revision;
      lastSavedHtml.current = html;
      setSaveError(null);
      setStatus("saved");
      return true;
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        // someone else won the race. do NOT overwrite, stash our version so nothing is lost
        conflictRef.current = true;
        setMine(html);
        setConflict(true);
        setStatus("conflict");
      } else {
        setSaveError(e instanceof ApiError ? e.message : "Save failed");
        setStatus("error");
      }
      return false;
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
    onUpdate: ({ editor }) => {
      latestHtml.current = editor.getHTML();
      if (conflictRef.current) setMine(latestHtml.current); // keep stashing edits made during a conflict
      schedule();
    },
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

  // re-base onto the server revision but keep local content, so the next save overwrites on purpose
  async function keepMine() {
    if (mine === null || !editor) return;
    try {
      const d = await api.get(id);
      if (timer.current) { window.clearTimeout(timer.current); timer.current = null; }
      queued.current = false;
      revision.current = d.revision;
      lastSavedHtml.current = d.content_html;
      savedTitle.current = d.title;
      setTitle(d.title);
      editor.commands.setContent(mine, false);
      latestHtml.current = editor.getHTML();
      conflictRef.current = false;
      setConflict(false);
      setSaveError(null);
      if (await save()) setMine(null);
    } catch (e) {
      setSaveError(e instanceof ApiError ? e.message : "Could not re-sync with the latest version");
    }
  }

  async function copyMine() {
    if (mine === null) return false;
    try { await navigator.clipboard.writeText(mine); return true; }
    catch { return false; } // no clipboard api or permission denied, caller shows the manual fallback
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
        {/* real heading for AT + outline; the input below stays the editable control */}
        <h1 className="sr-only">{title || "Untitled"}</h1>
        <div className="head-title">
          <button type="button" className="back" aria-label="Back to documents" onClick={() => navigate("#/")}>&larr; Documents</button>
          <input className="title-input" type="text" value={title} aria-label="Document title" maxLength={200}
            onChange={(e) => setTitle(e.target.value)} onBlur={commitTitle}
            onKeyDown={(e) => {
              if (e.key === "Enter") { e.preventDefault(); (e.target as HTMLInputElement).blur(); }
              if (e.key === "Escape") { setTitle(savedTitle.current); }
            }} />
        </div>
        <div className="head-meta">
          <span className="badge">{initial.is_owner ? "Owner" : "Shared with you"}</span>
          <span className="spacer" />
          <span className={`status ${status === "saved" ? "ok" : status === "error" || status === "conflict" ? "bad" : "muted"}`}
            role="status" aria-live="polite">
            {/* aria-hidden keeps "Saving..." out of the live announcements, no per-keystroke chatter */}
            {status === "saving" && <span aria-hidden="true">Saving...</span>}
            {status === "saved" && "Saved"}
            {status === "conflict" && "Not saved - conflict"}
            {status === "error" && (
              <>Error <button className="link" onClick={() => void save()}>Retry</button></>
            )}
          </span>
          <button onClick={() => setShowVersions(true)}>History</button>
          {initial.is_owner && <button className="primary" onClick={() => setSharing(true)}>Share</button>}
        </div>
      </div>
      {titleError && <div className="banner-wrap"><p className="error wide" role="alert">{titleError}</p></div>}
      {saveError && (
        <div className="banner-wrap"><p className="error wide" role="alert">{saveError}</p></div>
      )}
      <div className="editor-shell">
        <div className="sticky-stack">
          {editor && <Toolbar editor={editor} />}
          {conflict && (
            <div className="banner" role="alert">
              <div className="banner-main">
                <strong>This document was changed elsewhere.</strong>
                <span>Your latest edits were not saved so nothing got overwritten.</span>
              </div>
              <div className="banner-actions">
                <button onClick={reload}>Reload latest</button>
                <button onClick={keepMine}>Keep editing mine</button>
              </div>
              {mine !== null && <MineVersion html={mine} onCopy={copyMine} defaultOpen />}
            </div>
          )}
          {!conflict && mine !== null && (
            <div className="banner quiet" role="region" aria-label="Your unsaved version">
              <MineVersion html={mine} onCopy={copyMine} onDismiss={() => setMine(null)} />
            </div>
          )}
        </div>
        <div className="paper" onClick={() => editor?.commands.focus()}>
          <EditorContent editor={editor} />
        </div>
      </div>
      {sharing && <ShareDialog docId={id} onClose={() => setSharing(false)} />}
      {showVersions && (
        <VersionsDialog docId={id} busy={status === "saving" || conflict} currentHtml={latestHtml.current}
          onClose={() => setShowVersions(false)}
          onRestored={(d) => { applyServerDoc(d); setShowVersions(false); }} />
      )}
    </>
  );
}

function MineVersion({ html, onCopy, onDismiss, defaultOpen }: {
  html: string; onCopy: () => Promise<boolean>; onDismiss?: () => void; defaultOpen?: boolean;
}) {
  const [note, setNote] = useState("");
  const area = useRef<HTMLTextAreaElement>(null);
  const details = useRef<HTMLDetailsElement>(null);

  async function copy() {
    if (await onCopy()) { setNote("Copied to clipboard."); return; }
    // fallback: open the box and pre-select the text so Ctrl+C just works
    if (details.current) details.current.open = true;
    area.current?.focus();
    area.current?.select();
    setNote("Could not copy automatically. Press Ctrl+C to copy the selected text.");
  }

  return (
    <details className="mine" ref={details} open={defaultOpen}>
      <summary>Your unsaved version</summary>
      <textarea ref={area} readOnly value={html} rows={4} aria-label="Your unsaved version as HTML" />
      <div className="banner-actions">
        <button onClick={copy}>Copy my version</button>
        {onDismiss && <button onClick={onDismiss}>Dismiss</button>}
        <span role="status" className="mine-note">{note}</span>
      </div>
    </details>
  );
}

function VersionsDialog({ docId, busy, currentHtml, onClose, onRestored }: {
  docId: number; busy: boolean; currentHtml: string; onClose: () => void; onRestored: (d: Doc) => void;
}) {
  const [versions, setVersions] = useState<VersionMeta[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [detail, setDetail] = useState<VersionDetail | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0); // bump to refetch the preview
  const [working, setWorking] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    api.versions(docId)
      .then((vs) => { setVersions(vs); if (vs.length > 0) setSelectedId(vs[0].id); }) // newest row auto-selected
      .catch((e) => setError(e instanceof ApiError ? e.message : "Could not load history"));
  }, [docId]);

  useEffect(() => {
    const d = dialogRef.current;
    if (d && !d.open) d.showModal(); // guard: strict mode runs effects twice and showModal throws if already open
    headingRef.current?.focus();
  }, []);

  // fetch the selected snapshot; `alive` drops stale responses when the user clicks around fast
  useEffect(() => {
    if (selectedId === null) return;
    let alive = true;
    setDetail(null);
    setPreviewError(null);
    api.version(docId, selectedId)
      .then((d) => alive && setDetail(d))
      .catch((e) => alive && setPreviewError(e instanceof ApiError ? e.message : "Could not load this version"));
    return () => { alive = false; };
  }, [docId, selectedId, retry]);

  function select(id: number) {
    if (working || id === selectedId) return;
    setSelectedId(id);
    setConfirming(false);
  }

  async function restore() {
    if (selectedId === null) return;
    setWorking(true);
    setError(null);
    try {
      const d = await api.restore(docId, selectedId);
      dialogRef.current?.close(); // close natively first so focus goes back to the opener
      onRestored(d);
    } catch (e) { setError(e instanceof ApiError ? e.message : "Restore failed"); setWorking(false); setConfirming(false); }
  }

  const total = versions?.length ?? 0;
  const index = versions?.findIndex((v) => v.id === selectedId) ?? -1;
  const fmt = (iso: string) => new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });

  return (
    <dialog ref={dialogRef} className="card dialog dialog-wide" aria-labelledby="hist-title"
      onClose={onClose}
      onClick={(e) => { if (e.target === e.currentTarget) dialogRef.current?.close(); }}>
      <div className="dialog-body">
        <div className="dialog-head">
          <h2 id="hist-title" ref={headingRef} tabIndex={-1}>Version history</h2>
          <button onClick={() => dialogRef.current?.close()} aria-label="Close version history">Close</button>
        </div>
        {error && <p className="error" role="alert">{error}</p>}
        {!versions && !error && <p className="muted" role="status">Loading...</p>}
        {versions && versions.length === 0 && <p className="muted">No earlier versions yet. Snapshots appear as you edit.</p>}
        {versions && versions.length > 0 && (
          <div className="history">
            <ul className="plainlist history-list" aria-label="Saved versions">
              {versions.map((v, i) => (
                <li key={v.id}>
                  <button type="button" className="history-row" aria-pressed={v.id === selectedId}
                    aria-current={v.id === selectedId ? "true" : undefined}
                    disabled={working} onClick={() => select(v.id)}>
                    <span className="history-when">{fmt(v.created_at)}</span>
                    <span className="muted history-n">State {total - i} of {total}</span>
                  </button>
                </li>
              ))}
            </ul>
            <div className="history-preview">
              {previewError ? (
                <div>
                  <p className="error" role="alert">{previewError}</p>
                  <button onClick={() => setRetry((n) => n + 1)}>Retry</button>
                </div>
              ) : !detail ? (
                <p className="muted" role="status">Loading preview...</p>
              ) : (
                <>
                  <div className="preview-head">
                    <h3>{detail.title}</h3>
                    <p className="muted preview-meta">
                      Saved state {total - index} of {total} &middot; <time dateTime={detail.created_at}>{fmt(detail.created_at)}</time>
                    </p>
                    {detail.content_html === currentHtml && (
                      <p className="preview-note">Current version: this matches what is in the editor now.</p>
                    )}
                  </div>
                  {/* server sanitizes with an nh3 allowlist (no attrs) on write and again on read, so raw HTML is safe here */}
                  <div className="paper preview-paper" aria-label="Version preview"
                    dangerouslySetInnerHTML={{ __html: detail.content_html }} />
                  <div className="preview-actions">
                    {confirming ? (
                      <span className="confirm-row">
                        <button className="primary" disabled={busy || working} onClick={restore}>
                          {working ? "Restoring..." : "Confirm restore"}
                        </button>
                        <button disabled={working} onClick={() => setConfirming(false)}>Cancel</button>
                      </span>
                    ) : (
                      <button disabled={busy || working} onClick={() => setConfirming(true)}>Restore this version</button>
                    )}
                    {busy && <span className="muted">Restore is available once saving finishes.</span>}
                  </div>
                  {confirming && <p className="muted" role="status">Restoring replaces the current text with this version.</p>}
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </dialog>
  );
}
