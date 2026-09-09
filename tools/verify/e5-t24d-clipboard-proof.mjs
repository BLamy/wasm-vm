#!/usr/bin/env node
// E5-T24d — exact-head clipboard proof.
//
// This is intentionally a raw Playwright Chromium recording. The repository's Playwright Test
// runner deadlocks on this host's Node 24 before discovering tests, while the browser API drives
// the same Chromium engine. The page fixture imports the shipped source module over HTTP, so the
// capture exercises browser DOM/event semantics as well as the service implementation.

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { createServer } from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const webRoot = path.join(repo, "web");
const evidenceDir = path.join(repo, "evidence/e5-t24d");
const dateStamp = "2026-09-04";
const evidencePath = path.join(evidenceDir, `clipboard-proof-${dateStamp}.json`);
const transcriptPath = path.join(evidenceDir, `clipboard-proof-${dateStamp}.txt`);
const screenshotPath = path.join(evidenceDir, "clipboard-proof-browser.png");
const runtimeHead = runGit(["rev-parse", "HEAD"]).trim();

function runGit(args) {
  const result = spawnSync("git", args, { cwd: repo, encoding: "utf8" });
  assert.equal(result.status, 0, `git ${args.join(" ")} failed: ${result.stderr}`);
  return result.stdout;
}

function scrubbedEnv() {
  const env = { ...process.env };
  for (const name of [
    "RUSTFLAGS",
    "RUSTDOCFLAGS",
    "RUST_LOG",
    "CARGO_TARGET_DIR",
    "CARGO_BUILD_RUSTFLAGS",
    "CARGO_ENCODED_RUSTFLAGS",
  ]) delete env[name];
  return env;
}

function runNative(command, args) {
  const result = spawnSync(command, args, {
    cwd: repo,
    env: scrubbedEnv(),
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  assert.equal(
    result.status,
    0,
    `${command} ${args.join(" ")} failed\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
  );
  return {
    command: [command, ...args].join(" "),
    exitCode: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

async function fileHash(file) {
  return sha256(await fs.readFile(file));
}

const fixtureHtml = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Clipboard proof</title>
  <style>
    :root { color-scheme: dark; font: 16px/1.45 ui-monospace, SFMono-Regular, Menlo, monospace; }
    body { margin: 0; padding: 28px; background: #111827; color: #e5e7eb; }
    main { max-width: 1120px; margin: auto; }
    #surface { min-height: 96px; padding: 24px; border: 2px solid #60a5fa; border-radius: 12px; background: #1f2937; outline: none; }
    #surface:focus { box-shadow: 0 0 0 3px #2563eb; }
    #status { margin-top: 18px; color: #93c5fd; }
    #result { white-space: pre-wrap; overflow-wrap: anywhere; margin-top: 18px; padding: 16px; border-radius: 8px; background: #030712; }
  </style>
</head>
<body><main>
  <h1>Clipboard bridge proof</h1>
  <div id="surface" tabindex="0" aria-label="Clipboard proof surface">Focused guest surface</div>
  <div id="status" role="status" aria-live="polite">Clipboard: waiting for a copy</div>
  <pre id="result">running…</pre>
</main></body>
</html>`;

const contentTypes = {
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
};

function startServer() {
  const server = createServer(async (request, response) => {
    const pathname = new URL(request.url, "http://127.0.0.1").pathname;
    if (pathname === "/clipboard-proof-fixture.html") {
      response.writeHead(200, { "content-type": contentTypes[".html"] });
      response.end(fixtureHtml);
      return;
    }
    if (pathname !== "/clipboard-service.js" && pathname !== "/agent-channel.js") {
      response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      response.end("not found");
      return;
    }
    try {
      const bytes = await fs.readFile(path.join(webRoot, pathname.slice(1)));
      response.writeHead(200, { "content-type": contentTypes[".js"] });
      response.end(bytes);
    } catch {
      response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      response.end("not found");
    }
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.removeListener("error", reject);
      resolve(server);
    });
  });
}

function diagnostics(page, name) {
  const errors = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push({ kind: "console", name, text: message.text(), location: message.location() });
  });
  page.on("pageerror", (error) => errors.push({ kind: "pageerror", name, text: error.message }));
  page.on("requestfailed", (request) => errors.push({ kind: "requestfailed", name, text: `${request.url()}: ${request.failure()?.errorText}` }));
  return errors;
}

