import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { sha256, wireToVisibleRgba, compareRgba, checkLiteralOracle } from "./independent-pixels.mjs";

const repo = process.cwd(), dir = path.resolve(process.argv[2]);
const reportBytes = await fs.readFile(path.join(dir, "desktop/report.json"));
const report = JSON.parse(reportBytes);
const receiptBytes = await fs.readFile(path.join(dir, "run.json"));
const receipt = JSON.parse(receiptBytes);
const head = report.trial.head;
const git = (...args) => execFileSync("git", args, { cwd: repo, maxBuffer: 32 * 1024 * 1024,
  env: { ...process.env, DEVELOPER_DIR: "/Library/Developer/CommandLineTools" } });
const date = value => { const n = Date.parse(value); assert.ok(Number.isFinite(n)); return n; };
const identity = bytes => ({ size: bytes.length, sha256: sha256(bytes) });
assert.equal(git("rev-parse", head).toString().trim(), head);
assert.equal(receipt.head, head); assert.equal(receipt.reportSha256, sha256(reportBytes));
assert.equal(receipt.diagnosticOnly, true); assert.equal(receipt.desktopAcceptance, false);
assert.equal(report.trial.scopedStatus, "");
assert.equal(report.displayPixelProbeRequested, true);

const pins = {
  kernel: [24208896, "3cf8bed0d9a9941a6f2f81b7c8de86cefcba3e4e6bd5e5846bd395714a25642d"],
  bootSnapshot: [205400326, "265551f8ff8bed6bd5c0d775852c72c81cf448d4ecdc3f1b89f56fdbf60a0cd8"],
  overlayDelta: [1285559, "1b6b6598373a65b97bfe564ea023cd78938e84f15bbe4f9c04b87625371cfa4c"],
  chunkManifest: [1097812, "5f6a080986a423e5d77d2ec794eee3e42359ccc7d8a5fd23071a7420f4f23d44"],
};
const provenance = [];
for (const [role, [size, digest]] of Object.entries(pins)) {
  const row = report.candidate.source[role];
  assert.equal(row.size, size); assert.equal(row.sha256, digest);
  assert.deepEqual(identity(await fs.readFile(row.filename)), { size, sha256: digest });
  provenance.push({ role, size, sha256: digest });
}
const wasm = "7d7b300003cf68076c28958694062dacf3c879efe921bc631bade568ee143bdf";
assert.equal(receipt.wasmSha256, wasm);
assert.equal(report.identities.files["pkg/wasm_vm_wasm_bg.wasm"].sha256, wasm);
assert.equal(sha256(git("show", `${head}:web/dist/pkg/wasm_vm_wasm_bg.wasm`)), wasm);
const sourceRows = [];
for (const [file, row] of Object.entries(report.trial.helpers)) {
  assert.deepEqual(identity(git("show", `${head}:${file}`)), row);
  sourceRows.push({ file, ...row });
}
const resourceCache = new Map();
let gitResourcePaths = 0;
for (const row of report.resourceIdentities) {
  assert.equal(row.method, "GET"); assert.equal(row.status, 200);
  const key = row.repoPath ?? row.pathname;
  if (!resourceCache.has(key)) {
    const bytes = row.repoPath ? await fs.readFile(path.join(repo, row.repoPath))
      : row.pathname === "/" + report.candidate.manifest.chunkedImage.key
        ? await fs.readFile(report.candidate.source.chunkManifest.filename)
        : Buffer.from(JSON.stringify(report.candidate.manifest));
    resourceCache.set(key, identity(bytes));
    if (row.repoPath?.startsWith("web/dist/")) {
      assert.deepEqual(identity(git("show", `${head}:${row.repoPath}`)), identity(bytes));
      gitResourcePaths++;
    }
  }
  assert.deepEqual(resourceCache.get(key), { size: row.size, sha256: row.sha256 });
}

