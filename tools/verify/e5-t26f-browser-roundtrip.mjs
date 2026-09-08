#!/usr/bin/env node

// E5-T26f: Chromium-only browser proof for the composed desktop snapshot save/reload/restore
// boundary. WebKit and independent machines are intentionally outside this slice.
// Optional inner loop (NEVER acceptance): E5_T26F_DIAGNOSTIC=create|reuse,
// E5_T26F_DIAGNOSTIC_PROFILE=/absolute/empty/scratch, E5_T26F_DIAGNOSTIC_PORT=PORT.
// create stops at the normal snapshot; reuse copies that closed profile into a new retained
// iteration directory and runs the real normal restore/interaction/audit, without cold setup.
// Reuse alone permits E5_T26F_DIAGNOSTIC_COMMAND, physically typed and recorded verbatim.
// E5_T26F_DIAGNOSTIC_LATENCY=1 (reuse only) records bounded, read-only interaction timing.
// E5_T26F_DIAGNOSTIC_JIT=0|1 (reuse only) compares the existing unprofiled desktop JIT routes.
// E5_T26F_DIAGNOSTIC_RESIDENCY (reuse + explicit JIT=1 only) selects an existing module cap.
// E5_T26F_DIAGNOSTIC_CPU=1 (reuse only) records the owned worker using the shared CDP profiler.
// E5_T26F_DIAGNOSTIC_COMPLETE=1 (reuse only) retains later functional evidence, then rethrows a failed timing cap.
// E5_T26F_FIXTURE=resident-aplay-v1 binds a separate image containing a real prepared
// player; physically typed play feeds/waits it after the gesture, without runtime tuning.

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFile as execFileCallback, spawn } from "node:child_process";
import { createServer } from "node:net";
import { mkdir, mkdtemp, readFile, readdir, lstat, stat, writeFile, access, cp } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { attachWorkerProfiler } from "./e5-t22c-cpu-profile.mjs";
import { assertWindowMoved } from "../../web/bench/desktop-perf.js";
import { residentFixtureRequested, assertResidentImage, parsePreparedSound, assertFreshLockedPcm,
  RESIDENT_GUEST_PATH } from "./e5-t26f-resident-proof.mjs";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const web = path.join(repo, "web");
const out = path.resolve(process.env.E5_T26F_OUT || path.join(repo, "evidence/e5-t26f"));
const assetRoot = path.resolve(
  process.env.E5_T26F_DESKTOP_ASSET_DIR || path.join(repo, "target/e5-t18b/chunks/desktop-v6"),
);
const imagePath = path.resolve(
  process.env.E5_T26F_IMAGE || path.join(repo, "target/e5-t18b/desktop-image-v6/alpine-rootfs.ext4"),
);
const imageInfoPath = path.resolve(
  process.env.E5_T26F_IMAGE_INFO || path.join(repo, "target/e5-t18b/desktop-image-v6/desktop-info.json"),
);
const timeoutMs = Number(process.env.E5_T26F_TIMEOUT_MS || 900_000);
const chromePath = process.env.E5_T26F_CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const execFile = promisify(execFileCallback);
const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const SHA256 = /^[0-9a-f]{64}$/u;
const jsonReplacer = (_key, value) => typeof value === "bigint" ? `${value}n` : value;

function diagnosticOptions(env) {
  const mode = env.E5_T26F_DIAGNOSTIC;
  const complete = env.E5_T26F_DIAGNOSTIC_COMPLETE;
  if (complete !== undefined) {
    assert.equal(mode, "reuse", "diagnostic completion requires reuse mode");
    assert.equal(complete, "1", "diagnostic completion flag must be exactly 1");
    for (const key of ["E5_T26F_DIAGNOSTIC_JIT", "E5_T26F_DIAGNOSTIC_RESIDENCY",
      "E5_T26F_DIAGNOSTIC_GUEST_CLOCK", "E5_T26F_DIAGNOSTIC_CPU",
      "E5_T26F_DIAGNOSTIC_LATENCY", "E5_T26F_DIAGNOSTIC_COMMAND", "E5_T26F_DIAGNOSTIC_ICOUNT_DIVIDER"]) {
      assert.equal(env[key], undefined, "diagnostic completion requires unchanged unprofiled policies and command");
    }
  }
  const icountDivider = env.E5_T26F_DIAGNOSTIC_ICOUNT_DIVIDER;
  if (icountDivider !== undefined) {
    assert.equal(mode, "reuse", "diagnostic ICount divider requires reuse mode");
    assert.ok(icountDivider === "1" || icountDivider === "10", "diagnostic ICount divider must be exactly 1 or 10");
    for (const key of ["E5_T26F_DIAGNOSTIC_GUEST_CLOCK", "E5_T26F_DIAGNOSTIC_JIT",
      "E5_T26F_DIAGNOSTIC_RESIDENCY", "E5_T26F_DIAGNOSTIC_CPU", "E5_T26F_DIAGNOSTIC_LATENCY",
      "E5_T26F_DIAGNOSTIC_COMMAND"]) {
      assert.equal(env[key], undefined, "ICount divider comparison requires unchanged unprofiled policies and command");
    }
  }
  const jit = env.E5_T26F_DIAGNOSTIC_JIT;
  const residency = env.E5_T26F_DIAGNOSTIC_RESIDENCY;
  if (residency !== undefined) {
    assert.equal(mode, "reuse", "diagnostic residency comparison requires reuse mode");
    assert.ok(["repack-off", "cap-256", "cap-1024"].includes(residency),
      "diagnostic residency must be exactly repack-off, cap-256, or cap-1024");
    assert.equal(jit, "1", "diagnostic residency requires explicit JIT=1");
  }
  if (jit !== undefined) {
    assert.equal(mode, "reuse", "diagnostic JIT comparison requires reuse mode");
    assert.ok(jit === "0" || jit === "1", "diagnostic JIT flag must be exactly 0 or 1");
    for (const key of ["E5_T26F_DIAGNOSTIC_CPU", "E5_T26F_DIAGNOSTIC_LATENCY", "E5_T26F_DIAGNOSTIC_COMMAND"]) {
      assert.equal(env[key], undefined, "JIT comparison must be unprofiled with the unchanged command");
    }
  }
  const guestClock = env.E5_T26F_DIAGNOSTIC_GUEST_CLOCK;
  if (guestClock !== undefined) {
    assert.equal(mode, "reuse", "diagnostic guest clock comparison requires reuse mode");
    assert.ok(guestClock === "icount" || guestClock === "wall", "diagnostic guest clock must be icount or wall");
    for (const key of ["E5_T26F_DIAGNOSTIC_CPU", "E5_T26F_DIAGNOSTIC_LATENCY", "E5_T26F_DIAGNOSTIC_COMMAND"]) {
      assert.equal(env[key], undefined, "guest clock comparison must be unprofiled with the unchanged command");
    }
  }
  const cpu = env.E5_T26F_DIAGNOSTIC_CPU;
  if (cpu !== undefined) {
    assert.equal(mode, "reuse", "diagnostic CPU profiling requires reuse mode");
    assert.equal(cpu, "1", "diagnostic CPU flag must be exactly 1");
  }
  const latency = env.E5_T26F_DIAGNOSTIC_LATENCY;
  if (latency !== undefined) {
    assert.equal(mode, "reuse", "diagnostic latency requires reuse mode");
    assert.equal(latency, "1", "diagnostic latency flag must be exactly 1");
  }
  const delay = env.E5_T26F_DIAGNOSTIC_KEY_DELAY_MS;
  if (delay !== undefined) {
    assert.equal(mode, "reuse", "diagnostic key delay requires reuse mode");
    assert.ok(/^(?:[0-9]|1[0-9]|2[0-5])$/u.test(delay), "diagnostic key delay must be an integer from 0 to 25 ms");
  }
  const command = env.E5_T26F_DIAGNOSTIC_COMMAND;
  if (command !== undefined) {
    assert.equal(mode, "reuse", "diagnostic command override requires reuse mode");
    // At most four physical transitions per character plus Enter: below the 256-event budget.
    assert.ok(/^[\x20-\x7e]{1,63}$/u.test(command), "diagnostic command must be 1-63 printable ASCII characters");
  }
  const directory = env.E5_T26F_DIAGNOSTIC_PROFILE;
  const port = Number(env.E5_T26F_DIAGNOSTIC_PORT);
  if (!mode && !directory && !env.E5_T26F_DIAGNOSTIC_PORT) return null;
  assert.ok(mode === "create" || mode === "reuse", "diagnostic mode must explicitly be create or reuse");
  assert.ok(directory && path.isAbsolute(directory) && path.resolve(directory) === directory &&
    directory !== path.parse(directory).root, "diagnostic profile requires an absolute normalized scratch directory");
  assert.ok(Number.isSafeInteger(port) && port >= 1024 && port <= 65535, "diagnostic mode requires a stable explicit server port");
  return { mode, directory, port, origin: `http://127.0.0.1:${port}`, command: command ?? null,
    keyDelayMs: Number(delay ?? 0), latency: latency === "1", cpu: cpu === "1", guestClock: guestClock ?? null,
    jit: jit ?? null, residency: residency ?? null, complete: complete === "1",
    icountDivider: icountDivider === undefined ? null : Number(icountDivider) };
}

const diagnostic = diagnosticOptions(process.env);
const residentFixture = residentFixtureRequested(process.env);
const postRestoreCommand = residentFixture ? diagnostic?.command ?? "play" : diagnostic?.command ?? "sh /tmp/a";
// Admitted reuse-only accounting probes need reliable physical input, not acceptance speed.
const postRestoreKeyDelayMs = residentFixture ? (diagnostic?.command ? 100 : 5) : diagnostic?.keyDelayMs ?? 0;
const DIAGNOSTIC_OWNER = "wasm-vm.e5-t26f.diagnostic-profile.v1";
const DESKTOP_STORAGE_KEY = "wasm-vm.desktop-snapshot.v1";

async function treeDigest(directory, include = () => true) {
  const entries = [];
  async function visit(relative) {
    for (const name of (await readdir(path.join(directory, relative))).sort()) {
      const next = path.join(relative, name);
      if (!include(next)) continue;
      const file = path.join(directory, next);
      const info = await lstat(file);
      assert.ok(!info.isSymbolicLink(), `checkpoint binding refuses symlink: ${file}`);
      if (info.isDirectory()) await visit(next);
      else {
        assert.ok(info.isFile(), `checkpoint binding requires a regular file: ${file}`);
        entries.push([next, info.size, await sha256File(file)]);
      }
    }
  }
  await visit("");
  assert.ok(entries.length, `checkpoint binding is empty: ${directory}`);
  return sha256(JSON.stringify(entries));
}

async function diagnosticBinding(options, fixture = null) {
  // serve-dev serves web/, not web/dist. Bind all top-level runtime assets and the nested
  // source/wasm modules, including uncommitted bytes; HEAD alone cannot identify a frozen build.
  const runtimeSha256 = await treeDigest(web, (relative) =>
    ["src", "pkg", "bench"].includes(relative.split(path.sep)[0]) ||
    (!relative.includes(path.sep) && /\.(?:js|mjs|html|css|json)$/u.test(relative)));
  const kernel = JSON.parse(await readFile(path.join(web, "artifacts-alpine.json"), "utf8")).artifacts.kernel;
  const kernelUrl = new URL(kernel.url, `${options.origin}/desktop-cursor.html`);
  assert.equal(kernelUrl.origin, options.origin, "diagnostic kernel must use the local server");
  // Match serve-dev.sh: /releases/* maps to repo/releases; all other local paths map to web/.
  const servedRoot = kernelUrl.pathname.startsWith("/releases/") ? repo : web;
  const kernelPath = path.resolve(servedRoot, `.${kernelUrl.pathname}`);
  assert.ok(kernelPath.startsWith(`${servedRoot}${path.sep}`), "kernel must be local to the frozen repository");
  const kernelSha256 = await sha256File(kernelPath);
  assert.equal(kernelSha256, kernel.sha256, "diagnostic kernel digest");
  return { head, runtimeSha256, kernelSha256, imageSha256, imageBytes: imageStat.size,
    manifestSha256, origin: options.origin, ...(fixture ? { fixture } : {}) };
}

function validateCheckpoint(checkpoint) {
  assert.equal(checkpoint?.schema, DIAGNOSTIC_OWNER, "not a T26f diagnostic checkpoint");
  assert.match(checkpoint.profileSha256, SHA256, "closed profile digest missing");
  assert.equal(checkpoint.session?.key, DESKTOP_STORAGE_KEY, "desktop session key differs");
  const envelope = JSON.parse(checkpoint.session.value);
  assert.equal(envelope.schema, "wasm-vm.e5-t26f.desktop-snapshot.v1");
  assert.equal(typeof envelope.bytes, "string", "checkpoint lacks the actual desktop envelope");
  const bytes = Buffer.from(envelope.bytes, "base64");
  assert.equal(sha256(bytes), envelope.sha256, "checkpoint envelope digest differs");
  assert.equal(bytes.length, envelope.byteLength, "checkpoint envelope length differs");
  const snapshot = checkpoint.normalSnapshot;
  for (const key of ["sha256", "byteLength", "preFrontBufferCrc", "machineResume"]) {
    assert.deepEqual(envelope[key], snapshot?.[key], `checkpoint normalSnapshot ${key} differs`);
  }
  assert.match(snapshot.preFrontBufferCrc, /^[0-9a-f]{8}$/u);
  assert.equal(snapshot.machineResume?.persisted, true, "checkpoint lacks persisted machine resume");
  assert.equal(snapshot.machineResume?.paused, true, "checkpoint lacks paused machine resume");
  assert.ok(Number.isSafeInteger(snapshot.machineResume.overlayGeneration), "checkpoint lacks overlay generation");
}

