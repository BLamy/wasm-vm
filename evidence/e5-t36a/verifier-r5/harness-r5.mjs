// E5-T36a verifier (round 5): a rig that drives the REAL CursorController on a virtual clock,
// with a guest that is the device as I read it in this repository and in the guest's stack:
//
//   * the page's tablet frames reach the guest in order (one FIFO), possibly late (`act`);
//   * the guest's kernel passes on only the absolute axes whose value changed
//     (drivers/input/input.c); a frame of two unchanged axes reaches nobody;
//   * the compositor reads the tablet as an absolute POINTER (ABS_X/ABS_Y + BTN_LEFT: libinput's
//     fallback dispatch reports both coordinates whenever one changed), so a frame with one
//     changed axis puts the pointer on the whole position;
//   * relative motion comes from another device and leaves the tablet's values alone;
//   * every commit is UPDATE at the plane's previous position, then MOVE — also when the plane
//     does not move (rounds 1 and 3);
//   * a hide is a cursor-UPDATE with resource 0: crates/core/src/dev/virtio/gpu/mod.rs
//     `update_cursor` publishes `cursor_state` for resource 0 (:1565, :485) and `move_cursor`
//     rejects a move while the cursor is hidden (:1621), so a cursor-move with resource 0 —
//     how the worker's test guest hides — is an event this device cannot send;
//   * while nothing is shown the compositor's pointer may be somewhere no position put it: a
//     compositor that has just started ((100,100) on the Replay desktop), a client's pointer lock
//     (tablet frames are read and ignored);
//   * the idle counter moves on only when it is read with nothing left to handle and no other work.
//
// SINK_DIR=<dir> imports the sink files from there (mutants); default web/src/sink.
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
export const sinkDir = process.env.SINK_DIR ?? path.resolve(here, "../../../web/src/sink");
const controllerModule = await import(pathToFileURL(path.join(sinkDir, "cursor-controller.js")));
export const { CursorController, HOTSPOT_REST_MS, HOTSPOT_POLL_MS, HOTSPOT_CAUGHT_UP_TIMEOUT_MS } = controllerModule;
export const { CursorHotspotEstimator } = await import(pathToFileURL(path.join(sinkDir, "cursor-hotspot.js")));

export const HOTS = { arrow: [1, 1], hand: [9, 4], caret: [4, 8], cross: [0, 0] };
const IDS = { arrow: 11, hand: 12, caret: 13, cross: 14 };
const FILLS = { arrow: 0xff0000ff, hand: 0xff00ff00, caret: 0xffff0000, cross: 0xff00ffff };
export const J = (v) => JSON.stringify(v);
export const REST = HOTSPOT_REST_MS + 4 * HOTSPOT_POLL_MS;
const flush = async () => { for (let i = 0; i < 8; i += 1) await new Promise((resolve) => setImmediate(resolve)); };

/** An estimator that counts what reaches it while the controller says it is settling. */
class CountingEstimator extends CursorHotspotEstimator {
  constructor() { super(); this.calls = { noteMove: 0, noteRest: 0, moveWhileSettling: 0, restWhileSettling: 0 }; this.settling = () => false; }
  noteMove(...args) { this.calls.noteMove += 1; if (this.settling()) this.calls.moveWhileSettling += 1; return super.noteMove(...args); }
  noteRest(...args) { this.calls.noteRest += 1; if (this.settling()) this.calls.restWhileSettling += 1; return super.noteRest(...args); }
}

/**
 * counter: "honest" (default) | "none" | (rig) => async () => value | "manual" (readings are
 * delivered by hand: rig.pending holds the resolvers, rig.reading(v) answers the oldest).
 */
