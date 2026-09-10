// Interactive real-guest diagnostics; not an acceptance substitute.
import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { createInterface } from "node:readline";
import { chromium } from "../../web/node_modules/playwright/index.mjs";
import { physicalStroke } from "./omarchy-browser-session.mjs";

const repo = process.cwd();
const wrapDiagnosticExec = (command) => `( ${String(command)}\n )`;
const positional = [];
const options = {};
for (let i = 2; i < process.argv.length; i += 1) {
  const arg = process.argv[i];
  if (!arg.startsWith("--")) { positional.push(arg); continue; }
  const key = arg.slice(2).replaceAll("-", "");
  if (key === "checkonly" || key === "profile" || key === "selftestcpuprofile") { options[key] = true; continue; }
  if (!["pairdirectory", "chunkmanifest", "chunkdir", "clickdelayms", "jitresidency", "decodedcacheentries", "jitthreshold"].includes(key)) {
    throw Error(`unknown diagnostic option: ${arg}`);
  }
  const value = process.argv[++i];
  if (!value || value.startsWith("--")) throw Error(`missing value for ${arg}`);
  options[key] = value;
}
const output = positional[0] ? path.resolve(positional[0]) : null;
const divider = positional[1] || "64";
if (!/^(1|2|4|8|16|32|64)$/u.test(divider)) throw Error("invalid diagnostic divider");
const jit = positional[2] || "1";
if (!/^[01]$/u.test(jit)) throw Error("invalid diagnostic JIT selector");
const jitResidency = options.jitresidency;
if (jitResidency !== undefined && !["repack-off", "cap-256"].includes(jitResidency)) {
  throw Error("invalid --jit-residency; expected repack-off or cap-256");
}
if (jitResidency !== undefined && positional[2] !== "1") {
  throw Error("--jit-residency requires the explicit diagnostic JIT selector 1");
}
const decodedCacheEntries = options.decodedcacheentries;
if (decodedCacheEntries !== undefined && !["4096", "16384"].includes(decodedCacheEntries)) {
  throw Error("invalid --decoded-cache-entries; expected 4096 or 16384");
}
const jitThreshold = options.jitthreshold;
if (jitThreshold !== undefined && !["1", "64", "512"].includes(jitThreshold)) {
  throw Error("invalid --jit-threshold; expected 1, 64, or 512");
}
if (!output && !options.checkonly) throw Error("diagnostic output directory is required");
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const CPU_PROFILE_MIN_MS = 10_000;
const CPU_PROFILE_MAX_MS = 30_000;
const CPU_PROFILE_COMMAND_TIMEOUT_MS = 10_000;
const CPU_PROFILE_NAME = /^[a-z0-9][a-z0-9._-]*\.cpuprofile$/u;
let nextCdpMessageId = 1;

function validateCpuProfileRequest(request) {
  const durationMs = Number(request.durationMs ?? (Number(request.durationSec) * 1000));
  if (!Number.isInteger(durationMs) || durationMs < CPU_PROFILE_MIN_MS || durationMs > CPU_PROFILE_MAX_MS) {
    throw Error("cpu-profile duration must be an integer from 10000 to 30000 ms");
  }
  if (typeof request.name !== "string" || !CPU_PROFILE_NAME.test(request.name)) {
    throw Error("cpu-profile name must be a simple .cpuprofile filename");
  }
  return { durationMs, name: request.name };
}

async function sendAttachedCdpCommand(cdp, sessionId, method, params = {}) {
  const id = nextCdpMessageId++;
  const message = JSON.stringify({ id, method, params });
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => finish(null, new Error(`${method}: CDP reply timed out after ${CPU_PROFILE_COMMAND_TIMEOUT_MS}ms`)), CPU_PROFILE_COMMAND_TIMEOUT_MS);
    const finish = (value, error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      cdp.removeListener("Target.receivedMessageFromTarget", onMessage);
      if (error) reject(error); else resolve(value);
    };
    const onMessage = (event) => {
      if (event.sessionId !== sessionId) return;
      let response;
      try { response = JSON.parse(event.message); } catch { return; }
      if (response.id !== id) return;
      if (response.error) finish(null, new Error(`${method}: ${response.error.message || "CDP error"}`));
      else finish(response.result ?? {}, null);
    };
    cdp.on("Target.receivedMessageFromTarget", onMessage);
    cdp.send("Target.sendMessageToTarget", { sessionId, message }).catch((error) => finish(null, error));
  });
}

