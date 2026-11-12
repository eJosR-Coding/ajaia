import { describe, expect, it } from "vitest";
import {
  hasUnsaved, initialModel, isBusy, statusLabel, transition,
  normalizeHtml, type SaveEvent, type SaveModel, type SaveState,
} from "./saveMachine";

const doc = (revision: number, content_html = "<p>srv</p>") => ({ revision, content_html });
const m = (save: SaveState, over: Partial<SaveModel> = {}): SaveModel =>
  ({ save, rev: 5, epoch: 0, stash: null, maybeCommitted: false, ...over });
const run = (model: SaveModel, ...events: SaveEvent[]) => {
  let cur = model;
  const effects: string[] = [];
  for (const e of events) { const r = transition(cur, e); cur = r.model; effects.push(...r.effects.map((x) => x.type)); }
  return { model: cur, effects };
};

const ALL: SaveState[] = [
  { t: "synced", saved: false }, { t: "synced", saved: true }, { t: "dirty" },
  { t: "saving", again: false, clearStash: false }, { t: "saving", again: true, clearStash: false },
  { t: "error", message: "x" },
  { t: "conflict", mine: "<p>m</p>", resync: "idle" }, { t: "conflict", mine: "<p>m</p>", resync: "busy" },
  { t: "conflict", mine: "<p>m</p>", resync: { error: "no" } },
];

describe("EDIT", () => {
  it("synced -> dirty, arms timer", () => {
    const r = transition(m({ t: "synced", saved: true }), { type: "EDIT", html: "a" });
    expect(r.model.save).toEqual({ t: "dirty" });
    expect(r.effects).toEqual([{ type: "ARM_TIMER" }]);
  });
  it("error -> dirty clears the banner", () => {
    const r = transition(m({ t: "error", message: "boom" }), { type: "EDIT", html: "a" });
    expect(r.model.save).toEqual({ t: "dirty" });
    expect(r.effects).toEqual([{ type: "ARM_TIMER" }]);
  });
  it("dirty re-arms", () => {
    const r = transition(m({ t: "dirty" }), { type: "EDIT", html: "a" });
    expect(r.model.save).toEqual({ t: "dirty" });
    expect(r.effects).toEqual([{ type: "ARM_TIMER" }]);
  });
  it("saving -> again, no timer, no send", () => {
    const r = transition(m({ t: "saving", again: false, clearStash: true }), { type: "EDIT", html: "a" });
    expect(r.model.save).toEqual({ t: "saving", again: true, clearStash: true });
    expect(r.effects).toEqual([]);
  });
  it("conflict updates mine (all resync flavours), no effects", () => {
    for (const resync of ["idle", "busy", { error: "e" }] as const) {
      const r = transition(m({ t: "conflict", mine: "old", resync }), { type: "EDIT", html: "new" });
      expect(r.model.save).toEqual({ t: "conflict", mine: "new", resync });
      expect(r.effects).toEqual([]);
    }
  });
});

describe("TIMER / SEND", () => {
  it("dirty -> saving + SEND with rev and epoch", () => {
    const r = transition(m({ t: "dirty" }, { rev: 7, epoch: 2 }), { type: "TIMER" });
    expect(r.model.save).toEqual({ t: "saving", again: false, clearStash: false });
    expect(r.effects).toEqual([{ type: "SEND", rev: 7, epoch: 2 }]);
  });
  it("ignored outside dirty", () => {
    for (const s of ALL.filter((x) => x.t !== "dirty")) {
      const model = m(s);
      expect(transition(model, { type: "TIMER" })).toEqual({ model, effects: [] });
    }
  });
});

