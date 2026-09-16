// Read-only independent recording audit. Never launches a browser/guest.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { auditSerial } from "../../../tools/verify/omarchy-latency-receipt.mjs";
import { auditInputReport } from "../../../tools/verify/omarchy-input-audit.mjs";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const [folder, head] = process.argv.slice(2);
assert.ok(folder && /^[a-f0-9]{40}$/u.test(head));
const out = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(repo, folder);
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const iso = value => { const n = Date.parse(value); assert.ok(Number.isFinite(n)); return n; };
const git = (...args) => execFileSync("git", args, { cwd: repo, maxBuffer: 32 * 1024 * 1024 });
const helper = git("show", `${head}:tools/verify/omarchy-opaque-foot-command.mjs`).toString();
const fixedCommand = /export const OPAQUE_FOOT_COMMAND = `([^`]+)`;/u.exec(helper)?.[1];
assert.ok(fixedCommand);
const reportBytes = await fs.readFile(path.join(root, "desktop/report.json"));
const report = JSON.parse(reportBytes);
const run = JSON.parse(await fs.readFile(path.join(root, "run.json")));
assert.equal(run.head, head); assert.equal(report.trial.head, head);
assert.equal(run.reportSha256, hash(reportBytes));
assert.equal(run.acceptanceClaim, false); assert.equal(run.desktopAcceptance, false);
assert.equal(run.exit.closed, true); assert.equal(run.exit.watchdog, null);
assert.equal(report.cleanup.closed, true); assert.deepEqual(report.errors, []);
assert.ok(iso(report.finishedAt) - iso(report.cleanup.startedAt) <= 30000);

const cache = new Map();
async function identity(filename) {
  const absolute = path.resolve(repo, filename);
  assert.ok(absolute.startsWith(repo + path.sep));
  if (!cache.has(absolute)) {
    const bytes = await fs.readFile(absolute);
    cache.set(absolute, { size: bytes.length, sha256: hash(bytes) });
  }
  return cache.get(absolute);
}
for (const [rel, pin] of Object.entries(report.trial.helpers)) {
  const frozen = git("show", `${head}:${rel}`);
  assert.deepEqual({ size: frozen.length, sha256: hash(frozen) }, pin);
}
for (const role of ["kernel", "bootSnapshot", "overlayDelta", "chunkManifest"]) {
  const pin = report.candidate.source[role];
  assert.deepEqual(await identity(pin.filename), { size: pin.size, sha256: pin.sha256 });
}
for (const row of report.resourceIdentities) {
  assert.equal(row.method, "GET"); assert.equal(row.status, 200);
  let pin;
  if (row.repoPath) pin = await identity(row.repoPath);
  else if (row.pathname === "/artifacts-omarchy.json")
    pin = { size: Buffer.byteLength(JSON.stringify(report.candidate.manifest)), sha256: hash(JSON.stringify(report.candidate.manifest)) };
  else {
    assert.equal(row.pathname, "/" + report.candidate.manifest.chunkedImage.key);
    pin = await identity(report.candidate.source.chunkManifest.filename);
  }
  assert.equal(pin.size, row.size, row.pathname); assert.equal(pin.sha256, row.sha256, row.pathname);
  if (row.repoPath?.startsWith("web/")) assert.equal(hash(git("show", `${head}:${row.repoPath}`)), row.sha256);
}
const url = new URL(report.url);
assert.equal(url.hostname, "127.0.0.1"); assert.equal(url.protocol, "http:");
assert.deepEqual([...url.searchParams], [["guest", "omarchy"], ["desktop", "1"], ["omarchyDivider", "64"],
  ["jit", "1"], ["jitColdCounterRecycling", "0"], ["jitResidency", "cap-256"], ["omarchyAssetBase", url.origin]]);
const input = auditInputReport(report, { head, wasmSha256: run.wasmSha256, arm: "candidate", startupCommands: [fixedCommand] });
const read = report.keyboard ? `if [ -f '${report.keyboard.guestFile}' ]; then cat '${report.keyboard.guestFile}'; else (exit 75); fi` : null;
const serial = auditSerial(report.workerTraffic, [fixedCommand, ...(read ? [read] : [])]);
const configs = serial.filter(row => row.command === fixedCommand);
assert.equal(configs.length, 1);
const config = configs[0], receipt = report.opaqueFoot;
assert.equal(receipt.command, fixedCommand); assert.equal(receipt.requestCount, 1);
assert.equal(receipt.deadlineAtMs, iso(report.startup.deadlineAt));
assert.ok(iso(config.sentAt) >= iso(receipt.startedAt));
assert.ok(iso(config.sentAt) < receipt.deadlineAtMs);
if (receipt.response) {
  assert.deepEqual(receipt.response, config.response);
  assert.ok(iso(config.completedAt) <= iso(receipt.respondedAt));
  assert.ok(iso(receipt.respondedAt) < receipt.deadlineAtMs);
}
const properties = config.response?.stdout.split(/\r?\n/u).map(s => s.trim()).filter(Boolean) ?? [];
const configured = config.response?.exit === 0 && properties.length === 4
  && properties.slice(0, 3).join(",") === "ok,true,true" && /^1(?:\.0+)?$/u.test(properties[3]);
assert.equal(receipt.status, configured ? "properties-confirmed" : "configuration-failed");
if (!configured) { assert.equal(report.keyboard, undefined); assert.equal(report.inputEvents.length, 0); }
const runtimes = report.observations.filter(row => row.runtime).map(row => row.runtime);
for (const row of runtimes) {
  assert.equal(row.presentation.latest.resourceWidth, 1280); assert.equal(row.presentation.latest.resourceHeight, 832);
  assert.deepEqual(row.presentation.latest.rect, { x: 0, y: 0, width: 1280, height: 800 });
  assert.equal(row.guestSession.key, "omarchy");
}

if (report.keyboard?.typedAt) {
  const k = report.keyboard, events = [], add = (type, code, key) => events.push({ type, code, key });
  const command = `printf '${k.nonce}' > ${k.guestFile}`;
  for (const c of command) {
    const shift = c === ">";
    const code = /[a-z]/u.test(c) ? "Key" + c.toUpperCase() : /[0-9]/u.test(c) ? "Digit" + c
      : ({ " ": "Space", "'": "Quote", ">": "Period", "/": "Slash", "-": "Minus" })[c];
    assert.ok(code);
    if (shift) add("keydown", "ShiftLeft", "Shift");
    add("keydown", code, c); add("keyup", code, c);
    if (shift) add("keyup", "ShiftLeft", "Shift");
  }
  add("keydown", "Enter", "Enter"); add("keyup", "Enter", "Enter");
  assert.deepEqual(report.inputEvents.map(({ type, code, key }) => ({ type, code, key })), events);
  const traffic = report.workerTraffic;
  for (const call of traffic.filter(row => row.type === "worker-call" && ["sendKeyboardEvent", "syncKeyboard"].includes(row.method))) {
    const ack = traffic.find(row => row.type === "input-result" && row.worker === call.worker && row.id === call.id && row.method === call.method);
    assert.ok(traffic.indexOf(ack) > traffic.indexOf(call)); assert.equal(ack.result, true); assert.equal(ack.error, null);
  }
  assert.ok(iso(k.startedAt) >= iso(receipt.respondedAt));
  assert.ok(k.enteredAtMs - iso(k.startedAt) <= 60000);
  assert.equal(iso(k.deadlineAt), k.enteredAtMs + 120000);
  if (!k.verified) { assert.ok(iso(k.failedAt) >= iso(k.deadlineAt)); assert.equal(report.result, "failed"); }
  const fence = report.opaqueFootInputFence;
  assert.equal(fence.method, "Input.setIgnoreInputEvents"); assert.equal(fence.ignore, true);
  assert.ok(iso(fence.startedAt) >= k.enteredAtMs && iso(fence.acknowledgedAt) < iso(k.deadlineAt));
  assert.ok(report.inputEvents.every(row => iso(row.timestamp) <= iso(fence.startedAt)));
}
const screens = new Map(report.observations.filter(row => row.screenshot).map(row => [row.screenshot, row]));
const images = [];
for (const [filename, row] of screens) {
  const pin = await identity(filename); assert.equal(pin.sha256, row.sha256);
  images.push({ file: path.relative(repo, filename), ...pin, capturedAt: row.timestamp });
}
const result = { head, reportSha256: hash(reportBytes), runSha256: hash(await fs.readFile(path.join(root, "run.json"))),
  fixedCommand, verifiedHelperFiles: Object.keys(report.trial.helpers).length,
  rehashedResources: report.resourceIdentities.length, configuration: { configured, properties, raw: config },
  input, cleanupElapsedMs: iso(report.finishedAt) - iso(report.cleanup.startedAt), images,
  visibleResponse: "Requires direct image inspection; no image/counter inference made by this script.",
  productAcceptance: false };
await fs.writeFile(path.join(out, `${path.basename(root)}-audit.json`), JSON.stringify(result, null, 2) + "\n");
console.log(JSON.stringify({ head, reportSha256: result.reportSha256, configured, properties,
  result: report.result, outcome: input.outcome, keyEvents: report.inputEvents.length,
  nonceReplies: input.nonceReplies, images, cleanupElapsedMs: result.cleanupElapsedMs }, null, 2));