async function prepareDiagnostic(options, binding) {
  const marker = path.join(options.directory, "e5-t26f-owner.json");
  const checkpointFile = path.join(options.directory, "normal-checkpoint.json");
  if (options.mode === "create") await mkdir(options.directory, { recursive: true });
  const info = await lstat(options.directory);
  assert.ok(info.isDirectory() && !info.isSymbolicLink(), "diagnostic scratch must be a real directory");
  const seed = path.join(options.directory, "checkpoint-profile");
  if (options.mode === "create") {
    assert.equal((await readdir(options.directory)).length, 0, "refusing to overwrite a nonempty profile; choose new empty scratch");
    await writeFile(marker, JSON.stringify({ schema: DIAGNOSTIC_OWNER, binding }), { flag: "wx" });
    await mkdir(seed);
    return { seed, profile: seed, checkpointFile, checkpoint: null, creatorHead: binding.head };
  }
  assert.ok((await lstat(marker)).isFile() && !(await lstat(marker)).isSymbolicLink(), "task-owned marker must be a regular file");
  const owner = JSON.parse(await readFile(marker, "utf8"));
  assert.equal(owner.schema, DIAGNOSTIC_OWNER, "profile is not owned by E5-T26f diagnostics");
  const { head: creatorHead, ...frozenRuntime } = owner.binding;
  const { head: currentHead, ...currentRuntime } = binding;
  assert.match(creatorHead, /^[0-9a-f]{40}$/u, "checkpoint creator HEAD missing");
  assert.match(currentHead, /^[0-9a-f]{40}$/u, "current HEAD missing");
  // Harness/evidence-only commits may differ. Actual served runtime/image bytes may not.
  assert.deepEqual(frozenRuntime, currentRuntime, "checkpoint runtime/image/origin binding differs; create new scratch");
  assert.ok((await lstat(checkpointFile)).isFile() && !(await lstat(checkpointFile)).isSymbolicLink(), "checkpoint must be a regular file");
  const checkpoint = JSON.parse(await readFile(checkpointFile, "utf8"));
  validateCheckpoint(checkpoint);
  assert.ok((await lstat(seed)).isDirectory() && !(await lstat(seed)).isSymbolicLink(), "checkpoint profile must be a real directory");
  assert.equal(await treeDigest(seed), checkpoint.profileSha256, "closed checkpoint profile changed");
  // Never launch the sealed baseline again: guest writes can invalidate its overlay generation.
  // Retain each iteration, even on failure; do not delete or overwrite caller data.
  const iteration = await mkdtemp(path.join(options.directory, "iteration-"));
  const profile = path.join(iteration, "profile");
  await cp(seed, profile, { recursive: true, force: false, errorOnExist: true });
  assert.equal(await treeDigest(profile), checkpoint.profileSha256, "checkpoint profile copy differs");
  return { seed, profile, checkpointFile, checkpoint, creatorHead };
}

async function installCheckpointSession(targetPage, checkpoint, origin) {
  // Hydrate once without loading the guest. A persistent init script would replay the
  // original envelope on later reloads, conflicting with legitimate moving snapshots.
  const bootstrapUrl = new URL("/__e5t26f-checkpoint-bootstrap.html", origin).href;
  const serveBootstrap = (route) => route.fulfill({
    status: 200, contentType: "text/html",
    headers: { "cache-control": "no-store", "content-security-policy": "default-src 'none'" },
    body: "<!doctype html><title>E5-T26f checkpoint bootstrap</title>",
  });
  await targetPage.route(bootstrapUrl, serveBootstrap);
  try {
    await targetPage.goto(bootstrapUrl, { waitUntil: "domcontentloaded", timeout: 30_000 });
    await targetPage.evaluate(({ session, origin: expectedOrigin }) => {
      if (location.origin !== expectedOrigin) throw new Error("checkpoint bootstrap origin differs");
      const current = sessionStorage.getItem(session.key);
      if (current !== null && current !== session.value) throw new Error("refusing to overwrite a different desktop session");
      sessionStorage.setItem(session.key, session.value);
    }, { session: checkpoint.session, origin });
  } finally {
    await targetPage.unroute(bootstrapUrl, serveBootstrap);
  }
}

async function readBrowserIdentity(browser, context, page, headless) {
  if (browser) return { name: browser.browserType().name(), version: browser.version(), headless };
  // This repo's pinned Playwright returns null from persistentContext.browser(). Use public CDP
  // only for the diagnostic browser identity, before navigation and the timed interaction.
  const session = await context.newCDPSession(page);
  try {
    const version = await session.send("Browser.getVersion");
    return { name: "chromium", version: version.product, headless };
  } finally {
    await session.detach();
  }
}

async function requireEmptyCompletionOutput(directory) {
  await mkdir(directory, { recursive: true });
  assert.equal((await readdir(directory)).length, 0,
    "diagnostic completion refuses nonempty output directory; use a fresh run subdirectory");
}

assert.ok(Number.isSafeInteger(timeoutMs) && timeoutMs >= 120_000, "timeout must be at least two minutes");
// Outside the failure-capture try: refusal must not write into a protected prior run.
if (diagnostic?.complete || residentFixture) await requireEmptyCompletionOutput(out);

async function freePort() {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const port = probe.address().port;
      probe.close((error) => error ? reject(error) : resolve(port));
    });
  });
}

async function requireFreePort(port) {
  const probe = createServer();
  await new Promise((resolve, reject) => {
    probe.once("error", reject);
    probe.listen(port, "127.0.0.1", resolve);
  });
  await new Promise((resolve, reject) => probe.close((error) => error ? reject(error) : resolve()));
}

async function waitFor(predicate, label, limit = timeoutMs) {
  const deadline = Date.now() + limit;
  while (Date.now() < deadline) {
    const value = await predicate();
    if (value) return value;
    await sleep(250);
  }
  throw new Error(`bounded wait expired: ${label}`);
}

async function sha256File(file) {
  const { createReadStream } = await import("node:fs");
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(file);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.once("error", reject);
    stream.once("end", () => resolve(hash.digest("hex")));
  });
}

async function sourceDistParity() {
  const files = [
    "desktop-terminal.js",
    "desktop-agent-bridge.js",
    "desktop-restore.js",
    "main.js",
    "loader.js",
    "guest-clock.js",
    "linux-worker-host.js",
    "linux-worker-protocol.js",
    "linux-worker.js",
    "roadmap.js",
  ];
  const result = [];
  for (const relative of files) {
    const source = await readFile(path.join(web, relative));
    const dist = await readFile(path.join(web, "dist", relative));
    assert.deepEqual(dist, source, `web/dist/${relative} is stale`);
    result.push({ relative, sha256: sha256(source), equal: true });
  }
  return result;
}

const manifestPath = path.join(assetRoot, "manifest.json");
const manifestBytes = await readFile(manifestPath);
const manifest = JSON.parse(manifestBytes.toString("utf8"));
assert.equal(manifest.layout, "split", "desktop image is not split/chunked");
assert.ok(Array.isArray(manifest.chunks) && manifest.chunks.length > 0, "desktop chunks are missing");
assert.ok(manifest.chunks.every((hash) => SHA256.test(hash)), "desktop chunk manifest has malformed hashes");
const manifestSha256 = sha256(manifestBytes);
const imageInfo = JSON.parse(await readFile(imageInfoPath, "utf8"));
const imageStat = await stat(imagePath);
const imageSha256 = await sha256File(imagePath);
assert.equal(imageSha256, process.env.E5_T26F_IMAGE_SHA256 || imageInfo.image?.sha256, "desktop image digest");
assert.equal(imageStat.size, imageInfo.image?.size, "desktop image size");
const fixtureBinding = residentFixture ? assertResidentImage(imageInfo,
  await sha256File(path.join(repo, "tools/guest/e5-t26f-resident-aplay.sh"))) : null;

const { stdout: headOutput } = await execFile("git", ["rev-parse", "--verify", "HEAD"], { cwd: repo });
const head = headOutput.trim();
assert.match(head, /^[0-9a-f]{40}$/u, "runner must record an exact Git head");
if (process.env.E5_T26F_REQUIRE_HEAD) assert.equal(head, process.env.E5_T26F_REQUIRE_HEAD);

const serverEnv = { ...process.env, E5_T18B_DESKTOP_ASSET_DIR: assetRoot };
for (const key of Object.keys(serverEnv)) {
  if (key === "RUSTFLAGS" || key === "RUST_LOG" || key.startsWith("CARGO_")) delete serverEnv[key];
}

let server = null;
let browser = null;
let context = null;
let page = null;
let serverOutput = "";
const browserErrors = [];
const httpErrors = [];
const startedAt = Date.now();
const milestones = {
  run: { kind: diagnostic ? "diagnostic-iteration" : "acceptance", acceptance: !diagnostic,
    diagnostic, postRestoreCommand, postRestoreKeyDelayMs, ...(fixtureBinding ? { fixture: fixtureBinding } : {}) },
};

let lastPhase = null;
let cpuProfiler = null;
let reportedCompletionTimingFailure = null;

function recordCompletionConsole(type, text) {
  if (!diagnostic?.complete) return;
  const entries = milestones.completionConsole ??= [];
  if (entries.length < 32) entries.push({
    timestamp: new Date().toISOString(), phase: lastPhase?.phase ?? null,
    type, text: String(text).slice(0, 1_000),
  });
}

async function recordCompletionGeneration(key, snapshot) {
  if (!diagnostic?.complete) return;
  const entry = milestones[key] ??= {};
  if (snapshot) entry.machineResume = snapshot.machineResume;
  entry.generationObservation = { status: "pending" };
  try {
    entry.generationObservation = await page.evaluate(async () => {
      const requestedAt = performance.now();
      const controller = window.__desktopController;
      if (typeof controller?.snapshotGeneration !== "function") {
        return { requestedAt, observedAt: performance.now(), status: "unavailable" };
      }
      const snapshotGeneration = await controller.snapshotGeneration();
      return { requestedAt, observedAt: performance.now(), status: "observed", snapshotGeneration };
    });
  } catch (error) {
    entry.generationObservation = { status: "error", error: String(error).slice(0, 1_000) };
    throw error;
  }
}

function readTopmostDragTitlebar() {
  // The F fixture has two diagonally overlapping Foot windows. Across their full
  // height, a dark-body bounding box merges their edges. Use only the first 32
  // contiguous body rows, above the second window, and reject ambiguous edges.
  const canvas = document.getElementById("desktop-canvas");
  const width = canvas.width, height = canvas.height;
  const data = canvas.getContext("2d").getImageData(0, 0, width, height).data;
  const rows = [];
  for (let y = 32; y < height && rows.length < 32; y += 1) {
    let dark = 0, left = width, right = -1;
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * 4;
      if (data[i] < 65 && data[i + 1] < 65 && data[i + 2] < 65) {
        dark += 1; left = Math.min(left, x); right = x + 1;
      }
    }
    if (dark >= 240) rows.push({ y, left, right });
    else rows.length = 0;
  }
  const edge = key => {
    const counts = new Map();
    for (const row of rows) counts.set(row[key], (counts.get(row[key]) ?? 0) + 1);
    const [value, count] = [...counts].sort((a, b) => b[1] - a[1])[0] ?? [null, 0];
    return count >= 24 ? value : null;
  };
  const left = edge("left"), right = edge("right");
  return { at: performance.now(), titlebar: rows.length === 32 && left !== null && right !== null && right - left >= 240
    ? { left, right, top: Math.max(0, rows[0].y - 26), bottom: rows[0].y } : null };
}

function observedDragTranslation(before, after) {
  // Match the same titlebar height/row, permitting the pinned desktop's 32px panel
  // clamp when a previously obscured window is dragged. Never accept an arbitrary
  // vertical jump to another window. The requested horizontal movement is 80px.
  if (![before?.top, before?.bottom, after?.top, after?.bottom].every(Number.isFinite) ||
      Math.abs((after.bottom - after.top) - (before.bottom - before.top)) > 1 ||
      (Math.abs(after.top - before.top) > 1 && Math.abs(after.top - Math.max(32, before.top)) > 1)) return null;
  try {
    const translation = assertWindowMoved(before, after, { direction: 1, minimumPx: 64 });
    return translation.deltaX <= 96 ? translation : null;
  } catch { return null; }
}

async function proveAndPauseDrag(before) {
  phaseProgress("drag:guest-translation");
  const evidence = milestones.dragMovement = { before, status: "waiting" };
  await waitFor(async () => {
    evidence.observed = await page.evaluate(readTopmostDragTitlebar);
    evidence.translation = observedDragTranslation(before, evidence.observed.titlebar);
    return evidence.translation;
  }, "guest window did not complete the requested 80px drag", 15_000);
  evidence.paused = await page.evaluate(async () => {
    const controller = window.__desktopController;
    await controller.pause();
    return { at: performance.now(), isPaused: await controller.isPaused() };
  });
  evidence.paused.titlebar = (await page.evaluate(readTopmostDragTitlebar)).titlebar;
  assert.equal(evidence.paused.isPaused, true, "moving checkpoint must leave the guest paused");
  evidence.pausedTranslation = observedDragTranslation(before, evidence.paused.titlebar);
  assert.ok(evidence.pausedTranslation, "paused guest window no longer matches the requested drag");
  evidence.status = "passed";
  phaseProgress("drag:guest-translation", "done");
}

async function auditFrozenDragSnapshot(snapshot, label) {
  return auditFrozenSnapshot(snapshot, label, "drag");
}

function readRestoredHoverState(point) {
  const state = window.__desktopTerminal.state();
  const pointer = window.__desktopTerminal.pointerState();
  return {
    at: performance.now(), pointerFrames: state.pointerFrames,
    heldButtons: pointer.heldButtons,
    frame: [...state.pointerFrameSample].reverse().find(entry =>
      entry.device === "tablet" && entry.source === "pointermove" && entry.coordinates) ?? null,
    rendered: window.__desktopCursor?.renderedCursor?.(point) ?? null,
  };
}

function assertStationaryTitlebar(before, after) {
  for (const key of ["left", "right", "top", "bottom"]) {
    assert.ok(Number.isFinite(before?.[key]) && Number.isFinite(after?.[key]),
      `restored hover lacks an unambiguous titlebar ${key}`);
    assert.ok(Math.abs(after[key] - before[key]) <= 1,
      `restored guest window moved during hover: ${key} ${before[key]} -> ${after[key]}`);
  }
}