async function runBrowserProof(page, moduleUrl) {
  return page.evaluate(async ({ moduleUrl }) => {
    const serviceModule = await import(moduleUrl);
    const channelModule = await import(new URL("./agent-channel.js", moduleUrl).href);
    const {
      CAP_CLIPBOARD,
      MAX_CLIPBOARD_BYTES,
      TYPE_CLIP_SET,
      encodeClipboardText,
    } = channelModule;
    const {
      CLIPBOARD_STATE,
      ClipboardService,
    } = serviceModule;
    const assert = {
      equal(actual, expected, message = "values differ") {
        if (!Object.is(actual, expected)) throw new Error(`${message}: ${JSON.stringify({ actual, expected })}`);
      },
      deepEqual(actual, expected, message = "values differ") {
        if (JSON.stringify(actual) !== JSON.stringify(expected)) {
          throw new Error(`${message}: ${JSON.stringify({ actual, expected })}`);
        }
      },
    };

    class BrowserChannel {
      constructor({ delayMs = 0, onSend = null } = {}) {
        this.delayMs = delayMs;
        this.onSend = onSend;
        this.sent = [];
        this.listeners = new Map();
        this.stateListeners = new Set();
      }

      supports(capability) {
        return capability === CAP_CLIPBOARD;
      }

      send(type, payload, options) {
        const bytes = new Uint8Array(payload);
        this.sent.push({ type, bytes: Array.from(bytes), options: { capability: String(options?.capability) } });
        this.onSend?.({ type, bytes: Array.from(bytes), options });
        return new Promise((resolve) => setTimeout(() => resolve(true), this.delayMs));
      }

      subscribe(type, listener) {
        const listeners = this.listeners.get(type) ?? new Set();
        listeners.add(listener);
        this.listeners.set(type, listeners);
        let active = true;
        return () => {
          if (!active) return false;
          active = false;
          listeners.delete(listener);
          return true;
        };
      }

      subscribeState(listener) {
        this.stateListeners.add(listener);
        return () => this.stateListeners.delete(listener);
      }

      emitState(state, generation) {
        for (const listener of [...this.stateListeners]) listener({ state, generation });
      }
    }

    const decode = (bytes) => new TextDecoder("utf-8", { fatal: true }).decode(new Uint8Array(bytes));
    const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
    const waitUntil = async (predicate, message) => {
      for (let attempt = 0; attempt < 100; attempt += 1) {
        if (predicate()) return;
        await sleep(5);
      }
      throw new Error(message);
    };
    const makePasteEvent = (text, onRead = null) => {
      const event = new Event("paste", { bubbles: true, cancelable: true });
      const clipboardData = {
        getData(kind) {
          onRead?.();
          return kind === "text/plain" ? text : "";
        },
      };
      Object.defineProperty(event, "clipboardData", {
        configurable: true,
        get() {
          onRead?.();
          return clipboardData;
        },
      });
      return event;
    };
    const makeTarget = (label) => {
      const target = document.createElement("div");
      target.tabIndex = 0;
      target.textContent = label;
      document.body.append(target);
      return target;
    };

    const surface = document.querySelector("#surface");
    const status = document.querySelector("#status");
    surface.focus();
    const browserWrites = [];
    const guestChannel = new BrowserChannel();
    const guestService = new ClipboardService({
      channel: guestChannel,
      target: surface,
      focusTarget: surface,
      gestureTarget: surface,
      statusElement: status,
      writeClipboard: async (text) => {
        browserWrites.push(text);
        await navigator.clipboard.writeText(text);
      },
    });

    const guestSamples = [
      { name: "three-byte", text: "abc" },
      { name: "crlf", text: "alpha\r\nbravo" },
      { name: "utf8", text: "emoji 🦀\r\n" },
      { name: "exact-256-kib", text: "x".repeat(MAX_CLIPBOARD_BYTES) },
    ];
    const guestRoundTrips = [];
    for (const sample of guestSamples) {
      const bytes = encodeClipboardText(sample.text);
      const result = await guestService.handleGuestFrame({ payload: bytes, generation: guestService.generation });
      assert.equal(result.ok, true, `${sample.name} guest write failed`);
      const observed = await navigator.clipboard.readText();
      assert.equal(observed, sample.text, `${sample.name} clipboard bytes changed`);
      guestRoundTrips.push({ name: sample.name, bytes: bytes.byteLength, exact: observed === sample.text });
    }

    const order = [];
    const hostTarget = makeTarget("host-to-guest");
    const hostChannel = new BrowserChannel({
      delayMs: 8,
      onSend: () => order.push("channel-send"),
    });
    const hostService = new ClipboardService({
      channel: hostChannel,
      target: hostTarget,
      focusTarget: hostTarget,
      gestureTarget: hostTarget,
      isFocused: () => document.activeElement === hostTarget,
      onPasteReady: () => order.push("key-ready"),
    });
    hostTarget.focus();
    const firstEvent = makePasteEvent("first-try");
    hostTarget.dispatchEvent(firstEvent);
    await hostService.waitForLastPaste();
    assert.deepEqual(order, ["channel-send", "key-ready"], "paste key-ready ran before the frame");
    assert.equal(decode(hostChannel.sent[0].bytes), "first-try", "first paste was stale");

    const hostSamples = [
      { name: "three-byte", text: "abc" },
      { name: "crlf", text: "alpha\r\nbravo" },
      { name: "utf8", text: "emoji 🦀\r\n" },
      { name: "exact-256-kib", text: "y".repeat(MAX_CLIPBOARD_BYTES) },
    ];
    const hostRoundTrips = [{ name: "first-try", bytes: hostChannel.sent[0].bytes.length, exact: decode(hostChannel.sent[0].bytes) === "first-try" }];
    for (const sample of hostSamples) {
      const event = makePasteEvent(sample.text);
      const result = await hostService.handlePasteEvent(event);
      assert.equal(result.ok, true, `${sample.name} host paste failed`);
      const bytes = encodeClipboardText(sample.text);
      const observed = hostChannel.sent.at(-1).bytes;
      assert.deepEqual(observed, Array.from(bytes), `${sample.name} host bytes changed`);
      hostRoundTrips.push({ name: sample.name, bytes: observed.length, exact: decode(observed) === sample.text });
    }

    const attackWrites = [];
    const attackChannel = new BrowserChannel();
    const attackService = new ClipboardService({
      channel: attackChannel,
      isFocused: () => true,
      writeClipboard: (text) => { attackWrites.push(text); },
      autoAttach: false,
    });
    for (let index = 0; index < 100; index += 1) {
      const text = index % 2 === 0 ? "identical" : `different-${index}`;
      const result = await attackService.handlePasteEvent(makePasteEvent(text));
      assert.equal(result.ok, true, `100-copy ordering attack failed at ${index}`);
      const echo = await attackService.handleGuestFrame({
        payload: encodeClipboardText(text),
        generation: 0,
      });
      assert.equal(echo.suppressed, true, `echo was not suppressed at ${index}`);
    }
    assert.equal(attackChannel.sent.length, 100, "100-copy attack emitted feedback frames");
    assert.equal(attackService.suppressedEchoes, 100, "100-copy attack lost echo suppression");
    assert.equal(attackWrites.length, 0, "suppressed echoes wrote to the host");

    // A real guest-originated identical value after the expected echo has been consumed must still
    // be accepted. This is the direction-change case a content-only guard gets wrong.
    const userCopy = await attackService.handleGuestFrame({
      payload: encodeClipboardText("identical"),
      generation: 0,
    });
    assert.equal(userCopy.suppressed, undefined, "identical guest action was mistaken for an echo");
    assert.deepEqual(attackWrites, ["identical"]);
    await attackService.sendHostText("identical", { generation: 0 });
    const identicalEcho = await attackService.handleGuestFrame({
      payload: encodeClipboardText("identical"),
      generation: 0,
    });
    assert.equal(identicalEcho.suppressed, true, "identical host echo was not suppressed");
    attackChannel.emitState("disconnected", 0);
    attackChannel.emitState("ready", 2);
    const postReconnect = await attackService.handleGuestFrame({
      payload: encodeClipboardText("identical"),
      generation: 2,
    });
    assert.equal(postReconnect.suppressed, undefined, "stale echo survived a channel generation change");
    const echoAttack = {
      immediateCopies: 100,
      emittedFrames: attackChannel.sent.length,
      suppressedEchoes: attackService.suppressedEchoes,
      identicalDirectionChangeAccepted: true,
      reconnectInvalidatedHistory: true,
    };

    const denialTarget = makeTarget("permission-denial");
    let permissionAllowed = false;
    let permissionAttempts = 0;
    const permissionWrites = [];
    const permissionService = new ClipboardService({
      channel: new BrowserChannel(),
      target: denialTarget,
      focusTarget: denialTarget,
      gestureTarget: denialTarget,
      writeClipboard: async (text) => {
        permissionAttempts += 1;
        if (!permissionAllowed) throw Object.assign(new Error("permission denied"), { name: "NotAllowedError" });
        permissionWrites.push(text);
      },
    });
    const denied = await permissionService.handleGuestFrame({ payload: encodeClipboardText("staged-copy") });
    assert.equal(denied.staged, true);
    assert.equal(permissionService.state, CLIPBOARD_STATE.DENIED);
    assert.equal(permissionService.pending, true);
    await sleep(25);
    assert.equal(permissionAttempts, 1, "permission denial started a background retry");
    permissionAllowed = true;
    denialTarget.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    await waitUntil(() => permissionService.state === CLIPBOARD_STATE.SYNCED, "gesture did not flush staged clipboard");
    assert.deepEqual(permissionWrites, ["staged-copy"]);
    assert.equal(permissionService.pending, false);
    const permission = {
      deniedState: CLIPBOARD_STATE.DENIED,
      stagedBytes: new TextEncoder().encode("staged-copy").byteLength,
      attemptsBeforeGesture: 1,
      attemptsAfterGesture: permissionAttempts,
      recovered: permissionService.state === CLIPBOARD_STATE.SYNCED,
    };

    const privacyTarget = makeTarget("unfocused-privacy");
    let clipboardDataReads = 0;
    const privacyChannel = new BrowserChannel();
    const privacyService = new ClipboardService({
      channel: privacyChannel,
      target: privacyTarget,
      focusTarget: privacyTarget,
      gestureTarget: privacyTarget,
      isFocused: () => false,
      writeClipboard: () => { throw new Error("unfocused service must not write"); },
    });
    privacyTarget.dispatchEvent(makePasteEvent("private", () => { clipboardDataReads += 1; }));
    await sleep(10);
    assert.equal(clipboardDataReads, 0, "unfocused paste inspected clipboardData");
    assert.equal(privacyChannel.sent.length, 0, "unfocused paste sent a frame");
    const privacy = { focused: false, clipboardDataReads, sentFrames: privacyChannel.sent.length };

    const invalidService = new ClipboardService({
      channel: new BrowserChannel(),
      writeClipboard: () => { throw new Error("invalid payload reached write"); },
      autoAttach: false,
    });
    const oversized = await invalidService.handleGuestFrame({ payload: new Uint8Array(MAX_CLIPBOARD_BYTES + 1) });
    const malformed = await invalidService.handleGuestFrame({ payload: Uint8Array.of(0xff) });
    assert.equal(oversized.reason, "invalid");
    assert.equal(malformed.reason, "invalid");
    const invalid = {
      oversizedBytes: MAX_CLIPBOARD_BYTES + 1,
      oversizedReason: oversized.reason,
      malformedReason: malformed.reason,
      writeNeverReached: true,
    };

    const surfaceListenerCounts = { paste: 0, pointerdown: 0, keydown: 0 };
    const originalAdd = surface.addEventListener.bind(surface);
    const originalRemove = surface.removeEventListener.bind(surface);
    const observedTarget = {
      addEventListener(type, listener, options) {
        if (type in surfaceListenerCounts) surfaceListenerCounts[type] += 1;
        return originalAdd(type, listener, options);
      },
      removeEventListener(type, listener, options) {
        return originalRemove(type, listener, options);
      },
    };
    const tabOne = new ClipboardService({ channel: new BrowserChannel(), target: observedTarget, gestureTarget: observedTarget, autoAttach: false });
    tabOne.attach();
    tabOne.attach();
    assert.deepEqual(surfaceListenerCounts, { paste: 1, pointerdown: 1, keydown: 1 }, "listener attach was not idempotent");

    const result = {
      browser: {
        userAgent: navigator.userAgent,
        clipboardPermissionContext: true,
        consoleErrors: [],
      },
      guestRoundTrips,
      hostRoundTrips,
      firstPasteOrdering: { order, exactFirstBytes: true, noStaleFirstPaste: true },
      echoAttack,
      permission,
      privacy,
      invalid,
      listenerAttach: { counts: surfaceListenerCounts, idempotent: true },
      status: { state: status.dataset.state, text: status.textContent },
      browserWrites: browserWrites.length,
    };
    document.querySelector("#result").textContent = JSON.stringify(result, null, 2);
    return result;
  }, { moduleUrl });
}

