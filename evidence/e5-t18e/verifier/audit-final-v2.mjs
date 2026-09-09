// Read-only evidence audit. This never starts a browser, guest, builder, or test suite.
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const main = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const clone = path.resolve(process.argv[2]);
const labels = Array.from({ length: 25 }, (_, i) => `cold-${String(i + 1).padStart(2, "0")}`).concat("warm-prime", "warm-reload");
assert.ok(labels.length > 0, "supply explicitly completed case labels");
assert.equal(new Set(labels).size, labels.length);
for (const label of labels) assert.match(label, /^(cold-(0[1-9]|1[0-9]|2[0-5])|warm-(prime|reload))$/);
const { PNG } = createRequire(import.meta.url)(path.join(main, "web/node_modules/playwright-core/lib/utilsBundle.js"));
const { LEFT_PTR } = await import(path.join(main, "web/src/input/desktop-cursor-template.js"));
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const head = (repo) => execFileSync("git", ["rev-parse", "HEAD"], { cwd: repo, encoding: "utf8" }).trim();
const frozenHead = "5506f2a514a6a7b90d83eafe8cf39e6d3ff4fd1b";
const mainHead = head(main);
assert.equal(head(clone), frozenHead);
const root = path.join(clone, "evidence/e5-t18e");
const immutableFiles = new Map();
async function recorded(file) {
  const bytes = await readFile(file);
  immutableFiles.set(file, sha(bytes));
  return bytes;
}
const pubBytes = await recorded(path.join(root, "publication.json"));
const binding = JSON.parse(pubBytes);
const { sources, runtime, publication, buildProvenance } = binding;
assert.equal(binding.head, frozenHead);
assert.equal(sha(JSON.stringify({ head: frozenHead, sources, runtime, publication, buildProvenance })), binding.sourceBindingSha256);
const sourceDifferences = [];
for (const [file, expected] of Object.entries(sources)) {
  assert.equal(sha(await recorded(path.join(clone, file))), expected, `frozen source ${file}`);
  assert.equal(sha(execFileSync("git", ["show", `${frozenHead}:${file}`], { cwd: clone })), expected, `committed source ${file}`);
  const current = sha(await readFile(path.join(main, file)));
  if (current !== expected) sourceDifferences.push({ file, frozenSha256: expected, currentSha256: current });
}
assert.deepEqual(sourceDifferences.map((entry) => entry.file), ["tools/verify/e5-t18e-desktop-bringup.mjs", "docs/desktop-bringup.md"]);
assert.equal(sourceDifferences[0].currentSha256, "e4aba2537476b5ed093cf729991693f1dd0adf581dcaa390f8284620566df816");
assert.equal(sha(await readFile(path.join(main, "tools/verify/e5-t18e-desktop-bringup.mjs"))),
  sha(execFileSync("git", ["show", "0d966c1fb8ef31e05c2bca52e1a191d9de235af3:tools/verify/e5-t18e-desktop-bringup.mjs"], { cwd: main })));