function summarizeCpuProfile(profile, target, durationMs, filename) {
  const nodes = new Map((profile.nodes || []).map((node) => [node.id, node]));
  const hits = new Map();
  for (let i = 0; i < (profile.samples || []).length; i += 1) {
    const id = profile.samples[i];
    const deltaUs = Number(profile.timeDeltas?.[i] ?? 0);
    const row = hits.get(id) || { selfSamples: 0, selfTimeUs: 0 };
    row.selfSamples += 1;
    row.selfTimeUs += deltaUs;
    hits.set(id, row);
  }
  const self = [...hits.entries()].map(([id, hit]) => {
    const node = nodes.get(id);
    const callFrame = node?.callFrame || {};
    return {
      functionName: callFrame.functionName || "(anonymous)",
      url: callFrame.url || "",
      lineNumber: callFrame.lineNumber ?? null,
      columnNumber: callFrame.columnNumber ?? null,
      selfSamples: hit.selfSamples,
      selfTimeUs: hit.selfTimeUs,
    };
  }).sort((a, b) => b.selfTimeUs - a.selfTimeUs || b.selfSamples - a.selfSamples).slice(0, 50);
  return {
    schema: "wasm-vm.omarchy-input-diagnostic.cpu-profile-summary.v1",
    filename,
    durationMs,
    target,
    nodeCount: profile.nodes?.length ?? 0,
    sampleCount: profile.samples?.length ?? 0,
    self,
  };
}

