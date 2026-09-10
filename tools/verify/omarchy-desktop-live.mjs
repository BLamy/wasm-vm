#!/usr/bin/env node
// Real demo-page capture. Never manufactures guest pixels or a readiness event.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { createHash, randomBytes } from "node:crypto";
import { createServer } from "node:http";
import { createGzip } from "node:zlib";
import { once } from "node:events";
import { createWriteStream } from "node:fs";
import { fileURLToPath } from "node:url";
import { chromium } from "../../web/node_modules/playwright/index.mjs";
import { physicalStroke } from "./omarchy-browser-session.mjs";

const [urlArg, output, mode = "verify"] = process.argv.slice(2);
assert.ok(urlArg && output, "usage: omarchy-desktop-live.mjs URL|local|selftest NEW_OUTPUT_DIR [capture|verify]");
assert.ok(mode === "capture" || mode === "verify", `invalid mode: ${mode}`);
const out = path.resolve(output);
await fs.mkdir(out, { recursive: false });
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const distRoot = path.join(repoRoot, "web", "dist");
const releaseRoot = path.join(repoRoot, "releases");
let ownedServer = null;

const MIME_TYPES = new Map([
  [".css", "text/css; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".mjs", "text/javascript; charset=utf-8"],
  [".wasm", "application/wasm"],
]);
const inside = (root, candidate) => candidate === root || candidate.startsWith(`${root}${path.sep}`);
function localPath(pathname) {
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return { status: 400, body: "bad URL encoding" };
  }
  if (decoded.includes("\0")) return { status: 400, body: "invalid path" };
  const relative = decoded.replace(/^\/+/, "");
  const releasesPath = decoded.startsWith("/releases/");
  const root = releasesPath ? releaseRoot : distRoot;
  const relativePath = releasesPath
    ? decoded.slice("/releases/".length)
    : decoded === "/" ? "app.html" : relative;
  const candidate = path.resolve(root, relativePath);
  if (!inside(root, candidate)) return { status: 403, body: "path outside served tree" };
  if (decoded === "/artifacts-alpine.json") {
    return {
      path: candidate,
      root,
      fallback: { path: path.join(repoRoot, "web", "artifacts-alpine.json"), root: path.join(repoRoot, "web") },
    };
  }
  return { path: candidate, root };
}
function contentType(filePath) {
  return MIME_TYPES.get(path.extname(filePath).toLowerCase()) || "application/octet-stream";
}
async function serveLocal(request, response) {
  if (request.method !== "GET" && request.method !== "HEAD") {
    response.writeHead(405, { Allow: "GET, HEAD" }); response.end(); return;
  }
  const pathname = new URL(request.url || "/", "http://127.0.0.1").pathname;
  const resolved = localPath(pathname);
  if (resolved.status) { response.writeHead(resolved.status); response.end(resolved.body); return; }
  if (!inside(resolved.root, path.resolve(resolved.path))) {
    response.writeHead(403); response.end("path outside served tree"); return;
  }
  let filePath = resolved.path;
  let servedRoot = resolved.root;
  let stat;
  try { stat = await fs.stat(filePath); } catch {
    if (!resolved.fallback) { response.writeHead(404); response.end("not found"); return; }
    filePath = resolved.fallback.path;
    servedRoot = resolved.fallback.root;
    if (!inside(servedRoot, path.resolve(filePath))) {
      response.writeHead(403); response.end("path outside served tree"); return;
    }
    try { stat = await fs.stat(filePath); } catch { response.writeHead(404); response.end("not found"); return; }
  }
  if (!stat.isFile()) { response.writeHead(404); response.end("not found"); return; }
  const [realRoot, realFile] = await Promise.all([
    fs.realpath(servedRoot).catch(() => null),
    fs.realpath(filePath).catch(() => null),
  ]);
  if (!realRoot || !realFile || !inside(realRoot, realFile)) {
    response.writeHead(403); response.end("path outside served tree"); return;
  }
  const headers = {
    "Content-Length": stat.size,
    "Content-Type": contentType(filePath),
    "Cross-Origin-Embedder-Policy": "require-corp",
    "Cross-Origin-Opener-Policy": "same-origin",
    "Cross-Origin-Resource-Policy": "same-origin",
    "Cache-Control": "no-store",
  };
  response.writeHead(200, headers);
  if (request.method === "HEAD") response.end();
  else response.end(await fs.readFile(filePath));
}
async function startLocalServer() {
  const server = createServer((request, response) => {
    void serveLocal(request, response).catch(() => {
      if (!response.headersSent) response.writeHead(500);
      response.end("local verifier server error");
    });
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  assert.ok(address && typeof address === "object", "local verifier server did not bind");
  return { server, url: `http://127.0.0.1:${address.port}/app.html?guest=omarchy&desktop=1#ide` };
}
async function runHttpSelfTest(baseUrl) {
  const manifest = JSON.parse(await fs.readFile(path.join(distRoot, "artifacts.json"), "utf8"));
  const expectedKernel = manifest.artifacts.kernel;
  const app = await fetch(`${baseUrl}/app.html`);
  assert.equal(app.status, 200, "app.html must be served");
  assert.match(await app.text(), /id=["']ide-root["']/);
  assert.equal(app.headers.get("cross-origin-opener-policy"), "same-origin");
  assert.equal(app.headers.get("cross-origin-embedder-policy"), "require-corp");

  const wasm = await fetch(`${baseUrl}/pkg/wasm_vm_wasm_bg.wasm`);
  assert.equal(wasm.status, 200, "Wasm must be served");
  assert.equal(wasm.headers.get("content-type"), "application/wasm");

  const kernel = await fetch(new URL(expectedKernel.url, `${baseUrl}/`));
  assert.equal(kernel.status, 200, "kernel must be served from repository releases");
  const kernelBytes = Buffer.from(await kernel.arrayBuffer());
  assert.equal(kernelBytes.length, expectedKernel.size, "kernel size must match manifest");
  assert.equal(createHash("sha256").update(kernelBytes).digest("hex"), expectedKernel.sha256, "kernel hash must match manifest");

  const traversal = await fetch(`${baseUrl}/releases/%2F..%2F..%2Fprivate-file`);
  assert.equal(traversal.status, 403, "encoded release traversal must be rejected");
  return {
    app: true,
    wasmMime: wasm.headers.get("content-type"),
    kernel: { size: kernelBytes.length, sha256: expectedKernel.sha256 },
    traversalStatus: traversal.status,
    coop: app.headers.get("cross-origin-opener-policy"),
    coep: app.headers.get("cross-origin-embedder-policy"),
  };
}

const local = urlArg === "local" || urlArg === "selftest" ? await startLocalServer() : null;
ownedServer = local?.server || null;
const url = local?.url || urlArg;
const report = { url, mode, startedAt: new Date().toISOString(), errors: [], observations: [] };
if (urlArg === "selftest") {
  let failure = null;
  try {
    report.httpSelfTest = await runHttpSelfTest(new URL(url).origin);
    report.result = "http-selftest-passed";
    console.log(`OMARCHY_HTTP_SELFTEST ${JSON.stringify(report.httpSelfTest)}`);
  } catch (error) {
    failure = error;
    report.result = "http-selftest-failed";
    report.error = error.stack || String(error);
    console.error(report.error);
  } finally {
    report.finishedAt = new Date().toISOString();
    await fs.writeFile(path.join(out, "report.json"), JSON.stringify(report, null, 2) + "\n");
    if (ownedServer) await new Promise((resolve) => ownedServer.close(resolve));
  }
  if (failure) throw failure;
  process.exit(0);
}
let browser;
try {
  browser = await chromium.launch({ headless: true,
  executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
} catch (error) {
  if (ownedServer) await new Promise((resolve) => ownedServer.close(resolve));
  throw error;
}
const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1,
  serviceWorkers: mode === "verify" ? "allow" : "block" });
const page = await context.newPage();
let secondPage = null;
let failurePage = page;
const pageLabels = new WeakMap([[page, "primary"]]);
function trackPage(targetPage, label) {
  targetPage.on("pageerror", (error) => report.errors.push(`${label}: ${String(error)}`));
  targetPage.on("console", (message) => {
    const source = message.location().url || "";
    if (message.type() === "error" && !/\/favicon\.ico(?:\?|$)/u.test(source)) {
      report.errors.push(`${label}: ${source}: ${message.text()}`);
    }
  });
}
function installEvidence(targetContext) {
  return targetContext.addInitScript(() => {
    window.__omarchyLiveEvidence = { ready: false, serial: "", events: [] };
    for (const type of ["wvm:guest-booting", "wvm:guest-state", "wvm:guest-error", "wvm:guest-halted", "wvm:guest-ready", "wvm:desktop-ready"]) {
      window.addEventListener(type, (event) => {
        window.__omarchyLiveEvidence.events.push({ type, detail: event.detail, ms: performance.now() });
        if (type === "wvm:desktop-ready") window.__omarchyLiveEvidence.ready = true;
      });
    }
    window.addEventListener("wvm:guest-output", (event) => {
      window.__omarchyLiveEvidence.serial += event.detail.text;
    });
  });
}
trackPage(page, "primary");
await installEvidence(context);
const exec = async (command, targetPage = page, stage = "guest-exec") => {
  const result = await targetPage.evaluate((command) => window.wvmDemo.exec(command, 300000, { quiet: true }), command);
  const context = pageLabels.get(targetPage) || "unknown";
  report.observations.push({
    exec: {
      timestamp: new Date().toISOString(),
      context,
      url: targetPage.url(),
      command,
      stdout: result?.stdout ?? "",
      exit: result?.exit ?? null,
    },
  });
  console.log(`OMARCHY_EXEC ${JSON.stringify({ stage, context, exit: result?.exit ?? null })}`);
  return result;
};
async function screenshot(name, targetPage = page) {
  const filename = path.join(out, name);
  await targetPage.screenshot({ path: filename, timeout: 20000 });
  report.observations.push({ screenshot: filename, sha256: createHash("sha256").update(await fs.readFile(filename)).digest("hex") });
  console.log(`OMARCHY_SCREENSHOT ${filename}`);
}
async function observeServiceWorker(targetPage, label) {
  const observation = await targetPage.evaluate(async () => {
    if (!("serviceWorker" in navigator)) return { controllerScriptURL: null, registrationActiveURL: null };
    const registration = await navigator.serviceWorker.getRegistration();
    return {
      controllerScriptURL: navigator.serviceWorker.controller?.scriptURL || null,
      registrationActiveURL: registration?.active?.scriptURL || null,
    };
  });
  report.observations.push({ serviceWorker: { label, ...observation } });
  return observation;
}
async function observeFocus(targetPage, label) {
  const observation = await targetPage.evaluate(() => ({
    activeId: document.activeElement?.id || null,
    activeTag: document.activeElement?.tagName || null,
    url: location.href,
    scroll: { x: window.scrollX, y: window.scrollY },
  }));
  report.observations.push({ focus: { label, ...observation } });
  return observation;
}
async function assertCanvasFocus(targetPage, label, expectedUrl) {
  const observation = await observeFocus(targetPage, label);
  assert.equal(observation.activeId, "ide-display-canvas", `${label}: host stole focus from canvas`);
  assert.equal(observation.url, expectedUrl, `${label}: URL changed while typing on desktop`);
  return observation;
}
async function assertRealOmarchyLayout(targetPage, label) {
  const observation = await targetPage.evaluate(() => ({
    e2eShowall: document.documentElement.classList.contains("e2e-showall"),
    visiblePanels: [...document.querySelectorAll(".panel")]
      .filter((panel) => getComputedStyle(panel).display !== "none")
      .map((panel) => panel.id),
    url: location.href,
  }));
  report.observations.push({ layout: { label, ...observation } });
  assert.equal(observation.e2eShowall, false, `${label}: e2e-showall must not be enabled in live capture`);
  assert.deepEqual(observation.visiblePanels, ["panel-ide"], `${label}: only Omarchy IDE panel may be visible`);
  return observation;
}
async function recordBuildIdentities() {
  const files = ["main.js", "ide.js", "roadmap.js", "loader.js", "guest-rpc.js", "pkg/wasm_vm_wasm_bg.wasm", "artifacts-omarchy.json"];
  const identities = {};
  for (const file of files) {
    const resourceUrl = new URL(`/${file}`, new URL(url).origin).href;
    const response = await fetch(resourceUrl);
    assert.equal(response.status, 200, `identity fetch failed for ${resourceUrl}`);
    const bytes = Buffer.from(await response.arrayBuffer());
    identities[file] = {
      url: resourceUrl,
      status: response.status,
      contentType: response.headers.get("content-type"),
      size: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    };
  }
  report.identities = { entryUrl: url, files: identities };
}
async function waitForDesktopReady(targetPage, label) {
  await targetPage.waitForFunction(() => window.__omarchyLiveEvidence?.ready === true, null, { timeout: 300000 });
  const evidence = await targetPage.evaluate(() => window.__omarchyLiveEvidence);
  assert.ok(evidence.events.some((event) => event.type === "wvm:desktop-ready"), `${label} lacked real wvm:desktop-ready`);
  assert.equal(await targetPage.evaluate(() => window.__linux?.restoredFromBootSnapshot?.()), true,
    `${label} did not restore from the boot snapshot`);
  return evidence;
}
async function mappedFoot(targetPage, label) {
  const clients = await exec("XDG_RUNTIME_DIR=/run/user/1000 hyprctl -i 0 -j clients", targetPage, `${label}:hyprctl-clients`);
  assert.equal(clients.exit, 0, `${label}: hyprctl clients failed`);
  const foot = JSON.parse(clients.stdout).find((client) => client.class === "foot" && client.mapped && !client.hidden);
  assert.ok(foot && foot.size.every((value) => value > 0), `${label}: no mapped Foot window`);
  return foot;
}
async function assertNoOmarchyPersistentIdb(targetPage, label) {
  const names = await targetPage.evaluate(async () => (await indexedDB.databases()).map((db) => db.name).filter(Boolean));
  const omarchy = names.filter((name) => name.startsWith("wasm-vm-disk-"));
  assert.deepEqual(omarchy, [], `${label}: Omarchy created persistent IndexedDB: ${omarchy.join(", ")}`);
  report.observations.push({ indexedDb: { label, names, omarchyPersistent: omarchy } });
}
async function readGuestFileEventually(targetPage, filename, expected, label) {
  const deadline = Date.now() + 120000;
  while (Date.now() < deadline) {
    // Read-only polling: the physical keyboard is the only writer of the nonce file.
    const result = await exec(`if [ -f '${filename}' ]; then cat '${filename}'; else (exit 75); fi`, targetPage, `${label}:nonce-readback`);
    if (result.exit === 0) {
      assert.equal(result.stdout.trim(), expected, `${label}: nonce readback mismatch`);
      return result.stdout.trim();
    }
    assert.equal(result.exit, 75, `${label}: nonce readback failed: ${result.stderr || result.stdout}`);
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(`${label}: timed out waiting for physical keyboard nonce file`);
}
async function capturePair() {
  await page.evaluate(() => window.__linux.pause());
  await page.evaluate(() => window.__persist());
  const stats = await page.evaluate(() => window.__persistStats());
  assert.equal(stats.pendingBlocks, 0); assert.equal(stats.flushWaiting, false); assert.equal(stats.writeWaiting, false);
  assert.equal(await page.evaluate(() => window.__snapshotSave()), true);
  const size = await page.evaluate(async () => {
    window.__omarchyExport = await window.__snapshotExport();
    return window.__omarchyExport?.length;
  });
  assert.ok(size > 1024 * 1024);
  const gzip = createGzip({ level: 9 });
  const destination = createWriteStream(path.join(out, "omarchy-ready.snap.gz"));
  gzip.pipe(destination);
  for (let offset = 0; offset < size; offset += 262144) {
    const encoded = await page.evaluate(({ offset }) => {
      const bytes = window.__omarchyExport.subarray(offset, offset + 262144);
      let binary = "";
      for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
      return btoa(binary);
    }, { offset });
    if (!gzip.write(Buffer.from(encoded, "base64"))) await once(gzip, "drain");
  }
  gzip.end(); await once(destination, "close");
  await page.evaluate(() => { delete window.__omarchyExport; });
  const base = "ec1bc2601b104cfb6d6875c091377ccfd0654d5b6aab71c6a08ae37263f1c391";
  const generation = await page.evaluate(() => window.__snapshotGeneration());
  const count = await page.evaluate(async (base) => {
    const names = (await indexedDB.databases()).filter((db) => db.name.includes(base));
    if (names.length !== 1) throw new Error(`expected one fresh overlay, found ${names.length}`);
    const db = await new Promise((resolve, reject) => { const r = indexedDB.open(names[0].name); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
    window.__omarchyExportDb = db;
    const store = db.transaction("blocks").objectStore("blocks");
    window.__omarchyExportKeys = await new Promise((resolve, reject) => { const r = store.getAllKeys(); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
    return window.__omarchyExportKeys.length;
  }, base);
  const delta = createGzip({ level: 9 });
  const disk = createWriteStream(path.join(out, "omarchy-overlay-delta.bin.gz")); delta.pipe(disk);
  const header = Buffer.alloc(61); header.write("WVOD1"); header.writeUInt32LE(4096, 5);
  header.writeBigUInt64LE(4294967296n, 9); Buffer.from(base, "hex").copy(header, 17);
  header.writeBigUInt64LE(BigInt(generation), 49); header.writeUInt32LE(count, 57); delta.write(header);
  for (let start = 0; start < count; start += 64) {
    const blocks = await page.evaluate(async (start) => {
      const keys = window.__omarchyExportKeys.slice(start, start + 64);
      const store = window.__omarchyExportDb.transaction("blocks").objectStore("blocks");
      return Promise.all(keys.map((key) => new Promise((resolve, reject) => {
        const r = store.get(key); r.onsuccess = () => resolve({ key, bytes: btoa(String.fromCharCode(...new Uint8Array(r.result))) }); r.onerror = () => reject(r.error);
      })));
    }, start);
    for (const block of blocks) {
      const bytes = Buffer.from(block.bytes, "base64"); assert.equal(bytes.length, 4096);
      const index = Buffer.alloc(8); index.writeBigUInt64LE(BigInt(block.key));
      if (!delta.write(Buffer.concat([index, bytes]))) await once(delta, "drain");
    }
  }
  delta.end(); await once(disk, "close");
  await page.evaluate(() => { window.__omarchyExportDb.close(); delete window.__omarchyExportDb; delete window.__omarchyExportKeys; });
  report.pair = { snapshotBytes: size, blocks: count, generation, base };
  console.log(`OMARCHY_PAIR ${JSON.stringify(report.pair)}`);
  await page.evaluate(() => window.__linux.resume());
}
try {
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForFunction(() => window.wvmDemo, null, { timeout: 30000 });
  assert.equal(new URL(url).searchParams.has("testHooks"), false, "live capture requires the actual URL without testHooks");
  await assertRealOmarchyLayout(page, "initial");
  await recordBuildIdentities();
  await observeServiceWorker(page, "initial");
  const deadline = Date.now() + Number(process.env.OMARCHY_BROWSER_TIMEOUT_MS || 7_200_000);
  while (Date.now() < deadline && !await page.evaluate(() => window.__omarchyLiveEvidence.ready)) {
    await screenshot("latest.png");
    const status = await page.locator("#omarchy-boot-status").textContent();
    console.log(`OMARCHY_PROGRESS ${JSON.stringify({ status, state: await page.evaluate(() => window.__presentation?.state()) })}`);
    assert.equal(report.errors.length, 0, JSON.stringify(report.errors));
    await new Promise((resolve) => setTimeout(resolve, 30000));
  }
  assert.equal(await page.evaluate(() => window.__omarchyLiveEvidence.ready), true, "desktop never rendered");
  await screenshot("desktop.png");
  report.restored = await page.evaluate(() => window.__linux.restoredFromBootSnapshot());
  if (mode === "verify") assert.equal(report.restored, true, "production must use the desktop warm snapshot");
  const foot = await mappedFoot(page, "initial desktop");
  report.foot = foot;
  if (mode === "verify") await assertNoOmarchyPersistentIdb(page, "initial desktop");
  if (mode === "capture") await capturePair();
  // The initial full-screen Foot is focused in the packaged desktop. Physical DOM keys, never
  // serial injection, create the nonce file; a separate serial command reads it back.
  const active = await exec("XDG_RUNTIME_DIR=/run/user/1000 hyprctl -i 0 -j activewindow", page, "initial:hyprctl-activewindow");
  assert.equal(JSON.parse(active.stdout).address, foot.address);
  await page.locator("#ide-display-canvas").click({ position: { x: 300, y: 200 } });
  const keyboardUrl = page.url();
  await assertCanvasFocus(page, "physical-keyboard-before", keyboardUrl);
  const nonce = randomBytes(8).toString("hex"), guestFile = `/tmp/desktop-keys-${nonce}`;
  for (const character of `printf '${nonce}' > ${guestFile}`) {
    const { code, shift } = physicalStroke(character);
    if (shift) await page.keyboard.down("ShiftLeft");
    await page.keyboard.press(code, { delay: 40 });
    if (shift) await page.keyboard.up("ShiftLeft");
    await assertCanvasFocus(page, `physical-keyboard-after-${character}`, keyboardUrl);
  }
  await page.keyboard.press("Enter");
  await assertCanvasFocus(page, "physical-keyboard-after-enter", keyboardUrl);
  await readGuestFileEventually(page, guestFile, nonce, "physical keyboard");
  report.keyboard = { verified: true, nonce };
  await screenshot("desktop-keyboard.png");
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.waitForFunction(() => {
    const s = window.__presentation.state();
    return s.latest?.resourceWidth === 1024 && s.width === 1024 && s.successfulPresents > 0;
  }, null, { timeout: 300000 });
  await screenshot("desktop-resized.png");
  report.resized = await page.evaluate(() => ({ presentation: window.__presentation.state(), viewport: window.__presentation.viewport() }));

  if (mode === "verify") {
    failurePage = page;
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.reload({ waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForFunction(() => window.wvmDemo && window.__linux, null, { timeout: 300000 });
    await assertRealOmarchyLayout(page, "reload");
    await observeServiceWorker(page, "reload");
    report.reloadEvidence = await waitForDesktopReady(page, "desktop reload");
    report.reloadedRestored = await page.evaluate(() => window.__linux.restoredFromBootSnapshot());
    report.reloadedFoot = await mappedFoot(page, "desktop reload");
    await assertNoOmarchyPersistentIdb(page, "desktop reload");
    await screenshot("desktop-reloaded.png");

    // Same browser context is deliberate: this is the competing-tab proof, so both pages share
    // origin storage and Web Locks while the first restored desktop remains open.
    secondPage = await context.newPage();
    pageLabels.set(secondPage, "second-tab");
    failurePage = secondPage;
    trackPage(secondPage, "second-tab");
    await secondPage.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
    assert.equal(new URL(secondPage.url()).origin, new URL(url).origin, "second tab must use the same origin");
    report.secondTabContext = "same-browser-context-shared-origin-storage";
    await secondPage.waitForFunction(() => window.wvmDemo && window.__linux, null, { timeout: 300000 });
    await assertRealOmarchyLayout(secondPage, "second-tab");
    await observeServiceWorker(secondPage, "second-tab");
    report.secondTabEvidence = await waitForDesktopReady(secondPage, "second tab");
    report.secondTabRestored = await secondPage.evaluate(() => window.__linux.restoredFromBootSnapshot());
    report.secondTabFoot = await mappedFoot(secondPage, "second tab");
    await assertNoOmarchyPersistentIdb(secondPage, "second tab");
    await screenshot("desktop-second-tab.png", secondPage);
  }
  assert.deepEqual(report.errors, []);
  report.result = mode === "verify"
    ? "desktop-rendered-keyboard-resize-reload-and-second-tab-verified"
    : "desktop-rendered-keyboard-and-resize-verified";
} catch (error) {
  report.result = "failed"; report.error = error.stack || String(error); process.exitCode = 1;
  try { await screenshot("failure.png", failurePage); } catch {}
  console.error(report.error);
} finally {
  try {
    const evidence = await page.evaluate(() => window.__omarchyLiveEvidence);
    await fs.writeFile(path.join(out, "serial.log"), evidence.serial);
    report.events = evidence.events;
  } catch {}
  try {
    if (secondPage) report.secondTabEvents = (await secondPage.evaluate(() => window.__omarchyLiveEvidence)).events;
  } catch {}
  report.finishedAt = new Date().toISOString();
  await fs.writeFile(path.join(out, "report.json"), JSON.stringify(report, null, 2) + "\n");
  await browser.close();
  if (ownedServer) await new Promise((resolve) => ownedServer.close(resolve));
}
