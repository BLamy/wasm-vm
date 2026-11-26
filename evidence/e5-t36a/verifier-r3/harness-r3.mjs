// E5-T36a verifier (round 3): a rig that drives the REAL CursorController in the device's order
// (every commit is UPDATE at the plane's previous position, then MOVE — also when the plane does
// not move), on a virtual clock, with an idle counter that behaves like the paced clock's:
// it moves on only when it is read while the guest has nothing outstanding (and is not `busy`
// with other work).
//
// Adapted from round 2's harness.mjs (left as it was). New: the clock is asynchronous (the
// controller's questions to the guest are promises), and `guestIdleCount`.
// Imports the sources under web/src/sink, or the directory named by SINK_DIR (mutants).
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const sinkDir = process.env.SINK_DIR ?? path.resolve(here, "../../../web/src/sink");
export const controllerModule = await import(pathToFileURL(path.join(sinkDir, "cursor-controller.js")));
export const { CursorController, HOTSPOT_REST_MS, HOTSPOT_POLL_MS, HOTSPOT_CAUGHT_UP_TIMEOUT_MS, HOTSPOT_SETTLE_FALLBACK_MS } = controllerModule;
export const { CursorHotspotEstimator } = await import(pathToFileURL(path.join(sinkDir, "cursor-hotspot.js")));

const FILLS = new Map();
function fillOf(name) {
  if (!FILLS.has(name)) FILLS.set(name, (0xff000000 | ((FILLS.size + 1) * 0x3157b1)) >>> 0);
  return FILLS.get(name);
}
const flush = async () => { for (let i = 0; i < 8; i += 1) await new Promise((resolve) => setImmediate(resolve)); };

/**
 * `counter`: "honest" (default) | "none" | a function (rig) => async () => value.
 * rig.outstanding is the number of sent positions the guest has not acted on; the tests set it.
 */
export function makeRig({ size = 64, output = [1280, 800], counter = "honest", options = {} } = {}) {
  let now = 0;
  const timers = new Map(); let nextId = 1;
  const target = { style: { cursor: "auto" }, appendChild() {}, removeChild() {} };
  const diagnostics = [];
  const rig = { target, diagnostics, timers, outstanding: 0, idleWaits: 0, asked: 0, plane: [0, 0], shown: null, rid: null, hots: {}, history: [] };
  const guestIdleCount = counter === "none" ? null
    : typeof counter === "function" ? counter(rig)
      : async () => { rig.asked += 1; if (rig.outstanding === 0 && !rig.busy) rig.idleWaits += 1; return rig.idleWaits; };
  const controller = new CursorController({ target, documentTarget: null,
    setTimer: (fn, ms) => { const id = nextId; nextId += 1; timers.set(id, { fn, at: now + ms }); return id; },
    clearTimer: (id) => { timers.delete(id); },
    onDiagnostic: (d) => diagnostics.push(d), ...(guestIdleCount ? { guestIdleCount } : {}), ...options });
  Object.defineProperty(rig, "now", { get: () => now });
  Object.assign(rig, { controller,
    flush,
    /** Advance the clock to `t`, firing every timer due on the way in order, letting promises run. */
    async at(t) {
      await flush();
      for (;;) {
        let best = null;
        for (const [id, timer] of timers) if (timer.at <= t && (!best || timer.at < best[1].at)) best = [id, timer];
        if (!best) break;
        timers.delete(best[0]); now = Math.max(now, best[1].at); best[1].fn();
        await flush();
        rig.onTick?.(now);
      }
      if (t > now) now = t;
      return rig;
    },
    wait(ms) { return rig.at(now + ms); },
    /** The page sends a position; the guest has it outstanding until the test says it acted. */
    S(x, y, w = output[0], h = output[1]) { controller.notePointer(x, y, w, h); rig.outstanding += 1; rig.lastSent = [x, y]; return rig; },
    state(name, x, y) { return { resourceId: 100 + [...FILLS.keys()].indexOf(name), hotX: 0, hotY: 0, pos: { scanoutId: 0, x: x >>> 0, y: y >>> 0 } }; },
    U(name, x, y) {
      const fill = fillOf(name);
      const ok = controller.handle({ type: "cursor-update", state: rig.state(name, x, y), format: 1,
        resourceWidth: size, resourceHeight: size, pixels: new Uint32Array(size * size).fill(fill) });
      if (!ok) throw new Error(`update rejected: ${name} ${x},${y}`);
      rig.shown = name; return rig;
    },
    M(name, x, y) {
      const ok = controller.handle({ type: "cursor-move", state: rig.state(name, x, y) });
      if (!ok) throw new Error(`move rejected: ${name} ${x},${y}`);
      return rig;
    },
    /**
     * One guest commit in the device's order: the guest's pointer is at (x, y), its image `name`
     * with true hotspot rig.hots[name]. `acted` = how many outstanding positions this commit
     * disposes of (0 for a commit made for another reason: the plane is re-reported where it is).
     */
    commit(name, x, y, acted = 0) {
      const hot = rig.hots[name];
      rig.U(name, rig.plane[0], rig.plane[1]);
      rig.plane = [x - hot[0], y - hot[1]];
      rig.M(name, rig.plane[0], rig.plane[1]);
      rig.outstanding = Math.max(0, rig.outstanding - acted);
      rig.guestAt = [x, y]; rig.image = name;
      return rig;
    },
    /** The hotspot the controller says it inferred, or null. */
    hot() { const s = controller.snapshot(); return s.inferredHotX === null ? null : [s.inferredHotX, s.inferredHotY]; },
    /** The hotspot in the CSS cursor the page shows (what the user sees), or null if not a url cursor. */
    css() { const m = /\) (\d+) (\d+),/.exec(target.style.cursor); return m ? [Number(m[1]), Number(m[2])] : null; },
    settling() { return controller.snapshot().hotspotSettling; },
  });
  return rig;
}

export function rng(seed) {
  let state = seed >>> 0 || 1;
  return () => { state ^= state << 13; state >>>= 0; state ^= state >>> 17; state ^= state << 5; state >>>= 0; return state / 0x100000000; };
}
export const minJerk = (t) => t * t * t * (10 - 15 * t + 6 * t * t);
export const off = (hot, truth) => (hot === null ? null : Math.max(Math.abs(hot[0] - truth[0]), Math.abs(hot[1] - truth[1])));
export const J = (v) => JSON.stringify(v);
