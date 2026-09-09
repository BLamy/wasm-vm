#!/usr/bin/env node
// E5.5-T03a: fresh Chromium diagnostics, never a task-verification or deployment receipt.
// No source overlays are edited. The synthetic page exists only in this browser context.
// hyprctl interface: https://wiki.hypr.land/Configuring/Advanced-and-Cool/Using-hyprctl/
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { execFile as execFileCallback, spawn } from "node:child_process";
import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import { createServer } from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { promisify } from "node:util";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const execFile = promisify(execFileCallback);
const KERNEL_SHA = "af7c4e471ed4dabdbe5a2717d81cc034b511d2b0f7706de66ad9e84e078c7cce";
const SHA = /^[0-9a-f]{64}$/u;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const quote = (text) => `'${String(text).replaceAll("'", "'\\''")}'`;
const HELP = `Cold Omarchy Chromium session diagnostics (no snapshots or persistent overlay).

node tools/verify/omarchy-browser-session.mjs \\
  --image /absolute/candidate.ext4 --image-sha256 SHA256 \\
  --chunks /absolute/chunkdir --manifest-sha256 SHA256 --out /new/output/dir

Required inputs also accept OMARCHY_IMAGE, OMARCHY_IMAGE_SHA256, OMARCHY_CHUNKS,
OMARCHY_MANIFEST_SHA256 and OMARCHY_OUTPUT_DIR. --out must not already exist.
Optional: --timeout-ms 1800000 --ram-mib 2048 --port 0 --chrome PATH --headed
          --keyboard none|auto (default none) --poll-ms 30000 --probe-timeout-ms 120000
          --shell-namespace NAME (exact additional Quickshell layer namespace)
          --check-only (integrity checks, no browser or guest)
          --self-test (synthetic parser/guard tests; no guest)
          --smoke-test (real Chromium imports/canvas only; NO worker/guest boot)

The diagnostic page exposes __omarchyProof and __omarchyController. Focus the canvas
for evdev input; the serial form sends serial bytes. Auto keyboard focuses the mapped
Foot window, types a nonce-file command via evdev, and verifies it through serial.
With --keyboard none, a successful run reports keyboardVerified:false and exit 0
only means the requested desktop observations succeeded. It is not full acceptance.
Errors/timeouts produce report.json, serial.log, events.jsonl and a best-effort PNG.
`;

export function options(argv = process.argv.slice(2), env = process.env) {
  const { values } = parseArgs({ args: argv, options: {
    image: { type: "string", default: env.OMARCHY_IMAGE },
    "image-sha256": { type: "string", default: env.OMARCHY_IMAGE_SHA256 },
    chunks: { type: "string", default: env.OMARCHY_CHUNKS },
    "manifest-sha256": { type: "string", default: env.OMARCHY_MANIFEST_SHA256 },
    out: { type: "string", default: env.OMARCHY_OUTPUT_DIR },
    "timeout-ms": { type: "string", default: env.OMARCHY_TIMEOUT_MS || "1800000" },
    "ram-mib": { type: "string", default: "2048" },
    "poll-ms": { type: "string", default: "30000" },
    "probe-timeout-ms": { type: "string", default: "120000" },
    port: { type: "string", default: "0" }, chrome: { type: "string", default: env.OMARCHY_CHROME_PATH },
    keyboard: { type: "string", default: "none" }, "shell-namespace": { type: "string", default: "" },
    headed: { type: "boolean" }, "check-only": { type: "boolean" },
    "self-test": { type: "boolean" }, "smoke-test": { type: "boolean" }, help: { type: "boolean" },
  } });
  if (values.help || values["self-test"] || values["smoke-test"]) return values;
  for (const key of ["image", "image-sha256", "chunks", "manifest-sha256", "out"]) {
    assert.ok(values[key], `--${key} is required`);
  }
  for (const key of ["image-sha256", "manifest-sha256"]) assert.match(values[key], SHA, `invalid --${key}`);
  for (const [key, min, max] of [["timeout-ms", 1000, 7200000], ["ram-mib", 256, 3072],
    ["poll-ms", 1000, 120000], ["probe-timeout-ms", 1000, 300000], ["port", 0, 65535]]) {
    values[key] = Number(values[key]);
    assert.ok(Number.isSafeInteger(values[key]) && values[key] >= min && values[key] <= max, `invalid --${key}`);
  }
  assert.ok(["none", "auto"].includes(values.keyboard), "--keyboard must be none or auto");
  for (const key of ["image", "chunks", "out"]) values[key] = path.resolve(values[key]);
  return values;
}

async function hashFile(filename) {
  const digest = createHash("sha256");
  for await (const bytes of createReadStream(filename)) digest.update(bytes);
  return digest.digest("hex");
}