describe("SAVE_OK", () => {
  it("plain -> synced saved, rev updated", () => {
    const r = transition(m({ t: "saving", again: false, clearStash: false }), { type: "SAVE_OK", revision: 9, html: "a", epoch: 0 });
    expect(r.model.save).toEqual({ t: "synced", saved: true });
    expect(r.model.rev).toBe(9);
    expect(r.effects).toEqual([]);
  });
  it("again -> straight back to saving + SEND with the new rev, never Saved", () => {
    const r = transition(m({ t: "saving", again: true, clearStash: false }), { type: "SAVE_OK", revision: 9, html: "a", epoch: 0 });
    expect(r.model.save).toEqual({ t: "saving", again: false, clearStash: false });
    expect(r.model.rev).toBe(9);
    expect(r.effects).toEqual([{ type: "SEND", rev: 9, epoch: 0 }]);
    expect(statusLabel(r.model)).toBe("saving");
  });
  it("clearStash drops the stash", () => {
    const r = transition(m({ t: "saving", again: false, clearStash: true }, { stash: "s" }), { type: "SAVE_OK", revision: 9, html: "a", epoch: 0 });
    expect(r.model.stash).toBeNull();
  });
  it("without clearStash the stash survives", () => {
    const r = transition(m({ t: "saving", again: false, clearStash: false }, { stash: "s" }), { type: "SAVE_OK", revision: 9, html: "a", epoch: 0 });
    expect(r.model.stash).toBe("s");
  });
  it("again + clearStash: stash cleared, second round does not clear again", () => {
    const r = transition(m({ t: "saving", again: true, clearStash: true }, { stash: "s" }), { type: "SAVE_OK", revision: 9, html: "a", epoch: 0 });
    expect(r.model.stash).toBeNull();
    expect(r.model.save).toEqual({ t: "saving", again: false, clearStash: false });
  });
  it("ignored when not saving", () => {
    for (const s of ALL.filter((x) => x.t !== "saving")) {
      const model = m(s);
      expect(transition(model, { type: "SAVE_OK", revision: 9, html: "a", epoch: 0 })).toEqual({ model, effects: [] });
    }
  });
});

describe("SAVE_409 / SAVE_ERR / RETRY", () => {
  it("409 -> conflict with latest html, idle", () => {
    const r = transition(m({ t: "saving", again: true, clearStash: false }), { type: "SAVE_409", html: "latest", epoch: 0 });
    expect(r.model.save).toEqual({ t: "conflict", mine: "latest", resync: "idle" });
    expect(r.effects).toEqual([]);
  });
  it("err -> error with message", () => {
    const r = transition(m({ t: "saving", again: false, clearStash: false }), { type: "SAVE_ERR", message: "nope", epoch: 0 });
    expect(r.model.save).toEqual({ t: "error", message: "nope" });
  });
  it("RETRY in error -> saving + SEND", () => {
    const r = transition(m({ t: "error", message: "x" }, { rev: 3, epoch: 1 }), { type: "RETRY" });
    expect(r.model.save).toEqual({ t: "saving", again: false, clearStash: false });
    expect(r.effects).toEqual([{ type: "SEND", rev: 3, epoch: 1 }]);
  });
  it("RETRY while saving (or anywhere else) is a no-op", () => {
    for (const s of ALL.filter((x) => x.t !== "error")) {
      const model = m(s);
      expect(transition(model, { type: "RETRY" })).toEqual({ model, effects: [] });
    }
  });
});

describe("RELOAD_OK", () => {
  it("conflict idle -> synced, epoch+1, stash=mine, sets editor", () => {
    const r = transition(m({ t: "conflict", mine: "<p>m</p>", resync: "idle" }, { epoch: 1 }), { type: "RELOAD_OK", doc: doc(8) });
    expect(r.model).toEqual({ save: { t: "synced", saved: true }, rev: 8, epoch: 2, stash: "<p>m</p>", maybeCommitted: false });
    expect(r.effects).toEqual([{ type: "CLEAR_TIMER" }, { type: "SET_EDITOR_CONTENT", html: "<p>srv</p>" }]);
  });
  it("ignored while a keep-mine fetch is busy and outside conflict", () => {
    for (const s of ALL.filter((x) => x.t !== "conflict" || x.resync === "busy")) {
      const model = m(s);
      expect(transition(model, { type: "RELOAD_OK", doc: doc(8) })).toEqual({ model, effects: [] });
    }
  });
});

