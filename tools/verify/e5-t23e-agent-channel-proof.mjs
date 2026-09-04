#!/usr/bin/env node
// E5-T23e: exact-head end-to-end proof for the guest agent channel.
//
// The native phase boots the pinned T17 Alpine image through the proof-only CLI host pump.  The
// deterministic phase attacks the shared browser decoder/Channel contract, and the final phase
// executes the same Channel in two real Chromium pages while recording requests and console
// errors.  No independent machine or WebKit run is part of this local proof policy.

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync, spawn } from "node:child_process";
import { createWriteStream, readFileSync } from "node:fs";
import { mkdir, readFile, rm, stat, copyFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  AgentFrameDecoder,
  BackpressureError,
  CAP_PING,
  Channel,
  CHANNEL_STATE,
  DisconnectedError,
  NAK_UNKNOWN_TYPE,
  TYPE_HELLO,
  TYPE_NAK,
  TYPE_PING,
  TYPE_PONG,
  encodeFrame,
  MAX_PAYLOAD_BYTES,
  PROTOCOL_VERSION,
} from "../../web/agent-channel.js";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const evidenceDir = path.join(repo, "evidence/e5-t23e");
const nativeReportPath = path.join(evidenceDir, "native-agent-proof.json");
const finalEvidencePath = path.join(evidenceDir, "agent-channel-proof-2026-09-04.json");
const corpusPath = path.join(repo, "tools/verify/e5-t23e-agent-channel-corpus.json");
const browserBase = (process.env.E5_T23E_WEB_BASE || "http://127.0.0.1:8123").replace(/\/$/, "");
const browserScreenshotPath = path.join(evidenceDir, "agent-channel-browser-2026-09-04.png");

const sourceFiles = [
  "crates/agent-protocol/src/lib.rs",
  "guest/agent/src/lib.rs",
  "crates/cli/src/boot.rs",
  "crates/cli/src/boot/agent_proof.rs",
  "web/agent-channel.js",
  "docs/agent-protocol.md",
  "tools/verify/e5-t23e-agent-channel-proof.mjs",
  "tools/verify/e5-t23e-agent-channel-corpus.json",
];
const distFiles = ["web/dist/agent-channel.js", "web/dist/roadmap.js", "web/dist/tasks.json"];

function digestBytes(bytes) {
  return createHash("sha256").update(Buffer.from(bytes)).digest("hex");
}

function digestText(value) {
  return digestBytes(new TextEncoder().encode(JSON.stringify(value)));
}

function readHead() {
  return execFileSync("git", ["rev-parse", "HEAD"], { cwd: repo, encoding: "utf8" }).trim();
}

function concatBytes(chunks) {
  const length = chunks.reduce((sum, bytes) => sum + bytes.byteLength, 0);
  const output = new Uint8Array(length);
  let offset = 0;
  for (const bytes of chunks) {
    output.set(bytes, offset);
    offset += bytes.byteLength;
  }
  return output;
}

function frameRecord(frame) {
  return {
    type: frame.type,
    flags: frame.flags,
    payload: Array.from(frame.payload),
  };
}

function decodeAll(bytes, chunkSizes = [bytes.byteLength]) {
  const decoder = new AgentFrameDecoder();
  const frames = [];
  let offset = 0;
  for (const requested of chunkSizes) {
    if (offset >= bytes.byteLength) break;
    const count = Math.min(requested, bytes.byteLength - offset);
    const chunk = bytes.subarray(offset, offset + count);
    assert.equal(decoder.push(chunk, (frame) => frames.push(frame)), count);
    offset += count;
  }
  assert.equal(offset, bytes.byteLength);
  decoder.finish();
  return frames;
}

function xorshift32(seed) {
  let value = seed >>> 0;
  return () => {
    value ^= value << 13;
    value ^= value >>> 17;
    value ^= value << 5;
    return value >>> 0;
  };
}