export function makeRig({ size = 64, output = [1280, 800], counter = "honest", tablet = [0, 0] } = {}) {
  let now = 0; let nextId = 1;
  const timers = new Map();
  const target = { style: { cursor: "auto" }, appendChild() {}, removeChild() {} };
  const r = { target, timers, diagnostics: [], pending: [], asked: 0, idleWaits: 0, busy: false, answers: [], violations: [], size, output: [...output] };
  const estimator = new CountingEstimator();
  const guestIdleCount = counter === "none" ? null
    : counter === "manual" ? () => new Promise((resolve) => { r.asked += 1; r.pending.push(resolve); })
      : typeof counter === "function" ? counter(r)
        : async () => { r.asked += 1; if (r.guest.queue.length === 0 && !r.busy) r.idleWaits += 1; return r.idleWaits; };
  const controller = new CursorController({ target, documentTarget: null, hotspotEstimator: estimator,
    setTimer: (fn, ms) => { const id = nextId; nextId += 1; timers.set(id, { fn, at: now + ms, ms }); return id; },
    clearTimer: (id) => { timers.delete(id); },
    onDiagnostic: (d) => r.diagnostics.push(d), ...(guestIdleCount ? { guestIdleCount } : {}) });
  estimator.settling = () => controller.snapshot().hotspotSettling;
  r.controller = controller; r.estimator = estimator;
  Object.defineProperty(r, "now", { get: () => now });
  r.hot = () => { const s = controller.snapshot(); return s.inferredHotX === null ? null : [s.inferredHotX, s.inferredHotY]; };
  r.css = () => { const m = /\) (\d+) (\d+),/.exec(target.style.cursor); return m ? [Number(m[1]), Number(m[2])] : null; };
  r.settling = () => controller.snapshot().hotspotSettling;
  r.mode = "absolute";
  /** Look at what the page shows and at the rule's premise; called after every event and tick. */
  let last = "";
  r.sample = (why = "") => {
    const g = r.guest; const hot = r.hot(); const css = r.css();
    const key = `${g.shown}|${J(hot)}`;
    if (key !== last) { last = key; r.answers.push({ t: Math.round(now), image: g.shown, hot, why }); }
    if (hot !== null) {
      if (g.shown === null) r.violations.push({ t: now, what: "an answer while nothing is shown", hot });
      else {
        const truth = HOTS[g.shown];
        if (Math.max(Math.abs(hot[0] - truth[0]), Math.abs(hot[1] - truth[1])) > 1) r.violations.push({ t: Math.round(now), what: "wrong hotspot", image: g.shown, hot, truth, why });
        if (r.mode === "absolute" && J(css) !== J(hot)) r.violations.push({ t: Math.round(now), what: "the CSS cursor does not show the inferred hotspot", css, hot });
      }
    }
    // The premise: not settling, a cursor shown, absolute mode => the guest's pointer stands on a
    // position the page remembers (or the guest still has positions to act on, the first of
    // which the page remembers too — it then stands on an older remembered one, checked below).
    if (!r.settling() && g.shown !== null && r.mode === "absolute") {
      const sent = estimator._sent;
      if (!sent.some((p) => p.x === g.pointer[0] && p.y === g.pointer[1])) {
        r.premise = (r.premise ?? 0) + 1;
        if (!r.firstPremise) r.firstPremise = { t: Math.round(now), pointer: [...g.pointer], lastSent: sent.at(-1) ?? null, why };
      }
    }
  };
  r.at = async (t) => {
    await flush();
    for (;;) {
      let best = null;
      for (const [id, timer] of timers) if (timer.at <= t && (!best || timer.at < best[1].at)) best = [id, timer];
      if (!best) break;
      timers.delete(best[0]); now = Math.max(now, best[1].at); best[1].fn();
      await flush(); r.sample("tick");
    }
    if (t > now) now = t;
    await flush(); r.sample("tick");
    return r;
  };
  r.wait = (ms) => r.at(now + ms);
  r.flush = async () => { await flush(); r.sample("flush"); };
  /** Answer the oldest reading of a manual counter. */
  r.reading = async (value) => { if (r.pending.length === 0) throw new Error("no reading outstanding"); r.pending.shift()(value); await flush(); r.sample("reading"); };
  r.pollTimers = () => [...timers.values()].filter((timer) => timer.ms === HOTSPOT_POLL_MS).length;

  const newGuest = (tabletAt) => {
    const g = { queue: [], tablet: [...tabletAt], pointer: [640, 400], plane: [0, 0], shown: null, up: true, locked: false, dropped: 0, commits: 0 };
    const state = (name, x, y) => ({ resourceId: IDS[name], hotX: 0, hotY: 0, pos: { scanoutId: 0, x: x >>> 0, y: y >>> 0 } });
    const U = (name, x, y) => { if (!controller.handle({ type: "cursor-update", state: state(name, x, y), format: 1, resourceWidth: r.size, resourceHeight: r.size, pixels: new Uint32Array(r.size * r.size).fill(FILLS[name]) })) throw new Error("update rejected"); };
    const M = (name, x, y) => { if (!controller.handle({ type: "cursor-move", state: state(name, x, y) })) throw new Error("move rejected"); };
    /** One commit: set image at the plane's previous position, then move (also when nothing moved). */
    g.commit = (name = g.shown) => {
      if (name === null || !g.up) return g;
      const hot = HOTS[name];
      U(name, g.plane[0], g.plane[1]);
      g.shown = name;
      g.plane = [g.pointer[0] - hot[0], g.pointer[1] - hot[1]];
      M(name, g.plane[0], g.plane[1]);
      g.commits += 1; r.sample("commit"); return g;
    };
    g.show = (name, x = g.pointer[0], y = g.pointer[1]) => { g.pointer = [x, y]; return g.commit(name); };
    /** The device's hide: a cursor-UPDATE with resource 0 (what update_cursor publishes). */
    g.hide = () => {
      if (g.shown === null) return g;
      if (!controller.handle({ type: "cursor-update", state: { resourceId: 0, hotX: 0, hotY: 0, pos: { scanoutId: 0, x: g.plane[0] >>> 0, y: g.plane[1] >>> 0 } }, format: null, resourceWidth: 0, resourceHeight: 0, pixels: new Uint32Array(0) })) throw new Error("hide rejected");
      g.shown = null; r.sample("hide"); return g;
    };
    /** The worker's test guest's hide: a cursor-MOVE with resource 0 (not an event of this device). */
    g.hideByMove = () => {
      controller.handle({ type: "cursor-move", state: { resourceId: 0, hotX: 0, hotY: 0, pos: { scanoutId: 0, x: g.plane[0] >>> 0, y: g.plane[1] >>> 0 } } });
      g.shown = null; r.sample("hide by move"); return g;
    };
    /** Handle up to n queued tablet frames. */
    g.act = (n = Infinity, name = null) => {
      for (let i = 0; i < n && g.queue.length; i += 1) {
        const [x, y] = g.queue.shift();
        const changed = x !== g.tablet[0] || y !== g.tablet[1];
        g.tablet = [x, y];
        if (!changed) { g.dropped += 1; continue; }     // the kernel passes it on to nobody
        if (!g.up || g.locked) continue;                // nobody moves a pointer for it
        g.pointer = [x, y];
        if (name ?? g.shown) g.commit(name ?? g.shown);
      }
      r.sample("act"); return g;
    };
    /** Relative motion (the mouse device). */
    g.rel = (dx, dy) => { if (!g.up || g.locked) return g; g.pointer = [g.pointer[0] + dx, g.pointer[1] + dy]; if (g.shown) g.commit(); r.sample("rel"); return g; };
    /** The compositor goes away (its cursor with it) and a new one starts with its pointer at (100,100). */
    g.compositorStop = () => { g.hide(); g.up = false; return g; };
    g.compositorStart = (name = "arrow") => { g.up = true; g.locked = false; g.pointer = [100, 100]; return g.commit(name); };
    /** A client's pointer lock: the cursor hidden, the pointer held where it is. */
    g.lock = () => { g.hide(); g.locked = true; return g; };
    g.unlock = (name = "arrow") => { g.locked = false; return g.commit(name); };
    return g;
  };
  r.guest = newGuest(tablet);
  /** The page sends an absolute position (pointer.js: both axes, then SYN). */
  r.S = (x, y, w = r.output[0], h = r.output[1]) => {
    if (r.mode !== "absolute") throw new Error("harness: absolute positions are sent in absolute mode only");
    controller.notePointer(x, y, w, h); r.guest.queue.push([x, y]); r.lastSent = [x, y]; r.sample("S"); return r;
  };
  /** Send and let the guest act on everything. */
  r.go = (x, y, name = null) => { r.S(x, y); r.guest.act(Infinity, name); return r; };
  r.setMode = (mode) => { r.mode = mode; controller.setPointerState({ mode, pointerLocked: mode === "relative" }); r.sample("mode"); return r; };
  r.hook = () => { controller.resetHotspotInference(); r.sample("hook"); return r; };
  /** The machine is reset: the page's controller with it, and a new guest takes its place. */
  r.reboot = (tabletAt = [0, 0]) => { controller.reset(); r.mode = "absolute"; r.guest = newGuest(tabletAt); r.sample("reset"); return r.guest; };
  /** A page that has been in use: a cursor shown, two different positions, the guest idle after them. */
  r.settle = async (x = 1270, y = 10) => {
    if (r.guest.shown === null) r.guest.show("arrow", x - 16, y);
    r.S(x - 8, y); r.S(x, y); r.guest.act();
    await r.wait(3 * HOTSPOT_POLL_MS);
    if (r.settling()) throw new Error("harness: the page did not settle after two positions and an idle guest");
    return r;
  };
  return r;
}
export const wrong = (r) => r.violations.filter((v) => v.what === "wrong hotspot");
export function rng(seed) {
  let state = seed >>> 0 || 1;
  return () => { state ^= state << 13; state >>>= 0; state ^= state >>> 17; state ^= state << 5; state >>>= 0; return state / 0x100000000; };
}
