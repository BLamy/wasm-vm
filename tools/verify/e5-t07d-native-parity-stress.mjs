#!/usr/bin/env node

// E5-T07d: native null-sink parity plus bounded Chromium fbcon stress.  This proof intentionally
// stays on the local host and Chromium: independent machines, WebKit, and host rr are outside the
// task boundary.  The native probe is compared with the checked-in T07a fixture; the stress run
// proves the one-million-byte tty0 boundary, 100 VT switches, and clean browser reload lifecycle.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync, spawn } from "node:child_process";
import { createServer } from "node:net";
import fs from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { finished } from "node:stream/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const web = path.join(repo, "web");
const evidenceDir = path.join(repo, "evidence/e5-t07d");
const cli = path.join(repo, "target/release/wasm-vm");
const kernel = path.join(repo, "releases/kernel/6.6.63/Image");
const initrd = path.join(repo, "releases/initramfs/initramfs.cpio.gz");
const fixture = path.join(repo, "tests/fixtures/gpu-probe.log");
const requestedBase = process.env.E5_T07D_BASE_URL?.replace(/\/$/u, "") || null;
const requestedPort = Number(process.env.E5_T07D_PORT || 0);
const outputPath = parseOutputPath(process.argv.slice(2));
let port = requestedPort;
let server = null;

const NATIVE_SCROLL_PREFIX = "dd if=/dev/zero bs=1000000 count=1 of=/dev/tty0";
const NATIVE_STRESS_COMMAND =
  `${NATIVE_SCROLL_PREFIX}; printf 'E5-T07D\\n' > /dev/tty0; echo E5T07D_SCROLL_OK; ` +
  `i=0; while [ \"$i\" -lt 100 ]; do chvt 1; i=$((i + 1)); done; ` +
  "echo E5T07D_VT_OK; poweroff -f\n";
const BROWSER_SCROLL_COMMAND =
  `${NATIVE_SCROLL_PREFIX}; printf 'E5-T07D\\n' > /dev/tty0; echo E5T07D_SCROLL_OK\n`;
const BROWSER_VT_COMMAND =
  "i=0; while [ \"$i\" -lt 100 ]; do chvt 1; i=$((i + 1)); done; echo E5T07D_VT_OK\n";

function parseOutputPath(args) {
  const index = args.indexOf("--output");
  if (index >= 0) {
    if (!args[index + 1]) throw new Error("--output requires a path");
    return path.resolve(repo, args[index + 1]);
  }
  const equals = args.find((arg) => arg.startsWith("--output="));
  return equals ? path.resolve(repo, equals.slice("--output=".length)) : null;
}

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function requireFile(file) {
  await fs.stat(file).catch(() => {
    throw new Error(`missing required proof input: ${path.relative(repo, file)}`);
  });
}

async function allocatePort() {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      probe.close((error) => error ? reject(error) : resolve(address.port));
    });
  });
}