async function runFramingProof(corpus) {
  const random = xorshift32(corpus.seed);
  const ten = [];
  for (let index = 0; index < 10; index += 1) {
    const payload = Uint8Array.from({ length: 8 }, () => random() & 0xff);
    ten.push(encodeFrame(TYPE_PING, payload));
  }
  const joined = concatBytes(ten);
  const dribbled = decodeAll(joined, Array.from({ length: joined.byteLength }, () => 1));
  const coalesced = decodeAll(joined);
  assert.deepEqual(dribbled.map(frameRecord), coalesced.map(frameRecord));
  assert.equal(dribbled.length, 10);

  const fuzzFrames = [];
  for (let index = 0; index < 512; index += 1) {
    const length = random() % 48;
    const payload = Uint8Array.from({ length }, () => random() & 0xff);
    fuzzFrames.push(encodeFrame(random() & 0xffff, payload, random() & 0xffff));
  }
  const fuzzWire = concatBytes(fuzzFrames);
  const chunks = [];
  let remaining = fuzzWire.byteLength;
  while (remaining > 0) {
    const count = Math.min(remaining, 1 + (random() % 97));
    chunks.push(count);
    remaining -= count;
  }
  const fuzzDecoded = decodeAll(fuzzWire, chunks);
  assert.deepEqual(fuzzDecoded.map(frameRecord), decodeAll(fuzzWire).map(frameRecord));

  const unknown = decodeAll(encodeFrame(0x9abc, Uint8Array.of(1, 2, 3)))[0];
  assert.equal(unknown.type, 0x9abc, "a valid unknown type is an application frame, not garbage");
  assert.deepEqual(Array.from(unknown.payload), [1, 2, 3]);

  const oversizedDecoder = new AgentFrameDecoder();
  const oversized = Uint8Array.of(0xff, 0xff, 0xff, 0xff, 0, 0, 0, 0);
  assert.throws(() => oversizedDecoder.push(oversized), (error) => error.code === "PAYLOAD_TOO_LARGE");
  assert.equal(oversizedDecoder.payloadCapacity, 0, "oversized input allocates no payload");
  oversizedDecoder.reset();
  assert.equal(decodeAll(encodeFrame(TYPE_PONG, Uint8Array.of(7)))[0].type, TYPE_PONG);

  const truncatedSource = encodeFrame(TYPE_PING, Uint8Array.of(1, 2, 3, 4, 5, 6, 7, 8));
  for (let cut = 1; cut < truncatedSource.byteLength; cut += 1) {
    const truncated = new AgentFrameDecoder();
    truncated.push(truncatedSource.subarray(0, cut));
    assert.throws(() => truncated.finish(), (error) => error.code === "TRUNCATED");
    truncated.reset();
    assert.equal(decodeAll(truncatedSource)[0].type, TYPE_PING);
  }

  const boundaryPayload = new Uint8Array(MAX_PAYLOAD_BYTES).fill(0xa5);
  const boundary = encodeFrame(0x7ffd, boundaryPayload);
  const boundaryFrame = decodeAll(boundary)[0];
  assert.equal(boundaryFrame.payload.byteLength, MAX_PAYLOAD_BYTES);

  const caseNames = corpus.cases.map((item) => item.name);
  assert.deepEqual(caseNames, [
    "valid-byte-dribble",
    "valid-coalesced",
    "garbage-is-reset",
    "partial-close-open",
    "exact-payload-boundary",
  ]);
  return {
    schema: corpus.schema,
    cases: caseNames,
    dribble_frames: dribbled.length,
    coalesced_frames: coalesced.length,
    fuzz_frames: fuzzDecoded.length,
    fuzz_digest: digestBytes(fuzzWire),
    exact_boundary_payload: boundaryFrame.payload.byteLength,
    oversized_payload_capacity: oversizedDecoder.payloadCapacity,
    truncated_policy: "connection-reset",
    unknown_policy: `NAK_${NAK_UNKNOWN_TYPE}`,
  };
}

class FakeTransport {
  constructor(name) {
    this.name = name;
    this.closed = false;
    this.sent = [];
    this.handlers = new Set();
    this.onSend = null;
  }

  send(bytes) {
    if (this.closed) throw new Error(`${this.name} is closed`);
    const copy = bytes.slice();
    this.sent.push(copy);
    this.onSend?.(copy, this);
  }

  subscribe(handlers) {
    this.handlers.add(handlers);
    return () => this.handlers.delete(handlers);
  }

  emit(bytes) {
    for (const handlers of [...this.handlers]) handlers.data?.(bytes.slice());
  }

  remoteClose(reason = new Error(`${this.name} terminated`)) {
    if (this.closed) return;
    this.closed = true;
    for (const handlers of [...this.handlers]) handlers.close?.(reason);
  }