async function proveRestoredGuestRelease() {
  phaseProgress("restore:drag:guest-release");
  const evidence = milestones.dragGuestRelease = { status: "running", samples: [] };
  try {
    evidence.before = await page.evaluate(readTopmostDragTitlebar);
    // Bind this observation to the actual window saved mid-drag, not a different client.
    assertStationaryTitlebar(milestones.dragMovement.paused.titlebar, evidence.before.titlebar);
    const point = evidence.point = {
      x: evidence.before.titlebar.left + 32, y: evidence.before.titlebar.bottom - 3,
    };
    assert.ok(point.y >= 32 && Math.abs(point.x - milestones.dragMapping.guestEnd.x) >= 32,
      "restored hover must move visibly over the saved titlebar");
    evidence.initial = await page.evaluate(readRestoredHoverState, point);
    assert.deepEqual(evidence.initial.heldButtons, [], "hover began with a host button held");
    assert.ok(Number.isSafeInteger(evidence.initial.pointerFrames), "hover lacks a pointer-frame baseline");
    assert.ok(Number.isFinite(evidence.initial.at), "hover lacks an observation timestamp");
    const client = evidence.client = guestPoint(await desktopBox(), point.x, point.y);
    // Deliberately no down/up or release injection: the guest must consume its saved release.
    await page.mouse.move(client.x, client.y);
    let acknowledgedAt = null;
    await waitFor(async () => {
      assert.ok(evidence.samples.length < 64, "restored hover exceeded its sample bound");
      const sample = await page.evaluate(readRestoredHoverState, point);
      sample.titlebar = (await page.evaluate(readTopmostDragTitlebar)).titlebar;
      const previousAt = evidence.samples.at(-1)?.at ?? evidence.initial.at;
      evidence.samples.push(sample);
      assert.ok(Number.isFinite(sample.at) && sample.at >= previousAt,
        "restored hover timestamp is invalid or regressed");
      assert.deepEqual(sample.heldButtons, [], "hover injected or retained a host button");
      assertStationaryTitlebar(evidence.before.titlebar, sample.titlebar);
      const matchesFrame = sample.pointerFrames > evidence.initial.pointerFrames &&
        Math.abs((sample.frame?.coordinates?.x ?? -Infinity) - Math.round(point.x / 1280 * 32767)) <= 1 &&
        Math.abs((sample.frame?.coordinates?.y ?? -Infinity) - Math.round(point.y / 800 * 32767)) <= 1;
      const matchesGuest = sample.rendered?.x === point.x && sample.rendered?.y === point.y;
      if (!matchesFrame || !matchesGuest) return false;
      if (acknowledgedAt === null) evidence.acknowledgedAt = acknowledgedAt = sample.at;
      // Observe for one bounded second AFTER the guest cursor arrives, so an immediate host
      // ledger update cannot mask a delayed compositor drag. This is outside the original cap.
      if (sample.at - acknowledgedAt < 1_000) return false;
      evidence.observed = sample;
      return true;
    }, "restored guest did not acknowledge a stationary hover", 15_000);
    evidence.status = "passed";
    phaseProgress("restore:drag:guest-release", "done");
  } catch (error) {
    evidence.status = "failed";
    evidence.error = String(error?.message || error);
    throw error;
  }
}

async function auditFrozenSnapshot(snapshot, label, kind) {
  assert.ok(kind === "drag" || kind === "normal", "unknown frozen checkpoint kind");
  const description = kind === "drag" ? "moving" : "normal";
  phaseProgress(`${kind}:checkpoint-${label}`);
  const audit = milestones[`${kind}Checkpoint${label}`] = { status: "running", snapshotSha256: snapshot.sha256 };
  try {
    audit.observed = await page.evaluate(async (key) => {
      const controller = window.__desktopController;
      const isPaused = await controller.isPaused();
      const generation = await controller.snapshotGeneration();
      const decision = await controller.snapshotDecision();
      const record = JSON.parse(sessionStorage.getItem(key));
      return { at: performance.now(), isPaused, generation, decision, envelopeSha256: record?.sha256 ?? null,
        stillPaused: await controller.isPaused(), finalGeneration: await controller.snapshotGeneration() };
    }, DESKTOP_STORAGE_KEY);
    const actual = audit.observed;
    assert.equal(actual.isPaused, true, `published ${description} snapshot guest is not paused`);
    assert.equal(actual.stillPaused, true, `guest resumed during ${description} snapshot audit`);
    assert.ok(Number.isSafeInteger(actual.generation) && actual.generation >= 0, `missing ${description} snapshot generation`);
    assert.equal(actual.generation, snapshot.machineResume?.overlayGeneration, `${description} snapshot disk generation advanced`);
    assert.equal(actual.finalGeneration, actual.generation, `${description} snapshot generation changed during audit`);
    assert.equal(actual.decision, "resume", `${description} whole-machine snapshot is not coherent`);
    assert.equal(actual.envelopeSha256, snapshot.sha256, `stored ${description} desktop envelope changed`);
    audit.status = "passed";
    phaseProgress(`${kind}:checkpoint-${label}`, "done");
  } catch (error) {
    audit.status = "failed";
    audit.error = String(error?.message || error);
    throw error;
  }
}

function retainDeferredInteractionCap(error, postRestoreStart, postRestoreEnd) {
  // Only the dedicated final-cap assertion may be deferred, never an earlier functional error
  // or a malformed clock. Keep the original Error object for the eventual nonzero exit.
  if (diagnostic?.mode !== "reuse" || diagnostic.complete !== true ||
      !(error instanceof assert.AssertionError) || error.code !== "ERR_ASSERTION" ||
      error.message !== "post-restore interaction exceeded 2 seconds" ||
      error.actual !== false || error.expected !== true || error.operator !== "==" ||
      !Number.isFinite(postRestoreStart) || !Number.isFinite(postRestoreEnd) ||
      postRestoreStart < 0 || postRestoreEnd < 0 ||
      postRestoreEnd - postRestoreStart <= 2_000) throw error;
  milestones.deferredInteractionCap = {
    kind: "timing-cap", acceptance: false, capturedAt: new Date().toISOString(),
    postRestoreStart, postRestoreEnd, elapsedMs: postRestoreEnd - postRestoreStart, limitMs: 2_000,
    error: { name: error.name, message: error.message, code: error.code,
      actual: error.actual, expected: error.expected, operator: error.operator,
      stack: String(error.stack || "").slice(0, 8_000) },
  };
  return error;
}

async function finishDiagnosticCompletion(identity, finalState, timingFailure) {
  assert.equal(diagnostic?.mode, "reuse");
  assert.equal(diagnostic.complete, true);
  assert.equal(milestones.normalRestore?.functionalChecksPassed, true);
  assert.equal(milestones.dragRestore?.functionalChecksPassed, true);
  const { postRestoreStart, postRestoreEnd, deferredInteractionCap: retainedCap } = milestones;
  assert.ok(Number.isFinite(postRestoreStart) && Number.isFinite(postRestoreEnd) &&
    postRestoreStart >= 0 && postRestoreEnd >= postRestoreStart, "completion requires valid original timing boundaries");
  assert.equal(postRestoreStart, milestones.normalRestore.result?.completedAt,
    "completion must retain the original restore timestamp");
  const elapsedMs = postRestoreEnd - postRestoreStart;
  const timingPassed = elapsedMs <= 2_000;
  if (timingPassed) {
    assert.equal(timingFailure, null, "successful timing cannot retain a cap failure");
    assert.equal(retainedCap, undefined, "successful timing contradicts a retained cap failure");
  } else {
    assert.ok(timingFailure instanceof assert.AssertionError && timingFailure.code === "ERR_ASSERTION" &&
      timingFailure.message === "post-restore interaction exceeded 2 seconds" &&
      timingFailure.actual === false && timingFailure.expected === true && timingFailure.operator === "==",
    "completion must rethrow the original final cap AssertionError");
    assert.equal(retainedCap?.kind, "timing-cap", "missing retained timing failure");
    assert.equal(retainedCap.acceptance, false);
    assert.equal(retainedCap.postRestoreStart, postRestoreStart);
    assert.equal(retainedCap.postRestoreEnd, postRestoreEnd);
    assert.equal(retainedCap.elapsedMs, elapsedMs);
    assert.equal(retainedCap.limitMs, 2_000);
    assert.deepEqual(retainedCap.error, {
      name: timingFailure.name, message: timingFailure.message, code: timingFailure.code,
      actual: timingFailure.actual, expected: timingFailure.expected, operator: timingFailure.operator,
      stack: String(timingFailure.stack || "").slice(0, 8_000),
    }, "completion error differs from the immediately retained cap");
  }
  assert.equal(milestones.postRestoreInteractionChecks?.functionalChecksPassed, true);
  assert.equal(milestones.postRestoreInteractionChecks.timingPassed, timingPassed);
  assert.equal(milestones.postRestoreInteractionChecks.checksPassed, timingPassed);
  assert.equal(milestones.normalRestore.checksPassed, timingPassed);
  assert.equal(milestones.dragRestore.checksPassed, timingPassed);
  const result = {
    schema: "wasm-vm.e5-t26f.diagnostic-completion.v1", task: "E5-T26f", head, acceptance: false,
    functionalChecksPassed: true, timingPassed, checksPassed: timingPassed,
    browser: identity, milestones, final: finalState,
    errors: { browser: browserErrors, http: httpErrors }, elapsedMs: Date.now() - startedAt,
  };
  await writeFile(path.join(out, "diagnostic-completion.json"), `${JSON.stringify(result, jsonReplacer, 2)}\n`);
  await writeFile(path.join(out, "diagnostic-completion-server.log"), serverOutput);
  phaseProgress("diagnostic:completion-evidence", "done");
  console.log(JSON.stringify(result, jsonReplacer, 2));
  if (!timingPassed) {
    reportedCompletionTimingFailure = timingFailure;
    throw timingFailure;
  }
}

async function recordDiagnosticICountDivider(key) {
  try {
    milestones[key] = await page.evaluate(async () => {
      const requestedAt = performance.now();
      const controller = window.__desktopController;
      const state = await controller.guestClockState();
      const jit = await controller.jitStats();
      const selection = await controller.icountDividerSelection();
      return { requestedAt, receivedAt: performance.now(), state, jit, selection };
    });
  } catch (error) {
    milestones[key] = { error: String(error?.message || error).slice(0, 240) };
    throw error;
  }
  const sample = milestones[key];
  assert.ok(Number.isFinite(sample.requestedAt) && Number.isFinite(sample.receivedAt) &&
    sample.receivedAt >= sample.requestedAt, "ICount observation lacks bounded timestamps");
  const divider = diagnostic.icountDivider;
  assert.equal(sample.selection?.requested, divider, "missing actual ICount selection receipt");
  for (const [state, expected] of [[sample.state, divider], [sample.selection.before, 10], [sample.selection.after, divider]]) {
    assert.equal(state?.mode, "icount", "actual clock is not ICount");
    assert.equal(state.clockDiv, expected, "actual ICount divider differs from the selected/stored value");
    assert.equal(state.timebaseHz, 10_000_000);
    assert.match(state.mtime, /^[0-9]+$/u);
    assert.ok(BigInt(state.mtime) <= 0xffff_ffff_ffff_ffffn, "ICount mtime is outside u64");
  }
  assert.equal(sample.selection.before.mtime, sample.selection.after.mtime, "ICount selection advanced guest time");
  assert.ok(BigInt(sample.state.mtime) >= BigInt(sample.selection.after.mtime), "ICount time regressed after selection");
  assert.equal(sample.jit?.hasExecutor, true, "divider comparison lost its JIT executor");
  assert.equal(sample.jit.jitResidencyPolicy, "repack-off");
  assert.equal(sample.jit.jitResidencyCap, 24);
  assert.equal(sample.jit.jitRegionChaining, true);
  assert.equal(sample.jit.jitDynamicChaining, true);
  for (const counter of ["guestRetired", "retiredViaJit"]) {
    assert.ok(Number.isSafeInteger(sample.jit[counter]) && sample.jit[counter] >= 0, `unsafe ICount JIT ${counter}`);
  }
  if (key === "icountDividerAfter") {
    const before = milestones.icountDividerBefore;
    assert.deepEqual(sample.selection, before.selection, "ICount admission receipt changed during execution");
    assert.ok(sample.requestedAt > before.receivedAt, "ICount endpoint intervals overlap");
    assert.ok(BigInt(sample.state.mtime) > BigInt(before.state.mtime), "actual ICount time did not advance");
    for (const counter of ["guestRetired", "retiredViaJit"]) {
      assert.ok(sample.jit[counter] > before.jit[counter], `ICount comparison has no ${counter} progress`);
    }
  }
}

async function recordDiagnosticJit(key) {
  try {
    milestones[key] = await page.evaluate(async () => {
      const requestedAt = performance.now();
      if (typeof window.__desktopController?.jitStats !== "function") {
        throw new Error("actual worker jitStats unavailable");
      }
      const state = await window.__desktopController.jitStats();
      return { requestedAt, receivedAt: performance.now(), state };
    });
  } catch (error) {
    milestones[key] = { error: String(error?.message || error).slice(0, 240) };
    throw error;
  }
  assert.equal(milestones[key].state?.hasExecutor, diagnostic.jit === "1",
    "requested JIT policy did not match the actual worker executor");
  if (diagnostic.residency != null) {
    assert.equal(milestones[key].state.jitResidencyPolicy, diagnostic.residency,
      "requested residency policy did not match the actual worker");
    const cap = { "repack-off": 24, "cap-256": 256, "cap-1024": 1024 }[diagnostic.residency];
    assert.equal(milestones[key].state.jitResidencyCap, cap,
      "requested residency cap did not match the actual worker");
  }
  const retired = milestones[key].state.guestRetired;
  assert.ok(Number.isSafeInteger(retired) && retired >= 0,
    "actual worker guest retirement count is unavailable or unsafe");
  if (key === "jitAfter") {
    const before = milestones.jitBefore?.state?.guestRetired;
    assert.ok(Number.isSafeInteger(before) && before >= 0 && retired > before,
      "JIT comparison requires positive guest retirement progress");
  }
}

function workerProfilerHost(identity) {
  // Persistent Playwright contexts expose no Browser in this pinned version. Target routing
  // also works through a page CDP session; the shared helper still selects one exact worker URL.
  return browser ?? {
    newBrowserCDPSession: () => context.newCDPSession(page),
    version: () => identity.version,
  };
}

async function startCpuProfile(identity, restoredAt) {
  const url = new URL("./linux-worker.js", page.url()).href;
  milestones.cpuProfile = { acceptance: false, restoredAt, url, status: "attaching" };
  cpuProfiler = await attachWorkerProfiler(workerProfilerHost(identity), url);
  await cpuProfiler.start();
  milestones.cpuProfile.startedAt = await page.evaluate(() => performance.now());
  milestones.cpuProfile.status = "recording";
}