async function runSecondTab(page, moduleUrl) {
  return page.evaluate(async ({ moduleUrl }) => {
    const { ClipboardService } = await import(moduleUrl);
    const { CAP_CLIPBOARD, TYPE_CLIP_SET, encodeClipboardText } = await import(new URL("./agent-channel.js", moduleUrl).href);
    const assert = {
      equal(actual, expected, message = "values differ") {
        if (!Object.is(actual, expected)) throw new Error(`${message}: ${JSON.stringify({ actual, expected })}`);
      },
    };
    const target = document.querySelector("#surface");
    const counts = { paste: 0, pointerdown: 0, keydown: 0 };
    const originalAdd = target.addEventListener.bind(target);
    target.addEventListener = (type, listener, options) => {
      if (type in counts) counts[type] += 1;
      return originalAdd(type, listener, options);
    };
    class TabChannel {
      constructor() { this.sent = []; this.listeners = new Map(); this.stateListeners = new Set(); }
      supports(capability) { return capability === CAP_CLIPBOARD; }
      send(type, payload, options) {
        this.sent.push({ type, bytes: Array.from(new Uint8Array(payload)), options });
        return Promise.resolve(true);
      }
      subscribe(type, listener) {
        const listeners = this.listeners.get(type) ?? new Set();
        listeners.add(listener);
        this.listeners.set(type, listeners);
        return () => listeners.delete(listener);
      }
      subscribeState(listener) { this.stateListeners.add(listener); return () => this.stateListeners.delete(listener); }
    }
    const channel = new TabChannel();
    const service = new ClipboardService({
      channel,
      target,
      focusTarget: target,
      gestureTarget: target,
      isFocused: () => true,
      writeClipboard: () => { throw new Error("two-tab probe must not read or write the system clipboard"); },
      autoAttach: false,
    });
    service.attach();
    service.attach();
    const event = new Event("paste", { cancelable: true });
    Object.defineProperty(event, "clipboardData", { get: () => ({ getData: () => "tab-two" }) });
    const host = await service.handlePasteEvent(event);
    const echo = await service.handleGuestFrame({ payload: encodeClipboardText("tab-two"), generation: 0 });
    assert.equal(host.ok, true);
    assert.equal(echo.suppressed, true);
    assert.equal(counts.paste, 1);
    assert.equal(counts.pointerdown, 1);
    assert.equal(counts.keydown, 1);
    assert.equal(service.pending, false);
    return {
      tab: 2,
      listenerCounts: counts,
      sentFrames: channel.sent.length,
      pending: service.pending,
      clipboardReads: 0,
      suppressedEchoes: service.suppressedEchoes,
      isolated: channel.sent.length === 1 && service.suppressedEchoes === 1,
    };
  }, { moduleUrl });
}

