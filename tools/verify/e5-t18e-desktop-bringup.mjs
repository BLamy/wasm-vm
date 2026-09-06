#!/usr/bin/env node
// Rebuild first, then prove 25 isolated real browser guests. No older rootfs is a boot input.
import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { mkdir, mkdtemp, copyFile, readFile, writeFile, appendFile } from "node:fs/promises";
import { createServer } from "node:net";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { hashFile, sha256, verifyPublication } from "./e5-t18e-publication.mjs";
import { inspectRecoveryCanvas } from "./e5-t18d-surface.mjs";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
process.chdir(repo);
if (process.argv[2] === "--check-publication") {
  assert.equal(process.argv.length, 5, "supply image and chunk directories");
  console.log(JSON.stringify(await verifyPublication(repo, path.resolve(process.argv[3]), path.resolve(process.argv[4]))));
  process.exit(0);
}
assert.equal(process.argv.length, 2, "unknown arguments");
const head = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
if (process.env.E5_T18E_REQUIRE_HEAD) assert.equal(head, process.env.E5_T18E_REQUIRE_HEAD);
const out = path.resolve(process.env.E5_T18E_EVIDENCE_DIR || "evidence/e5-t18e");
const concurrency = Number(process.env.E5_T18E_CONCURRENCY || 12);
assert.ok(Number.isSafeInteger(concurrency) && concurrency >= 1 && concurrency <= 16);
const timeout = Number(process.env.E5_T18E_TIMEOUT_MS || 1_800_000);
assert.ok(Number.isSafeInteger(timeout) && timeout >= 900_000);
const env = { ...process.env };
for (const key of Object.keys(env)) {
  if (key === "RUSTFLAGS" || key === "RUST_LOG" || key.startsWith("CARGO_") ||
      /^(E5_T17B_|E5_T18B_|E5_T18D_)/.test(key) ||
      ["ROOTFS_OUT", "IMG_SIZE", "EXTRA_PKGS", "UPDATE_MANIFEST", "ALLOW_MANIFEST_DRIFT", "FORCE_LOCKED_INSTALL"].includes(key)) delete env[key];
}
await mkdir(out, { recursive: true });
await mkdir("target/e5-t18e", { recursive: true });
const work = await mkdtemp(path.join(repo, "target/e5-t18e/run-"));
const imageDir = path.join(work, "image"), chunkDir = path.join(work, "chunks");
await mkdir(imageDir);
const sources = {};
const sourcePaths = [
  "tools/image/desktop.sh", "tools/image/e5-t17a-desktop-packages.json", "tools/image/e5-t18d-desktop-image.json",
  "tools/image/e5-t18e/MANIFEST.txt", "tools/image/e5-t18e/FILE-MANIFEST.txt", "tools/rootfs.Dockerfile",
  "tools/build-rootfs.sh", "tools/rootfs-inner.sh", "tools/rootfs/start-desktop", "tools/rootfs/desktop-autologin",
  "tools/rootfs/desktop-runtime.initd", "tools/rootfs/desktop-test-console", "tools/serve-dev.sh",
  "tools/verify/e5-t18e-desktop-bringup.mjs", "tools/verify/e5-t18e-publication.mjs", "tools/verify/e5-t18d-surface.mjs",
  "web/desktop-cursor.html", "web/desktop-cursor.js", "web/desktop-terminal.js", "web/linux-worker-protocol.js",
  "web/linux-worker-host.js", "web/linux-worker.js", "web/loader.js", "web/src/sink/presentation.js",
  "web/src/sink/canvas2d.js", "web/src/input/pointer.js", "web/src/input/desktop-cursor-template.js",
  "web/src/input/desktop-geometry.js", "web/artifacts-alpine.json", "docs/desktop-bringup.md",
];
execFileSync("git", ["diff", "--exit-code", "HEAD", "--", ...sourcePaths], { stdio: "pipe" });
for (const file of sourcePaths) sources[file] = await hashFile(file);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function waitFor(predicate, label, limit = timeout) {
  const deadline = Date.now() + limit;
  while (Date.now() < deadline) { const value = await predicate(); if (value) return value; await sleep(500); }
  throw new Error(`bounded wait expired: ${label}`);
}
async function run(command, args, extra = {}) {
  console.log(`E5T18E_COMMAND=${command} ${args.join(" ")}`);
  let logging = Promise.resolve();
  await new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: repo, env: { ...env, ...extra }, stdio: ["ignore", "pipe", "pipe"] });
    for (const stream of [child.stdout, child.stderr]) stream.on("data", (data) => {
      process.stdout.write(data);
      logging = logging.then(() => appendFile(path.join(out, "build.log"), data));
    });
    child.on("error", reject);
    child.on("exit", (code) => code === 0 ? resolve() : reject(new Error(`${command} exited ${code}`)));
  });
  await logging;
}

