#!/usr/bin/env node
// E5-T36a verifier attack: the worker's browser proof only teleports the pointer between scattered
// points and rests 700 ms on each. A person moves the pointer along a continuous path. This script
// boots the same page the same way (committed bundle, published image, session restarted on legacy
// KMS exactly as tools/verify/e5-t36-hardware-cursor-browser.mjs does it), then replays a PLAN of
// continuous glides and, at each `read`, records
//   * the canvas's computed CSS cursor (image + hotspot the browser uses),
//   * the kernel's cursor-plane position in the guest (/sys/kernel/debug/dri/0/state),
//   * the last guest position the page noted (from window.__pointer.frames(), a public hook),
//   * window.__cursor.state().
// It asserts nothing about hotspots; it reports. `tipError` = (plane + css hotspot) - sent.
//
//   node continuous-path-browser.mjs --plan PLAN.json --out DIR [--url BASE] [--app PATH] [--instrument] [--coverage]
//
// --instrument serves cursor-controller.js with two log lines injected IN MEMORY (page.route; no
// file is modified): every cursor event the device delivers and every position the page notes go to
// window.__vlog, dumped to DIR/events.json. Runs meant as proof are made WITHOUT --instrument.
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const { values: opt } = parseArgs({ options: {
  url: { type: "string", default: "http://127.0.0.1:8125" }, app: { type: "string", default: "/app.html" },
  out: { type: "string" }, plan: { type: "string" }, instrument: { type: "boolean", default: false },
  coverage: { type: "boolean", default: false },
  chrome: { type: "string", default: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" },
} });
assert.ok(opt.out && opt.plan, "usage: continuous-path-browser.mjs --plan PLAN.json --out DIR [--instrument]");
const out = path.resolve(opt.out);
await mkdir(out, { recursive: true });
const plan = JSON.parse(await readFile(opt.plan, "utf8"));
const { chromium } = await import(pathToFileURL(path.join(repo, "web/node_modules/playwright/index.mjs")));
const browser = await chromium.launch({ executablePath: opt.chrome, headless: true });
const result = { task: "E5-T36a verifier", instrumented: opt.instrument, plan: path.basename(opt.plan),
  url: `${opt.url}${opt.app}?guest=replay-desktop&desktop=1#ide`, browser: browser.version(), reads: [] };
let failure = null;
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, serviceWorkers: "block" });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => { if (m.type() === "error" && !/favicon/.test(m.location().url ?? "")) errors.push(m.text()); });
  if (opt.instrument) {
    await page.route("**/src/sink/cursor-controller.js", async (route) => {
      const response = await route.fetch();
      let body = await response.text();
      const a = "  handle(event) {\n    switch (eventType(event)) {";
      const b = "  notePointer(x, y) {\n    if (this._disposed) return;";
      assert.equal(body.split(a).length, 2, "instrumentation anchor A occurs once");
      assert.equal(body.split(b).length, 2, "instrumentation anchor B occurs once");
      body = body.replace(a,
        "  handle(event) {\n    const __r = this.__vHandle(event);\n" +
        "    try { const s = event?.state ?? event?.cursorState ?? event; const p = s?.pos ?? s?.position ?? s;\n" +
        "      (globalThis.__vlog ??= []).push({ t: Math.round(performance.now() * 10) / 10, k: eventType(event) === \"cursor-update\" ? \"U\" : \"M\",\n" +
        "        rid: s?.resourceId ?? s?.resource_id, x: p?.x | 0, y: p?.y | 0, hx: s?.hotX ?? s?.hot_x, hy: s?.hotY ?? s?.hot_y,\n" +
        "        img: this._imageKey ? __vHash(this._imageKey) : null, hot: this._cssHot ? [this._cssHot.x, this._cssHot.y] : null, ok: __r !== false });\n" +
        "    } catch {}\n    return __r;\n  }\n  __vHandle(event) {\n    switch (eventType(event)) {");
      body = body.replace(b,
        "  notePointer(x, y) {\n    (globalThis.__vlog ??= []).push({ t: Math.round(performance.now() * 10) / 10, k: \"S\", x, y });\n    if (this._disposed) return;");
      // A short id per cursor image (FNV-1a of its whole data URL).
      body += "\nfunction __vHash(text) { let h = 2166136261; for (let i = 0; i < text.length; i += 1) { h ^= text.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0).toString(16); }\n";
      result.instrumentedBytes = body.length;
      await route.fulfill({ response, body });
    });
  }
  await page.addInitScript(() => { window.addEventListener("wvm:desktop-ready", () => { window.__ready = performance.now(); }); });
  // --coverage: V8 block coverage of the page's own scripts (no source is modified), to hold a
  // recorded run against the diff.
  if (opt.coverage) await page.coverage.startJSCoverage({ resetOnNavigation: false });
  await page.goto(result.url);
  await page.waitForFunction(() => window.__ready !== undefined && document.getElementById("omarchy-boot-overlay")?.hidden === true,
    null, { timeout: 15 * 60_000, polling: 250 });
  const sh = async (cmd) => (await page.evaluate((c) => window.wvmDemo.exec(c, 120_000, { quiet: true }), cmd))?.stdout ?? "";
  const canvas = page.locator("#ide-display-canvas");
  const box = await canvas.boundingBox();
  const GUEST = { w: 1280, h: 800 };
  // Centre of the guest pixel, so the page's own rounding notes exactly that pixel.
  const toPage = ([x, y]) => [box.x + ((x + 0.5) / GUEST.w) * box.width, box.y + ((y + 0.5) / GUEST.h) * box.height];
  // The image's own session script with the one variable changed, started the way rcS does
  // (verbatim from the worker's script).
  assert.equal((await sh("sed -e 's/ WLR_NO_HARDWARE_CURSORS=1/ WLR_DRM_NO_ATOMIC=1/' /usr/local/bin/replay-desktop-session > /tmp/session && chmod 755 /tmp/session && grep -c WLR_DRM_NO_ATOMIC=1 /tmp/session")).trim(), "1");
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
  await sh("mount -t debugfs none /sys/kernel/debug 2>/dev/null; true");
  result.swayEnv = (await sh("tr '\\0' '\\n' < /proc/$(pidof sway)/environ | grep WLR_ | sort | tr '\\n' ' '")).trim();

  const cssCursor = () => page.evaluate(() => {
    const css = getComputedStyle(document.getElementById("ide-display-canvas")).cursor;
    const m = /^url\("(data:image\/png;base64,[^"]+)"\) (\d+) (\d+)/.exec(css);
    return m ? { imageTail: m[1].slice(-24), hotspot: [Number(m[2]), Number(m[3])] } : { raw: css.slice(0, 80) };
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
  const lastSent = () => page.evaluate(() => {
    const frames = window.__pointer.frames();
    for (let i = frames.length - 1; i >= 0; i -= 1) {
      const c = frames[i]?.coordinates;
      if (c) return [Math.floor((c.x * 1280) / 32768), Math.floor((c.y * 800) / 32768)];
    }
    return null;
  });
  const ease = { linear: (t) => t, minjerk: (t) => t * t * t * (10 - 15 * t + 6 * t * t) };
  let at = null;
  const moves = [];
  const moveTo = async (g) => { const [x, y] = toPage(g); await page.mouse.move(x, y); at = g; moves.push(g); };
  for (const step of plan.steps) {
    if (step.op === "jump") {
      await moveTo(step.to);
    } else if (step.op === "glide") {
      const from = at; const hz = step.hz ?? 100; const n = Math.max(1, Math.round((step.ms * hz) / 1000));
      const f = ease[step.ease ?? "minjerk"]; const start = performance.now();
      for (let i = 1; i <= n; i += 1) {
        const s = f(i / n);
        const g = [Math.round(from[0] + (step.to[0] - from[0]) * s), Math.round(from[1] + (step.to[1] - from[1]) * s)];
        if (g[0] !== at[0] || g[1] !== at[1]) await moveTo(g);
        const due = start + (i * 1000) / hz - performance.now();
        if (due > 0) await new Promise((r) => setTimeout(r, due));
      }
    } else if (step.op === "path") {
      // Explicit guest positions, `everyMs` apart.
      for (const g of step.points) { await moveTo(g); await new Promise((r) => setTimeout(r, step.everyMs ?? 16)); }
    } else if (step.op === "read") {
      await page.waitForTimeout(step.settleMs ?? 1500);
      const css = await cssCursor(); const plane = await cursorPlane(); const sent = await lastSent();
      const state = await page.evaluate(() => { const s = window.__cursor.state(); return { kind: s.kind, inferred: [s.inferredHotX, s.inferredHotY], updates: s.updates, moves: s.moves, styleWrites: s.styleWrites, diagnostics: s.diagnostics }; });
      const entry = { name: step.name, expectHotspot: step.expectHotspot ?? null, sent, css, plane, state };
      if (plane && css.hotspot && sent) {
        entry.tip = [plane.x + css.hotspot[0], plane.y + css.hotspot[1]];
        entry.tipError = [entry.tip[0] - sent[0], entry.tip[1] - sent[1]];
      }
      if (step.expectHotspot && css.hotspot) {
        entry.hotspotError = [css.hotspot[0] - step.expectHotspot[0], css.hotspot[1] - step.expectHotspot[1]];
        entry.wrong = Math.abs(entry.hotspotError[0]) > 1 || Math.abs(entry.hotspotError[1]) > 1;
      }
      result.reads.push(entry);
      if (step.screenshot) await canvas.screenshot({ path: path.join(out, step.screenshot) });
    } else {
      throw new Error(`unknown plan op ${step.op}`);
    }
    if (step.restMs) await page.waitForTimeout(step.restMs);
  }
  result.movesSent = moves.length;
  result.cursorDiagnostics = await page.evaluate(() => window.__cursor.diagnostics());
  if (opt.instrument) {
    const log = await page.evaluate(() => globalThis.__vlog ?? []);
    await writeFile(path.join(out, "events.json"), `${JSON.stringify(log)}\n`);
    result.events = log.length;
  }
  await writeFile(path.join(out, "moves.json"), `${JSON.stringify(moves)}\n`);
  if (opt.coverage) {
    const coverage = (await page.coverage.stopJSCoverage())
      .filter((entry) => /\/src\/sink\/cursor-(hotspot|controller)\.js$|\/main\.js$/.test(entry.url))
      .map((entry) => ({ url: entry.url, functions: entry.functions }));
    await writeFile(path.join(out, "coverage.json"), `${JSON.stringify(coverage)}\n`);
    result.coverageScripts = coverage.map((entry) => entry.url);
  }
  result.errors = errors;
  result.ran = true;
} catch (error) {
  failure = error;
  result.ran = false;
  result.error = String(error?.stack ?? error);
} finally {
  await writeFile(path.join(out, "result.json"), `${JSON.stringify(result, null, 2)}\n`);
  await browser.close();
}
console.log(JSON.stringify({ ran: result.ran, swayEnv: result.swayEnv, error: result.error,
  reads: result.reads.map((r) => ({ name: r.name, sent: r.sent, css: r.css?.hotspot ?? r.css?.raw, img: r.css?.imageTail?.slice(0, 8), expect: r.expectHotspot, plane: r.plane && [r.plane.x, r.plane.y], tipError: r.tipError, wrong: r.wrong })) }, null, 1));
if (failure) process.exit(1);