const keys = report.inputEvents;
assert.ok(keys.length > 0);
assert.ok(keys.every(row => row.trusted === true && row.target === "ide-display-canvas"
  && row.activeElement === "ide-display-canvas"));
const typed = keys.filter(row => row.type === "keydown" && row.key.length === 1).map(row => row.key).join("");
const keyboard = report.keyboard;
assert.equal(typed, `printf '${keyboard.nonce}' > ${keyboard.guestFile}`);
assert.deepEqual(keys.slice(-2).map(row => [row.type, row.code]), [["keydown", "Enter"], ["keyup", "Enter"]]);
const traffic = report.workerTraffic;
const serialIn = traffic.filter(row => row.type === "serial-input").map(row => Buffer.from(row.bytes).toString("ascii")).join("");
assert.ok(!serialIn.includes(keyboard.nonce));
assert.ok(!traffic.some(row => row.method === "sendAgentInput"));
let serialOut = "";
const spans = [];
for (const [index, row] of traffic.entries()) if (row.type === "serial-output") {
  spans.push({ start: serialOut.length, end: serialOut.length + row.text.length, index, timestamp: row.timestamp });
  serialOut += row.text;
}
const replies = [...serialOut.matchAll(/__WVBEGIN_([a-z0-9]+)\r?\n([\s\S]*?)\r?\n__WVEND_\1_(\d+)\r?\n/g)]
  .filter(match => match[2].trim() === keyboard.nonce && match[3] === "0");
assert.equal(replies.length, 1, "one exact nonce body in a completed success fence");
const reply = replies[0], endOffset = reply.index + reply[0].length - 1;
const completion = spans.find(row => row.start <= endOffset && row.end > endOffset);
const inputLine = serialIn.split("\r").find(line => line.includes(`__WVBEGIN_${reply[1]}`));
assert.ok(inputLine.includes(`if [ -f '${keyboard.guestFile}' ]; then cat '${keyboard.guestFile}'; else (exit 75); fi`));
assert.ok(date(completion.timestamp) >= keyboard.enteredAtMs);
assert.ok(date(completion.timestamp) <= keyboard.enteredAtMs + 120000);
assert.equal(date(keyboard.deadlineAt) - keyboard.enteredAtMs, 120000);
assert.ok(date(keyboard.completedAt) >= date(completion.timestamp));
assert.ok(date(keyboard.completedAt) <= date(keyboard.deadlineAt));
assert.ok(keyboard.typingMs <= 60000);
assert.equal(date(report.startup.deadlineAt) - date(report.startup.startedAt), 300000);
assert.ok(date(report.startup.readyProvenAt) <= date(report.startup.deadlineAt));
assert.equal(date(report.trial.captureDeadlineAt) - date(report.trial.captureStartedAt), 20000);
assert.ok(date(report.trial.responseImageCapturedAt) <= date(report.trial.captureDeadlineAt));
assert.equal(report.cleanup.timeoutMs, 30000); assert.equal(report.cleanup.closed, true);
assert.ok(date(report.finishedAt) - date(report.cleanup.startedAt) <= 30000);
assert.deepEqual(report.errors, []);
const acknowledgments = traffic.filter(row => row.type === "input-result"
  && ["sendKeyboardEvent", "syncKeyboard"].includes(row.method));
assert.equal(acknowledgments.length, keys.length * 2);
assert.ok(acknowledgments.every(row => row.result === true && row.error === null));

