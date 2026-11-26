// E5-T36a verifier (round 2): a rig that drives the REAL CursorController the way the device
// does, with a virtual clock for its rest timer. Imports the sources under web/src/sink (or the
// directory named by SINK_DIR, for mutants in a scratch copy).
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const sinkDir = process.env.SINK_DIR ?? path.resolve(here, "../../../web/src/sink");
export const { CursorController, HOTSPOT_REST_MS } = await import(pathToFileURL(path.join(sinkDir, "cursor-controller.js")));
export const { CursorHotspotEstimator } = await import(pathToFileURL(path.join(sinkDir, "cursor-hotspot.js")));

const FILLS = new Map();
function fillOf(name) {
  if (!FILLS.has(name)) FILLS.set(name, (0xff000000 | ((FILLS.size + 1) * 0x3157b1)) >>> 0);
  return FILLS.get(name);
}

export function makeRig({ size = 64, output = [1280, 800], options = {} } = {}) {
  let now = 0;
  const timers = new Map(); let nextId = 1;
  const target = { style: { cursor: "auto" }, appendChild() {}, removeChild() {} };
  const diagnostics = [];
  const controller = new CursorController({ target, documentTarget: null,
    setTimer: (fn, ms) => { const id = nextId; nextId += 1; timers.set(id, { fn, at: now + ms }); return id; },
    clearTimer: (id) => { timers.delete(id); },
    onDiagnostic: (d) => diagnostics.push(d), ...options });
  const rig = { controller, target, diagnostics, timers, restFired: 0,
    get now() { return now; },
    /** Advance the clock to `t`, firing every timer due on the way, in order. */
    at(t) {
      for (;;) {
        let best = null;
        for (const [id, timer] of timers) if (timer.at <= t && (!best || timer.at < best[1].at)) best = [id, timer];
        if (!best) break;
        timers.delete(best[0]); now = best[1].at; best[1].fn(); rig.restFired += 1; rig.onRest?.(now);
      }
      if (t > now) now = t;
      return rig;
    },
    wait(ms) { return rig.at(now + ms); },
    S(x, y, w = output[0], h = output[1]) { controller.notePointer(x, y, w, h); return rig; },
    state(name, x, y, rid) { return { resourceId: rid ?? 100 + [...FILLS.keys()].indexOf(name), hotX: 0, hotY: 0, pos: { scanoutId: 0, x: x >>> 0, y: y >>> 0 } }; }, // u32, as virtio carries it
    U(name, x, y, rid) {
      const fill = fillOf(name);
      const ok = controller.handle({ type: "cursor-update", state: rig.state(name, x, y, rid), format: 1,
        resourceWidth: size, resourceHeight: size, pixels: new Uint32Array(size * size).fill(fill) });
      if (!ok) throw new Error(`update rejected: ${name} ${x},${y}`);
      rig.shown = name; rig.rid = rid ?? rig.state(name, 0, 0).resourceId;
      return rig;
    },
    M(name, x, y, rid) {
      const ok = controller.handle({ type: "cursor-move", state: rig.state(name, x, y, rid ?? rig.rid) });
      if (!ok) throw new Error(`move rejected: ${name} ${x},${y}`);
      return rig;
    },
    /** The hotspot the controller says it inferred, or null. */
    hot() { const s = controller.snapshot(); return s.inferredHotX === null ? null : [s.inferredHotX, s.inferredHotY]; },
    /** The hotspot in the CSS cursor the page shows (what the user sees), or null if not a url cursor. */
    css() { const m = /\) (\d+) (\d+),/.exec(target.style.cursor); return m ? [Number(m[1]), Number(m[2])] : null; },
  };
  return rig;
}

/**
 * A guest on legacy KMS: EVERY commit is UPDATE(image, at the plane's previous position) then
 * MOVE(new plane position) — as recorded (round 1: 559 of 560 updates carry the previous plane
 * position; a commit whose plane does not move still reports both).
 */
export class DeviceGuest {
  constructor(rig, hots, { rounding = () => [0, 0] } = {}) {
    this.rig = rig; this.hots = hots; this.image = null; this.plane = { x: 0, y: 0 }; this.rounding = rounding;
  }
  /** One commit: the guest's pointer is at (x, y) and its cursor image is `name`. */
  commit(name, x, y) {
    const hot = this.hots[name]; const [rx, ry] = this.rounding();
    this.rig.U(name, this.plane.x, this.plane.y);
    this.image = name; this.pointer = { x, y };
    this.plane = { x: x + rx - hot[0], y: y + ry - hot[1] };
    this.rig.M(name, this.plane.x, this.plane.y);
  }
}

export function rng(seed) {
  let state = seed >>> 0 || 1;
  return () => { state ^= state << 13; state >>>= 0; state ^= state >>> 17; state ^= state << 5; state >>>= 0; return state / 0x100000000; };
}
export const minJerk = (t) => t * t * t * (10 - 15 * t + 6 * t * t);
export const off = (hot, truth) => (hot === null ? null : Math.max(Math.abs(hot[0] - truth[0]), Math.abs(hot[1] - truth[1])));
