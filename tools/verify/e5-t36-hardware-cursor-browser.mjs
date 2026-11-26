#!/usr/bin/env node
// E5-T36a / E5-T36c: on the built page, the Replay desktop's pointer is ONE pointer — the guest's
// cursor image drawn by the host as a CSS cursor, with its tip on the guest pixel the page sent
// — and the guest frame carries no painted pointer.
//
//   node tools/verify/e5-t36-hardware-cursor-browser.mjs --url http://127.0.0.1:8125 --app /app.html --out DIR
//        [--legacy-kms-session]
//
// For three cursor shapes (arrow over the page body, hand over the button, text caret over the
// terminal) it moves the real pointer to a few guest positions and then compares
//   * the canvas's computed `cursor` (image and hotspot the browser uses), with
//   * the kernel's cursor-plane position in the guest (/sys/kernel/debug/dri/0/state):
//     plane position + hotspot must be the guest position the page sent, within one pixel.
//
// `--legacy-kms-session` is for an image whose session still forces software cursors (the
// published generation 1): the script first restarts the guest's session from the serial root
// shell with WLR_DRM_NO_ATOMIC=1 in place of WLR_NO_HARDWARE_CURSORS=1 — the one change
// E5-T36b makes in the image — so the host side can be proven before that image exists.
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const { values: opt } = parseArgs({ options: {
  url: { type: "string", default: "http://127.0.0.1:8125" }, app: { type: "string", default: "/app.html" },
  query: { type: "string", default: "" }, out: { type: "string" },
  "legacy-kms-session": { type: "boolean", default: false },
  chrome: { type: "string", default: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" },
} });
assert.ok(opt.out, "usage: e5-t36-hardware-cursor-browser.mjs --out DIR [--url BASE] [--app PATH] [--legacy-kms-session]");
const out = path.resolve(opt.out);
await mkdir(out, { recursive: true });
const { chromium } = await import(pathToFileURL(path.join(repo, "web/node_modules/playwright/index.mjs")));
const browser = await chromium.launch({ executablePath: opt.chrome, headless: true });
const result = { task: "E5-T36", legacyKmsSession: opt["legacy-kms-session"], url: `${opt.url}${opt.app}?guest=replay-desktop&desktop=1${opt.query}#ide`, browser: browser.version(), shapes: [] };
let failure = null;
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, serviceWorkers: "block" });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => { if (m.type() === "error" && !/favicon/.test(m.location().url ?? "")) errors.push(m.text()); });
  await page.addInitScript(() => { window.addEventListener("wvm:desktop-ready", () => { window.__ready = performance.now(); }); });
  await page.goto(result.url);
  await page.waitForFunction(() => window.__ready !== undefined && document.getElementById("omarchy-boot-overlay")?.hidden === true,
    null, { timeout: 15 * 60_000, polling: 250 });
  const sh = async (cmd) => (await page.evaluate((c) => window.wvmDemo.exec(c, 120_000, { quiet: true }), cmd))?.stdout ?? "";
  const canvas = page.locator("#ide-display-canvas");
  const box = await canvas.boundingBox();
  const GUEST = { w: 1280, h: 800 };
  const toPage = ([x, y]) => [box.x + (x / GUEST.w) * box.width, box.y + (y / GUEST.h) * box.height];
  if (opt["legacy-kms-session"]) {
    // The image's own session script with the one variable changed, started the way rcS does.
    assert.equal((await sh("sed -e 's/ WLR_NO_HARDWARE_CURSORS=1/ WLR_DRM_NO_ATOMIC=1/' /usr/local/bin/replay-desktop-session > /tmp/session && chmod 755 /tmp/session && grep -c WLR_DRM_NO_ATOMIC=1 /tmp/session")).trim(), "1",
      "the image's session script forces software cursors (nothing to restart otherwise)");
    await sh("kill $(pidof sway); sleep 2; pkill -9 chrome; pkill foot; rm -rf /run/user/1000/replay-chromium /run/user/1000/sway-ipc.* /run/user/1000/wayland-*; : > /run/replay-desktop/events");
    await sh("(su -s /bin/sh desktop -c /tmp/session </dev/null >/run/session2.log 2>&1 &); sleep 1");
    const t0 = Date.now();
    for (;;) {
      if (/REPLAY_CHROMIUM_READY/.test(await sh("cat /run/replay-desktop/events"))) break;
      assert.ok(Date.now() - t0 < 15 * 60_000, "the restarted session reached REPLAY_CHROMIUM_READY");
      await page.waitForTimeout(3000);
    }
    result.sessionRestartSeconds = (Date.now() - t0) / 1000;
    await page.waitForTimeout(8000);
  }
  await sh("mount -t debugfs none /sys/kernel/debug 2>/dev/null; true");
  result.swayEnv = (await sh("tr '\\0' '\\n' < /proc/$(pidof sway)/environ | grep WLR_ | sort | tr '\\n' ' '")).trim();
  const cssCursor = () => page.evaluate(() => {
    const css = getComputedStyle(document.getElementById("ide-display-canvas")).cursor;
    const m = /^url\("(data:image\/png;base64,[^"]+)"\) (\d+) (\d+)/.exec(css);
    return m ? { image: m[1].length, imageTail: m[1].slice(-24), hotspot: [Number(m[2]), Number(m[3])] } : { raw: css.slice(0, 80) };
  });
  const cursorPlane = async () => {
    const state = await sh("cat /sys/kernel/debug/dri/0/state");
    for (const block of state.split(/^plane\[\d+\]: /m).slice(1)) {
      const pos = /crtc-pos=(\d+)x(\d+)\+(-?\d+)\+(-?\d+)/.exec(block);
      const fb = /^\s*fb=(\d+)/m.exec(block);
      if (pos && Number(pos[1]) <= 128 && fb && Number(fb[1]) > 0 && /crtc=crtc-0/.test(block)) {
        return { w: Number(pos[1]), h: Number(pos[2]), x: Number(pos[3]), y: Number(pos[4]) };
      }
    }
    return null;
  };
  // Each shape: visit a few scattered points (the hotspot is inferred from moves to different
  // places), ending on `rest`; then read both sides.
  const SHAPES = [
    { name: "arrow over the page body", expectHotspot: [1, 1], points: [[300, 620], [380, 700], [520, 650], [450, 730]] },
    { name: "hand over the button", expectHotspot: [9, 4], points: [[60, 510], [100, 520], [140, 505], [93, 516]] },
    { name: "text caret over the terminal", expectHotspot: [4, 8], points: [[900, 300], [950, 380], [1100, 340], [1000, 420]] },
  ];
  for (const shape of SHAPES) {
    for (const p of shape.points) { const [x, y] = toPage(p); await page.mouse.move(x, y); await page.waitForTimeout(700); }
    await page.waitForTimeout(1500);
    const rest = shape.points.at(-1);
    const css = await cssCursor();
    const plane = await cursorPlane();
    const entry = { name: shape.name, sentGuestPosition: rest, css, plane };
    result.shapes.push(entry);
    assert.ok(css.hotspot, `${shape.name}: the canvas cursor is the guest's image (${JSON.stringify(css)})`);
    assert.deepEqual(css.hotspot, shape.expectHotspot, `${shape.name}: hotspot`);
    assert.ok(plane, `${shape.name}: the guest has a cursor plane on the CRTC`);
    entry.tip = [plane.x + css.hotspot[0], plane.y + css.hotspot[1]];
    assert.ok(Math.abs(entry.tip[0] - rest[0]) <= 1 && Math.abs(entry.tip[1] - rest[1]) <= 1,
      `${shape.name}: plane ${plane.x},${plane.y} + hotspot ${css.hotspot} is the sent position ${rest}`);
  }
  assert.equal(new Set(result.shapes.map((s) => s.css.imageTail)).size, 3, "three different cursor images");
  // No painted pointer in the guest frame: the pixels around a resting pointer are the same as
  // after it has moved elsewhere (the terminal background does not change under a pointer).
  const region = async ([gx, gy]) => page.evaluate(([x, y]) => {
    const c = document.getElementById("ide-display-canvas");
    const s = document.createElement("canvas"); s.width = 48; s.height = 48;
    const ctx = s.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(c, x - 8, y - 8, 48, 48, 0, 0, 48, 48);
    const d = new Uint32Array(ctx.getImageData(0, 0, 48, 48).data.buffer);
    let h = 2166136261; for (let i = 0; i < d.length; i++) { h ^= d[i]; h = Math.imul(h, 16777619); }
    return h >>> 0;
  }, [Math.round((gx / GUEST.w) * (await canvas.evaluate((c) => c.width))), Math.round((gy / GUEST.h) * (await canvas.evaluate((c) => c.height)))]);
  const spot = [1150, 650]; // empty terminal background
  { const [x, y] = toPage(spot); await page.mouse.move(x, y); } await page.waitForTimeout(2500);
  const under = await region(spot);
  { const [x, y] = toPage([1150, 300]); await page.mouse.move(x, y); } await page.waitForTimeout(2500);
  const away = await region(spot);
  result.paintedPointer = { spot, hashUnderPointer: under, hashAfterMovingAway: away };
  assert.equal(under, away, "the guest frame has no pointer painted at the pointer's position");
  await canvas.screenshot({ path: path.join(out, "desktop.png") });
  result.errors = errors;
  assert.deepEqual(errors, [], "no console or page errors");
  result.pass = true;
} catch (error) {
  failure = error;
  result.pass = false;
  result.error = String(error?.stack ?? error);
} finally {
  await writeFile(path.join(out, "result.json"), `${JSON.stringify(result, null, 2)}\n`);
  await browser.close();
}
console.log(JSON.stringify({ pass: result.pass, swayEnv: result.swayEnv,
  shapes: result.shapes.map((s) => ({ name: s.name, sent: s.sentGuestPosition, hotspot: s.css?.hotspot, plane: s.plane && [s.plane.x, s.plane.y], tip: s.tip })),
  paintedPointer: result.paintedPointer, error: result.error }, null, 2));
if (failure) process.exit(1);