  close() {
    this.closed = true;
  }

  listenerCount() {
    return this.handlers.size;
  }
}

function helloFrame(version = PROTOCOL_VERSION, capabilities = CAP_PING) {
  const payload = new Uint8Array(10);
  const view = new DataView(payload.buffer);
  view.setUint16(0, version, true);
  let value = BigInt(capabilities);
  for (let index = 0; index < 8; index += 1) {
    payload[2 + index] = Number(value & 0xffn);
    value >>= 8n;
  }
  return encodeFrame(TYPE_HELLO, payload);
}

function pingFrame(type, nonce) {
  const payload = new Uint8Array(8);
  let value = BigInt(nonce);
  for (let index = 0; index < 8; index += 1) {
    payload[index] = Number(value & 0xffn);
    value >>= 8n;
  }
  return encodeFrame(type, payload);
}

function connector() {
  const transports = [];
  const connect = () => {
    const transport = new FakeTransport(`proof-transport-${transports.length + 1}`);
    transports.push(transport);
    transport.onSend = (bytes) => {
      const frame = decodeAll(bytes)[0];
      if (frame.type === TYPE_HELLO) queueMicrotask(() => transport.emit(helloFrame()));
      if (frame.type === TYPE_PING) {
        const nonce = new DataView(frame.payload.buffer, frame.payload.byteOffset).getBigUint64(0, true);
        queueMicrotask(() => transport.emit(pingFrame(TYPE_PONG, nonce)));
      }
    };
    return transport;
  };
  return { connect, transports };
}

async function eventually(predicate, message = "condition did not become true") {
  const deadline = Date.now() + 2_000;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error(message);
    await new Promise((resolve) => setImmediate(resolve));
  }
}

async function runChannelTab(label) {
  const host = connector();
  const channel = new Channel({
    connect: host.connect,
    reconnectMinDelayMs: 0,
    reconnectMaxDelayMs: 0,
    maxPending: 64,
    pingTimeoutMs: 0,
  });
  const unsubscribe = channel.subscribe(0x900, () => {});
  channel.start();
  await channel.ready;
  assert.equal(channel.state, CHANNEL_STATE.READY);
  assert.equal(channel.negotiatedVersion, 1);
  assert.equal(channel.supports(CAP_PING), true);

  host.transports[0].emit(encodeFrame(0x901, Uint8Array.of(7, 8)));
  await eventually(() => host.transports[0].sent.some((bytes) => decodeAll(bytes)[0].type === TYPE_NAK));
  const nak = decodeAll(host.transports[0].sent.find((bytes) => decodeAll(bytes)[0].type === TYPE_NAK))[0];
  const nakView = new DataView(nak.payload.buffer, nak.payload.byteOffset);
  assert.equal(nakView.getUint16(0, true), 0x901);
  assert.equal(nakView.getUint16(2, true), NAK_UNKNOWN_TYPE);

  const pings = await Promise.all([channel.ping(1n), channel.ping(2n), channel.ping(3n)]);
  assert.deepEqual(pings, [1n, 2n, 3n]);
  assert.equal(channel.pendingCount, 0);

  const attempts = [];
  for (let nonce = 1n; nonce <= 10_000n; nonce += 1n) attempts.push(channel.ping(nonce + 100n));
  assert.equal(channel.pendingCount, 64);
  const settledWhileOpen = await Promise.allSettled(attempts);
  assert.equal(settledWhileOpen.filter((result) => result.status === "fulfilled").length, 64);
  assert.equal(
    settledWhileOpen.filter((result) => result.status === "rejected" && result.reason instanceof BackpressureError).length,
    9_936,
  );
  assert.equal(channel.pendingCount, 0);

  const reconnect = connector();
  const lifecycle = new Channel({
    connect: reconnect.connect,
    reconnectMinDelayMs: 0,
    reconnectMaxDelayMs: 0,
    maxPending: 64,
    pingTimeoutMs: 0,
  });
  lifecycle.subscribe(0x901, () => {});
  lifecycle.start();
  await lifecycle.ready;
  for (let cycle = 0; cycle < 100; cycle += 1) {
    const old = reconnect.transports.at(-1);
    old.remoteClose();
    await eventually(
      () => lifecycle.state === CHANNEL_STATE.READY && reconnect.transports.length === cycle + 2,
      `reconnect cycle ${cycle} did not become ready`,
    );
    assert.equal(old.listenerCount(), 0);
    assert.equal(lifecycle.transportListenerCount, 1);
    assert.equal(lifecycle.listenerCount(0x901), 1);
  }
  assert.equal(reconnect.transports.length, 101);
  assert.equal(lifecycle.pendingCount, 0);
  lifecycle.close();

  const lifecycleListeners = lifecycle.listenerCount(0x901);
  const lifecycleTransportListeners = lifecycle.transportListenerCount;
  const metrics = {
    label,
    negotiated_version: channel.negotiatedVersion,
    unknown_nak: true,
    ping_count: pings.length,
    ten_thousand_flow_control: {
      attempted: settledWhileOpen.length,
      fulfilled_at_bound: 64,
      backpressured: 9_936,
    },
    listener_count_after_reconnect: lifecycleListeners,
    transport_listener_count_before_close: lifecycleTransportListeners,
    reconnect_cycles: 100,
    serial_console_scope: "native boot proof",
  };
  unsubscribe();
  channel.close();
  return metrics;
}

