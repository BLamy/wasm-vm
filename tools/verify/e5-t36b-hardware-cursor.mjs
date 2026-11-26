#!/usr/bin/env node
// E5-T36b: boot a Replay desktop image on the native CLI and check, from the kernel's own DRM
// state, that the pointer is a cursor-plane image that follows the pointer — not a picture
// sway paints into the frame.
//
//   node tools/verify/e5-t36b-hardware-cursor.mjs --image IMG --out DIR [--expect software]
//
// `--expect software` is the control: on an image whose session still forces software cursors
// the same checks must find no cursor plane on the CRTC.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { parseArgs } from "node:util";
import { bootNative, last, lines, repo } from "../replay-desktop/native-shell.mjs";

const { values: opt } = parseArgs({ options: {
  image: { type: "string" }, out: { type: "string" },
  kernel: { type: "string", default: path.join(repo, "releases/kernel/6.6.63/Image") },
  cli: { type: "string", default: path.join(repo, "target/release/wasm-vm") },
  expect: { type: "string", default: "hardware" },
  "timeout-min": { type: "string", default: "30" },
} });
assert.ok(opt.image && opt.out, "usage: e5-t36b-hardware-cursor.mjs --image IMG --out DIR");
assert.ok(["hardware", "software"].includes(opt.expect));
const out = path.resolve(opt.out);
const guest = await bootNative({ image: opt.image, out, kernel: opt.kernel, cli: opt.cli, timeoutMin: Number(opt["timeout-min"]) });
const { sh, waitFor } = guest;
const result = { task: "E5-T36b", expect: opt.expect, startedAt: guest.startedAt, command: guest.command,
  imageSha256: createHash("sha256").update(await readFile(opt.image)).digest("hex") };

// Planes from /sys/kernel/debug/dri/0/state: [{ name, crtc, fb, w, h, x, y }].
async function planes() {
  const text = await sh("cat /sys/kernel/debug/dri/0/state", "DRM state");
  const found = [];
  for (const block of text.split(/^plane\[\d+\]: /m).slice(1)) {
    const name = block.split("\n")[0].trim();
    const field = (key) => new RegExp(`^\\s*${key}=(.*)$`, "m").exec(block)?.[1]?.trim() ?? null;
    const pos = /^(\d+)x(\d+)\+(-?\d+)\+(-?\d+)$/.exec(field("crtc-pos") ?? "");
    found.push({ name, crtc: field("crtc"), fb: Number(field("fb")),
      w: pos ? Number(pos[1]) : null, h: pos ? Number(pos[2]) : null, x: pos ? Number(pos[3]) : null, y: pos ? Number(pos[4]) : null });
  }
  return found;
}
let failure = null;
try {
  await waitFor((s) => /REPLAY_DESKTOP_READY uptime=\S+ mem_hwm_kib=\d+/.test(s), "REPLAY_DESKTOP_READY");
  const serial = guest.serial();
  result.chromiumPage = /REPLAY_CHROMIUM_PAGE [^\n]*\\"pass\\": true/.test(serial);
  assert.ok(result.chromiumPage, "Chrome's smoke page passed on this session");
  await guest.rootShell();
  result.swayEnv = lines(await sh("tr '\\0' '\\n' < /proc/$(pidof sway)/environ | grep WLR_", "sway environment")).sort();
  await sh("mount -t debugfs none /sys/kernel/debug 2>/dev/null; export SWAYSOCK=$(ls /run/user/1000/sway-ipc.*.sock | head -n 1)", "debugfs");
  // The pointer goes to four places through sway's own seat, as a pointing device would move it.
  result.moves = [];
  for (const [x, y] of [[300, 400], [640, 100], [93, 516], [1036, 420]]) {
    assert.equal(last(await sh(`swaymsg seat seat0 cursor set ${x} ${y} >/dev/null && echo MOVED`, "pointer move")), "MOVED");
    await sh("sleep 1", "settle");
    const all = await planes();
    const primary = all.find((p) => p.w === 1280 && p.h === 800);
    const cursor = all.find((p) => p !== primary && p.crtc !== null && p.crtc !== "(null)" && p.fb > 0);
    result.moves.push({ pointer: [x, y], planes: all, cursor: cursor ?? null });
    assert.ok(primary && primary.fb > 0, "the primary plane scans out the 1280x800 frame");
  }
  const cursors = result.moves.map((m) => m.cursor);
  if (opt.expect === "hardware") {
    assert.deepEqual(result.swayEnv, ["WLR_DRM_NO_ATOMIC=1", "WLR_RENDERER=pixman"]);
    assert.ok(cursors.every(Boolean), "a second plane is on the CRTC with a framebuffer after every move");
    // The plane sits at pointer minus the image's hotspot; the hotspot is a few pixels and may
    // differ between images (arrow, hand, text caret), but the plane follows the pointer.
    for (const m of result.moves) {
      const dx = m.pointer[0] - m.cursor.x, dy = m.pointer[1] - m.cursor.y;
      assert.ok(m.cursor.w <= 128 && m.cursor.h <= 128, "a cursor-sized plane");
      assert.ok(dx >= 0 && dx < m.cursor.w && dy >= 0 && dy < m.cursor.h,
        `plane at ${m.cursor.x},${m.cursor.y} for a pointer at ${m.pointer}`);
      m.hotspot = [dx, dy];
    }
  } else {
    assert.ok(result.swayEnv.includes("WLR_NO_HARDWARE_CURSORS=1"));
    assert.ok(cursors.every((c) => !c), "no second plane is on the CRTC: the pointer is painted into the frame");
  }
  result.pass = true;
} catch (error) {
  failure = error;
  result.pass = false;
  result.error = String(error?.stack ?? error);
} finally {
  result.hostSeconds = guest.hostSeconds();
  await writeFile(path.join(out, "result.json"), `${JSON.stringify(result, null, 2)}\n`);
  guest.stop();
}
console.log(JSON.stringify({ pass: result.pass, expect: result.expect, swayEnv: result.swayEnv,
  moves: result.moves?.map((m) => ({ pointer: m.pointer, cursor: m.cursor && [m.cursor.x, m.cursor.y, m.cursor.w, m.cursor.h], hotspot: m.hotspot })),
  error: result.error }, null, 2));
if (failure) process.exit(1);