const nativeProtocol = runNative("cargo", ["test", "-p", "wasm-vm-agent-protocol"]);
const nativeGuest = runNative("cargo", ["test", "-p", "wasm-vm-guest-agent", "--", "--nocapture"]);
const requiredGuestTests = [
  "clipboard_bridge_emits_changes_applies_host_values_and_answers_get",
  "clipboard_bridge_retries_missing_display_and_child_death_with_bounded_state",
  "clipboard_bridge_retains_host_set_across_helper_failures_and_reports_fallback",
  "clipboard_payload_errors_are_naked_without_touching_the_serial_session",
  "helper_children_are_reaped_and_io_is_bounded_without_a_shell",
  "reset_terminates_an_inflight_frame_and_backoff_is_bounded",
];
for (const testName of requiredGuestTests) {
  assert.ok(nativeGuest.stdout.includes(testName), `native guest proof did not list ${testName}`);
}

const sourceDistHashes = {};
for (const name of ["agent-channel.js", "clipboard-service.js"]) {
  sourceDistHashes[name] = {
    source: await fileHash(path.join(webRoot, name)),
    dist: await fileHash(path.join(webRoot, "dist", name)),
  };
  assert.equal(sourceDistHashes[name].source, sourceDistHashes[name].dist, `${name} source/dist mismatch`);
}

