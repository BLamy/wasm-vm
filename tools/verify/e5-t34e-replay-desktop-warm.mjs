#!/usr/bin/env node
// E5-T34e acceptance: the Replay desktop resumes from its warm RAM/device snapshot as soon as the
// downloads finish. On the BUILT page (or the live site) this proves, per mode:
//
//   warm   (default URL)   the whole image and the snapshot are the only disk-related requests
//                          (zero chunk/Range requests, zero network chunk fetches); the guest
//                          state goes `restored` (never `booting`, never the cold-boot monitor
//                          start line); the desktop is visible within E5_T34E_BUDGET_MS of the
//                          last download finishing; the session is live: a real DOM click on
//                          Chrome's "Run again" increments `runs` (read back from the sway window
//                          title over the serial root shell), and a DOM-typed Node command prints
//                          v26.13.1 with a fresh nonce; zero console errors.
//   cold   (?noSnapshot)   no snapshot request, a real cold boot (`booting`, the guest's own
//                          REPLAY_DESKTOP_READY), the same Run again + Node results.
//   attack-identity        the manifest's snapshot identity names another kernel: the loader
//                          must refuse it before downloading it and cold-boot (checked until the
//                          cold boot's first guest line; the boot is not run to the desktop).
//   attack-core            the snapshot bytes carry another wasm build's core id (re-gzipped, the
//                          manifest digests updated so only the wasm coherence guard can refuse
//                          it): the guard must answer foreign_build and the page cold-boot.
//
//   bash tools/serve-dev.sh 8123 &
//   node tools/verify/e5-t34e-replay-desktop-warm.mjs warm cold attack-identity attack-core
//   E5_T34E_URL=https://wasm-vm.pages.dev E5_T34E_APP=/app E5_T34E_OUT=evidence/e5-t34e/live \
//     node tools/verify/e5-t34e-replay-desktop-warm.mjs warm cold
//
// The script never types into the guest's desktop through the serial console: the Node nonce can
// reach the console only through DOM keyboard → virtio keyboard → sway → foot → shell, and the
// click only through DOM pointer → virtio tablet → sway → Chrome. The serial root shell is used
// read-only, to read Chrome's window title.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import zlib from "node:zlib";
import { randomBytes, createHash } from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const base = (process.env.E5_T34E_URL || "http://127.0.0.1:8123").replace(/\/+$/u, "");
const app = process.env.E5_T34E_APP ?? "/";
const out = path.resolve(process.env.E5_T34E_OUT || path.join(repo, "evidence/e5-t34e/local"));
const BUDGET_MS = Number(process.env.E5_T34E_BUDGET_MS ?? 15_000);
const READY_TIMEOUT_MS = Number(process.env.E5_T34E_READY_TIMEOUT_MS ?? 4 * 60 * 60 * 1000);
const NODE_TIMEOUT_MS = Number(process.env.E5_T34E_NODE_TIMEOUT_MS ?? 60 * 60 * 1000);
const modes = process.argv.slice(2).length ? process.argv.slice(2) : ["warm", "cold"];
const bootManifest = JSON.parse(fs.readFileSync(path.join(repo, "web/artifacts-replay-desktop.json"), "utf8"));
const whole = bootManifest.artifacts.wholeImage;
const snap = bootManifest.artifacts.bootSnapshot;
assert.ok(snap, "web/artifacts-replay-desktop.json declares the warm bootSnapshot");
const wholeName = path.posix.basename(whole.url);
const snapName = path.posix.basename(snap.url);
fs.mkdirSync(out, { recursive: true });
const save = (name, data) => fs.writeFileSync(path.join(out, name), JSON.stringify(data, null, 2) + "\n");
const log = (...a) => console.log(`[e5-t34e ${new Date().toISOString()}]`, ...a);

const { chromium } = await import(pathToFileURL(path.join(repo, "web/node_modules/playwright/index.mjs")));
const browser = await chromium.launch({
  executablePath: process.env.E5_T34E_CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: true,
});

