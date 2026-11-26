#!/usr/bin/env node
// E5-T36a verifier, round 2. Round 1's continuous-path-browser.mjs adapted (round 1's file is
// left as it was). Boots the committed bundle, restarts the guest session on legacy KMS exactly
// as tools/verify/e5-t36-hardware-cursor-browser.mjs does, then plays a PLAN of pointer movement
// and reports. Differences from round 1's runner:
//   * `reset`  : window.__cursor.resetHotspotInference() (several "first time" approaches a boot);
//   * `click`  : press and release the left button where the pointer is;
//   * `sh`     : a command in the guest's serial root shell (to put load on the guest);
//   * `wait`   : just wait;
//   * a RECORDER in the page (public hooks only: getComputedStyle(canvas).cursor and
//     window.__cursor.state()) samples every ~8 ms and logs every change of the image, the CSS
//     hotspot and the inferred hotspot with page time — so an answer shown and taken back between
//     two reads is seen too (timeline.json);
//   * a read reports `answer` = the controller's inferred hotspot (null = no answer) and
//     `verdict`: "none" | "ok" (plane + hotspot within a pixel of the sent position) | "WRONG".
//   * --instrument (diagnosis only; proof runs are made without it) logs every cursor event the
//     device delivers and every position the page notes, in memory via page.route.
//
//   node continuous-path-r2.mjs --plan PLAN.json --out DIR [--url BASE] [--app PATH] [--instrument]
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
  chrome: { type: "string", default: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" },
} });
assert.ok(opt.out && opt.plan, "usage: continuous-path-r2.mjs --plan PLAN.json --out DIR [--instrument]");
const out = path.resolve(opt.out);
await mkdir(out, { recursive: true });
const plan = JSON.parse(await readFile(opt.plan, "utf8"));
// Known images (data-URL tails, the same in round 1's and the worker's result files) and their truth.
const TRUTH = { "9zFk9QAAAABJRU5ErkJggg==": ["arrow", [1, 1]], "rPsb6QAAAABJRU5ErkJggg==": ["hand", [9, 4]], "d5f44QAAAABJRU5ErkJggg==": ["caret", [4, 8]] };
const { chromium } = await import(pathToFileURL(path.join(repo, "web/node_modules/playwright/index.mjs")));
const browser = await chromium.launch({ executablePath: opt.chrome, headless: true });
const result = { task: "E5-T36a verifier round 2", instrumented: opt.instrument, plan: path.basename(opt.plan),
  url: `${opt.url}${opt.app}?guest=replay-desktop&desktop=1#ide`, browser: browser.version(), reads: [], shell: [], steps: [] };
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
      const b = "  notePointer(x, y, outputWidth = null, outputHeight = null) {\n";
      assert.equal(body.split(a).length, 2, "instrumentation anchor A occurs once");
      assert.equal(body.split(b).length, 2, "instrumentation anchor B occurs once");
      body = body.replace(a,
        "  handle(event) {\n    const __r = this.__vHandle(event);\n" +
        "    try { const s = event?.state ?? event?.cursorState ?? event; const p = s?.pos ?? s?.position ?? s;\n" +
        "      (globalThis.__vlog ??= []).push({ t: Math.round(performance.now() * 10) / 10, k: eventType(event) === \"cursor-update\" ? \"U\" : \"M\",\n" +
        "        rid: s?.resourceId ?? s?.resource_id, x: p?.x | 0, y: p?.y | 0, hx: s?.hotX ?? s?.hot_x, hy: s?.hotY ?? s?.hot_y,\n" +
        "        img: this._imageKey ? this._imageKey.slice(-24) : null, hot: this._cssHot ? [this._cssHot.x, this._cssHot.y] : null, ok: __r !== false });\n" +
        "    } catch {}\n    return __r;\n  }\n  __vHandle(event) {\n    switch (eventType(event)) {");
      body = body.replace(b, `${b}    (globalThis.__vlog ??= []).push({ t: Math.round(performance.now() * 10) / 10, k: "S", x, y, m: this._mode });\n`);
      result.instrumentedBytes = body.length;
      await route.fulfill({ response, body });
    });
  }
  await page.addInitScript(() => { window.addEventListener("wvm:desktop-ready", () => { window.__ready = performance.now(); }); });
  await page.goto(result.url);
  await page.waitForFunction(() => window.__ready !== undefined && document.getElementById("omarchy-boot-overlay")?.hidden === true,
    null, { timeout: 15 * 60_000, polling: 250 });
  const sh = async (cmd) => (await page.evaluate((c) => window.wvmDemo.exec(c, 120_000, { quiet: true }), cmd))?.stdout ?? "";
  const canvas = page.locator("#ide-display-canvas");
  const box = await canvas.boundingBox();
  const GUEST = { w: 1280, h: 800 };
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

  // The recorder: every change of what the page shows, with page time.
  await page.evaluate(() => {
    const canvasEl = document.getElementById("ide-display-canvas");
    const rec = { rows: [], last: "" };
    window.__vrec = rec;
    const lastSent = () => {
      const frames = window.__pointer.frames();
      for (let i = frames.length - 1; i >= 0; i -= 1) { const c = frames[i]?.coordinates; if (c) return [Math.floor((c.x * 1280) / 32768), Math.floor((c.y * 800) / 32768)]; }
      return null;
    };
    rec.timer = setInterval(() => {
      const css = getComputedStyle(canvasEl).cursor;
      const m = /^url\("(data:image\/png;base64,[^"]+)"\) (\d+) (\d+)/.exec(css);
      const s = window.__cursor.state();
      const key = `${m ? m[1].slice(-24) : css.slice(0, 20)}|${m ? `${m[2]},${m[3]}` : ""}|${s.inferredHotX},${s.inferredHotY}`;
      if (key === rec.last) return;
      rec.last = key;
      rec.rows.push({ t: Math.round(performance.now() * 10) / 10, tail: m ? m[1].slice(-24) : null, raw: m ? undefined : css.slice(0, 40),
        css: m ? [Number(m[2]), Number(m[3])] : null, inferred: s.inferredHotX === null ? null : [s.inferredHotX, s.inferredHotY],
        updates: s.updates, moves: s.moves, sent: lastSent() });
    }, 8);
  });
  const cssCursor = () => page.evaluate(() => {
    const css = getComputedStyle(document.getElementById("ide-display-canvas")).cursor;
    const m = /^url\("(data:image\/png;base64,[^"]+)"\) (\d+) (\d+)/.exec(css);
    const s = window.__cursor.state();
    return { t: Math.round(performance.now() * 10) / 10, css: m ? { imageTail: m[1].slice(-24), hotspot: [Number(m[2]), Number(m[3])] } : { raw: css.slice(0, 80) },
      state: { kind: s.kind, inferred: s.inferredHotX === null ? null : [s.inferredHotX, s.inferredHotY], updates: s.updates, moves: s.moves, styleWrites: s.styleWrites, diagnostics: s.diagnostics } };
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
  const pageNow = () => page.evaluate(() => Math.round(performance.now() * 10) / 10);
  const ease = { linear: (t) => t, minjerk: (t) => t * t * t * (10 - 15 * t + 6 * t * t) };
  let at = null;
  const moves = [];
  const moveTo = async (g) => { const [x, y] = toPage(g); await page.mouse.move(x, y); at = g; moves.push(g); };
  for (const step of plan.steps) {
    result.steps.push({ op: step.op, name: step.name ?? step.note, to: step.to, t: await pageNow() });
    if (step.op === "jump") {
      await moveTo(step.to);
    } else if (step.op === "glide") {
      const from = at; const hz = step.hz ?? 60; const n = Math.max(1, Math.round((step.ms * hz) / 1000));
      const f = ease[step.ease ?? "minjerk"]; const start = performance.now();
      for (let i = 1; i <= n; i += 1) {
        const s = f(i / n);
        const g = [Math.round(from[0] + (step.to[0] - from[0]) * s), Math.round(from[1] + (step.to[1] - from[1]) * s)];
        if (g[0] !== at[0] || g[1] !== at[1]) await moveTo(g);
        const due = start + (i * 1000) / hz - performance.now();
        if (due > 0) await new Promise((r) => setTimeout(r, due));
      }
    } else if (step.op === "path") {
      for (const g of step.points) { await moveTo(g); await new Promise((r) => setTimeout(r, step.everyMs ?? 16)); }
    } else if (step.op === "reset") {
      await page.evaluate(() => window.__cursor.resetHotspotInference());
    } else if (step.op === "click") {
      await page.mouse.down(); await page.waitForTimeout(step.holdMs ?? 60); await page.mouse.up();
    } else if (step.op === "wait") {
      await page.waitForTimeout(step.ms);
    } else if (step.op === "sh") {
      result.shell.push({ cmd: step.cmd, stdout: (await sh(step.cmd)).slice(0, 4000) });
    } else if (step.op === "read") {
      await page.waitForTimeout(step.settleMs ?? 1500);
      const shown = await cssCursor();
      const plane = step.noPlane ? null : await cursorPlane();
      const sent = await lastSent();
      const css = shown.css; const known = TRUTH[css.imageTail];
      const entry = { name: step.name, t: shown.t, settleMs: step.settleMs ?? 1500, sent, css, image: known?.[0] ?? "unknown", truth: known?.[1] ?? null,
        plane, state: shown.state, answer: shown.state.inferred };
      if (plane && css.hotspot && sent) {
        entry.tip = [plane.x + css.hotspot[0], plane.y + css.hotspot[1]];
        entry.tipError = [entry.tip[0] - sent[0], entry.tip[1] - sent[1]];
      }
      if (entry.answer === null) entry.verdict = "none";
      else {
        const byTip = entry.tipError ? Math.abs(entry.tipError[0]) <= 1 && Math.abs(entry.tipError[1]) <= 1 : null;
        const byTruth = entry.truth ? Math.abs(entry.answer[0] - entry.truth[0]) <= 1 && Math.abs(entry.answer[1] - entry.truth[1]) <= 1 : null;
        entry.verdict = (byTip ?? byTruth) === false || byTruth === false ? "WRONG" : "ok";
        assert.deepEqual(css.hotspot, entry.answer, "the canvas shows what the controller inferred");
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
  const timeline = await page.evaluate(() => { clearInterval(window.__vrec.timer); return window.__vrec.rows; });
  await writeFile(path.join(out, "timeline.json"), `${JSON.stringify(timeline)}\n`);
  // Every answer the page showed, against the truth of the image it was shown for.
  const shownWrong = [];
  for (let i = 0; i < timeline.length; i += 1) {
    const row = timeline[i]; const known = TRUTH[row.tail];
    if (!row.inferred || !known) continue;
    if (Math.abs(row.inferred[0] - known[1][0]) > 1 || Math.abs(row.inferred[1] - known[1][1]) > 1) {
      shownWrong.push({ t: row.t, image: known[0], shown: row.inferred, forMs: timeline[i + 1] ? Math.round(timeline[i + 1].t - row.t) : null, sent: row.sent });
    }
  }
  result.timeline = { rows: timeline.length, unknownImages: [...new Set(timeline.filter((r) => r.tail && !TRUTH[r.tail]).map((r) => r.tail))],
    answersShown: timeline.filter((r) => r.inferred).length, shownWrong };
  if (opt.instrument) {
    const log = await page.evaluate(() => globalThis.__vlog ?? []);
    await writeFile(path.join(out, "events.json"), `${JSON.stringify(log)}\n`);
    result.events = log.length;
  }
  await writeFile(path.join(out, "moves.json"), `${JSON.stringify(moves)}\n`);
  if (plan.screenshot !== false) await canvas.screenshot({ path: path.join(out, "desktop.png") });
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
console.log(JSON.stringify({ ran: result.ran, swayEnv: result.swayEnv, error: result.error, errors: result.errors, diagnostics: result.cursorDiagnostics,
  timeline: result.timeline, shell: result.shell,
  reads: result.reads.map((r) => `${r.verdict.padEnd(5)} ${r.name}: ${r.image} sent ${r.sent} answer ${JSON.stringify(r.answer)} plane ${r.plane && [r.plane.x, r.plane.y]} tipError ${JSON.stringify(r.tipError ?? null)}`) }, null, 1));
if (failure) process.exit(1);
