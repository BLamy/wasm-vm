#!/usr/bin/env node

// E5.5-T03f: offline verifier and fresh-record wrapper for the softpipe
// measurement.  This file never changes the guest, release manifest, or
// production assets. A record is provisional until verifyEvidence proves a
// same-PID terminal cause. A positive arm needs a separate physical-input proof.

import assert from "node:assert/strict";
import { execFile as execFileCallback, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";

import {
  BASE_SHA256, BASE_SIZE, DECLARED_FILES, NEW_VALUE, OLD_VALUE,
} from "./omarchy-softpipe-candidate.mjs";
import { parseProbe } from "./omarchy-browser-session.mjs";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const execFile = promisify(execFileCallback);
const SHA256 = /^[0-9a-f]{64}$/u;
const SAFE_TOKEN = /^[a-z0-9_]+$/u;
const SAFE_RELATIVE = /^(?![\/])(?:[^/]+\/)*[^/]+$/u;

export const SCHEMA = "wasm-vm.e5.5-t03f.measurement.v1";
export const RECORD_TIMEOUT_MS = 90 * 60 * 1000;
export const INPUT_DEADLINE_MS = 120 * 1000;
export const CHUNK_SIZE = 256 * 1024;
export const EXPECTED_PATCH_COUNT = 2;
export const EXPECTED_CHANGED_BYTES = 8;
const KERNEL_SHA256 = "af7c4e471ed4dabdbe5a2717d81cc034b511d2b0f7706de66ad9e84e078c7cce";
const CORE_SHA256 = "c48e9c2d9ec550c7daf4875716fef1dc729072fdfc91b805394d379bee4b9305";
// Independently recorded debugfs mappings for the hash-pinned SDR base.
const BASE_FILES = [
  { path: DECLARED_FILES[0], offset: 37498919, inode: 455, mode: "0644", uid: 0, gid: 0, size: 141, blockCount: 8, physicalBlock: 9155 },
  { path: DECLARED_FILES[1], offset: 41357397, inode: 1203, mode: "0644", uid: 1000, gid: 1000, size: 155, blockCount: 8, physicalBlock: 10097 },
];
export const RUNTIME_FILES = [
  "tools/verify/omarchy-browser-session.mjs",
  "tools/verify/omarchy-renderer-log.mjs",
  "tools/verify/omarchy-softpipe-candidate.mjs",
  "tools/verify/omarchy-software-renderer-measurement.mjs",
  "web/pkg/wasm_vm_wasm_bg.wasm",
  "web/pkg/wasm_vm_wasm.js",
  "web/loader.js",
  "web/linux-worker-host.js",
  "web/linux-worker-protocol.js",
  "tools/serve-dev.sh",
  "releases/kernel/6.6.63/Image",
];

const json = (value) => JSON.stringify(value, null, 2) + "\n";
export async function sha256File(filename) {
  const digest = createHash("sha256");
  for await (const chunk of createReadStream(filename, { highWaterMark: 1024 * 1024 })) digest.update(chunk);
  return digest.digest("hex");
}

async function regularFile(filename, label) {
  const info = await fs.lstat(filename);
  assert.ok(info.isFile() && !info.isSymbolicLink(), `${label} must be a regular non-symlink file`);
  return info;
}

function safeRelative(value, label) {
  assert.equal(typeof value, "string", `${label} path must be a string`);
  assert.match(value, SAFE_RELATIVE, `${label} path is not a safe relative path`);
  assert.ok(!value.split("/").includes(".."), `${label} path must not contain traversal`);
  return value;
}

function requireSha(value, label) {
  assert.match(value, SHA256, `${label} must be a lowercase SHA-256 digest`);
  return value;
}

function equalAsset(actual, expected, label) {
  assert.deepEqual({ scope: actual.scope ?? "root", path: actual.path, size: actual.size, sha256: actual.sha256 }, {
    scope: expected.scope ?? "root", path: expected.path, size: expected.size, sha256: expected.sha256,
  },
    `${label} binding changed`);
}

function assetFilename(root, value, label) {
  const scope = value.scope ?? "root";
  assert.ok(scope === "root" || scope === "repo", `${label} has an invalid path scope`);
  const safe = safeRelative(value.path, label);
  return path.join(scope === "repo" ? repo : root, safe);
}

async function asset(root, relative, label, scope = "root") {
  const safe = safeRelative(relative, label);
  assert.ok(scope === "root" || scope === "repo", `${label} has an invalid path scope`);
  const filename = path.join(scope === "repo" ? repo : root, safe);
  const info = await regularFile(filename, label);
  return { scope, path: safe, size: info.size, sha256: await sha256File(filename) };
}

function assetRef(manifest, ref) {
  assert.match(ref, /^assets\.[A-Za-z0-9_]+$/u, `invalid asset binding reference: ${ref}`);
  const name = ref.slice("assets.".length);
  assert.ok(manifest.assets?.[name], `missing asset binding: ${ref}`);
  return manifest.assets[name];
}

async function readJson(filename, label) {
  const info = await regularFile(filename, label);
  assert.ok(info.size < 16 * 1024 * 1024, `${label} is unexpectedly large`);
  try { return JSON.parse(await fs.readFile(filename, "utf8")); }
  catch (error) { throw new Error(`${label} is not valid JSON: ${error.message}`); }
}

export function validateExecution(execution) {
  assert.deepEqual(execution, {
    mode: "cold-wasm",
    timeoutMs: RECORD_TIMEOUT_MS,
    keyboard: "none",
    control: "stdin",
    noSnapshot: true,
    persistence: false,
    captureState: "cold",
    reusedWorker: false,
  }, "record must be the exact fresh cold-WASM configuration");
  return execution;
}

export function validatePatchReceipt(receipt) {
  assert.equal(receipt.schema, "wasm-vm.e5.5-t03f.softpipe-candidate.v1");
  assert.equal(receipt.task, "E5.5-T03f");
  assert.equal(receipt.result, "passed");
  assert.equal(receipt.source.size, BASE_SIZE);
  assert.equal(receipt.source.sha256, BASE_SHA256);
  assert.equal(receipt.baseSha256, BASE_SHA256);
  assert.equal(receipt.derivedSha256, receipt.candidate.sha256);
  assert.equal(receipt.patches?.length, EXPECTED_PATCH_COUNT, "candidate must have exactly two patches");
  assert.equal(receipt.metadata?.length, DECLARED_FILES.length, "candidate metadata must cover both files");
  assert.deepEqual(receipt.patches.map(item => item.path).sort(), [...DECLARED_FILES].sort());
  assert.deepEqual(receipt.metadata.map(item => item.path).sort(), [...DECLARED_FILES].sort());
  let changed = 0;
  const ranges = [];
  for (const patch of receipt.patches) {
    assert.ok(DECLARED_FILES.includes(patch.path), `undeclared patch path: ${patch.path}`);
    assert.equal(patch.length, OLD_VALUE.length - 19, "each changed renderer range must be four bytes");
    assert.equal(patch.oldHex, Buffer.from("llvm", "ascii").toString("hex"));
    assert.equal(patch.newHex, Buffer.from("soft", "ascii").toString("hex"));
    assert.equal(patch.writeLength, OLD_VALUE.length);
    assert.equal(patch.writeOldHex, OLD_VALUE.toString("hex"));
    assert.equal(patch.writeNewHex, NEW_VALUE.toString("hex"));
    assert.ok(Number.isSafeInteger(patch.absoluteOffset) && patch.absoluteOffset >= 0);
    assert.ok(Number.isSafeInteger(patch.writeAbsoluteOffset) && patch.writeAbsoluteOffset >= 0);
    assert.ok(patch.absoluteOffset >= patch.writeAbsoluteOffset);
    assert.ok(patch.absoluteOffset + patch.length <= BASE_SIZE);
    assert.ok(patch.writeAbsoluteOffset + patch.writeLength <= BASE_SIZE);
    changed += patch.length;
    ranges.push({ start: patch.absoluteOffset, end: patch.absoluteOffset + patch.length });
    const metadata = receipt.metadata.find((item) => item.path === patch.path);
    assert.ok(metadata, `${patch.path}: metadata missing`);
    const { path: _path, offset, ...expectedMetadata } = BASE_FILES.find(item => item.path === patch.path);
    assert.equal(patch.absoluteOffset, offset, `${patch.path}: range differs from pinned base mapping`);
    assert.equal(patch.writeAbsoluteOffset, offset - 15);
    assert.deepEqual(metadata.source, expectedMetadata, `${patch.path}: metadata differs from pinned base`);
    assert.deepEqual(metadata.source, metadata.candidate, `${patch.path}: inode metadata changed`);
    for (const key of ["inode", "uid", "gid", "size", "blockCount", "physicalBlock"]) {
      assert.ok(Number.isSafeInteger(metadata.source[key]) && metadata.source[key] >= 0,
        `${patch.path}: invalid ${key} metadata`);
    }
    assert.match(String(metadata.source.mode), /^0[0-7]{3,4}$/u, `${patch.path}: invalid mode metadata`);
  }
  ranges.sort((a, b) => a.start - b.start);
  assert.ok(ranges[0].end <= ranges[1].start, "patch ranges overlap");
  assert.equal(changed, EXPECTED_CHANGED_BYTES, "candidate must change exactly eight bytes total");
  assert.equal(receipt.ext4?.blockSize, 4096, "candidate ext4 block size is not pinned");
  assert.ok(typeof receipt.ext4?.debugfsImage === "string" && receipt.ext4.debugfsImage.length > 0);
  assert.ok(typeof receipt.ext4?.debugfsImageId === "string" && receipt.ext4.debugfsImageId.length > 0);
  return { ranges, changed };
}

async function compareFiles(basePath, candidatePath, ranges) {
  const baseHash = createHash("sha256"), candidateHash = createHash("sha256");
  const baseStream = createReadStream(basePath, { highWaterMark: 1024 * 1024 });
  const candidateStream = createReadStream(candidatePath, { highWaterMark: 1024 * 1024 });
  const candidateIterator = candidateStream[Symbol.asyncIterator]();
  let offset = 0, actual = [], runStart = null;
  try {
    for await (const baseChunk of baseStream) {
      const next = await candidateIterator.next();
      assert.equal(next.done, false, "candidate ended before source");
      const candidateChunk = next.value;
      baseHash.update(baseChunk); candidateHash.update(candidateChunk);
      const length = Math.min(baseChunk.length, candidateChunk.length);
      for (let index = 0; index < length; index += 1) {
        if (baseChunk[index] !== candidateChunk[index]) { if (runStart === null) runStart = offset + index; }
        else if (runStart !== null) { actual.push({ start: runStart, end: offset + index }); runStart = null; }
      }
      assert.equal(baseChunk.length, candidateChunk.length, "candidate length differs from source");
      offset += baseChunk.length;
    }
    assert.equal((await candidateIterator.next()).done, true, "candidate has trailing bytes");
  } finally { baseStream.destroy(); candidateStream.destroy(); }
  if (runStart !== null) actual.push({ start: runStart, end: offset });
  assert.deepEqual(actual, ranges, "candidate differs outside the declared byte ranges");
  return { baseSha256: baseHash.digest("hex"), candidateSha256: candidateHash.digest("hex"), size: offset };
}

async function validateChunks(root, imageAsset, manifestAsset) {
  const manifest = await readJson(assetFilename(root, manifestAsset, "chunk manifest"), "chunk manifest");
  assert.equal(manifest.version, 1);
  assert.equal(manifest.layout, "split");
  assert.equal(manifest.image_len, BASE_SIZE);
  assert.equal(manifest.chunk_size, CHUNK_SIZE);
  assert.equal(manifest.chunks.length, Math.ceil(BASE_SIZE / CHUNK_SIZE));
  let total = 0;
  const imageHash = createHash("sha256");
  for (const name of manifest.chunks) {
    requireSha(name, "chunk name");
    const chunkPath = path.posix.join(path.posix.dirname(manifestAsset.path), "chunks", `${name}.bin`);
    const item = await asset(root, chunkPath, `chunk ${name}`, manifestAsset.scope ?? "root");
    assert.equal(item.size, CHUNK_SIZE);
    assert.equal(item.sha256, name, `chunk ${name} content hash mismatch`);
    for await (const bytes of createReadStream(assetFilename(root, item, `chunk ${name}`))) { imageHash.update(bytes); total += bytes.length; }
  }
  assert.equal(total, BASE_SIZE);
  assert.equal(imageHash.digest("hex"), imageAsset.sha256, "reassembled chunks do not equal candidate image");
  const actualManifest = await asset(root, manifestAsset.path, "chunk manifest", manifestAsset.scope ?? "root");
  equalAsset(manifestAsset, actualManifest, "chunk manifest");
  return { manifest, sha256: actualManifest.sha256, total };
}

export function validateProbeEvents(events, serial, { allowOutstanding = false } = {}) {
  assert.equal(typeof serial, "string");
  const sent = new Map(), results = new Map();
  for (let index = 0; index < events.length; index += 1) {
    const event = events[index];
    if (event.type === "probe-sent") {
      assert.match(event.token, SAFE_TOKEN);
      assert.equal(typeof event.command, "string");
      assert.ok(!/[\r\n]/u.test(event.command));
      assert.ok(Number.isSafeInteger(event.serialCharacterOffset) && event.serialCharacterOffset >= 0
        && event.serialCharacterOffset <= serial.length);
      assert.ok(!sent.has(event.token), `duplicate probe-sent: ${event.token}`);
      sent.set(event.token, { event, index });
    } else if (event.type === "probe-result") {
      assert.match(event.token, SAFE_TOKEN);
      const prior = sent.get(event.token);
      assert.ok(prior, `probe-result precedes probe-sent: ${event.token}`);
      assert.ok(index > prior.index, `probe-result ordering is invalid: ${event.token}`);
      assert.ok(!results.has(event.token), `duplicate probe-result: ${event.token}`);
      assert.ok(Number.isSafeInteger(event.status) && event.status >= 0);
      assert.equal(typeof event.output, "string");
      const reparsed = parseProbe(serial.slice(prior.event.serialCharacterOffset), event.token);
      assert.deepEqual(reparsed, {
        status: event.status, output: event.output, beginLine: event.beginLine, endLine: event.endLine,
      }, `serial reparse disagrees with probe-result: ${event.token}`);
      results.set(event.token, { event, index });
    }
  }
  const outstanding = [...sent.entries()].filter(([token]) => !results.has(token));
  if (outstanding.length > 0) {
    assert.equal(allowOutstanding, true, "an outstanding probe is only allowed after terminal diagnostic stop");
    assert.equal(outstanding.length, 1, "at most one probe may remain outstanding at stop");
    const [, pending] = outstanding[0];
    assert.equal(pending.index, Math.max(...[...sent.values()].map(value => value.index)),
      "only the final probe may remain outstanding");
    const stopIndices = events.map((event, index) => [event, index])
      .filter(([event]) => ["diagnostic-stop-request", "diagnostic-stop"].includes(event.type))
      .map(([, index]) => index);
    assert.ok(stopIndices.length > 0, "outstanding probe lacks an explicit diagnostic stop");
    assert.equal(events.slice(pending.index + 1).some(event => ["probe-sent", "probe-result"].includes(event.type)), false,
      "probe activity continued after the final outstanding probe");
  }
  return { sent: sent.size, results: results.size, outstanding: outstanding.length };
}

export function validateOutcome(report, events = null) {
  const negative = report.negative;
  if (negative) {
    assert.equal(negative.kind, "same-pid-terminal-crash");
    assert.ok(Number.isSafeInteger(negative.pid) && negative.pid > 0);
    assert.equal(negative.environmentPid, negative.pid);
    assert.equal(negative.terminalPid, negative.pid);
    assert.equal(negative.pidDead, true, "terminal crash must include final PID death");
    assert.equal(negative.samePid, true);
    assert.doesNotMatch(String(negative.cause), /aquamarine|timeout|timed out/iu,
      "generic renderer error/timeout is not a negative compatibility result");
    if (events) {
      const sent = new Map(events.filter(event => event.type === "probe-sent")
        .map(event => [event.token, event.command]));
      assert.match(negative.environmentProbeToken, SAFE_TOKEN, "environmentProbeToken is invalid");
      assert.ok(sent.has(negative.environmentProbeToken), "environmentProbeToken does not reference a probe-sent event");
      assert.match(sent.get(negative.environmentProbeToken), new RegExp(`/proc/${negative.pid}/environ`, "u"),
        `environment probe command is not bound to PID ${negative.pid}`);
      const terminalTokens = negative.terminalProbeTokens || [negative.terminalProbeToken];
      assert.ok(Array.isArray(terminalTokens) && terminalTokens.length >= 2,
        "negative evidence needs coredump and final process-absence probe tokens");
      for (const [index, token] of terminalTokens.entries()) {
        const field = `terminalProbeTokens[${index}]`;
        assert.match(token, SAFE_TOKEN, `${field} is invalid`);
        assert.ok(sent.has(token), `${field} does not reference a probe-sent event`);
        assert.match(sent.get(token), new RegExp(`(?:/proc/${negative.pid}(?:/|\\b)|coredumpctl[^\\n]*\\b${negative.pid}\\b)`, "u"),
          `${field} command is not bound to PID ${negative.pid}`);
      }
      const results = new Map(events.filter(event => event.type === "probe-result")
        .map(event => [event.token, event]));
      const sentEvents = new Map(events.filter(event => event.type === "probe-sent")
        .map(event => [event.token, event]));
      const eventIndex = (type, token) => events.findIndex(event => event.type === type && event.token === token);
      const coredumpResult = results.get(negative.coredumpProbeToken || terminalTokens[0]);
      const absenceResult = results.get(negative.absenceProbeToken || terminalTokens[1]);
      const environmentResult = results.get(negative.environmentProbeToken);
      assert.ok(environmentResult && environmentResult.status === 0, "environment probe did not complete successfully");
      assert.deepEqual(environmentResult.output.split("\n").filter(line => /^[A-Z][A-Z0-9_]*=/u.test(line)).sort(), [
        "LIBGL_ALWAYS_SOFTWARE=1", "GALLIUM_DRIVER=softpipe", "LP_NUM_THREADS=1",
      ].sort(), "environment probe did not record unique exact requested softpipe values");
      assert.ok(coredumpResult && /Signal:\s*6\s*\(ABRT\)/u.test(coredumpResult.output)
        && new RegExp(`Message: Process ${negative.pid} \\(Hyprland\\)`, "u").test(coredumpResult.output),
        "coredump probe result is not a same-PID Hyprland ABRT");
      assert.equal(coredumpResult.status, 0, "completed coredump probe did not exit successfully");
      assert.ok(absenceResult && new RegExp(`PROCESS_ABSENCE_STATUS=0`, "u").test(absenceResult.output)
        && /ActiveState=inactive/u.test(absenceResult.output) && /SubState=dead/u.test(absenceResult.output)
        && /MainPID=0/u.test(absenceResult.output),
        "final process-absence probe result is incomplete");
      assert.equal(absenceResult.status, 0, "final process-absence probe did not exit successfully");
      if (negative.bootId) assert.match(absenceResult.output, new RegExp(negative.bootId, "u"));
      assert.match(coredumpResult.output, new RegExp(`Boot ID:\\s*${negative.bootId.replaceAll("-", "")}`, "u"),
        "coredump and process-death probes are not bound to the same boot ID");
      const stopIndex = events.findIndex(event => ["diagnostic-stop-request", "diagnostic-stop"].includes(event.type));
      assert.ok(stopIndex > eventIndex("probe-result", negative.absenceProbeToken),
        "diagnostic stop did not follow final same-PID death evidence");
      assert.ok(eventIndex("probe-result", negative.environmentProbeToken)
        < eventIndex("probe-result", negative.coredumpProbeToken)
        && eventIndex("probe-result", negative.coredumpProbeToken)
        < eventIndex("probe-result", negative.absenceProbeToken),
      "negative evidence ordering must be environment, ABRT coredump, then process death");
      assert.ok(sentEvents.has(negative.environmentProbeToken) && sentEvents.has(negative.coredumpProbeToken)
        && sentEvents.has(negative.absenceProbeToken), "negative evidence token binding is incomplete");
    }
    return { kind: negative.kind, pid: negative.pid };
  }
  assert.fail("run is unproven: positive renderer/input acceptance requires a separately bound physical-input report");
}

export async function verifyEvidence(recordRoot) {
  const root = path.resolve(recordRoot);
  const manifest = await readJson(path.join(root, "manifest.json"), "measurement manifest");
  assert.equal(manifest.schema, SCHEMA);
  assert.equal(manifest.task, "E5.5-T03f");
  validateExecution(manifest.execution);
  assert.match(manifest.runId, /^[a-z0-9][a-z0-9-]{3,}$/u);

  const assets = {};
  for (const [name, value] of Object.entries(manifest.assets || {})) {
    assert.ok(value && typeof value.path === "string", `asset ${name} is malformed`);
    const actual = await asset(root, value.path, `asset ${name}`, value.scope ?? "root");
    equalAsset(value, actual, `asset ${name}`);
    assets[name] = actual;
  }
  const receiptAsset = assetRef(manifest, manifest.bindings.receipt);
  const receipt = await readJson(assetFilename(root, receiptAsset, "candidate receipt"), "candidate receipt");
  const patchInfo = validatePatchReceipt(receipt);
  const image = assetRef(manifest, manifest.bindings.image);
  assert.equal(image.sha256, receipt.candidate.sha256);
  assert.equal(image.size, BASE_SIZE);
  const sourcePath = path.resolve(repo, receipt.source.path);
  const sourceInfo = await regularFile(sourcePath, "pinned source image");
  assert.equal(sourceInfo.size, BASE_SIZE);
  assert.equal(await sha256File(sourcePath), BASE_SHA256, "pinned source image changed");
  const candidatePath = assetFilename(root, image, "candidate image");
  const compared = await compareFiles(sourcePath, candidatePath, patchInfo.ranges);
  assert.equal(compared.baseSha256, BASE_SHA256);
  assert.equal(compared.candidateSha256, image.sha256);
  assert.equal(compared.size, BASE_SIZE);
  for (const [filename, expected] of [[sourcePath, OLD_VALUE], [candidatePath, NEW_VALUE]]) {
    const handle = await fs.open(filename, "r");
    try {
      for (const patch of receipt.patches) {
        const bytes = Buffer.alloc(expected.length);
        assert.equal((await handle.read(bytes, 0, bytes.length, patch.writeAbsoluteOffset)).bytesRead, bytes.length);
        assert.deepEqual(bytes, expected, "actual environment bytes differ from the declared replacement");
      }
    } finally { await handle.close(); }
  }
  const chunks = await validateChunks(root, image, assetRef(manifest, manifest.bindings.chunkManifest));

  const integrityAsset = assetRef(manifest, manifest.bindings.inputIntegrity);
  const integrity = await readJson(assetFilename(root, integrityAsset, "input integrity"), "input integrity");
  assert.equal(integrity.integrity?.status, "integrity-verified");
  assert.equal(integrity.integrity?.image_sha256, image.sha256);
  assert.equal(integrity.integrity?.manifest_sha256, chunks.sha256);
  assert.equal(integrity.integrity?.image_len, BASE_SIZE);
  assert.equal(integrity.integrity?.chunk_size, CHUNK_SIZE);

  const serialAsset = assetRef(manifest, manifest.bindings.serial);
  const serial = await fs.readFile(assetFilename(root, serialAsset, "serial log"), "utf8");
  const eventsAsset = assetRef(manifest, manifest.bindings.events);
  const eventLines = (await fs.readFile(assetFilename(root, eventsAsset, "event log"), "utf8")).trim().split("\n").filter(Boolean);
  const events = eventLines.map((line) => JSON.parse(line));
  const reportPath = assetFilename(root, assetRef(manifest, manifest.bindings.report), "final measurement report");
  const report = await readJson(reportPath, "final measurement report");
  assert.equal(report.options?.["ram-mib"], 1024);
  assert.equal(report.options?.["icount-divider"], 64);
  assert.equal(report.options?.bootargs, "root=/dev/vda rw console=ttyS0 earlycon=sbi plymouth.enable=0");
  assert.equal(report.browser?.freshContext, true);
  assert.equal(report.sourceUnchanged, true);
  assert.equal(report.capture?.paused, true);
  requireSha(report.capture?.stateDigest, "paused guest state");
  assert.ok(report.elapsedMs > 0 && report.elapsedMs <= RECORD_TIMEOUT_MS, "cold result exceeded startup budget");
  assert.equal(report.publication?.kernel?.sha256, KERNEL_SHA256);
  assert.equal(integrity.kernel?.sha256, KERNEL_SHA256);
  assert.equal(report.capture?.imageSha256, image.sha256);
  assert.equal(report.capture?.manifestSha256, chunks.sha256);
  assert.equal(report.serial?.sha256, serialAsset.sha256);
  assert.equal(report.screenshot?.sha256, manifest.assets.screenshot1?.sha256);
  if (report.measurement) assert.deepEqual(report.measurement, manifest.execution, "final report execution state is not bound");
  else assert.deepEqual(manifest.execution, {
    mode: "cold-wasm", timeoutMs: report.options?.["timeout-ms"], keyboard: report.options?.keyboard,
    control: report.options?.["control-stdin"] ? "stdin" : "absent", noSnapshot: true,
    persistence: false, captureState: "cold", reusedWorker: false,
  }, "sealed execution state is not reflected in the final report options");
  const claimReport = report.negative || report.positive ? report : { ...report, ...manifest.claims };
  const probes = validateProbeEvents(events, serial, { allowOutstanding: Boolean(claimReport.negative) });
  const outcome = validateOutcome(claimReport, events);
  const screenshots = Object.entries(manifest.assets).filter(([name]) => name.startsWith("screenshot"));
  assert.ok(screenshots.length > 0, "measurement has no screenshot assets");
  for (const [, shot] of screenshots) {
    const bytes = await fs.readFile(assetFilename(root, shot, "screenshot"));
    assert.ok(bytes.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex")), "screenshot is not PNG");
  }

  const runtime = await readJson(assetFilename(root, assetRef(manifest, manifest.bindings.runtimeHashes), "runtime hash record"), "runtime hash record");
  assert.equal(runtime.schema, "wasm-vm.e5.5-t03f.runtime-hashes.v1");
  assert.ok(Array.isArray(runtime.files));
  assert.deepEqual(runtime.files.map(entry => entry.path).sort(), [...RUNTIME_FILES].sort(), "runtime boundary files missing or duplicated");
  for (const entry of runtime.files) {
    assert.equal(entry.scope, "repo");
    safeRelative(entry.path, "runtime");
    requireSha(entry.sha256, `runtime ${entry.path}`);
    assert.equal(await sha256File(path.join(repo, entry.path)), entry.sha256, `runtime hash changed: ${entry.path}`);
  }
  assert.equal(runtime.files.find(entry => entry.path === "web/pkg/wasm_vm_wasm_bg.wasm").sha256, CORE_SHA256);
  assert.equal(runtime.files.find(entry => entry.path === "releases/kernel/6.6.63/Image").sha256, KERNEL_SHA256);
  return { result: "verified", runId: manifest.runId, outcome, probes, imageSha256: image.sha256,
    manifestSha256: chunks.sha256, candidateChangedBytes: patchInfo.changed };
}


async function hashRuntimeFiles() {
  return { schema: "wasm-vm.e5.5-t03f.runtime-hashes.v1", files: await Promise.all(RUNTIME_FILES.map(async (filename) => ({
    scope: "repo", path: filename, size: (await fs.stat(path.join(repo, filename))).size,
    sha256: await sha256File(path.join(repo, filename)),
  }))) };
}

async function waitForChild(child) {
  return new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code, signal) => resolve({ code, signal }));
  });
}


