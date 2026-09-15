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
import { execFileSync } from "node:child_process";
import { chromium, errors as playwrightErrors } from "../../web/node_modules/playwright/index.mjs";
import { physicalStroke } from "./omarchy-browser-session.mjs";
import { observeHyprlandRenderer } from "./omarchy-renderer-log.mjs";
import { parseExpectedLpNumThreads, validateExpectedLpEnvironment } from "./omarchy-thread-setting.mjs";
import { servedIdentity, installWireEvidence } from "./omarchy-live-recording.mjs";
import { COLD_BLANK_PATH, COLD_KERNEL_SHA256, coldPairOptions, coldPairUrl,
  assertEmptyOriginStorage, assertColdRestore, assertColdDesktop, remainingStartupMs,
  withinStartupDeadline } from "./omarchy-cold-pair.mjs";
import { inputTrialOptions, inputTrialUrl, assertInputTrialSource, assertInputTrialRuntime,
  remainingTrialMs, withinTrialDeadline } from "./omarchy-input-trial.mjs";
import { pauseFailedInput, exportFailedInput } from "./omarchy-failure-checkpoint.mjs";

const [urlArg, output, mode = "verify"] = process.argv.slice(2);
if (urlArg === "--selftest-presentation") {
  let now = 0;
  const clock = { now: () => now, sleep: async ms => { now += ms; } };
  const staleSequence = [{ framesReceived: 12, successfulPresents: 8 }];
  let staleIndex = 0;
  await assert.rejects(
    waitForFreshPresentation(async () => staleSequence[staleIndex++],
      { framesReceived: 12, successfulPresents: 7 }, 50, "stale presentation self-test", clock),
    /timed out waiting/u,
  );
  const sequence = [
    { framesReceived: 12, successfulPresents: 8 },
    { framesReceived: 13, successfulPresents: 8 },
  ];
  let index = 0;
  await waitForFreshPresentation(async () => sequence[index++],
    { framesReceived: 12, successfulPresents: 7 }, 100, "presentation self-test", clock);
  assert.equal(index, 2, "presentation self-test must consume the post-marker frame");
  process.exit(0);
}
assert.ok(urlArg && output, "usage: omarchy-desktop-live.mjs URL|local|selftest NEW_OUTPUT_DIR [capture|verify|cold-pair|input-trial]");
assert.ok(["capture", "verify", "cold-pair", "input-trial"].includes(mode), `invalid mode: ${mode}`);
const coldPair = mode === "cold-pair";
const inputTrial = mode === "input-trial";
const failureCheckpoint = process.env.OMARCHY_FAILURE_CHECKPOINT === "1";
if (process.env.OMARCHY_FAILURE_CHECKPOINT !== undefined) {
  assert.equal(process.env.OMARCHY_FAILURE_CHECKPOINT, "1");
  assert.ok(inputTrial, "failure checkpoint requires input-trial");
}
const candidatePairEnv = process.env.OMARCHY_CANDIDATE_PAIR_DIR || "";
const candidateChunksEnv = process.env.OMARCHY_CANDIDATE_CHUNKS || "";
if (!coldPair) assert.equal(Boolean(candidatePairEnv), Boolean(candidateChunksEnv),
  "OMARCHY_CANDIDATE_PAIR_DIR and OMARCHY_CANDIDATE_CHUNKS must be supplied together");
const candidateRequested = Boolean(candidateChunksEnv);
if (candidateRequested) assert.ok(urlArg === "local" || urlArg === "selftest",
  "local-only candidate inputs require URL argument local or selftest");
const requestedRenderer = process.env.OMARCHY_EXPECT_RENDERER || null;
if (requestedRenderer) assert.match(requestedRenderer, /^(?:softpipe|llvmpipe)$/u,
  "OMARCHY_EXPECT_RENDERER must be softpipe or llvmpipe");
const expectedLpNumThreads = parseExpectedLpNumThreads(process.env.OMARCHY_EXPECT_LP_NUM_THREADS);
if (expectedLpNumThreads !== null) assert.equal(requestedRenderer || "llvmpipe", "llvmpipe",
  "OMARCHY_EXPECT_LP_NUM_THREADS requires llvmpipe renderer expectation");
const expectedRenderer = requestedRenderer || (expectedLpNumThreads === null ? null : "llvmpipe");
if (candidateRequested && !inputTrial) assert.ok(expectedRenderer,
  "local-only candidate capture requires OMARCHY_EXPECT_RENDERER for positive renderer proof");
const trial = inputTrial ? inputTrialOptions({ urlArg, pair: candidatePairEnv, chunks: candidateChunksEnv,
  arm: process.env.OMARCHY_INPUT_TRIAL_ARM, renderer: expectedRenderer, lp: expectedLpNumThreads,
  timeout: process.env.OMARCHY_BROWSER_TIMEOUT_MS }) : null;
if (!inputTrial) assert.equal(process.env.OMARCHY_INPUT_TRIAL_ARM, undefined,
  "OMARCHY_INPUT_TRIAL_ARM requires input-trial mode");
const coldStartupMs = coldPair ? coldPairOptions({ urlArg, pair: candidatePairEnv, chunks: candidateChunksEnv,
  renderer: expectedRenderer, lp: expectedLpNumThreads, timeout: process.env.OMARCHY_BROWSER_TIMEOUT_MS }) : null;
const out = path.resolve(output);
await fs.mkdir(out, { recursive: false, ...(coldPair ? { mode: 0o700 } : {}) });
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const distRoot = path.join(repoRoot, "web", "dist");
const releaseRoot = path.join(repoRoot, "releases");
let ownedServer = null;
let candidate = null;
const resourceIdentities = [];