async function stopCpuProfile(reason) {
  if (!cpuProfiler) return;
  const profiler = cpuProfiler;
  cpuProfiler = null;
  try {
    const recording = await profiler.stop();
    const target = path.join(out, "interaction-cpu.json");
    const record = { ...recording, head, runtimeSha256: milestones.run.binding?.runtimeSha256,
      diagnostic: true, acceptance: false, reason, interaction: { ...milestones.cpuProfile },
      postRestoreEnd: milestones.postRestoreEnd ?? null };
    await mkdir(out, { recursive: true });
    const bytes = `${JSON.stringify(record, jsonReplacer, 2)}\n`;
    await writeFile(target, bytes);
    Object.assign(milestones.cpuProfile, { status: "saved", path: target, sha256: sha256(bytes),
      samples: recording.profile.samples.length, reason });
  } catch (error) {
    Object.assign(milestones.cpuProfile, { status: "error", reason,
      error: String(error?.message || error).slice(0, 240) });
  } finally {
    await profiler.close().catch((error) => {
      milestones.cpuProfile.closeError = String(error?.message || error).slice(0, 240);
    });
  }
}

let lastProgressSample = null;
let progressTimer = null;
let progressProbe = null;
let interactionLatencyActive = false;
let interactionLatencyCollectionPending = false;

// Serialized into the page only for the explicit reuse diagnostic. No state()/pixel inspection,
// guest control, or awaited RPC on installation; the existing marker predicate supplies its read.
function installInteractionLatencyProbe({ restoredAt, baselineWriteIndex }) {
  const startedAt = performance.now();
  if (!Number.isFinite(restoredAt) || startedAt < restoredAt) throw Error("invalid restore clock");
  const report = {
    restoredAt, startedAt, deadlineAt: restoredAt + 6_000, baselineWriteIndex,
    limits: { pcmIntervalMs: 50, pcmSamples: 120, schedulerIntervalMs: 250, schedulerSamples: 24, markerSamples: 120 },
    pcmSamples: [], schedulerSamples: [], markerSamples: [], firstWrite: null, firstPcm: null,
    firstMarker: null, markerCalls: 0, markerTotalMs: 0, markerMaxMs: 0,
    stoppedAt: null, stopReason: null,
  };
  let timer = null, deadlineTimer = null, inFlight = null, lastSchedulerAt = -Infinity;
  const shortError = (error) => String(error?.message || error).slice(0, 240);
  const pick = (value, keys) => value == null ? null : Object.fromEntries(keys.map((key) => [key, value[key] ?? null]));
  const pickScalars = (value, keys) => value == null ? null : Object.fromEntries(keys.map((key) => {
    const item = value[key];
    return [key, typeof item === "boolean" || (typeof item === "number" && Number.isFinite(item)) ? item : null];
  }));
  function stop(reason) {
    if (report.stoppedAt === null) {
      report.stoppedAt = performance.now();
      report.stopReason = reason;
      clearInterval(timer);
      clearTimeout(deadlineTimer);
      if (inFlight) {
        inFlight.status = "pending-at-stop";
        if (inFlight.jit?.status === "pending") inFlight.jit.status = "pending-at-stop";
      }
    }
    return report;
  }
  function active() {
    if (report.stoppedAt !== null) return false;
    if (performance.now() >= report.deadlineAt) { stop("time-limit"); return false; }
    return true;
  }
  async function sampleScheduler() {
    const now = performance.now();
    if (!active() || inFlight || now - lastSchedulerAt < 250 || report.schedulerSamples.length >= 24) return;
    lastSchedulerAt = now;
    const sample = { requestedAt: now, elapsedMs: now - restoredAt, status: "pending" };
    report.schedulerSamples.push(sample);
    inFlight = sample;
    try {
      const controller = window.__desktopController;
      sample.schedulerAvailable = typeof controller?.schedulerStats === "function";
      sample.workerRpcAvailable = typeof controller?.workerRpcStats === "function";
      // A rejected local-stat read must not free the slot while the worker read is still pending.
      const [scheduler, rpc] = await Promise.allSettled([
        Promise.resolve().then(() => sample.schedulerAvailable ? controller.schedulerStats() : null),
        Promise.resolve().then(() => sample.workerRpcAvailable ? controller.workerRpcStats() : null),
      ]);
      if (!active()) return;
      sample.observedAt = performance.now();
      sample.requestMs = sample.observedAt - now;
      sample.status = scheduler.status === "rejected" || rpc.status === "rejected" ? "error" : "completed";
      if (scheduler.status === "rejected") sample.schedulerError = shortError(scheduler.reason);
      if (rpc.status === "rejected") sample.workerRpcError = shortError(rpc.reason);
      sample.scheduler = pick(scheduler.value, ["quantum", "slices", "totalSliceMs", "maxSliceMs", "maxStretchGapMs",
        "requestedInstructions", "retiredInstructions", "fetchWaits", "fetchRequestedChunks", "fetchWaitTotalMs",
        "schedulerYields", "timerYields", "mainThreadYields", "yieldMode"]);
      sample.workerRpc = pick(rpc.value, ["calls", "completed", "pending", "averageMs", "maxMs"]);
      // Retain the completed scheduler data before the next worker RPC. The same logical sample
      // owns the slot until JIT settles, including when stop/deadline leaves only partial evidence.
      const jit = sample.jit = { available: typeof controller?.jitStats === "function",
        requestedAt: null, observedAt: null, status: "unavailable", stats: null };
      if (jit.available && active()) {
        const schedulerStatus = sample.status;
        sample.status = "jit-pending";
        jit.status = "pending";
        jit.requestedAt = performance.now();
        try {
          const stats = await controller.jitStats();
          if (!active()) return;
          jit.observedAt = performance.now();
          jit.stats = pickScalars(stats, ["hasExecutor", "guestRetired", "retiredViaJit", "compiledBlocks",
            "jitCacheInstalls", "jitCacheEvictions", "jitCacheRetranslations", "executedBlocks", "directChainEntries"]);
          if (jit.stats) jit.stats.entryCost = pickScalars(stats.entryCost,
            ["hostEntries", "stateCopyBytes", "timingEnabled", "timerReads"]);
          jit.status = "completed";
          sample.status = schedulerStatus;
        } catch (error) {
          if (active()) {
            jit.status = "error"; jit.observedAt = performance.now(); jit.error = shortError(error);
            sample.status = "error";
          }
        }
      }
    } catch (error) {
      if (active()) { sample.status = "error"; sample.observedAt = performance.now(); sample.error = shortError(error); }
    } finally {
      inFlight = null; // Only settlement releases this slot; a timeout never permits another RPC.
    }
  }
  function samplePcm() {
    if (!active()) return;
    if (report.pcmSamples.length >= 120) { stop("sample-limit"); return; }
    const observedAt = performance.now();
    const sample = { observedAt, elapsedMs: observedAt - restoredAt };
    report.pcmSamples.push(sample);
    try {
      const audio = window.__desktopTerminal?.audio?.();
      const writeIndex = audio?.sink?.ring?.writeIndex;
      sample.available = Number.isSafeInteger(writeIndex) && Number.isSafeInteger(baselineWriteIndex);
      sample.writeIndex = sample.available ? writeIndex : null;
      if (sample.available && ((writeIndex - baselineWriteIndex) >>> 0) > 0) {
        report.firstWrite ??= { ...sample };
        if (!report.firstPcm) {
          sample.pcmAvailable = typeof audio.pcm === "function";
          const pcm = sample.pcmAvailable ? audio.pcm(baselineWriteIndex) : null;
          if (pcm?.writtenFrames > 0 && pcm.nonSilentFrames > 0 && pcm.maxAbs > 0) {
            report.firstPcm = { ...sample, completedAt: performance.now(), pcm: pick(pcm, ["available", "writeIndex",
              "readIndex", "fillFrames", "capacityFrames", "writtenFrames", "inspectedFrames", "nonSilentFrames", "maxAbs"]) };
          }
        }
      }
    } catch (error) { sample.error = shortError(error); }
    if (report.pcmSamples.length >= 120) stop("sample-limit");
    else void sampleScheduler();
  }
  function recordMarker(start, end, state) {
    if (!active()) return;
    const sample = { startedAt: start, observedAt: end, elapsedMs: end - restoredAt,
      stateReadMs: end - start, frameCount: state.frameCount ?? null,
      markerSeen: state.active.command?.terminalMarkerSeen === true };
    report.markerCalls += 1;
    report.markerTotalMs += sample.stateReadMs;
    report.markerMaxMs = Math.max(report.markerMaxMs, sample.stateReadMs);
    if (report.markerSamples.length < 120) report.markerSamples.push(sample);
    if (sample.markerSeen) report.firstMarker ??= sample;
  }
  window.__e5t26fLatencyProbe = { active, recordMarker, stop };
  if (active()) {
    timer = setInterval(samplePcm, 50);
    deadlineTimer = setTimeout(() => stop("time-limit"), Math.max(0, report.deadlineAt - startedAt));
    void sampleScheduler();
  }
  return report;
}

function commandMarkerReady() {
  const probe = window.__e5t26fLatencyProbe;
  if (!probe?.active()) return window.__desktopTerminal.state().active.command?.terminalMarkerSeen === true;
  const startedAt = performance.now();
  const state = window.__desktopTerminal.state();
  probe.recordMarker(startedAt, performance.now(), state);
  return state.active.command?.terminalMarkerSeen === true;
}

async function startInteractionLatencyProbe(restoredAt, baselineWriteIndex) {
  interactionLatencyActive = true;
  milestones.interactionLatency = { restoredAt, baselineWriteIndex, status: "registering" };
  milestones.interactionLatency = await page.evaluate(installInteractionLatencyProbe, { restoredAt, baselineWriteIndex });
}

async function stopInteractionLatencyProbe(reason) {
  if (!interactionLatencyActive) return;
  interactionLatencyActive = false;
  interactionLatencyCollectionPending = true;
  let timer;
  const collection = Promise.resolve().then(() => page.evaluate((value) =>
    window.__e5t26fLatencyProbe?.stop(value) ?? { unavailable: true }, reason)).finally(() => {
    interactionLatencyCollectionPending = false;
  });
  try {
    milestones.interactionLatency = await Promise.race([
      collection,
      new Promise((_resolve, reject) => {
        timer = setTimeout(() => reject(Error("latency collection exceeded 1000 ms")), 1_000);
      }),
    ]);
  } catch (error) {
    milestones.interactionLatency.captureError = String(error?.message || error).slice(0, 240);
  } finally {
    clearTimeout(timer);
  }
}

function phaseProgress(phase, event = "start") {
  lastPhase = { phase, event, timestamp: new Date().toISOString(), elapsedMs: Date.now() - startedAt };
  console.error(`[e5-t26f] ${JSON.stringify(lastPhase)}`);
}

async function sampleProgress() {
  if (!progressTimer || !page) return;
  if (progressProbe) {
    console.error(`[e5-t26f] ${JSON.stringify({
      timestamp: new Date().toISOString(), phase: lastPhase?.phase, event: "probe-pending",
      probePhase: progressProbe.phase, pendingMs: Date.now() - progressProbe.startedAt,
    })}`);
    return;
  }
  const probe = { phase: lastPhase?.phase, startedAt: Date.now() };
  progressProbe = probe;
  try {
    // Only read the public page state. No worker RPC or guest control call; never serialize pixels.
    const sample = await page.evaluate(() => {
      const terminal = window.__desktopTerminal;
      const state = terminal?.state?.();
      const presentation = terminal?.presentation?.();
      const scheduler = presentation?.scheduler;
      const audio = terminal?.audio?.();
      const interaction = (record) => record ? {
        label: record.label ?? null,
        marker: record.marker ?? null,
        accepted: record.accepted ?? null,
        terminalRendered: record.terminalRendered ?? null,
        terminalMarkerSeen: record.terminalMarkerSeen ?? null,
        visualDiffPixels: record.visualDiffPixels ?? null,
        guestVisible: record.guestVisible ?? null,
        pointerFrames: record.pointerFrames ?? null,
        keyboardFrames: record.keyboardFrames ?? null,
      } : null;
      return {
        ready: document.documentElement.dataset.desktopReady || null,
        restored: document.documentElement.dataset.desktopRestored || null,
        status: (document.querySelector("#desktop-status")?.textContent || "").slice(-160),
        serialTail: (terminal?.serial?.() || "").slice(-240),
        frameCount: state?.frameCount ?? null,
        pointerFrames: state?.pointerFrames ?? null,
        keyboardFrames: state?.keyboardFrames ?? null,
        launch: interaction(state?.active?.launch),
        command: interaction(state?.active?.command),
        focus: interaction(state?.focuses?.at(-1)),
        agent: state?.agent ? {
          state: state.agent.state,
          transportGeneration: state.agent.transportGeneration,
          bytesReceived: state.agent.bytesReceived,
          bytesSent: state.agent.bytesSent,
          pendingBytes: state.agent.pendingBytes,
        } : null,
        presentation: {
          successfulPresents: presentation?.successfulPresents ?? null,
          scheduler: scheduler ? {
            pending: scheduler.pending, scheduled: scheduler.scheduled,
            paused: scheduler.paused, presented: scheduler.presented,
          } : null,
        },
        audio: {
          policy: audio?.policy?.state ?? null, context: audio?.sink?.context?.state ?? null,
          renderedFrames: audio?.sink?.renderedFrames ?? null,
          pcm: audio?.pcm?.() ?? null,
        },
      };
    });
    if (!progressTimer) return;
    lastProgressSample = {
      timestamp: new Date().toISOString(), phase: probe.phase, event: "sample",
      probeMs: Date.now() - probe.startedAt, ...sample,
    };
    console.error(`[e5-t26f] ${JSON.stringify(lastProgressSample)}`);
  } catch (error) {
    if (progressTimer) console.error(`[e5-t26f] ${JSON.stringify({
      timestamp: new Date().toISOString(), phase: probe.phase, event: "probe-error",
      error: String(error?.message || error).slice(0, 240),
    })}`);
  } finally {
    // Keep the slot until evaluate really settles, including across a reload or a stuck probe.
    // A timeout race that releases it early would let unresolved requests accumulate.
    progressProbe = null;
  }
}

function startProgressSampling() {
  if (progressTimer) return;
  progressTimer = setInterval(() => { void sampleProgress(); }, 30_000);
  progressTimer.unref?.();
}

function stopProgressSampling() {
  if (progressTimer) clearInterval(progressTimer);
  progressTimer = null;
}

function remainingInteractionMs(boundary, now) {
  const remaining = 2_000 - (now - boundary);
  assert.ok(Number.isFinite(boundary) && Number.isFinite(now) && now >= boundary && remaining > 0,
    "post-restore interaction exhausted its original 2-second budget before cursor rendering");
  return remaining;
}

