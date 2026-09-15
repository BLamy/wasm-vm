// One-run offline comparison; no guest writes or desktop-acceptance inference.
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { auditSerial } from "../../../tools/verify/omarchy-latency-receipt.mjs";
const dir = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(dir, "../../..");
const read = name => JSON.parse(fs.readFileSync(path.join(dir, name)));
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const ids = read("identities.json"), wire = read("wire.json"), rows = read("diagnostic.json");
const base = JSON.parse(fs.readFileSync(path.join(dir, "../latency-boundary-r2/identities.json")));
const baseRows = JSON.parse(fs.readFileSync(path.join(dir, "../latency-boundary-r2/diagnostic.json")));
assert.equal(ids.head, "26085068dd2b892f4c2ab585e3461c3f91aefe6a");
assert.equal(ids.scopedStatus, ""); assert.equal(ids.headed, true);
assert.deepEqual(ids.harness, base.harness); assert.deepEqual(ids.errors, []);
for (const helper of ids.harness) assert.equal(helper.sha256,
  hash(execFileSync("git", ["show", `${ids.head}:${helper.path}`], { cwd: repo })));
assert.equal(ids.ready.restoredFromBootSnapshot, true);
assert.deepEqual(rows[0].sourceReceipt, baseRows[0].sourceReceipt);
for (const r of ids.resourceIdentities) {
  assert.equal(r.status, 200); assert.equal(r.method, "GET");
  if (r.repoPath) {
    assert.ok(!path.isAbsolute(r.repoPath) && !r.repoPath.split("/").includes(".."));
    const bytes = r.repoPath.startsWith("web/dist/")
      ? execFileSync("git", ["show", `${ids.head}:${r.repoPath}`], { cwd: repo, maxBuffer: 16000000 })
      : fs.readFileSync(path.join(repo, r.repoPath));
    assert.equal(r.size, bytes.length); assert.equal(r.sha256, hash(bytes));
  }
  const prior = base.resourceIdentities.find(x => x.pathname === r.pathname);
  if (prior) { assert.equal(r.sha256, prior.sha256); assert.equal(r.size, prior.size); }
  else assert.match(r.pathname, /^\/chunked-omarchy\/chunks\/[a-f0-9]{64}\.bin$/u);
}
const typed = rows.filter(r => r.request?.op === "type");
assert.equal(typed.length, 1); assert.deepEqual(typed[0].request, { op: "type", text: "x", delay: 100 });
for (const row of rows.slice(1)) assert.ok(["stats", "screenshot", "type"].includes(row.request?.op));
assert.equal(wire.inputEvents.length, 2);
for (const [n, event] of wire.inputEvents.entries()) {
  assert.equal(event.type, n ? "keyup" : "keydown"); assert.equal(event.code, "KeyX");
  assert.equal(event.trusted, true); assert.equal(event.repeat, false);
  assert.equal(event.target, "ide-display-canvas"); assert.equal(event.activeElement, "ide-display-canvas");
}
const keys = wire.workerTraffic.filter(r => r.type === "worker-call" && ["sendKeyboardEvent", "syncKeyboard"].includes(r.method));
assert.equal(keys.length, 4);
for (const [n, call] of keys.entries()) {
  assert.deepEqual(call.args, n % 2 ? [] : [1, 45, n < 2 ? 1 : 0]);
  assert.equal(call.method, n % 2 ? "syncKeyboard" : "sendKeyboardEvent");
  const replies = wire.workerTraffic.filter(r => r.type === "input-result" && r.id === call.id);
  assert.equal(replies.length, 1); assert.equal(replies[0].result, true); assert.equal(replies[0].error, null);
}
const serial = auditSerial(wire.workerTraffic, []);
const stats = rows.filter(r => r.request?.op === "stats"); assert.equal(stats.length, 3);
for (const s of [ids.ready, ...stats.map(r => r.result)]) {
  assert.equal(s.clock.mode, "icount"); assert.equal(s.clock.clockDiv, 1); assert.equal(s.clock.timebaseHz, 10000000);
  assert.equal(s.jit.hasExecutor, true); assert.equal(s.jit.decodedCacheEntries, 4096);
  assert.equal(s.jit.jitResidencyPolicy, "repack-off"); assert.equal(s.jit.jitResidencyCap, 24);
}
const [, immediate, end] = stats;
const windowMs = Date.parse(end.time) - Date.parse(wire.inputEvents[1].timestamp);
assert.ok(windowMs >= 120000 && windowMs <= 180000);
const files = ["identities.json", "wire.json", "diagnostic.json", ...rows.filter(r => r.request?.op === "screenshot").map(r => r.request.name)];
console.log(JSON.stringify({ diagnosticOnly: true, desktopAcceptance: false, actualHead: ids.head,
  servedResponses: ids.resourceIdentities.length, explicitDiagnosticCommands: 0,
  implicitSerialCommands: serial.map(r => ({ command: r.command, sentAt: r.sentAt, completedAt: r.completedAt })),
  keyupToEndpointMs: windowMs, immediateToEndpointMs: Date.parse(end.time) - Date.parse(immediate.time),
  guestRetiredDelta: end.result.scheduler.retiredInstructions - immediate.result.scheduler.retiredInstructions,
  guestClockTicksDelta: (BigInt(end.result.clock.mtime) - BigInt(immediate.result.clock.mtime)).toString(),
  frames: stats.map(s => s.result.display.framesReceived), presents: stats.map(s => s.result.display.successfulPresents),
  opaqueAgentMessages: wire.workerTraffic.filter(r => r.method === "sendAgentInput").length,
  digests: Object.fromEntries(files.map(name => [name, hash(fs.readFileSync(path.join(dir, name)))])),
  limitations: ["Screenshots require separate visual inspection.", "Opaque agent messages are not payload-audited.",
    "Input queue drainage is not guest consumption.", "Sequential stats are not atomic instruction/clock snapshots."] }, null, 2));