assert.equal(Object.keys(sources).length, 31); assert.equal(Object.keys(runtime).length, 15);
const initialBytes = await recorded(path.join(main, "evidence/e5-t18e/initial/publication.json"));
const initial = JSON.parse(initialBytes);
assert.equal(sha(initialBytes), buildProvenance.publicationRecordSha256);
assert.deepEqual(initialBytes, execFileSync("git", ["show", `${frozenHead}:evidence/e5-t18e/initial/publication.json`], { cwd: clone }));
assert.deepEqual(initialBytes, await recorded(path.join(buildProvenance.sourceDirectory, "evidence/e5-t18e/publication.json")));
assert.equal(head(buildProvenance.sourceDirectory), initial.head);
assert.equal(buildProvenance.head, initial.head); assert.equal(buildProvenance.mode, "incremental-proof-repair");
assert.equal(buildProvenance.buildInputsUnchanged, true);
assert.equal(buildProvenance.sourceBindingSha256, initial.sourceBindingSha256);
assert.equal(sha(JSON.stringify({ head: initial.head, sources: initial.sources, runtime: initial.runtime, publication: initial.publication })), initial.sourceBindingSha256);
for (const key of Object.keys(publication).filter(key => !["imageDir", "chunkDir"].includes(key))) assert.deepEqual(publication[key], initial.publication[key]);
for (const key of ["imageDir", "chunkDir"]) assert.equal(path.resolve(clone, publication[key]), path.resolve(buildProvenance.sourceDirectory, initial.publication[key]));
const snippet = "pkg/snippets/wasm-vm-wasm-0a6604668439f3ad/inline0.js";
assert.equal(runtime[snippet], sha(execFileSync("git", ["show", `${initial.head}:web/dist/${snippet}`], { cwd: main })));
const reportBytes = await recorded(path.join(root, "desktop-bringup.json"));
assert.equal(sha(reportBytes), "e056f3ef0f3e0a4c682eb6e40138f8f2c4e30cceb56bcd19fc0a6d6ad9aacd31");
const report = JSON.parse(reportBytes);
assert.equal(report.schema, "wasm-vm.e5-t18e.bringup.v2");
assert.equal(report.task, "E5-T18e"); assert.equal(report.passed, true);
for (const key of Object.keys(binding)) assert.deepEqual(report[key], binding[key]);
assert.equal(binding.sourceBindingSha256, "d6ad7a2abba368bea58142ad8cb0d6f8881916dd048e4fdd4136c5dcb84dd290");
assert.deepEqual(report.cases.map(c => c.label), labels);
assert.deepEqual(Object.fromEntries(Object.entries(report.configuration).filter(([key]) => key !== "coldCachePolicy")),
  { coldContexts: 25, coldConcurrency: 13, concurrentWarmPair: true, dpr: 1, serviceWorkers: "block", persistence: false });

