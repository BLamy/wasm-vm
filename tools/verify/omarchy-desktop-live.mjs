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
if (urlArg === "--selftest-presentation") {
  const staleSequence = [{ framesReceived: 12, successfulPresents: 8 }];
  let staleIndex = 0;
  await assert.rejects(
    waitForFreshPresentation(async () => staleSequence[staleIndex++],
      { framesReceived: 12, successfulPresents: 7 }, 50, "stale presentation self-test"),
    /timed out waiting/u,
  );
  const sequence = [
    { framesReceived: 12, successfulPresents: 8 },
    { framesReceived: 13, successfulPresents: 8 },
  ];
  let index = 0;
  await waitForFreshPresentation(async () => sequence[index++],
    { framesReceived: 12, successfulPresents: 7 }, 100, "presentation self-test");
  assert.equal(index, 2, "presentation self-test must consume the post-marker frame");
  process.exit(0);
}
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
const pageQuery = new URL(url).searchParams;
const prewarmTimeoutMs = mode === "capture"
  ? Number(process.env.OMARCHY_PREWARM_TIMEOUT_MS || 120000)
  : 120000;
if (mode === "capture") {
  try {
    assert.equal(pageQuery.get("persist"), "1", "capture mode requires explicit persist=1");
    assert.ok(Number.isSafeInteger(prewarmTimeoutMs) && prewarmTimeoutMs >= 1000 && prewarmTimeoutMs <= 1_800_000,
      "OMARCHY_PREWARM_TIMEOUT_MS must be an integer from 1000 to 1800000 in capture mode");
    assert.equal(pageQuery.has("testHooks"), false, "capture mode requires a production URL without testHooks");
  } catch (error) {
    if (ownedServer) await new Promise((resolve) => ownedServer.close(resolve));
    throw error;
  }
  report.capturePolicy = {
    freshContext: true,
    prewarm: true,
    timeoutMs: prewarmTimeoutMs,
    timeoutLabel: "capture-only prewarm timeout; not a verify-mode timeout",
  };
}
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
let loaderManifestResponse = null;
if (mode === "capture") context.on("response", (response) => {
  if (loaderManifestResponse || !/\/chunked-omarchy\/manifest(?:-[0-9a-f]{64})?\.json(?:\?|$)/iu.test(response.url())) return;
  loaderManifestResponse = response.body()
    .then((body) => ({ url: response.url(), status: response.status(), body, error: null }))
    .catch((error) => ({ url: response.url(), status: response.status(), body: null, error: String(error) }));
});
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
async function observeLoaderIdentity(label) {
  assert.ok(loaderManifestResponse, `${label}: actual loader chunk manifest response was not observed`);
  const captured = await loaderManifestResponse;
  assert.equal(captured.error, null, `${label}: actual loader chunk manifest body failed: ${captured.error}`);
  assert.equal(captured.status, 200, `${label}: chunk manifest response failed`);
  const text = captured.body.toString("utf8");
  const manifest = JSON.parse(text);
  const canonical = JSON.stringify({
    version: manifest.version,
    image_len: manifest.image_len,
    chunk_size: manifest.chunk_size,
    layout: manifest.layout,
    chunks: manifest.chunks,
  });
  const identity = {
    url: captured.url,
    rawSha256: createHash("sha256").update(captured.body).digest("hex"),
    baseBinding: createHash("sha256").update(canonical).digest("hex"),
    version: manifest.version,
    imageLen: manifest.image_len,
    chunkSize: manifest.chunk_size,
    layout: manifest.layout,
    chunkCount: manifest.chunks?.length ?? 0,
  };
  report.observations.push({ loaderIdentity: { label, ...identity } });
  return identity;
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
async function readGuestFileEventually(targetPage, filename, expected, label, timeoutMs = 120000) {
  const deadline = Date.now() + timeoutMs;
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
async function typePhysical(targetPage, text) {
  for (const character of text) {
    const { code, shift } = physicalStroke(character);
    if (shift) await targetPage.keyboard.down("ShiftLeft");
    await targetPage.keyboard.press(code, { delay: 40 });
    if (shift) await targetPage.keyboard.up("ShiftLeft");
  }
}
async function removeGuestFilePhysically(targetPage, filename, label, timeoutMs = 120000) {
  const keyboardUrl = targetPage.url();
  await assertCanvasFocus(targetPage, `${label}:before`, keyboardUrl);
  await typePhysical(targetPage, `rm -f '${filename}'`);
  await targetPage.keyboard.press("Enter");
  await assertCanvasFocus(targetPage, `${label}:after`, keyboardUrl);
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await exec(`if [ ! -e '${filename}' ]; then (exit 0); else (exit 1); fi`, targetPage, `${label}:verify`);
    if (result.exit === 0) {
      report.observations.push({ nonceCleanup: { label, filename, verified: true } });
      return;
    }
    assert.equal(result.exit, 1, `${label}: cleanup failed: ${result.stderr || result.stdout}`);
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(`${label}: timed out waiting for nonce cleanup`);
}
async function syncAndClearTerminalPhysically(targetPage, label, timeoutMs = 120000) {
  const keyboardUrl = targetPage.url();
  const marker = `WVM_PREWARM_SYNC_${randomBytes(6).toString("hex")}`;
  const markerFile = `/tmp/omarchy-prewarm-sync-${randomBytes(8).toString("hex")}`;
  const physicalCommand = `history -c && clear && sync && printf '${marker}' > '${markerFile}'`;
  await assertCanvasFocus(targetPage, `${label}:before`, keyboardUrl);
  await typePhysical(targetPage, physicalCommand);
  await targetPage.keyboard.press("Enter");
  await assertCanvasFocus(targetPage, `${label}:after`, keyboardUrl);
  await readGuestFileEventually(targetPage, markerFile, marker, `${label}:marker`, timeoutMs);
  const afterMarkerPresentation = await presentationProof(targetPage);
  const markerBaseline = {
    framesReceived: Number(afterMarkerPresentation.state?.framesReceived ?? 0),
    successfulPresents: Number(afterMarkerPresentation.state?.successfulPresents ?? 0),
  };
  assert.ok(Number.isFinite(markerBaseline.framesReceived) && Number.isFinite(markerBaseline.successfulPresents),
    `${label}: invalid post-marker presentation counters`);
  // A real pointer transition gives the compositor a fresh opportunity to present after
  // marker readback; frames emitted while typing cannot satisfy this post-marker gate.
  await targetPage.locator("#ide-display-canvas").hover({ position: { x: 301, y: 201 } });
  const freshState = await waitForFreshPresentation(
    () => targetPage.evaluate(() => window.__presentation?.state?.()),
    markerBaseline,
    timeoutMs,
    `${label}:post-marker-frame`,
  );
  const afterPresentation = await presentationProof(targetPage, afterMarkerPresentation);
  assert.ok(Number(freshState.framesReceived) > markerBaseline.framesReceived
    && Number(freshState.successfulPresents) > markerBaseline.successfulPresents,
  `${label}: post-marker presentation counters did not both advance`);
  assert.ok(afterPresentation.hasDesktopPixels, `${label}: clear did not leave real desktop pixels presented`);
  await assertCanvasFocus(targetPage, `${label}:frame`, keyboardUrl);
  const foot = await mappedFoot(targetPage, `${label}:Foot`);
  const active = await exec("XDG_RUNTIME_DIR=/run/user/1000 hyprctl -i 0 -j activewindow", targetPage, `${label}:activewindow`);
  assert.equal(active.exit, 0, `${label}: activewindow query failed`);
  assert.equal(JSON.parse(active.stdout).address, foot.address, `${label}: clear frame is not focused Foot`);
  const cleanup = await exec(`rm -f -- '${markerFile}' && sync`, targetPage, `${label}:marker-cleanup`);
  assert.equal(cleanup.exit, 0, `${label}: owned marker cleanup failed: ${cleanup.stderr || cleanup.stdout}`);
  const absent = await exec(`if [ ! -e '${markerFile}' ]; then (exit 0); else (exit 1); fi`, targetPage, `${label}:marker-absent`);
  assert.equal(absent.exit, 0, `${label}: owned marker remained after cleanup`);
  report.observations.push({ terminalCleanup: {
    label,
    physicalCommand,
    markerFile,
    markerVerifiedViaSerialReadback: true,
    cleanupExit: cleanup.exit,
    markerAbsent: true,
    clearAndHistoryRequested: true,
    clearAndHistoryProvenByMarker: false,
    newRealFramePresented: true,
    focusedFoot: true,
  } });
}
async function waitForFreshPresentation(readState, baseline, timeoutMs, label) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const state = await readState();
    if (Number(state?.framesReceived) > baseline.framesReceived
      && Number(state?.successfulPresents) > baseline.successfulPresents) return state;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`${label}: timed out waiting for presentation after baseline ${JSON.stringify(baseline)}`);
}
function layerRecords(value, records = []) {
  if (Array.isArray(value)) {
    for (const item of value) layerRecords(item, records);
  } else if (value && typeof value === "object") {
    if (typeof value.namespace === "string") records.push(value);
    for (const item of Object.values(value)) layerRecords(item, records);
  }
  return records;
}
function layerFingerprint(layer) {
  return JSON.stringify({
    namespace: layer.namespace,
    x: layer.x, y: layer.y, w: layer.w, h: layer.h,
    pid: layer.pid, address: layer.address,
  });
}
function layerIsVisible(layer) {
  if (layer.visible === false || layer.mapped === false) return false;
  return typeof layer.alpha !== "number" || layer.alpha > 0.01;
}
async function presentationProof(targetPage, previous = null) {
  return targetPage.evaluate((previousPixels) => {
    const state = window.__presentation?.state?.() || null;
    const pixels = window.__presentation?.readPixels?.();
    if (!pixels?.length) return { state, hasDesktopPixels: false, pixelHash: null, changedSamples: 0 };
    let hash = 2166136261;
    const samples = [];
    const sampleCount = Math.min(4096, Math.floor(pixels.length / 4));
    for (let index = 0; index < sampleCount; index++) {
      const offset = Math.floor(index * pixels.length / sampleCount / 4) * 4;
      const rgba = [pixels[offset], pixels[offset + 1], pixels[offset + 2], pixels[offset + 3]];
      samples.push(rgba);
      for (const byte of rgba) hash = Math.imul(hash ^ byte, 16777619);
    }
    const colors = new Set(), stride = Math.max(1, Math.floor(pixels.length / 4 / 8192)) * 4;
    let visible = 0, sampled = 0;
    for (let offset = 0; offset < pixels.length; offset += stride) {
      sampled++;
      if (pixels[offset + 3] > 0 && Math.max(pixels[offset], pixels[offset + 1], pixels[offset + 2]) > 12) {
        visible++; colors.add((pixels[offset] << 16) | (pixels[offset + 1] << 8) | pixels[offset + 2]);
      }
    }
    let changedSamples = 0;
    if (previousPixels?.samples) {
      changedSamples = samples.reduce((count, rgba, index) => count +
        (JSON.stringify(rgba) === JSON.stringify(previousPixels.samples[index]) ? 0 : 1), 0);
    }
    return {
      state,
      hasDesktopPixels: visible > sampled / 4 && colors.size >= 8,
      pixelHash: hash >>> 0,
      sampleCount: samples.length,
      samples,
      changedSamples,
    };
  }, previous);
}
async function proveCalendar(targetPage, label, screenshotName, timeoutMs = 300000, fileStem = label) {
  const command = "XDG_RUNTIME_DIR=/run/user/1000 hyprctl -i 0 -j layers";
  const beforeResult = await exec(command, targetPage, `${label}:layers-before`);
  assert.equal(beforeResult.exit, 0, "calendar proof: initial layers query failed");
  const beforeText = beforeResult.stdout;
  const before = JSON.parse(beforeText);
  const beforeFingerprints = new Set(layerRecords(before).map(layerFingerprint));
  const expectedNamespace = "omarchy-keyboard-panel";
  const beforePresentation = await presentationProof(targetPage);
  assert.ok(beforePresentation.hasDesktopPixels, "calendar proof: before-click desktop pixels missing");
  await targetPage.locator("#ide-display-canvas").click({ position: { x: 640, y: 13 } });

  const deadline = Date.now() + timeoutMs;
  let afterResult = null;
  let after = null;
  let newPanel = [];
  let afterPresentation = null;
  while (Date.now() < deadline) {
    afterResult = await exec(command, targetPage, `${label}:layers-after-click`);
    assert.equal(afterResult.exit, 0, "calendar proof: layers query failed after physical click");
    after = JSON.parse(afterResult.stdout);
    newPanel = layerRecords(after).filter((layer) => {
      return layer.namespace === expectedNamespace && Number(layer.pid) > 0
        && Number(layer.w) > 0 && Number(layer.h) > 0
        && layerIsVisible(layer)
        && !beforeFingerprints.has(layerFingerprint(layer));
    });
    if (newPanel.length) {
      afterPresentation = await presentationProof(targetPage, beforePresentation);
      if (afterPresentation.hasDesktopPixels && afterPresentation.changedSamples > 0) break;
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  assert.ok(newPanel.length, `calendar proof: no newly rendered primary panel layer for ${expectedNamespace}`);

  afterPresentation ||= await presentationProof(targetPage, beforePresentation);
  assert.ok(afterPresentation.hasDesktopPixels, "calendar proof: after-click desktop pixels missing");
  assert.ok(afterPresentation.changedSamples > 0, "calendar proof: physical click did not change displayed pixels");
  const displayProof = await targetPage.evaluate(() => ({
    url: location.href,
    canvas: { width: document.querySelector("#ide-display-canvas")?.width, height: document.querySelector("#ide-display-canvas")?.height },
    presentation: window.__presentation?.state?.() || null,
    viewport: window.__presentation?.viewport?.() || null,
  }));
  await fs.writeFile(path.join(out, `${fileStem}-layers.stdout`), `${beforeText}\n--- after physical clock click ---\n${afterResult.stdout}`);
  await fs.writeFile(path.join(out, `${fileStem}-displayproof.stdout`), JSON.stringify({
    click: { x: 640, y: 13, input: "physical canvas click" },
    expectedNamespace,
    newPanel,
    presentationBefore: { state: beforePresentation.state, presentCount: beforePresentation.state?.successfulPresents ?? null, hasDesktopPixels: beforePresentation.hasDesktopPixels, pixelHash: beforePresentation.pixelHash },
    presentationAfter: { state: afterPresentation.state, presentCount: afterPresentation.state?.successfulPresents ?? null, hasDesktopPixels: afterPresentation.hasDesktopPixels, pixelHash: afterPresentation.pixelHash, changedSamples: afterPresentation.changedSamples },
    displayProof,
  }, null, 2) + "\n");
  report[label.replaceAll(/[^a-z0-9_-]/giu, "_")] = { click: { x: 640, y: 13 }, expectedNamespace, newPanel,
    presentationBefore: { state: beforePresentation.state, presentCount: beforePresentation.state?.successfulPresents ?? null, hasDesktopPixels: beforePresentation.hasDesktopPixels, pixelHash: beforePresentation.pixelHash },
    presentationAfter: { state: afterPresentation.state, presentCount: afterPresentation.state?.successfulPresents ?? null, hasDesktopPixels: afterPresentation.hasDesktopPixels, pixelHash: afterPresentation.pixelHash, changedSamples: afterPresentation.changedSamples },
    displayProof };
  await screenshot(screenshotName, targetPage);
  return { expectedNamespace, newPanel, beforePresentation, afterPresentation };
}
async function closeCalendar(targetPage, proof, label, timeoutMs = 300000) {
  const command = "XDG_RUNTIME_DIR=/run/user/1000 hyprctl -i 0 -j layers";
  const openFingerprints = new Set(proof.newPanel.map(layerFingerprint));
  const keyboardUrl = targetPage.url();
  await assertCanvasFocus(targetPage, `${label}:before`, keyboardUrl);
  await targetPage.locator("#ide-display-canvas").click({ position: { x: 640, y: 13 } });
  await assertCanvasFocus(targetPage, `${label}:after`, keyboardUrl);
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await exec(command, targetPage, `${label}:layers-after-close`);
    assert.equal(result.exit, 0, `${label}: layers query failed after close`);
    const layers = layerRecords(JSON.parse(result.stdout));
    if (!layers.some((layer) => openFingerprints.has(layerFingerprint(layer)) && layerIsVisible(layer))) {
      report.observations.push({ calendarClosed: { label, verified: true } });
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(`${label}: calendar primary panel did not close after real click`);
}
async function capturePair(baseBinding) {
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
  const base = baseBinding;
  assert.match(base, /^[0-9a-f]{64}$/u, "actual loader base binding must be lowercase SHA-256");
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
  const loaderIdentity = mode === "capture" ? await observeLoaderIdentity("desktop-ready") : null;
  if (loaderIdentity) report.loaderIdentity = loaderIdentity;
  const foot = await mappedFoot(page, "initial desktop");
  report.foot = foot;
  if (mode === "verify") await assertNoOmarchyPersistentIdb(page, "initial desktop");
  // The initial full-screen Foot is focused in the packaged desktop. Physical DOM keys, never
  // serial injection, create the nonce file; a separate serial command reads it back.
  const prewarmStartedAt = mode === "capture" ? Date.now() : null;
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
  await readGuestFileEventually(page, guestFile, nonce, "physical keyboard",
    mode === "capture" ? prewarmTimeoutMs : 120000);
  report.keyboard = { verified: true, nonce };
  await screenshot("desktop-keyboard.png");
  if (mode === "capture") {
    const calendarProof = await proveCalendar(page, "capture-prewarm-calendar", "desktop-prewarm-calendar.png", prewarmTimeoutMs);
    await closeCalendar(page, calendarProof, "capture-prewarm-calendar-close", prewarmTimeoutMs);
    await removeGuestFilePhysically(page, guestFile, "capture-prewarm-nonce-cleanup", prewarmTimeoutMs);
    await syncAndClearTerminalPhysically(page, "capture-prewarm-sync", prewarmTimeoutMs);
    const cleanFoot = await mappedFoot(page, "capture prewarm clean Foot");
    const cleanActive = await exec("XDG_RUNTIME_DIR=/run/user/1000 hyprctl -i 0 -j activewindow", page, "capture-prewarm:activewindow");
    assert.equal(cleanActive.exit, 0, "capture prewarm: activewindow query failed");
    assert.equal(JSON.parse(cleanActive.stdout).address, cleanFoot.address,
      "capture prewarm: clean Foot is not the active desktop window");
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.waitForFunction(() => {
      const state = window.__presentation.state();
      return state.width === 1280 && state.height === 800 && state.successfulPresents > 0;
    }, null, { timeout: prewarmTimeoutMs });
    await screenshot("desktop-prewarm.png");
    report.capturePrewarm = {
      startedAt: new Date(prewarmStartedAt).toISOString(),
      elapsedMs: Date.now() - prewarmStartedAt,
      timeoutMs: prewarmTimeoutMs,
      physicalNonceVerified: true,
      calendarOpenedAndClosed: true,
      nonceCleaned: true,
      syncVerified: true,
      cleanFoot,
      viewport: { width: 1280, height: 800 },
      loaderBaseBinding: loaderIdentity.baseBinding,
    };
    await capturePair(loaderIdentity.baseBinding);
  }
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
    await proveCalendar(secondPage, "calendar", "desktop-calendar.png",
      Number(process.env.OMARCHY_CALENDAR_TIMEOUT_MS || 300000), "desktop-calendar");
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