const server = await startServer();
const address = server.address();
assert.ok(address && typeof address === "object");
const base = `http://${address.address}:${address.port}`;
const moduleUrl = `${base}/clipboard-service.js`;
const browserModule = await import(pathToFileURL(path.join(repo, "web/node_modules/playwright/index.mjs")).href);
const browser = await browserModule.chromium.launch({ headless: true, args: ["--disable-dev-shm-usage"] });
const browserVersion = browser.version();
const context = await browser.newContext({
  viewport: { width: 1360, height: 900 },
  permissions: ["clipboard-read", "clipboard-write"],
});
const page = await context.newPage();
const pageErrors = diagnostics(page, "tab-1");
const secondPage = await context.newPage();
const secondPageErrors = diagnostics(secondPage, "tab-2");
let browserResult;
let secondTabResult;
try {
  await page.goto(`${base}/clipboard-proof-fixture.html`, { waitUntil: "domcontentloaded" });
  await secondPage.goto(`${base}/clipboard-proof-fixture.html`, { waitUntil: "domcontentloaded" });
  browserResult = await runBrowserProof(page, moduleUrl);
  secondTabResult = await runSecondTab(secondPage, moduleUrl);
  await page.screenshot({ path: screenshotPath, fullPage: true });
  assert.deepEqual([...pageErrors, ...secondPageErrors], [], "Chromium proof emitted an uncaught error");
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}