// Check preservation, not a rebuild or a suite. Historical audits remain untouched.
const carryManifests = (await readdir(path.join(main, "evidence/e5-t18e/verifier"))).filter(f => f.endsWith("SHA256SUMS"));
let carriedDigests = 0;
for (const name of carryManifests) {
  const dir = path.join(main, "evidence/e5-t18e/verifier");
  for (const line of (await readFile(path.join(dir, name), "utf8")).trim().split("\n")) {
    const [, expected, file] = line.match(/^([0-9a-f]{64})\s+(.+)$/);
    const full = path.resolve(/^(evidence|tools)\//.test(file) ? main : dir, file);
    assert.equal(sha(await readFile(full)), expected, `carried digest ${name}: ${file}`); carriedDigests++;
  }
}
const copiedFiles = (await readdir(root, { withFileTypes: true })).filter(e => e.isFile()).map(e => e.name).sort();
assert.equal(copiedFiles.length + 1, 115);
const rawCopies = [];
for (const file of [...copiedFiles, "acceptance.log"]) {
  const from = file === "acceptance.log" ? path.join(clone, "../acceptance.log") : path.join(root, file);
  const bytes = await recorded(from);
  assert.deepEqual(await recorded(path.join(main, "evidence/e5-t18e", file)), bytes, `raw copy ${file}`);
  rawCopies.push({ file, sha256: sha(bytes) });
}
function independentCache(record, disabled, warmReload, minimum) {
  const entries = record.workers.flatMap(w => w.entries).filter(e => /\/e5t18b-desktop\/chunks\/[0-9a-f]{64}\.bin$/.test(e.name));
  const counts = { chunkRequests: entries.length, cachedChunkRequests: 0, networkChunkRequests: 0, unknownChunkRequests: 0 };
  for (const e of entries) {
    assert.equal(e.encodedBodySize, 131072); assert.equal(e.decodedBodySize, 131072);
    if (e.transferSize === 0) counts.cachedChunkRequests++;
    else if (e.transferSize > 0) counts.networkChunkRequests++;
    else counts.unknownChunkRequests++;
  }
  for (const key of Object.keys(counts)) assert.equal(record[key], counts[key], key);
  assert.ok(counts.chunkRequests >= minimum); assert.equal(counts.unknownChunkRequests, 0);
  if (disabled) assert.equal(counts.cachedChunkRequests, 0);
  if (warmReload) assert.ok(counts.cachedChunkRequests > 0);
  return counts;
}
assert.deepEqual(JSON.parse(await recorded(path.join(root, "cache-calibration.json"))), report.cacheCalibration);
assert.equal(report.cacheCalibration.passed, true);
assert.deepEqual(report.cacheCalibration.observations.map(o => [o.disabled, o.phase]), [[false, "prime"], [false, "reload"], [true, "prime"], [true, "reload"]]);
const calibration = report.cacheCalibration.observations.map(o => ({ disabled: o.disabled, phase: o.phase,
  ...independentCache(o, o.disabled, !o.disabled && o.phase === "reload", 2) }));
for (const [file, expected] of Object.entries(runtime)) {
  for (const repo of [clone, main]) for (const directory of ["web", "web/dist"]) {
    assert.equal(sha(await recorded(path.join(repo, directory, file))), expected, `${repo}/${directory}/${file}`);
  }
}

// The observed 1440x1100 DPR-1 page has a native-sized 1280x800 canvas at (80,84),
// derived from desktop-cursor.html layout and confirmed against the inspected PNG.
// Decode existing PNG bytes only; no screenshot is edited or regenerated.
const decoded = new Map(), groups = new Map(), cases = [];
function canvasFromPng(bytes, digest) {
  if (decoded.has(digest)) return decoded.get(digest);
  const png = PNG.sync.read(bytes);
  assert.equal(png.width, 1440); assert.equal(png.height, 1100);
  const rgba = Buffer.alloc(1280 * 800 * 4);
  for (let y = 0; y < 800; y++) {
    const start = ((y + 84) * png.width + 80) * 4;
    png.data.copy(rgba, y * 1280 * 4, start, start + 1280 * 4);
  }
  decoded.set(digest, rgba);
  return rgba;
}
function cursorPixels(rgba) {
  let count = 0;
  for (let y = 0; y < LEFT_PTR.length; y++) for (let x = 0; x < LEFT_PTR[y].length; x++) {
    const color = LEFT_PTR[y][x];
    if (color === ".") continue;
    const offset = ((159 + y) * 1280 + 479 + x) * 4;
    const expected = color === "W" ? 255 : 0;
    for (let channel = 0; channel < 3; channel++) assert.equal(rgba[offset + channel], expected, "independent cursor pixel");
    assert.equal(rgba[offset + 3], 255);
    count++;
  }
  assert.equal(count, 94);
  return count;
}
const acceptance = (await readFile(path.join(clone, "../acceptance.log"), "utf8")).split("\n");
const publicationLine = acceptance.findIndex((line) => line.startsWith("E5T18E_REBUILT="));
assert.ok(publicationLine >= 0);
assert.deepEqual(JSON.parse(acceptance[publicationLine].slice("E5T18E_REBUILT=".length)), publication);
for (const label of labels) {
  const recordBytes = await recorded(path.join(root, `${label}.json`));
  const c = JSON.parse(recordBytes);
  assert.deepEqual(c, report.cases.find(entry => entry.label === label));
  assert.equal(c.label, label); assert.equal(c.passed, true);
  assert.equal(c.sourceBindingSha256, binding.sourceBindingSha256);
  assert.equal(c.cacheDisabled, label.startsWith("cold-"));
  if (c.cacheDisabled) assert.equal(c.cacheHits, 0);
  assert.ok(Number.isFinite(c.bootToDesktopMs) && c.bootToDesktopMs > 0);
  assert.ok(c.totalMs >= c.bootToDesktopMs);
  assert.deepEqual(c.errors, []);
  assert.equal(c.readiness.wallpaper, true); assert.equal(c.readiness.panel.ready, true);
  assert.equal(c.readiness.menu, true); assert.equal(c.surface.desktop, true);
  assert.deepEqual(c.cursor, { x: 480, y: 160, hotX: 1, hotY: 1, matchedPixels: 94 });
  assert.equal(c.launcher.accepted, true); assert.equal(c.launcher.terminalRendered, true);
  assert.ok(c.launcher.pointerFrames >= 2); assert.ok(c.launcher.visualDiffPixels >= 2000);
  const workerCache = independentCache(c.workerCache, c.cacheDisabled, label === "warm-reload", c.terminalFrame.fetchStats.fetches);
  const frames = {}, rgbaFrames = [];
  for (const [kind, suffix] of [["desktopFrame", ""], ["terminalFrame", "-terminal"]]) {
    const f = c[kind];
    assert.equal(f.width, 1280); assert.equal(f.height, 800);
    assert.equal(f.screenshot, `${label}${suffix}.png`);
    assert.match(f.guestStateDigest, /^[0-9a-f]{64}$/);
    assert.deepEqual(f.presentation.errors, []);
    assert.equal(f.presentation.backend, "canvas2d");
    assert.equal(f.fetchStats.error, null); assert.ok(f.fetchStats.fetches > 0);
    assert.ok(f.scheduler.retiredInstructions > 0);
    assert.equal(f.scheduler.quantum, 500000);
    const png = await recorded(path.join(root, f.screenshot));
    assert.equal(sha(png), f.screenshotSha256, `${f.screenshot} digest`);
    const rgba = canvasFromPng(png, f.screenshotSha256);
    assert.equal(sha(rgba), f.framebufferSha256, `${f.screenshot} actual canvas/framebuffer binding`);
    rgbaFrames.push(rgba);
    const group = groups.get(f.screenshotSha256) || { representative: f.screenshot, screenshotSha256: f.screenshotSha256,
      framebufferSha256: f.framebufferSha256, members: [] };
    group.members.push(f.screenshot); groups.set(f.screenshotSha256, group);
    frames[kind] = { screenshot: f.screenshot, screenshotSha256: f.screenshotSha256,
      framebufferSha256: f.framebufferSha256, guestStateDigest: f.guestStateDigest,
      retiredInstructions: f.scheduler.retiredInstructions, screenshotMatchesFramebuffer: true };
  }
  const actualCursorPixels = cursorPixels(rgbaFrames[0]);
  let changedPixels = 0;
  for (let offset = 0; offset < rgbaFrames[0].length; offset += 4) {
    if ([0, 1, 2].some((channel) => rgbaFrames[0][offset + channel] !== rgbaFrames[1][offset + channel])) changedPixels++;
  }
  assert.ok(changedPixels > 2000, "Terminal PNG must differ by more than cursor movement");
  assert.ok(c.terminalFrame.scheduler.retiredInstructions > c.desktopFrame.scheduler.retiredInstructions);
  assert.notEqual(c.terminalFrame.guestStateDigest, c.desktopFrame.guestStateDigest);
  const serial = await recorded(path.join(root, `${label}-serial.log`));
  assert.equal(serial.length, c.terminalFrame.scheduler.outputBytes);
  const serialText = serial.toString("utf8");
  assert.match(serialText, /Linux version 6\.6\.63/);
  assert.match(serialText, /Welcome to Alpine Linux 3\.20/);
  assert.doesNotMatch(serialText, /Kernel panic|Oops:|BUG:|Out of memory: Killed process|event=fallback/i);
  const passLine = acceptance.findIndex((line) => line === `E5T18E_CASE_PASS=${label} bootMs=${c.bootToDesktopMs}`);
  assert.ok(passLine > publicationLine, `${label} recorded completion marker`);
  cases.push({ label, workerCache, jsonSha256: sha(recordBytes), cacheDisabled: c.cacheDisabled, cacheHits: c.cacheHits,
    bootToDesktopMs: c.bootToDesktopMs, totalMs: c.totalMs, actualCursorPixels, changedPixels,
    frames, serialBytes: serial.length, serialSha256: sha(serial), acceptanceLogLine: passLine + 1, checksHeld: true });
}
for (const [file, expected] of immutableFiles) assert.equal(sha(await readFile(file)), expected, `${file} changed during audit`);
assert.equal(head(clone), frozenHead); assert.equal(head(main), mainHead);
const cold = cases.filter((c) => c.cacheDisabled).map((c) => c.bootToDesktopMs);
const allLabels = Array.from({ length: 25 }, (_, i) => `cold-${String(i + 1).padStart(2, "0")}`).concat("warm-prime", "warm-reload");
const unitLogPath = path.join(main, "evidence/e5-t18e/guard-unit-tests.log");
const unitLog = await recorded(unitLogPath);
assert.equal(sha(unitLog), "ed56a3fba670db08b609c1961ae42b687308457772436d60bd8a982033977040");
for (const [key, value] of Object.entries({ tests: 30, pass: 30, fail: 0, cancelled: 0, skipped: 0, todo: 0 })) {
  assert.match(unitLog.toString("utf8"), new RegExp(`^ℹ ${key} ${value}$`, "m"));
}
assert.equal((await readFile(path.join(main, "tools/verify/e5-t18d-demo-smoke.mjs"), "utf8"))
  .replaceAll("E5_T18D", "E5_T18E").replaceAll("e5-t18d", "e5-t18e").replaceAll("E5-T18d", "E5-T18e"),
  await readFile(path.join(main, "tools/verify/e5-t18e-demo-smoke.mjs"), "utf8"));
const coldTimings = { valuesMs: cold, minMs: Math.min(...cold), maxMs: Math.max(...cold), meanMs: cold.reduce((a,b) => a+b, 0)/25 };
assert.deepEqual(report.timings.cold, coldTimings);
assert.deepEqual(report.timings.warm, cases.filter(c => !c.cacheDisabled).map(c => ({ label: c.label, bootToDesktopMs: c.bootToDesktopMs, cacheHits: c.cacheHits })));
assert.equal(acceptance.filter(l => l.startsWith("E5T18E_CASE_PASS=")).length, 27);
assert.deepEqual(acceptance.filter(l => l.startsWith("E5T18E_BOOT=")).map(l => l.slice("E5T18E_BOOT=".length)).sort(), labels);
assert.equal(acceptance.filter(l => l === "E5T18E_PASS=25_COLD_2_WARM").length, 1);
assert.equal(acceptance.filter(Boolean).at(-1), "E5T18E_PASS=25_COLD_2_WARM");
assert.doesNotMatch(acceptance.join("\n"), /AssertionError|make: \*\*\*|uncaught|E5T18E_CASE_FAIL/);
const consoleLog = (await recorded(path.join(root, "browser-console.log"))).toString("utf8");
assert.doesNotMatch(consoleLog, / error:|pageerror|Kernel panic|AssertionError/);
const coldNetwork = cases.filter(c=>c.cacheDisabled).reduce((n,c)=>n+c.workerCache.networkChunkRequests,0);
assert.equal(coldNetwork,9478);
const reloadCache = cases.find(c=>c.label==="warm-reload").workerCache;
assert.equal(reloadCache.cachedChunkRequests,313); assert.equal(reloadCache.networkChunkRequests,66);
for (const [file, expected] of immutableFiles) assert.equal(sha(await readFile(file)), expected, `${file} changed during audit`);
assert.equal(head(clone), frozenHead); assert.equal(head(main), mainHead);
console.log(JSON.stringify({ schema: "wasm-vm.e5-t18e.final-evidence-audit.v2", auditedAt: new Date().toISOString(),
  auditScriptSha256: sha(await readFile(fileURLToPath(import.meta.url))), clone, mainHead, frozenHead,
  reportSha256: sha(reportBytes), publicationRecordSha256: sha(pubBytes), sourceBindingSha256: binding.sourceBindingSha256,
  frozenSourceFiles: Object.keys(sources).length, runtimeFiles: Object.keys(runtime).length, sourceDifferences,
  buildProvenance, publication, carriedDigests, rawCopies,
  canvasExtraction: { x: 80, y: 84, width: 1280, height: 800 },
  selectedCases: cases.length, cases, screenshotGroups: [...groups.values()], calibration, coldNetwork,
  coldTimings, warmTimings: report.timings.warm, acceptanceFinalLine: acceptance.findIndex(l=>l==="E5T18E_PASS=25_COLD_2_WARM")+1,
  unitTests: { path: unitLogPath, sha256: sha(unitLog), tests: 30, passed: 30, failed: 0, skipped: 0 },
  demoHelper: "identifier substitutions only; execution deferred to parent",
  guestDigestScope: "Well-formed recorded digests and distinct desktop/terminal states; no independent memory replay is claimed.",
  artifactChecks: "HELD", visualInspection: "pending separate representative inspection" }, null, 2));