const MIME_TYPES = new Map([
  [".css", "text/css; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".mjs", "text/javascript; charset=utf-8"],
  [".wasm", "application/wasm"],
]);
const inside = (root, candidate) => candidate === root || candidate.startsWith(`${root}${path.sep}`);
async function candidateRegularFile(filename, label, root) {
  const absolute = path.resolve(filename);
  assert.ok(inside(root, absolute), `${label} escapes candidate root`);
  const info = await fs.lstat(absolute).catch(() => null);
  assert.ok(info?.isFile(), `${label} is not a regular file: ${absolute}`);
  assert.equal(info.isSymbolicLink(), false, `${label} must not be a symlink: ${absolute}`);
  assert.ok(inside(await fs.realpath(root), await fs.realpath(absolute)), `${label} resolves outside candidate root`);
  return absolute;
}
async function candidateDirectory(filename, label) {
  const absolute = path.resolve(filename);
  const info = await fs.lstat(absolute).catch(() => null);
  assert.ok(info?.isDirectory(), `${label} is not a directory: ${absolute}`);
  assert.equal(info.isSymbolicLink(), false, `${label} must not be a symlink: ${absolute}`);
  return absolute;
}
async function hashFile(filename) {
  const bytes = await fs.readFile(filename);
  return { size: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") };
}
async function prepareLocalCandidate() {
  if (!candidateRequested) return null;
  const pairDirectory = coldPair ? null : await candidateDirectory(candidatePairEnv, "candidate pair directory");
  const chunkRoot = await candidateDirectory(candidateChunksEnv, "candidate chunk directory");
  const chunkDirectory = (await fs.lstat(path.join(chunkRoot, "chunks")).catch(() => null))?.isDirectory()
    ? path.join(chunkRoot, "chunks") : chunkRoot;
  const manifestPath = await candidateRegularFile(path.join(chunkRoot, "manifest.json"), "candidate chunk manifest", chunkRoot);
  const pairSnapshot = coldPair ? null : await candidateRegularFile(path.join(pairDirectory, "omarchy-ready.snap.gz"), "candidate boot snapshot", pairDirectory);
  const pairDelta = coldPair ? null : await candidateRegularFile(path.join(pairDirectory, "omarchy-overlay-delta.bin.gz"), "candidate overlay delta", pairDirectory);
  const template = JSON.parse(await fs.readFile(path.join(repoRoot, "web", "artifacts-omarchy.json"), "utf8"));
  const kernelPath = await candidateRegularFile(path.resolve(repoRoot, template.artifacts.kernel.url), "candidate kernel", path.join(repoRoot, "releases"));
  const manifestBytes = await fs.readFile(manifestPath);
  let imageManifest;
  try { imageManifest = JSON.parse(manifestBytes); } catch (error) { throw Error(`invalid candidate chunk manifest: ${error}`); }
  assert.ok(Number.isSafeInteger(imageManifest.image_len) && imageManifest.image_len > 0, "candidate image_len is invalid");
  assert.ok(Number.isSafeInteger(imageManifest.chunk_size) && imageManifest.chunk_size > 0, "candidate chunk_size is invalid");
  assert.equal(imageManifest.layout, "split", "candidate chunk layout must be split");
  assert.ok(Array.isArray(imageManifest.chunks) && imageManifest.chunks.length > 0
    && imageManifest.chunks.every((name) => typeof name === "string" && /^[0-9a-f]{64}$/u.test(name)),
  "candidate chunk manifest must contain lowercase content hashes");
  const chunkFiles = {};
  for (const name of new Set(imageManifest.chunks)) {
    const filename = await candidateRegularFile(path.join(chunkDirectory, `${name}.bin`), `candidate chunk ${name}`, chunkDirectory);
    chunkFiles[name] = filename;
  }
  const files = {
    kernel: { filename: kernelPath, route: "/candidate/kernel" },
    ...(!coldPair ? {
    bootSnapshot: { filename: pairSnapshot, route: "/candidate/boot-snapshot" },
    overlayDelta: { filename: pairDelta, route: "/candidate/overlay-delta" },
    } : {}),
  };
  for (const entry of Object.values(files)) {
    const identity = await hashFile(entry.filename);
    entry.size = identity.size; entry.sha256 = identity.sha256;
  }
  if (coldPair) {
    assert.equal(template.artifacts.kernel.sha256, COLD_KERNEL_SHA256, "cold-pair kernel manifest is not pinned af7");
    assert.equal(files.kernel.sha256, COLD_KERNEL_SHA256, "cold-pair kernel bytes are not pinned af7");
    assert.equal(files.kernel.size, template.artifacts.kernel.size);
    assert.equal(imageManifest.image_len, 4294967296, "cold-pair requires the 4 GiB candidate");
    assert.equal(imageManifest.chunk_size, 262144);
    assert.equal(imageManifest.chunks.length, 16384);
    await candidateDirectory(chunkDirectory, "candidate chunk files directory");
  }
  const manifestSha256 = createHash("sha256").update(manifestBytes).digest("hex");
  const manifestKey = `chunked-omarchy/manifest-${manifestSha256}.json`;
  const source = {
    kind: "local-only-candidate",
    pairDirectory,
    chunkDirectory,
    chunkManifest: { filename: manifestPath, size: manifestBytes.length, sha256: manifestSha256 },
    kernel: { filename: files.kernel.filename, size: files.kernel.size, sha256: files.kernel.sha256 },
    ...(!coldPair ? {
      bootSnapshot: { filename: files.bootSnapshot.filename, size: files.bootSnapshot.size, sha256: files.bootSnapshot.sha256 },
      overlayDelta: { filename: files.overlayDelta.filename, size: files.overlayDelta.size, sha256: files.overlayDelta.sha256 },
    } : { cold: true }),
    image: { imageLen: imageManifest.image_len, chunkSize: imageManifest.chunk_size, chunkCount: imageManifest.chunks.length },
  };
  return {
    source,
    manifestPath,
    manifestBytes,
    chunkFiles,
    manifest: {
      generated: "LOCAL-ONLY diagnostic candidate (not a release claim)",
      artifacts: Object.fromEntries(Object.entries(files).map(([role, entry]) =>
        [role, { url: entry.route, sha256: entry.sha256, size: entry.size }])),
      chunkedImage: { key: manifestKey, sha256: manifestSha256, size: manifestBytes.length },
    },
  };
}
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
  if (coldPair && pathname === COLD_BLANK_PATH) {
    const bytes = Buffer.from("<!doctype html><meta charset=utf-8><title>Cold origin storage inspection</title>");
    resourceIdentities.push(servedIdentity({ pathname, method: request.method, bytes, repoRoot }));
    response.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Content-Length": bytes.length,
      "Cache-Control": "no-store", "Content-Security-Policy": "default-src 'none'",
      "Cross-Origin-Opener-Policy": "same-origin", "Cross-Origin-Embedder-Policy": "require-corp" });
    response.end(request.method === "HEAD" ? undefined : bytes); return;
  }
  if (coldPair && (pathname.startsWith("/candidate/") && pathname !== "/candidate/kernel"
    || pathname.startsWith("/releases/"))) {
    response.writeHead(404); response.end("not part of cold candidate"); return;
  }
  if (candidate) {
    let candidateFile = null;
    let candidateBytes = null;
    if (pathname === "/artifacts-omarchy.json") candidateBytes = Buffer.from(JSON.stringify(candidate.manifest));
    else if (pathname === `/${candidate.manifest.chunkedImage.key}`) candidateBytes = candidate.manifestBytes;
    else if (pathname === "/candidate/kernel") candidateFile = candidate.source.kernel.filename;
    else if (pathname === "/candidate/boot-snapshot") candidateFile = candidate.source.bootSnapshot?.filename;
    else if (pathname === "/candidate/overlay-delta") candidateFile = candidate.source.overlayDelta?.filename;
    else {
      const match = pathname.match(/^\/chunked-omarchy\/chunks\/([0-9a-f]{64})\.bin$/u);
      if (match) candidateFile = candidate.chunkFiles[match[1]] || null;
      else if (pathname.startsWith("/chunked-omarchy/")) {
        response.writeHead(404); response.end("not found"); return;
      }
    }
    if (candidateBytes || candidateFile) {
      const bytes = candidateBytes || await fs.readFile(candidateFile);
      resourceIdentities.push(servedIdentity({ pathname, method: request.method,
        filename: candidateFile, bytes, repoRoot }));
      response.writeHead(200, {
        "Content-Length": bytes.length,
        "Content-Type": pathname.endsWith(".json") ? "application/json" : "application/octet-stream",
        "Cross-Origin-Embedder-Policy": "require-corp",
        "Cross-Origin-Opener-Policy": "same-origin",
        "Cross-Origin-Resource-Policy": "same-origin",
        "Cache-Control": "no-store",
      });
      if (request.method === "HEAD") response.end(); else response.end(bytes);
      return;
    }
  }
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
  const bytes = await fs.readFile(filePath);
  resourceIdentities.push(servedIdentity({ pathname, method: request.method,
    filename: realFile, bytes, repoRoot }));
  response.writeHead(200, headers);
  if (request.method === "HEAD") response.end();
  else response.end(bytes);
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
  const manifest = candidate
    ? await (await fetch(`${baseUrl}/artifacts-omarchy.json`)).json()
    : JSON.parse(await fs.readFile(path.join(distRoot, "artifacts.json"), "utf8"));
  const expectedKernel = manifest.artifacts.kernel;
  const app = await fetch(`${baseUrl}/app.html`);
  assert.equal(app.status, 200, "app.html must be served");
  assert.match(await app.text(), /id=["']ide-root["']/);
  assert.equal(app.headers.get("cross-origin-opener-policy"), "same-origin");
  assert.equal(app.headers.get("cross-origin-embedder-policy"), "require-corp");

  const wasm = await fetch(`${baseUrl}/pkg/wasm_vm_wasm_bg.wasm`);
  assert.equal(wasm.status, 200, "Wasm must be served");
  assert.equal(wasm.headers.get("content-type"), "application/wasm");

  const kernel = await fetch(candidate ? `${baseUrl}/candidate/kernel` : new URL(expectedKernel.url, `${baseUrl}/`));
  assert.equal(kernel.status, 200, "kernel must be served from repository releases");
  const kernelBytes = Buffer.from(await kernel.arrayBuffer());
  assert.equal(kernelBytes.length, expectedKernel.size, "kernel size must match manifest");
  assert.equal(createHash("sha256").update(kernelBytes).digest("hex"), expectedKernel.sha256, "kernel hash must match manifest");
  if (candidate) {
    const chunkManifest = await fetch(`${baseUrl}/${manifest.chunkedImage.key}`);
    assert.equal(chunkManifest.status, 200, "candidate chunk manifest must be served");
    const chunkBytes = Buffer.from(await chunkManifest.arrayBuffer());
    assert.equal(createHash("sha256").update(chunkBytes).digest("hex"), manifest.chunkedImage.sha256,
      "candidate chunk manifest hash must match its content-addressed key");
    const firstChunk = JSON.parse(chunkBytes.toString("utf8")).chunks[0];
    const chunk = await fetch(`${baseUrl}/chunked-omarchy/chunks/${firstChunk}.bin`);
    assert.equal(chunk.status, 200, "candidate content-addressed chunk must be served");
    assert.equal((await chunk.arrayBuffer()).byteLength > 0, true, "candidate chunk must not be empty");
  }
  if (coldPair) {
    assert.deepEqual(Object.keys(manifest.artifacts), ["kernel"]);
    for (const route of ["/candidate/boot-snapshot", "/candidate/overlay-delta", "/releases/boot-snapshot/omarchy-ready.snap.gz"]) {
      assert.equal((await fetch(`${baseUrl}${route}`)).status, 404, "cold server must refuse pair artifacts");
    }
    const blank = await fetch(`${baseUrl}${COLD_BLANK_PATH}`);
    assert.equal(blank.status, 200);
    assert.match(blank.headers.get("content-type"), /^text\/html/u);
    assert.doesNotMatch(await blank.text(), /<script|<iframe|<link/iu);
  }

  const traversal = await fetch(`${baseUrl}/releases/%2F..%2F..%2Fprivate-file`);
  assert.equal(traversal.status, coldPair ? 404 : 403, "encoded release traversal must be rejected");
  return {
    app: true,
    wasmMime: wasm.headers.get("content-type"),
    kernel: { size: kernelBytes.length, sha256: expectedKernel.sha256 },
    traversalStatus: traversal.status,
    coop: app.headers.get("cross-origin-opener-policy"),
    coep: app.headers.get("cross-origin-embedder-policy"),
  };
}

candidate = await prepareLocalCandidate();
if (inputTrial) assertInputTrialSource(candidate.source);
const local = urlArg === "local" || urlArg === "selftest" ? await startLocalServer() : null;
ownedServer = local?.server || null;
const localUrl = local ? (coldPair ? coldPairUrl(local.url)
  : inputTrial ? inputTrialUrl(local.url, trial) : new URL(local.url)) : null;
if (localUrl && candidate) localUrl.searchParams.set("omarchyAssetBase", localUrl.origin);
const url = localUrl?.href || urlArg;
const report = { url, mode, startedAt: new Date().toISOString(), errors: [], observations: [],
  resourceIdentities, browserRequests: [], serialCommands: [], inputEvents: [], workerTraffic: [] };
if (coldPair) report.progressCaptureErrors = [];
if (inputTrial) {
  const scope = ["tools/verify/omarchy-desktop-live.mjs", "tools/verify/omarchy-input-trial.mjs",
    "tools/verify/omarchy-recycling-ab.mjs",
    "tools/verify/omarchy-desktop-services.mjs",
    "tools/verify/omarchy-failure-checkpoint.mjs", "tools/verify/omarchy-input-wait.mjs",
    "tools/verify/omarchy-owned-trial.mjs",
    "tools/verify/omarchy-browser-session.mjs", "tools/verify/omarchy-live-recording.mjs",
    "crates/core/src/dispatch.rs", "crates/core/src/lib.rs", "crates/wasm/src/lib.rs",
    "web"];
  report.trial = { ...trial, rendererEvidence: "unchanged pinned R3 LP1; no new renderer claim",
    head: execFileSync("git", ["rev-parse", "HEAD"], { cwd: repoRoot, encoding: "utf8" }).trim(),
    scopedStatus: execFileSync("git", ["status", "--short", "--", ...scope], { cwd: repoRoot, encoding: "utf8" }),
    helpers: Object.fromEntries(await Promise.all(scope.filter(file => file.startsWith("tools/")).map(async file =>
      [file, await hashFile(path.join(repoRoot, file))]))),
    profilingRequested: false, admissionProbeRequested: false };
  assert.equal(report.trial.scopedStatus, "", "input-trial requires a frozen committed runtime and recorder");
}
if (candidate) report.candidate = { localOnly: true, source: candidate.source, manifest: candidate.manifest };
if (coldPair) report.capturePolicy = { freshContext: true, prewarm: false, physicalInput: false,
  noSnapshot: true, persist: true, serviceWorkers: "block", startupTimeoutMs: coldStartupMs };
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
let browserServer = null;
try {
  const launchOptions = { headless: !inputTrial,
  executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] };
  if (inputTrial) {
    browserServer = await chromium.launchServer(launchOptions);
    const ownedBrowserPid = browserServer.process().pid;
    process.send?.({ kind: "input-trial-owned-browser", pid: ownedBrowserPid });
    browserServer.process().once("exit", () => process.send?.({ kind: "input-trial-browser-exited", pid: ownedBrowserPid }));
    browser = await chromium.connect(browserServer.wsEndpoint());
  } else browser = await chromium.launch(launchOptions);
} catch (error) {
  if (ownedServer) await new Promise((resolve) => ownedServer.close(resolve));
  throw error;
}
const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1,
  serviceWorkers: mode === "verify" ? "allow" : "block" });
