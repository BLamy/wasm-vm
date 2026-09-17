import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { gunzipSync } from "node:zlib";
import { sha256, wireToVisibleRgba, compareRgba, checkLiteralOracle }
  from "../display-pixel-boundary-verifier/independent-pixels.mjs";
import { pngRgba } from "./png-rgba.mjs";

const repo = process.cwd(), root = path.resolve(process.argv[2]);
const desktop = path.join(root, "desktop");
const reportBytes = await fs.readFile(path.join(desktop, "report.json"));
const receiptBytes = await fs.readFile(path.join(root, "run.json"));
const report = JSON.parse(reportBytes), receipt = JSON.parse(receiptBytes);
const head = report.trial.head;
const git = (...args) => execFileSync("git", args, { cwd: repo, maxBuffer: 32 * 1024 * 1024,
  env: { ...process.env, DEVELOPER_DIR: "/Library/Developer/CommandLineTools" } });
const date = value => { const parsed = Date.parse(value); assert.ok(Number.isFinite(parsed)); return parsed; };
const identity = bytes => ({ size: bytes.length, sha256: sha256(bytes) });
assert.equal(git("rev-parse", head).toString().trim(), head);
assert.equal(receipt.head, head); assert.equal(receipt.reportSha256, sha256(reportBytes));
assert.equal(receipt.diagnosticOnly, true); assert.equal(receipt.desktopAcceptance, false);
assert.equal(report.trial.scopedStatus, "");
assert.equal(report.displayPixelProbeRequested, true); assert.equal(report.displayLateProbeRequested, true);

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
const sources = [];
for (const [file, row] of Object.entries(report.trial.helpers)) {
  assert.deepEqual(identity(git("show", `${head}:${file}`)), row);
  sources.push({ file, ...row });
}
const served = new Map(); let gitResources = 0;
for (const row of report.resourceIdentities) {
  assert.equal(row.method, "GET"); assert.equal(row.status, 200);
  const key = row.repoPath ?? row.pathname;
  if (!served.has(key)) {
    const bytes = row.repoPath ? await fs.readFile(path.join(repo, row.repoPath))
      : row.pathname === "/" + report.candidate.manifest.chunkedImage.key
        ? await fs.readFile(report.candidate.source.chunkManifest.filename)
        : Buffer.from(JSON.stringify(report.candidate.manifest));
    served.set(key, identity(bytes));
    if (row.repoPath?.startsWith("web/dist/")) {
      assert.deepEqual(identity(git("show", `${head}:${row.repoPath}`)), identity(bytes));
      gitResources++;
    }
  }
  assert.deepEqual(served.get(key), { size: row.size, sha256: row.sha256 });
}

const keys = report.inputEvents, keyboard = report.keyboard, traffic = report.workerTraffic;
assert.equal(keys.length, 128);
assert.ok(keys.every(row => row.trusted && row.target === "ide-display-canvas" && row.activeElement === "ide-display-canvas"));
const typed = keys.filter(row => row.type === "keydown" && row.key.length === 1).map(row => row.key).join("");
assert.equal(typed, `printf '${keyboard.nonce}' > ${keyboard.guestFile}`);
assert.deepEqual(keys.slice(-2).map(row => [row.type, row.code]), [["keydown", "Enter"], ["keyup", "Enter"]]);
const serialIn = traffic.filter(row => row.type === "serial-input").map(row => Buffer.from(row.bytes).toString("ascii")).join("");
assert.ok(!serialIn.includes(keyboard.nonce));
assert.ok(!traffic.some(row => row.method === "sendAgentInput"));
let serialOut = ""; const spans = [];
for (const [index, row] of traffic.entries()) if (row.type === "serial-output") {
  spans.push({ start: serialOut.length, end: serialOut.length + row.text.length, index, timestamp: row.timestamp });
  serialOut += row.text;
}
const replies = [...serialOut.matchAll(/__WVBEGIN_([a-z0-9]+)\r?\n([\s\S]*?)\r?\n__WVEND_\1_(\d+)\r?\n/g)]
  .filter(match => match[2].trim() === keyboard.nonce && match[3] === "0");
assert.equal(replies.length, 1);
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

const late = report.displayLateProbe;
assert.equal(late.diagnosticOnly, true); assert.equal(late.desktopAcceptance, false);
assert.equal(late.timeoutMs, 180000); assert.equal(late.status, "captured");
const start = date(late.startedAt), deadline = date(late.deadlineAt);
assert.equal(deadline - start, 180000);
assert.ok(start >= date(report.trial.responseImageCapturedAt));
assert.ok(date(late.finishedAt) <= deadline);
assert.ok(date(report.cleanup.startedAt) >= date(late.finishedAt));
const originalPng = await fs.readFile(path.join(desktop, "desktop-keyboard.png"));
assert.deepEqual(late.original, { result: report.result, nonceCompletedAt: keyboard.completedAt,
  responseImageCapturedAt: report.trial.responseImageCapturedAt, captureDeadlineAt: report.trial.captureDeadlineAt,
  presentationAfter: report.trial.presentationAfter, pngSha256: sha256(originalPng) });
const lateStimuli = traffic.filter(row => date(row.timestamp) >= start
  && (row.type === "serial-input" || row.type === "input-request"));