async function within(promise, ms, label) {
  let timer;
  try {
    return await Promise.race([promise, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms} ms`)), Math.max(1, ms));
    })]);
  } finally { clearTimeout(timer); }
}

export async function validateInputs(opts) {
  // This existing streaming verifier checks each chunk object AND each image slice, including
  // ext4 bounds. Hashing only the image and trusting an unrelated manifest is insufficient.
  const { stdout } = await execFile("python3", ["-B", path.join(repo, "tools/image/verify-omarchy-image.py"),
    "--image", opts.image, "--manifest", path.join(opts.chunks, "manifest.json"), "--receipt"],
  { timeout: opts["timeout-ms"], maxBuffer: 1024 * 1024 });
  const integrity = JSON.parse(stdout);
  assert.equal(integrity.status, "integrity-verified");
  assert.equal(integrity.image_sha256, opts["image-sha256"], "candidate image SHA-256 mismatch");
  assert.equal(integrity.manifest_sha256, opts["manifest-sha256"], "chunk manifest SHA-256 mismatch");
  const artifactPath = path.join(repo, "web/artifacts-alpine.json");
  const artifacts = JSON.parse(await fs.readFile(artifactPath, "utf8"));
  const kernel = artifacts.artifacts.kernel;
  assert.equal(kernel.sha256, KERNEL_SHA, "kernel is not the accepted af7 kernel");
  assert.match(kernel.url, /^releases\/kernel\/[A-Za-z0-9._/-]+$/u);
  const kernelPath = await fs.realpath(path.join(repo, kernel.url));
  assert.ok(kernelPath.startsWith(`${path.join(repo, "releases/kernel")}/`), "kernel escapes kernel directory");
  assert.equal((await fs.stat(kernelPath)).size, kernel.size);
  assert.equal(await hashFile(kernelPath), KERNEL_SHA, "kernel bytes do not match manifest");
  return { image: opts.image, chunks: opts.chunks, integrity, kernel: { ...kernel, path: kernelPath },
    // Only this stripped manifest is routed to the browser; old rootfs/snapshot URLs never enter it.
    bootManifest: { artifacts: { kernel: { ...kernel, url: `/${kernel.url}` } } },
    harnessSha256: await hashFile(fileURLToPath(import.meta.url)) };
}

// Tokens must occupy full output lines; the echoed printf command is not a receipt.
export function plainTerminal(text) {
  return text.replace(/\x1b\][\s\S]*?(?:\x07|\x1b\\)/gu, "")
    .replace(/\x1bP[\s\S]*?\x1b\\/gu, "")
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/gu, "").replaceAll("\r", "");
}

export function physicalStroke(character) {
  if (/^[a-z]$/u.test(character)) return { code: `Key${character.toUpperCase()}`, shift: false };
  if (/^[A-Z]$/u.test(character)) return { code: `Key${character}`, shift: true };
  if (/^[0-9]$/u.test(character)) return { code: `Digit${character}`, shift: false };
  const pairs = [[" ", " ", "Space"], ["`", "~", "Backquote"], ["-", "_", "Minus"],
    ["=", "+", "Equal"], ["[", "{", "BracketLeft"], ["]", "}", "BracketRight"],
    ["\\", "|", "Backslash"], [";", ":", "Semicolon"], ["'", '"', "Quote"],
    [",", "<", "Comma"], [".", ">", "Period"], ["/", "?", "Slash"]];
  for (const [plain, shifted, code] of pairs) {
    if (character === plain || character === shifted) return { code, shift: character !== plain };
  }
  const digit = ")!@#$%^&*(".indexOf(character);
  if (digit >= 0) return { code: `Digit${digit}`, shift: true };
  throw new Error(`unsupported physical keyboard character: ${JSON.stringify(character)}`);
}

async function typePhysical(page, text) {
  for (const character of text) {
    const { code, shift } = physicalStroke(character);
    if (shift) await page.keyboard.down("ShiftLeft");
    await page.keyboard.press(code, { delay: 50 });
    if (shift) await page.keyboard.up("ShiftLeft");
  }
}

export function parseProbe(serial, token) {
  assert.match(token, /^[a-z0-9_]+$/u);
  const lines = plainTerminal(serial).split("\n");
  const start = lines.indexOf(`${token}_begin`);
  if (start < 0) return null;
  for (let end = start + 1; end < lines.length; end++) {
    const match = lines[end].match(new RegExp(`^${token}_end:([0-9]+)$`, "u"));
    if (match) return { status: Number(match[1]), output: lines.slice(start + 1, end).join("\n").trim(),
      beginLine: start + 1, endLine: end + 1 };
  }
  return null;
}

export function probeCommand(command, token) {
  assert.match(token, /^[a-z0-9_]+$/u);
  assert.ok(!/[\r\n]/u.test(command), "serial command must be one line");
  return `printf '\\n%s\\n' '${token}_begin'; ( ${command} ); wv_rc=$?; printf '\\n%s:%s\\n' '${token}_end' "$wv_rc"\r`;
}

function layersIn(value) {
  if (!value || typeof value !== "object") return [];
  return [...(typeof value.namespace === "string" ? [value] : []),
    ...Object.values(value).filter((v) => v && typeof v === "object").flatMap(layersIn)];
}

export function desktopObservation(clients, layers, processes, extraNamespace = "") {
  assert.ok(Array.isArray(clients), "hyprctl clients must return an array");
  assert.ok(layers && typeof layers === "object" && !Array.isArray(layers), "hyprctl layers must return an object");
  const foot = clients.find((c) => /^foot(?:client)?$/iu.test(c.class || c.initialClass || "")
    && c.mapped === true && c.hidden !== true && Number.isInteger(c.pid) && c.pid > 0
    && /^0x[0-9a-f]+$/iu.test(c.address || "") && c.size?.length === 2 && c.size.every((n) => n > 0));
  const shellProcesses = processes.split("\n").flatMap((line) => {
    const match = line.match(/^\s*(\d+)\s+(quickshell|qs)\s+(.+)$/u);
    return match ? [{ pid: Number(match[1]), command: match[2], args: match[3] }] : [];
  });
  const shellLayers = layersIn(layers).filter((layer) => layer.w > 0 && layer.h > 0
    && (shellProcesses.some((p) => p.pid === layer.pid)
      || /quickshell|omarchy/iu.test(layer.namespace)
      || (extraNamespace && layer.namespace === extraNamespace)));
  const shellClients = clients.filter((c) => c.mapped === true && c.hidden !== true
    && shellProcesses.some((p) => p.pid === c.pid));
  return { foot: foot || null, shellProcesses, shellLayers, shellClients,
    mappedFoot: Boolean(foot), quickshellObserved: shellProcesses.length > 0
      && (shellLayers.length > 0 || shellClients.length > 0) };
}

// Executed only in Chromium. No manufactured frame or readiness state is ever supplied here.
async function diagnosticPage(config) {
  const [{ startLinuxBootWorker }, { PresentationController }, { evdevForCode }] = await Promise.all([
    import("/linux-worker-host.js"), import("/src/sink/presentation.js"), import("/src/input/keymap.js"),
  ]);
  const canvas = document.getElementById("screen");
  const status = document.getElementById("status");
  const serialView = document.getElementById("serial");
  const presentation = new PresentationController(canvas, {
    defaultBackend: "canvas2d", canvas2dOptions: { contextAttributes: { willReadFrequently: true } },
  });
  const decoder = new TextDecoder();
  const state = { bootStarted: false, bootState: "not-started", frames: 0, serialBytes: 0,
    keys: 0, errors: [], imageSha256: config.imageSha256, manifestSha256: config.manifestSha256 };
  let serial = "", controller = null, keyboardQueue = Promise.resolve(), lastFrameAt = -Infinity;
  const emit = (event) => { void window.__omarchyRecord({ atMs: performance.now(), ...event }).catch((error) => {
    state.errors.push(`evidence callback: ${error.message}`);
  }); };
  const fail = (error) => {
    const message = String(error?.message || error);
    state.errors.push(message); status.textContent = `ERROR: ${message}`; emit({ type: "error", message });
  };
  const digest = async (bytes) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
    (v) => v.toString(16).padStart(2, "0")).join("");
  const sendSerial = (text) => {
    if (!controller?.sendInput(new TextEncoder().encode(text))) throw new Error("serial controller is unavailable");
    emit({ type: "serial-input", text });
  };
  const sendKey = async (code, value) => {
    if (!controller || !await controller.sendKeyboardEvent(1, code, value)
        || !await controller.syncKeyboard()) throw new Error("evdev transport rejected key");
    state.keys++; emit({ type: "evdev", code, value });
  };
  for (const type of ["keydown", "keyup"]) canvas.addEventListener(type, (event) => {
    event.preventDefault();
    if (event.repeat || event.isComposing) return;
    const code = evdevForCode(event.code);
    if (code === null) return fail(`unmapped keyboard code: ${event.code}`);
    emit({ type: "dom-key", code: event.code, eventType: type, trusted: event.isTrusted });
    keyboardQueue = keyboardQueue.then(() => sendKey(code, type === "keydown" ? 1 : 0)).catch(fail);
  });
  canvas.addEventListener("pointerdown", () => canvas.focus());
  document.getElementById("serial-form").addEventListener("submit", (event) => {
    event.preventDefault();
    try { sendSerial(`${document.getElementById("command").value}\r`); } catch (error) { fail(error); }
  });
  const api = window.__omarchyProof = {
    state: () => ({ ...state, presentation: presentation.snapshot() }), serial: () => serial,
    sendSerial, sendKey, keyboardIdle: () => keyboardQueue, presentation,
    async capture() {
      const paused = controller ? (await controller.pause(), await controller.isPaused()) : false;
      const pixels = presentation.readPixels();
      const colors = new Set();
      for (let i = 0; i < pixels.length; i += 64) colors.add(`${pixels[i]},${pixels[i + 1]},${pixels[i + 2]}`);
      return { ...api.state(), paused, rgbaSha256: await digest(pixels), sampledColors: colors.size,
        stateDigest: controller ? await controller.stateDigest() : null,
        scheduler: controller ? await controller.schedulerStats() : null,
        fetchStats: controller ? await controller.fetchStats() : null };
    },
    async start() {
      if (!config.allowBoot) throw new Error("no guest boot is permitted in browser smoke-test mode");
      if (state.bootStarted) throw new Error("this context already started its single cold boot");
      state.bootStarted = true;
      try {
        const bytes = await (await fetch("/e5t18a-desktop/manifest.json", { cache: "no-store" })).arrayBuffer();
        if (await digest(bytes) !== config.manifestSha256) throw new Error("served chunk manifest digest mismatch");
        controller = await startLinuxBootWorker({
          manifestUrl: "/omarchy-kernel.json", mode: "chunked",
          imageManifestUrl: "/e5t18a-desktop/manifest.json", baseUrl: "/e5t18a-desktop/",
          bootProfileUrl: null, ramMib: config.ramMib,
          bootargs: "root=/dev/vda rw console=ttyS0 earlycon=sbi",
          bootSnapshot: false, persist: false, slirpNet: false, fastInterpreter: true,
          jit: true, quantum: 500000, workerBootTimeoutMs: config.timeoutMs,
          onOutput(bytes) {
            const text = decoder.decode(bytes, { stream: true });
            serial = (serial + text).slice(-4 * 1024 * 1024); state.serialBytes += bytes.length;
            serialView.textContent = serial.slice(-12000);
            let binary = ""; for (const byte of bytes) binary += String.fromCharCode(byte);
            emit({ type: "serial", base64: btoa(binary), text });
          },
          onDisplayFrame(frame) {
            try {
              const result = presentation.present(frame);
              if (frame.type !== "clear") state.frames++;
              if (performance.now() - lastFrameAt >= 5000) {
                lastFrameAt = performance.now();
                const atFrame = state.frames, pixels = presentation.readPixels();
                void digest(pixels).then((rgbaSha256) => emit({ type: "frame", atFrame, rgbaSha256,
                  presentation: presentation.snapshot() })).catch(fail);
              }
              return result;
            } catch (error) { fail(error); return false; }
          },
          onState(value) { state.bootState = value; status.textContent = `Guest: ${value}`; emit({ type: "state", value }); },
          onProgress(role, loaded, total) { emit({ type: "progress", role, loaded, total }); },
          onError: fail,
        });
        window.__omarchyController = controller;
        emit({ type: "controller-ready", backend: controller.backend });
      } catch (error) { fail(error); }
    },
  };
  status.textContent = config.allowBoot ? "Ready to start cold guest" : "Browser smoke test: no guest boot";
}

