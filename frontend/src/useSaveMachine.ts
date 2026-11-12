import { MutableRefObject, useCallback, useEffect, useReducer, useRef } from "react";
import type { Editor as TipTap } from "@tiptap/react";
import { api, ApiError, Doc } from "./api";
import { Effect, SaveEvent, SaveModel, initialModel, normalizeHtml, transition } from "./saveMachine";

const AUTOSAVE_MS = 1000;

// thin controller around the pure machine: owns the timer, the requests and the latest html.
// the model lives in a ref so effects always see fresh state, React just gets a nudge to re-render.
export function useSaveMachine(opts: {
  id: number;
  initial: Doc;
  editorRef: MutableRefObject<TipTap | null>;
  onServerDoc?: (d: Doc) => void; // keep-mine re-syncs the title too
}) {
  const { id, initial, editorRef } = opts;
  const model = useRef<SaveModel>(initialModel(initial.revision));
  const [, nudge] = useReducer((n: number) => n + 1, 0);
  const latest = useRef(initial.content_html);      // controller's own copy, never editor.getHTML() at send time
  const lastSaved = useRef(initial.content_html);
  const inflight = useRef(initial.content_html);    // html of the newest SEND, what VERIFY compares against
  const timer = useRef<number | null>(null);
  const onServerDoc = useRef(opts.onServerDoc);
  onServerDoc.current = opts.onServerDoc;

  const dispatch = useCallback(function d(ev: SaveEvent) {
    const r = transition(model.current, ev);
    model.current = r.model;
    nudge();
    r.effects.forEach(run);

    function run(fx: Effect) {
      switch (fx.type) {
        case "ARM_TIMER":
          if (timer.current) window.clearTimeout(timer.current);
          timer.current = window.setTimeout(() => { timer.current = null; d({ type: "TIMER" }); }, AUTOSAVE_MS);
          break;
        case "CLEAR_TIMER":
          if (timer.current) { window.clearTimeout(timer.current); timer.current = null; }
          break;
        case "SEND": {
          const html = latest.current;
          // nothing changed since the last good save (e.g. undo back to it), no request needed
          if (html === lastSaved.current) { d({ type: "SAVE_OK", revision: fx.rev, html, epoch: fx.epoch }); break; }
          inflight.current = html;
          api.save(id, html, fx.rev).then(
            (res) => {
              if (fx.epoch === model.current.epoch) lastSaved.current = html; // stale reply must not touch the base
              d({ type: "SAVE_OK", revision: res.revision, html, epoch: fx.epoch });
            },
            (e) => {
              if (e instanceof ApiError && e.status === 409) d({ type: "SAVE_409", html: latest.current, epoch: fx.epoch });
              else {
                // a plain 4xx was rejected for sure; network, 5xx and unknown errors may have committed anyway
                const ambiguous = !(e instanceof ApiError && e.status >= 400 && e.status < 500);
                d({ type: "SAVE_ERR", message: e instanceof ApiError ? e.message : "Save failed", epoch: fx.epoch, ambiguous });
              }
            },
          );
          break;
        }
        case "VERIFY": {
          const epoch = model.current.epoch;
          const sent = inflight.current;
          api.get(id).then(
            (doc) => {
              if (normalizeHtml(doc.content_html) === normalizeHtml(sent)) {
                if (epoch === model.current.epoch) lastSaved.current = sent; // server holds exactly this, so it counts as saved
                d({ type: "VERIFY_SAME", revision: doc.revision, epoch });
              } else d({ type: "VERIFY_DIFF", html: latest.current, epoch });
            },
            () => d({ type: "VERIFY_ERR", html: latest.current, epoch }),
          );
          break;
        }
        case "FETCH_LATEST":
          api.get(id).then(
            (doc) => { onServerDoc.current?.(doc); lastSaved.current = doc.content_html; d({ type: "KEEP_OK", doc }); },
            (e) => d({ type: "KEEP_ERR", message: e instanceof ApiError ? e.message : "Could not re-sync with the latest version" }),
          );
          break;
        case "SET_EDITOR_CONTENT": {
          const editor = editorRef.current;
          editor?.commands.setContent(fx.html, false); // false = don't fire onUpdate
          // synced means the server doc IS this html. otherwise (keep-mine) lastSaved stays the server's, so mine really gets sent
          const synced = model.current.save.t === "synced";
          latest.current = synced || !editor ? fx.html : editor.getHTML();
          if (synced) lastSaved.current = fx.html;
          break;
        }
      }
    }
  }, [id, editorRef]);

  const edit = useCallback((html: string) => { latest.current = html; dispatch({ type: "EDIT", html }); }, [dispatch]);

  // flush a pending save when leaving the page so the last keystrokes survive
  useEffect(() => () => {
    if (timer.current) {
      window.clearTimeout(timer.current);
      if (model.current.save.t === "dirty" && latest.current !== lastSaved.current) {
        api.save(id, latest.current, model.current.rev).catch(() => {});
      }
    }
  }, [id]);

  return { model: model.current, modelRef: model, dispatch, edit, latest };
}