await copyFile("tools/image/e5-t18e/FILE-MANIFEST.txt", path.join(imageDir, "FILE-MANIFEST.txt"));
await run("bash", ["tools/image/desktop.sh"], {
  E5_T17B_OUT: path.relative(repo, imageDir), E5_T17B_PACKAGE_LOCK: "tools/image/e5-t18e/MANIFEST.txt",
  E5_T18B_INTERACTIVE: "1", E5_T18D_RECOVERY: "1",
});
await run("cargo", ["build", "--release", "-p", "wasm-vm-cli", "--bin", "wasm-vm"]);
await run("target/release/wasm-vm", ["chunk", path.join(imageDir, "alpine-rootfs.ext4"), "--out", chunkDir]);
const publication = await verifyPublication(repo, imageDir, chunkDir);
await run("make", ["web-dist"]);
await copyFile("web/artifacts-alpine.json", "web/dist/artifacts-alpine.json");
const runtime = {};
for (const file of ["pkg/wasm_vm_wasm_bg.wasm", "pkg/wasm_vm_wasm.js", "desktop-cursor.html", "desktop-cursor.js",
  "desktop-terminal.js", "linux-worker-protocol.js", "linux-worker-host.js", "linux-worker.js", "loader.js",
  "src/sink/presentation.js", "src/sink/canvas2d.js", "src/input/pointer.js", "src/input/desktop-cursor-template.js",
  "src/input/desktop-geometry.js"]) {
  runtime[file] = await hashFile(`web/${file}`);
  assert.equal(await hashFile(`web/dist/${file}`), runtime[file], `${file} source/dist drift`);
}
const sourceBindingSha256 = sha256(JSON.stringify({ head, sources, runtime, publication }));
await writeFile(path.join(out, "publication.json"), JSON.stringify({ head, sources, runtime, publication, sourceBindingSha256 }, null, 2) + "\n");
console.log(`E5T18E_REBUILT=${JSON.stringify(publication)}`);