const evidence = {
  schema: "e5-t24d-clipboard-proof-v1",
  capturedOn: `${dateStamp} America/New_York`,
  runtimeHead,
  recording: {
    browser: "Playwright Chromium headless",
    browserVersion,
    fixture: "local HTTP page importing web/clipboard-service.js and web/agent-channel.js",
    urlPath: "/clipboard-proof-fixture.html",
    consoleErrors: [...pageErrors, ...secondPageErrors],
    independentMachines: "waived by user",
    webkit: "waived by user",
  },
  browser: { ...browserResult, secondTab: secondTabResult },
  native: {
    protocol: { command: nativeProtocol.command, exitCode: nativeProtocol.exitCode },
    guest: {
      command: nativeGuest.command,
      exitCode: nativeGuest.exitCode,
      requiredTests: requiredGuestTests,
      childRecovery: true,
      queueIsolation: true,
    },
  },
  sourceDistHashes,
  screenshot: "evidence/e5-t24d/clipboard-proof-browser.png",
};

await fs.mkdir(evidenceDir, { recursive: true });
await fs.writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);
const transcript = [
  `E5-T24d clipboard proof — exact-head recording`,
  `Recorded: ${dateStamp}`,
  `Implementation head: ${runtimeHead}`,
  "",
  `Native protocol: ${nativeProtocol.command} (exit ${nativeProtocol.exitCode})`,
  `Native guest: ${nativeGuest.command} (exit ${nativeGuest.exitCode})`,
  `Guest helper recovery tests: ${requiredGuestTests.join(", ")}`,
  `Chromium: ${evidence.recording.browser} ${evidence.recording.browserVersion}`,
  `Console/page errors: ${evidence.recording.consoleErrors.length}`,
  `Screenshot: ${evidence.screenshot}`,
  "",
  JSON.stringify(evidence, null, 2),
  "",
  "The Chromium fixture proved guest→host writes, host→guest frame bytes, first-send ordering,",
  "100 immediate copy/echo pairs, identical direction changes, permission staging, focus privacy,",
  "invalid/oversized rejection, idempotent listeners, and isolated second-tab state. The native",
  "guest tests proved helper child recovery, bounded I/O, queue/reset isolation, and serial safety.",
].join("\n");
await fs.writeFile(transcriptPath, `${transcript}\n`);
console.log(JSON.stringify(evidence));
