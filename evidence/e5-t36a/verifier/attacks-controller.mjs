#!/usr/bin/env node
// E5-T36a verifier — the controller's use of the estimator around the edges of the claim:
// a device that sometimes reports a hotspot and sometimes does not; reset(); relative mode.
//
//   node evidence/e5-t36a/verifier/attacks-controller.mjs
import { writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CursorController } from "../../../web/src/sink/cursor-controller.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const lines = []; const say = (verdict, name, detail) => { const s = `${verdict.padEnd(8)} ${name}\n         ${detail}`; lines.push(s); console.log(s); };
const make = () => { const target = { style: { cursor: "auto" }, appendChild() {}, removeChild() {} }; return { target, c: new CursorController({ target, documentTarget: null }) }; };
const px = (fill) => new Uint32Array(64 * 64).fill(fill);
const update = (hotX, hotY, x, y, fill) => ({ type: "cursor-update", state: { resourceId: 7, hotX, hotY, pos: { scanoutId: 0, x: x >>> 0, y: y >>> 0 } }, format: 1, resourceWidth: 64, resourceHeight: 64, pixels: px(fill) });
const move = (hotX, hotY, x, y) => ({ type: "cursor-move", state: { resourceId: 7, hotX, hotY, pos: { scanoutId: 0, x: x >>> 0, y: y >>> 0 } } });
const css = (target) => { const m = /\) (\d+) (\d+),/.exec(target.style.cursor); return m ? `${m[1]},${m[2]}` : target.style.cursor.slice(0, 20); };
const A = 0xff0000ff; const B = 0xff00ff00;

// 1. an image whose hotspot was inferred, then an image for which the device reports one, and back
{
  const { target, c } = make();
  c.notePointer(100, 100); c.handle(update(0, 0, 97, 95, A)); c.notePointer(300, 200); c.handle(move(0, 0, 297, 195));
  const inferred = css(target);
  c.handle(update(2, 6, 298, 194, B)); const reported = css(target); const snap = c.snapshot();
  c.notePointer(500, 400); c.handle(move(2, 6, 480, 380)); c.notePointer(600, 300); c.handle(move(2, 6, 580, 280)); // positions that would "infer" (20,20)
  const stillReported = css(target);
  c.handle(update(0, 0, 597, 295, A)); const back = css(target);
  say(inferred === "3,5" && reported === "2,6" && snap.inferredHotX === null && stillReported === "2,6" && back === "3,5" ? "HELD" : "FAILED",
    "inferred image -> image with a device-reported hotspot -> back",
    `inferred ${inferred}; with the device's (2,6): ${reported} (inferred field ${snap.inferredHotX}); after two moves that would infer (20,20): ${stillReported}; first image again: ${back}`);
}
// 2. the same pixels, once with a reported hotspot and once without
{
  const { target, c } = make();
  c.notePointer(100, 100); c.handle(update(4, 4, 96, 96, A)); const reported = css(target);
  c.handle(update(0, 0, 91, 92, A)); c.notePointer(300, 200); c.handle(move(0, 0, 291, 192)); const inferred = css(target);
  c.handle(update(4, 4, 296, 196, A)); const again = css(target);
  say(reported === "4,4" && inferred === "9,8" && again === "4,4" ? "HELD" : "FAILED", "the same pixels with and without a device-reported hotspot",
    `reported ${reported}; unreported (plane says 9,8) ${inferred}; reported again ${again}`);
}
// 3. reset() keeps what was learned (keyed by pixels)
{
  const { target, c } = make();
  c.notePointer(100, 100); c.handle(update(0, 0, 97, 95, A)); c.notePointer(300, 200); c.handle(move(0, 0, 297, 195));
  c.reset(); c.handle(update(0, 0, 10, 10, A));
  say("INFO", "reset() does not clear the estimator", `the same image after reset(): ${css(target)} at once (a wrong answer therefore also survives a guest reboot in the same page)`);
}
// 4. relative mode: no absolute position is sent, the guest moves the plane by itself, and
//    handleMove still feeds those positions to the estimator (cursor-controller.js:370 has no mode check)
{
  const { target, c } = make(); const hot = { x: 9, y: 4 };
  c.notePointer(700, 400); c.handle(update(0, 0, 699, 399, A)); // another image so far; its plane position
  c.notePointer(696, 399); c.handle(move(0, 0, 695, 398));
  c.setPointerState({ mode: "relative", pointerLocked: true });
  // the guest's pointer continues by relative motion; a new image (B, true hotspot 9,4) appears
  let g = { x: 692, y: 398 };
  c.handle(update(0, 0, 695, 398, B)); c.handle(move(0, 0, g.x - hot.x, g.y - hot.y));
  g = { x: 688, y: 397 }; c.handle(move(0, 0, g.x - hot.x, g.y - hot.y));
  const during = c.snapshot();
  c.setPointerState({ mode: "absolute", pointerLocked: false });
  const after = css(target);
  say(after === "9,4" || during.inferredHotX === null ? "HELD" : "FAILED", "an image first shown while the pointer is in relative mode",
    `inferred while locked: (${during.inferredHotX},${during.inferredHotY}); CSS cursor back in absolute mode: ${after}; truth 9,4`);
}
writeFileSync(path.join(here, "attacks-controller.log"), `${lines.join("\n")}\n`);