context.on("request", request => report.browserRequests.push({ timestamp: new Date().toISOString(),
  url: request.url(), method: request.method(), resourceType: request.resourceType() }));
await context.addInitScript(installWireEvidence);
const page = await context.newPage();
let secondPage = null;
let failurePage = page;
let loaderManifestResponse = null;
if (mode === "capture" || coldPair || inputTrial) context.on("response", (response) => {
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
let coldDeadline = null;
let trialCaptureDeadline = null;
const startupCall = (operation) => coldDeadline === null ? operation()
  : inputTrial ? withinTrialDeadline(operation, coldDeadline, "input-trial startup") : withinStartupDeadline(operation, coldDeadline);
const exec = async (command, targetPage = page, stage = "guest-exec", timeoutMs = 300000) => {
  if (coldDeadline !== null) timeoutMs = inputTrial ? remainingTrialMs(coldDeadline) : remainingStartupMs(coldDeadline);
  assert.ok(Number.isSafeInteger(timeoutMs) && timeoutMs > 0, `${stage}: invalid guest RPC timeout`);
  report.serialCommands.push({ timestamp: new Date().toISOString(),
    context: pageLabels.get(targetPage) || "unknown", stage, command, timeoutMs });
  const result = await startupCall(() => targetPage.evaluate(({ command, timeoutMs }) => window.wvmDemo.exec(command, timeoutMs, { quiet: true }),
    { command, timeoutMs }));
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
async function collectWireEvidence(targetPage, epoch) {
  const evidence = await targetPage.evaluate(() => window.__omarchyWireEvidence);
  assert.ok(evidence, "browser wire observer was not installed");
  const context = pageLabels.get(targetPage) || "unknown";
  for (const key of ["inputEvents", "workerTraffic"]) {
    report[key].push(...evidence[key].map(entry => ({ context, epoch, ...entry })));
  }
}
async function screenshot(name, targetPage = page, timeoutMs = 20000) {
  const filename = path.join(out, name);
  await targetPage.screenshot({ path: filename, timeout: timeoutMs });
  report.observations.push({ screenshot: filename, timestamp: new Date().toISOString(),
    sha256: createHash("sha256").update(await fs.readFile(filename)).digest("hex") });
  console.log(`OMARCHY_SCREENSHOT ${filename}`);
}
async function runtimeDiagnostics(targetPage, label) {
  const state = await targetPage.evaluate(async () => {
    const controller = window.__linuxCtl;
    const read = async (method) => typeof controller?.[method] === "function"
      ? controller[method]() : null;
    const [inputDevice, jit, scheduler, clock] = await Promise.all([
      read("inputDeviceStats"), read("jitStats"), read("schedulerStats"), read("guestClockState"),
    ]);
    return { inputDevice, jit, scheduler, clock, guestSession: window.wvmDemo?.guestSession?.() ?? null,
      presentation: window.__presentation?.state?.() ?? null };
  });
  report.observations.push({ runtime: { label, timestamp: new Date().toISOString(),
    context: pageLabels.get(targetPage) || "unknown", ...state } });
  return state;
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
async function proveHyprlandRenderer(targetPage, label) {
  assert.ok(expectedRenderer, `${label}: OMARCHY_EXPECT_RENDERER is required for renderer proof`);
  const instances = await exec("XDG_RUNTIME_DIR=/run/user/1000 hyprctl -j instances", targetPage, `${label}:instances`);
  assert.equal(instances.exit, 0, `${label}: hyprctl instances failed`);
  let rows;
  try { rows = JSON.parse(instances.stdout); } catch (error) { throw Error(`${label}: invalid instances JSON: ${error}`); }
  assert.ok(Array.isArray(rows) && rows.length === 1, `${label}: Hyprland instance is absent or ambiguous`);
  const instance = rows[0];
  assert.ok(typeof instance.instance === "string" && /^[A-Za-z0-9_.-]+$/u.test(instance.instance),
    `${label}: unsafe Hyprland instance name`);
  assert.ok(Number.isSafeInteger(instance.pid) && instance.pid > 0, `${label}: unsafe Hyprland PID`);
  const pid = instance.pid;
  const environment = await exec(
    `tr '\\000' '\\n' < /proc/${pid}/environ | sed -n '/^GALLIUM_DRIVER=/p;/^LIBGL_ALWAYS_SOFTWARE=/p;/^LP_NUM_THREADS=/p'`,
    targetPage, `${label}:environment`);
  assert.equal(environment.exit, 0, `${label}: /proc environment probe failed`);
  if (expectedLpNumThreads === null) {
    const gallium = environment.stdout.split("\n").filter((line) => line.startsWith("GALLIUM_DRIVER="));
    assert.equal(gallium.length, 1, `${label}: GALLIUM_DRIVER is absent or ambiguous`);
    assert.equal(gallium[0], `GALLIUM_DRIVER=${expectedRenderer}`, `${label}: GALLIUM_DRIVER mismatch`);
  }
  const threads = await exec(`ps -T -p ${pid} -o comm=`, targetPage, `${label}:threads`);
  assert.equal(threads.exit, 0, `${label}: Hyprland thread probe failed`);
  assert.ok(threads.stdout.trim(), `${label}: Hyprland thread list is empty`);
  const validatedThreadSetting = expectedLpNumThreads === null ? null
    : validateExpectedLpEnvironment({ environment: environment.stdout, threads: threads.stdout, lpNumThreads: expectedLpNumThreads });
  if (expectedRenderer === "softpipe") assert.doesNotMatch(threads.stdout, /llvmpipe/u,
    `${label}: llvmpipe worker present for softpipe`);
  const log = await exec(
    `sed -n '/DEBUG ]: Renderer:/p;/DEBUG ]: Vendor:/p' /run/user/1000/hypr/${instance.instance}/hyprland.log`,
    targetPage, `${label}:log`);
  assert.equal(log.exit, 0, `${label}: Hyprland renderer log probe failed`);
  const parsedLog = expectedLpNumThreads === "0" && log.stdout.trim() === ""
    ? { kind: "lp0-configuration-observed", glLabelAvailable: false, activeRendererValidated: false }
    : observeHyprlandRenderer({ log: log.stdout, threads: threads.stdout, expectedRenderer });
  const observation = { expectedRenderer, expectedLpNumThreads, instance, environment, threads, log,
    threadSetting: validatedThreadSetting, parsedLog,
    activeRendererValidated: parsedLog.positivelyMatched === true };
  report.observations.push({ renderer: { label, ...observation } });
  return observation;
}
async function assertNoOmarchyPersistentIdb(targetPage, label) {
  const names = await targetPage.evaluate(async () => (await indexedDB.databases()).map((db) => db.name).filter(Boolean));
  const omarchy = names.filter((name) => name.startsWith("wasm-vm-disk-"));
  assert.deepEqual(omarchy, [], `${label}: Omarchy created persistent IndexedDB: ${omarchy.join(", ")}`);
  report.observations.push({ indexedDb: { label, names, omarchyPersistent: omarchy } });
}
async function readGuestFileEventually(targetPage, filename, expected, label, timeoutMs = 120000, timing = null) {
  const started = inputTrial && timing?.enteredAtMs ? timing.enteredAtMs : Date.now(), deadline = started + timeoutMs;
  if (timing) Object.assign(timing, { readbackStartedAt: new Date(started).toISOString(),
    readbackTimeoutMs: timeoutMs, deadlineMs: timeoutMs, deadlineAt: new Date(deadline).toISOString() });
  while (Date.now() < deadline) {
    // Read-only polling: the physical keyboard is the only writer of the nonce file.
    const remaining = deadline - Date.now();
    if (remaining <= 0) break;
    const read = () => exec(`if [ -f '${filename}' ]; then cat '${filename}'; else (exit 75); fi`, targetPage,
      `${label}:nonce-readback`, Math.min(300000, remaining));
    const result = inputTrial ? await withinTrialDeadline(read, deadline, `${label}:readback`) : await read();
    if (Date.now() > deadline) throw new Error(`${label}: nonce readback completed after deadline`);
    if (result.exit === 0) {
      assert.equal(result.stdout.trim(), expected, `${label}: nonce readback mismatch`);
      return result.stdout.trim();
    }
    assert.equal(result.exit, 75, `${label}: nonce readback failed: ${result.stderr || result.stdout}`);
    await new Promise((resolve) => setTimeout(resolve, Math.min(1000, Math.max(1, deadline - Date.now()))));
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
async function waitForFreshPresentation(readState, baseline, timeoutMs, label,
  clock = { now: Date.now, sleep: ms => new Promise(resolve => setTimeout(resolve, ms)) }) {
  const deadline = clock.now() + timeoutMs;
  while (clock.now() < deadline) {
    const state = await readState();
    if (Number(state?.framesReceived) > baseline.framesReceived
      && Number(state?.successfulPresents) > baseline.successfulPresents) return state;
    await clock.sleep(25);
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
  if (coldPair) assert.equal(await page.evaluate(() => window.__linux.isPaused()), true);
  await page.evaluate(() => window.__persist());
  const stats = await page.evaluate(() => window.__persistStats());
  assert.equal(stats.pendingBlocks, 0); assert.equal(stats.flushWaiting, false); assert.equal(stats.writeWaiting, false);
  if (coldPair) {
    // pause is an execution flag; require a second idle persistence sample after outstanding pump work.
    await new Promise(resolve => setTimeout(resolve, 50));
    const settled = await page.evaluate(() => window.__persistStats());
    assert.equal(settled.pendingBlocks, 0); assert.equal(settled.flushWaiting, false); assert.equal(settled.writeWaiting, false);
    report.capturePersistence = { stats, settled, timestamp: new Date().toISOString() };
  }
  assert.equal(await page.evaluate(() => window.__snapshotSave()), true);
  const size = await page.evaluate(async () => {
    window.__omarchyExport = await window.__snapshotExport();
    return window.__omarchyExport?.length;
  });
  assert.ok(size > 1024 * 1024);
  const gzip = createGzip({ level: 9 });
  const snapshotFile = path.join(out, "omarchy-ready.snap.gz");
  const destination = createWriteStream(snapshotFile, { flags: "wx" });
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
  const snapshotHeader = coldPair ? Buffer.from(await page.evaluate(() => Array.from(window.__omarchyExport.subarray(0, 84)))) : null;
  await page.evaluate(() => { delete window.__omarchyExport; });
  const base = baseBinding;
  assert.match(base, /^[0-9a-f]{64}$/u, "actual loader base binding must be lowercase SHA-256");
  const generation = await page.evaluate(() => window.__snapshotGeneration());
  if (coldPair) {
    assert.equal(snapshotHeader.subarray(0, 8).toString("ascii"), "WVMRESU1");
    assert.equal(snapshotHeader.readUInt32LE(8), 1);
    assert.equal(snapshotHeader.subarray(44, 76).toString("hex"), base);
    assert.equal(snapshotHeader.readBigUInt64LE(76), BigInt(generation));
  }
  const count = await page.evaluate(async ({ base, coldPair }) => {
    const names = (await indexedDB.databases()).filter((db) =>
      coldPair ? db.name === `wvov-${base}` : db.name.includes(base));
    if (names.length !== 1) throw new Error(`expected one fresh overlay, found ${names.length}`);
    const db = await new Promise((resolve, reject) => { const r = indexedDB.open(names[0].name); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
    if (!db.objectStoreNames.contains("blocks")) {
      db.close();
      throw new Error("selected overlay database has no blocks store");
    }
    window.__omarchyExportDb = db;
    const store = db.transaction("blocks").objectStore("blocks");
    window.__omarchyExportKeys = await new Promise((resolve, reject) => { const r = store.getAllKeys(); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
    return window.__omarchyExportKeys.length;
  }, { base, coldPair });
  const delta = createGzip({ level: 9 });
  const deltaFile = path.join(out, "omarchy-overlay-delta.bin.gz");
  const disk = createWriteStream(deltaFile, { flags: "wx" }); delta.pipe(disk);
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
      assert.ok(Number.isSafeInteger(block.key) && block.key >= 0 && block.key < 4294967296 / 4096,
        "overlay block index outside candidate image");
      const index = Buffer.alloc(8); index.writeBigUInt64LE(BigInt(block.key));
      if (!delta.write(Buffer.concat([index, bytes]))) await once(delta, "drain");
    }
  }
  delta.end(); await once(disk, "close");
  await page.evaluate(() => { window.__omarchyExportDb.close(); delete window.__omarchyExportDb; delete window.__omarchyExportKeys; });
  report.pair = { snapshotBytes: size, blocks: count, generation, base };
  if (coldPair) {
    assert.equal(await page.evaluate(() => window.__linux.isPaused()), true);
    assert.equal(await page.evaluate(() => window.__snapshotGeneration()), generation);
    report.pair.snapshot = { filename: snapshotFile, ...await hashFile(snapshotFile) };
    report.pair.delta = { filename: deltaFile, ...await hashFile(deltaFile) };
    report.pair.coreId = snapshotHeader.subarray(12, 44).toString("hex");
    report.pair.capturedAt = new Date().toISOString();
    report.pair.paused = true;
  }
  console.log(`OMARCHY_PAIR ${JSON.stringify(report.pair)}`);
  if (!coldPair) await page.evaluate(() => window.__linux.resume());
}
async function runLive() {
  if (inputTrial) {
    const started = Date.now(); coldDeadline = started + trial.startupMs;
    process.send?.({ kind: "input-trial-navigation", startedAtMs: started });
    report.startup = { startedAt: new Date(started).toISOString(), timeoutMs: trial.startupMs,
      deadlineAt: new Date(coldDeadline).toISOString() };
  }
  if (coldPair) {
    await page.goto(new URL(COLD_BLANK_PATH, url).href, { waitUntil: "domcontentloaded", timeout: 30000 });
    report.initialStorage = await page.evaluate(async () => ({
      timestamp: new Date().toISOString(), origin: location.origin, pathname: location.pathname,
      databases: (await indexedDB.databases()).map(db => ({ name: db.name, version: db.version })),
      caches: await caches.keys(),
      serviceWorkers: (await navigator.serviceWorker.getRegistrations()).map(reg => reg.scope),
      serviceWorkerController: navigator.serviceWorker.controller?.scriptURL || null,
      localStorage: Object.keys(localStorage), sessionStorage: Object.keys(sessionStorage),
      vmPresent: Boolean(window.wvmDemo || window.__linuxCtl),
      workerMessages: window.__omarchyWireEvidence?.workerTraffic?.length ?? -1,
    }));
    assertEmptyOriginStorage(report.initialStorage, new URL(url).origin);
    const started = Date.now();
    coldDeadline = started + coldStartupMs;
    report.startup = { startedAt: new Date(started).toISOString(), timeoutMs: coldStartupMs,
      deadlineAt: new Date(coldDeadline).toISOString() };
  }
  await startupCall(() => page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 }));
  await startupCall(() => page.waitForFunction(() => window.wvmDemo, null, { timeout: 30000 }));
  assert.equal(new URL(url).searchParams.has("testHooks"), false, "live capture requires the actual URL without testHooks");
  await startupCall(() => assertRealOmarchyLayout(page, "initial"));
  await startupCall(() => recordBuildIdentities());
  await startupCall(() => observeServiceWorker(page, "initial"));
  const deadline = coldDeadline ?? Date.now() + Number(process.env.OMARCHY_BROWSER_TIMEOUT_MS || 7_200_000);
  while (Date.now() < deadline && !await startupCall(() => page.evaluate(() => window.__omarchyLiveEvidence.ready))) {
    try {
      await startupCall(() => screenshot("latest.png"));
    } catch (error) {
      if (!coldPair || !(error instanceof playwrightErrors.TimeoutError)) throw error;
      const observation = { timestamp: new Date().toISOString(), name: "latest.png", error: String(error) };
      report.progressCaptureErrors.push(observation);
      console.warn(`OMARCHY_PROGRESS_CAPTURE_ERROR ${JSON.stringify(observation)}`);
    }
    const status = await startupCall(() => page.locator("#omarchy-boot-status").textContent());
    console.log(`OMARCHY_PROGRESS ${JSON.stringify({ status, state: await startupCall(() => page.evaluate(() => window.__presentation?.state())) })}`);
    assert.equal(report.errors.length, 0, JSON.stringify(report.errors));
    await new Promise((resolve) => setTimeout(resolve, Math.min(30000, Math.max(1, deadline - Date.now()))));
  }
  assert.equal(await startupCall(() => page.evaluate(() => window.__omarchyLiveEvidence.ready)), true, "desktop never rendered");
  await startupCall(() => screenshot("desktop.png", page, coldPair ? remainingStartupMs(coldDeadline) : 20000));
  report.restored = await startupCall(() => page.evaluate(() => window.__linux.restoredFromBootSnapshot()));
  if (mode === "verify" || inputTrial) assert.equal(report.restored, true, "desktop must use the warm snapshot");
  const loaderIdentity = mode === "capture" || coldPair || inputTrial ? await startupCall(() => observeLoaderIdentity("desktop-ready")) : null;
  if (loaderIdentity) report.loaderIdentity = loaderIdentity;
  if (coldPair) {
    report.restoreOutcomes = await startupCall(() => page.evaluate(async () => ({
      shipped: window.__linux.restoredFromBootSnapshot(),
      stored: await window.__linuxCtl.storedSnapshotRestoreEvidence(),
    })));
    assertColdRestore(report.restoreOutcomes);
    report.restoreOutcomes.storedRestored = false;
    const renderer = await proveHyprlandRenderer(page, "cold-pair ready");
    const ctl = `XDG_RUNTIME_DIR=/run/user/1000 hyprctl -i ${renderer.instance.instance}`;
    const clients = await exec(`${ctl} -j clients`, page, "cold-pair:clients");
    const layers = await exec(`${ctl} -j layers`, page, "cold-pair:layers");
    const processes = await exec("ps -u 1000 -o pid=,comm=,args=", page, "cold-pair:processes");
    const current = await exec("XDG_RUNTIME_DIR=/run/user/1000 hyprctl -j instances", page, "cold-pair:confirm-instance");
    for (const result of [clients, layers, processes, current]) assert.equal(result.exit, 0, "cold-pair desktop probe failed");
    report.coldDesktop = assertColdDesktop({ renderer, clients: JSON.parse(clients.stdout),
      layers: JSON.parse(layers.stdout), processes: processes.stdout, confirmedInstances: JSON.parse(current.stdout) });
    report.foot = report.coldDesktop.foot;
    remainingStartupMs(coldDeadline);
    report.startup.readyProvenAt = new Date().toISOString();
    coldDeadline = null;
    await capturePair(loaderIdentity.baseBinding);
    assert.deepEqual(report.errors, []);
    report.result = "cold-pair-captured-input-unverified";
    return;
  }
  let foot;
  if (!inputTrial) {
    foot = await mappedFoot(page, "initial desktop");
    report.foot = foot;
  }
  if (mode === "verify") await assertNoOmarchyPersistentIdb(page, "initial desktop");
  if (expectedRenderer) await proveHyprlandRenderer(page, "initial desktop");
  // The initial full-screen Foot is focused in the packaged desktop. Physical DOM keys, never
  // serial injection, create the nonce file; a separate serial command reads it back.
  const prewarmStartedAt = mode === "capture" ? Date.now() : null;
  if (!inputTrial) {
    const active = await exec("XDG_RUNTIME_DIR=/run/user/1000 hyprctl -i 0 -j activewindow", page, "initial:hyprctl-activewindow");
    assert.equal(active.exit, 0, "active window query failed");
    assert.equal(JSON.parse(active.stdout).address, foot.address);
  }
  await startupCall(() => page.locator("#ide-display-canvas").click({ position: { x: 300, y: 200 } }));
  const keyboardUrl = page.url();
  await startupCall(() => assertCanvasFocus(page, "physical-keyboard-before", keyboardUrl));
  const nonce = randomBytes(8).toString("hex");
  const guestFile = `/tmp/desktop-keys-${randomBytes(8).toString("hex")}`;
  assert.equal(guestFile.includes(nonce), false, "nonce and read-only lookup filename must be independent");
  const beforeInput = await startupCall(() => runtimeDiagnostics(page, "physical-keyboard-before"));
  if (inputTrial) {
    assertInputTrialRuntime(beforeInput, trial);
    remainingTrialMs(coldDeadline);
    report.startup.readyProvenAt = new Date().toISOString();
    report.startup.elapsedMs = Date.now() - Date.parse(report.startup.startedAt);
    report.trial.presentationBaseline = beforeInput.presentation;
    coldDeadline = null;
  }
  report.keyboard = { verified: false, nonce, guestFile, startedAt: new Date().toISOString() };
  const typingDeadline = inputTrial ? Date.now() + trial.typingMs : null;
  const typingCall = operation => inputTrial ? withinTrialDeadline(operation, typingDeadline, "physical typing") : operation();
  for (const character of `printf '${nonce}' > ${guestFile}`) {
    const { code, shift } = physicalStroke(character);
    if (shift) await typingCall(() => page.keyboard.down("ShiftLeft"));
    await typingCall(() => page.keyboard.press(code, { delay: 40 }));
    if (shift) await typingCall(() => page.keyboard.up("ShiftLeft"));
    await typingCall(() => assertCanvasFocus(page, `physical-keyboard-after-${character}`, keyboardUrl));
  }
  await typingCall(() => page.keyboard.press("Enter"));
  report.keyboard.enteredAtMs = Date.now();
  report.keyboard.typedAt = new Date().toISOString();
  report.keyboard.typingMs = report.keyboard.enteredAtMs - Date.parse(report.keyboard.startedAt);
  if (inputTrial) Object.assign(report.keyboard, { readbackStartedAt: report.keyboard.typedAt,
    readbackTimeoutMs: trial.readbackMs, deadlineMs: trial.readbackMs,
    deadlineAt: new Date(report.keyboard.enteredAtMs + trial.readbackMs).toISOString() });
  try {
    report.keyboard.stage = "post-enter-focus";
    if (inputTrial) await withinTrialDeadline(() => assertCanvasFocus(page, "physical-keyboard-after-enter", keyboardUrl),
      report.keyboard.enteredAtMs + trial.readbackMs, "post-enter focus/readback");
    else await assertCanvasFocus(page, "physical-keyboard-after-enter", keyboardUrl);
    report.keyboard.stage = "readback";
    await readGuestFileEventually(page, guestFile, nonce, "physical keyboard",
      mode === "capture" ? prewarmTimeoutMs : 120000, report.keyboard);
    report.keyboard.verified = true;
    report.keyboard.completedAt = new Date().toISOString();
  } catch (error) {
    report.keyboard.failedAt = new Date().toISOString();
    report.keyboard.error = String(error);
    throw error;
  } finally {
    if (!inputTrial) await runtimeDiagnostics(page, "physical-keyboard-after-readback");
  }
  if (inputTrial) {
    const captureDeadline = trialCaptureDeadline = Date.now() + trial.captureMs;
    const after = await withinTrialDeadline(() => waitForFreshPresentation(
      () => page.evaluate(() => window.__presentation?.state?.()), beforeInput.presentation,
      remainingTrialMs(captureDeadline), "input-trial fresh presentation"), captureDeadline, "input-trial capture");
    report.trial.presentationAfter = after;
    await withinTrialDeadline(() => screenshot("desktop-keyboard.png", page, remainingTrialMs(captureDeadline)),
      captureDeadline, "input-trial capture");
    report.trial.runtimeAfter = await withinTrialDeadline(() => runtimeDiagnostics(page, "physical-keyboard-after-readback"),
      captureDeadline, "input-trial capture");
    assertInputTrialRuntime(report.trial.runtimeAfter, trial);
    assert.deepEqual(report.errors, []);
    report.result = "input-trial-physical-nonce-and-fresh-presentation";
    return;
  }
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
    await collectWireEvidence(page, "before-reload");
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
}
try {
  await runLive();
} catch (error) {
  coldDeadline = null;
  report.result = "failed"; report.error = error.stack || String(error); process.exitCode = 1;
  if (coldPair) report.classification = "UNPROVEN";
  if (inputTrial) {
    const failureDeadline = trialCaptureDeadline ??= Date.now() + trial.captureMs;
    report.classification = "UNPROVEN";
    report.trial.outcome = !report.keyboard ? "startup-failed-input-not-tested"
      : !report.keyboard.typedAt ? "typing-failed-input-sequence-incomplete"
      : report.keyboard.verified ? "nonce-passed-presentation-unproven" : "nonce-readback-failed";
    if (failureCheckpoint && report.trial.outcome === "nonce-readback-failed") {
      try { await pauseFailedInput(failurePage, report); }
      catch (captureError) { report.failureCheckpointError = String(captureError); }
    }
    try {
      await withinTrialDeadline(() => Promise.all([
        screenshot("failure.png", failurePage, remainingTrialMs(failureDeadline)),
        runtimeDiagnostics(failurePage, "input-trial-failure"),
      ]), failureDeadline, "failure capture");
    } catch (captureError) { report.failureCaptureError = String(captureError); }
    if (failureCheckpoint && report.failureCheckpoint?.paused) {
      try { await exportFailedInput(failurePage, browser, out, report); }
      catch (captureError) { report.failureCheckpointError = String(captureError); }
    }
  } else try { await screenshot("failure.png", failurePage); } catch {}
  console.error(report.error);
} finally {
  if (inputTrial) {
    // Every browser object here belongs to this single trial. No shared/user browser is killed.
    const cleanupDeadline = Date.now() + trial.cleanupMs;
    report.cleanup = { startedAt: new Date().toISOString(), timeoutMs: trial.cleanupMs, closed: false };
    try {
      await withinTrialDeadline(async () => {
        await collectWireEvidence(page, "final");
        const evidence = await page.evaluate(() => window.__omarchyLiveEvidence);
        report.events = evidence?.events ?? [];
        // Observation only, from the same page clock; no extra pre-input RPC or typing delay.
        if (report.keyboard) {
          const ready = report.events.find(event => event.type === "wvm:desktop-ready");
          const firstKey = report.inputEvents.find(event => event.context === pageLabels.get(page)
            && event.epoch === "final" && event.type === "keydown" && event.trusted === true);
          if (Number.isFinite(ready?.ms) && Number.isFinite(firstKey?.ms)) {
            report.keyboard.desktopReadyPageMs = ready.ms;
            report.keyboard.firstPhysicalKeydownPageMs = firstKey.ms;
            report.keyboard.readyToFirstPhysicalKeydownMs = firstKey.ms - ready.ms;
          }
        }
        await fs.writeFile(path.join(out, "serial.log"), evidence?.serial ?? "");
      }, Math.min(cleanupDeadline, Date.now() + 10000), "cleanup evidence");
    } catch (error) {
      report.errors.push(`wire evidence: ${error}`); report.result = "failed"; process.exitCode = 1;
    }
    // Preserve a receipt even if browser shutdown subsequently stalls.
    await fs.writeFile(path.join(out, "report.json"), JSON.stringify(report, null, 2) + "\n");
    // Disconnect the recorder's Playwright client as well as closing the owned
    // browser server; debugger sessions must not retain its websocket transport.
    if (failureCheckpoint) {
      try {
        await withinTrialDeadline(() => browser.close(), Math.min(cleanupDeadline, Date.now() + 5000), "browser client close");
        report.cleanup.clientClosed = true;
      } catch (error) { report.cleanup.clientCloseError = String(error); }
    }
    try {
      await withinTrialDeadline(() => browserServer.close(), Math.min(cleanupDeadline, Date.now() + 10000), "browser close");
      report.cleanup.closed = true;
    } catch (error) {
      report.cleanup.closeError = String(error);
      try {
        await withinTrialDeadline(() => browserServer.kill(), cleanupDeadline, "owned browser kill");
        report.cleanup.closed = true; report.cleanup.forceKilled = true;
      } catch (killError) { report.cleanup.killError = String(killError); }
    }
    ownedServer?.closeAllConnections();
    if (ownedServer) ownedServer.close();
    if (!report.cleanup.closed) { report.result = "failed"; process.exitCode = 1; }
    report.finishedAt = new Date().toISOString();
    await fs.writeFile(path.join(out, "report.json"), JSON.stringify(report, null, 2) + "\n");
  } else {
  try { await collectWireEvidence(page, "final"); } catch (error) {
    report.errors.push(`wire evidence: ${error}`); report.result = "failed"; process.exitCode = 1;
  }
  if (secondPage) {
    try { await collectWireEvidence(secondPage, "final"); } catch (error) {
      report.errors.push(`second-tab wire evidence: ${error}`); report.result = "failed"; process.exitCode = 1;
    }
  }
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
}
