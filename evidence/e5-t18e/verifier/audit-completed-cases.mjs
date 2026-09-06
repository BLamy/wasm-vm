// Read-only evidence audit. This never starts a browser, guest, builder, or test suite.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const main = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const clone = path.resolve(process.argv[2]);
const labels = process.argv.slice(3);
assert.ok(labels.length > 0, "supply explicitly completed case labels");
assert.equal(new Set(labels).size, labels.length);
for (const label of labels) assert.match(label, /^(cold-(0[1-9]|1[0-9]|2[0-5])|warm-(prime|reload))$/);
const { PNG } = createRequire(import.meta.url)(path.join(main, "web/node_modules/playwright-core/lib/utilsBundle.js"));
const { LEFT_PTR } = await import(path.join(main, "web/src/input/desktop-cursor-template.js"));
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const head = (repo) => execFileSync("git", ["rev-parse", "HEAD"], { cwd: repo, encoding: "utf8" }).trim();
const frozenHead = "9ed9e0d1c57daf64f6362193bc30b79482dd3258";
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
const { sources, runtime, publication } = binding;
assert.equal(binding.head, frozenHead);
assert.equal(sha(JSON.stringify({ head: frozenHead, sources, runtime, publication })), binding.sourceBindingSha256);
const sourceDifferences = [];
for (const [file, expected] of Object.entries(sources)) {
  assert.equal(sha(await recorded(path.join(clone, file))), expected, `frozen source ${file}`);
  const current = sha(await readFile(path.join(main, file)));
  if (current !== expected) sourceDifferences.push({ file, frozenSha256: expected, currentSha256: current });
}
assert.deepEqual(sourceDifferences.map((entry) => entry.file), ["docs/desktop-bringup.md"]);
assert.equal(sourceDifferences[0].currentSha256, "cd95503a8b916ae1d6c2a9a439832acd25430363b302e1c7eca71d9ebfcbe5a9");
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
  cases.push({ label, jsonSha256: sha(recordBytes), cacheDisabled: c.cacheDisabled, cacheHits: c.cacheHits,
    bootToDesktopMs: c.bootToDesktopMs, totalMs: c.totalMs, actualCursorPixels, changedPixels,
    frames, serialBytes: serial.length, serialSha256: sha(serial), acceptanceLogLine: passLine + 1, checksHeld: true });
}
for (const [file, expected] of immutableFiles) assert.equal(sha(await readFile(file)), expected, `${file} changed during audit`);
assert.equal(head(clone), frozenHead); assert.equal(head(main), mainHead);
const cold = cases.filter((c) => c.cacheDisabled).map((c) => c.bootToDesktopMs);
const allLabels = Array.from({ length: 25 }, (_, i) => `cold-${String(i + 1).padStart(2, "0")}`).concat("warm-prime", "warm-reload");
const unitLogPath = path.join(main, "evidence/e5-t18e/unit-tests.log");
const unitLog = await readFile(unitLogPath);
assert.match(unitLog.toString("utf8"), /^ℹ tests 23$/m);
assert.match(unitLog.toString("utf8"), /^ℹ pass 23$/m);
assert.match(unitLog.toString("utf8"), /^ℹ fail 0$/m);
assert.match(unitLog.toString("utf8"), /^ℹ skipped 0$/m);
console.log(JSON.stringify({ schema: "wasm-vm.e5-t18e.partial-evidence-audit.v1", auditedAt: new Date().toISOString(),
  auditScriptSha256: sha(await readFile(fileURLToPath(import.meta.url))),
  clone, mainHead, frozenHead, publicationRecordSha256: sha(pubBytes), sourceBindingSha256: binding.sourceBindingSha256,
  frozenSourceFiles: Object.keys(sources).length, runtimeFiles: Object.keys(runtime).length, sourceDifferences,
  canvasExtraction: { x: 80, y: 84, width: 1280, height: 800 }, publication,
  acceptanceBuildPrefix: { throughLine: publicationLine + 1, sha256: sha(acceptance.slice(0, publicationLine + 1).join("\n") + "\n") },
  selectedCases: cases.length, cases, screenshotGroups: [...groups.values()],
  partialColdTimings: { count: cold.length, minMs: Math.min(...cold), maxMs: Math.max(...cold), meanMs: cold.reduce((a, b) => a + b, 0) / cold.length },
  remainingCases: allLabels.filter((label) => !labels.includes(label)),
  unitTests: { path: unitLogPath, sha256: sha(unitLog), tests: 23, passed: 23, failed: 0, skipped: 0 },
  guestDigestScope: "Well-formed recorded digests and distinct desktop/terminal states; no independent memory replay is claimed.",
  finalCountAndReport: "NEEDS EVIDENCE", completedCaseChecks: "HELD", verdictIssued: false }, null, 2));