const capture = report.displayPixelProbe;
assert.equal(capture.disposed, true); assert.deepEqual(capture.errors, []);
assert.equal(capture.maxFrames, 8); assert.equal(capture.maxBytesPerFrame, 1280 * 832 * 4);
assert.equal(capture.maxEvents, 64);
assert.equal(capture.framesSeen, capture.frames.length + capture.evicted);
assert.ok(capture.frames.length <= 8 && capture.events.length <= 64);
assert.equal(capture.canvas.state.backend, "canvas2d");
assert.equal(capture.canvas.width, 1280); assert.equal(capture.canvas.height, 800);
assert.equal(capture.canvas.state.scheduler.pending, 0);
assert.equal(capture.canvas.state.framesReceived, capture.framesSeen);
assert.equal(capture.canvas.state.successfulPresents, capture.framesSeen);
assert.ok(date(capture.capturedAt) >= date(report.trial.responseImageCapturedAt));
assert.ok(date(capture.capturedAt) >= date(report.cleanup.startedAt));
assert.ok(date(capture.capturedAt) <= date(report.finishedAt));
const load = async row => {
  assert.ok(/^(canvas\.rgba|frame-\d+\.bgra)$/.test(row.file));
  const bytes = await fs.readFile(path.join(dir, "desktop/display-pixels", row.file));
  assert.deepEqual(identity(bytes), { size: row.size, sha256: row.sha256 });
  return bytes;
};
const canvas = await load(capture.canvas);
assert.equal(canvas.length, 1280 * 800 * 4);
const frames = [];
let previousRaw, previousVisible;
for (const frame of capture.frames) {
  const raw = await load(frame);
  assert.ok(raw.length <= capture.maxBytesPerFrame);
  const visible = wireToVisibleRgba(raw, frame, 1280, 800);
  const canvasRelation = compareRgba(visible, canvas, 1280);
  const rawChange = previousRaw?.length === raw.length ? compareRgba(previousRaw, raw, frame.resourceWidth) : null;
  const visibleChange = previousVisible ? compareRgba(previousVisible, visible, 1280) : null;
  frames.push({ sequence: frame.sequence, timestamp: frame.timestamp,
    postNonce: date(frame.timestamp) >= date(completion.timestamp), scanout: frame.scanout,
    format: frame.format, rect: frame.rect, width: frame.resourceWidth, height: frame.resourceHeight,
    rawSha256: sha256(raw), canvasRelation, rawChange, visibleChange });
  previousRaw = raw; previousVisible = visible;
}
const final = frames.at(-1);
assert.ok(final.postNonce, "final captured frame must be after raw nonce completion for decisive attribution");
const image = await fs.readFile(path.join(dir, "desktop/desktop-keyboard.png"));
const result = { head, report: identity(reportBytes), receipt: identity(receiptBytes),
  literalOracle: checkLiteralOracle(), provenance, sourceRows,
  resources: { served: report.resourceIdentities.length, distinct: resourceCache.size, gitResourcePaths },
  physical: { nonce: keyboard.nonce, guestFile: keyboard.guestFile, keys: keys.length,
    acknowledgments: acknowledgments.length, inputLine, rid: reply[1], rawCompletion: completion,
    rawElapsedMs: date(completion.timestamp) - keyboard.enteredAtMs,
    recorderElapsedMs: date(keyboard.completedAt) - keyboard.enteredAtMs,
    postNonceBaseline: report.trial.postNoncePresentationBaseline.framesReceived,
    screenshotFrames: report.trial.presentationAfter.framesReceived,
    screenshotDelayMs: date(report.trial.responseImageCapturedAt) - date(keyboard.completedAt) },
  cleanup: { startedAt: report.cleanup.startedAt, captureAt: capture.capturedAt,
    finishedAt: report.finishedAt, elapsedMs: date(report.finishedAt) - date(report.cleanup.startedAt) },
  capture: { seen: capture.framesSeen, evicted: capture.evicted, eventCount: capture.events.length,
    canvas: identity(canvas), state: capture.canvas.state, frames },
  image: identity(image), desktopAcceptance: false,
  lastFrameEqualsCanvas: final.canvasRelation.equal };
await fs.writeFile(new URL("./recording-check.json", import.meta.url), JSON.stringify(result, null, 2) + "\n");
console.log(JSON.stringify({ head, resources: result.resources, physical: result.physical,
  cleanup: result.cleanup, frames, image: result.image, lastFrameEqualsCanvas: result.lastFrameEqualsCanvas }, null, 2));