function watch(page) {
  const t0 = Date.now();
  const requests = [];
  const consoleErrors = [];
  const consoleLog = [];
  page.on("request", (r) => {
    requests.push({ t: Date.now() - t0, method: r.method(), url: r.url(), range: r.headers().range ?? null });
  });
  page.on("requestfinished", async (r) => {
    const entry = requests.find((e) => e.url === r.url() && e.finished === undefined);
    if (!entry) return;
    entry.finished = Date.now() - t0;
    try { entry.responseBodySize = (await r.sizes()).responseBodySize; } catch {}
    try { entry.status = (await r.response())?.status() ?? null; } catch {}
  });
  page.on("console", (m) => {
    const e = { t: Date.now() - t0, type: m.type(), text: m.text().slice(0, 2000), url: m.location().url ?? "" };
    consoleLog.push(e);
    if (e.type === "error" && !e.text.includes("favicon.ico") && !e.url.endsWith("/favicon.ico")) consoleErrors.push(e.text);
  });
  page.on("pageerror", (e) => consoleErrors.push(String(e)));
  return { t0, requests, consoleErrors, consoleLog };
}
const named = (name) => (r) => new URL(r.url).pathname.endsWith(`/${name}`);
const isWhole = named(wholeName);
const isSnap = named(snapName);
const isChunkOrRange = (r) => r.range !== null || /\/image\.blob$|\/chunks\//u.test(new URL(r.url).pathname);
// Disk DATA: anything under the image/snapshot release trees except the 125 KiB chunk-manifest
// metadata (the chunk digest list the loader hands wasm), which is counted separately.
const isChunkManifest = (r) => new URL(r.url).pathname.endsWith(".chunks.json");
const isDiskRelated = (r) => !isChunkManifest(r) && (isWhole(r) || isSnap(r) || isChunkOrRange(r)
  || /\/(rootfs|boot-snapshot|chunked-[a-z-]+)\//u.test(new URL(r.url).pathname));
const serial = (page) => page.evaluate(() => window.__e5t34eSerial ?? "");
const waitSerial = (page, re, timeout) => page.waitForFunction(
  ([src, flags]) => new RegExp(src, flags).test(window.__e5t34eSerial ?? ""), [re.source, re.flags],
  { timeout, polling: 2000 });
const BOOT_ERROR = () => {
  const status = document.getElementById("omarchy-boot-status");
  return status?.dataset.state === "error" ? status.textContent : null;
};

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

async function openPage(query, routes = async () => {}) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, serviceWorkers: "block" });
  await routes(page);
  const w = watch(page);
  await page.addInitScript(() => {
    window.__e5t34eSerial = "";
    window.__e5t34eStates = [];
    const attach = () => {
      if (!window.wvmDemo?.onConsole) return setTimeout(attach, 20);
      const dec = new TextDecoder();
      window.wvmDemo.onConsole((u8) => { window.__e5t34eSerial += dec.decode(u8, { stream: true }); });
    };
    attach();
    window.addEventListener("wvm:guest-state", (e) => window.__e5t34eStates.push({ state: e.detail?.state, at: performance.now() }));
    window.addEventListener("wvm:desktop-ready", () => { window.__e5t34eDesktopReadyAt = performance.now(); });
  });
  const url = `${base}${app}?guest=replay-desktop&desktop=1${query}#ide`;
  log("open", url);
  await page.goto(url);
  return { page, w, url };
}

// The sway window title is Chrome's document.title, "Replay RISC-V PASS #<runs>".
async function chromeRuns(page) {
  const r = await page.evaluate(() => window.wvmDemo.exec(
    "SWAYSOCK=$(ls /run/user/1000/sway-ipc.*.sock) swaymsg -t get_tree | grep -o 'Replay RISC-V PASS #[0-9]*' | head -n 1",
    600000, { quiet: true }));
  const m = /PASS #(\d+)/u.exec(r?.stdout ?? "");
  return m ? Number(m[1]) : null;
}