describe("RESTORE_OK", () => {
  it("from synced: no stash", () => {
    const r = transition(m({ t: "synced", saved: true }), { type: "RESTORE_OK", doc: doc(8), latest: "<p>srv</p>" });
    expect(r.model).toEqual({ save: { t: "synced", saved: true }, rev: 8, epoch: 1, stash: null, maybeCommitted: false });
    expect(r.effects).toEqual([{ type: "CLEAR_TIMER" }, { type: "SET_EDITOR_CONTENT", html: "<p>srv</p>" }]);
  });
  it("stashes unsaved local edits (dirty, saving, error)", () => {
    for (const s of [{ t: "dirty" }, { t: "saving", again: false, clearStash: false }, { t: "error", message: "x" }] as SaveState[]) {
      const r = transition(m(s), { type: "RESTORE_OK", doc: doc(8), latest: "<p>local</p>" });
      expect(r.model.stash).toBe("<p>local</p>");
      expect(r.model.save).toEqual({ t: "synced", saved: true });
    }
  });
  it("from conflict keeps mine as stash", () => {
    const r = transition(m({ t: "conflict", mine: "<p>m</p>", resync: "busy" }), { type: "RESTORE_OK", doc: doc(8), latest: "<p>m</p>" });
    expect(r.model.stash).toBe("<p>m</p>");
    expect(r.model.epoch).toBe(1);
  });
  it("does not stash when local equals the restored html", () => {
    const r = transition(m({ t: "dirty" }), { type: "RESTORE_OK", doc: doc(8), latest: "<p>srv</p>" });
    expect(r.model.stash).toBeNull();
  });
});

describe("KEEP_MINE / KEEP_OK / KEEP_ERR", () => {
  it("idle -> busy + FETCH_LATEST", () => {
    const r = transition(m({ t: "conflict", mine: "x", resync: "idle" }), { type: "KEEP_MINE" });
    expect(r.model.save).toEqual({ t: "conflict", mine: "x", resync: "busy" });
    expect(r.effects).toEqual([{ type: "FETCH_LATEST" }]);
  });
  it("KEEP_MINE twice is a no-op the second time", () => {
    const first = transition(m({ t: "conflict", mine: "x", resync: "idle" }), { type: "KEEP_MINE" });
    const second = transition(first.model, { type: "KEEP_MINE" });
    expect(second).toEqual({ model: first.model, effects: [] });
  });
  it("can retry after a failed re-sync", () => {
    const r = transition(m({ t: "conflict", mine: "x", resync: { error: "e" } }), { type: "KEEP_MINE" });
    expect(r.model.save).toEqual({ t: "conflict", mine: "x", resync: "busy" });
    expect(r.effects).toEqual([{ type: "FETCH_LATEST" }]);
  });
  it("KEEP_MINE ignored outside conflict", () => {
    for (const s of ALL.filter((x) => x.t !== "conflict")) {
      const model = m(s);
      expect(transition(model, { type: "KEEP_MINE" })).toEqual({ model, effects: [] });
    }
  });
  it("KEEP_OK -> saving clearStash, epoch+1, editor gets mine, then SEND on the new rev", () => {
    const r = transition(m({ t: "conflict", mine: "<p>mine</p>", resync: "busy" }, { epoch: 3 }), { type: "KEEP_OK", doc: doc(12) });
    expect(r.model).toEqual({ save: { t: "saving", again: false, clearStash: true }, rev: 12, epoch: 4, stash: null, maybeCommitted: false });
    expect(r.effects).toEqual([
      { type: "CLEAR_TIMER" },
      { type: "SET_EDITOR_CONTENT", html: "<p>mine</p>" },
      { type: "SEND", rev: 12, epoch: 4 },
    ]);
  });
  it("KEEP_OK uses what was typed during the GET", () => {
    const busy = transition(m({ t: "conflict", mine: "typed-before", resync: "idle" }), { type: "KEEP_MINE" }).model;
    const typed = transition(busy, { type: "EDIT", html: "typed-during-get" }).model;
    const r = transition(typed, { type: "KEEP_OK", doc: doc(12) });
    expect(r.effects).toContainEqual({ type: "SET_EDITOR_CONTENT", html: "typed-during-get" });
    expect(r.model.save.t).toBe("saving");
  });
  it("KEEP_OK ignored unless busy", () => {
    for (const s of ALL.filter((x) => !(x.t === "conflict" && x.resync === "busy"))) {
      const model = m(s);
      expect(transition(model, { type: "KEEP_OK", doc: doc(12) })).toEqual({ model, effects: [] });
    }
  });
  it("KEEP_ERR -> resync error", () => {
    const r = transition(m({ t: "conflict", mine: "x", resync: "busy" }), { type: "KEEP_ERR", message: "offline" });
    expect(r.model.save).toEqual({ t: "conflict", mine: "x", resync: { error: "offline" } });
  });
  it("KEEP_ERR ignored unless busy", () => {
    const model = m({ t: "conflict", mine: "x", resync: "idle" });
    expect(transition(model, { type: "KEEP_ERR", message: "e" })).toEqual({ model, effects: [] });
  });
});