export function pageHTML(config) {
  const json = JSON.stringify(config).replaceAll("<", "\\u003c");
  return `<!doctype html><meta charset="utf-8"><title>Omarchy guest diagnostics</title>
<link rel="icon" href="data:,"><style>body{background:#151922;color:#eee;font:14px monospace;margin:16px}
canvas{display:block;max-width:100%;border:1px solid #555}pre{white-space:pre-wrap;max-height:260px;overflow:auto}
input{width:75%}</style><h1>Omarchy guest diagnostics</h1><p id="status">Loading diagnostic modules</p>
<canvas id="screen" width="1280" height="800" tabindex="0" aria-label="Real guest display"></canvas>
<p>Click canvas for evdev keyboard input. Serial control:</p><form id="serial-form"><input id="command"
aria-label="Serial command" autocomplete="off"><button>Send serial</button></form><pre id="serial"></pre>
<script type="module">(${diagnosticPage.toString()})(${json}).catch(e=>{document.getElementById('status').textContent=String(e);console.error(e)});</script>`;
}

async function allocatePort() {
  const server = createServer();
  return await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => { const { port } = server.address(); server.close(() => resolve(port)); });
  });
}

async function startServer(opts, record) {
  const port = opts.port || await allocatePort();
  const child = spawn("bash", ["tools/serve-dev.sh", String(port)], { cwd: repo,
    env: { ...process.env, E5_T18A_DESKTOP_ASSET_DIR: opts.chunks || "",
      E4T32_NODE_ASSET_DIR: "", E5_T18B_DESKTOP_ASSET_DIR: "", E4T34_WARM_ASSET_DIR: "",
      E5_T18D_DESKTOP_ASSET_DIR: "", E5_T22C_DESKTOP_ASSET_DIR: "" },
    detached: true, stdio: ["ignore", "pipe", "pipe"] });
  const stop = () => { if (child.pid) { try { process.kill(-child.pid, "SIGTERM"); }
    catch (error) { if (error.code !== "ESRCH") throw error; } } };
  let startError;
  child.on("error", (error) => { startError = error; });
  for (const [name, stream] of [["stdout", child.stdout], ["stderr", child.stderr]]) {
    stream.on("data", (bytes) => record({ type: "server", stream: name, text: bytes.toString() }));
  }
  const base = `http://127.0.0.1:${port}`;
  try {
    for (let i = 0; i < 150; i++) {
      if (startError) throw startError;
      if (child.exitCode !== null) throw new Error(`dev server exited ${child.exitCode}`);
      try {
        const response = await fetch(`${base}/linux-worker-host.js`, { signal: AbortSignal.timeout(1000) });
        if (response.ok) return { base, stop };
      } catch {}
      await sleep(200);
    }
    throw new Error("dev server did not become ready");
  } catch (error) { stop(); throw error; }
}