async function waitForRestoredCursor(point, boundary) {
  phaseProgress("post-restore:cursor-render");
  const remainingMs = remainingInteractionMs(boundary, await page.evaluate(() => performance.now()));
  const handle = await page.waitForFunction(({ point: expected, boundary: restoredAt }) => {
    const state = window.__desktopTerminal.state();
    const frame = [...state.pointerFrameSample].reverse().find(
      (entry) => entry.device === "tablet" && entry.source === "pointermove" && entry.coordinates,
    );
    const rendered = window.__desktopCursor?.renderedCursor?.(expected);
    const observedAt = performance.now();
    if (!frame || !rendered || rendered.x !== expected.x || rendered.y !== expected.y ||
        observedAt - restoredAt > 2_000) return false;
    return { frame, rendered, observedAt, elapsedMs: observedAt - restoredAt };
  }, { point, boundary }, { timeout: remainingMs });
  try {
    const sample = await handle.jsonValue();
    phaseProgress("post-restore:cursor-render", "done");
    return sample;
  } finally {
    await handle.dispose();
  }
}

function guestPoint(box, x, y) {
  return { x: box.x + (x / 1280) * box.width, y: box.y + (y / 800) * box.height };
}

async function clickGuest(box, x, y, settleMs = 1_000) {
  const point = guestPoint(box, x, y);
  await page.mouse.move(point.x, point.y);
  await page.waitForTimeout(settleMs);
  await page.mouse.down();
  await page.mouse.up();
}

async function desktopBox() {
  const box = await page.locator("#desktop-canvas").boundingBox();
  assert.ok(box?.width > 0 && box.height > 0, "desktop canvas has no layout");
  return box;
}

async function captureFailure(label, error = null) {
  stopProgressSampling();
  await mkdir(out, { recursive: true });
  const diagnostic = {
    label,
    timestamp: new Date().toISOString(),
    head,
    image: { imageSha256, manifestSha256 },
    lastPhase,
    lastProgressSample,
    milestones,
    error: error ? {
      name: error.name || "Error",
      message: String(error.message || error),
      code: error.code || null,
      stack: String(error.stack || "").slice(0, 8_000),
    } : null,
    progressProbe: progressProbe ? { ...progressProbe, pendingMs: Date.now() - progressProbe.startedAt } : null,
    url: page?.url() || null,
    state: null,
    serial: null,
    serverOutput,
  };
  // Preserve the phase even if the subsequent browser capture itself stalls.
  await writeFile(path.join(out, `${label}.json`), `${JSON.stringify(diagnostic, jsonReplacer, 2)}\n`);
  try {
    if (progressProbe) throw new Error("progress probe still pending; retaining the last completed sample");
    if (interactionLatencyActive) {
      await stopInteractionLatencyProbe("failure");
      // Save collected samples (or the bounded collection error) before any pixel/serial capture.
      await writeFile(path.join(out, `${label}.json`), `${JSON.stringify(diagnostic, jsonReplacer, 2)}\n`);
    }
    if (interactionLatencyCollectionPending) {
      throw new Error("latency collection still pending; retaining the last completed sample");
    }
    diagnostic.state = await page.evaluate(() => ({
      terminal: window.__desktopTerminal?.state?.() || null,
      presentation: window.__desktopTerminal?.presentation?.() || null,
      audio: window.__desktopTerminal?.audio?.() ? {
        policy: window.__desktopTerminal.audio().policy?.state || null,
        context: window.__desktopTerminal.audio().sink?.context?.state || null,
        renderedFrames: window.__desktopTerminal.audio().sink?.renderedFrames ?? null,
        pcm: window.__desktopTerminal.audio().pcm?.() ?? null,
      } : null,
      ready: document.documentElement.dataset.desktopReady,
      restored: document.documentElement.dataset.desktopRestored,
    }));
    diagnostic.serial = await page.evaluate(() => window.__desktopTerminal?.serial?.() || null);
    await page.screenshot({ path: path.join(out, `${label}.png`), fullPage: true });
  } catch (error) {
    diagnostic.captureError = String(error?.message || error);
  }
  await writeFile(path.join(out, `${label}.json`), `${JSON.stringify(diagnostic, jsonReplacer, 2)}\n`);
  await writeFile(path.join(out, `${label}-server.log`), serverOutput);
}

async function launchTerminal(box, label) {
  phaseProgress(`launch:${label}`);
  await page.evaluate((value) => window.__desktopTerminal.beginLaunch(value), label);
  await clickGuest(box, 24, 16);
  await page.waitForFunction(
    () => window.__desktopTerminal.state().active.launch?.terminalRendered === true,
    null,
    { timeout: timeoutMs },
  );
  const state = await page.evaluate(() => window.__desktopTerminal.finishLaunch());
  assert.equal(state.launches.at(-1).accepted, true, `${label}: terminal launcher failed`);
  phaseProgress(`launch:${label}`, "done");
}

async function focusTopWindow(box, label) {
  phaseProgress(`focus:${label}`);
  await page.evaluate((value) => window.__desktopTerminal.beginFocus(value), label);
  const point = await page.evaluate(() => window.__desktopCursor?.focusGuestPoint?.());
  assert.ok(point, `${label}: no detected top-window focus point`);
  const before = await page.evaluate(() => window.__desktopTerminal.state().pointerFrames);
  // Match the proven T18b route: Weston must consume the tablet coordinate before the relative
  // mouse-seat button transition, or the click is recorded without assigning terminal focus.
  await clickGuest(box, point.x, point.y, 1_000);
  await page.waitForFunction(
    (minimum) => window.__desktopTerminal.state().pointerFrames >= minimum,
    before + 3,
    { timeout: 30_000 },
  );
  // The interpreted guest can finish the pointer RPC before Weston has consumed the click and
  // assigned keyboard focus. Match the already-proven T18b path: give the compositor one bounded
  // scheduling interval before the first physical key transition.
  phaseProgress(`focus:${label}:first-settle`);
  await page.waitForTimeout(60_000);
  phaseProgress(`focus:${label}:first-settle`, "done");
  // A second content click removes a rare Weston seat-focus race seen after the first desktop
  // launch; it is harmless for foot and keeps the following physical key burst deterministic.
  const secondBefore = await page.evaluate(() => window.__desktopTerminal.state().pointerFrames);
  await clickGuest(box, point.x, point.y, 1_000);
  await page.waitForFunction(
    (minimum) => window.__desktopTerminal.state().pointerFrames >= minimum,
    secondBefore + 3,
    { timeout: 30_000 },
  );
  phaseProgress(`focus:${label}:second-settle`);
  await page.waitForTimeout(30_000);
  phaseProgress(`focus:${label}:second-settle`, "done");
  await page.evaluate(() => window.__desktopTerminal.focus());
  const state = await page.evaluate(() => window.__desktopTerminal.finishFocus());
  const focus = state.focuses.at(-1);
  assert.equal(focus.accepted, true, `${label}: terminal focus was not recorded`);
  phaseProgress(`focus:${label}`, "done");
  return { point, pointerFrames: focus.pointerFrames };
}

const shiftedPhysicalKey = new Map([
  ...Array.from({ length: 26 }, (_, index) => [String.fromCharCode(65 + index), String.fromCharCode(97 + index)]),
  ["!", "1"], ["@", "2"], ["#", "3"], ["$", "4"], ["%", "5"], ["^", "6"],
  ["&", "7"], ["*", "8"], ["(", "9"], [")", "0"], ["_", "-"], ["+", "="],
  ["{", "["], ["}", "]"], ["|", "\\"], [":", ";"], ["\"", "'"], ["<", ","], [">", "."], ["?", "/"],
]);

async function typePhysicalText(text, keyDelay = 100) {
  for (const character of text) {
    const baseKey = shiftedPhysicalKey.get(character);
    if (baseKey) {
      await page.keyboard.down("Shift");
      if (keyDelay > 0) await page.waitForTimeout(keyDelay);
      await page.keyboard.press(baseKey, { delay: keyDelay });
      if (keyDelay > 0) await page.waitForTimeout(keyDelay);
      await page.keyboard.up("Shift");
    } else {
      await page.keyboard.type(character, { delay: keyDelay });
    }
    // Playwright's delay holds a key before keyup; it does not separate that keyup from
    // the next keydown. Pace both edges, including modifier edges, during cold setup.
    if (keyDelay > 0) await page.waitForTimeout(keyDelay);
  }
}

async function typeCommand(command, marker, timeout = 240_000, keyDelay = 100) {
  phaseProgress(`command:${marker}:typing`);
  await page.evaluate(({ value, expected }) => window.__desktopTerminal.beginCommand(value, expected), {
    value: command,
    expected: marker,
  });
  await page.evaluate(() => window.__desktopTerminal.focus());
  // The interpreted guest needs a bounded drain interval between physical transitions; a 10 ms
  // burst records every DOM frame but can leave the foot line editor visibly mid-command.
  await typePhysicalText(command, keyDelay);
  await page.keyboard.press("Enter", { delay: keyDelay });
  phaseProgress(`command:${marker}:typing`, "done");
  phaseProgress(`command:${marker}:completion`);
  try {
    await page.waitForFunction(
      commandMarkerReady,
      null,
      { timeout },
    );
  } catch (error) {
    await captureFailure(`command-${marker}`, error);
    throw error;
  } finally {
    if (interactionLatencyActive) await stopInteractionLatencyProbe("command-wait-settled");
  }
  const state = await page.evaluate((expected) => window.__desktopTerminal.finishCommand(expected), marker);
  const record = state.commands.at(-1);
  assert.equal(record.accepted, true, `${marker}: command was not accepted`);
  phaseProgress(`command:${marker}:completion`, "done");
  return record;
}

async function waitForDesktopReady(label = "desktop ready") {
  phaseProgress(`readiness:${label}`);
  let lastSample = null;
  await waitFor(async () => {
    const sample = await page.evaluate(() => ({
      ready: document.documentElement.dataset.desktopReady || null,
      restored: document.documentElement.dataset.desktopRestored || null,
      status: document.querySelector("[data-status]")?.textContent || null,
      bootStates: window.__desktopTerminal?.state?.().bootStates || [],
      readiness: window.__desktopTerminal?.state?.().readiness || null,
      diagnostics: window.__desktopTerminal?.state?.().diagnostics || [],
      serialTail: (window.__desktopTerminal?.serial?.() || "").slice(-160),
    }));
    lastSample = sample;
    if (diagnostic?.mode === "reuse") {
      assert.equal(sample.bootStates.some(({ state }) => state === "booting"), false,
        "diagnostic checkpoint was refused; aborting cold-boot fallback");
    }
    return sample.ready === "ready";
  }, label, timeoutMs).catch((error) => {
    throw new Error(`${error.message}; last sample=${JSON.stringify(lastSample)}`, { cause: error });
  });
  phaseProgress(`readiness:${label}`, "done");
}

async function waitForAgentReady(label = "agent channel ready") {
  phaseProgress(`agent:${label}`);
  try {
    await page.waitForFunction(
      () => window.__desktopTerminal.state().agent?.state === "ready",
      null,
      { timeout: 60_000 },
    );
  } catch (error) {
    await captureFailure("agent-ready", error);
    const state = await page.evaluate(() => window.__desktopTerminal.state());
    throw new Error(`${label}: ${error.message}; state=${JSON.stringify({
      agent: state.agent,
      readiness: state.readiness,
      diagnostics: state.diagnostics,
    })}`, { cause: error });
  }
  const state = await page.evaluate(() => window.__desktopTerminal.state().agent);
  phaseProgress(`agent:${label}`, "done");
  return state;
}

async function waitForReadyAndRestore(label) {
  await waitForDesktopReady(`${label}:desktop ready`);
  phaseProgress(`restore:${label}:completion`);
  await page.waitForFunction(() => ["ready", "error", "none"].includes(
    document.documentElement.dataset.desktopRestored,
  ), null, { timeout: timeoutMs });
  const restoreState = await page.evaluate(() => ({
    restored: document.documentElement.dataset.desktopRestored || null,
    status: document.querySelector("[data-status]")?.textContent || null,
    terminal: window.__desktopTerminal?.state?.() || null,
    diagnostics: window.__desktopTerminal?.state?.().diagnostics || [],
  }));
  if (restoreState.restored !== "ready") {
    await captureFailure(`restore-${restoreState.restored || "missing"}`);
    throw new Error(`desktop restore did not become ready: ${JSON.stringify(restoreState)}`);
  }
  phaseProgress(`restore:${label}:completion`, "done");
  phaseProgress(`restore:${label}:first-present`);
  await page.waitForFunction(
    () => window.__desktopTerminal.restoreObservation?.().firstPresent !== null,
    null,
    { timeout: 60_000 },
  );
  // Keep this read synchronous: snapshotDecision reassembles the persisted whole-machine blob.
  // Its audit belongs after the interaction measured from the original restore completedAt.
  const result = await page.evaluate(() => {
    const result = window.__desktopTerminal.restoreResult();
    const observation = window.__desktopTerminal.restoreObservation();
    const controller = window.__desktopController;
    const state = window.__desktopTerminal.state();
    return {
      snapshotSha256: result?.snapshotSha256 || null,
      snapshotBytes: result?.snapshotBytes || 0,
      completedAt: result?.completedAt || null,
      report: result?.report || null,
      handshake: result?.handshake ? {
        generation: result.handshake.generation,
        version: result.handshake.version,
        capabilities: String(result.handshake.capabilities),
      } : null,
      observation,
      bootStates: state.bootStates,
      diagnostics: state.diagnostics,
      machineResume: result?.machineResume || null,
      preFrontBufferCrc: result?.preFrontBufferCrc || null,
      resume: {
        restored: Boolean(controller?.restoredFromBootSnapshot?.()),
        snapshotDecision: null,
        overlayGeneration: null,
      },
      coherenceAudit: { status: "deferred" },
      presentation: window.__desktopTerminal.presentation(),
    };
  });
  phaseProgress(`restore:${label}:first-present`, "done");
  return result;
}

