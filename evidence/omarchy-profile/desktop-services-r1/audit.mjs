// Offline audit of the recorded service boundary, not desktop-input acceptance.
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { assertInputTrialSource } from "../../../tools/verify/omarchy-input-trial.mjs";
import { auditDesktopServicesReport } from "../../../tools/verify/omarchy-desktop-services.mjs";

const dir = path.dirname(fileURLToPath(import.meta.url)), repo = path.resolve(dir, "../../..");
const read = file => fs.readFileSync(path.join(dir, file));
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const receipt = JSON.parse(read("run.json")), r = JSON.parse(read("desktop/report.json"));
const head = "3f80aa9cd0843662d4c1764a425d051ec8efb489";
assert.equal(receipt.head, head); assert.equal(r.trial.head, head);
assert.equal(receipt.exit.code, 1); assert.equal(receipt.exit.closed, true);
assert.equal(receipt.exit.watchdog, null); assert.equal(receipt.exit.error ?? null, null);
const boundary = auditDesktopServicesReport(r);
assert.equal(boundary.serviceIsolation, true); assert.equal(boundary.desktopAcceptance, false);
assert.equal(r.trial.outcome, "startup-failed-input-not-tested");
assert.equal(r.result, "failed"); assert.equal(r.keyboard, undefined);
assert.deepEqual(r.inputEvents, []);
assert.ok(!r.workerTraffic.some(row => /^(sendKeyboardEvent|syncKeyboard|sendTabletEvent|syncTablet|sendMouseEvent|syncMouse)$/u.test(row.method)));
assert.equal(r.startup.readyProvenAt, undefined); assert.equal(r.restored, true);
for (const [name, value] of Object.entries({ startupMs: 300000, typingMs: 60000,
  readbackMs: 120000, captureMs: 20000, cleanupMs: 30000 })) assert.equal(r.trial[name], value);
assert.equal(r.trial.profilingRequested, false); assert.equal(r.trial.admissionProbeRequested, false);
assertInputTrialSource(r.candidate.source);
assert.equal(Date.parse(r.startup.deadlineAt) - Date.parse(r.startup.startedAt), 300000);
assert.ok(Date.parse(r.cleanup.startedAt) >= Date.parse(r.startup.deadlineAt));
assert.ok(Date.parse(r.finishedAt) - Date.parse(r.startup.deadlineAt) < 50000);
const names = [...new Set([...Object.keys(r.trial.helpers),
  ...r.resourceIdentities.filter(row => row.repoPath?.startsWith("web/dist/")).map(row => row.repoPath)])];
for (const name of names) assert.match(name, /^[a-zA-Z0-9_./-]+$/u);
const batch = execFileSync("git", ["cat-file", "--batch"], { cwd: repo,
  input: names.map(name => `${head}:${name}\n`).join(""), maxBuffer: 64000000 });
const frozen = new Map(); let offset = 0;
for (const name of names) {
  const end = batch.indexOf(10, offset);
  const match = /^([0-9a-f]{40}) blob ([0-9]+)$/u.exec(batch.subarray(offset, end).toString());
  assert.ok(match); offset = end + 1;
  const size = Number(match[2]); frozen.set(name, batch.subarray(offset, offset + size));
  offset += size; assert.equal(batch[offset++], 10);
}
assert.equal(offset, batch.length);
for (const [name, pin] of Object.entries(r.trial.helpers)) assert.equal(hash(frozen.get(name)), pin.sha256);
const url = new URL(r.url), origin = url.origin, query = url.searchParams, paths = new Set();
assert.equal(url.hostname, "127.0.0.1"); assert.equal(url.protocol, "http:");
assert.deepEqual([...query.keys()].sort(), ["desktop", "guest", "jit", "jitColdCounterRecycling", "omarchyAssetBase", "omarchyDivider"]);
for (const [key, value] of Object.entries({ guest: "omarchy", desktop: "1", jit: "1",
  jitColdCounterRecycling: "0", omarchyDivider: "64", omarchyAssetBase: origin })) assert.equal(query.get(key), value);
for (const row of r.resourceIdentities) {
  assert.equal(row.method, "GET"); assert.equal(row.status, 200);
  if (row.repoPath) assert.ok(!path.isAbsolute(row.repoPath) && !row.repoPath.split("/").includes(".."));
  const manifestRoute = `/${r.candidate.manifest.chunkedImage.key}`;
  if (!row.repoPath) assert.ok(["/artifacts-omarchy.json", manifestRoute].includes(row.pathname));
  const data = row.repoPath?.startsWith("web/dist/") ? frozen.get(row.repoPath)
    : row.repoPath ? fs.readFileSync(path.join(repo, row.repoPath))
      : row.pathname === manifestRoute ? fs.readFileSync(r.candidate.source.chunkManifest.filename)
        : Buffer.from(JSON.stringify(r.candidate.manifest));
  assert.equal(row.size, data.length); assert.equal(row.sha256, hash(data)); paths.add(row.pathname);
}
for (const row of r.browserRequests) {
  const request = new URL(row.url); assert.equal(request.origin, origin); assert.equal(row.method, "GET");
  assert.ok(paths.has(request.pathname) || request.pathname === "/favicon.ico");
}
assert.equal(r.identities.files["pkg/wasm_vm_wasm_bg.wasm"].sha256, receipt.wasmSha256);
assert.deepEqual(boundary.serial.map(row => row.command), [
  "XDG_RUNTIME_DIR=/run/user/1000 hyprctl -i 0 -j layers", "XDG_RUNTIME_DIR=/run/user/1000 hyprctl -i 0 -j clients"]);
assert.equal(boundary.serial[0].response.exit, 0); assert.equal(boundary.serial[1].response, null);
const screenshots = {};
for (const name of ["desktop.png", "failure.png"]) {
  const row = r.observations.find(item => item.screenshot?.endsWith(`/${name}`)); assert.ok(row);
  screenshots[name] = hash(read(`desktop/${name}`)); assert.equal(screenshots[name], row.sha256);
}
const runtime = r.observations.findLast(row => row.runtime).runtime;
assert.equal(runtime.presentation.framesReceived, 2); assert.equal(runtime.presentation.successfulPresents, 2);
console.log(JSON.stringify({ head, wasmSha256: receipt.wasmSha256, ...boundary,
  reportSha256: hash(read("desktop/report.json")), screenshots,
  servedResponses: r.resourceIdentities.length, browserRequests: r.browserRequests.length,
  desktopReadyMs: r.events.find(row => row.type === "wvm:desktop-ready").ms,
  scheduler: runtime.scheduler, jitRetiredShare: runtime.jit.jitRetiredShare,
  limitations: ["No physical input was attempted: startup qualification failed at300s.",
    "Removed hidden traffic does not prove a performance improvement or resolve T03d.",
    "Coordinator personally viewed the actual desktop and failure screenshots."] }, null, 2));