const port = await new Promise((resolve) => {
  const probe = createServer(); probe.listen(0, "127.0.0.1", () => { const port = probe.address().port; probe.close(() => resolve(port)); });
});
const transcript = [], active = new Map();
let server, browser, timer;
const cases = [];
const chrome = process.env.E5_T18E_CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const args = ["--disable-background-timer-throttling", "--disable-renderer-backgrounding", "--disable-backgrounding-occluded-windows"];
try {
  server = spawn("bash", ["tools/serve-dev.sh", String(port)], {
    cwd: repo, env: { ...env, E5_T18B_DESKTOP_ASSET_DIR: chunkDir }, detached: true, stdio: ["ignore", "pipe", "pipe"],
  });
  for (const stream of [server.stdout, server.stderr]) stream.on("data", (data) => transcript.push(data.toString()));
  const base = `http://127.0.0.1:${port}`;
  await waitFor(async () => { try { return (await fetch(`${base}/desktop-cursor.html`)).ok; } catch { return false; } }, "server", 30_000);
  const { chromium } = await import(pathToFileURL(path.join(repo, "web/node_modules/playwright/index.mjs")));
  browser = await chromium.launch({ executablePath: chrome, headless: true, args });
  timer = setInterval(async () => {
    const progress = [];
    for (const [label, page] of active) {
      try { progress.push(await page.evaluate(async (label) => ({ label,
        status: document.getElementById("desktop-status")?.textContent,
        frames: window.__desktopTerminal?.state().frameCount,
        retired: (await window.__desktopController?.schedulerStats())?.retiredInstructions }), label)); }
      catch (error) { progress.push({ label, error: String(error) }); }
    }
    await writeFile(path.join(out, "progress.json"), JSON.stringify(progress, null, 2));
    console.log(`E5T18E_PROGRESS=${JSON.stringify({ complete: cases.length, active: progress })}`);
  }, 30_000);
  timer.unref();

  async function makePage(cacheDisabled) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1100 }, deviceScaleFactor: 1, serviceWorkers: "block" });
    const page = await context.newPage(), cdp = await context.newCDPSession(page);
    await cdp.send("Network.enable"); await cdp.send("Network.setCacheDisabled", { cacheDisabled });
    const errors = [], cacheHits = [];
    page.on("pageerror", (error) => errors.push(String(error)));
    page.on("console", (message) => {
      transcript.push(`${page.url()} ${message.type()}: ${message.text()}\n`);
      if (message.type() === "error" && !message.location().url?.endsWith("/favicon.ico")) errors.push(message.text());
    });
    page.on("requestfailed", (request) => { if (!request.url().endsWith("/favicon.ico")) errors.push(`${request.url()}: ${request.failure()?.errorText}`); });
    cdp.on("Network.requestServedFromCache", (event) => cacheHits.push(event.requestId));
    return { context, page, errors, cacheHits, cacheDisabled };
  }
  async function capture(page, label) {
    await page.evaluate(() => window.__desktopController.pause());
    const data = await page.evaluate(async () => {
      const canvas = document.getElementById("desktop-canvas"), controller = window.__desktopController;
      const bytes = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height).data;
      const hash = await crypto.subtle.digest("SHA-256", bytes);
      return { width: canvas.width, height: canvas.height,
        framebufferSha256: Array.from(new Uint8Array(hash), (b) => b.toString(16).padStart(2, "0")).join(""),
        guestStateDigest: await controller.stateDigest(), scheduler: await controller.schedulerStats(),
        fetchStats: await controller.fetchStats(), presentation: window.__desktopTerminal.presentation() };
    });
    const png = await page.screenshot({ path: path.join(out, `${label}.png`) });
    return { ...data, screenshot: `${label}.png`, screenshotSha256: sha256(png) };
  }
  async function oneBoot(session, label, reload = false) {
    const { page, errors, cacheHits, cacheDisabled } = session;
    const started = Date.now(), cacheStart = cacheHits.length;
    active.set(label, page);
    console.log(`E5T18E_BOOT=${label}`);
    try {
      if (reload) await page.reload();
      else await page.goto(`${base}/desktop-cursor.html?jit=1&quantum=500000&imageSha256=${publication.imageSha256}&manifestSha256=${publication.chunkManifestSha256}`);
      await waitFor(async () => page.evaluate(() => document.documentElement.dataset.desktopReady === "ready"), `${label} desktop`);
      await waitFor(async () => (await page.evaluate(inspectRecoveryCanvas)).desktop, `${label} visible desktop`);
      const bootToDesktopMs = Date.now() - started;
      const readiness = await page.evaluate(() => JSON.parse(document.documentElement.dataset.desktopInspection));
      assert.equal(readiness.wallpaper, true); assert.equal(readiness.panel.ready, true); assert.equal(readiness.menu, true);
      const box = await page.locator("#desktop-canvas").boundingBox();
      assert.ok(box?.width > 0 && box.height > 0);
      const point = { x: 480, y: 160 };
      await page.mouse.move(box.x + point.x * box.width / 1280, box.y + point.y * box.height / 800);
      const cursor = await waitFor(async () => {
        const value = await page.evaluate((point) => window.__desktopCursor.renderedCursor(point), point);
        return value?.x === point.x && value?.y === point.y && value?.matchedPixels === 94 ? value : null;
      }, `${label} actual guest cursor`, 180_000);
      const surface = await page.evaluate(inspectRecoveryCanvas);
      assert.equal(surface.desktop, true);
      const desktopFrame = await capture(page, label);
      assert.deepEqual(desktopFrame.presentation.errors, []);
      assert.ok(desktopFrame.fetchStats.fetches > 0);
      await page.evaluate(() => window.__desktopController.resume());
      await page.evaluate((label) => window.__desktopTerminal.beginLaunch(label), label);
      await page.mouse.move(box.x + 24 * box.width / 1280, box.y + 16 * box.height / 800);
      await sleep(1_000);
      await page.mouse.down(); await page.mouse.up();
      await waitFor(async () => page.evaluate(() => window.__desktopTerminal.state().active.launch?.terminalRendered === true), `${label} launcher opens terminal`, 240_000);
      const launched = await page.evaluate(() => window.__desktopTerminal.finishLaunch());
      assert.equal(launched.launches.at(-1).accepted, true);
      assert.deepEqual(launched.diagnostics, []);
      const terminalFrame = await capture(page, `${label}-terminal`);
      assert.deepEqual(terminalFrame.presentation.errors, []);
      assert.deepEqual(errors, [], `${label} browser errors`);
      const record = { label, sourceBindingSha256, cacheDisabled, cacheHits: cacheHits.length - cacheStart,
        bootToDesktopMs, totalMs: Date.now() - started, readiness, surface, cursor, desktopFrame,
        launcher: launched.launches.at(-1), terminalFrame, errors: [...errors], passed: true };
      await writeFile(path.join(out, `${label}.json`), JSON.stringify(record, null, 2) + "\n");
      await writeFile(path.join(out, `${label}-serial.log`), await page.evaluate(() => window.__desktopTerminal.serial()));
      cases.push(record);
      console.log(`E5T18E_CASE_PASS=${label} bootMs=${bootToDesktopMs}`);
      return record;
    } catch (error) {
      await page.screenshot({ path: path.join(out, `${label}-failure.png`) }).catch(() => {});
      await writeFile(path.join(out, `${label}-failure.json`), JSON.stringify({ label, error: String(error), errors }, null, 2));
      await writeFile(path.join(out, `${label}-serial.log`), await page.evaluate(() => window.__desktopTerminal?.serial() || "").catch(() => ""));
      throw error;
    } finally { active.delete(label); }
  }
  let next = 0;
  const coldWorkers = Array.from({ length: concurrency }, async () => {
    while (next < 25) {
      const index = next++, session = await makePage(true);
      try { await oneBoot(session, `cold-${String(index + 1).padStart(2, "0")}`); }
      finally { await session.context.close(); }
    }
  });
  const warmRun = (async () => {
    const session = await makePage(false);
    try { await oneBoot(session, "warm-prime"); await oneBoot(session, "warm-reload", true); }
    finally { await session.context.close(); }
  })();
  const outcomes = await Promise.allSettled([...coldWorkers, warmRun]);
  for (const result of outcomes) if (result.status === "rejected") throw result.reason;
  cases.sort((a, b) => a.label.localeCompare(b.label));
  const cold = cases.filter((c) => c.cacheDisabled);
  assert.equal(cold.length, 25); assert.equal(cases.length, 27);
  assert.equal(new Set(cases.map((c) => c.label)).size, 27);
  assert.equal(execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(), head);
  for (const [file, digest] of Object.entries(sources)) assert.equal(await hashFile(file), digest, `${file} changed during proof`);
  for (const [file, digest] of Object.entries(runtime)) assert.equal(await hashFile(`web/${file}`), digest, `${file} runtime drift`);
  assert.deepEqual(await verifyPublication(repo, imageDir, chunkDir), publication);
  const values = cold.map((c) => c.bootToDesktopMs);
  const report = { schema: "wasm-vm.e5-t18e.bringup.v1", task: "E5-T18e", head, sourceBindingSha256, sources, runtime, publication,
    browser: { version: browser.version(), executable: chrome, headless: true, args },
    configuration: { coldContexts: 25, coldConcurrency: concurrency, concurrentWarmPair: true, dpr: 1, serviceWorkers: "block", persistence: false },
    timings: { cold: { valuesMs: values, minMs: Math.min(...values), maxMs: Math.max(...values), meanMs: values.reduce((a, b) => a + b, 0) / 25 },
      warm: cases.filter((c) => !c.cacheDisabled).map((c) => ({ label: c.label, bootToDesktopMs: c.bootToDesktopMs, cacheHits: c.cacheHits })) },
    cases, passed: true };
  await writeFile(path.join(out, "desktop-bringup.json"), JSON.stringify(report, null, 2) + "\n");
  console.log("E5T18E_PASS=25_COLD_2_WARM");
} finally {
  clearInterval(timer); await browser?.close();
  if (server) { try { process.kill(-server.pid, "SIGTERM"); } catch (error) { if (error.code !== "ESRCH") throw error; } }
  await writeFile(path.join(out, "browser-console.log"), transcript.join(""));
}
