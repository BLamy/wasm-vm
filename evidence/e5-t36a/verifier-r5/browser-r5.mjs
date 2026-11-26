#!/usr/bin/env node
// E5-T36a verifier, round 5. Round 4's browser-r4.mjs (left as it was) with, for P12 and P13 of
// predictions.txt:
//   session-stop  : end the guest's session as the proof script does (kill sway, chrome, foot)
//   session-start : start it again on legacy KMS and probe every `everyMs` until
//                   REPLAY_CHROMIUM_READY (label `starting +Ns`)
//   wheel         : one wheel event on the canvas (the page sends it on the MOUSE device: no
//                   tablet position)
//   probes also record the controller's `kind` (hidden / css) and its update and move counts
//   --mutant V1   : serve cursor-controller.js with ONE line changed, in memory (page.route;
//                   nothing is written anywhere): `wasShown = this._descriptor !== null` — the
//                   mutant the worker's tests do not notice. A CONTROL: what the page would show
//                   if a hide, as this device reports one, did not make the next image an appearance.
// Everything below is round 4's.
// E5-T36a verifier, round 4. Round 3's premise-browser-r3.mjs (left as it was) with four more
// plan ops, for the novel attack P9 of predictions.txt:
//   mode   : window.__pointer.setMode(mode, { requestLock: false }) — the page's pointer mode
//   mouse  : move the real mouse to a guest position WITHOUT counting it as an absolute position
//            (in relative mode the page sends it as relative motion)
//   probe  : record, with a label: the kernel's cursor plane, the last absolute position sent,
//            what the page shows and infers, `settling`, the pointer mode, the idle count
//   ui     : record whether the page's own pointer-mode toggle is there for a user
// Everything else is round 3's:
// E5-T36a verifier, round 3. Round 2's continuous-path-r2.mjs adapted (round 2's file is left as
// it was). Boots the committed bundle, restarts the guest session on legacy KMS exactly as
// tools/verify/e5-t36-hardware-cursor-browser.mjs does, then plays a PLAN of pointer movement.
//
// New in round 3:
//   * --instrument logs, in memory (page.route on the sink file; nothing is written to the tree):
//       S  every position the page notes            U / M  every cursor update / move delivered
//       Q  every question "has the guest caught up?" (who asked: rest or restart, sends, plane)
//       N  every reading of the guest's idle count   C  every conclusion (true / false / null)
//       H  every change of the shown hotspot
//     so that analyze-premise.mjs can check, for each conclusion "caught up", whether the plane
//     really stood for the last position sent — and whether a move for an earlier position came
//     after it.
//   * `idle`      : wait for N consecutive idle seconds (the worker's proof waits for 20);
//   * `settle`    : wait (bounded) for hotspotSettling to end after a reset;
//   * `stats`     : record window.__schedulerStats() (idleSleeps, idleYield) with a label;
//   * `evenrun`   : from where the pointer is, N steps of a fixed step every everyMs.
//   * reads record `settling`.
//
//   node premise-browser-r3.mjs --plan PLAN.json --out DIR [--instrument] [--chrome WRAPPER] [--query '&pace=0']
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const { values: opt } = parseArgs({ options: {
  url: { type: "string", default: "http://127.0.0.1:8125" }, app: { type: "string", default: "/app.html" },
  out: { type: "string" }, plan: { type: "string" }, instrument: { type: "boolean", default: false }, mutant: { type: "string", default: "" },
  query: { type: "string", default: "" },
  chrome: { type: "string", default: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" },
} });
assert.ok(opt.out && opt.plan, "usage: browser-r4.mjs --plan PLAN.json --out DIR [--instrument]");
const out = path.resolve(opt.out);
await mkdir(out, { recursive: true });
const plan = JSON.parse(await readFile(opt.plan, "utf8"));
// Known images (data-URL tails, the same in every earlier result file) and their truth.
const TRUTH = { "9zFk9QAAAABJRU5ErkJggg==": ["arrow", [1, 1]], "rPsb6QAAAABJRU5ErkJggg==": ["hand", [9, 4]], "d5f44QAAAABJRU5ErkJggg==": ["caret", [4, 8]] };
const { chromium } = await import(pathToFileURL(path.join(repo, "web/node_modules/playwright/index.mjs")));
const browser = await chromium.launch({ executablePath: opt.chrome, headless: true });
const result = { task: "E5-T36a verifier round 5", mutant: opt.mutant || null, probes: [], ui: null, instrumented: opt.instrument, plan: path.basename(opt.plan), chrome: path.basename(opt.chrome),
  url: `${opt.url}${opt.app}?guest=replay-desktop&desktop=1${opt.query}#ide`, browser: browser.version(), reads: [], shell: [], steps: [], stats: [] };
let failure = null;
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, serviceWorkers: "block" });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => { if (m.type() === "error" && !/favicon/.test(m.location().url ?? "")) errors.push(m.text()); });
  assert.ok(opt.instrument, "round 5 runs are instrumented");
  if (opt.instrument) {
    await page.route("**/src/sink/cursor-controller.js", async (route) => {
      const response = await route.fetch();
      let body = await response.text();
      if (opt.mutant) {
        assert.equal(opt.mutant, "V1");
        const from = 'const wasShown = this._descriptor !== null && this._descriptor.kind !== "hidden";';
        assert.equal(body.split(from).length, 2, "the mutant's line occurs once");
        body = body.replace(from, "const wasShown = this._descriptor !== null;");
        result.mutantApplied = true;
      }
      const once = (anchor, label) => assert.equal(body.split(anchor).length, 2, `instrumentation anchor ${label} occurs once`);
      const T = "Math.round(performance.now() * 10) / 10";
      const LOG = "(globalThis.__vlog ??= [])";
      const a = "  handle(event) {\n    switch (eventType(event)) {";
      const b = "  notePointer(x, y, outputWidth = null, outputHeight = null) {\n";
      const c = "  async _guestCaughtUp(epoch) {\n";
      const d = "        const value = await this._guestIdleCount();\n";
      const e = "    this._cssHot = hot;\n    this._applySafely(\"cursor-hotspot-dom-error\");\n";
      once(a, "A"); once(b, "B"); once(c, "C"); once(d, "D"); once(e, "E");
      body = body.replace(a,
        "  handle(event) {\n    const __r = this.__vHandle(event);\n" +
        "    try { const s = event?.state ?? event?.cursorState ?? event; const p = s?.pos ?? s?.position ?? s;\n" +
        `      ${LOG}.push({ t: ${T}, k: eventType(event) === "cursor-update" ? "U" : "M",\n` +
        "        rid: s?.resourceId ?? s?.resource_id, x: p?.x | 0, y: p?.y | 0,\n" +
        "        img: this._imageKey ? this._imageKey.slice(-24) : null, hot: this._cssHot ? [this._cssHot.x, this._cssHot.y] : null, st: this._hotspotSettling, ok: __r !== false });\n" +
        "    } catch {}\n    return __r;\n  }\n  __vHandle(event) {\n    switch (eventType(event)) {");
      body = body.replace(b, `${b}    ${LOG}.push({ t: ${T}, k: "S", x, y, m: this._mode, w: outputWidth, h: outputHeight });\n`);
      body = body.replace(c,
        "  async _guestCaughtUp(epoch) {\n" +
        "    const __q = (globalThis.__vq = (globalThis.__vq ?? 0) + 1);\n" +
        `    ${LOG}.push({ t: ${T}, k: "Q", q: __q, why: this._hotspotSettling ? "restart" : "rest", sends: this._hotspots.sends, img: this._imageKey ? this._imageKey.slice(-24) : null, x: (this._state?.x ?? 0) | 0, y: (this._state?.y ?? 0) | 0 });\n` +
        "    const __r = await this.__vGuestCaughtUp(epoch, __q);\n" +
        `    ${LOG}.push({ t: ${T}, k: "C", q: __q, r: __r, sends: this._hotspots.sends, live: epoch === this._hotspotEpoch, img: this._imageKey ? this._imageKey.slice(-24) : null, x: (this._state?.x ?? 0) | 0, y: (this._state?.y ?? 0) | 0, hot: this._cssHot ? [this._cssHot.x, this._cssHot.y] : null });\n` +
        "    return __r;\n  }\n\n  async __vGuestCaughtUp(epoch, __q) {\n");
      body = body.replace(d, `${d}        ${LOG}.push({ t: ${T}, k: "N", q: __q, v: value });\n`);
      body = body.replace(e, `${e}    ${LOG}.push({ t: ${T}, k: "H", hot: hot ? [hot.x, hot.y] : null, img: this._imageKey ? this._imageKey.slice(-24) : null });\n`);
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
        settling: s.hotspotSettling, updates: s.updates, moves: s.moves, sent: lastSent() });
    }, 8);
  });
  const cssCursor = () => page.evaluate(() => {
    const css = getComputedStyle(document.getElementById("ide-display-canvas")).cursor;
    const m = /^url\("(data:image\/png;base64,[^"]+)"\) (\d+) (\d+)/.exec(css);
    const s = window.__cursor.state();
    return { t: Math.round(performance.now() * 10) / 10, css: m ? { imageTail: m[1].slice(-24), hotspot: [Number(m[2]), Number(m[3])] } : { raw: css.slice(0, 80) },
      state: { kind: s.kind, inferred: s.inferredHotX === null ? null : [s.inferredHotX, s.inferredHotY], settling: s.hotspotSettling, updates: s.updates, moves: s.moves, styleWrites: s.styleWrites, diagnostics: s.diagnostics } };
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
  const stats = () => page.evaluate(() => window.__schedulerStats());
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
    } else if (step.op === "evenrun") {
      const start = performance.now();
      for (let i = 1; i <= step.n; i += 1) {
        await moveTo([at[0] + step.step[0], at[1] + step.step[1]]);
        const due = start + i * (step.everyMs ?? 16) - performance.now();
        if (due > 0) await new Promise((r) => setTimeout(r, due));
      }
    } else if (step.op === "path") {
      for (const g of step.points) { await moveTo(g); await new Promise((r) => setTimeout(r, step.everyMs ?? 16)); }
    } else if (step.op === "mode") {
      await page.evaluate((mode) => { window.__pointer.setMode(mode, { requestLock: false }); }, step.mode);
    } else if (step.op === "mouse") {
      const [x, y] = toPage(step.to); await page.mouse.move(x, y);
    } else if (step.op === "probe") {
      const shown = await cssCursor(); const plane = await cursorPlane(); const sent = await lastSent();
      const extra = await page.evaluate(() => { const f = window.__pointer.frames(); return { mode: window.__pointer.mode(), frames: f.length, last: f.slice(-3).map((x) => ({ device: x.device, mode: x.mode, events: x.events.map((e) => [e.eventType, e.code, e.value]) })) }; });
      const s = await stats();
      result.probes.push({ label: step.label, trial: step.trial, t: shown.t, plane, sent, css: shown.css, kind: shown.state.kind, inferred: shown.state.inferred, settling: shown.state.settling, moves: shown.state.moves, updates: shown.state.updates, pointer: extra, idleSleeps: s?.idleSleeps });
    } else if (step.op === "session-stop") {
      // Verbatim from the proof script's restart (first half).
      await sh("kill $(pidof sway); sleep 2; pkill -9 chrome; pkill foot; rm -rf /run/user/1000/replay-chromium /run/user/1000/sway-ipc.* /run/user/1000/wayland-*; : > /run/replay-desktop/events");
      result.steps.at(-1).swayAfterStop = (await sh("pidof sway; echo rc=$?")).trim();
    } else if (step.op === "session-start") {
      await sh("(su -s /bin/sh desktop -c /tmp/session </dev/null >/run/session3.log 2>&1 &); sleep 1");
      const began = Date.now();
      for (;;) {
        const ready = /REPLAY_CHROMIUM_READY/.test(await sh("cat /run/replay-desktop/events"));
        const shown = await cssCursor(); const plane = await cursorPlane(); const sent = await lastSent(); const s = await stats();
        result.probes.push({ label: `starting +${((Date.now() - began) / 1000).toFixed(1)} s${ready ? " (READY)" : ""}`, trial: step.trial, t: shown.t, plane, sent, css: shown.css, kind: shown.state.kind,
          inferred: shown.state.inferred, settling: shown.state.settling, moves: shown.state.moves, updates: shown.state.updates, idleSleeps: s?.idleSleeps });
        if (ready) break;
        assert.ok(Date.now() - began < 15 * 60_000, "the session started again");
        await page.waitForTimeout(step.everyMs ?? 1500);
      }
      result.steps.at(-1).restartSeconds = (Date.now() - began) / 1000;
      result.steps.at(-1).swayEnv = (await sh("tr '\\0' '\\n' < /proc/$(pidof sway)/environ | grep WLR_ | sort | tr '\\n' ' '")).trim();
    } else if (step.op === "wheel") {
      await page.mouse.wheel(step.dx ?? 0, step.dy ?? 0);
    } else if (step.op === "ui") {
      result.ui = await page.evaluate(() => { const b = document.getElementById("ide-pointer-toggle"); if (!b) return { present: false };
        const r = b.getBoundingClientRect(); const cs = getComputedStyle(b); let hiddenBy = null;
        for (let e = b; e; e = e.parentElement) { const c = getComputedStyle(e); if (c.display === "none" || c.visibility === "hidden" || e.hidden) { hiddenBy = `${e.tagName.toLowerCase()}#${e.id}.${e.className}`; break; } }
        return { present: true, disabled: b.disabled, text: b.textContent, rect: [r.x, r.y, r.width, r.height], display: cs.display, visibility: cs.visibility, hiddenBy,
          desktopMode: document.documentElement.dataset.pointerMode, body: document.body.className }; });
    } else if (step.op === "reset") {
      await page.evaluate(() => window.__cursor.resetHotspotInference());
    } else if (step.op === "settle") {
      const began = Date.now();
      const ended = await page.waitForFunction(() => window.__cursor.state().hotspotSettling === false, null, { timeout: step.ms ?? 30_000, polling: 25 }).then(() => true, () => false);
      result.steps.at(-1).settled = ended; result.steps.at(-1).settleMs = Date.now() - began;
    } else if (step.op === "idle") {
      const began = Date.now(); let streak = 0;
      while (streak < step.seconds && Date.now() - began < (step.maxMs ?? 5 * 60_000)) {
        const before = (await stats())?.idleSleeps ?? 0;
        await page.waitForTimeout(1000);
        streak = ((await stats())?.idleSleeps ?? 0) - before >= 15 ? streak + 1 : 0;
      }
      result.steps.at(-1).idleAfterSeconds = (Date.now() - began) / 1000; result.steps.at(-1).reached = streak >= step.seconds;
    } else if (step.op === "stats") {
      const s = await stats();
      result.stats.push({ label: step.label, t: await pageNow(), idleSleeps: s?.idleSleeps, idleYield: s?.idleYield, idleWakes: s?.idleWakes, idleSleepMs: s?.idleSleepMs });
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
      const entry = { name: step.name, phase: step.phase, t: shown.t, settleMs: step.settleMs ?? 1500, sent, css, image: known?.[0] ?? "unknown", truth: known?.[1] ?? null,
        plane, state: shown.state, answer: shown.state.inferred, settling: shown.state.settling };
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
    answersShown: timeline.filter((r) => r.inferred).length, answersForUnknownImages: timeline.filter((r) => r.inferred && !TRUTH[r.tail]).length, shownWrong };
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
const tally = {};
for (const r of result.reads) { const k = `${r.phase ?? "-"}`; tally[k] ??= { none: 0, ok: 0, WRONG: 0 }; tally[k][r.verdict] += 1; }
console.log(JSON.stringify({ ran: result.ran, swayEnv: result.swayEnv, restartSeconds: result.sessionRestartSeconds, error: result.error, errors: result.errors, diagnostics: result.cursorDiagnostics,
  timeline: result.timeline, stats: result.stats, shell: result.shell.map((s) => ({ cmd: s.cmd.slice(0, 80), stdout: s.stdout.slice(0, 200) })), readsByPhase: tally,
  wrongReads: result.reads.filter((r) => r.verdict === "WRONG").map((r) => `${r.name}: ${r.image} sent ${r.sent} answer ${JSON.stringify(r.answer)}`) }, null, 1));
if (failure) process.exit(1);