async function captureWorkerCpuProfile(browser, output, request) {
  const { durationMs, name } = validateCpuProfileRequest(request);
  const profilePath = path.join(output, name);
  const summaryPath = path.join(output, name.replace(/\.cpuprofile$/u, ".summary.json"));
  for (const filename of [profilePath, summaryPath]) {
    if (await fs.lstat(filename).catch(() => null)) {
      throw Error(`cpu-profile output already exists: ${filename}`);
    }
  }
  const cdp = await browser.newBrowserCDPSession();
  let attached;
  try {
    const { targetInfos = [] } = await cdp.send("Target.getTargets");
    const targetInfo = targetInfos.find((info) => info.type === "worker" && /(?:^|\/)linux-worker\.js(?:[?#]|$)/u.test(info.url || ""));
    if (!targetInfo) {
      return {
        action: "cpu-profile", supported: false, reason: "linux-worker-target-unavailable",
        workerTargets: targetInfos.filter((info) => info.type === "worker").map(({ targetId, type, url, title }) => ({ targetId, type, url, title })),
      };
    }
    attached = await cdp.send("Target.attachToTarget", { targetId: targetInfo.targetId, flatten: false });
    const sessionId = attached.sessionId;
    const target = { targetId: targetInfo.targetId, type: targetInfo.type, url: targetInfo.url, title: targetInfo.title || "" };
    await sendAttachedCdpCommand(cdp, sessionId, "Profiler.enable");
    await sendAttachedCdpCommand(cdp, sessionId, "Profiler.setSamplingInterval", { interval: 1000 });
    await sendAttachedCdpCommand(cdp, sessionId, "Profiler.start");
    await new Promise((resolve) => setTimeout(resolve, durationMs));
    const { profile } = await sendAttachedCdpCommand(cdp, sessionId, "Profiler.stop");
    const summary = summarizeCpuProfile(profile, target, durationMs, name);
    await fs.writeFile(profilePath, JSON.stringify(profile));
    await fs.writeFile(summaryPath, JSON.stringify(summary, null, 2));
    return { action: "cpu-profile", supported: true, target, durationMs, profilePath, summaryPath, summary };
  } finally {
    if (attached?.sessionId) {
      await cdp.send("Target.detachFromTarget", { sessionId: attached.sessionId }).catch(() => {});
    }
    await cdp.detach().catch(() => {});
  }
}

if (options.selftestcpuprofile) {
  const valid = validateCpuProfileRequest({ durationMs: 10_000, name: "self-test.cpuprofile" });
  if (valid.durationMs !== 10_000 || valid.name !== "self-test.cpuprofile") throw Error("cpu-profile self-test valid request failed");
  for (const invalid of [
    { durationMs: 9_999, name: "bad.cpuprofile" },
    { durationMs: 30_001, name: "bad.cpuprofile" },
    { durationMs: 10_000, name: "../bad.cpuprofile" },
  ]) {
    try { validateCpuProfileRequest(invalid); throw Error("invalid cpu-profile request was accepted"); }
    catch (error) { if (error.message === "invalid cpu-profile request was accepted") throw error; }
  }
  const summary = summarizeCpuProfile({
    nodes: [{ id: 1, callFrame: { functionName: "workerHot", url: "linux-worker.js" } }],
    samples: [1, 1], timeDeltas: [100, 250],
  }, { targetId: "self-test", type: "worker", url: "linux-worker.js", title: "" }, 10_000, "self-test.cpuprofile");
  if (summary.self[0]?.functionName !== "workerHot" || summary.self[0]?.selfTimeUs !== 350) {
    throw Error("cpu-profile self-test summary aggregation failed");
  }
  console.log("cpu-profile-self-test-pass");
  process.exit(0);
}

const regularFile = async (filename, label) => {
  const info = await fs.stat(filename).catch(() => null);
  if (!info?.isFile()) throw Error(`${label} is not a regular file: ${filename}`);
  return filename;
};
const directory = async (filename, label) => {
  const info = await fs.stat(filename).catch(() => null);
  if (!info?.isDirectory()) throw Error(`${label} is not a directory: ${filename}`);
  return filename;
};

const candidateMode = Boolean(options.checkonly || options.pairdirectory || options.chunkmanifest || options.chunkdir);
let candidate = null;
if (candidateMode) {
  if (!options.checkonly && (!options.pairdirectory || !(options.chunkmanifest || options.chunkdir))) {
    throw Error("candidate mode requires --pair-directory and --chunk-manifest or --chunk-dir");
  }
  const pairDirectory = await directory(path.resolve(options.pairdirectory || "releases/boot-snapshot"), "candidate pair directory");
  let chunkManifest = path.resolve(options.chunkmanifest || (options.chunkdir
    ? path.join(options.chunkdir, "manifest.json") : "target/omarchy-profile-chunks-r2-256k/manifest.json"));
  const manifestInfo = await fs.stat(chunkManifest).catch(() => null);
  if (manifestInfo?.isDirectory()) chunkManifest = path.join(chunkManifest, "manifest.json");
  await regularFile(chunkManifest, "candidate chunk manifest");
  const chunkDir = path.resolve(options.chunkdir || path.dirname(chunkManifest));
  await directory(chunkDir, "candidate chunk directory");
  const nestedChunkDir = path.join(chunkDir, "chunks");
  const chunkFilesDir = (await fs.stat(nestedChunkDir).catch(() => null))?.isDirectory() ? nestedChunkDir : chunkDir;
  const manifestBytes = await fs.readFile(chunkManifest);
  let imageManifest;
  try { imageManifest = JSON.parse(manifestBytes); } catch (error) { throw Error(`invalid candidate chunk manifest: ${error}`); }
  if (!Array.isArray(imageManifest.chunks) || !imageManifest.chunks.length ||
      !imageManifest.chunks.every((name) => typeof name === "string" && /^[0-9a-f]{64}$/u.test(name))) {
    throw Error("candidate chunk manifest has no valid content-hash chunks");
  }
  const chunkNames = new Set(await fs.readdir(chunkFilesDir));
  const missing = imageManifest.chunks.find((name) => !chunkNames.has(`${name}.bin`));
  if (missing) throw Error(`candidate chunk is missing: ${path.join(chunkFilesDir, `${missing}.bin`)}`);
  const templatePath = path.join(repo, "web/artifacts-omarchy.json");
  const template = JSON.parse(await fs.readFile(templatePath, "utf8"));
  const kernelPath = path.resolve(repo, template.artifacts.kernel.url);
  const snapshotPath = path.join(pairDirectory, "omarchy-ready.snap.gz");
  const deltaPath = path.join(pairDirectory, "omarchy-overlay-delta.bin.gz");
  const sourceFiles = { kernel: kernelPath, bootSnapshot: snapshotPath, overlayDelta: deltaPath, chunkManifest };
  const source = {};
  for (const [name, filename] of Object.entries(sourceFiles)) {
    const bytes = await fs.readFile(await regularFile(filename, `candidate ${name}`));
    source[name] = { filename, size: bytes.length, sha256: hash(bytes) };
  }
  candidate = {
    pairDirectory, chunkDir: chunkFilesDir, chunkManifest, source,
    manifest: {
      generated: "LOCAL-ONLY diagnostic candidate (explicit real input pair; not a release claim)",
      artifacts: {
        kernel: { url: "/candidate/kernel", sha256: source.kernel.sha256, size: source.kernel.size },
        bootSnapshot: { url: "/candidate/boot-snapshot", sha256: source.bootSnapshot.sha256, size: source.bootSnapshot.size },
        overlayDelta: { url: "/candidate/overlay-delta", sha256: source.overlayDelta.sha256, size: source.overlayDelta.size },
      },
      chunkedImage: {
        key: `chunked-omarchy/manifest-${source.chunkManifest.sha256}.json`,
        sha256: source.chunkManifest.sha256,
        size: source.chunkManifest.size,
      },
    },
  };
}
if (options.checkonly) {
  console.log(JSON.stringify({
    result: "candidate-source-check-pass",
    label: candidate.manifest.generated,
    chunkManifestKey: candidate.manifest.chunkedImage.key,
    source: candidate.source,
  }));
  process.exit(0);
}
await fs.mkdir(output, { recursive: false });
const server = createServer(async (request, response) => {
  const pathname = new URL(request.url, "http://localhost").pathname;
  if (candidate && pathname === "/artifacts-omarchy.json") {
    response.writeHead(200, { "Content-Type": "application/json", "Cross-Origin-Opener-Policy": "same-origin", "Cross-Origin-Embedder-Policy": "require-corp" });
    response.end(JSON.stringify(candidate.manifest)); return;
  }
  let filename;
  if (candidate && pathname === "/candidate/kernel") filename = candidate.source.kernel.filename;
  else if (candidate && pathname === "/candidate/boot-snapshot") filename = candidate.source.bootSnapshot.filename;
  else if (candidate && pathname === "/candidate/overlay-delta") filename = candidate.source.overlayDelta.filename;
  else if (candidate && pathname === `/${candidate.manifest.chunkedImage.key}`) filename = candidate.chunkManifest;
  else if (candidate && pathname.startsWith("/chunked-omarchy/")) {
    const relative = pathname.slice("/chunked-omarchy/".length);
    const name = relative.startsWith("chunks/") ? relative.slice("chunks/".length).replace(/\.bin$/u, "") : "";
    if (!/^[0-9a-f]{64}$/u.test(name)) { response.writeHead(404).end(); return; }
    filename = path.join(candidate.chunkDir, `${name}.bin`);
  } else {
    const root = pathname.startsWith("/releases/") ? repo : path.join(repo, "web/dist");
    filename = path.resolve(root, `.${pathname}`);
    if (!filename.startsWith(root + path.sep)) { response.writeHead(403).end(); return; }
  }
  try {
    const bytes = await fs.readFile(filename);
    response.writeHead(200, { "Content-Type": filename.endsWith(".js") ? "text/javascript"
      : filename.endsWith(".json") ? "application/json" : filename.endsWith(".wasm") ? "application/wasm" : filename.endsWith(".html") ? "text/html" : "application/octet-stream",
      "Cross-Origin-Opener-Policy": "same-origin", "Cross-Origin-Embedder-Policy": "require-corp" });
    response.end(bytes);
  } catch { response.writeHead(404).end(); }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const browser = await chromium.launch({ headless: true, executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, serviceWorkers: "block" });
const history = [];
const port = server.address().port;
const defaultClickDelay = options.clickdelayms === undefined ? undefined : Number(options.clickdelayms);
if (defaultClickDelay !== undefined && (!Number.isInteger(defaultClickDelay) || defaultClickDelay < 0)) throw Error("invalid --click-delay-ms");
const lines = createInterface({ input: process.stdin });
try {
  const assetOverride = candidate ? `&omarchyAssetBase=${encodeURIComponent(`http://127.0.0.1:${port}`)}` : "";
  const residencyOverride = jitResidency === undefined ? "" : `&jitResidency=${encodeURIComponent(jitResidency)}`;
  const decodedCacheOverride = decodedCacheEntries === undefined ? "" : `&decodedCacheEntries=${encodeURIComponent(decodedCacheEntries)}`;
  const thresholdOverride = jitThreshold === undefined ? "" : `&jitThreshold=${encodeURIComponent(jitThreshold)}`;
  const profileOverride = options.profile ? "&profile=1" : "";
  await page.goto(`http://127.0.0.1:${port}/app.html?guest=omarchy&desktop=1&omarchyDivider=${divider}&jit=${jit}${residencyOverride}${decodedCacheOverride}${thresholdOverride}${profileOverride}${assetOverride}#ide`);
  await page.waitForFunction(() => window.wvmDemo?.isGuestReady?.(), null, { timeout: 120000 });
  const pageUrl = page.url();
  const sourceReceipt = candidate?.source ?? { kind: "web-dist", root: path.join(repo, "web/dist"), candidate: false };
  const controllerCapabilities = await page.evaluate(() => {
    const controller = window.__linuxCtl;
    return {
      profileStart: typeof controller?.setProfiling === "function",
      profileStop: typeof controller?.setProfiling === "function",
      profileTop: typeof controller?.profileStats === "function",
      clockState: typeof controller?.guestClockState === "function",
      clockDividerSelection: typeof controller?.icountDividerSelection === "function",
      clockDividerSetter: typeof controller?.setICountDivider === "function",
    };
  });
  const sessionReceipt = {
    pageUrl, sourceReceipt, jitResidency: jitResidency ?? null,
    decodedCacheEntries: decodedCacheEntries ?? null, jitThreshold: jitThreshold ?? null,
    profileRequested: Boolean(options.profile), controllerCapabilities,
  };
  history.push({ time: new Date().toISOString(), event: "ready", ...sessionReceipt });
  await fs.writeFile(path.join(output, "diagnostic.json"), JSON.stringify(history, null, 2));
  console.log(JSON.stringify({ ready: "INPUT_DIAGNOSTIC_READY", mode: candidate ? "local-candidate-diagnostic" : "default", ...sessionReceipt }));
  for await (const line of lines) {
    let request = null;
    let actualCommand = null;
    try {
      request = JSON.parse(line);
      let result;
      if (request.op === "quit") break;
      if (request.op === "profile") {
        if (!["start", "stop", "top"].includes(request.action)) throw Error("profile action must be start, stop, or top");
        result = await page.evaluate(async (action) => {
          const controller = window.__linuxCtl;
          if (action === "top") {
            if (typeof controller?.profileStats !== "function") {
              return { action, supported: false, reason: "profileStats-unavailable" };
            }
            const profile = await controller.profileStats();
            return { action, supported: true, profile, topPcs: profile?.regions ?? [] };
          }
          if (typeof controller?.setProfiling !== "function") {
            return { action, supported: false, reason: "setProfiling-unavailable" };
          }
          const armed = await controller.setProfiling(action === "start");
          const profile = typeof controller.profileStats === "function" ? await controller.profileStats() : null;
          return { action, supported: true, armed, profile };
        }, request.action);
      }
      if (request.op === "clock") {
        if (!["state", "set-divider"].includes(request.action)) throw Error("clock action must be state or set-divider");
        result = await page.evaluate(async ({ action, divider: requestedDivider }) => {
          const controller = window.__linuxCtl;
          if (action === "state") {
            if (typeof controller?.guestClockState !== "function") {
              return { action, supported: false, reason: "guestClockState-unavailable" };
            }
            return { action, supported: true, state: await controller.guestClockState() };
          }
          const divider = Number(requestedDivider);
          if (!Number.isSafeInteger(divider) || divider < 1 || divider > 1024) {
            throw new Error("clock divider must be an integer from 1 to 1024");
          }
          if (typeof controller?.setICountDivider !== "function") {
            return { action, divider, supported: false, reason: "setICountDivider-unavailable" };
          }
          await controller.setICountDivider(divider);
          const state = typeof controller.guestClockState === "function" ? await controller.guestClockState() : null;
          return { action, divider, supported: true, state };
        }, { action: request.action, divider: request.divider });
      }
      if (request.op === "cpu-profile") {
        result = await captureWorkerCpuProfile(browser, output, request);
      }
      if (request.op === "exec") {
        actualCommand = wrapDiagnosticExec(request.command);
        result = await page.evaluate((cmd) => window.wvmDemo.exec(cmd, 300000, { quiet: true }), actualCommand);
      }
      if (request.op === "click") {
        const delay = request.delayMs ?? request.delay ?? defaultClickDelay;
        await page.locator("#ide-display-canvas").click({ position: { x: request.x, y: request.y }, timeout: 300000, ...(delay === undefined ? {} : { delay }) });
        result = { clicked: { x: request.x, y: request.y }, delayMs: delay ?? 0 };
      }
      if (request.op === "resize") {
        if (!Number.isInteger(request.width) || !Number.isInteger(request.height) || request.width < 1 || request.height < 1) throw Error("resize requires positive integer width and height");
        await page.setViewportSize({ width: request.width, height: request.height });
        await page.waitForFunction(({ width, height }) => innerWidth === width && innerHeight === height, { width: request.width, height: request.height });
        result = { viewport: page.viewportSize(), nativeResize: true };
      }
      if (request.op === "type") {
        for (const character of request.text) {
          const { code, shift } = physicalStroke(character);
          if (shift) await page.keyboard.down("ShiftLeft");
          await page.keyboard.press(code, { delay: request.delay || 100 });
          if (shift) await page.keyboard.up("ShiftLeft");
        }
        if (request.enter) await page.keyboard.press("Enter");
      }
      if (request.op === "stats") result = await page.evaluate(async () => ({
        focus: document.activeElement?.id, keyboard: window.__keyboardCapture?.stats(),
        keyboardFrames: window.__keyboardCapture?.frames(), keyboardDiagnostics: window.__keyboardCapture?.diagnostics(),
        inputDevice: await window.__linuxCtl?.inputDeviceStats?.(),
        pointerFrames: window.__pointer?.frames(), pointerDiagnostics: window.__pointer?.diagnostics(),
        cursor: window.__cursor?.state(), rpc: await window.__workerRpcStats?.(),
        display: window.__presentation?.state(),
        clock: await window.__linuxCtl?.guestClockState?.(), scheduler: await window.__schedulerStats?.(), jit: await window.__jitStats?.(),
      }));
      if (request.op === "screenshot") {
        if (!/^[a-z0-9-]+\.png$/u.test(request.name)) throw Error("invalid screenshot name");
        await page.screenshot({ path: path.join(output, request.name) });
        result = path.join(output, request.name);
      }
      const entry = {
        time: new Date().toISOString(), ...sessionReceipt, request,
        ...(actualCommand === null ? {} : { actualCommand }), result: result ?? "sent",
      };
      history.push(entry);
      await fs.writeFile(path.join(output, "diagnostic.json"), JSON.stringify(history, null, 2));
      console.log(JSON.stringify(entry));
    } catch (error) {
      const errorEntry = {
        time: new Date().toISOString(), ...sessionReceipt, request,
        ...(actualCommand === null ? {} : { actualCommand }), error: String(error),
      };
      history.push(errorEntry);
      await fs.writeFile(path.join(output, "diagnostic.json"), JSON.stringify(history, null, 2));
      console.error(JSON.stringify(errorEntry));
    }
  }
} finally {
  lines.close(); await browser.close(); server.close();
}