async function desktopMode(mode) {
  const warm = mode === "warm";
  const dir = path.join(out, mode);
  fs.mkdirSync(dir, { recursive: true });
  const { page, w, url } = await openPage(warm ? "" : "&noSnapshot");
  const times = {};
  const wholeReq = await page.waitForEvent("requestfinished", { predicate: (r) => isWhole({ url: r.url() }), timeout: 60 * 60_000 });
  times.wholeImageFinishedMs = Date.now() - w.t0;
  if (warm) {
    // Both downloads run in parallel; the snapshot may finish before or after the image.
    while (w.requests.find(isSnap)?.finished === undefined) await page.waitForTimeout(100);
    const entry = w.requests.find(isSnap);
    times.snapshotStartedMs = entry.t;
    times.snapshotFinishedMs = entry.finished;
  }
  times.wholeImageStartedMs = w.requests.find(isWhole)?.t ?? null;
  times.downloadsFinishedMs = Math.max(times.wholeImageFinishedMs, times.snapshotFinishedMs ?? 0);
  log("downloads finished", JSON.stringify(times));
  await page.waitForFunction(`(window.__e5t34eDesktopReadyAt !== undefined
    && document.getElementById("omarchy-boot-overlay")?.hidden === true) || Boolean((${BOOT_ERROR})())`,
  null, { timeout: READY_TIMEOUT_MS, polling: 250 });
  assert.equal(await page.evaluate(`(${BOOT_ERROR})()`), null, "boot failed");
  times.desktopVisibleMs = Date.now() - w.t0;
  times.downloadEndToDesktopMs = times.desktopVisibleMs - times.downloadsFinishedMs;
  log("desktop visible", times.desktopVisibleMs, "ms;", times.downloadEndToDesktopMs, "ms after the downloads finished");
  const bootRequests = w.requests.slice();
  const states = await page.evaluate(() => window.__e5t34eStates);
  const s1 = await serial(page);
  await page.screenshot({ path: path.join(dir, "desktop.png") });
  if (warm) {
    assert.ok(states.some((s) => s.state === "restored"), `restored state (states: ${JSON.stringify(states)})`);
    assert.ok(!states.some((s) => s.state === "booting"), "a warm resume never enters the cold boot");
    assert.doesNotMatch(s1, /REPLAY_DESKTOP_MONITOR start|Run \/sbin\/init|Linux version/u, "no guest boot output");
  } else {
    assert.ok(states.some((s) => s.state === "booting") && !states.some((s) => s.state === "restored"));
    assert.match(s1, /REPLAY_DESKTOP_READY uptime=/u);
    assert.ok(!w.requests.some(isSnap), "?noSnapshot never downloads the snapshot");
  }

  // Liveness 1: Chrome. Its "Run again" button is at (93,516) of the 1280x800 guest output.
  const box = await page.locator("#ide-display-canvas").boundingBox();
  assert.ok(box && box.width > 100 && box.height > 100, "display canvas is laid out");
  const runsBefore = await chromeRuns(page);
  log("Chrome runs before click", runsBefore);
  assert.ok(Number.isInteger(runsBefore) && runsBefore >= 1, "Chrome's title reports its runs");
  const clickStartMs = Date.now() - w.t0;
  await page.mouse.click(box.x + box.width * (93 / 1280), box.y + box.height * (516 / 800));
  let runsAfter = runsBefore;
  for (let i = 0; i < 120 && runsAfter === runsBefore; i++) {
    await page.waitForTimeout(5000);
    runsAfter = await chromeRuns(page);
  }
  times.runAgainAnsweredMs = Date.now() - w.t0 - clickStartMs;
  log("Chrome runs after click", runsAfter, `(${times.runAgainAnsweredMs} ms)`);
  assert.equal(runsAfter, runsBefore + 1, "one DOM click on Run again increments runs once");
  await page.screenshot({ path: path.join(dir, "desktop-run-again.png") });

  // Liveness 2: the Node terminal, with DOM keyboard events only.
  await page.mouse.click(box.x + box.width * 0.82, box.y + box.height * 0.5);
  await page.waitForTimeout(3000);
  const nonce = randomBytes(4).toString("hex").toUpperCase();
  const command = `node -e "console.log('E5T34E_${nonce}', process.version)" | tee -a /run/replay-desktop/events`;
  const framesBefore = await page.evaluate(() => window.__keyboardCapture?.frames?.().length ?? 0);
  const typeStartMs = Date.now() - w.t0;
  await typeText(page, command);
  await page.keyboard.press("Enter", { delay: 40 });
  log("typed", command);
  const framesAfter = await page.evaluate(() => window.__keyboardCapture?.frames?.().length ?? 0);
  const nodeRe = new RegExp(`E5T34E_${nonce} v26\\.13\\.1`, "u");
  await waitSerial(page, nodeRe, NODE_TIMEOUT_MS);
  times.nodeAnswerAfterTypingMs = Date.now() - w.t0 - typeStartMs;
  log("node answered", times.nodeAnswerAfterTypingMs, "ms after typing began");
  await page.waitForTimeout(5000);
  await page.screenshot({ path: path.join(dir, "desktop-node.png") });
  const s2 = await serial(page);
  fs.writeFileSync(path.join(dir, "serial.log"), s2);
  const stats = await page.evaluate(() => window.__chunkedStats());
  const allRequests = w.requests.slice();
  const counts = {
    total: allRequests.length,
    wholeImage: allRequests.filter(isWhole).length,
    snapshot: allRequests.filter(isSnap).length,
    chunkOrRange: allRequests.filter(isChunkOrRange).length,
    diskRelated: allRequests.filter(isDiskRelated).map((r) => r.url),
    chunkManifest: allRequests.filter(isChunkManifest).length,
    bootDiskRelated: bootRequests.filter(isDiskRelated).length,
  };
  const wholeSizes = await wholeReq.sizes();
  const summary = {
    task: "E5-T34e", mode, url, browser: browser.version(), budgetMs: BUDGET_MS, nonce, command, times, states,
    downloads: {
      wholeImage: { url: wholeReq.url(), bytes: wholeSizes.responseBodySize, declared: whole.size },
      snapshot: warm ? { url: allRequests.find(isSnap)?.url, bytes: allRequests.find(isSnap)?.responseBodySize ?? null, declared: snap.size } : null,
    },
    counts, fetchStats: stats, chrome: { runsBefore, runsAfter },
    node: s2.split("\n").filter((l) => nodeRe.test(l)),
    keyboard: { framesBefore, framesAfter, typedChars: [...command].length },
    consoleErrors: w.consoleErrors,
  };
  save(`${mode}/summary.json`, summary);
  save(`${mode}/requests.json`, allRequests);
  save(`${mode}/console.json`, w.consoleLog);
  assert.equal(counts.wholeImage, 1, "exactly one whole-image request");
  assert.equal(counts.snapshot, warm ? 1 : 0, "exactly one snapshot request (warm) / none (cold)");
  assert.equal(counts.chunkOrRange, 0, "no chunk or Range request");
  assert.equal(counts.diskRelated.length, warm ? 2 : 1, `disk-related requests: ${counts.diskRelated.join(", ")}`);
  assert.equal(stats.localImage, true);
  assert.equal(stats.fetches, 0, "no network chunk fetch");
  assert.equal(stats.error, null);
  assert.ok(framesAfter > framesBefore, "the command went through the DOM keyboard bridge");
  assert.deepEqual(w.consoleErrors, [], `console errors: ${w.consoleErrors.join("; ")}`);
  if (warm) assert.ok(times.downloadEndToDesktopMs <= BUDGET_MS,
    `desktop visible ${times.downloadEndToDesktopMs} ms after the downloads (budget ${BUDGET_MS} ms)`);
  log(`${mode} PASS`, JSON.stringify({ times, counts: { ...counts, diskRelated: counts.diskRelated.length } }));
  await page.close();
  return summary;
}

