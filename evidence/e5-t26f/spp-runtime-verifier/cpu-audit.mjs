#!/usr/bin/env node
// Offline CPU integrity and independently authenticated attribution; never execute a harness/build.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { createReadStream } from "node:fs";
import { lstat, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";

const here = path.dirname(fileURLToPath(import.meta.url)), repo = path.resolve(here, "../../..");
const root = path.join(repo, "evidence/e5-t26f/single-process-observer-96ecb801");
const cpuRoot = path.join(root, "cpu-default"), output = path.join(here, "cpu-result.json");
const head = "96ecb801fdf8b67af75cd150db82d115bcf046cd";
const retained = "/var/folders/nr/cyvk1qc14jj5c081vj1xts000000gn/T/e5-t26f-single-process-observer-oBnSX1";
const expectedProfile = "21e222eda13169d922c4f1d4135446cd7b6de84b97cc31f2cb7c7afe123e708a";
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
const git = (...args) => execFileSync("git", args, { cwd: repo, encoding: "utf8" }).trim();
const json = async file => JSON.parse(await readFile(file, "utf8"));
async function hashFile(file) {
  const hash = createHash("sha256");
  for await (const bytes of createReadStream(file)) hash.update(bytes);
  return hash.digest("hex");
}
async function tree(directory, include = () => true) {
  const entries = [];
  async function visit(relative) {
    for (const name of (await readdir(path.join(directory, relative))).sort()) {
      const next = path.join(relative, name), file = path.join(directory, next);
      if (!include(next)) continue;
      const stat = await lstat(file);
      assert.ok(!stat.isSymbolicLink(), `bound symlink: ${file}`);
      if (stat.isDirectory()) await visit(next);
      else {
        assert.ok(stat.isFile());
        entries.push([next, stat.size, await hashFile(file)]);
      }
    }
  }
  await visit("");
  assert.ok(entries.length);
  return { sha256: sha(JSON.stringify(entries)), files: entries.length };
}
const runtimeFilter = relative => ["src", "pkg", "bench"].includes(relative.split(path.sep)[0]) ||
  (!relative.includes(path.sep) && /\.(?:js|mjs|html|css|json)$/u.test(relative));
const files = {
  plan: path.join(here, "cpu-plan.md"), auditSource: fileURLToPath(import.meta.url),
  driver: path.join(root, "run-cpu-default.mjs"), invocation: path.join(cpuRoot, "invocation.json"),
  exit: path.join(cpuRoot, "exit.json"), raw: path.join(cpuRoot, "record/failure-post-restore-interaction-checks.json"),
  profile: path.join(cpuRoot, "record/interaction-cpu.json"),
  carriedResult: path.join(here, "audit-result.json"), carriedReport: path.join(here, "browser-results.md"),
  originalRaw: path.join(root, "reuse/failure-post-restore-interaction-checks.json"), originalInvocation: path.join(root, "invocation.json"),
  owner: path.join(retained, "e5-t26f-owner.json"), checkpoint: path.join(retained, "normal-checkpoint.json"),
};
const hashes = {};
for (const [key, file] of Object.entries(files)) hashes[key] = await hashFile(file);
assert.equal(hashes.plan, "46892f86d4ff62ff19b62c7b267d9f3938499e67f5f58c8a87254bd632e0952a");
const planText = await readFile(files.plan, "utf8");
assert.equal(sha(planText.split("\n## Frozen symbol-mapping extension")[0]), "e6248d0283eaf7249eb17392caf063ea49686aff79b06b1792c93a7bb7e1fb6b");
assert.equal(hashes.profile, expectedProfile);
assert.equal(hashes.carriedReport, "ae149b37b3a8bc82e049bcf612cc5fd5fb2379484630957d8f71f1852e9253e2");
assert.equal(hashes.carriedResult, "a176c3c7a9ded9cb415698537a8818fcc0b639af5e59076708dee5d7c98e282c");
assert.equal(hashes.originalRaw, "a25418d4dd387ae10af687e8cfffb615a3a74eb6bc1bd81aea88a50e10dfef96");
assert.equal(git("rev-parse", "HEAD"), head);
const [inv, raw, recording, childExit, carried, originalInvocation, checkpoint, owner] = await Promise.all(
  ["invocation", "raw", "profile", "exit", "carriedResult", "originalInvocation", "checkpoint", "owner"].map(key => json(files[key])));
const m = raw.milestones, restore = m.normalRestore.result, p = recording.profile;
for (const value of [inv.head, raw.head, recording.head, carried.head, m.run.creatorHead, m.run.currentHead]) assert.equal(value, head);
assert.deepEqual(childExit, { code: 1, signal: null });
assert.equal(inv.acceptance, false);
assert.equal(inv.command, originalInvocation.command);
assert.deepEqual(inv.config, { ...originalInvocation.common, E5_T26F_DIAGNOSTIC: "reuse",
  E5_T26F_DIAGNOSTIC_CPU: "1", E5_T26F_OUT: path.join(cpuRoot, "record") });
assert.deepEqual(m.run.diagnostic, { mode: "reuse", directory: retained, port: 61637,
  origin: "http://127.0.0.1:61637", command: null, keyDelayMs: 0, latency: false, cpu: true,
  guestClock: null, jit: null, residency: null, complete: false, icountDivider: null });
assert.equal(m.run.acceptance, false);
assert.equal(m.run.postRestoreCommand, "play");
assert.equal(m.run.postRestoreKeyDelayMs, 5);
for (const value of [m.run.binding, owner.binding]) assert.deepEqual(value, carried.binding);
assert.equal(recording.runtimeSha256, carried.binding.runtimeSha256);
const sources = {};
for (const [relative, expected] of Object.entries(inv.sourceBindings)) {
  sources[relative] = await hashFile(path.join(repo, relative));
  assert.equal(sources[relative], expected, `CPU source pin: ${relative}`);
}
assert.equal(sources[path.relative(repo, files.driver)], hashes.driver);
assert.equal(sources[inv.command], carried.sources[inv.command]);
const runtime = await tree(path.join(repo, "web"), runtimeFilter);
assert.equal(runtime.sha256, carried.binding.runtimeSha256);
const seed = await tree(carried.provenance.baselineProfile);
assert.equal(seed.sha256, carried.seed.sha256);
assert.equal(seed.sha256, m.run.profileSha256);
assert.equal(seed.sha256, checkpoint.profileSha256);
assert.equal(hashes.owner, carried.hashes.owner);
assert.equal(hashes.checkpoint, carried.hashes.checkpoint);
assert.equal(m.run.checkpointFile, files.checkpoint);
assert.equal(m.run.checkpointCreatedAt, checkpoint.createdAt);
assert.notEqual(m.run.profile, carried.provenance.baselineProfile);
assert.notEqual(m.run.profile, carried.provenance.reusedCopy);
assert.equal(path.dirname(path.dirname(m.run.profile)), retained);
assert.match(path.basename(path.dirname(m.run.profile)), /^iteration-[a-zA-Z0-9]+$/u);
assert.equal(path.basename(m.run.profile), "profile");
assert.ok((await lstat(m.run.profile)).isDirectory());
assert.deepEqual(m.normalSnapshot, checkpoint.normalSnapshot);
assert.deepEqual(m.residentCheckpoint, checkpoint.resident);
assert.equal(recording.browser, checkpoint.browser.version);
assert.equal(recording.url, new URL("./linux-worker.js", raw.url).href);
const artifactBindings = {};
for (const [label, file, expected] of [["image", carried.image.file, carried.image.sha256],
  ["kernel", carried.kernel.file, carried.kernel.sha256],
  ["manifest", path.join(repo, `${originalInvocation.common.E5_T26F_DESKTOP_ASSET_DIR}/manifest.json`), carried.binding.manifestSha256]]) {
  artifactBindings[label] = { file, sha256: await hashFile(file) };
  assert.equal(artifactBindings[label].sha256, expected);
}
const query = Object.fromEntries(new URL(raw.url).searchParams);
assert.equal(query.jit, "1");
assert.equal(query.autoRestore, "1");
assert.equal(query.imageSha256, carried.binding.imageSha256);
assert.equal(query.manifestSha256, carried.binding.manifestSha256);
const { jitResidency: originalResidencySelector, ...originalDefaultQuery } =
  Object.fromEntries(new URL((await json(files.originalRaw)).url).searchParams);
assert.equal(originalResidencySelector, "repack-off");
assert.equal(Object.hasOwn(query, "jitResidency"), false);
assert.deepEqual(query, originalDefaultQuery);
const supplementalSources = {};
for (const relative of ["web/loader.js", "tools/verify/e5-t26f-guest-profile.mjs", "tools/verify/e5-t26k-decoded-cache.mjs"]) {
  const bytes = await readFile(path.join(repo, relative));
  const committed = execFileSync("git", ["show", `${head}:${relative}`], { cwd: repo });
  assert.equal(sha(bytes), sha(committed), `supplemental current source differs from frozen HEAD: ${relative}`);
  supplementalSources[relative] = sha(bytes);
}
const loader = await readFile(path.join(repo, "web/loader.js"), "utf8");
assert.ok(loader.includes('const _residency = jitResidency ?? _q.get("jitResidency") ?? "repack-off";'));
assert.ok(loader.includes('const _wantJit = (_jitQ ?? true) && globalThis.crossOriginIsolated === true;'));
for (const key of ["jitBefore", "jitAfter", "decodedCacheBefore", "decodedCacheAfter", "guestClockBefore", "guestClockAfter", "guestProfileBefore", "guestProfileAfter"])
  assert.equal(Object.hasOwn(m, key), false, `unexpected measured policy sample: ${key}`);

assert.equal(restore.snapshotSha256, checkpoint.normalSnapshot.sha256);
assert.equal(restore.snapshotBytes, checkpoint.normalSnapshot.byteLength);
assert.equal(restore.observation.firstPresent.crc32, checkpoint.normalSnapshot.preFrontBufferCrc);
assert.equal(restore.report.fullRepairFrame, true);
assert.equal(restore.report.agentRehandshake, true);
assert.deepEqual(restore.handshake, { generation: 2, version: 1, capabilities: "1" });
assert.equal(restore.resume.restored, true);
assert.equal(restore.bootStates.some(value => value.state === "booting"), false);
assert.equal(m.normalRestore.displayChecksPassed, true);
assert.equal(m.normalRestore.checksPassed, false);
assert.equal(restore.coherenceAudit.status, "deferred");
assert.equal(m.residentBeforeGesture.length, 2);
for (const sample of m.residentBeforeGesture) {
  assert.equal(sample.policy, "locked"); assert.equal(sample.context, "suspended");
  for (const key of ["writeIndex", "readIndex", "fillFrames", "writtenFrames", "inspectedFrames", "nonSilentFrames", "maxAbs"])
    assert.equal(sample.pcm[key], 0);
}
assert.equal(m.postRestoreAplay.command, "play");
for (const key of ["accepted", "inputSequenceMatch", "terminalMarkerSeen"]) assert.equal(m.postRestoreAplay[key], true);
assert.equal(m.postRestoreAplay.redMarkerSeen, false);
assert.equal(m.postRestoreAplay.keyboardFrames, 10);
assert.equal(m.postRestoreAplay.domEvents, 10);
assert.ok(m.postRestoreAplay.visualDiffPixels >= 2000);
const focus = raw.state.terminal.focuses;
assert.equal(focus.length, 1);
assert.equal(focus[0].accepted, true);
assert.equal(focus[0].guestVisible, true);
assert.equal(focus[0].guestVisibleCommand, m.postRestoreAplay.marker);
assert.deepEqual([m.postRestoreCursor.rendered.x, m.postRestoreCursor.rendered.y, m.postRestoreCursor.rendered.matchedPixels], [684, 392, 94]);
const pcm = m.postRestorePcmAtCompletion.pcm;
assert.ok(pcm.writtenFrames > 0 && pcm.inspectedFrames > 0 && pcm.nonSilentFrames > 0 && pcm.maxAbs > 0);
assert.ok(pcm.nonSilentFrames <= pcm.inspectedFrames && pcm.inspectedFrames <= pcm.capacityFrames);
assert.equal(m.postRestoreAudioAfter.policy, "unlocked");
assert.equal(m.postRestoreAudioAfter.context, "running");
assert.equal(m.postRestoreAudioAfter.guestAttached, true);
assert.ok(m.postRestoreAudioAfter.renderedFrames > m.postRestoreAudioBefore.renderedFrames);
assert.deepEqual(m.postRestoreInteraction.heldButtons, []);
assert.equal(m.postRestoreInteraction.pointerFrames, 3);
assert.equal(m.postRestoreInteraction.keyboardFrames, 10);
assert.equal(m.postRestoreStart, restore.completedAt);
const elapsedMs = m.postRestoreEnd - m.postRestoreStart;
assert.ok(Number.isFinite(elapsedMs) && elapsedMs > 2000);
assert.equal(elapsedMs, 4023.1999999284744);
assert.equal(raw.error.name, "AssertionError");
assert.equal(raw.error.code, "ERR_ASSERTION");
assert.equal(raw.error.message, "post-restore interaction exceeded 2 seconds");
assert.match(raw.error.stack, /e5-t26f-browser-roundtrip\.mjs:1930:12/u);
assert.equal(raw.lastPhase.phase, "post-restore:interaction-checks");
assert.equal(raw.lastPhase.event, "failed");
assert.equal(Object.keys(m).some(key => /drag|latency/iu.test(key)), false);

assert.equal(m.cpuProfile.status, "saved");
assert.equal(m.cpuProfile.path, files.profile);
assert.equal(m.cpuProfile.sha256, hashes.profile);
assert.equal(m.cpuProfile.reason, "interaction-observed");
assert.equal(m.cpuProfile.closeError, undefined);
assert.equal(m.cpuProfile.error, undefined);
assert.equal(m.cpuProfile.acceptance, false);
assert.equal(m.cpuProfile.restoredAt, m.postRestoreStart);
assert.equal(recording.acceptance, false);
assert.equal(recording.diagnostic, true);
assert.equal(recording.reason, m.cpuProfile.reason);
assert.equal(recording.intervalUs, 1000);
assert.equal(recording.postRestoreEnd, m.postRestoreEnd);
assert.deepEqual(recording.interaction, { acceptance: false, restoredAt: m.postRestoreStart,
  url: recording.url, status: "recording", startedAt: m.cpuProfile.startedAt });
assert.ok(m.cpuProfile.startedAt > m.postRestoreCursor.observedAt && m.cpuProfile.startedAt < m.postRestoreEnd);
assert.ok(Number.isSafeInteger(p.startTime) && Number.isSafeInteger(p.endTime) && p.endTime > p.startTime);
assert.equal(p.samples.length, m.cpuProfile.samples);
assert.equal(p.samples.length, 2608);
assert.equal(p.timeDeltas.length, p.samples.length);
const nodes = new Map(), parent = new Map(), sampleCounts = new Map();
for (const node of p.nodes) {
  assert.ok(Number.isSafeInteger(node.id) && node.id > 0 && !nodes.has(node.id));
  assert.ok(node.callFrame && typeof node.callFrame.functionName === "string");
  assert.ok(Number.isSafeInteger(node.hitCount ?? 0) && (node.hitCount ?? 0) >= 0);
  nodes.set(node.id, node);
}
for (const node of p.nodes) for (const child of node.children ?? []) {
  assert.ok(nodes.has(child) && !parent.has(child) && child !== node.id);
  parent.set(child, node.id);
}
const roots = p.nodes.filter(node => !parent.has(node.id)).map(node => node.id);
assert.equal(roots.length, 1);
const visited = new Set();
function visit(id) { assert.ok(!visited.has(id), "cycle/repeated child"); visited.add(id); for (const child of nodes.get(id).children ?? []) visit(child); }
visit(roots[0]); assert.equal(visited.size, nodes.size);
let deltaSumUs = 0;
for (let i = 0; i < p.samples.length; i++) {
  const id = p.samples[i], us = p.timeDeltas[i];
  assert.ok(nodes.has(id), `unknown sample node ${id}`);
  assert.ok(Number.isSafeInteger(us) && us >= 0);
  sampleCounts.set(id, (sampleCounts.get(id) ?? 0) + 1);
  deltaSumUs += us; assert.ok(Number.isSafeInteger(deltaSumUs));
}
const durationUs = p.endTime - p.startTime;
assert.ok(deltaSumUs <= durationUs);
const hitMismatches = p.nodes.filter(node => (node.hitCount ?? 0) !== (sampleCounts.get(node.id) ?? 0))
  .map(node => ({ nodeId: node.id, hitCount: node.hitCount ?? 0, sampleReferences: sampleCounts.get(node.id) ?? 0 }));
// Preserve this raw inconsistency. Never repair the CPU file or silently drop a sample.
const hitCountSum = p.nodes.reduce((sum, node) => sum + (node.hitCount ?? 0), 0);
const profileIntegrity = {
  nodeCount: nodes.size, rootIds: roots, edgeCount: parent.size, sampledNodeCount: sampleCounts.size,
  sampleCount: p.samples.length, timeDeltaCount: p.timeDeltas.length, allNodesReachable: true,
  allSamplesReferenceExistingNodes: true, requestedIntervalUs: recording.intervalUs,
  profileStartTimeUs: p.startTime, profileEndTimeUs: p.endTime, durationUs, deltaSumUs,
  unassignedTrailingUs: durationUs - deltaSumUs, firstDeltaUs: p.timeDeltas[0],
  minimumDeltaUs: Math.min(...p.timeDeltas), maximumDeltaUs: Math.max(...p.timeDeltas),
  meanDeltaUs: deltaSumUs / p.timeDeltas.length, zeroDeltas: p.timeDeltas.filter(us => us === 0).length,
  hitCountSum, hitMismatches, weightBasisForLaterAttribution: "actual samples/timeDeltas; preserve hitCount discrepancy",
};

// Second prediction stage was frozen before opening this immutable symbol handoff.
const symbolRoot = path.join(repo, "evidence/e5-t26f/spp-cpu-symbols");
const symbolFiles = Object.fromEntries(["INDEX.md", "section-binding.json", "cpu-summary.json", "inputs-before.json",
  "inputs-after.json", "commands.json", "artifact-hashes.json", "script-provenance.json", "failure.json"]
  .map(name => [name, path.join(symbolRoot, name)]));
const symbolHashes = {};
for (const [key, file] of Object.entries(symbolFiles)) symbolHashes[key] = await hashFile(file);
const [declaredBinding, suppliedSummary, inputsBefore, inputsAfter, commands, artifacts, provenance, failure] = await Promise.all(
  ["section-binding.json", "cpu-summary.json", "inputs-before.json", "inputs-after.json", "commands.json",
    "artifact-hashes.json", "script-provenance.json", "failure.json"].map(key => json(symbolFiles[key])));
assert.deepEqual(inputsBefore.head, inputsAfter.head);
assert.equal(inputsBefore.head.resolved, head);
assert.deepEqual(inputsBefore.files, inputsAfter.files);
assert.deepEqual(inputsBefore.runtime, inputsAfter.runtime);
assert.equal(inputsBefore.runtime.aggregate, runtime.sha256);
assert.equal(sha(JSON.stringify(inputsBefore.runtime.entries)), runtime.sha256);
assert.deepEqual(inputsBefore.runtime.entries, carried.webTree.entries);
const symbolActualFiles = {};
for (const entry of [...Object.values(inputsBefore.files), ...artifacts.artifacts, ...artifacts.evidence]) {
  const file = path.resolve(repo, entry.path);
  assert.ok(file.startsWith(repo + path.sep));
  const actual = await hashFile(file);
  assert.equal(actual, entry.sha256, `symbol handoff pin: ${entry.path}`);
  assert.equal((await lstat(file)).size, entry.size);
  symbolActualFiles[entry.path] = actual;
}
for (const item of [provenance.initialFailure, provenance.correctedWorker]) {
  const file = path.resolve(repo, item.script);
  assert.ok(file.startsWith(repo + path.sep));
  symbolActualFiles[item.script] = await hashFile(file);
  assert.equal(symbolActualFiles[item.script], item.scriptSha256);
}
assert.equal(provenance.initialFailure.originalScriptRetained, false);
assert.match(provenance.initialFailure.scriptLabel, /RECONSTRUCTED.*NOT THE ORIGINAL SCRIPT/u);
assert.equal(provenance.initialFailure.recordSha256, symbolHashes["failure.json"]);
assert.deepEqual(failure.commands, []);
assert.ok(failure.error.includes(seed.sha256) && failure.error.includes(hashes.profile));
assert.equal(provenance.initialFailure.wrongExpectedDigest, seed.sha256);
assert.equal(provenance.initialFailure.actualCpuDigest, hashes.profile);
assert.equal(provenance.handoff.head, head);
assert.equal(symbolActualFiles[provenance.handoff.sourceInput], "89bf2f0ad3306efbf42aaaa0b54dda5aada6110f361d939b3eeca2c300323c2d");
assert.equal(commands.length, 5);
assert.ok(commands.every(command => command.code === 0 && command.signal === null));
assert.equal(commands.filter(command => command.argv.includes("--out-name")).length, 1);
assert.equal(commands.filter(command => command.argv.includes("-g")).length, 1);
assert.ok(Date.parse(failure.failedAt) < Date.parse(commands[0].startedAt));

function reader(bytes) {
  let cursor = 0;
  const r = {
    left: () => bytes.length - cursor,
    take: count => { assert.ok(Number.isSafeInteger(count) && count >= 0 && cursor + count <= bytes.length); const result = bytes.subarray(cursor, cursor + count); cursor += count; return result; },
    uint: () => {
      let value = 0;
      for (let i = 0; i < 5; i++) {
        const byte = r.take(1)[0]; value += (byte & 127) * 2 ** (7 * i);
        if (!(byte & 128)) { assert.ok(value <= 0xffffffff); return value; }
      }
      throw Error("unterminated u32 LEB");
    },
    string: () => new TextDecoder("utf-8", { fatal: true }).decode(r.take(r.uint())),
  };
  return r;
}
function wasmSections(bytes) {
  const r = reader(bytes), sections = [], used = new Set();
  assert.deepEqual(r.take(8), Buffer.from([0, 97, 115, 109, 1, 0, 0, 0]));
  const order = [1, 2, 3, 4, 5, 6, 7, 8, 9, 12, 10, 11]; let last = -1;
  while (r.left()) {
    const id = r.take(1)[0], payload = r.take(r.uint());
    if (id) { assert.ok(order.includes(id) && !used.has(id) && order.indexOf(id) > last); used.add(id); last = order.indexOf(id); }
    sections.push({ id, payload });
  }
  return sections;
}
const releaseBytes = await readFile(path.join(repo, "web/pkg/wasm_vm_wasm_bg.wasm"));
const namedPath = path.join(repo, declaredBinding.named.path), namedBytes = await readFile(namedPath);
assert.equal(sha(namedBytes), "372815edf3bb6a1f72d770d7796353836b87df48c61acb9fb8168e72c1810116");
assert.equal(namedBytes.length, declaredBinding.named.size);
assert.deepEqual(gunzipSync(await readFile(`${namedPath}.gz`)), namedBytes);
const releaseSections = wasmSections(releaseBytes), namedSections = wasmSections(namedBytes);
const executable = releaseSections.filter(section => section.id), namedExecutable = namedSections.filter(section => section.id);
assert.deepEqual(namedExecutable, executable);
assert.equal(executable.length, 11);
const sectionDigests = executable.map(section => ({ id: section.id, payloadSha256: sha(section.payload) }));
assert.deepEqual(sectionDigests, declaredBinding.sections);
assert.deepEqual(sectionDigests, suppliedSummary.sections);
assert.equal(suppliedSummary.releaseSha256, sha(releaseBytes));
assert.equal(suppliedSummary.namedSha256, sha(namedBytes));
const names = new Map();
for (const section of namedSections.filter(section => !section.id)) {
  const r = reader(section.payload);
  if (r.string() !== "name") continue;
  while (r.left()) {
    const kind = r.take(1)[0], payload = reader(r.take(r.uint()));
    if (kind !== 1) continue;
    const count = payload.uint();
    for (let i = 0; i < count; i++) {
      const index = payload.uint(), name = payload.string();
      assert.ok(!names.has(index)); names.set(index, name);
    }
    assert.equal(payload.left(), 0);
  }
}
assert.equal(names.size, 1890);
assert.equal(names.size, declaredBinding.names);
assert.deepEqual(Object.fromEntries(names), suppliedSummary.names);
const imports = reader(executable.find(section => section.id === 2).payload), importCount = imports.uint();
let importedFunctions = 0;
for (let i = 0; i < importCount; i++) {
  imports.string(); imports.string();
  // This actual module's imports are all functions; refuse any unparsed alternate descriptor.
  assert.equal(imports.take(1)[0], 0); imports.uint(); importedFunctions++;
}
assert.equal(imports.left(), 0);
const functions = reader(executable.find(section => section.id === 3).payload), definedFunctions = functions.uint();
for (let i = 0; i < definedFunctions; i++) functions.uint();
assert.equal(functions.left(), 0);
const functionCount = importedFunctions + definedFunctions;
assert.ok([...names.keys()].every(index => index < functionCount));

const moduleUrl = new URL("./pkg/wasm_vm_wasm_bg.wasm", recording.url).href;
const frameInfo = node => {
  const f = node.callFrame, match = /^wasm-function\[(\d+)\]$/u.exec(f.functionName);
  const releaseIndex = f.url === moduleUrl && match ? Number(match[1]) : null;
  if (releaseIndex !== null) assert.ok(releaseIndex < functionCount);
  const name = releaseIndex !== null ? names.get(releaseIndex) ?? f.functionName : `${f.functionName} ${f.url}`.trim();
  const category = releaseIndex !== null && names.has(releaseIndex) ? "Authenticated indexed release functions" :
    f.url === moduleUrl && f.functionName.startsWith("js-to-wasm:") ? "Literal release bridge labels" :
    f.url.startsWith("wasm://") ? "Unmapped generated WASM" : !f.url ? "Runtime/synthetic labels" : "JavaScript/other URL labels";
  return { name, category, f, releaseIndex };
};
const self = new Map(), inclusive = new Map(), categories = new Map(), bridges = new Map(), generated = new Map();
const addWeight = (map, label, us) => map.set(label, (map.get(label) ?? 0) + us);
const addCount = (map, label, us) => { const row = map.get(label) ?? { samples: 0, timeUs: 0 }; row.samples++; row.timeUs += us; map.set(label, row); };
for (let i = 0; i < p.samples.length; i++) {
  const id = p.samples[i], us = p.timeDeltas[i], info = frameInfo(nodes.get(id));
  addWeight(self, info.name, us); addCount(categories, info.category, us);
  if (info.category === "Literal release bridge labels") addCount(bridges, info.name, us);
  if (info.category === "Unmapped generated WASM") addCount(generated, info.f.url, us);
  const seenNames = new Set();
  for (let at = id; at !== undefined; at = parent.get(at)) seenNames.add(frameInfo(nodes.get(at)).name);
  for (const name of seenNames) addWeight(inclusive, name, us);
}
const ranked = map => [...map].sort((a, b) => b[1] - a[1]).map(([name, us]) => ({ name, us, percent: 100 * us / deltaSumUs }));
const rankCounts = map => [...map].sort((a, b) => b[1].timeUs - a[1].timeUs)
  .map(([name, row]) => ({ name, ...row, share: 100 * row.timeUs / deltaSumUs }));
const computedSummary = { totalUs: deltaSumUs, samples: p.samples.length, self: ranked(self), inclusive: ranked(inclusive) };
const attribution = { denominator: "sumTimeDeltas", totalUs: deltaSumUs, categories: rankCounts(categories),
  bridgeFrames: rankCounts(bridges), unmappedGeneratedWasm: { distinctUrls: generated.size, urls: rankCounts(generated) } };
for (const [key, actual] of Object.entries(computedSummary)) assert.deepEqual(actual, suppliedSummary.profile[key], `summary.${key}`);
assert.deepEqual(attribution, suppliedSummary.profile.attribution);
assert.equal(suppliedSummary.profile.sha256, hashes.profile);
assert.equal(suppliedSummary.profile.path, path.relative(repo, files.profile));
assert.equal([...self.values()].reduce((sum, value) => sum + value, 0), deltaSumUs);
assert.equal(inclusive.get("(root)"), deltaSumUs);
assert.equal(attribution.categories.reduce((sum, row) => sum + row.samples, 0), p.samples.length);
assert.equal(attribution.categories.reduce((sum, row) => sum + row.timeUs, 0), deltaSumUs);
const bridgeNodes = p.nodes.filter(node => node.callFrame.functionName.startsWith("js-to-wasm:"))
  .map(node => ({ id: node.id, ...node.callFrame, samples: sampleCounts.get(node.id) ?? 0 }));
assert.equal(bridgeNodes.length, 4);
const plicName = [...names.values()].filter(name => /^wasm_vm_core::Machine::sync_plic::/u.test(name));
assert.equal(plicName.length, 1);
const plic = { name: plicName[0], self: computedSummary.self.find(row => row.name === plicName[0]),
  inclusive: computedSummary.inclusive.find(row => row.name === plicName[0]),
  functionIndices: [...names].filter(([, name]) => name === plicName[0]).map(([index]) => index),
  nodeIds: p.nodes.filter(node => frameInfo(node).name === plicName[0]).map(node => node.id) };
assert.equal(plic.self.us, 208905);
for (const [key, file] of Object.entries(symbolFiles)) assert.equal(await hashFile(file), symbolHashes[key]);
for (const [relative, expected] of Object.entries(symbolActualFiles)) assert.equal(await hashFile(path.join(repo, relative)), expected);
const symbolization = { sourceFiles: symbolFiles, hashes: symbolHashes, actualFileHashes: symbolActualFiles,
  sourceInputSha256: provenance.handoff.sourceInputSha256, companionSha256: sha(namedBytes), gzipRoundTrip: true,
  executableSectionsEqual: true, sectionDigests, importedFunctions, definedFunctions, functionCount, recoveredNames: names.size,
  summaryRecomputedIndependently: true, summary: computedSummary, attribution, bridgeNodes, plic,
  namedNodeMap: p.nodes.map(node => ({ nodeId: node.id, ...frameInfo(node), f: undefined })),
  provenance: { beforeAfterEqualExceptCaptureTime: true, commands, initialFailure: failure,
    failureScriptOriginalRetained: false, reconstructedScriptNotOriginal: true, declarations: provenance,
    limit: "Failed comparison/no-command record preserved; reconstructed script does not authenticate the lost original full script. No second companion or Rust/browser run performed by critic." },
  limit: "Only exact-release URL plus indexed functions receive recovered names; generated and literal bridge frames remain separate. Inclusive names overlap; no causal F attribution or speedup/source-candidate verdict." };

for (const [key, file] of Object.entries(files)) assert.equal(await hashFile(file), hashes[key], `input changed: ${key}`);
for (const [relative, expected] of Object.entries({ ...sources, ...supplementalSources }))
  assert.equal(await hashFile(path.join(repo, relative)), expected, `source changed: ${relative}`);
assert.equal((await tree(carried.provenance.baselineProfile)).sha256, seed.sha256);
assert.equal((await tree(path.join(repo, "web"), runtimeFilter)).sha256, runtime.sha256);
assert.equal(git("rev-parse", "HEAD"), head);
const result = {
  schema: "wasm-vm.e5-t26f.spp-cpu-foundation-verifier.v1", head,
  status: "CPU integrity and bounded sampled attribution HELD; timing FAILED; full F acceptance NEEDS EVIDENCE",
  predictions: { CP1: "HELD", CP2: "HELD", CP3: "HELD source/config boundary; no measured JIT policy",
    CP4: "FAILED timing; reached raw functionality HELD", CP5: "HELD structural/sample checks; hitCount discrepancy retained",
    CP6: "Attribution subsequently handed off and audited; full F acceptance NEEDS EVIDENCE",
    CP7: "HELD", CP8: "HELD", CP9: "HELD with explicit reconstructed-not-original limit", CP10: "HELD bounded disposition; F not verified" },
  stages: { foundationPlanSha256: "e6248d0283eaf7249eb17392caf063ea49686aff79b06b1792c93a7bb7e1fb6b",
    foundationResultSha256BeforeExtension: "6246cfded4de7ef06471ac9b2a08d4930e593c6bc2a3ed944f30bf9b0188bf95",
    extendedPlanSha256: hashes.plan },
  files, hashes, sourceBindings: sources, supplementalSources, artifactBindings, runtime, seed,
  provenance: { binding: m.run.binding, creatorHead: m.run.creatorHead, currentHead: m.run.currentHead,
    baselineProfile: carried.provenance.baselineProfile, originalIteration: carried.provenance.reusedCopy,
    cpuIteration: m.run.profile, checkpointCreatedAt: m.run.checkpointCreatedAt, browser: checkpoint.browser,
    snapshot: checkpoint.normalSnapshot, childExit, originalReportCarried: true,
    earlierCpuAttempt: "Main reports prelaunch diagnostic-option guard refusal with no browser record; not read or counted as a measurement" },
  policy: { diagnostic: m.run.diagnostic, config: inv.config, pageUrl: raw.url, query,
    evidence: "Runner query jit=1; loader default repack-off subject to isolation/API guards. Exact source/runtime pins, not measured JIT state/capacities.",
    jitRpcSamplesPresent: false, sourceDefaultsOnly: true,
    environment: "Driver strips E5_*, CARGO_*, RUSTFLAGS, RUSTDOCFLAGS, RUST_LOG and overlays exact logged config; no full inherited-env recording" },
  timing: { start: m.postRestoreStart, end: m.postRestoreEnd, elapsedMs, limitMs: 2000, passed: false,
    laterInteractionElapsed: m.postRestoreInteraction.elapsedMs, failpoint: "tools/verify/e5-t26f-browser-roundtrip.mjs:1930:12",
    lastPhase: raw.lastPhase, error: raw.error },
  reached: { restore, beforeGesture: m.residentBeforeGesture, cursor: m.postRestoreCursor, focus,
    command: m.postRestoreAplay, pcm: m.postRestorePcmAtCompletion, output: m.postRestoreOutputAttached,
    audioBefore: m.postRestoreAudioBefore, audioAfter: m.postRestoreAudioAfter, interaction: m.postRestoreInteraction,
    guestIdentity: "No new CPU PNG or independent numeric process observation inspected; carried residentCheckpoint is saved preparation, not a fresh post identity receipt" },
  cpu: { metadata: m.cpuProfile, header: { ...recording, profile: undefined }, integrity: profileIntegrity,
    pageStartReceiptMs: m.cpuProfile.startedAt, pageStartReceiptMinusT0Ms: m.cpuProfile.startedAt - m.postRestoreStart,
    frozenEndMinusPageStartReceiptMs: m.postRestoreEnd - m.cpuProfile.startedAt,
    targetScope: "One exact linux-worker.js worker selected by source guard; target/session IDs not serialized; page/audio-worklet/browser/other workers not profiled",
    intervalLimits: "startedAt is a page receipt after Profiler.start resolves; source starts after cursor/unlock and stops after frozen endpoint. CDP monotonic microseconds and page performance.now have no recorded clock synchronization; no exact alignment or full-F coverage claim",
    attribution: "Closed after separate frozen prediction extension; see symbolization" },
  symbolization,
  limits: { acceptance: false, fVerified: false, noCausalOrSpeedupClaim: true,
    fullReuseErrorArraysPresent: Object.hasOwn(raw, "errors"), presentationErrors: restore.presentation.errors,
    coherence: restore.coherenceAudit.status, dragOrSecondReloadReached: false,
    mustNotInfer: "No capacities/counter conservation without JIT RPC stats; no exact first arrival; no profiler-vs-unprofiled speedup; sampled function weights do not establish F latency cause",
    pending: "Full normal F verification still required; no source candidate reviewed or activated" },
};
// User-authorized extension of this audit's own foundational result; refuse unrelated overwrite.
assert.equal(await hashFile(output), "6246cfded4de7ef06471ac9b2a08d4930e593c6bc2a3ed944f30bf9b0188bf95");
await writeFile(output, JSON.stringify(result, null, 2) + "\n");
console.log(JSON.stringify({ output, rawSha256: hashes.raw, profileSha256: hashes.profile,
  resultSha256: await hashFile(output), elapsedMs, profileIntegrity, iteration: m.run.profile, plic, categories: attribution.categories }, null, 2));
