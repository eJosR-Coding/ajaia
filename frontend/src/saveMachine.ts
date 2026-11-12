// pure save state machine: no React, no timers, no fetch. the hook runs the effects.
// goal: impossible states (Saved while dirty, two conflict flags disagreeing) can't be represented.

export type SaveState =
  | { t: "synced"; saved: boolean }                       // saved=false renders nothing, true renders "Saved"
  | { t: "dirty" }                                        // debounce armed
  | { t: "saving"; again: boolean; clearStash: boolean }  // exactly one request in flight
  | { t: "error"; message: string }
  | { t: "conflict"; mine: string; resync: "idle" | "busy" | { error: string } };

export interface SaveModel {
  save: SaveState;
  rev: number;            // server revision we last saw
  epoch: number;          // bumps whenever the server doc replaces our base, stale responses get dropped
  stash: string | null;   // "my version" that lost a race, recoverable until dismissed
}

type ServerDoc = { revision: number; content_html: string };

export type SaveEvent =
  | { type: "EDIT"; html: string }
  | { type: "TIMER" }
  | { type: "SAVE_OK"; revision: number; html: string; epoch: number }
  | { type: "SAVE_409"; html: string; epoch: number }   // html = controller's latest, becomes conflict.mine
  | { type: "SAVE_ERR"; message: string; epoch: number }
  | { type: "RETRY" }
  | { type: "RELOAD_OK"; doc: ServerDoc }
  | { type: "RESTORE_OK"; doc: ServerDoc; latest: string } // latest = local html right now
  | { type: "KEEP_MINE" }
  | { type: "KEEP_OK"; doc: ServerDoc }
  | { type: "KEEP_ERR"; message: string }
  | { type: "DISMISS_STASH" };

export type Effect =
  | { type: "ARM_TIMER" }
  | { type: "CLEAR_TIMER" }
  | { type: "SEND"; rev: number; epoch: number }          // html comes from the controller's latest
  | { type: "FETCH_LATEST" }
  | { type: "SET_EDITOR_CONTENT"; html: string };

export type StatusLabel = "idle" | "saving" | "saved" | "error" | "conflict";

export const initialModel = (rev: number): SaveModel =>
  ({ save: { t: "synced", saved: false }, rev, epoch: 0, stash: null });

const none = (model: SaveModel) => ({ model, effects: [] as Effect[] });
const SAVING = { t: "saving", again: false, clearStash: false } as const;

export function transition(model: SaveModel, ev: SaveEvent): { model: SaveModel; effects: Effect[] } {
  const s = model.save;
  switch (ev.type) {
    case "EDIT":
      if (s.t === "synced" || s.t === "error" || s.t === "dirty")
        return { model: { ...model, save: { t: "dirty" } }, effects: [{ type: "ARM_TIMER" }] };
      if (s.t === "saving") return { model: { ...model, save: { ...s, again: true } }, effects: [] };
      // conflict: keep stashing what the user types, no timer, no send
      return { model: { ...model, save: { ...s, mine: ev.html } }, effects: [] };

    case "TIMER":
      if (s.t !== "dirty") return none(model);
      return { model: { ...model, save: SAVING }, effects: [{ type: "SEND", rev: model.rev, epoch: model.epoch }] };

    case "SAVE_OK": {
      if (s.t !== "saving" || ev.epoch !== model.epoch) return none(model);
      const base = { ...model, rev: ev.revision, stash: s.clearStash ? null : model.stash };
      if (s.again) // edits landed mid-flight: re-send right away, never flash Saved
        return { model: { ...base, save: SAVING }, effects: [{ type: "SEND", rev: ev.revision, epoch: model.epoch }] };
      return { model: { ...base, save: { t: "synced", saved: true } }, effects: [] };
    }

    case "SAVE_409":
      if (s.t !== "saving" || ev.epoch !== model.epoch) return none(model);
      return { model: { ...model, save: { t: "conflict", mine: ev.html, resync: "idle" } }, effects: [] };

    case "SAVE_ERR":
      if (s.t !== "saving" || ev.epoch !== model.epoch) return none(model);
      return { model: { ...model, save: { t: "error", message: ev.message } }, effects: [] };

    case "RETRY":
      if (s.t !== "error") return none(model);
      return { model: { ...model, save: SAVING }, effects: [{ type: "SEND", rev: model.rev, epoch: model.epoch }] };

    case "RELOAD_OK":
      if (s.t !== "conflict" || s.resync === "busy") return none(model);
      return replaceBase(model, ev.doc, s.mine);

    case "RESTORE_OK": {
      const unsaved = s.t === "conflict" ? s.mine
        : s.t === "synced" ? null : ev.latest;
      return replaceBase(model, ev.doc, unsaved !== null && unsaved !== ev.doc.content_html ? unsaved : model.stash);
    }

    case "KEEP_MINE":
      if (s.t !== "conflict" || s.resync === "busy") return none(model); // double click = no-op
      return { model: { ...model, save: { ...s, resync: "busy" } }, effects: [{ type: "FETCH_LATEST" }] };

    case "KEEP_OK": {
      if (s.t !== "conflict" || s.resync !== "busy") return none(model);
      const epoch = model.epoch + 1;
      return {
        model: { save: { t: "saving", again: false, clearStash: true }, rev: ev.doc.revision, epoch, stash: null },
        effects: [
          { type: "CLEAR_TIMER" },
          { type: "SET_EDITOR_CONTENT", html: s.mine }, // mine already holds keystrokes typed during the GET
          { type: "SEND", rev: ev.doc.revision, epoch },
        ],
      };
    }

    case "KEEP_ERR":
      if (s.t !== "conflict" || s.resync !== "busy") return none(model);
      return { model: { ...model, save: { ...s, resync: { error: ev.message } } }, effects: [] };

    case "DISMISS_STASH":
      return { model: { ...model, stash: null }, effects: [] };
  }
}

// server doc wins: new base, new epoch, in-flight responses from the old epoch die
function replaceBase(model: SaveModel, doc: ServerDoc, stash: string | null) {
  return {
    model: { save: { t: "synced", saved: true } as SaveState, rev: doc.revision, epoch: model.epoch + 1, stash },
    effects: [{ type: "CLEAR_TIMER" }, { type: "SET_EDITOR_CONTENT", html: doc.content_html }] as Effect[],
  };
}

export function statusLabel(model: SaveModel): StatusLabel {
  const s = model.save;
  switch (s.t) {
    case "synced": return s.saved ? "saved" : "idle";
    case "dirty": case "saving": return "saving";
    case "error": return "error";
    case "conflict": return "conflict";
  }
}

export const hasUnsaved = (model: SaveModel) => model.save.t !== "synced";
export const isBusy = (model: SaveModel) =>
  model.save.t === "saving" || model.save.t === "dirty" || model.save.t === "conflict";