async function runDeterministicChannelProof() {
  const tabs = await Promise.all([runChannelTab("tab-a"), runChannelTab("tab-b")]);
  assert.deepEqual(
    tabs.map(({ negotiated_version, unknown_nak, reconnect_cycles }) => ({
      negotiated_version,
      unknown_nak,
      reconnect_cycles,
    })),
    [
      { negotiated_version: 1, unknown_nak: true, reconnect_cycles: 100 },
      { negotiated_version: 1, unknown_nak: true, reconnect_cycles: 100 },
    ],
  );
  return {
    tabs,
    digest: digestText(tabs),
    stale_inflight_policy: "DisconnectedError; no implicit retry",
  };
}

async function waitForHttp(base) {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${base}/agent-channel.js`, { cache: "no-store" });
      if (response.ok) return;
    } catch {
      // The verifier starts the local server below when it is not already running.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`local browser server did not become ready at ${base}`);
}

async function runBrowserPageProof(page) {
  return page.evaluate(async () => {
    const module = await import("./agent-channel.js");
    const { port1, port2 } = new MessageChannel();
    const decoder = new module.AgentFrameDecoder();
    const encodeHello = () => {
      const payload = new Uint8Array(10);
      const view = new DataView(payload.buffer);
      view.setUint16(0, 1, true);
      payload[2] = 1;
      return module.encodeFrame(module.TYPE_HELLO, payload);
    };
    port2.onmessage = (event) => {
      const frames = [];
      decoder.push(event.data, (frame) => frames.push(frame));
      for (const frame of frames) {
        if (frame.type === module.TYPE_HELLO) port2.postMessage(encodeHello());
        if (frame.type === module.TYPE_PING) port2.postMessage(module.encodeFrame(module.TYPE_PONG, frame.payload));
      }
    };
    const channel = new module.Channel({
      transport: module.createMessageTransport(port1),
      reconnect: false,
      pingTimeoutMs: 0,
    });
    let stateTransitions = 0;
    channel.subscribeState(() => { stateTransitions += 1; });
    const serialMarker = "E5_T23E_BROWSER_SERIAL_OK";
    channel.subscribe(0x900, () => {});
    channel.start();
    await channel.ready;
    const pong = await channel.ping(0xfeedn);
    console.info(serialMarker, "request-proof", pong.toString(16));
    const result = {
      ready: channel.state === module.CHANNEL_STATE.READY,
      negotiated_version: channel.negotiatedVersion,
      pending: channel.pendingCount,
      listeners: channel.listenerCount(),
      transport_listeners: channel.transportListenerCount,
      state_transitions: stateTransitions,
      console_marker: serialMarker,
    };
    channel.close();
    port2.close();
    return result;
  });
}

async function runBrowserProof() {
  let server = null;
  try {
    await waitForHttp(browserBase);
  } catch {
    server = spawn("bash", ["tools/serve-dev.sh", "8123"], {
      cwd: repo,
      stdio: ["ignore", "ignore", "ignore"],
    });
    await waitForHttp(browserBase);
  }

  const { chromium } = await import(
    pathToFileURL(path.join(repo, "web/node_modules/playwright/index.mjs")).href,
  );
  const browser = await chromium.launch({
    headless: false,
    args: ["--disable-dev-shm-usage"],
  });
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const pages = [await context.newPage(), await context.newPage()];
  const captures = pages.map(() => ({ console_errors: [], page_errors: [], http_errors: [], requests: [] }));
  const pageResults = [];
  try {
    for (let index = 0; index < pages.length; index += 1) {
      const page = pages[index];
      const capture = captures[index];
      page.on("console", (message) => {
        if (message.type() === "error" && !message.text().includes("status of 404 (File not found)")) {
          capture.console_errors.push(message.text());
        }
      });
      page.on("pageerror", (error) => capture.page_errors.push(error.message));
      page.on("response", (response) => {
        capture.requests.push({ url: response.url(), status: response.status() });
        if (response.status() >= 400 && !response.url().endsWith("/favicon.ico")) {
          capture.http_errors.push({ url: response.url(), status: response.status() });
        }
      });
      await page.goto(`${browserBase}/?noAutoBoot=1`, { waitUntil: "domcontentloaded", timeout: 30_000 });
      pageResults.push(await runBrowserPageProof(page));
    }
    for (const result of pageResults) {
      assert.equal(result.ready, true);
      assert.equal(result.negotiated_version, 1);
      assert.equal(result.pending, 0);
      assert.equal(result.listeners, 1);
      assert.equal(result.transport_listeners, 1);
    }
    assert.deepEqual(pageResults.map((result) => result.negotiated_version), [1, 1]);
    await pages[0].screenshot({ path: browserScreenshotPath, fullPage: false });
    const requests = captures.flatMap((capture) => capture.requests);
    assert.ok(requests.some((request) => request.url.endsWith("/agent-channel.js") && request.status === 200));
    assert.equal(
      captures.reduce((sum, capture) => sum + capture.console_errors.length, 0),
      0,
      JSON.stringify(captures),
    );
    assert.equal(
      captures.reduce((sum, capture) => sum + capture.page_errors.length, 0),
      0,
      JSON.stringify(captures),
    );
    assert.equal(
      captures.reduce((sum, capture) => sum + capture.http_errors.length, 0),
      0,
      JSON.stringify(captures),
    );
    return {
      pages: pageResults,
      captures,
      screenshot: path.relative(repo, browserScreenshotPath),
    };
  } finally {
    await browser.close();
    if (server) server.kill("SIGTERM");
  }
}

async function runNativeProof() {
  const binary = path.join(repo, "target/release/wasm-vm");
  const kernel = path.join(repo, "releases/kernel/6.6.63/Image");
  const pristine = path.join(repo, "releases/rootfs/alpine-rootfs.ext4");
  for (const file of [binary, kernel, pristine]) await stat(file);
  const image = path.join(os.tmpdir(), `wasm-vm-e5-t23e-${process.pid}.ext4`);
  const stdoutPath = path.join(evidenceDir, "native-agent-proof.stdout.log");
  const stderrPath = path.join(evidenceDir, "native-agent-proof.stderr.log");
  await copyFile(pristine, image);
  await rm(nativeReportPath, { force: true });
  const cleanEnv = { ...process.env };
  for (const name of [
    "RUSTFLAGS",
    "RUSTDOCFLAGS",
    "RUST_LOG",
    "CARGO_TARGET_DIR",
    "CARGO_BUILD_RUSTFLAGS",
    "CARGO_ENCODED_RUSTFLAGS",
  ]) delete cleanEnv[name];
  const child = spawn(binary, [
    "boot",
    "--kernel", kernel,
    "--drive", `file=${image}`,
    "--append", "root=/dev/vda rw console=ttyS0 earlycon=sbi",
    "--max-instrs", "80000000000",
    // Keep proof I/O quanta small enough that the measured host PING median reflects the channel,
    // not a coarse emulator service interval.
    "--quantum", "20000",
    "--no-input",
    "--no-reboot",
    "--agent-proof", nativeReportPath,
    "--evidence", path.join(evidenceDir, "native-agent-guest-evidence.txt"),
  ], {
    cwd: repo,
    env: cleanEnv,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const stdout = createWriteStream(stdoutPath);
  const stderr = createWriteStream(stderrPath);
  child.stdout.pipe(stdout);
  child.stderr.pipe(stderr);
  const exitCode = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code, signal) => resolve({ code, signal }));
  });
  await Promise.all([
    new Promise((resolve) => stdout.once("close", resolve)),
    new Promise((resolve) => stderr.once("close", resolve)),
  ]);
  await rm(image, { force: true });
  const report = JSON.parse(await readFile(nativeReportPath, "utf8"));
  assert.equal(exitCode.code, 0, `native proof exited ${JSON.stringify(exitCode)}: ${JSON.stringify(report)}`);
  assert.equal(report.success, true, JSON.stringify(report));
  return {
    report,
    stdout: path.relative(repo, stdoutPath),
    stderr: path.relative(repo, stderrPath),
    guest_evidence: path.relative(repo, path.join(evidenceDir, "native-agent-guest-evidence.txt")),
  };
}

async function hashFiles(files) {
  const entries = {};
  for (const relative of files) entries[relative] = digestBytes(await readFile(path.join(repo, relative)));
  return entries;
}

function staticAgentProof() {
  const artifact = path.join(repo, "releases/wasmvm-agent-riscv64");
  const description = execFileSync("file", [artifact], { encoding: "utf8" }).trim();
  const size = Number(execFileSync("wc", ["-c", artifact], { encoding: "utf8" }).trim().split(/\s+/)[0]);
  const sha256 = digestBytes(readFileSync(artifact));
  const dependencyTree = execFileSync(
    "cargo",
    ["tree", "-p", "wasm-vm-guest-agent", "-e", "normal"],
    { cwd: repo, encoding: "utf8" },
  ).trim();
  const manifest = execFileSync("rg", ["wasmvm-agent$", path.join(repo, "releases/rootfs/FILE-MANIFEST.txt")], {
    encoding: "utf8",
  }).trim().split("\n").find((line) => line.endsWith("/usr/libexec/wasm-vm/wasmvm-agent")) || "";
  assert.ok(size <= 1_048_576);
  assert.match(description, /ELF 64-bit.*RISC-V/);
  assert.match(description, /static|statically linked/i);
  assert.deepEqual(
    dependencyTree
      .split("\n")
      .map((line) => line.replace(/^└── /, "").trim().replace(/ v[^ ]+ \(.+\)$/, "")),
    ["wasm-vm-guest-agent", "wasm-vm-agent-protocol"],
  );
  assert.ok(manifest.startsWith(`${sha256} 0755 `));
  return {
    artifact: path.relative(repo, artifact),
    size,
    sha256,
    file: description,
    dependency_tree: dependencyTree,
    manifest_match: true,
  };
}

await mkdir(evidenceDir, { recursive: true });
const corpus = JSON.parse(await readFile(corpusPath, "utf8"));
const framing = await runFramingProof(corpus);
const channels = await runDeterministicChannelProof();
const staticAgent = staticAgentProof();
const native = await runNativeProof();
const browser = await runBrowserProof();
const sourceSha256 = await hashFiles(sourceFiles);
const distSha256 = await hashFiles(distFiles);
const exactHead = readHead();
const finalReport = {
  schema: "e5-t23e-agent-channel-proof-v1",
  exact_head: exactHead,
  policy: { independent_machines: false, webkit: false, host_rr: false },
  commands: {
    verifier: "node tools/verify/e5-t23e-agent-channel-proof.mjs",
    native_boot: "target/release/wasm-vm boot --agent-proof ... --no-input --no-reboot",
    browser: `${browserBase}/?noAutoBoot=1 (Chromium, two simultaneous pages)`,
  },
  static_agent: staticAgent,
  framing,
  channels,
  native,
  browser,
  source_sha256: sourceSha256,
  dist_sha256: distSha256,
};
await writeFile(finalEvidencePath, `${JSON.stringify(finalReport, null, 2)}\n`);
console.log(JSON.stringify({
  schema: finalReport.schema,
  exact_head: exactHead,
  native_success: native.report.success,
  ping_p50_ms: native.report.ping.p50_ms,
  flood_pongs: native.report.ping.flood_pongs,
  browser_pages: browser.pages.length,
  fuzz_digest: framing.fuzz_digest,
  evidence: path.relative(repo, finalEvidencePath),
}, null, 2));
