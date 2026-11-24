#!/usr/bin/env node
// E5-T34c acceptance: the shared Replay Chrome 108 + Node 26 desktop (the E5-T34b image) boots on
// the BUILT page from ONE whole-image download (E5-T34a prefill), with zero chunk or Range
// requests during boot. Chrome must report its smoke.html PASS, the desktop must be visible, and a
// command typed with real DOM keyboard events on the display canvas (after a real DOM click that
// focuses the Node terminal) must print Node's version. Zero console errors (favicon 404 allowed).
//
//   bash tools/serve-dev.sh 8123 &                     # local: serves web/ (built) + /releases
//   node tools/verify/e5-t34c-replay-desktop.mjs [boot] [suite]          (default: boot suite)
//   E5_T34C_URL=https://wasm-vm.pages.dev E5_T34C_APP=/app E5_T34C_OUT=evidence/e5-t34c/live \
//     node tools/verify/e5-t34c-replay-desktop.mjs boot suite
//
// The typed command carries a fresh random nonce and appends its output to the desktop's event
// file, which the guest's root monitor relays to the serial console. The script itself never
// writes to the serial console (no sendInput/typeBytes), so the nonce can only reach the console
// through the DOM keyboard → virtio keyboard → sway → foot → shell path.
// Browser: system Chrome (E5_T34C_CHROME). Evidence → evidence/e5-t34c/local (E5_T34C_OUT).
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { randomBytes, createHash } from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const base = (process.env.E5_T34C_URL || "http://127.0.0.1:8123").replace(/\/+$/u, "");
const app = process.env.E5_T34C_APP ?? "/";
const out = path.resolve(process.env.E5_T34C_OUT || path.join(repo, "evidence/e5-t34c/local"));
const READY_TIMEOUT_MS = Number(process.env.E5_T34C_READY_TIMEOUT_MS ?? 4 * 60 * 60 * 1000);
const NODE_TIMEOUT_MS = Number(process.env.E5_T34C_NODE_TIMEOUT_MS ?? 60 * 60 * 1000);
const modes = process.argv.slice(2).length ? process.argv.slice(2) : ["boot", "suite"];
const bootManifest = JSON.parse(fs.readFileSync(path.join(repo, "web/artifacts-replay-desktop.json"), "utf8"));
const whole = bootManifest.artifacts.wholeImage;
const wholeName = path.posix.basename(whole.url);
fs.mkdirSync(out, { recursive: true });
const save = (name, data) => fs.writeFileSync(path.join(out, name), JSON.stringify(data, null, 2) + "\n");
const log = (...a) => console.log(`[e5-t34c ${new Date().toISOString()}]`, ...a);

const { chromium } = await import(pathToFileURL(path.join(repo, "web/node_modules/playwright/index.mjs")));
const browser = await chromium.launch({
  executablePath: process.env.E5_T34C_CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: true,
});

function watch(page) {
  const t0 = Date.now();
  const requests = [];
  const consoleErrors = [];
  const consoleLog = [];
  page.on("request", (r) => {
    const h = r.headers();
    requests.push({ t: Date.now() - t0, method: r.method(), url: r.url(), range: h.range ?? null });
  });
  page.on("requestfinished", async (r) => {
    const entry = requests.find((e) => e.url === r.url() && e.finished === undefined);
    if (!entry) return;
    entry.finished = Date.now() - t0;
    try { const sizes = await r.sizes(); entry.responseBodySize = sizes.responseBodySize; } catch {}
    try { entry.status = (await r.response())?.status() ?? null; } catch {}
  });
  page.on("console", (m) => {
    const e = { type: m.type(), text: m.text().slice(0, 2000), url: m.location().url ?? "" };
    consoleLog.push(e);
    if (e.type === "error" && !e.text.includes("favicon.ico") && !e.url.endsWith("/favicon.ico")) consoleErrors.push(e.text);
  });
  page.on("pageerror", (e) => consoleErrors.push(String(e)));
  return { t0, requests, consoleErrors, consoleLog };
}
const isWhole = (r) => new URL(r.url).pathname.endsWith(`/${wholeName}`);
const isChunkOrRange = (r) => r.range !== null || /\/image\.blob$|\/chunks\//u.test(new URL(r.url).pathname);
const serial = (page) => page.evaluate(() => window.__e5t34cSerial ?? "");
const waitSerial = (page, re, timeout) => page.waitForFunction(
  ([src, flags]) => new RegExp(src, flags).test(window.__e5t34cSerial ?? ""), [re.source, re.flags],
  { timeout, polling: 2000 });