async function auditRestoreCoherence(result, snapshot, label) {
  phaseProgress(`restore:${label}:coherence-audit`);
  const audit = result.coherenceAudit;
  audit.status = "running";
  audit.startedAt = new Date().toISOString();
  try {
    // Read the actual initial restore receipt, not the old blob's validity after the resumed
    // guest has legitimately advanced its disk. The loader freezes this before scheduling work.
    const receipt = await page.evaluate(async () =>
      await window.__desktopController?.storedSnapshotRestoreEvidence?.() ?? null);
    audit.restoreBoundary = receipt;
    assert.equal(receipt?.attempted, true, `${label} stored snapshot restore was not attempted`);
    result.resume.snapshotDecision = receipt.decision;
    result.resume.overlayGeneration = receipt.overlayGeneration;
    assert.equal(result.resume.restored, true, `${label} reload did not restore the whole-machine snapshot`);
    assert.equal(result.resume.snapshotDecision, "resume", `${label} whole-machine snapshot was not coherent`);
    assert.ok(Number.isSafeInteger(result.resume.overlayGeneration) && result.resume.overlayGeneration >= 0,
      `${label} actual overlay generation is missing`);
    assert.equal(result.resume.overlayGeneration, snapshot.machineResume?.overlayGeneration,
      `${label} actual overlay generation differs from the saved snapshot`);
    audit.currentOverlayGeneration = await page.evaluate(async () =>
      await window.__desktopController?.snapshotGeneration?.() ?? null);
    assert.ok(Number.isSafeInteger(audit.currentOverlayGeneration) &&
      audit.currentOverlayGeneration >= result.resume.overlayGeneration,
    `${label} current overlay generation predates the actual restore`);
    audit.status = "passed";
    phaseProgress(`restore:${label}:coherence-audit`, "done");
  } catch (error) {
    audit.status = "failed";
    audit.error = String(error?.message || error);
    throw error;
  } finally {
    audit.completedAt = new Date().toISOString();
  }
}

async function reloadWithAutoRestore(url, label, initialLoad = false) {
  phaseProgress(`reload:${label}`);
  if (initialLoad) {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: timeoutMs });
  } else {
    await page.evaluate((nextUrl) => history.replaceState(null, "", nextUrl), url);
    await page.reload({ waitUntil: "domcontentloaded", timeout: timeoutMs });
  }
  phaseProgress(`reload:${label}`, "done");
  return waitForReadyAndRestore(label);
}