async function browserSession(opts, base, publication, record, serialOutput) {
  const { chromium } = await import(pathToFileURL(path.join(repo, "web/node_modules/playwright/index.mjs")));
  let executablePath = opts.chrome;
  if (!executablePath && process.platform === "darwin") {
    const candidate = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
    try { await fs.access(candidate); executablePath = candidate; } catch {}
  }
  const browser = await chromium.launch({ headless: !opts.headed, executablePath,
    args: ["--disable-dev-shm-usage", "--disable-gpu"], timeout: 30000 });
  try {
    const context = await browser.newContext({ viewport: { width: 1320, height: 1180 },
      deviceScaleFactor: 1, serviceWorkers: "block" });
    await context.exposeFunction("__omarchyRecord", (event) => {
      if (event.type === "serial") serialOutput(event);
      else record(event);
    });
    await context.route(`${base}/omarchy-proof.html`, (route) => route.fulfill({ status: 200,
      headers: { "Content-Type": "text/html", "Cross-Origin-Opener-Policy": "same-origin",
        "Cross-Origin-Embedder-Policy": "require-corp" },
      body: pageHTML({ allowBoot: !opts["smoke-test"], ramMib: opts["ram-mib"], timeoutMs: opts["timeout-ms"],
        imageSha256: opts["image-sha256"], manifestSha256: opts["manifest-sha256"] }) }));
    await context.route(`${base}/omarchy-kernel.json`, (route) => route.fulfill({
      contentType: "application/json", body: JSON.stringify(publication?.bootManifest || {}) }));
    const page = await context.newPage();
    const cdp = await context.newCDPSession(page);
    await cdp.send("Network.setCacheDisabled", { cacheDisabled: true });
    const errors = [];
    const error = (kind, message) => { errors.push({ kind, message }); record({ type: "browser-error", kind, message }); };
    page.on("pageerror", (e) => error("page", e.message));
    page.on("crash", () => error("crash", "Chromium renderer crashed"));
    page.on("console", (m) => { record({ type: "console", level: m.type(), text: m.text() });
      if (m.type() === "error") error("console", m.text()); });
    page.on("requestfailed", (r) => error("request", `${r.url()}: ${r.failure()?.errorText}`));
    page.on("response", (r) => { if (r.status() >= 400) error("http", `${r.status()} ${r.url()}`); });
    await page.goto(`${base}/omarchy-proof.html`, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForFunction(() => Boolean(window.__omarchyProof), null, { timeout: 30000 });
    return { browser, context, page, errors, info: { name: "Chromium", version: browser.version(), executablePath,
      freshContext: true, serviceWorkers: "block", httpCacheDisabled: true } };
  } catch (error) { await browser.close(); throw error; }
}

async function observeGuest(session, opts, record, getSerial) {
  const { page, errors } = session, deadline = Date.now() + opts["timeout-ms"];
  const nonce = randomBytes(16).toString("hex");
  let sequence = 0;
  const remaining = () => Math.max(1, deadline - Date.now());
  const evaluate = (fn, arg) => within(page.evaluate(fn, arg), Math.min(30000, remaining()), "browser operation");
  const probe = async (command) => {
    const token = `omarchy_${nonce}_${++sequence}`, start = getSerial().length;
    const wire = probeCommand(command, token);
    assert.ok(wire.length < 3500, "serial command exceeds canonical TTY line budget");
    record({ type: "probe-sent", token, command, serialCharacterOffset: start });
    await evaluate((text) => window.__omarchyProof.sendSerial(text), wire);
    const until = Math.min(deadline, Date.now() + opts["probe-timeout-ms"]);
    while (Date.now() < until) {
      const response = parseProbe(getSerial().slice(start), token);
      if (response) { record({ type: "probe-result", token, ...response }); return response; }
      if (errors.length) throw new Error("browser reported an error during serial probe");
      await sleep(500);
    }
    throw new Error(`serial probe timed out: ${token}`);
  };
  await evaluate(() => { void window.__omarchyProof.start(); });
  await page.waitForFunction(() => Boolean(window.__omarchyController) || window.__omarchyProof.state().errors.length,
    null, { timeout: remaining() });
  let usernameSent = false;
  while (Date.now() < deadline) {
    const state = await evaluate(() => window.__omarchyProof.state());
    assert.deepEqual(state.errors, [], "guest worker/presentation error");
    const tail = plainTerminal(getSerial().slice(-12000));
    if (/(?:^|\n)[^\n]{0,200}(?:\$|#|❯|➜)\s*$/u.test(tail)) break;
    if (!usernameSent && /(?:^|\n)[^\n]*login:\s*$/u.test(tail)) {
      await evaluate(() => window.__omarchyProof.sendSerial("omarchy\r")); usernameSent = true;
    }
    if (/Password:\s*$/u.test(tail)) throw new Error("serial login requests a password; no credentials supplied");
    await sleep(1000);
  }
  assert.ok(Date.now() < deadline, "timed out awaiting the serial shell prompt");
  const identity = await probe("stty -echo; /usr/bin/id -u; printf '%s\\n' \"$HOME\"");
  assert.equal(identity.status, 0, "serial identity query failed");
  assert.equal(identity.output, "1000\n/home/omarchy", "serial shell is not the generic UID-1000 account");
  let observed, instance;
  while (Date.now() < deadline) {
    const instances = await probe("XDG_RUNTIME_DIR=/run/user/1000 hyprctl -j instances");
    if (instances.status === 0) {
      const list = JSON.parse(instances.output);
      assert.ok(Array.isArray(list), "hyprctl instances must be an array");
      instance = list.find((v) => /^[A-Za-z0-9_.-]+$/u.test(v.instance || "") && v.pid > 0);
    }
    if (instance) {
      const ctl = `XDG_RUNTIME_DIR=/run/user/1000 hyprctl -i ${quote(instance.instance)}`;
      const clients = await probe(`${ctl} -j clients`), layers = await probe(`${ctl} -j layers`);
      const processes = await probe("ps -u 1000 -o pid=,comm=,args=");
      const setup = await probe('p="$HOME/.local/state/wasm-vm/omarchy-demo-session-v1"; '
        + '[ -f "$p" ] && [ ! -L "$p" ] && [ "$(cat "$p")" = "wasm-vm omarchy demo session v1" ] || exit 41; '
        + 'for n in finalize-user first-run-user; do p="$HOME/.local/state/omarchy/done/$n"; '
        + '[ ! -e "$p" ] && [ ! -L "$p" ] || exit 42; done');
      if ([clients, layers, processes, setup].every((r) => r.status === 0)) {
        observed = desktopObservation(JSON.parse(clients.output), JSON.parse(layers.output), processes.output,
          opts["shell-namespace"]);
        record({ type: "desktop-observation", instance, ...observed });
        const state = await evaluate(() => window.__omarchyProof.state());
        assert.deepEqual(state.errors, []);
        if (observed.mappedFoot && observed.quickshellObserved && state.presentation.successfulPresents > 0) break;
      }
    }
    record({ type: "poll", state: await evaluate(() => window.__omarchyProof.state()) });
    console.log(`OMARCHY_PROGRESS ${JSON.stringify({ frames: (await evaluate(() => window.__omarchyProof.state())).frames,
      mappedFoot: observed?.mappedFoot || false, quickshell: observed?.quickshellObserved || false })}`);
    await page.screenshot({ path: path.join(opts.out, "latest.png"), timeout: Math.min(10000, remaining()) });
    await sleep(Math.min(opts["poll-ms"], remaining()));
  }
  assert.ok(Date.now() < deadline && observed?.mappedFoot && observed?.quickshellObserved,
    "timed out before mapped Foot and Quickshell were both observed");
  let keyboard = { mode: opts.keyboard, verified: false };
  if (opts.keyboard === "auto") {
    const guestPath = `/tmp/omarchy-keyboard-${nonce}`;
    assert.equal((await probe(`test ! -e ${quote(guestPath)} && test ! -L ${quote(guestPath)}`)).status, 0);
    const ctl = `XDG_RUNTIME_DIR=/run/user/1000 hyprctl -i ${quote(instance.instance)}`;
    assert.equal((await probe(`${ctl} dispatch focuswindow address:${observed.foot.address}`)).status, 0);
    const active = await probe(`${ctl} -j activewindow`);
    assert.equal(active.status, 0);
    assert.equal(JSON.parse(active.output).address, observed.foot.address, "Foot did not take keyboard focus");
    const keysBefore = (await evaluate(() => window.__omarchyProof.state())).keys;
    const command = `printf '%s\\n' '${nonce}' > '${guestPath}'`;
    await page.locator("#screen").focus();
    await typePhysical(page, command);
    await page.keyboard.press("Enter");
    await evaluate(() => window.__omarchyProof.keyboardIdle());
    let response;
    do {
      response = await probe(`test -f ${quote(guestPath)} && cat ${quote(guestPath)} && stat -c %u ${quote(guestPath)}`);
      if (response.status === 0) break;
      await sleep(Math.min(5000, remaining()));
    } while (Date.now() < deadline);
    const keysAfter = (await evaluate(() => window.__omarchyProof.state())).keys;
    assert.equal(response.status, 0, "keyboard command produced no guest file");
    assert.equal(response.output, `${nonce}\n1000`, "keyboard command output/ownership mismatch");
    assert.ok(keysAfter > keysBefore, "no evdev frames were sent");
    keyboard = { mode: "auto", verified: true, nonce, guestPath, command, keys: keysAfter - keysBefore,
      path: "Chromium KeyboardEvent -> sendKeyboardEvent/syncKeyboard -> focused Foot -> guest nonce file" };
  }
  return { identity, instance, desktop: observed, keyboard, probes: sequence, coldBoot: true,
    setupMarkerObserved: true, upstreamDoneMarkersAbsent: true };
}

async function run(opts) {
  await fs.mkdir(path.dirname(opts.out), { recursive: true });
  await fs.mkdir(opts.out); // Never overwrite another run's evidence.
  const started = Date.now(), report = { schema: "wasm-vm.omarchy-browser-session.v1", task: "E5.5-T03a",
    taskVerified: false, startedAt: new Date().toISOString(), options: opts, result: "incomplete" };
  let serial = "", serialBytes = 0, io = Promise.resolve(), ioError, server, session;
  const append = (filename, bytes) => { io = io.then(() => fs.appendFile(path.join(opts.out, filename), bytes))
    .catch((error) => { ioError = error; }); };
  const record = (event) => append("events.jsonl", `${JSON.stringify({ hostMs: Date.now() - started, ...event })}\n`);
  const serialOutput = (event) => {
    const bytes = Buffer.from(event.base64, "base64");
    serial += event.text;
    record({ type: "serial", atMs: event.atMs, byteOffset: serialBytes, byteLength: bytes.length });
    serialBytes += bytes.length; append("serial.log", bytes);
  };
  try {
    report.publication = await validateInputs(opts);
    await fs.writeFile(path.join(opts.out, "input-integrity.json"), `${JSON.stringify(report.publication, null, 2)}\n`);
    if (opts["check-only"]) { report.result = "integrity-only-no-boot"; return report; }
    server = await startServer(opts, record);
    const served = await fetch(`${server.base}/e5t18a-desktop/manifest.json`, { signal: AbortSignal.timeout(10000) });
    assert.ok(served.ok); assert.equal(hash(Buffer.from(await served.arrayBuffer())), opts["manifest-sha256"]);
    session = await browserSession(opts, server.base, report.publication, record, serialOutput);
    report.browser = session.info;
    report.observations = await within(observeGuest(session, opts, record, () => serial), opts["timeout-ms"], "guest proof");
    report.capture = await within(session.page.evaluate(() => window.__omarchyProof.capture()), 90000, "paused capture");
    assert.equal(report.capture.paused, true);
    assert.match(report.capture.stateDigest, SHA);
    assert.ok(report.capture.frames > 0 && report.capture.presentation.successfulPresents > 0);
    assert.ok(report.capture.sampledColors > 1, "scanout readback is blank or uniform");
    assert.deepEqual(report.capture.errors, []);
    assert.deepEqual(report.capture.presentation.errors, []);
    assert.deepEqual(session.errors, []);
    report.result = opts.keyboard === "auto" ? "desktop-and-keyboard-observed" : "desktop-observed-keyboard-unverified";
  } catch (error) {
    report.result = "failed"; report.error = String(error.stack || error); process.exitCode = 1;
  } finally {
    if (session) {
      report.browserErrors = session.errors;
      if (!report.capture) {
        try { report.capture = await within(session.page.evaluate(() => window.__omarchyProof.capture()), 90000, "failure capture"); }
        catch (error) { report.captureError = String(error); }
      }
      try {
        const screenshot = path.join(opts.out, "guest.png");
        await session.page.locator("#screen").screenshot({ path: screenshot, timeout: 10000 });
        report.screenshot = { path: screenshot, sha256: await hashFile(screenshot) };
      } catch (error) { report.screenshotError = String(error); }
      await within(session.browser.close(), 10000, "browser cleanup").catch((error) => { report.cleanupError = String(error); });
    }
    server?.stop();
    await io;
    if (report.publication && !opts["check-only"]) {
      try {
        report.sourceUnchanged = (await hashFile(opts.image)) === opts["image-sha256"]
          && (await hashFile(path.join(opts.chunks, "manifest.json"))) === opts["manifest-sha256"];
        assert.equal(report.sourceUnchanged, true, "input image/manifest changed during run");
      } catch (error) { report.result = "failed"; report.integrityError = String(error); process.exitCode = 1; }
    }
    if (ioError) { report.result = "failed"; report.evidenceError = String(ioError); process.exitCode = 1; }
    if (serialBytes) report.serial = { path: path.join(opts.out, "serial.log"), bytes: serialBytes,
      sha256: await hashFile(path.join(opts.out, "serial.log")) };
    report.elapsedMs = Date.now() - started;
    await fs.writeFile(path.join(opts.out, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
    console.log(JSON.stringify({ result: report.result, report: path.join(opts.out, "report.json"), error: report.error }));
  }
  return report;
}

function selfTest() {
  assert.equal(plainTerminal(`\x1b]3008;${"long-metadata".repeat(40)}\x1b\\\x1b[?2004h[omarchy@omarchy-demo ~]$ `),
    "[omarchy@omarchy-demo ~]$ ");
  assert.deepEqual(physicalStroke("%"), { code: "Digit5", shift: true });
  assert.deepEqual(physicalStroke(">"), { code: "Period", shift: true });
  assert.deepEqual(physicalStroke("A"), { code: "KeyA", shift: true });
  assert.deepEqual(physicalStroke("a"), { code: "KeyA", shift: false });
  assert.throws(() => physicalStroke("\n"));
  const token = "omarchy_test_1", wire = probeCommand("/usr/bin/id -u", token);
  assert.equal(parseProbe(wire, token), null, "an echoed command is not a result");
  assert.equal(parseProbe(`${wire}\r\n${token}_begin\r\n1000\r\n`, token), null);
  assert.deepEqual(parseProbe(`${wire}\r\n${token}_begin\r\n1000\r\n${token}_end:0\r\n`, token)?.output, "1000");
  assert.equal(parseProbe(`\n${token}_begin\npermission denied\n${token}_end:41\n`, token)?.status, 41);
  assert.throws(() => probeCommand("echo ok\nexit", token));
  const client = { address: "0x123", class: "foot", pid: 9, mapped: true, hidden: false, size: [800, 600] };
  const layers = { monitor: { levels: { 2: [{ namespace: "omarchy-bar", pid: 12, w: 1280, h: 30 }] } } };
  const processes = "12 quickshell /usr/bin/quickshell -p /usr/share/omarchy/shell";
  assert.equal(desktopObservation([client], layers, processes).quickshellObserved, true);
  assert.equal(desktopObservation([{ ...client, mapped: false }], layers, processes).mappedFoot, false);
  assert.equal(desktopObservation([{ ...client, hidden: true }], layers, processes).mappedFoot, false);
  assert.equal(desktopObservation([client], layers, "").quickshellObserved, false);
  assert.equal(desktopObservation([client], {}, processes).quickshellObserved, false);
  assert.equal(desktopObservation([client], layers, "99 sh echo quickshell").quickshellObserved, false);
  assert.throws(() => options([], {}), /required/u);
  const args = ["--image", "/tmp/image", "--chunks", "/tmp/chunks", "--out", "/tmp/new",
    "--image-sha256", "a".repeat(64), "--manifest-sha256", "b".repeat(64)];
  assert.equal(options(args, {})["ram-mib"], 2048);
  assert.throws(() => options([...args, "--keyboard", "fake"], {}));
  assert.throws(() => options([...args, "--image-sha256", "bad"], {}));
  assert.ok(!pageHTML({}).includes("Weston"));
  console.log("OMARCHY_SELF_TEST passed: echoed/incomplete replies, failed commands, missing/hidden clients, missing shell surfaces/processes, CLI guards; no guest boot");
}

async function smokeTest(opts) {
  const server = await startServer({ port: 0 }, () => {});
  let session;
  try {
    session = await browserSession({ ...opts, "smoke-test": true }, server.base, null, () => {}, () => {});
    const state = await session.page.evaluate(() => window.__omarchyProof.state());
    assert.equal(state.bootStarted, false); assert.equal(state.frames, 0);
    assert.equal(state.presentation.backend, "canvas2d");
    assert.deepEqual(state.errors, []); assert.deepEqual(session.errors, []);
    assert.equal(await session.page.evaluate(() => Boolean(window.__omarchyController)), false);
    console.log(`OMARCHY_BROWSER_SMOKE passed: ${session.info.version}, real module imports/canvas, no worker or guest boot`);
  } finally { await session?.browser.close(); server.stop(); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const opts = options();
    if (opts.help) console.log(HELP);
    else if (opts["self-test"]) selfTest();
    else if (opts["smoke-test"]) await smokeTest(opts);
    else await run(opts);
  } catch (error) { console.error(error.stack || error); process.exitCode = 1; }
}