// US-layout characters → W3C key codes, with Shift held explicitly (the guest's evdev bridge maps
// codes, not characters).
const SHIFTED = { '"': "Quote", "(": "Digit9", ")": "Digit0", "_": "Minus", "|": "Backslash", ":": "Semicolon" };
const PLAIN = { "'": "Quote", "-": "Minus", ".": "Period", "/": "Slash", " ": "Space", ",": "Comma", "=": "Equal", ";": "Semicolon" };
async function typeText(page, text) {
  for (const ch of text) {
    let code, shift = false;
    if (/[a-z]/u.test(ch)) code = `Key${ch.toUpperCase()}`;
    else if (/[A-Z]/u.test(ch)) { code = `Key${ch}`; shift = true; }
    else if (/[0-9]/u.test(ch)) code = `Digit${ch}`;
    else if (PLAIN[ch]) code = PLAIN[ch];
    else if (SHIFTED[ch]) { code = SHIFTED[ch]; shift = true; }
    else throw new Error(`no key mapping for ${JSON.stringify(ch)}`);
    if (shift) await page.keyboard.down("Shift");
    await page.keyboard.press(code, { delay: 40 });
    if (shift) await page.keyboard.up("Shift");
    await page.waitForTimeout(120);
  }
}

async function bootMode() {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, serviceWorkers: "block" });
  const w = watch(page);
  // Subscribe to the real guest console stream before the 400 ms auto-boot starts.
  await page.addInitScript(() => {
    window.__e5t34cSerial = "";
    const attach = () => {
      if (!window.wvmDemo?.onConsole) return setTimeout(attach, 20);
      const dec = new TextDecoder();
      window.wvmDemo.onConsole((u8) => { window.__e5t34cSerial += dec.decode(u8, { stream: true }); });
    };
    attach();
    window.addEventListener("wvm:desktop-ready", () => { window.__e5t34cDesktopReadyAt = performance.now(); });
  });
  // The production URL (no ?testHooks: that also shortens the worker heartbeat to 300 ms).
  const url = `${base}${app}?guest=replay-desktop&desktop=1#ide`;
  log("open", url);
  await page.goto(url);
  const times = {};
  const wholeReq = await page.waitForEvent("requestfinished", { predicate: (r) => isWhole({ url: r.url() }), timeout: 30 * 60_000 });
  times.wholeImageFinishedMs = Date.now() - w.t0;
  const wholeSizes = await wholeReq.sizes();
  const wholeHeaders = await (await wholeReq.response()).allHeaders();
  log("whole image downloaded", times.wholeImageFinishedMs, "ms", wholeSizes.responseBodySize, "B");
  let lastLen = 0;
  const progress = setInterval(async () => {
    try {
      const s = await serial(page);
      if (s.length !== lastLen) {
        const lines = s.split("\n").filter((l) => /REPLAY_|Kernel panic|Run \/sbin\/init/u.test(l)).slice(-3);
        log(`serial ${s.length} B`, lines.join(" | ").slice(0, 300));
        lastLen = s.length;
      }
    } catch {}
  }, 60_000);
  try {
    // Fail fast on a boot error instead of waiting out the ready timeout.
    const BOOT_ERROR = () => {
      const status = document.getElementById("omarchy-boot-status");
      return status?.dataset.state === "error" ? status.textContent : null;
    };
    await page.waitForFunction(`/REPLAY_DESKTOP_READY uptime=/u.test(window.__e5t34cSerial ?? "") || Boolean((${BOOT_ERROR})())`,
      null, { timeout: READY_TIMEOUT_MS, polling: 2000 });
    const failed = await page.evaluate(`(${BOOT_ERROR})()`);
    assert.equal(failed, null, `boot failed: ${failed}`);
  } finally {
    clearInterval(progress);
  }
  times.guestReadyMarkerMs = Date.now() - w.t0;
  await page.waitForFunction(() => window.__e5t34cDesktopReadyAt !== undefined
    && document.getElementById("omarchy-boot-overlay")?.hidden === true, null, { timeout: 300_000 });
  times.desktopVisibleMs = Date.now() - w.t0;
  log("desktop visible", times.desktopVisibleMs, "ms");
  const bootRequests = w.requests.slice();
  const s1 = await serial(page);
  assert.doesNotMatch(s1, /Kernel panic|REPLAY_CHROMIUM_STARTUP_FAILED/u);
  const targets = s1.split("\n").find((l) => l.startsWith("REPLAY_CHROMIUM_TARGETS")) ?? "";
  const pageResult = s1.split("\n").find((l) => l.startsWith("REPLAY_CHROMIUM_PAGE")) ?? "";
  const sandbox = s1.split("\n").find((l) => l.startsWith("REPLAY_CHROMIUM_READY")) ?? "";
  assert.match(targets, /Replay RISC-V PASS #1/u, "Chrome's smoke.html set its PASS title");
  // dataset.result is "pass" only when every smoke check passed; the JSON is escaped inside the
  // DevTools reply, so match its escaped form.
  assert.match(pageResult, /"value":"pass \{/u, "Chrome's smoke.html dataset.result is pass");
  assert.match(pageResult, /\\"pass\\": true/u, "the smoke result object reports pass:true");
  assert.match(pageResult, /\\"javascript\\": 42,.*\\"webassembly\\": 42,.*\\"browser\\": \\"Chrome\/108\./u);
  await page.screenshot({ path: path.join(out, "desktop.png") });
  const pixels = await page.evaluate(() => {
    const st = window.__presentation.state();
    return { backend: st.backend, width: st.width, height: st.height, successfulPresents: st.successfulPresents };
  });

  // Focus the Node terminal (right of the 62%-wide Chrome tile) with a real DOM click, then type.
  const box = await page.locator("#ide-display-canvas").boundingBox();
  assert.ok(box && box.width > 100 && box.height > 100, "display canvas is laid out");
  await page.mouse.click(box.x + box.width * 0.82, box.y + box.height * 0.5);
  await page.waitForTimeout(3000);
  const nonce = randomBytes(4).toString("hex").toUpperCase();
  const command = `node -e "console.log('E5T34C_${nonce}', process.version)" | tee -a /run/replay-desktop/events`;
  const framesBefore = (await page.evaluate(() => window.__keyboardCapture?.frames?.().length ?? 0));
  const typeStartMs = Date.now() - w.t0;
  await typeText(page, command);
  await page.keyboard.press("Enter", { delay: 40 });
  log("typed", command);
  const keyboardFrames = await page.evaluate(() => window.__keyboardCapture?.frames?.() ?? []);
  const nodeRe = new RegExp(`E5T34C_${nonce} v26\\.13\\.1`, "u");
  await waitSerial(page, nodeRe, NODE_TIMEOUT_MS);
  times.nodeAnswerAfterTypingMs = Date.now() - w.t0 - typeStartMs;
  log("node answered", times.nodeAnswerAfterTypingMs, "ms after typing began");
  await page.waitForTimeout(5000); // let foot repaint its output line before the screenshot
  await page.screenshot({ path: path.join(out, "desktop-node.png") });
  const s2 = await serial(page);
  fs.writeFileSync(path.join(out, "serial.log"), s2);
  const stats = await page.evaluate(() => window.__chunkedStats());
  const kbd = await page.evaluate(() => window.__keyboardCapture?.stats?.() ?? null);
  const allRequests = w.requests.slice();
  const counts = {
    total: allRequests.length,
    wholeImage: allRequests.filter(isWhole).length,
    chunkOrRange: allRequests.filter(isChunkOrRange).length,
    bootTotal: bootRequests.length,
    bootWholeImage: bootRequests.filter(isWhole).length,
    bootChunkOrRange: bootRequests.filter(isChunkOrRange).length,
  };
  const summary = {
    task: "E5-T34c", url, browser: browser.version(), nonce, command, times,
    wholeImage: { url: wholeReq.url(), declared: whole, responseBodySize: wholeSizes.responseBodySize,
      contentEncoding: wholeHeaders["content-encoding"] ?? null, contentType: wholeHeaders["content-type"] ?? null },
    counts, fetchStats: stats, display: pixels,
    chrome: { targets: targets.slice(0, 400), page: pageResult, ready: sandbox },
    node: s2.split("\n").filter((l) => nodeRe.test(l)),
    keyboard: { framesBeforeTyping: framesBefore, framesAfterTyping: keyboardFrames.length,
      typedChars: [...command].length, stats: kbd, sampleFrames: keyboardFrames.slice(-6) },
    consoleErrors: w.consoleErrors,
  };
  save("boot-summary.json", summary);
  save("requests.json", allRequests);
  save("console.json", w.consoleLog);
  assert.equal(counts.wholeImage, 1, "exactly one whole-image request");
  assert.equal(counts.chunkOrRange, 0, "no chunk or Range request");
  assert.equal(stats.localImage, true);
  assert.equal(stats.fetches, 0, "no network chunk fetch");
  assert.equal(stats.error, null);
  assert.ok(stats.localHits > 0, "chunks served from the whole image");
  assert.ok(keyboardFrames.length > framesBefore, "the typed command went through the DOM keyboard bridge");
  assert.deepEqual(w.consoleErrors, [], `console errors: ${w.consoleErrors.join("; ")}`);
  log("boot PASS", JSON.stringify({ times, counts }));
  await page.close();
}

async function suiteMode() {
  const { RISCV_TESTS } = await import(pathToFileURL(path.join(repo, "web/riscv-tests.js")));
  const total = String(RISCV_TESTS.length);
  const page = await browser.newPage({ viewport: { width: 1440, height: 1050 }, serviceWorkers: "block" });
  const w = watch(page);
  await page.goto(`${base}${app}?noAutoBoot=1`);
  await page.waitForFunction(() => document.getElementById("suite-run")?.disabled === false, null, { timeout: 120_000 });
  await page.locator("#suite-run").evaluate((el) => el.click());
  await page.waitForFunction((t) => document.querySelector("#metric-done")?.textContent.trim() === t
    && document.getElementById("suite-run")?.disabled === false, total, { timeout: 300_000 });
  const metrics = await page.evaluate(() => Object.fromEntries(["metric-pass", "metric-fail", "metric-done"]
    .map((id) => [id, document.getElementById(id)?.textContent.trim()])));
  const launcher = await page.evaluate(() => {
    const meta = document.querySelector('#os-launcher [data-os-meta="replay-desktop"]');
    const button = document.querySelector('#os-launcher [data-os="replay-desktop"]');
    const row = [...document.querySelectorAll(".cap")].find((el) => /Shared Replay Chrome/u.test(el.textContent));
    return { meta: meta?.textContent ?? null, state: meta?.dataset.state ?? null, disabled: button?.disabled ?? null,
      roadmapRow: row?.innerText ?? null, roadmapPip: row?.querySelector(".cap-pip")?.getAttribute("class") ?? null };
  });
  const shot = await page.screenshot({ path: path.join(out, "demo-suite.png") });
  save("demo-suite.json", { url: page.url(), browser: browser.version(), metrics, launcher, consoleErrors: w.consoleErrors,
    screenshotSha256: createHash("sha256").update(shot).digest("hex") });
  assert.deepEqual(metrics, { "metric-pass": total, "metric-fail": "0", "metric-done": total });
  assert.equal(launcher.state, "ready", "the launcher offers the Replay desktop");
  assert.deepEqual(w.consoleErrors, [], `console errors: ${w.consoleErrors.join("; ")}`);
  log("suite PASS", JSON.stringify({ metrics, launcher: launcher.meta }));
  await page.close();
}

try {
  for (const m of modes) {
    if (m === "boot") await bootMode();
    else if (m === "suite") await suiteMode();
    else throw new Error(`unknown mode ${m}`);
  }
} finally {
  await browser.close();
}