try {
  phaseProgress("server:startup");
  const binding = diagnostic ? await diagnosticBinding(diagnostic, fixtureBinding) : null;
  if (diagnostic) {
    milestones.run.binding = binding;
    console.error("[e5-t26f] DIAGNOSTIC ITERATION ONLY — not acceptance; retained profiles are never deleted");
    await requireFreePort(diagnostic.port);
  }
  const retained = diagnostic ? await prepareDiagnostic(diagnostic, binding) : null;
  const diagnosticCheckpoint = retained?.checkpoint || null;
  if (diagnostic) {
    milestones.run.profile = retained.profile;
    milestones.run.checkpointFile = retained.checkpointFile;
    milestones.run.creatorHead = retained.creatorHead;
    milestones.run.currentHead = head;
  }
  const port = diagnostic?.port ?? await freePort();
  server = spawn("bash", ["tools/serve-dev.sh", String(port)], {
    cwd: repo,
    env: serverEnv,
    stdio: ["ignore", "pipe", "pipe"],
    detached: true,
  });
  for (const stream of [server.stdout, server.stderr]) {
    stream.on("data", (chunk) => { serverOutput += chunk.toString(); });
  }
  const base = `http://127.0.0.1:${port}`;
  await waitFor(async () => {
    if (server.exitCode !== null) throw new Error(`desktop server exited: ${server.exitCode}`);
    try {
      const response = await fetch(`${base}/desktop-cursor.html`);
      const manifestResponse = await fetch(`${base}/e5t18b-desktop/manifest.json`);
      return response.ok && manifestResponse.ok;
    } catch {
      return false;
    }
  }, "desktop server and asset route", 30_000);
  phaseProgress("server:startup", "done");

  phaseProgress("browser:launch");
  const { chromium } = await import(pathToFileURL(path.join(web, "node_modules/playwright/index.mjs")).href);
  const launchOptions = {
    headless: process.env.E5_T26F_HEADED !== "1",
    args: ["--disable-dev-shm-usage", "--disable-background-timer-throttling", "--disable-renderer-backgrounding"],
  };
  try { await access(chromePath); launchOptions.executablePath = chromePath; } catch { /* bundled Chromium */ }
  const contextOptions = {
    viewport: { width: 1440, height: 1050 },
    deviceScaleFactor: 1,
    serviceWorkers: "block",
  };
  if (retained) {
    context = await chromium.launchPersistentContext(retained.profile, { ...launchOptions, ...contextOptions });
    browser = context.browser();
  } else {
    browser = await chromium.launch(launchOptions);
    context = await browser.newContext(contextOptions);
  }
  page = await context.newPage();
  const browserIdentity = await readBrowserIdentity(browser, context, page, launchOptions.headless);
  if (diagnosticCheckpoint) assert.deepEqual(browserIdentity, diagnosticCheckpoint.browser, "checkpoint browser differs");
  if (diagnosticCheckpoint) await installCheckpointSession(page, diagnosticCheckpoint, base);
  startProgressSampling();
  phaseProgress("browser:launch", "done");
  page.on("pageerror", (error) => {
    browserErrors.push({ type: "pageerror", text: String(error) });
    recordCompletionConsole("pageerror", error);
  });
  page.on("console", (message) => {
    if (diagnostic?.complete && ["warning", "error"].includes(message.type())) {
      recordCompletionConsole(message.type(), message.text());
    }
    if (message.type() === "error" && !message.location().url?.endsWith("/favicon.ico")) {
      browserErrors.push({ type: "console", text: message.text() });
    }
  });
  page.on("response", (response) => {
    if (response.status() >= 400 && !response.url().endsWith("/favicon.ico")) {
      httpErrors.push({ url: response.url(), status: response.status() });
    }
  });

  const query = new URLSearchParams({
    testHooks: "1",
    jit: "1",
    quantum: "500000",
    imageManifestUrl: "./e5t18b-desktop/manifest.json",
    baseUrl: "./e5t18b-desktop/",
    imageSha256,
    manifestSha256,
  });
  if (diagnostic?.guestClock) query.set("guestClock", diagnostic.guestClock);
  if (diagnostic?.jit != null) query.set("jit", diagnostic.jit);
  if (diagnostic?.residency != null) query.set("jitResidency", diagnostic.residency);
  if (diagnostic?.icountDivider != null) query.set("icountDivider", String(diagnostic.icountDivider));
  const coldUrl = `${base}/desktop-cursor.html?${query}`;
  const restoreUrl = `${coldUrl}&autoRestore=1`;
  let normalSnapshot = diagnosticCheckpoint?.normalSnapshot;
  let preSnapshotPresents, shellProbe, agentProbe, firstCommand, cursorProof;
  if (diagnosticCheckpoint) {
    milestones.normalSnapshot = normalSnapshot;
    milestones.run.checkpointCreatedAt = diagnosticCheckpoint.createdAt;
    milestones.run.profileSha256 = diagnosticCheckpoint.profileSha256;
    if (residentFixture) {
      const proof = diagnosticCheckpoint.resident;
      assert.deepEqual(proof?.fixture, fixtureBinding, "checkpoint resident fixture differs");
      assert.equal(proof.prepared.command, `. ${RESIDENT_GUEST_PATH} && e5_prepare`);
      assert.equal(proof.prepared.accepted, true);
      assert.equal(proof.prepared.inputSequenceMatch, true);
      assert.equal(proof.prepared.terminalMarkerSeen, true);
      assert.equal(proof.prepared.redMarkerSeen, false);
      const envelope = JSON.parse(diagnosticCheckpoint.session.value);
      const sound = parsePreparedSound(Buffer.from(envelope.bytes, "base64"), normalSnapshot.sha256);
      assert.deepEqual(sound, proof.sound, "checkpoint sound proof differs from actual saved bytes");
      const screenshot = path.resolve(repo, proof.screenshot.file);
      assert.ok(screenshot.startsWith(path.join(repo, "evidence") + path.sep), "checkpoint screenshot must be retained evidence");
      const screenshotStat = await lstat(screenshot);
      assert.ok(screenshotStat.isFile() && !screenshotStat.isSymbolicLink(), "prepared screenshot must be a regular file");
      assert.equal(await sha256File(screenshot), proof.screenshot.sha256, "prepared guest screenshot differs");
      milestones.residentCheckpoint = proof;
    }
  } else {
  phaseProgress("browser:initial-load");
  await page.goto(coldUrl, { waitUntil: "domcontentloaded", timeout: timeoutMs });
  phaseProgress("browser:initial-load", "done");
  await waitForDesktopReady("initial desktop ready");
  milestones.initialReadiness = { completedAt: new Date().toISOString() };
  await page.waitForTimeout(2_000);
  const box = await desktopBox();

  await launchTerminal(box, "e5-t26f-terminal-1");
  await focusTopWindow(box, "terminal-1");
  shellProbe = await typeCommand(
    "true; printf '\\033[42;30me5t26f-shell-ok\\033[0m\\n'",
    "e5t26f-shell-ok",
  );
  assert.equal(shellProbe.redMarkerSeen, false, "guest shell probe reported failure");
  milestones.shellProbe = shellProbe;
  agentProbe = await waitForAgentReady();
  assert.equal(agentProbe.state, "ready", "agent channel did not complete HELLO");
  milestones.agentProbe = agentProbe;
  // Keep the setup-and-run burst below the guest input queue's 256-event budget. The command
  // builds a deterministic 20 ms S16 stereo fixture (3840 bytes at 48 kHz), then writes a short
  // replay script whose marker is emitted only after finite aplay completion. The post-restore
  // command is only `sh /tmp/a`, so it cannot spend the 2-second interaction budget in a full
  // one-second /dev/urandom stream.
  // Pin the real hardware device and two 10-ms periods: a short file must fill the start
  // threshold, not depend on ALSA's ignored drain return or an implicit larger buffer.
  const initialAudioBefore = await page.evaluate(() => window.__desktopTerminal.audio()?.pcm?.() || null);
  const aplayCommand = "yes \"$(printf '\\001\\000\\377\\177')\"|head -c3840 >/tmp/p;printf 'aplay -Dhw:0,0 --period-size=480 --buffer-size=960 -f S16_LE -t raw -r48000 -c2 /tmp/p&&printf \"\\033[42me5t26f-aplay\\033[0m\\n\"' >/tmp/a;sh /tmp/a";
  firstCommand = await typeCommand(aplayCommand, "e5t26f-aplay-ok");
  assert.equal(firstCommand.terminalMarkerSeen, true, "initial aplay was not guest-visibly completed");
  assert.ok(firstCommand.visualDiffPixels >= 2_000, "initial aplay marker did not change guest pixels");
  milestones.initialAplay = firstCommand;
  milestones.initialAudio = await page.evaluate(async (before) => ({
    before,
    after: window.__desktopTerminal.audio()?.pcm?.(before?.writeIndex) || null,
    outputAttached: await window.__desktopController?.audioOutputReady?.() ?? null,
    observedAt: performance.now(),
  }), initialAudioBefore);
  const focusProof = await page.evaluate(() => window.__desktopTerminal.confirmGuestFocus("e5t26f-shell-ok"));
  assert.equal(focusProof.focuses.at(-1).guestVisible, true, "terminal focus was not guest-visibly used");
  await launchTerminal(box, "e5-t26f-terminal-2");
  await focusTopWindow(box, "terminal-2");
  milestones.twoWindows = { completedAt: new Date().toISOString() };
  if (residentFixture) {
    phaseProgress("resident:prepare-real-player");
    const prepared = await typeCommand(`. ${RESIDENT_GUEST_PATH} && e5_prepare`, "e5t26f-prepared");
    assert.equal(prepared.accepted, true);
    assert.equal(prepared.inputSequenceMatch, true);
    assert.equal(prepared.redMarkerSeen, false, "resident guest guards refused preparation");
    assert.equal(prepared.terminalMarkerSeen, true, "real resident player did not reach prepared state");
    milestones.residentCheckpoint = { fixture: fixtureBinding, prepared };
    phaseProgress("resident:prepare-real-player", "done");
  }

  phaseProgress("cursor:initial-render");
  const cursorPoint = { x: 720, y: 430 };
  const cursorClient = guestPoint(box, cursorPoint.x, cursorPoint.y);
  await page.mouse.move(cursorClient.x, cursorClient.y);
  await page.waitForFunction((point) => {
    const state = window.__desktopTerminal.state();
    const frame = [...state.pointerFrameSample].reverse().find(
      (entry) => entry.device === "tablet" && entry.source === "pointermove" && entry.coordinates,
    );
    if (!frame) return false;
    const rendered = window.__desktopCursor?.renderedCursor?.(point);
    return rendered ? { frame, rendered } : false;
  }, cursorPoint, { timeout: 120_000, polling: 500 });
  cursorProof = await page.evaluate((point) => {
    const state = window.__desktopTerminal.state();
    const frame = [...state.pointerFrameSample].reverse().find(
      (entry) => entry.device === "tablet" && entry.source === "pointermove" && entry.coordinates,
    );
    const rendered = frame ? window.__desktopCursor?.renderedCursor?.(point) : null;
    return { frame, rendered };
  }, cursorPoint);
  assert.ok(cursorProof.frame, "custom cursor proof saw no tablet move");
  assert.ok(cursorProof.rendered, "custom cursor was not visible in the front buffer");
  milestones.initialCursor = cursorProof;
  phaseProgress("cursor:initial-render", "done");

  phaseProgress("snapshot:normal");
  // Keep every persisted normal checkpoint frozen until reload (or diagnostic profile close).
  // Otherwise an intervening guest write can correctly invalidate the just-saved machine blob.
  milestones.normalSnapshotPause = await page.evaluate(async () => {
    const controller = window.__desktopController;
    await controller.pause();
    return { at: performance.now(), isPaused: await controller.isPaused() };
  });
  assert.equal(milestones.normalSnapshotPause.isPaused, true, "normal checkpoint must leave the guest paused");
  preSnapshotPresents = await page.evaluate(() => window.__desktopTerminal.presentation().successfulPresents);
  normalSnapshot = await page.evaluate(() => window.__desktopTerminal.saveDesktopSnapshot({ persist: true }));
  assert.equal(normalSnapshot.schema, "wasm-vm.e5-t26f.desktop-snapshot.v1");
  assert.match(normalSnapshot.sha256, SHA256);
  assert.ok(normalSnapshot.byteLength > 0, "normal desktop snapshot is empty");
  assert.match(normalSnapshot.preFrontBufferCrc, /^[0-9a-f]{8}$/u, "normal snapshot lacks a frozen front-buffer CRC");
  milestones.normalSnapshot = {
    sha256: normalSnapshot.sha256, byteLength: normalSnapshot.byteLength,
    preFrontBufferCrc: normalSnapshot.preFrontBufferCrc, machineResume: normalSnapshot.machineResume,
  };
  await auditFrozenSnapshot(normalSnapshot, "BeforeReload", "normal");
  if (residentFixture) {
    const bytes = await page.evaluate(() => Array.from(window.__desktopTerminal.storedDesktopSnapshot().bytes));
    milestones.residentCheckpoint.sound = parsePreparedSound(bytes, normalSnapshot.sha256);
    const file = path.join(out, "resident-prepared.png");
    const screenshot = await page.screenshot({ path: file, fullPage: true });
    milestones.residentCheckpoint.screenshot = { file: path.relative(repo, file), sha256: sha256(screenshot) };
  }
  phaseProgress("snapshot:normal", "done");
  }

  if (diagnostic?.mode === "create") {
    phaseProgress("diagnostic:checkpoint-seal");
    const session = await page.evaluate((key) => ({ key, value: sessionStorage.getItem(key) }), DESKTOP_STORAGE_KEY);
    stopProgressSampling();
    await context.close();
    context = null;
    assert.deepEqual(await diagnosticBinding(diagnostic, fixtureBinding), binding, "runtime changed while creating checkpoint");
    const checkpoint = {
      schema: DIAGNOSTIC_OWNER, createdAt: new Date().toISOString(), browser: browserIdentity,
      normalSnapshot: milestones.normalSnapshot, session, profileSha256: await treeDigest(retained.seed),
      ...(residentFixture ? { resident: milestones.residentCheckpoint } : {}),
    };
    validateCheckpoint(checkpoint);
    await writeFile(retained.checkpointFile, `${JSON.stringify(checkpoint)}\n`, { flag: "wx" });
    milestones.run.profileSha256 = checkpoint.profileSha256;
    phaseProgress("diagnostic:checkpoint-seal", "done");
    await mkdir(out, { recursive: true });
    const result = { schema: "wasm-vm.e5-t26f.diagnostic-iteration.v1", acceptance: false, milestones,
      errors: { browser: browserErrors, http: httpErrors } };
    await writeFile(path.join(out, "diagnostic-checkpoint.json"), `${JSON.stringify(result, jsonReplacer, 2)}\n`);
    console.log(JSON.stringify(result, jsonReplacer, 2));
  } else {

  const firstRestore = await reloadWithAutoRestore(restoreUrl, "normal", Boolean(diagnosticCheckpoint));
  milestones.normalRestore = { result: firstRestore, displayChecksPassed: false, checksPassed: false };
  phaseProgress("restore:normal:display-checks");
  assert.equal(firstRestore.snapshotSha256, normalSnapshot.sha256, "reload restored a different snapshot");
  assert.equal(firstRestore.observation.firstPresent.crc32, normalSnapshot.preFrontBufferCrc, "first restore frame CRC changed");
  assert.equal(firstRestore.report?.fullRepairFrame, true, "restore did not publish a full repair frame");
  assert.equal(firstRestore.report?.agentRehandshake, true, "restore did not re-handshake the agent");
  assert.equal(firstRestore.handshake?.version, 1, "agent protocol version");
  assert.equal(normalSnapshot.machineResume?.persisted, true, "normal snapshot lacks a whole-machine resume");
  assert.deepEqual(firstRestore.machineResume, normalSnapshot.machineResume, "resume metadata was not preserved through reload");
  assert.equal(firstRestore.preFrontBufferCrc, normalSnapshot.preFrontBufferCrc, "restore lost the frozen CRC metadata");
  assert.equal(firstRestore.resume.restored, true, "reload did not restore the whole-machine snapshot");
  assert.equal(firstRestore.bootStates.some(({ state }) => state === "booting"), false,
    "whole-machine resume unexpectedly entered the cold guest boot state");
  milestones.normalRestore.displayChecksPassed = true;
  phaseProgress("restore:normal:display-checks", "done");

  phaseProgress("post-restore:focus-and-gesture");
  const postRestoreStart = firstRestore.completedAt;
  milestones.postRestoreStart = postRestoreStart;
  assert.ok(Number.isFinite(postRestoreStart), "restore did not expose a timing boundary");
  // This real RPC is inside the original restore budget in both explicit comparison arms.
  if (diagnostic?.jit != null) await recordDiagnosticJit("jitBefore");
  if (diagnostic?.icountDivider != null) await recordDiagnosticICountDivider("icountDividerBefore");
  if (diagnostic?.guestClock) {
    milestones.guestClockBefore = await page.evaluate(async () => {
      const requestedAt = performance.now();
      const state = await window.__desktopController.guestClockState();
      return { requestedAt, receivedAt: performance.now(), state };
    });
    assert.equal(milestones.guestClockBefore.state?.mode, diagnostic.guestClock,
      "requested clock did not reach the actual worker machine");
  }
  const postBox = await desktopBox();
  const focusBefore = await page.evaluate(() => window.__desktopTerminal.state().pointerFrames);
  const topPoint = await page.evaluate(() => window.__desktopCursor?.focusGuestPoint?.());
  assert.ok(topPoint, "post-restore focus point is missing");
  await page.evaluate(() => window.__desktopTerminal.beginFocus("post-restore-focus"));
  const focusClient = guestPoint(postBox, topPoint.x, topPoint.y);
  const audioBefore = await page.evaluate(() => ({
    policy: window.__desktopTerminal.audio()?.policy?.state || null,
    renderedFrames: window.__desktopTerminal.audio()?.sink?.renderedFrames ?? null,
  }));
  assert.equal(audioBefore.policy, "locked", "audio was already unlocked before the delayed gesture");
  if (residentFixture) {
    assert.equal(firstRestore.report.soundXrunEvents, 0, "prepared restore unexpectedly repaired a running stream");
    const sample = await page.evaluate(() => ({ observedAt: performance.now(),
      policy: window.__desktopTerminal.audio()?.policy?.state,
      context: window.__desktopTerminal.audio()?.sink?.context?.state,
      pcm: window.__desktopTerminal.audio()?.pcm?.(0) }));
    milestones.residentBeforeGesture = [sample];
    assertFreshLockedPcm(sample);
    assert.ok(sample.observedAt >= postRestoreStart, "pre-gesture proof predates actual restore");
  }
  // Let the guest cursor progress while the audio-unlocking click remains deliberately delayed.
  await page.mouse.move(focusClient.x, focusClient.y);
  await page.waitForTimeout(350);
  assert.equal(await page.evaluate(() => window.__desktopTerminal.audio()?.policy?.state || null),
    "locked", "audio unlocked before the delayed click");
  if (residentFixture) {
    const sample = await page.evaluate(() => ({ observedAt: performance.now(),
      policy: window.__desktopTerminal.audio()?.policy?.state,
      context: window.__desktopTerminal.audio()?.sink?.context?.state,
      pcm: window.__desktopTerminal.audio()?.pcm?.(0) }));
    milestones.residentBeforeGesture.push(sample);
    assertFreshLockedPcm(sample);
    assert.ok(sample.observedAt > milestones.residentBeforeGesture[0].observedAt);
  }
  await page.mouse.down();
  await page.mouse.up();
  await page.waitForFunction(
    (minimum) => window.__desktopTerminal.state().pointerFrames > minimum,
    focusBefore,
    { timeout: 2_000 },
  );
  await page.evaluate(() => window.__desktopTerminal.focus());
  phaseProgress("post-restore:focus-and-gesture", "done");
  const postRestoreCursor = await waitForRestoredCursor(topPoint, postRestoreStart);
  assert.ok(postRestoreCursor.frame, "post-restore pointer did not reach the guest");
  assert.ok(postRestoreCursor.rendered, "post-restore cursor was not guest-visibly rendered");
  assert.equal(postRestoreCursor.rendered.x, topPoint.x, "post-restore cursor x is stale");
  assert.equal(postRestoreCursor.rendered.y, topPoint.y, "post-restore cursor y is stale");
  milestones.postRestoreCursor = postRestoreCursor;
  phaseProgress("post-restore:audio-unlock");
  const focusState = await page.evaluate(() => window.__desktopTerminal.finishFocus());
  assert.equal(focusState.focuses.at(-1).accepted, true, "post-restore host focus was not accepted");
  await page.waitForFunction(
    () => window.__desktopTerminal.audio()?.policy?.state === "unlocked",
    null,
    { timeout: 2_000 },
  );
  const postAudioBefore = await page.evaluate(() => ({
    policy: window.__desktopTerminal.audio()?.policy?.state || null,
    renderedFrames: window.__desktopTerminal.audio()?.sink?.renderedFrames ?? null,
    writeIndex: window.__desktopTerminal.audio()?.pcm?.().writeIndex ?? null,
  }));
  milestones.postRestoreAudioBefore = postAudioBefore;
  phaseProgress("post-restore:audio-unlock", "done");
  if (diagnostic?.cpu) await startCpuProfile(browserIdentity, postRestoreStart);
  if (diagnostic?.latency) await startInteractionLatencyProbe(postRestoreStart, postAudioBefore.writeIndex);
  const postAudioCommand = await typeCommand(
    postRestoreCommand,
    "e5t26f-post-aplay",
    120_000,
    postRestoreKeyDelayMs,
  );
  const postFocusState = await page.evaluate(() => window.__desktopTerminal.confirmGuestFocus("e5t26f-post-aplay"));
  assert.equal(postFocusState.focuses.at(-1).guestVisible, true, "post-restore typing was not guest-visible");
  milestones.postRestoreAplay = postAudioCommand;
  phaseProgress("post-restore:audio-pcm-and-render");
  // Capture PCM at the completion boundary. A later digital-silence write can wrap the ring and
  // erase a short fixture before a second diagnostic read, so the proof is the immediate
  // before/after delta rather than a delayed scan after the render clock catches up.
  const postPcmAtCompletion = await page.evaluate((writeIndex) => ({
    observedAt: performance.now(),
    pcm: window.__desktopTerminal.audio()?.pcm?.(writeIndex) || null,
  }), postAudioBefore.writeIndex);
  milestones.postRestorePcmAtCompletion = {
    ...postPcmAtCompletion, elapsedMs: postPcmAtCompletion.observedAt - postRestoreStart,
  };
  // Preserve raw PCM first, even if this optional scalar worker RPC fails or stalls.
  try {
    milestones.postRestoreOutputAttached = await page.evaluate(async () => ({
      outputAttached: await window.__desktopController?.audioOutputReady?.() ?? null,
      observedAt: performance.now(),
    }));
  } catch (error) {
    milestones.postRestoreOutputAttached = { error: String(error?.message || error) };
  }
  assert.ok(postPcmAtCompletion.pcm?.writtenFrames > 0, "post-restore aplay wrote no guest PCM at completion");
  assert.ok(postPcmAtCompletion.pcm?.nonSilentFrames > 0 && postPcmAtCompletion.pcm?.maxAbs > 0,
    "post-restore audio PCM was silent at completion");
  await page.waitForFunction(
    ({ minimum }) => {
      const frames = window.__desktopTerminal.audio()?.sink?.renderedFrames;
      return Number.isSafeInteger(frames) && frames > minimum;
    },
    { minimum: postAudioBefore.renderedFrames },
    { timeout: 2_000 },
  );
  const postAudioAfter = await page.evaluate(({ completion, writeIndex, attachment }) => ({
    policy: window.__desktopTerminal.audio()?.policy?.state || null,
    context: window.__desktopTerminal.audio()?.sink?.context?.state || null,
    renderedFrames: window.__desktopTerminal.audio()?.sink?.renderedFrames ?? null,
    pcm: completion.pcm,
    pcmObservedAt: completion.observedAt,
    writeIndex,
    guestAttached: attachment.outputAttached ?? false,
    guestAttachedObservedAt: attachment.observedAt ?? null,
  }), { completion: postPcmAtCompletion, writeIndex: postAudioBefore.writeIndex,
    attachment: milestones.postRestoreOutputAttached });
  milestones.postRestoreAudioAfter = postAudioAfter;
  assert.ok(postAudioAfter.renderedFrames > postAudioBefore.renderedFrames,
    "post-restore aplay did not advance rendered audio frames");
  assert.equal(postAudioAfter.guestAttached, true, "guest audio output was not attached");
  assert.ok(postAudioAfter.pcm?.writtenFrames > 0, "post-restore aplay wrote no guest PCM");
  assert.ok(postAudioAfter.pcm?.nonSilentFrames > 0 && postAudioAfter.pcm?.maxAbs > 0,
    "post-restore audio PCM was silent");
  phaseProgress("post-restore:audio-pcm-and-render", "done");
  phaseProgress("post-restore:interaction-checks");
  const postRestoreEnd = await page.evaluate(() => performance.now());
  milestones.postRestoreEnd = postRestoreEnd;
  const postRestoreInteraction = await page.evaluate((boundary) => ({
    elapsedMs: performance.now() - boundary,
    pointerFrames: window.__desktopTerminal.state().pointerFrames,
    keyboardFrames: window.__desktopTerminal.state().keyboardFrames,
    heldButtons: window.__desktopTerminal.pointerState()?.heldButtons || [],
    audio: {
      policy: window.__desktopTerminal.audio()?.policy?.state || null,
      context: window.__desktopTerminal.audio()?.sink?.context?.state || null,
      renderedFrames: window.__desktopTerminal.audio()?.sink?.renderedFrames ?? null,
    },
  }), postRestoreStart);
  milestones.postRestoreInteraction = postRestoreInteraction;
  // Never delay the immediate PCM observation or replace the already-frozen interaction end.
  if (diagnostic?.jit != null) await recordDiagnosticJit("jitAfter");
  if (diagnostic?.icountDivider != null) {
    await recordDiagnosticICountDivider("icountDividerAfter");
    // The generic early failure record omits error arrays; retain the actual endpoint arrays
    // before the original cap can throw, just as the existing clock-mode comparison does.
    milestones.icountDividerErrors = { browser: [...browserErrors], http: [...httpErrors] };
  }
  if (diagnostic?.guestClock) {
    // Outside the frozen interaction boundary; neither this RPC nor reporting resets F's cap.
    milestones.guestClockAfter = await page.evaluate(async () => {
      const requestedAt = performance.now();
      const state = await window.__desktopController.guestClockState();
      return { requestedAt, receivedAt: performance.now(), state };
    });
    assert.equal(milestones.guestClockAfter.state?.mode, diagnostic.guestClock);
    milestones.guestClockErrors = { browser: [...browserErrors], http: [...httpErrors] };
  }
  // Stop only after the original interaction boundary and immediate PCM observation are frozen.
  // Profiler collection cannot reset that boundary or delay the short PCM ring inspection.
  if (diagnostic?.cpu) await stopCpuProfile("interaction-observed");
  try {
    assert.ok(postRestoreInteraction.pointerFrames > focusBefore, "post-restore cursor/focus did not move");
    assert.equal(postRestoreInteraction.heldButtons.length, 0, "post-restore focus left a stuck button");
    assert.equal(postRestoreInteraction.audio.policy, "unlocked", "user gesture did not unlock audio");
    assert.ok(postAudioCommand.terminalMarkerSeen && postAudioCommand.visualDiffPixels >= 2_000,
      "post-restore aplay did not produce guest-visible terminal output");
    if (diagnostic?.complete) {
      assert.deepEqual(browserErrors, [], "unexpected browser console/page errors");
      assert.deepEqual(httpErrors, [], "unexpected browser HTTP errors");
    }
  } catch (error) {
    await captureFailure("post-restore", error);
    throw error;
  }
  let deferredInteractionCap = null;
  if (diagnostic?.complete) {
    milestones.postRestoreInteractionChecks = { functionalChecksPassed: true, timingPassed: false, checksPassed: false };
  }
  // This try contains ONLY the original final cap. Every functional assertion stays fail-fast.
  try {
    assert.ok(postRestoreEnd - postRestoreStart <= 2_000, "post-restore interaction exceeded 2 seconds");
  } catch (error) {
    if (!diagnostic?.complete) {
      await captureFailure("post-restore", error);
      throw error;
    }
    deferredInteractionCap = retainDeferredInteractionCap(error, postRestoreStart, postRestoreEnd);
    await captureFailure("diagnostic-completion-timing", error);
    startProgressSampling(); // captureFailure stops sampling; later audit/drag phases still need it.
  }
  if (diagnostic?.complete) {
    milestones.postRestoreInteractionChecks.timingPassed = deferredInteractionCap === null;
    milestones.postRestoreInteractionChecks.checksPassed = deferredInteractionCap === null;
  }
  phaseProgress("post-restore:interaction-checks", deferredInteractionCap ? "timing-failed-continuing" : "done");

  await auditRestoreCoherence(firstRestore, normalSnapshot, "normal");
  if (diagnostic?.complete) milestones.normalRestore.functionalChecksPassed = true;
  milestones.normalRestore.checksPassed = deferredInteractionCap === null;

  if (diagnostic && !diagnostic.complete) {
    phaseProgress("diagnostic:iteration-evidence");
    assert.deepEqual(browserErrors, [], "unexpected browser console/page errors");
    assert.deepEqual(httpErrors, [], "unexpected browser HTTP errors");
    await mkdir(out, { recursive: true });
    await page.screenshot({ path: path.join(out, "diagnostic-iteration.png"), fullPage: true });
    const result = { schema: "wasm-vm.e5-t26f.diagnostic-iteration.v1", acceptance: false,
      browser: browserIdentity, milestones, errors: { browser: browserErrors, http: httpErrors } };
    await writeFile(path.join(out, "diagnostic-iteration.json"), `${JSON.stringify(result, jsonReplacer, 2)}\n`);
    await writeFile(path.join(out, "diagnostic-iteration-server.log"), serverOutput);
    console.log(JSON.stringify(result, jsonReplacer, 2));
  } else {
  phaseProgress("drag:prepare");
  const dragChrome = await page.evaluate(readTopmostDragTitlebar);
  assert.ok(dragChrome?.titlebar, "drag snapshot has no detected titlebar");
  // The 32px Weston panel may cover most of the top titlebar. Its bottom rows
  // remain visible; do not aim at the obscured middle of the decoration.
  const dragY = dragChrome.titlebar.bottom - 3;
  assert.ok(dragY >= 32 && dragY > dragChrome.titlebar.top, "drag titlebar is obscured by the panel");
  // Failure screenshots/readiness UI can change layout after the timed interaction.
  // Map the drag through the current canvas box, not the earlier focus box.
  const dragBox = await desktopBox();
  const dragStart = guestPoint(dragBox, dragChrome.titlebar.left + 100, dragY);
  const dragEnd = guestPoint(dragBox, dragChrome.titlebar.left + 180, dragY);
  milestones.dragMapping = { canvasBox: dragBox, start: dragStart, end: dragEnd,
    guestStart: { x: dragChrome.titlebar.left + 100, y: dragY },
    guestEnd: { x: dragChrome.titlebar.left + 180, y: dragY } };
  await page.mouse.move(dragStart.x, dragStart.y);
  await page.waitForTimeout(100);
  phaseProgress("drag:prepare", "done");
  phaseProgress("snapshot:drag-before");
  const beforeDragSnapshot = await page.evaluate(() => window.__desktopTerminal.saveDesktopSnapshot({ persist: false }));
  assert.match(beforeDragSnapshot.sha256, SHA256);
  milestones.dragBeforeSnapshot = { sha256: beforeDragSnapshot.sha256, byteLength: beforeDragSnapshot.byteLength };
  if (diagnostic?.complete) await recordCompletionGeneration("dragBeforeSnapshot", beforeDragSnapshot);
  phaseProgress("snapshot:drag-before", "done");
  phaseProgress("snapshot:drag-held");
  await page.mouse.down();
  await page.waitForTimeout(100);
  const heldDragSnapshot = await page.evaluate(() => window.__desktopTerminal.saveDesktopSnapshot({ persist: false }));
  assert.match(heldDragSnapshot.sha256, SHA256);
  milestones.dragHeldSnapshot = { sha256: heldDragSnapshot.sha256, byteLength: heldDragSnapshot.byteLength };
  if (diagnostic?.complete) await recordCompletionGeneration("dragHeldSnapshot", heldDragSnapshot);
  phaseProgress("snapshot:drag-held", "done");
  phaseProgress("snapshot:drag-moving");
  await page.mouse.move(dragEnd.x, dragEnd.y);
  await proveAndPauseDrag(dragChrome.titlebar);
  // saveDesktopSnapshot preserves an already-paused controller. Do not run the guest
  // after publishing this paired checkpoint: later durable writes correctly make it stale.
  const dragSnapshot = await page.evaluate(() => window.__desktopTerminal.saveDesktopSnapshot({ persist: true }));
  milestones.dragSnapshot = {
    sha256: dragSnapshot.sha256, byteLength: dragSnapshot.byteLength,
    preFrontBufferCrc: dragSnapshot.preFrontBufferCrc, machineResume: dragSnapshot.machineResume,
  };
  if (diagnostic?.complete) await recordCompletionGeneration("dragSnapshot", dragSnapshot);
  await auditFrozenDragSnapshot(dragSnapshot, "Published");
  phaseProgress("snapshot:drag-moving", "done");
  phaseProgress("snapshot:drag-released");
  await page.mouse.up();
  await page.waitForTimeout(100);
  const releasedDragSnapshot = await page.evaluate(() => window.__desktopTerminal.saveDesktopSnapshot({ persist: false }));
  assert.match(releasedDragSnapshot.sha256, SHA256);
  assert.match(dragSnapshot.sha256, SHA256);
  assert.ok(dragSnapshot.byteLength > 0, "drag desktop snapshot is empty");
  milestones.dragReleasedSnapshot = { sha256: releasedDragSnapshot.sha256, byteLength: releasedDragSnapshot.byteLength };
  if (diagnostic?.complete) await recordCompletionGeneration("dragReleasedSnapshot", releasedDragSnapshot);
  phaseProgress("snapshot:drag-released", "done");

  if (diagnostic?.complete) await recordCompletionGeneration("beforeSecondReload");
  await auditFrozenDragSnapshot(dragSnapshot, "BeforeReload");
  const secondRestore = await reloadWithAutoRestore(restoreUrl, "drag");
  milestones.dragRestore = { result: secondRestore, displayChecksPassed: false, checksPassed: false };
  phaseProgress("restore:drag:display-and-button-checks");
  assert.equal(secondRestore.snapshotSha256, dragSnapshot.sha256, "drag snapshot was not restored");
  assert.equal(secondRestore.report?.fullRepairFrame, true, "drag restore did not publish a repair frame");
  assert.equal(secondRestore.observation.firstPresent.crc32, dragSnapshot.preFrontBufferCrc, "drag restore frame CRC changed");
  assert.equal(dragSnapshot.machineResume?.persisted, true, "drag snapshot lacks a whole-machine resume");
  assert.deepEqual(secondRestore.machineResume, dragSnapshot.machineResume, "drag resume metadata was not preserved through reload");
  assert.equal(secondRestore.resume.restored, true, "drag reload did not restore the whole-machine snapshot");
  assert.equal(secondRestore.bootStates.some(({ state }) => state === "booting"), false,
    "drag whole-machine resume unexpectedly entered the cold guest boot state");
  const afterDragState = await page.evaluate(() => ({
    pointer: window.__desktopTerminal.pointerState(),
    observation: window.__desktopTerminal.restoreObservation(),
    presentation: window.__desktopTerminal.presentation(),
  }));
  assert.deepEqual(afterDragState.pointer.heldButtons, [], "drag restore retained a pressed button");
  assert.ok(afterDragState.observation.firstPresent, "drag restore has no first-present observation");
  assert.ok(afterDragState.presentation.successfulPresents > 0, "drag restore has no presented frame");
  milestones.dragRestore.displayChecksPassed = true;
  phaseProgress("restore:drag:display-and-button-checks", "done");
  await auditRestoreCoherence(secondRestore, dragSnapshot, "drag");
  await proveRestoredGuestRelease();
  if (diagnostic?.complete) milestones.dragRestore.functionalChecksPassed = true;
  milestones.dragRestore.checksPassed = deferredInteractionCap === null;

  phaseProgress("evidence:write");
  await mkdir(out, { recursive: true });
  const screenshotName = diagnostic?.complete ? "diagnostic-completion.png" : "desktop-roundtrip.png";
  await page.screenshot({ path: path.join(out, screenshotName), fullPage: true });
  assert.deepEqual(browserErrors, [], "unexpected browser console/page errors");
  assert.deepEqual(httpErrors, [], "unexpected browser HTTP errors");
  const finalState = await page.evaluate(() => ({
    terminal: window.__desktopTerminal.state(),
    presentation: window.__desktopTerminal.presentation(),
    cursor: window.__desktopCursor.state(),
    restore: window.__desktopTerminal.restoreResult(),
  }));
  if (diagnostic?.complete) {
    // Reuse has no cold shell/agent/cursor probes and no Browser object. Preserve its actual
    // checkpoint provenance and persistent-context identity, without inventing cold evidence.
    await finishDiagnosticCompletion(browserIdentity, finalState, deferredInteractionCap);
  } else {
  const result = {
    schema: "wasm-vm.e5-t26f.browser-roundtrip.v1",
    task: "E5-T26f",
    head,
    milestones,
    scope: { browser: "local Chromium", webkit: false, independentMachines: false, hostRr: false },
    browser: { name: browser.browserType().name(), version: browser.version(), headless: launchOptions.headless },
    image: {
      imagePath: path.relative(repo, imagePath),
      imageSha256,
      imageBytes: imageStat.size,
      manifestPath: path.relative(repo, manifestPath),
      manifestSha256,
      chunkCount: manifest.chunks.length,
      chunkSize: manifest.chunk_size,
    },
    snapshots: {
      normal: { sha256: normalSnapshot.sha256, byteLength: normalSnapshot.byteLength, machineResume: normalSnapshot.machineResume, preFrontBufferCrc: normalSnapshot.preFrontBufferCrc, preSuccessfulPresents: preSnapshotPresents },
      dragPhases: {
        before: { sha256: beforeDragSnapshot.sha256, byteLength: beforeDragSnapshot.byteLength },
        held: { sha256: heldDragSnapshot.sha256, byteLength: heldDragSnapshot.byteLength },
        moving: { sha256: dragSnapshot.sha256, byteLength: dragSnapshot.byteLength, machineResume: dragSnapshot.machineResume, preFrontBufferCrc: dragSnapshot.preFrontBufferCrc },
        released: { sha256: releasedDragSnapshot.sha256, byteLength: releasedDragSnapshot.byteLength },
      },
      duringDrag: { sha256: dragSnapshot.sha256, byteLength: dragSnapshot.byteLength, preFrontBufferCrc: dragSnapshot.preFrontBufferCrc },
    },
    restores: {
      normal: firstRestore,
      duringDrag: secondRestore,
    },
    interactions: {
      shellProbe,
      agentProbe,
      firstCommand,
      postAudioCommand,
      cursor: cursorProof,
      postRestore: postRestoreInteraction,
      postRestoreAudioBefore: audioBefore,
      postRestoreAudioAfter: postAudioAfter,
      postRestoreCursor,
      postRestoreAudioRenderedFrameDelta: postAudioAfter.renderedFrames - postAudioBefore.renderedFrames,
      postRestoreElapsedMeasuredMs: postRestoreEnd - postRestoreStart,
      dragButtonReleased: afterDragState.pointer.heldButtons.length === 0,
    },
    final: finalState,
    errors: { browser: browserErrors, http: httpErrors },
    elapsedMs: Date.now() - startedAt,
  };
  await writeFile(path.join(out, "desktop-roundtrip.json"), `${JSON.stringify(result, jsonReplacer, 2)}\n`);
  await writeFile(path.join(out, "desktop-roundtrip-server.log"), serverOutput);
  phaseProgress("evidence:write", "done");
  console.log(JSON.stringify(result, jsonReplacer, 2));
  }
  }
  }
} catch (error) {
  // Only the identical cap already written into the complete functional report is propagated
  // without recapturing it as an evidence-writing failure. Other errors still fail closed.
  if (error === reportedCompletionTimingFailure && error !== null) throw error;
  const phase = lastPhase?.phase || "setup";
  phaseProgress(phase, "failed");
  const label = `failure-${phase.replace(/[^a-zA-Z0-9_.-]/gu, "-")}`;
  await captureFailure(label, error).catch((captureError) => {
    console.error(`[e5-t26f] ${JSON.stringify({
      timestamp: new Date().toISOString(), phase, event: "capture-error",
      error: String(captureError?.message || captureError).slice(0, 240),
    })}`);
  });
  throw error;
} finally {
  stopProgressSampling();
  if (cpuProfiler) await stopCpuProfile("cleanup-after-failure");
  if (interactionLatencyActive) await stopInteractionLatencyProbe("cleanup");
  await context?.close().catch(() => {});
  await browser?.close().catch(() => {});
  if (server) {
    try { process.kill(-server.pid, "SIGTERM"); } catch (error) { if (error?.code !== "ESRCH") throw error; }
    await sleep(300);
    server.unref();
  }
}
