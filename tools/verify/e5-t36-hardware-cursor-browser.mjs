#!/usr/bin/env node
// E5-T36a / E5-T36c: on the built page, the Replay desktop's pointer is ONE pointer — the guest's
// cursor image drawn by the host as a CSS cursor, with its tip on the guest pixel the page sent
// — and the guest frame carries no painted pointer.
//
//   node tools/verify/e5-t36-hardware-cursor-browser.mjs --url http://127.0.0.1:8125 --app /app.html --out DIR
//        [--legacy-kms-session]
//
// It moves the real pointer the way a hand does — continuous straight glides at 60 Hz onto the
// button and the terminal from several directions, and single jumps — and at every rest
// compares
//   * the canvas's computed `cursor` (image and hotspot the browser uses), with
//   * the kernel's cursor-plane position in the guest (/sys/kernel/debug/dri/0/state):
//     plane position + hotspot must be the guest position the page sent, within one pixel.
// Each plan starts hotspot inference over, so every approach meets its cursor "for the first
// time". (The glide plans and the plan runner are the E5-T36a verifier's, whose straight
// approaches showed what jumps with long rests could not: a wrong hotspot kept for a session.)
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
const result = { task: "E5-T36", legacyKmsSession: opt["legacy-kms-session"], url: `${opt.url}${opt.app}?guest=replay-desktop&desktop=1${opt.query}#ide`, browser: browser.version(), shapes: [], plans: [] };
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
  // Centre of the guest pixel, so the page's own rounding notes exactly that pixel.
  const toPage = ([x, y]) => [box.x + ((x + 0.5) / GUEST.w) * box.width, box.y + ((y + 0.5) / GUEST.h) * box.height];
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
  }
  // Chrome schedules start-up work for its first 10-20 s. Start once the guest is idle: at
  // least 15 idle waits in a second (an idle desktop takes about 20). The proof is about the
  // pointer, not about a browser that is still starting.
  {
    const idleSleeps = async () => (await page.evaluate(() => window.__schedulerStats()))?.idleSleeps ?? 0;
    const t0 = Date.now();
    for (;;) {
      const before = await idleSleeps();
      await page.waitForTimeout(1000);
      if ((await idleSleeps()) - before >= 15) break;
      assert.ok(Date.now() - t0 < 5 * 60_000, "the guest became idle");
    }
    result.idleAfterSeconds = (Date.now() - t0) / 1000;
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
  // The guest pixel of the last absolute position the page really sent.
  const lastSent = () => page.evaluate(([w, h]) => {
    const frames = window.__pointer.frames();
    for (let i = frames.length - 1; i >= 0; i -= 1) {
      const c = frames[i]?.coordinates;
      if (c) return [Math.floor((c.x * w) / 32768), Math.floor((c.y * h) / 32768)];
    }
    return null;
  }, [GUEST.w, GUEST.h]);
  const minJerk = (t) => t * t * t * (10 - 15 * t + 6 * t * t);
  let at = null;
  const moveTo = async (g) => { const [x, y] = toPage(g); await page.mouse.move(x, y); at = g; };
  const jump = (to, restMs = 700) => ({ op: "jump", to, restMs });
  const glide = (to, ms, restMs = 800) => ({ op: "glide", to, ms, restMs });
  const read = (name, expectHotspot) => ({ op: "read", name, expectHotspot });
  const scattered = [jump([60, 510]), jump([100, 520]), jump([140, 505]), jump([93, 516])];
  const onward = [read("hand, after four scattered points inside the button", [9, 4]),
    glide([1000, 420], 1100), glide([1100, 340], 400), read("text caret over the terminal, after two glides", [4, 8]),
    glide([300, 650], 1000), glide([100, 520], 800), read("hand again, later in the plan", [9, 4])];
  const start = [jump([450, 700], 1500), glide([380, 640], 400), read("arrow over the page body", [1, 1])];
  const PLANS = [
    { name: "approach C: from just right of the button, one 0.33 s glide onto it",
      steps: [...start, glide([255, 515], 500), glide([146, 501], 334), read("hand, first time: one straight glide onto the button, at rest", [9, 4]), ...scattered, ...onward] },
    { name: "approach A: from the page body, one 0.46 s glide onto the button",
      steps: [...start, glide([431, 552], 500), glide([142, 515], 463), read("hand, first time: one straight glide onto the button, at rest", [9, 4]), ...scattered, ...onward] },
    { name: "approach from the right, across the button's edge at a slant",
      steps: [...start, glide([179, 495], 500), glide([72, 532], 604), read("hand, first time: one straight glide onto the button, at rest", [9, 4]), ...scattered, ...onward] },
    { name: "jumps with rests: each shape from scattered points",
      steps: [jump([300, 620]), jump([380, 700]), jump([520, 650]), jump([450, 730]), read("arrow over the page body", [1, 1]),
        ...scattered, read("hand over the button", [9, 4]),
        jump([900, 300]), jump([950, 380]), jump([1100, 340]), jump([1000, 420]), read("text caret over the terminal", [4, 8])] },
  ];
  // Every answer the page shows, as it changes (sampled every 8 ms): a read at rest cannot see
  // an answer that was shown and taken back.
  await page.evaluate(() => {
    const canvas = document.getElementById("ide-display-canvas");
    const timeline = []; let last = "";
    setInterval(() => {
      const css = getComputedStyle(canvas).cursor;
      const m = /^url\("(data:image\/png;base64,[^"]+)"\) (\d+) (\d+)/.exec(css);
      const s = window.__cursor.state();
      const entry = m ? [m[1].slice(-24), s.inferredHotX === null ? null : [s.inferredHotX, s.inferredHotY], [Number(m[2]), Number(m[3])]] : [null, null, null];
      const key = JSON.stringify(entry);
      if (key !== last) { last = key; timeline.push([Math.round(performance.now()), ...entry]); }
    }, 8);
    window.__hotspotTimeline = timeline;
  });
  result.plans = [];
  for (const plan of PLANS) {
    // Forget everything; the guest's moves count again once it has been idle since.
    await page.evaluate(() => window.__cursor.resetHotspotInference());
    await page.waitForFunction(() => window.__cursor.state().hotspotSettling === false, null, { timeout: 30_000, polling: 50 });
    const reads = [];
    for (const step of plan.steps) {
      if (step.op === "jump") {
        await moveTo(step.to);
      } else if (step.op === "glide") {
        const from = at; const hz = 60; const n = Math.max(1, Math.round((step.ms * hz) / 1000));
        const began = performance.now();
        for (let i = 1; i <= n; i += 1) {
          const f = minJerk(i / n);
          const g = [Math.round(from[0] + (step.to[0] - from[0]) * f), Math.round(from[1] + (step.to[1] - from[1]) * f)];
          if (g[0] !== at[0] || g[1] !== at[1]) await moveTo(g);
          const due = began + (i * 1000) / hz - performance.now();
          if (due > 0) await new Promise((resolve) => setTimeout(resolve, due));
        }
      } else {
        await page.waitForTimeout(1500);
        const css = await cssCursor(); const plane = await cursorPlane(); const sent = await lastSent();
        const state = await page.evaluate(() => { const s = window.__cursor.state(); return { inferred: s.inferredHotX === null ? null : [s.inferredHotX, s.inferredHotY], styleWrites: s.styleWrites }; });
        const entry = { name: step.name, expectHotspot: step.expectHotspot, sent, css, plane, inferred: state.inferred };
        reads.push(entry);
        assert.ok(css.hotspot, `${plan.name} / ${step.name}: the canvas cursor is the guest's image (${JSON.stringify(css)})`);
        assert.ok(plane, `${plan.name} / ${step.name}: the guest has a cursor plane on the CRTC`);
        assert.ok(state.inferred, `${plan.name} / ${step.name}: at rest the hotspot is known`);
        assert.deepEqual(css.hotspot, state.inferred, "the canvas shows what the controller inferred");
        entry.tip = [plane.x + css.hotspot[0], plane.y + css.hotspot[1]];
        entry.tipError = [entry.tip[0] - sent[0], entry.tip[1] - sent[1]];
        assert.ok(Math.abs(entry.tipError[0]) <= 1 && Math.abs(entry.tipError[1]) <= 1,
          `${plan.name} / ${step.name}: plane ${plane.x},${plane.y} + hotspot ${css.hotspot} is the sent position ${sent}`);
        assert.ok(Math.abs(css.hotspot[0] - step.expectHotspot[0]) <= 1 && Math.abs(css.hotspot[1] - step.expectHotspot[1]) <= 1,
          `${plan.name} / ${step.name}: hotspot ${css.hotspot}, expected ${step.expectHotspot} within one pixel`);
      }
      if (step.restMs) await page.waitForTimeout(step.restMs);
    }
    result.plans.push({ name: plan.name, reads });
  }
  result.shapes = result.plans.at(-1).reads;
  assert.equal(new Set(result.shapes.map((s) => s.css.imageTail)).size, 3, "three different cursor images");
  // The timeline: whenever the page showed a hotspot for one of the three images, it was the
  // right one, and the canvas showed what the controller had inferred.
  const truth = new Map(result.shapes.map((s) => [s.css.imageTail, s.expectHotspot]));
  result.timeline = await page.evaluate(() => window.__hotspotTimeline);
  result.timelineAnswers = 0;
  for (const [at, image, hot, cssHot] of result.timeline) {
    if (image === null || hot === null) continue;
    result.timelineAnswers += 1;
    assert.deepEqual(cssHot, hot, `t=${at}: the canvas shows the inferred hotspot`);
    const expected = truth.get(image);
    assert.ok(expected, `t=${at}: an answer for an image none of the reads saw`);
    assert.ok(Math.abs(hot[0] - expected[0]) <= 1 && Math.abs(hot[1] - expected[1]) <= 1, `t=${at}: shown ${hot}, true ${expected}`);
  }
  assert.ok(result.timelineAnswers >= 12, "each plan's three shapes were answered");
  result.cursorDiagnostics = await page.evaluate(() => window.__cursor.diagnostics());
  assert.deepEqual(result.cursorDiagnostics, [], "no cursor diagnostics");
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
  plans: (result.plans ?? []).map((p) => ({ plan: p.name, reads: p.reads.map((r) => `${r.name}: sent ${r.sent} hotspot ${r.css?.hotspot} plane ${r.plane && [r.plane.x, r.plane.y]} tip error ${r.tipError}`) })),
  timeline: result.timeline && `${result.timeline.length} changes, ${result.timelineAnswers} answers shown, none wrong`,
  paintedPointer: result.paintedPointer, error: result.error }, null, 2));
if (failure) process.exit(1);