async function readEventBundle(root) {
  const serial = await fs.readFile(path.join(root, "serial.log"), "utf8");
  const lines = (await fs.readFile(path.join(root, "events.jsonl"), "utf8")).trim().split("\n").filter(Boolean);
  const events = lines.map((line) => JSON.parse(line));
  return { serial, events };
}

function resultFor(events, serial, token) {
  const sent = events.find((event) => event.type === "probe-sent" && event.token === token);
  assert.ok(sent, `missing sent event for ${token}`);
  const parsed = parseProbe(serial.slice(sent.serialCharacterOffset), token);
  assert.ok(parsed, `missing serial result for ${token}`);
  return parsed;
}

async function deriveNegativeClaim(root, report) {
  const { serial, events } = await readEventBundle(root);
  validateProbeEvents(events, serial, { allowOutstanding: true });
  const envSent = events.find((event) => event.type === "probe-sent" && /\/proc\/(\d+)\/environ/u.test(event.command));
  assert.ok(envSent, "no PID-bound environment probe was recorded");
  const pid = Number(envSent.command.match(/\/proc\/(\d+)\/environ/u)[1]);
  const envResult = resultFor(events, serial, envSent.token);
  assert.match(envResult.output, /^GALLIUM_DRIVER=softpipe$/mu, "environment probe did not record softpipe");
  const coredumpCandidates = events.filter((event) => event.type === "probe-sent"
    && new RegExp(`coredumpctl[^\\n]*\\b${pid}\\b`, "u").test(event.command));
  let coredumpSent = null, coredump = null;
  for (const candidate of [...coredumpCandidates].reverse()) {
    const parsed = parseProbe(serial.slice(candidate.serialCharacterOffset), candidate.token);
    if (parsed && /Signal:\s*6\s*\(ABRT\)/u.test(parsed.output)
      && new RegExp(`Message: Process ${pid} \\(Hyprland\\)`, "u").test(parsed.output)) {
      coredumpSent = candidate; coredump = parsed; break;
    }
  }
  assert.ok(coredumpSent && coredump, "no completed PID-bound Hyprland coredump probe was recorded");
  const absenceSent = events.find((event) => event.type === "probe-sent"
    && new RegExp(`/proc/${pid}(?:\\b|/)`, "u").test(event.command)
    && /PROCESS_ABSENCE_STATUS/u.test(event.command));
  assert.ok(absenceSent, "no final PID-absence probe was recorded");
  const absence = resultFor(events, serial, absenceSent.token);
  assert.match(absence.output, /PROCESS_ABSENCE_STATUS=0/u);
  assert.match(absence.output, /ActiveState=inactive/u);
  assert.match(absence.output, /SubState=dead/u);
  assert.match(absence.output, /MainPID=0/u);
  const bootId = absence.output.match(/\b[0-9a-f]{8}-[0-9a-f-]{27}\b/u)?.[0];
  assert.ok(bootId, "final absence probe has no boot ID");
  assert.match(report.error || "", /diagnostic stopped by operator/u);
  return {
    negative: {
      kind: "same-pid-terminal-crash", pid, environmentPid: pid, terminalPid: pid, pidDead: true,
      samePid: true, cause: "Hyprland Signal 6 (ABRT) coredump completed",
      environmentProbeToken: envSent.token, coredumpProbeToken: coredumpSent.token,
      absenceProbeToken: absenceSent.token, terminalProbeTokens: [coredumpSent.token, absenceSent.token], bootId,
    },
  };
}