describe("stale epoch (F4)", () => {
  const stale: SaveEvent[] = [
    { type: "SAVE_OK", revision: 99, html: "a", epoch: 0 },
    { type: "SAVE_409", html: "a", epoch: 0 },
    { type: "SAVE_ERR", message: "x", epoch: 0 },
  ];
  it("ignored after RESTORE_OK, RELOAD_OK and KEEP_OK bumped the epoch", () => {
    const afterRestore = run(m({ t: "saving", again: false, clearStash: false }), { type: "RESTORE_OK", doc: doc(8), latest: "z" }).model;
    const afterReload = run(m({ t: "conflict", mine: "x", resync: "idle" }), { type: "RELOAD_OK", doc: doc(8) }).model;
    const afterKeep = run(m({ t: "conflict", mine: "x", resync: "busy" }), { type: "KEEP_OK", doc: doc(8) }).model;
    for (const model of [afterRestore, afterReload, afterKeep]) {
      expect(model.epoch).toBe(1);
      for (const e of stale) {
        // even when we are "saving" (keep-ok) the old epoch response must not touch rev
        expect(transition(model, e)).toEqual({ model, effects: [] });
      }
    }
  });
});

describe("DISMISS_STASH", () => {
  it("clears the stash in any state", () => {
    for (const s of ALL) expect(transition(m(s, { stash: "s" }), { type: "DISMISS_STASH" }).model.stash).toBeNull();
  });
});

describe("selectors", () => {
  const label = (s: SaveState) => statusLabel(m(s));
  it("statusLabel maps every state", () => {
    expect(label({ t: "synced", saved: false })).toBe("idle");
    expect(label({ t: "synced", saved: true })).toBe("saved");
    expect(label({ t: "dirty" })).toBe("saving");
    expect(label({ t: "saving", again: false, clearStash: false })).toBe("saving");
    expect(label({ t: "saving", again: true, clearStash: false })).toBe("saving");
    expect(label({ t: "error", message: "x" })).toBe("error");
    expect(label({ t: "conflict", mine: "", resync: "idle" })).toBe("conflict");
  });
  it("never says saved while dirty or saving", () => {
    for (const s of ALL) if (s.t === "dirty" || s.t === "saving") expect(label(s)).not.toBe("saved");
  });
  it("hasUnsaved over every state", () => {
    const got = ALL.map((s) => hasUnsaved(m(s)));
    expect(got).toEqual([false, false, true, true, true, true, true, true, true]);
  });
  it("isBusy over every state", () => {
    const got = ALL.map((s) => isBusy(m(s)));
    expect(got).toEqual([false, false, true, true, true, false, true, true, true]);
  });
  it("initialModel starts quiet", () => {
    expect(initialModel(4)).toEqual({ save: { t: "synced", saved: false }, rev: 4, epoch: 0, stash: null, maybeCommitted: false });
  });
});