async function startServer() {
  if (requestedBase) return;
  if (port === 0) port = await allocatePort();
  server = spawn("bash", ["tools/serve-dev.sh", String(port)], {
    cwd: repo,
    stdio: ["ignore", "ignore", "inherit"],
    detached: true,
  });
  const base = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${base}/tty0-stress.html`, { cache: "no-store" });
      if (response.ok) return;
    } catch {}
    await sleep(100);
  }
  throw new Error(`dev server did not start at ${base}`);
}

async function stopServer() {
  if (!server) return;
  const child = server;
  server = null;
  try {
    process.kill(-child.pid, "SIGTERM");
  } catch (error) {
    if (error?.code !== "ESRCH") throw error;
  }
  await sleep(300);
  child.unref();
}

function parseTrace(text) {
  const lines = text.trimEnd().split("\n");
  assert.equal(lines[0], "wasm-vm virtio-gpu command trace v1");
  const summary = /^records=(\d+) dropped=(\d+)$/u.exec(lines[1]);
  assert.ok(summary, "trace summary must be present");
  const records = lines.slice(2).map((line, index) => {
    const match =
      /^seq=(\d+) command=([A-Z0-9_]+)\((0x[0-9a-f]+)\) response=([A-Z0-9_]+)\((0x[0-9a-f]+)\) scanout=(-|\d+) resource=(-|\d+) dimensions=(-|\d+x\d+) avail=(\d+) used=(\d+) head=(\d+) len=(\d+)$/u.exec(
        line,
      );
    assert.ok(match, `trace line ${index + 3} has the canonical shape`);
    return {
      sequence: Number(match[1]),
      command: match[2],
      commandType: Number.parseInt(match[3], 16),
      response: match[4],
      responseType: Number.parseInt(match[5], 16),
      scanout: match[6] === "-" ? null : Number(match[6]),
      resource: match[7] === "-" ? null : Number(match[7]),
      dimensions: match[8],
      avail: Number(match[9]),
      used: Number(match[10]),
      head: Number(match[11]),
      length: Number(match[12]),
    };
  });
  assert.equal(Number(summary[1]), records.length, "trace record count matches its header");
  assert.equal(Number(summary[2]), 0, "native parity trace did not drop a command");
  for (const [index, record] of records.entries()) {
    assert.equal(record.sequence, index, `trace sequence is contiguous at ${index}`);
    assert.equal(record.avail, (index + 1) & 0xffff, `avail progress at ${index}`);
    assert.equal(record.used, (index + 1) & 0xffff, `used progress at ${index}`);
  }
  return records;
}

function normalizeRecord(record) {
  return {
    sequence: record.sequence,
    command: record.command,
    commandType: record.commandType,
    response: record.response,
    responseType: record.responseType,
    scanout: record.scanout,
    resource: record.resource,
    dimensions: record.dimensions,
    avail: record.avail,
    used: record.used,
    head: record.head,
    length: record.length,
  };
}

function capture(file) {
  const stream = createWriteStream(file, { flags: "w" });
  let text = "";
  let bytes = 0;
  return {
    stream,
    feed(chunk) {
      const value = Buffer.from(chunk);
      bytes += value.byteLength;
      stream.write(value);
      text += value.toString("utf8");
      if (text.length > 2_500_000) text = text.slice(-2_000_000);
    },
    get text() { return text; },
    get bytes() { return bytes; },
    async close() {
      stream.end();
      await finished(stream);
    },
  };
}

async function runNative({ args, stdoutPath, stderrPath, inputCommand = null, timeoutMs = 15 * 60 * 1000 }) {
  const stdout = capture(stdoutPath);
  const stderr = capture(stderrPath);
  const child = spawn(cli, args, { cwd: repo, stdio: ["pipe", "pipe", "pipe"] });
  let sent = false;
  let timedOut = false;
  let spawnError = null;
  const timer = setTimeout(() => {
    timedOut = true;
    child.kill("SIGTERM");
  }, timeoutMs);
  child.stdout.on("data", (chunk) => {
    stdout.feed(chunk);
    if (!sent && inputCommand && stdout.text.includes("~ # ")) {
      sent = true;
      child.stdin.write(inputCommand);
    }
  });
  child.stderr.on("data", (chunk) => stderr.feed(chunk));
  child.on("error", (error) => { spawnError = error; });
  if (!inputCommand) child.stdin.end();
  const outcome = await new Promise((resolve) => {
    child.on("close", (code, signal) => resolve({ code, signal }));
  });
  clearTimeout(timer);
  await Promise.all([stdout.close(), stderr.close()]);
  if (spawnError) throw spawnError;
  return {
    ...outcome,
    sent,
    timedOut,
    stdout: stdout.text,
    stderr: stderr.text,
    stdoutBytes: stdout.bytes,
    stderrBytes: stderr.bytes,
  };
}

function attachErrorCapture(page, errors) {
  page.on("console", (message) => {
    if (message.type() !== "error" || message.location().url.includes("/favicon.ico")) return;
    errors.console.push({ text: message.text(), location: message.location() });
  });
  page.on("pageerror", (error) => errors.page.push(error.message));
  page.on("requestfailed", (request) => {
    if (request.url().includes("/favicon.ico")) return;
    errors.requests.push({
      url: request.url(),
      failure: request.failure()?.errorText || "unknown",
    });
  });
}

async function sha256File(relative) {
  const bytes = await fs.readFile(path.join(repo, relative));
  return createHash("sha256").update(bytes).digest("hex");
}

async function sourceDistParity() {
  const files = ["tty0-stress.html", "tty0-stress.js", "roadmap.js"];
  for (const relative of files) {
    const source = await fs.readFile(path.join(web, relative), "utf8");
    const dist = await fs.readFile(path.join(web, "dist", relative), "utf8");
    assert.equal(dist, source, `web/dist/${relative} is stale`);
  }
  return { equal: true, files: files.map((file) => `web/dist/${file}`) };
}

async function bundleIdentity() {
  const files = [
    "web/tty0-stress.html",
    "web/tty0-stress.js",
    "web/loader.js",
    "web/src/sink/presentation.js",
    "web/src/sink/canvas2d.js",
    "web/src/sink/present-backend.js",
    "web/pkg/wasm_vm_wasm_bg.wasm",
  ];
  const hash = createHash("sha256");
  for (const relative of files) hash.update(await fs.readFile(path.join(repo, relative)));
  return { sha256: hash.digest("hex"), files };
}

function proofFromPage(page) {
  return page.evaluate(() => {
    const proof = globalThis.__tty0StressProof?.();
    if (proof) return proof;
    const raw = document.documentElement.dataset.tty0StressProof;
    return raw ? JSON.parse(raw) : null;
  });
}

function assertStressProof(proof, { queueDelayMs, seed }) {
  assert.ok(proof, "tty0 stress route did not publish a proof");
  assert.equal(proof.route, "tty0-stress");
  assert.equal(proof.backend, "canvas2d");
  assert.deepEqual(proof.canvas, { width: 1280, height: 800 });
  assert.equal(proof.seed, seed);
  assert.equal(proof.queueDelayMs, queueDelayMs);
  assert.deepEqual(proof.markers, { virtioGpu: true, drm: true, fbcon: true }, "Linux display markers");
  assert.equal(proof.scrollBytesRequested, 1_000_000);
  assert.equal(proof.scrollCommandObserved, true, "one-million-byte tty0 command was not echoed");
  assert.equal(proof.scrollBytesReported, true, "guest dd did not report one million bytes");
  assert.equal(proof.scrollMarkerObserved, true, "scroll completion marker missing");
  assert.equal(proof.promptAfterScroll, true, "shell prompt did not return after tty0 scroll");
  assert.equal(proof.vtSwitchesRequested, 100);
  assert.equal(proof.vtMarkerObserved, true, "VT completion marker missing");
  assert.equal(proof.promptAfterVt, true, "shell prompt did not return after VT loop");
  assert.ok(proof.finalModel.nonBlackPixels > 0, "reference surface has no visible sentinel");
  assert.deepEqual(proof.finalActual, proof.finalModel, "canvas region statistics differ from reference");
  assert.equal(proof.referenceMatchesCanvas, true, "final canvas differs from independent reference");
  assert.equal(proof.mismatchBytes, 0, "reference/canvas byte mismatch");
  assert.equal(proof.modelRgbaSha256, proof.canvasRgbaSha256, "reference/canvas digest mismatch");
  assert.match(proof.modelRgbaSha256, /^[0-9a-f]{64}$/u);
  assert.ok(proof.frameCount > 0, "no FrameSink callback arrived");
  assert.ok(proof.fullFrameCount >= 1, "first frame did not establish the full surface");
  assert.ok(proof.partialFrameCount > 0, "no narrowed damage rectangle arrived");
  assert.ok(proof.largestPartialArea > 0 && proof.largestPartialArea < proof.fullArea, "partial rectangle is not smaller than the full resource");
  assert.equal(proof.outsideRectanglesPreserved, true, "partial present changed pixels outside its rectangle");
  assert.equal(proof.frameSequenceContiguous, true, "duplicate or skipped callback sequence");
  assert.equal(proof.resourceDimensionsStable, true, "resource dimensions changed during the proof");
  assert.equal(proof.traceDropped, 0, "frame trace digest dropped an event");
  assert.ok(proof.traceStored > 0 && proof.traceStored <= proof.traceCapacity, "bounded frame sample is invalid");
  assert.match(proof.traceDigest, /^[0-9a-f]{16}$/u);
  assert.ok(proof.frameTrace.every((entry) => entry.format === 2 && entry.reached), "frame metadata or presentation result failed");
  assert.equal(proof.presentation.framesReceived, proof.frameCount, "presentation callback count mismatch");
  assert.equal(proof.presentation.successfulPresents, proof.frameCount, "a callback did not reach Canvas2D");
  assert.equal(proof.presentation.droppedFrames, 0, "presentation dropped a frame");
  assert.equal(proof.presentation.listenerCount, 2, "presentation listener leak or replacement");
  assert.deepEqual(proof.presentation.errors, [], "presentation backend error");
  assert.equal(proof.input.schedulerBytes, proof.input.expectedBytes, "guest input byte accounting mismatch");
  assert.equal(proof.input.schedulerCalls, 3, "stress sequence made duplicate input calls");
  assert.ok(Number.isSafeInteger(proof.queueLiveness.retiredInstructions) && proof.queueLiveness.retiredInstructions > 0, "guest queue did not retire instructions");
  assert.ok(Number.isSafeInteger(proof.queueLiveness.slices) && proof.queueLiveness.slices > 0, "scheduler made no progress slices");
  assert.ok(Number.isSafeInteger(proof.queueLiveness.mainThreadYields) && proof.queueLiveness.mainThreadYields > 0, "guest loop stalled the main thread");
  assert.equal(proof.paused, true, "proof did not finish at a paused deterministic boundary");
  assert.ok(Number.isFinite(proof.scrollStartedAt) && Number.isFinite(proof.scrollFinishedAt), "stress timing missing");
}

const result = {
  task: "E5-T07d",
  schema: 1,
  command: "node tools/verify/e5-t07d-native-parity-stress.mjs",
  generatedAt: new Date().toISOString(),
  gitHead: execFileSync("git", ["rev-parse", "HEAD"], { cwd: repo, encoding: "utf8" }).trim(),
  base: null,
  sourceDistParity: null,
  artifacts: null,
  native: null,
  browser: null,
  parity: null,
  stress: null,
  reload: null,
  errors: { auto: { console: [], page: [], requests: [] }, attack: { console: [], page: [], requests: [] }, reload: { console: [], page: [], requests: [] } },
  screenshot: null,
};

let browser = null;
try {
  await Promise.all([requireFile(cli), requireFile(kernel), requireFile(initrd), requireFile(fixture)]);
  await fs.mkdir(evidenceDir, { recursive: true });

  const fixtureText = await fs.readFile(fixture, "utf8");
  const fixtureRecords = parseTrace(fixtureText);
  const probeTracePath = path.join(evidenceDir, "native-probe-gpu.log");
  const probe = await runNative({
    args: [
      "boot", "--kernel", kernel, "--initrd", initrd,
      "--append", "console=ttyS0 earlycon=sbi",
      "--gpu-trace", probeTracePath,
      "--evidence", path.join(evidenceDir, "native-probe-guest-evidence.txt"),
      "--profile-boot", "--no-input", "--no-reboot",
      "--max-instrs", "8000000000", "--quantum", "200000",
    ],
    stdoutPath: path.join(evidenceDir, "native-probe-console.log"),
    stderrPath: path.join(evidenceDir, "native-probe-stderr.log"),
  });
  assert.equal(probe.code, 0, `native parity probe exited ${probe.code}; inspect its evidence`);
  assert.equal(probe.signal, null);
  assert.equal(probe.timedOut, false);
  assert.match(probe.stdout, /userland up/u, "native parity probe did not reach userland");
  assert.match(probe.stderr, /profile complete \(stopped at userland marker\)/u);
  const probeRecords = parseTrace(await fs.readFile(probeTracePath, "utf8"));
  assert.deepEqual(
    probeRecords.map(normalizeRecord),
    fixtureRecords.map(normalizeRecord),
    "native probe diverged from the checked-in T07a terminal fixture",
  );
  const create = probeRecords.find((record) => record.command === "RESOURCE_CREATE_2D");
  assert.equal(create?.dimensions, "1280x800");
  result.native = {
    probe: {
      exitCode: probe.code,
      records: probeRecords.length,
      trace: path.relative(repo, probeTracePath),
      traceSha256: await sha256File(path.relative(repo, probeTracePath)),
      guestEvidence: path.relative(repo, "evidence/e5-t07d/native-probe-guest-evidence.txt"),
      console: path.relative(repo, "evidence/e5-t07d/native-probe-console.log"),
      stderr: path.relative(repo, "evidence/e5-t07d/native-probe-stderr.log"),
    },
  };

  const stress = await runNative({
    args: [
      "boot", "--kernel", kernel, "--initrd", initrd,
      "--append", "console=tty0 console=ttyS0 earlycon=sbi",
      "--evidence", path.join(evidenceDir, "native-stress-guest-evidence.txt"),
      "--jit", "--no-reboot", "--max-instrs", "40000000000", "--quantum", "200000",
    ],
    inputCommand: NATIVE_STRESS_COMMAND,
    stdoutPath: path.join(evidenceDir, "native-stress-console.log"),
    stderrPath: path.join(evidenceDir, "native-stress-stderr.log"),
  });
  assert.equal(stress.code, 0, `native stress exited ${stress.code}; inspect its transcript`);
  assert.equal(stress.signal, null);
  assert.equal(stress.timedOut, false);
  assert.equal(stress.sent, true, "native stress never reached the shell prompt");
  assert.match(stress.stdout, /wasm-vm initramfs: busybox userland up/u);
  assert.match(stress.stdout, /1000000 bytes/u, "native dd did not report one million bytes");
  assert.match(stress.stdout, /E5T07D_SCROLL_OK/u);
  assert.match(stress.stdout, /E5T07D_VT_OK/u);
  assert.match(stress.stdout, /reboot: Power down/u);
  assert.match(stress.stderr, /wasm-vm: guest exited 0/u);
  assert.doesNotMatch(stress.stderr, /NEEDS_RESET|reset loop|panic|deadlock/u);
  const nativeEvidence = await fs.readFile(path.join(evidenceDir, "native-stress-guest-evidence.txt"), "utf8");
  const retired = /^trace retired=(\d+)$/mu.exec(nativeEvidence);
  assert.ok(retired && Number(retired[1]) > 0, "native stress guest evidence has no retired-instruction count");
  assert.match(nativeEvidence, /^outcome=(?:Reset\(PowerOff\)|Exited\(0\))$/mu, "native stress did not record a clean shutdown");
  result.native.stress = {
    exitCode: stress.code,
    command: NATIVE_STRESS_COMMAND.trimEnd(),
    scrollBytesRequested: 1_000_000,
    vtSwitchesRequested: 100,
    markers: { scroll: true, vt: true, poweroff: true },
    termination: nativeEvidence.match(/^outcome=(.+)$/mu)?.[1] || null,
    guestEvidence: path.relative(repo, "evidence/e5-t07d/native-stress-guest-evidence.txt"),
    guestEvidenceSha256: await sha256File("evidence/e5-t07d/native-stress-guest-evidence.txt"),
    console: path.relative(repo, "evidence/e5-t07d/native-stress-console.log"),
    consoleSha256: await sha256File("evidence/e5-t07d/native-stress-console.log"),
    stderr: path.relative(repo, "evidence/e5-t07d/native-stress-stderr.log"),
  };

  await startServer();
  result.base = requestedBase || `http://127.0.0.1:${port}`;
  result.sourceDistParity = await sourceDistParity();
  const manifest = JSON.parse(await fs.readFile(path.join(web, "artifacts.json"), "utf8"));
  const kernelArtifact = manifest.artifacts.kernel;
  const initrdArtifact = manifest.artifacts.initramfs;
  result.artifacts = {
    manifestSha256: await sha256File("web/artifacts.json"),
    kernel: { ...kernelArtifact, actualSha256: await sha256File("releases/kernel/6.6.63/Image") },
    initramfs: { ...initrdArtifact, actualSha256: await sha256File("releases/initramfs/initramfs.cpio.gz") },
    webBundle: await bundleIdentity(),
  };
  assert.equal(result.artifacts.kernel.actualSha256, kernelArtifact.sha256, "kernel manifest digest is stale");
  assert.equal(result.artifacts.initramfs.actualSha256, initrdArtifact.sha256, "initramfs manifest digest is stale");

  const { chromium } = await import(pathToFileURL(path.join(web, "node_modules/playwright/index.mjs")).href);
  browser = await chromium.launch({
    headless: process.env.E5_T07D_HEADED !== "1",
    args: ["--disable-dev-shm-usage", "--use-angle=swiftshader"],
    ...(process.env.E5_T07D_CHROME_PATH ? { executablePath: process.env.E5_T07D_CHROME_PATH } : {}),
  });
  result.browser = { name: "Chromium", version: browser.version(), executablePath: process.env.E5_T07D_CHROME_PATH || "Playwright Chromium" };
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  attachErrorCapture(page, result.errors.auto);
  try {
    await page.goto(`${result.base}/tty0-stress.html?seed=17&queueDelayMs=0`, { waitUntil: "domcontentloaded", timeout: 30_000 });
    await page.waitForFunction(() => document.documentElement.dataset.tty0StressBackend === "canvas2d", null, { timeout: 30_000 });
    await page.waitForFunction(() => ["ready", "error"].includes(document.documentElement.dataset.tty0Stress), null, { timeout: 900_000 });
    const proof = await proofFromPage(page);
    assertStressProof(proof, { queueDelayMs: 0, seed: "17" });
    result.stress = proof;
    const screenshot = path.join(evidenceDir, "tty0-stress.png");
    await page.screenshot({ path: screenshot, fullPage: true });
    result.screenshot = path.relative(repo, screenshot);
  } finally {
    await context.close();
  }

  const attackContext = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  const attackPage = await attackContext.newPage();
  attachErrorCapture(attackPage, result.errors.attack);
  try {
    await attackPage.goto(`${result.base}/tty0-stress.html?seed=23&queueDelayMs=1`, { waitUntil: "domcontentloaded", timeout: 30_000 });
    await attackPage.waitForFunction(() => document.documentElement.dataset.tty0StressBackend === "canvas2d", null, { timeout: 30_000 });
    await attackPage.waitForFunction(() => ["ready", "error"].includes(document.documentElement.dataset.tty0Stress), null, { timeout: 900_000 });
    result.parity = { attack: await proofFromPage(attackPage) };
    assertStressProof(result.parity.attack, { queueDelayMs: 1, seed: "23" });
  } finally {
    await attackContext.close();
  }

  const reloadContext = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  const reloadPage = await reloadContext.newPage();
  attachErrorCapture(reloadPage, result.errors.reload);
  try {
    await reloadPage.goto(`${result.base}/tty0-stress.html?manual=1&seed=31&queueDelayMs=1`, { waitUntil: "domcontentloaded", timeout: 30_000 });
    await reloadPage.waitForFunction(() => document.documentElement.dataset.tty0StressBackend === "canvas2d", null, { timeout: 30_000 });
    await reloadPage.waitForFunction(() => document.documentElement.dataset.tty0StressManual === "ready", null, { timeout: 900_000 });
    await reloadPage.evaluate((command) => {
      const bytes = new TextEncoder().encode(command);
      window.__tty0StressController.pause();
      window.__tty0StressController.sendInput(bytes);
      window.__tty0StressController.resume();
    }, BROWSER_SCROLL_COMMAND);
    await reloadPage.waitForFunction(() => window.__tty0StressProgress?.().scheduler?.inputCalls >= 1, null, { timeout: 30_000 });
    const interrupted = await reloadPage.evaluate(() => window.__tty0StressProgress());
    await sleep(75);
    await reloadPage.reload({ waitUntil: "domcontentloaded", timeout: 30_000 });
    await reloadPage.waitForFunction(() => document.documentElement.dataset.tty0StressBackend === "canvas2d", null, { timeout: 30_000 });
    await reloadPage.waitForFunction(() => document.documentElement.dataset.tty0StressManual === "ready", null, { timeout: 900_000 });
    const fresh = await reloadPage.evaluate(() => window.__tty0StressProgress());
    assert.equal(interrupted.manual, true);
    assert.ok(interrupted.scheduler.inputCalls >= 1, "manual interruption did not send input");
    assert.equal(fresh.manual, true);
    assert.equal(fresh.manualReady, true, "reloaded route did not reach a clean manual boundary");
    assert.equal(fresh.scheduler.inputCalls, 0, "reloaded controller inherited input calls");
    assert.equal(fresh.scheduler.inputBytes, 0, "reloaded controller inherited input bytes");
    assert.ok(fresh.frameCount > 0, "reloaded route did not receive a fresh framebuffer");
    assert.deepEqual(fresh.markers, { virtioGpu: true, drm: true, fbcon: true });
    result.reload = { interrupted, fresh, command: BROWSER_SCROLL_COMMAND.trimEnd() };
  } finally {
    await reloadContext.close();
  }

  result.parity = {
    ...(result.parity || {}),
    nativeFixtureRecords: fixtureRecords.length,
    nativeProbeRecords: probeRecords.length,
    nativeProbeMatchesFixture: true,
    framebuffer: "1280x800",
    hostOnlyFieldsIgnored: ["timestamps", "native process/JIT diagnostics"],
  };
  assert.deepEqual(result.errors, {
    auto: { console: [], page: [], requests: [] },
    attack: { console: [], page: [], requests: [] },
    reload: { console: [], page: [], requests: [] },
  }, `browser errors: ${JSON.stringify(result.errors)}`);

  if (outputPath) {
    await fs.mkdir(path.dirname(outputPath), { recursive: true });
    await fs.writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`);
    console.log(`wrote ${outputPath}`);
  } else {
    console.log(JSON.stringify(result));
  }
} finally {
  await browser?.close().catch(() => {});
  await stopServer();
}