async function sealExisting(recordRoot) {
  const root = path.resolve(recordRoot);
  const manifestPath = path.join(root, "manifest.json");
  const existingManifest = await fs.lstat(manifestPath).catch(() => null);
  if (existingManifest) assert.ok(existingManifest.isFile() && !existingManifest.isSymbolicLink(), "seal manifest must be a regular file");
  const report = await readJson(path.join(root, "report.json"), "final measurement report");
  const integrity = await readJson(path.join(root, "input-integrity.json"), "input integrity");
  const receiptPath = path.resolve(process.env.OMARCHY_T03F_RECEIPT || path.join(root, "..", "candidate-receipt.json"));
  const receipt = await readJson(receiptPath, "candidate receipt");
  const execution = {
    mode: "cold-wasm", timeoutMs: Number(report.options?.["timeout-ms"]), keyboard: report.options?.keyboard,
    control: report.options?.["control-stdin"] ? "stdin" : "absent", noSnapshot: true,
    persistence: false, captureState: "cold", reusedWorker: false,
  };
  validateExecution(execution);
  const claims = await deriveNegativeClaim(root, report);
  const receiptRel = path.relative(repo, receiptPath);
  const imageRel = receipt.candidate.path;
  const chunksRel = path.relative(repo, path.resolve(integrity.chunks, "manifest.json"));
  const runtime = await hashRuntimeFiles();
  const runtimePath = path.join(root, "runtime-hashes.json");
  const existingRuntime = await fs.lstat(runtimePath).catch(() => null);
  if (existingRuntime) assert.ok(existingRuntime.isFile() && !existingRuntime.isSymbolicLink(), "runtime hash record must be a regular file");
  await fs.writeFile(runtimePath, json(runtime));
  const assets = {
    receipt: await asset(root, receiptRel, "candidate receipt", "repo"),
    image: await asset(root, imageRel, "candidate image", "repo"),
    chunkManifest: await asset(root, chunksRel, "chunk manifest", "repo"),
    inputIntegrity: await asset(root, "input-integrity.json", "input integrity"),
    serial: await asset(root, "serial.log", "serial log"),
    events: await asset(root, "events.jsonl", "event log"),
    report: await asset(root, "report.json", "final measurement report"),
    runtimeHashes: await asset(root, "runtime-hashes.json", "runtime hash record"),
    screenshot1: await asset(root, "guest.png", "guest screenshot"),
    screenshot2: await asset(root, "latest.png", "latest screenshot"),
  };
  const manifest = {
    schema: SCHEMA, task: "E5.5-T03f", runId: `${path.basename(root)}-${assets.report.sha256.slice(0, 16)}`, execution, claims,
    bindings: {
      receipt: "assets.receipt", image: "assets.image", chunkManifest: "assets.chunkManifest",
      inputIntegrity: "assets.inputIntegrity", serial: "assets.serial", events: "assets.events",
      report: "assets.report", runtimeHashes: "assets.runtimeHashes",
    },
    assets,
    record: { sourceReportSha256: assets.report.sha256, sourceEventsSha256: assets.events.sha256,
      sourceSerialSha256: assets.serial.sha256, sourceInputIntegritySha256: assets.inputIntegrity.sha256 },
  };
  await fs.writeFile(manifestPath, json(manifest));
  return manifest;
}

