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
const folder = "evidence/omarchy-profile/prepared-direct-input-r1";
const head = "9cc377180921be98f904c3689a1d7c48b9df3947";
assert.ok(folder && /^[a-f0-9]{40}$/u.test(head));
const out = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(repo, folder);
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const iso = value => { const n = Date.parse(value); assert.ok(Number.isFinite(n)); return n; };
const git = (...args) => execFileSync("git", args, { cwd: repo, maxBuffer: 32 * 1024 * 1024 });
const propertiesInOrder = ["opaque", "force_rgbx", "opacity", "opacity_inactive", "opacity_fullscreen", "opacity_override", "opacity_inactive_override", "opacity_fullscreen_override"];
const fixedCommand = `XDG_RUNTIME_DIR=/run/user/1000 hyprctl -i 0 --batch '${[
  ...propertiesInOrder.map(p => `getprop active ${p}`), "j/activewindow",
].join("; ")}'`;
const reportBytes = await fs.readFile(path.join(root, "desktop/report.json"));
assert.equal(hash(reportBytes), "0d4f8f50d2d9e940ce098f744202bcff49ae3c1048b39d692231d1d2c7fa38ea");
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
const input = auditInputReport(report, { head, wasmSha256: run.wasmSha256, arm: "candidate", preparedDirect: true, startupCommands: [fixedCommand] });
const read = report.keyboard ? `if [ -f '${report.keyboard.guestFile}' ]; then cat '${report.keyboard.guestFile}'; else (exit 75); fi` : null;
const serial = auditSerial(report.workerTraffic, [fixedCommand, ...(read ? [read] : [])]);
const configs = serial.filter(row => row.command === fixedCommand);
assert.equal(configs.length, 1);
const config = configs[0], receipt = report.preparedDirect;
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
let foot = null;
try { foot = JSON.parse(properties.slice(8).join("\n")); } catch {}
const configured = config.response?.exit === 0 && properties.length > 8
  && [0, 1, 5, 6, 7].every(index => properties[index] === "true")
  && [2, 3, 4].every(index => /^1(?:\.0+)?$/u.test(properties[index]))
  && foot?.class === "foot" && foot?.mapped === true && foot?.hidden === false
  && foot?.visible === true && foot?.acceptsInput === true
  && foot?.address === "0x55555eb73630" && foot?.pid === 503
  && JSON.stringify(foot?.at) === "[12,38]" && JSON.stringify(foot?.size) === "[1256,750]";
assert.equal(configured, true);
if (configured) assert.deepEqual(receipt.foot, foot);
assert.equal(receipt.status, configured ? "properties-confirmed" : "properties-unproven");
if (!configured) { assert.equal(report.keyboard, undefined); assert.equal(report.inputEvents.length, 0); }
const runtimes = report.observations.filter(row => row.runtime).map(row => row.runtime);
for (const row of runtimes) {
  assert.equal(row.presentation.latest.resourceWidth, 1280); assert.equal(row.presentation.latest.resourceHeight, 832);
  assert.deepEqual(row.presentation.latest.rect, { x: 0, y: 0, width: 1280, height: 800 });
  assert.equal(row.guestSession.key, "omarchy");
}

assert.equal(input.nonceReplies, 0);
assert.equal(input.completedReads, 32);
assert.equal(input.pendingReads, 0);
assert.ok(input.readExits.every(exit => exit === 75));
assert.equal(input.machineAcceptance, false);
assert.equal(report.trial.outcome, "nonce-readback-failed");
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
  const fence = report.preparedDirectInputFence;
  assert.equal(fence.method, "Input.setIgnoreInputEvents"); assert.equal(fence.ignore, true);
  assert.ok(iso(fence.startedAt) >= k.enteredAtMs && iso(fence.acknowledgedAt) < iso(k.deadlineAt));
  assert.ok(report.inputEvents.every(row => iso(row.timestamp) <= iso(fence.startedAt)));
}
const source = report.candidate.source;
const pins = {
  kernel: [24208896, "af7c4e471ed4dabdbe5a2717d81cc034b511d2b0f7706de66ad9e84e078c7cce"],
  chunkManifest: [1097812, "5f6a080986a423e5d77d2ec794eee3e42359ccc7d8a5fd23071a7420f4f23d44"],
  bootSnapshot: [207172408, "989dff1cad261ab6e53e1dea8f57cb12866d2a236b5366f114102744553d4e75"],
  overlayDelta: [1232847, "4fde816771e4fcfe085b492b6321302e945c58145c5c16f0c91e02ac94d10972"],
};
for (const [role, [size, sha256]] of Object.entries(pins)) {
  assert.equal(source[role].size, size); assert.equal(source[role].sha256, sha256);
}
assert.equal(run.wasmSha256, "8230800b2ed4fe92ed0647d871d6c548fe824f3a550b09ca4a9b4941bc220ca4");
assert.equal(report.loaderIdentity.baseBinding, pins.chunkManifest[1]);
assert.equal(report.loaderIdentity.rawSha256, pins.chunkManifest[1]);
const requiredRoutes = ["/app.html", "/main.js", "/loader.js", "/linux-worker.js", "/linux-worker-protocol.js",
  "/pkg/wasm_vm_wasm_bg.wasm", "/artifacts-omarchy.json", "/candidate/kernel", "/candidate/boot-snapshot", "/candidate/overlay-delta",
  "/" + report.candidate.manifest.chunkedImage.key];
const routes = new Set(report.resourceIdentities.map(row => row.pathname));
for (const pathname of requiredRoutes) assert.ok(routes.has(pathname), pathname);
for (const request of report.browserRequests) {
  const target = new URL(request.url); assert.equal(target.origin, url.origin); assert.equal(request.method, "GET");
  assert.ok(routes.has(target.pathname) || target.pathname === "/favicon.ico");
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
await fs.writeFile(path.join(out, "run-audit.json"), JSON.stringify(result, null, 2) + "\n");
console.log(JSON.stringify({ head, reportSha256: result.reportSha256, configured, properties,
  result: report.result, outcome: input.outcome, keyEvents: report.inputEvents.length,
  nonceReplies: input.nonceReplies, images, cleanupElapsedMs: result.cleanupElapsedMs }, null, 2));