// A tampered copy of the snapshot whose coherence header names another wasm build. The header's
// 32-byte core id is the crate version, NUL-padded ("0.0.1"); flip it to "9.9.9".
function tamperedCoreSnapshot() {
  const file = path.join(repo, snap.url);
  const raw = zlib.gunzipSync(fs.readFileSync(file));
  const core = Buffer.alloc(32); core.write("0.0.1");
  const at = raw.indexOf(core);
  assert.ok(at >= 0 && at < 256, `core id in the snapshot header (offset ${at})`);
  raw.write("9.9.9", at);
  const gz = zlib.gzipSync(raw, { level: 1 });
  const sha = (b) => createHash("sha256").update(b).digest("hex");
  return { gz, offset: at, entry: { ...snap, sha256: sha(gz), size: gz.length, uncompressedSha256: sha(raw) } };
}

async function attackMode(mode) {
  let tampered = null;
  let server = null;
  const manifest = structuredClone(bootManifest);
  if (mode === "attack-identity") {
    manifest.artifacts.bootSnapshot.identity.kernelSha256 = "0".repeat(64);
  } else {
    // Served from a separate local origin (a 120 MiB route.fulfill body crashes the page).
    tampered = tamperedCoreSnapshot();
    server = http.createServer((req, res) => {
      res.writeHead(200, { "Content-Type": "application/gzip", "Content-Length": tampered.gz.length,
        "Access-Control-Allow-Origin": "*", "Cross-Origin-Resource-Policy": "cross-origin" });
      res.end(tampered.gz);
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    manifest.artifacts.bootSnapshot = { ...tampered.entry,
      url: `http://127.0.0.1:${server.address().port}/tampered/${snapName}` };
  }
  const { page, w, url } = await openPage("", async (p) => {
    // Mutate the manifest the host actually serves (the live one carries R2 URLs).
    await p.route(/\/artifacts-replay-desktop\.json(\?.*)?$/u, async (route) => {
      const served = await (await route.fetch()).json();
      served.artifacts.bootSnapshot = mode === "attack-identity"
        ? { ...served.artifacts.bootSnapshot, identity: manifest.artifacts.bootSnapshot.identity }
        : manifest.artifacts.bootSnapshot;
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(served) });
    });
  });
  // The cold-boot fallback is proven by the guest's own boot output; it is not run to the desktop.
  try {
    await page.waitForFunction(`/REPLAY_DESKTOP_MONITOR start/u.test(window.__e5t34eSerial ?? "") || Boolean((${BOOT_ERROR})())`,
      null, { timeout: READY_TIMEOUT_MS, polling: 2000 });
  } catch (error) {
    save(`${mode}-timeout.json`, { states: await page.evaluate(() => window.__e5t34eStates).catch(() => null),
      serialTail: (await serial(page).catch(() => "")).slice(-2000), requests: w.requests, console: w.consoleLog });
    throw error;
  }
  const failed = await page.evaluate(`(${BOOT_ERROR})()`);
  const states = await page.evaluate(() => window.__e5t34eStates);
  const warnings = w.consoleLog.filter((e) => /warm snapshot/u.test(e.text)).map((e) => e.text);
  const summary = { task: "E5-T34e", mode, url, states, warnings, failed,
    tamperedCoreOffset: tampered?.offset ?? null,
    snapshotRequests: w.requests.filter(isSnap).length, consoleErrors: w.consoleErrors };
  save(`${mode}.json`, summary);
  assert.equal(failed, null, "the fallback is a cold boot, not a failed page");
  assert.ok(states.some((s) => s.state === "booting") && !states.some((s) => s.state === "restored"),
    `cold-booted, never restored: ${JSON.stringify(states)}`);
  if (mode === "attack-identity") {
    assert.equal(summary.snapshotRequests, 0, "a mismatched identity is refused before download");
    assert.ok(warnings.some((t) => /not admitted \(kernel\)/u.test(t)), `warning: ${warnings}`);
  } else {
    assert.equal(summary.snapshotRequests, 1);
    assert.ok(warnings.some((t) => /not coherent \(foreign_build\)/u.test(t)), `warning: ${warnings}`);
  }
  assert.deepEqual(w.consoleErrors, [], `console errors: ${w.consoleErrors.join("; ")}`);
  log(`${mode} PASS`, JSON.stringify({ states: states.map((s) => s.state), warnings }));
  await page.close();
  server?.close();
}

try {
  const results = {};
  for (const m of modes) {
    if (m === "warm" || m === "cold") results[m] = await desktopMode(m);
    else if (m === "attack-identity" || m === "attack-core") await attackMode(m);
    else throw new Error(`unknown mode ${m}`);
  }
  if (results.warm && results.cold) {
    const cmp = {
      warm: results.warm.times, cold: results.cold.times,
      coldDesktopAfterDownloadMs: results.cold.times.downloadEndToDesktopMs,
      warmDesktopAfterDownloadMs: results.warm.times.downloadEndToDesktopMs,
    };
    save("comparison.json", cmp);
    log("comparison", JSON.stringify(cmp));
  }
} finally {
  await browser.close();
}