async function recordFresh() {
  const rootParent = path.resolve(process.env.OMARCHY_T03F_RECORD_ROOT || "evidence/omarchy-profile/softpipe-runs");
  await fs.mkdir(rootParent, { recursive: true, mode: 0o700 });
  const root = await fs.mkdtemp(path.join(rootParent, "t03f-"));
  await fs.chmod(root, 0o700);
  const candidateDir = path.join(root, "candidate");
  const chunksDir = path.join(root, "chunks");
  const candidateSource = path.resolve(process.env.OMARCHY_T03F_SOURCE || "target/omarchy-profile-sdr-r3.ext4");
  const candidateTool = path.join(repo, "tools/verify/omarchy-softpipe-candidate.mjs");
  const run = async (command, args, options = {}) => {
    const result = await execFile(command, args, { cwd: repo, maxBuffer: 4 * 1024 * 1024, ...options });
    return result;
  };
  await run(process.execPath, [candidateTool, "prepare", "--source", candidateSource, "--out", candidateDir]);
  const image = path.join(candidateDir, "omarchy-profile-softpipe.ext4");
  await run("python3", ["-B", "tools/chunk_image.py", "split", image, "--out", chunksDir, "--chunk-size", String(CHUNK_SIZE), "--layout", "split"]);
  await run("python3", ["-B", "tools/chunk_image.py", "verify", path.join(chunksDir, "manifest.json"), "--image", image]);
  const receipt = await readJson(path.join(candidateDir, "receipt.json"), "candidate receipt");
  const manifestSha = await sha256File(path.join(chunksDir, "manifest.json"));
  const coldDir = path.join(root, "cold-wasm");
  const browserTool = path.join(repo, "tools/verify/omarchy-browser-session.mjs");
  const args = [browserTool, "--image", image, "--image-sha256", receipt.candidate.sha256,
    "--chunks", chunksDir, "--manifest-sha256", manifestSha, "--out", coldDir,
    "--timeout-ms", String(RECORD_TIMEOUT_MS), "--ram-mib", "1024", "--icount-divider", "64",
    "--bootargs", "root=/dev/vda rw console=ttyS0 earlycon=sbi plymouth.enable=0",
    "--keyboard", "none", "--control-stdin"];
  const stdout = await fs.open(path.join(root, "stdout.log"), "wx");
  const stderr = await fs.open(path.join(root, "stderr.log"), "wx");
  const child = spawn(process.execPath, args, { cwd: repo, env: { ...process.env }, stdio: ["pipe", "pipe", "pipe"] });
  child.stdout.on("data", (bytes) => { void stdout.write(bytes); process.stdout.write(bytes); });
  child.stderr.on("data", (bytes) => { void stderr.write(bytes); process.stderr.write(bytes); });
  const forward = (bytes) => { if (!child.stdin.destroyed) child.stdin.write(bytes); };
  process.stdin.on("data", forward);
  const result = await waitForChild(child);
  process.stdin.off("data", forward);
  await stdout.close(); await stderr.close();
  assert.ok(await fs.stat(coldDir).catch(() => null), "cold runner did not create its output directory");
  // The child owns its immutable raw report. This wrapper records, never
  // upgrades a failure to acceptance. Seal the completed bundle explicitly.
  process.stdout.write(`E5T03F_RECORD=${JSON.stringify({ root, coldDir, receipt: path.join(candidateDir, "receipt.json"), childExit: result, taskVerified: false })}\n`);
  process.exitCode = result.code === 0 ? 0 : 1;
  return { root, result };
}

function usage() {
  return "usage: omarchy-software-renderer-measurement.mjs verify RECORD_DIR | seal RECORD_DIR | record";
}

async function main() {
  const [mode, value] = process.argv.slice(2);
  if (mode === "verify") {
    const result = await verifyEvidence(value || process.env.OMARCHY_T03F_RECORD_DIR || "evidence/omarchy-profile/softpipe-runs/latest");
    process.stdout.write(`E5T03F_VERIFY=${JSON.stringify(result)}\n`);
  } else if (mode === "record") {
    await recordFresh();
  } else if (mode === "seal") {
    const manifest = await sealExisting(value || process.env.OMARCHY_T03F_RECORD_DIR || "evidence/omarchy-profile/softpipe-r1/cold-wasm");
    process.stdout.write(`E5T03F_SEAL=${JSON.stringify({ manifest: path.join(value || process.env.OMARCHY_T03F_RECORD_DIR || "evidence/omarchy-profile/softpipe-r1/cold-wasm", "manifest.json"), runId: manifest.runId })}\n`);
  } else { throw new Error(usage()); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error) => { process.stderr.write(`omarchy-software-renderer-measurement: ${error.stack || error}\n`); process.exitCode = 1; });
}