// N1: a PUT can commit while its response is lost, the next save then 409s against our own write
describe("N1 verify 409 after an ambiguous failure", () => {
  const SAVING = { t: "saving", again: false, clearStash: false } as const;
  const VERIFYING = { t: "verifying", again: false, clearStash: false } as const;
  const lostThenRetry = () =>
    run(m(SAVING), { type: "SAVE_ERR", message: "net", epoch: 0 }, { type: "RETRY" }).model;

  it("SAVE_ERR flags maybeCommitted by default (network / 5xx / unknown)", () => {
    expect(transition(m(SAVING), { type: "SAVE_ERR", message: "x", epoch: 0 }).model.maybeCommitted).toBe(true);
    expect(transition(m(SAVING), { type: "SAVE_ERR", message: "x", epoch: 0, ambiguous: true }).model.maybeCommitted).toBe(true);
  });
  it("a plain 4xx is not ambiguous", () => {
    expect(transition(m(SAVING), { type: "SAVE_ERR", message: "x", epoch: 0, ambiguous: false }).model.maybeCommitted).toBe(false);
  });
  it("a non-ambiguous error does not forget an earlier ambiguous one", () => {
    const r = transition(m(SAVING, { maybeCommitted: true }), { type: "SAVE_ERR", message: "x", epoch: 0, ambiguous: false });
    expect(r.model.maybeCommitted).toBe(true);
  });
  it("ambiguous error, RETRY, 409 -> VERIFY, not conflict", () => {
    const r = transition(lostThenRetry(), { type: "SAVE_409", html: "<p>mine</p>", epoch: 0 });
    expect(r.model.save).toEqual(VERIFYING);
    expect(r.effects).toEqual([{ type: "VERIFY" }]);
  });
  it("EDIT during verifying sets again, no timer", () => {
    const r = transition(m(VERIFYING, { maybeCommitted: true }), { type: "EDIT", html: "z" });
    expect(r.model.save).toEqual({ t: "verifying", again: true, clearStash: false });
    expect(r.effects).toEqual([]);
  });
  it("a 409 without a prior ambiguous failure goes straight to conflict", () => {
    const r = transition(m(SAVING), { type: "SAVE_409", html: "latest", epoch: 0 });
    expect(r.model.save).toEqual({ t: "conflict", mine: "latest", resync: "idle" });
    expect(r.effects).toEqual([]);
  });
  it("VERIFY_SAME -> synced Saved with the server rev, flag cleared", () => {
    const r = transition(m(VERIFYING, { maybeCommitted: true }), { type: "VERIFY_SAME", revision: 9, epoch: 0 });
    expect(r.model.save).toEqual({ t: "synced", saved: true });
    expect(r.model.rev).toBe(9);
    expect(r.model.maybeCommitted).toBe(false);
    expect(r.effects).toEqual([]);
  });
  it("VERIFY_SAME honours clearStash", () => {
    const r = transition(m({ t: "verifying", again: false, clearStash: true }, { stash: "s", maybeCommitted: true }),
      { type: "VERIFY_SAME", revision: 9, epoch: 0 });
    expect(r.model.stash).toBeNull();
  });
  it("edits typed during VERIFY are not lost: VERIFY_SAME re-sends on the new rev", () => {
    const r = transition(m({ t: "verifying", again: true, clearStash: false }, { maybeCommitted: true }),
      { type: "VERIFY_SAME", revision: 9, epoch: 0 });
    expect(r.model.save).toEqual(SAVING);
    expect(r.model.rev).toBe(9);
    expect(r.model.maybeCommitted).toBe(false);
    expect(r.effects).toEqual([{ type: "SEND", rev: 9, epoch: 0 }]);
  });
  it("VERIFY_DIFF -> conflict with mine = latest, flag cleared", () => {
    const r = transition(m({ t: "verifying", again: true, clearStash: false }, { maybeCommitted: true }),
      { type: "VERIFY_DIFF", html: "<p>latest</p>", epoch: 0 });
    expect(r.model.save).toEqual({ t: "conflict", mine: "<p>latest</p>", resync: "idle" });
    expect(r.model.maybeCommitted).toBe(false);
    expect(r.effects).toEqual([]);
  });
  it("VERIFY_ERR fails safe -> conflict with mine = latest", () => {
    const r = transition(m(VERIFYING, { maybeCommitted: true }), { type: "VERIFY_ERR", html: "<p>latest</p>", epoch: 0 });
    expect(r.model.save).toEqual({ t: "conflict", mine: "<p>latest</p>", resync: "idle" });
    expect(r.model.maybeCommitted).toBe(false);
  });
  it("stale epoch and wrong state are ignored for VERIFY_*", () => {
    const evs: SaveEvent[] = [
      { type: "VERIFY_SAME", revision: 9, epoch: 0 },
      { type: "VERIFY_DIFF", html: "x", epoch: 0 },
      { type: "VERIFY_ERR", html: "x", epoch: 0 },
    ];
    for (const e of evs) {
      const stale = m(VERIFYING, { epoch: 1, maybeCommitted: true });
      expect(transition(stale, e)).toEqual({ model: stale, effects: [] });
      for (const s of ALL) {
        const model = m(s, { maybeCommitted: true });
        expect(transition(model, e)).toEqual({ model, effects: [] });
      }
    }
  });
  it("RELOAD_OK, RESTORE_OK and KEEP_OK clear maybeCommitted", () => {
    const flag = { maybeCommitted: true };
    expect(transition(m({ t: "conflict", mine: "x", resync: "idle" }, flag), { type: "RELOAD_OK", doc: doc(8) }).model.maybeCommitted).toBe(false);
    expect(transition(m({ t: "error", message: "x" }, flag), { type: "RESTORE_OK", doc: doc(8), latest: "z" }).model.maybeCommitted).toBe(false);
    expect(transition(m({ t: "conflict", mine: "x", resync: "busy" }, flag), { type: "KEEP_OK", doc: doc(8) }).model.maybeCommitted).toBe(false);
  });
  it("SAVE_OK clears maybeCommitted", () => {
    expect(transition(m(SAVING, { maybeCommitted: true }), { type: "SAVE_OK", revision: 6, html: "a", epoch: 0 }).model.maybeCommitted).toBe(false);
  });
  it("selectors treat verifying like saving", () => {
    expect(statusLabel(m(VERIFYING))).toBe("saving");
    expect(hasUnsaved(m(VERIFYING))).toBe(true);
    expect(isBusy(m(VERIFYING))).toBe(true);
  });
  it("RETRY while verifying is a no-op", () => {
    const model = m(VERIFYING);
    expect(transition(model, { type: "RETRY" })).toEqual({ model, effects: [] });
  });
  it("normalizeHtml ignores outer and between-tag whitespace only", () => {
    expect(normalizeHtml("  <p>a</p>\n  <p>b</p> ")).toBe(normalizeHtml("<p>a</p><p>b</p>"));
    expect(normalizeHtml("<p>a  b</p>")).toBe(normalizeHtml("<p>a b</p>"));
    expect(normalizeHtml("<p>a</p>")).not.toBe(normalizeHtml("<p>b</p>"));
  });
});