assert.deepEqual(lateStimuli, [], "new input or command during continuation");
assert.deepEqual(late.checkpoints.map(row => row.offsetMs), [0, 40000, 80000, 120000, 160000]);
const checkpoints = [];
let previous = null;
for (const row of late.checkpoints) {
  assert.ok(date(row.startedAt) >= start + row.offsetMs);
  assert.ok(date(row.capturedAt) >= date(row.startedAt));
  assert.ok(date(row.finishedAt) >= date(row.capturedAt) && date(row.finishedAt) <= deadline);
  assert.ok(date(row.frame.timestamp) <= date(row.capturedAt));
  assert.equal(row.frame.sequence, row.sequence); assert.equal(row.after.sequence, row.sequence);
  for (const state of [row.canvas.state, row.after.state]) {
    assert.equal(state.framesReceived, row.framesSeen); assert.equal(state.successfulPresents, row.framesSeen);
    assert.equal(state.scheduler.pending, 0); assert.equal(state.backend, "canvas2d");
  }
  assert.equal(row.canvas.width, 1280); assert.equal(row.canvas.height, 800);
  assert.equal(row.frame.format, 2);
  const load = async (kind, data) => {
    assert.equal(data.file, `checkpoint-${row.offsetMs}-${kind}.gz`); assert.equal(data.encoding, "gzip");
    const packed = await fs.readFile(path.join(desktop, "late-display", data.file));
    assert.equal(sha256(packed), data.packedSha256);
    const bytes = gunzipSync(packed, { maxOutputLength: 1280 * 832 * 4 });
    assert.deepEqual(identity(bytes), { size: data.size, sha256: data.sha256 });
    return bytes;
  };
  const raw = await load("frame", row.frame), canvas = await load("canvas", row.canvas);
  const normalized = wireToVisibleRgba(raw, row.frame, 1280, 800);
  const workerToCanvas = compareRgba(normalized, canvas, 1280);
  const imageBytes = await fs.readFile(path.join(desktop, "late-display", row.image));
  assert.equal(row.image, `checkpoint-${row.offsetMs}.png`); assert.equal(sha256(imageBytes), row.imageSha256);
  const png = pngRgba(imageBytes); assert.equal(png.width, 1280); assert.equal(png.height, 800);
  const pngToCanvas = compareRgba(png.rgba, canvas, 1280);
  checkpoints.push({ offsetMs: row.offsetMs, measuredOffsetMs: date(row.capturedAt) - start,
    afterOriginalImageMs: date(row.capturedAt) - date(report.trial.responseImageCapturedAt),
    frameSequence: row.sequence, frameAt: row.frame.timestamp, frameScanout: row.frame.scanout,
    received: row.framesSeen, capturedAt: row.capturedAt, finishedAt: row.finishedAt,
    raw: identity(raw), canvas: identity(canvas), png: identity(imageBytes), workerToCanvas, pngToCanvas,
    changeSincePrevious: previous ? compareRgba(previous, canvas, 1280) : null });
  previous = canvas;
}
const finalProbe = report.displayPixelProbe;
assert.equal(finalProbe.disposed, true); assert.deepEqual(finalProbe.errors, []);
assert.equal(finalProbe.maxFrames, 8); assert.equal(finalProbe.maxEvents, 64);
assert.ok(finalProbe.frames.length <= 8 && finalProbe.events.length <= 64);
assert.equal(finalProbe.frames.length + finalProbe.evicted, finalProbe.framesSeen);
assert.ok(date(finalProbe.capturedAt) >= date(report.cleanup.startedAt));
assert.ok(date(finalProbe.capturedAt) <= date(report.finishedAt));
const result = { head, report: identity(reportBytes), receipt: identity(receiptBytes),
  literalOracle: checkLiteralOracle(), provenance, sources,
  resources: { served: report.resourceIdentities.length, distinct: served.size, gitResources },
  physical: { nonce: keyboard.nonce, guestFile: keyboard.guestFile, keys: keys.length,
    acknowledgments: acknowledgments.length, inputLine, fence: reply[1], rawCompletion: completion,
    elapsedMs: date(completion.timestamp) - keyboard.enteredAtMs,
    captureDelayMs: date(report.trial.responseImageCapturedAt) - date(keyboard.completedAt) },
  timing: { startedAt: late.startedAt, deadlineAt: late.deadlineAt, finishedAt: late.finishedAt,
    diagnosticElapsedMs: date(late.finishedAt) - start,
    startDelayAfterOriginalMs: start - date(report.trial.responseImageCapturedAt),
    noContinuationStimuli: true, cleanupMs: date(report.finishedAt) - date(report.cleanup.startedAt) },
  original: { ...late.original, image: identity(originalPng) }, checkpoints,
  finalProbe: { disposed: finalProbe.disposed, seen: finalProbe.framesSeen, evicted: finalProbe.evicted,
    retained: finalProbe.frames.length, events: finalProbe.events.length }, desktopAcceptance: false };
await fs.writeFile(new URL("./recording-check.json", import.meta.url), JSON.stringify(result, null, 2) + "\n");
console.log(JSON.stringify({ head, resources: result.resources, physical: result.physical,
  timing: result.timing, checkpoints, finalProbe: result.finalProbe }, null, 2));
