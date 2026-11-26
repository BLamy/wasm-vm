// E5-T36a verifier (round 4): round 3's rig (harness-r3.mjs, left as it was: the REAL
// CursorController on a virtual clock, the device's order — every commit is UPDATE at the
// plane's previous position, then MOVE — and an idle counter that moves on only when it is
// read while the guest has nothing outstanding), plus what round 4's rule needs:
//
//   * `settleFirst`: the page now starts "settling". A page that has been in use is settled, so
//     the round-3 sequences are replayed after one position far away and one idle reading.
//   * `Guest`: a guest with a queue of sent positions, a pointer of its own, and — optionally —
//     the Linux input core's rule that an absolute-axis value equal to the device's current
//     one is dropped (drivers/input/input.c, input_handle_abs_event: `if (*pold == *pval)
//     return INPUT_IGNORE_EVENT`), so that a frame of two unchanged axes reaches nobody.
//
// SINK_DIR=<dir> imports the sink files from there (mutants); default web/src/sink.
export * from "../verifier-r3/harness-r3.mjs";
import { makeRig } from "../verifier-r3/harness-r3.mjs";

export const HOTS = { arrow: [1, 1], hand: [9, 4], caret: [4, 8], cross: [0, 0] };
export const FAR = [1270, 10];

/** A rig whose page is already settled: one position far from everything, the guest idle after it. */
export async function settledRig(options = {}) {
  const r = makeRig({ size: 64, ...options }); r.hots = HOTS; r.plane = [0, 0];
  await settleFirst(r);
  return r;
}
export async function settleFirst(r) {
  r.S(FAR[0], FAR[1]); r.outstanding = 0;
  await r.wait(120);
  if (r.settling()) throw new Error("harness: the page did not settle after a position and an idle guest");
  return r;
}

/**
 * A guest on a rig. `kernelDrop`: an absolute position equal to the tablet's last one is not
 * acted on (and produces no commit). The rig's honest counter reads `r.outstanding`, which is
 * kept equal to the queue's length: the guest is idle exactly when nothing delivered is left
 * unhandled — handled, not necessarily acted on.
 */
export function makeGuest(r, { kernelDrop = false, pointer = [640, 400] } = {}) {
  const g = { queue: [], pointer: [...pointer], tablet: null, image: null, dropped: 0, reports: 0,
    /** The page sends an absolute position. */
    send(x, y, w, h) { r.S(x, y, ...(w ? [w, h] : [])); g.queue.push([x, y]); r.outstanding = g.queue.length; return g; },
    /** One commit: set image at the previous plane position, then move (also when nothing moved). */
    report(name = g.image) {
      const hot = r.hots[name];
      r.U(name, r.plane[0], r.plane[1]);
      r.plane = [g.pointer[0] - hot[0], g.pointer[1] - hot[1]];
      r.M(name, r.plane[0], r.plane[1]);
      g.image = name; g.reports += 1; r.sample?.(); return g;
    },
    /** Handle up to n queued positions; each that moves the pointer is one commit. */
    act(n = Infinity, name = g.image) {
      for (let i = 0; i < n && g.queue.length; i += 1) {
        const p = g.queue.shift();
        const same = g.tablet && g.tablet[0] === p[0] && g.tablet[1] === p[1];
        g.tablet = p;
        if (kernelDrop && same) { g.dropped += 1; continue; }
        g.pointer = p;
        if (name) g.report(name);
      }
      r.outstanding = g.queue.length; return g;
    },
    /** Relative motion (another device: the tablet's values are untouched). */
    rel(dx, dy) { g.pointer = [g.pointer[0] + dx, g.pointer[1] + dy]; if (g.image) g.report(); return g; },
    /** The cursor is hidden: a move with resource 0. */
    hide() { r.controller.handle({ type: "cursor-move", state: { resourceId: 0, hotX: 0, hotY: 0, pos: { scanoutId: 0, x: r.plane[0] >>> 0, y: r.plane[1] >>> 0 } } }); return g; },
  };
  return g;
}

/** Record every answer the page shows as it changes: [t, image, hot]. */
export function watch(r, g = null) {
  r.answers = []; let last = "null";
  const sample = () => { const hot = r.hot(); const k = JSON.stringify(hot) + r.shown; if (k !== last) { last = k; r.answers.push([Math.round(r.now), r.shown, hot]); } };
  r.onTick = sample; r.sample = sample;
  return r;
}
export const wrongOf = (r) => r.answers.filter(([, image, hot]) => hot && Math.max(Math.abs(hot[0] - HOTS[image][0]), Math.abs(hot[1] - HOTS[image][1])) > 1);
