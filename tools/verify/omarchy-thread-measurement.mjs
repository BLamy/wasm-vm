#!/usr/bin/env node
// E5.5-T03g evidence gate.  This file never boots a guest, drives a browser, or
// changes evidence.  `seal` writes only to its explicitly supplied output dir;
// `verify` is read-only and derives the outcome from the sealed inputs.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import { createReadStream } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { desktopObservation, parseInstances, parseProbe, plainTerminal } from "./omarchy-browser-session.mjs";
import { parseHyprlandRendererLog } from "./omarchy-renderer-log.mjs";
import { hasOmarchyDesktopLayers } from "../../web/omarchy-desktop-readiness.js";
import { evdevForCode } from "../../web/src/input/keymap.js";
import { validatePairHeaders } from "./omarchy-thread-pair.mjs";
import { validateReadbackWire, bindRendererWire } from "./omarchy-thread-wire.mjs";
import { validateRuntimeIdentities as validateRuntimeClosure } from "./omarchy-thread-runtime.mjs";
export { validatePairHeaders } from "./omarchy-thread-pair.mjs";
export { validateReadbackWire } from "./omarchy-thread-wire.mjs";

export const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
export const EXPECTED = Object.freeze({
  sourceSha256: "2b4143df63085141f7cf017ed2d11c9808bd38dd30925bc86c4a15b4a64cf83c",
  candidateSha256: "bbd63fcc64bdd21d7348af600276bd2b52f433d7b4d61161006e424e973c2637",
  imageSize: 4 * 1024 * 1024 * 1024,
  chunkSize: 256 * 1024,
  chunkCount: 16384,
  inputDeadlineMs: 120000,
  nativeSha256: "d5bc0b0f8c807117cee8822fe14d837cb4e39f4884e950cead54105e7ddd8bf6",
  kernelSha256: "af7c4e471ed4dabdbe5a2717d81cc034b511d2b0f7706de66ad9e84e078c7cce",
  coreSha256: "c48e9c2d9ec550c7daf4875716fef1dc729072fdfc91b805394d379bee4b9305",
  manifestSha256: "38e8d3144e2e0be26290763a8fd1a712e93b70fc39f93131d80ed3937cbb09fc",
  nativeHarnessSha256: "0d3e609629e45021357b0e07f09ab70f9765edf8",
  builtHarnessSha256: "91a45c236b07974a9d7c87a0f8fa66f37e6f7e15",
  baselineReportSha256: "88496d6e239c36348e72d3c62a41c66b342071c3a4c08c81a8586de69e63ccc7",
  receiptSha256: "d518fd1f4b4439c9802eec77e2058250f767f0767c3c2dec634ddb0a10209942",
  patches: [
    { path: "/etc/environment.d/60-omarchy-browser.conf", absoluteOffset: 37498943, oldHex: "31", newHex: "30" },
    { path: "/home/omarchy/.config/uwsm/env", absoluteOffset: 41357421, oldHex: "31", newHex: "30" },
  ],
  metadata: [
    { path: "/etc/environment.d/60-omarchy-browser.conf", source: { inode: 455, mode: "0644", uid: 0, gid: 0, size: 141, blockCount: 8, physicalBlock: 9155 },
      candidate: { inode: 455, mode: "0644", uid: 0, gid: 0, size: 141, blockCount: 8, physicalBlock: 9155 } },
    { path: "/home/omarchy/.config/uwsm/env", source: { inode: 1203, mode: "0644", uid: 1000, gid: 1000, size: 155, blockCount: 8, physicalBlock: 10097 },
      candidate: { inode: 1203, mode: "0644", uid: 1000, gid: 1000, size: 155, blockCount: 8, physicalBlock: 10097 } },
  ],
});
const SHA = /^[0-9a-f]{64}$/u;
const SAFE_PID = (value) => Number.isSafeInteger(value) && value > 0 && value < 4194304;
const json = (value) => JSON.stringify(value, null, 2) + "\n";
const error = (message) => { throw new Error(`UNPROVEN: ${message}`); };

export async function sha256File(filename) {
  const digest = createHash("sha256");
  for await (const chunk of createReadStream(filename)) digest.update(chunk);
  return digest.digest("hex");
}

async function statFile(filename) {
  const stat = await fs.lstat(filename);
  if (!stat.isFile() || stat.isSymbolicLink()) error(`asset is not a regular file: ${filename}`);
  const canonical = await fs.realpath(filename);
  assert.equal(canonical, path.resolve(filename), `asset path is not canonical: ${filename}`);
  return stat;
}

export async function assetRecord(filename, extra = {}) {
  const absolute = path.resolve(filename);
  assert.ok(absolute === repo || absolute.startsWith(`${repo}${path.sep}`), "asset escapes repository");
  const stat = await statFile(absolute);
  return { ...extra, path: path.relative(repo, absolute), size: stat.size, sha256: await sha256File(absolute) };
}

export function assertAssetRecord(actual, expected, label = "asset") {
  assert.equal(actual.size, expected.size, `${label} size mismatch`);
  assert.match(expected.sha256, SHA, `${label} expected SHA-256 is invalid`);
  assert.equal(actual.sha256, expected.sha256, `${label} SHA-256 mismatch`);
}

export function uniqueAssets(records) {
  const byPath = new Map();
  for (const record of records) {
    const prior = byPath.get(record.path);
    if (prior) assertAssetRecord(record, prior, `duplicate identity ${record.path}`);
    else byPath.set(record.path, record);
  }
  return [...byPath.values()];
}

export function boundReference(records, reference) {
  assert.ok(reference && typeof reference.path === "string", "missing asset reference");
  const record = records.find(item => item.path === reference.path);
  assert.ok(record, `reference is not sealed: ${reference.path}`);
  assertAssetRecord(record, reference, reference.path);
  return record;
}

function assertHexByte(value, label) {
  assert.match(value, /^[0-9a-f]{2}$/u, `${label} must be one byte of hex`);
}

export function validatePreparation(receipt) {
  assert.equal(receipt?.schema, "wasm-vm.e5.5-t03g.thread-candidate.v1", "wrong preparation receipt schema");
  assert.equal(receipt.task, "E5.5-T03g");
  assert.equal(receipt.source?.size, EXPECTED.imageSize);
  assert.equal(receipt.source?.sha256, EXPECTED.sourceSha256, "source image is not the pinned base");
  assert.equal(receipt.candidate?.size, EXPECTED.imageSize);
  assert.equal(receipt.candidate?.sha256, EXPECTED.candidateSha256, "candidate image is not pinned");
  assert.equal(receipt.changedBytes, 2, "candidate must contain exactly two changed bytes");
  assert.deepEqual(receipt.patches?.map(({ path: p, absoluteOffset, oldHex, newHex }) =>
    ({ path: p, absoluteOffset, oldHex, newHex })), EXPECTED.patches, "patch plan is outside T03g scope");
  assert.equal(receipt.metadata?.length, EXPECTED.metadata.length, "full debugfs metadata is not pinned");
  for (const [index, metadata] of receipt.metadata.entries()) {
    const expected = EXPECTED.metadata[index];
    assert.equal(metadata.path, expected.path, `${metadata.path} metadata path mismatch`);
    assert.deepEqual(metadata.source, expected.source, `${metadata.path} source metadata mismatch`);
    assert.deepEqual(metadata.candidate, expected.candidate, `${metadata.path} candidate metadata mismatch`);
    assert.equal(typeof metadata.stat, "string", `${metadata.path} raw debugfs stat is missing`);
    for (const [label, value] of [["Inode", expected.source.inode], ["Mode", expected.source.mode],
      ["User", expected.source.uid], ["Group", expected.source.gid], ["Size", expected.source.size],
      ["Blockcount", expected.source.blockCount]]) {
      assert.match(metadata.stat, new RegExp(`${label}[^\\n]*${String(value)}`, "u"),
        `${metadata.path} stat does not bind ${label}`);
    }
    assert.match(metadata.stat, new RegExp(`\\):${expected.source.physicalBlock}(?:\\n|$)`, "u"), `${metadata.path} stat physical block mismatch`);
  }
  for (const [index, patch] of receipt.patches.entries()) {
    assert.equal(Number.isSafeInteger(patch.absoluteOffset), true, "patch offset must be an integer");
    assert.ok(patch.absoluteOffset >= 0 && patch.absoluteOffset < EXPECTED.imageSize, "patch is outside image");
    assertHexByte(patch.oldHex, `${patch.path} oldHex`);
    assertHexByte(patch.newHex, `${patch.path} newHex`);
    assert.notEqual(patch.oldHex, patch.newHex, `${patch.path} patch is not a change`);
    assert.deepEqual(patch.metadata, EXPECTED.metadata[index].source, `${patch.path} patch metadata mismatch`);
  }
  return receipt;
}

export function compareBuffers(source, candidate, patches) {
  assert.equal(source.length, candidate.length, "source and candidate sizes differ");
  const allowed = new Map(patches.map((p) => [p.absoluteOffset, p.newHex.toLowerCase()]));
  const differences = [];
  for (let offset = 0; offset < source.length; offset++) {
    if (source[offset] === candidate[offset]) continue;
    const expected = allowed.get(offset);
    if (expected === undefined || Number.parseInt(expected, 16) !== candidate[offset]) differences.push(offset);
    allowed.delete(offset);
  }
  assert.equal(differences.length, 0, `unexpected candidate differences at ${differences.join(",")}`);
  assert.equal(allowed.size, 0, `expected patch bytes were not present at ${[...allowed.keys()].join(",")}`);
  return { changedOffsets: patches.map((p) => p.absoluteOffset) };
}

async function compareFiles(sourcePath, candidatePath, patches) {
  const source = await statFile(sourcePath);
  const candidate = await statFile(candidatePath);
  assert.equal(source.size, candidate.size, "source/candidate size mismatch");
  // The production image is 4 GiB.  Read in bounded windows so verification never
  // allocates an image-sized buffer and never falls back to a global raw replacement.
  const sourceHandle = await fs.open(sourcePath, "r");
  const candidateHandle = await fs.open(candidatePath, "r");
  const allowed = new Map(patches.map((p) => [p.absoluteOffset, p.newHex.toLowerCase()]));
  const block = Buffer.allocUnsafe(1024 * 1024);
  const other = Buffer.allocUnsafe(block.length);
  try {
    for (let offset = 0; offset < source.size; offset += block.length) {
      const length = Math.min(block.length, source.size - offset);
      await sourceHandle.read(block, 0, length, offset);
      await candidateHandle.read(other, 0, length, offset);
      for (let i = 0; i < length; i++) {
        if (block[i] === other[i]) continue;
        const at = offset + i;
        const expected = allowed.get(at);
        assert.ok(expected !== undefined, `unexpected candidate difference at ${at}`);
        assert.equal(other[i], Number.parseInt(expected, 16), `wrong candidate byte at ${at}`);
        allowed.delete(at);
      }
    }
  } finally { await sourceHandle.close(); await candidateHandle.close(); }
  assert.equal(allowed.size, 0, `missing expected candidate bytes at ${[...allowed.keys()].join(",")}`);
}

async function validateChunkBinding(manifestPath, candidatePath) {
  const manifest = await readJson(manifestPath);
  assert.equal(await sha256File(manifestPath), EXPECTED.manifestSha256, "chunk manifest is not the frozen LP0 manifest");
  assert.equal(manifest.layout, "split", "chunk manifest is not split layout");
  assert.equal(manifest.image_len, EXPECTED.imageSize, "chunk image length is not pinned");
  assert.equal(manifest.chunk_size, EXPECTED.chunkSize, "chunk size is not pinned");
  assert.equal(manifest.chunks?.length, EXPECTED.chunkCount, "chunk count is not pinned");
  assert.ok(manifest.chunks.every((name) => SHA.test(name)), "chunk manifest contains an unsafe name");
  const root = path.dirname(manifestPath);
  const chunkRoot = (await fs.lstat(path.join(root, "chunks")).catch(() => null))?.isDirectory()
    ? path.join(root, "chunks") : root;
  const imageHandle = await fs.open(candidatePath, "r");
  const assets = [];
  try {
    for (let index = 0; index < manifest.chunks.length; index++) {
      const name = manifest.chunks[index];
      const chunkPath = path.join(chunkRoot, `${name}.bin`);
      const chunkStat = await statFile(chunkPath);
      const expectedSize = Math.min(EXPECTED.chunkSize, EXPECTED.imageSize - index * EXPECTED.chunkSize);
      assert.equal(chunkStat.size, expectedSize, `chunk ${index} size mismatch`);
      assert.equal(await sha256File(chunkPath), name, `chunk ${index} content hash mismatch`);
      const chunkBytes = await fs.readFile(chunkPath);
      const imageBytes = Buffer.alloc(expectedSize);
      await imageHandle.read(imageBytes, 0, expectedSize, index * EXPECTED.chunkSize);
      assert.deepEqual(chunkBytes, imageBytes, `chunk ${index} is not bound to candidate image`);
      assets.push(await assetRecord(chunkPath, { role: "candidate-chunk", index }));
    }
  } finally { await imageHandle.close(); }
  return assets;
}

export function parseSerialProbes(serial) {
  const text = plainTerminal(serial);
  const probes = [];
  const begin = /(?:^|\n)([a-z0-9_]+)_begin\n/gu;
  for (let match; (match = begin.exec(text));) {
    const token = match[1];
    const parsed = parseProbe(text, token);
    assert.ok(parsed, `incomplete probe ${token}`);
    const end = new RegExp(`\\n${token}_end:([0-9]+)(?:\\n|$)`, "u").exec(text.slice(match.index));
    assert.ok(end, `probe ${token} has no exact end marker`);
    const outputStart = match.index + match[0].length;
    const outputEnd = match.index + end.index;
    const priorLines = text.slice(0, match.index).split("\n");
    const echoedProbeCommand = (line) => line.match(/\(\s(.+?)\s\);\s*wv_rc=\$\?;/u)?.[1] || "";
    const command = echoedProbeCommand(priorLines.at(-1)?.trim() || "")
      || echoedProbeCommand(priorLines.at(-2)?.trim() || "");
    assert.ok(command && !command.includes("_begin"), `probe ${token} has no exact echoed command`);
    assert.equal(Number(end[1]), parsed.status, `probe ${token} parse disagreement`);
    assert.equal(text.slice(outputStart, outputEnd).trim(), parsed.output, `probe ${token} output disagreement`);
    probes.push({ token, status: Number(end[1]), output: text.slice(outputStart, outputEnd).trim(),
      beginOffset: match.index, endOffset: match.index + end.index + end[0].length,
      command });
  }
  return probes;
}

function outputFor(probe) { return typeof probe?.output === "string" ? probe.output : ""; }
function exactProbe(probes, command, after = -1) {
  return probes.find((probe) => probe.beginOffset > after && probe.command === command);
}
function finalProbe(probes, predicate) {
  return [...probes].reverse().find(predicate);
}
function exactEnvironment(text) {
  const lines = text.split(/\r?\n/u).filter(Boolean);
  const wanted = ["GALLIUM_DRIVER=llvmpipe", "LIBGL_ALWAYS_SOFTWARE=1", "LP_NUM_THREADS=0"];
  for (const name of ["GALLIUM_DRIVER", "LIBGL_ALWAYS_SOFTWARE", "LP_NUM_THREADS"]) {
    assert.equal(lines.filter((line) => line.startsWith(`${name}=`)).length, 1, `${name} must occur exactly once`);
  }
  assert.deepEqual(lines.filter((line) => wanted.includes(line)).sort(), wanted.sort(), "LP0 environment mismatch");
}

export function validateNativeEvidence({ serial, log = "" }) {
  assert.equal(typeof serial, "string", "native serial evidence is missing");
  const probes = parseSerialProbes(serial);
  assert.ok(probes.length > 0, "native serial contains no completed probes");
  const instanceProbes = probes.filter((probe) => probe.command === "XDG_RUNTIME_DIR=/run/user/1000 hyprctl -j instances" && probe.status === 0);
  const instances = finalProbe(instanceProbes, (probe) => parseInstances(probe).length === 1);
  assert.ok(instances, "no final successful non-empty Hyprland instances probe");
  const parsedInstances = parseInstances(instances);
  assert.equal(parsedInstances.length, 1, "Hyprland PID is not unique");
  const instanceName = parsedInstances[0].instance;
  assert.match(instanceName || "", /^[A-Za-z0-9_.-]+$/u, "Hyprland instance name is unsafe");
  const pid = Number(parsedInstances[0]?.pid);
  assert.ok(SAFE_PID(pid), "Hyprland PID is unsafe");

  const ctl = `XDG_RUNTIME_DIR=/run/user/1000 hyprctl -i ${instanceName}`;
  const clients = exactProbe(probes, `${ctl} -j clients`, instances.endOffset);
  const layers = exactProbe(probes, `${ctl} -j layers`, clients?.endOffset ?? instances.endOffset);
  const processes = exactProbe(probes, "ps -u 1000 -o pid=,comm=,args=", layers?.endOffset ?? instances.endOffset);
  assert.ok(clients?.status === 0 && layers?.status === 0 && processes?.status === 0, "desktop probe sequence is incomplete");
  const clientsJson = JSON.parse(outputFor(clients));
  const layersJson = JSON.parse(outputFor(layers));
  const observed = desktopObservation(clientsJson, layersJson, outputFor(processes));
  assert.equal(observed.mappedFoot, true, "mapped Foot client was not proven");
  assert.equal(observed.quickshellObserved, true, "package shell process/layer was not proven");
  assert.equal(hasOmarchyDesktopLayers(layersJson), true, "both package desktop layers were not proven");

  const envCommand = `tr '\\000' '\\n' < /proc/${pid}/environ | sed -n '/GALLIUM_DRIVER/p;/LIBGL_ALWAYS_SOFTWARE/p;/LP_NUM_THREADS/p'`;
  const env = exactProbe(probes, envCommand, processes.endOffset);
  assert.ok(env?.status === 0, "LP0 environment probe is not bound to the active PID");
  exactEnvironment(outputFor(env));
  const threads = exactProbe(probes, `ps -T -p ${pid} -o comm=`, env.endOffset);
  assert.ok(threads?.status === 0, "thread probe is not bound to the active PID");
  assert.ok(outputFor(threads).trim(), "compositor thread list is empty");
  assert.doesNotMatch(outputFor(threads), /(?:^|\n)\s*llvmpipe-[0-9]+\s*(?:\n|$)/u, "llvmpipe-N worker is present");
  const logCommand = `sed -n '/DEBUG ]: Renderer:/p;/DEBUG ]: Vendor:/p;/GL_RENDERER/p;/GL_VENDOR/p;/GL_VERSION/p;/OpenGL renderer/p' /run/user/1000/hypr/${instanceName}/hyprland.log`;
  const rendererLog = exactProbe(probes, logCommand, threads.endOffset);
  assert.ok(rendererLog?.status === 0, "renderer log probe is missing");

  const readyLine = plainTerminal(serial).slice(rendererLog.endOffset).split("\n")
    .find((line) => line.trim() === "WVM_OMARCHY_DESKTOP_READY");
  assert.ok(readyLine, "standalone save_resume marker is missing or premature");
  const desktopRows = [...log.matchAll(/^OMARCHY_DESKTOP_OBSERVATION (.+)$/gmu)].map(match => JSON.parse(match[1]));
  assert.deepEqual(desktopRows.at(-1), observed, "native desktop host observation differs from actual probes");
  const rendererRows = [...log.matchAll(/^OMARCHY_RENDERER_OBSERVATION (.+)$/gmu)].map(match => JSON.parse(match[1]));
  assert.equal(rendererRows.length, 1, "native renderer observation is absent or ambiguous");
  const actual = rendererRows[0];
  assert.equal(actual.expectedRenderer, "llvmpipe");
  assert.equal(actual.expectedLpNumThreads, "0");
  assert.deepEqual(actual.instance, parsedInstances[0], "native host renderer instance differs");
  for (const [field, probe] of [["environment", env], ["threads", threads], ["log", rendererLog]]) {
    assert.equal(actual[field].status, probe.status, `${field} host status differs from serial`);
    assert.equal(actual[field].output, probe.output, `${field} host output differs from serial`);
  }
  return { pid, instance: instanceName, foot: observed.foot, probes: probes.map(({ token, status, output, command }) =>
    ({ token, status, output, command })), lpNumThreads: 0, rendererLog: outputFor(rendererLog) };
}

function findRenderer(report) {
  const values = [];
  const visit = (value) => {
    if (!value || typeof value !== "object") return;
    if (value.renderer && typeof value.renderer === "object") values.push(value.renderer);
    for (const child of Object.values(value)) visit(child);
  };
  visit(report.observations || report);
  assert.equal(values.length, 1, "renderer observation must be unique");
  return values[0];
}

export async function validateBaseline(baseline) {
  assert.equal(baseline?.lpNumThreads, "1", "LP1 baseline binding is missing");
  assert.equal(baseline?.inputDeadlineMs, EXPECTED.inputDeadlineMs, "baseline deadline differs");
  assert.equal(path.isAbsolute(baseline.reportPath || ""), false, "baseline report path is not portable");
  const reportPath = path.resolve(repo, baseline.reportPath || "");
  const actual = await assetRecord(reportPath);
  assert.equal(actual.sha256, EXPECTED.baselineReportSha256, "baseline report is not the frozen corrected T03f report");
  assert.equal(baseline.reportSha256, actual.sha256, "baseline report hash is stale or fabricated");
  const report = await readJson(reportPath);
  assert.equal(report.mode, "verify", "baseline is not verify mode");
  assert.equal(report.result, "failed", "baseline must be the recorded 120s failure arm");
  assert.ok(/120.?s|timed out|timeout/iu.test(String(report.error || report.keyboard?.error)), "baseline is not the 120s failure arm");
  // This HELD baseline predates the wire observer and explicit timing fields.
  // Its full immutable digest binds the original 120s run; do not retrofit it.
  const renderer = findRenderer(report);
  exactEnvironment(renderer.environment.stdout
    .replace("LP_NUM_THREADS=1", "LP_NUM_THREADS=0"));
  assert.match(renderer.threads.stdout, /(?:^|\n)\s*llvmpipe-[0-9]+\s*(?:\n|$)/u,
    "baseline lacks the expected llvmpipe worker");
  assert.match(renderer.environment.stdout, /LP_NUM_THREADS=1/u,
    "baseline LP1 environment is missing");
  return baseline;
}

function scanForNonceWrites(value, nonce, pathName = "report") {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) return value.forEach((item, i) => scanForNonceWrites(item, nonce, `${pathName}[${i}]`));
  const type = String(value.type || value.kind || "").toLowerCase();
  const text = [value.command, value.text, value.input, value.data].filter((v) => typeof v === "string").join(" ");
  if (text.includes(nonce) && /serial-input|terminal-input/u.test(type)) error(`physical nonce appears in serial/terminal input at ${pathName}`);
  if (text.includes(nonce) && /(?:printf|echo|tee|>>?\s*\S|base64)/u.test(text))
    error(`physical nonce was written by a command at ${pathName}`);
  for (const [key, child] of Object.entries(value)) scanForNonceWrites(child, nonce, `${pathName}.${key}`);
}

const keyCode = (key) => {
  if (/^[a-z]$/u.test(key)) return `Key${key.toUpperCase()}`;
  if (/^[0-9]$/u.test(key)) return `Digit${key}`;
  return ({ " ": "Space", "'": "Quote", "-": "Minus", "/": "Slash", ">": "Period",
    Shift: "ShiftLeft", Enter: "Enter" })[key] || null;
};

function expectedKeyboardTransitions(command) {
  const transitions = [];
  for (const character of command) {
    if (character === ">") transitions.push({ key: "Shift", code: "ShiftLeft" }, { key: ">", code: "Period" },
      { key: ">", code: "Period", up: true }, { key: "Shift", code: "ShiftLeft", up: true });
    else {
      const code = keyCode(character);
      assert.ok(code, `unsupported command key ${JSON.stringify(character)}`);
      transitions.push({ key: character, code }, { key: character, code, up: true });
    }
  }
  transitions.push({ key: "Enter", code: "Enter" }, { key: "Enter", code: "Enter", up: true });
  return transitions;
}

export function validatePhysicalKeyboardEvidence(report, keyboard, readbackStarted) {
  const nonce = keyboard.nonce;
  const guestFile = keyboard.guestFile;
  assert.match(guestFile || "", /^\/tmp\/desktop-keys-[0-9a-f]{16}$/u, "guest nonce filename is not independently random");
  assert.ok(!guestFile.includes(nonce), "guest nonce filename reuses the typed nonce");
  const command = `printf '${nonce}' > ${guestFile}`;
  const startedAt = Date.parse(keyboard.startedAt), typedAt = Date.parse(keyboard.typedAt);
  const stop = Date.parse(keyboard.completedAt || keyboard.failedAt);
  assert.ok(Number.isFinite(startedAt) && typedAt > startedAt && typedAt <= readbackStarted,
    "typing times are not ordered before readback");
  const inputEvents = report.inputEvents.filter(event => event.context === "primary" &&
    Date.parse(event.timestamp) >= startedAt && Date.parse(event.timestamp) <= stop);
  const epochs = new Set(inputEvents.map((event) => event.epoch));
  assert.equal(epochs.size, 1, "physical DOM evidence spans multiple epochs");
  const epoch = inputEvents[0]?.epoch;
  const dom = inputEvents.filter((event) => event.epoch === epoch && (event.type === "keydown" || event.type === "keyup") &&
    Date.parse(event.timestamp || "") >= startedAt);
  assert.equal(dom.length, expectedKeyboardTransitions(command).length, "DOM keyboard event count is not exact");
  const expected = expectedKeyboardTransitions(command);
  for (let index = 0; index < expected.length; index++) {
    const event = dom[index];
    const wanted = expected[index];
    assert.equal(event.type, wanted.up ? "keyup" : "keydown", `DOM event ${index} has wrong direction`);
    assert.equal(event.key, wanted.key, `DOM event ${index} has wrong key`);
    assert.equal(event.code, wanted.code, `DOM event ${index} has wrong code`);
    assert.equal(event.trusted, true, `DOM event ${index} is not trusted`);
    assert.equal(event.repeat, false, `DOM event ${index} is a repeat`);
    assert.equal(event.target, "ide-display-canvas", `DOM event ${index} target is not the guest canvas`);
    assert.equal(event.activeElement, "ide-display-canvas", `DOM event ${index} focus is not the guest canvas`);
    assert.ok(Date.parse(event.timestamp || "") >= startedAt && Date.parse(event.timestamp || "") <= typedAt,
      `DOM event ${index} is outside the typed command window`);
    if (index) assert.ok(Date.parse(event.timestamp) >= Date.parse(dom[index - 1].timestamp), "DOM input was reordered");
  }
  const traffic = report.workerTraffic.filter(event => event.context === "primary" && Date.parse(event.timestamp) <= stop);
  const calls = traffic.filter((event) => event.type === "worker-call" && event.epoch === epoch &&
    Date.parse(event.timestamp || "") >= startedAt && ["sendKeyboardEvent", "syncKeyboard"].includes(event.method));
  assert.equal(calls.length, expected.length * 2, "keyboard worker call count is not one send/sync pair per DOM transition");
  assert.equal(traffic.some((event) => event.type === "worker-call" && event.epoch === epoch &&
    Date.parse(event.timestamp || "") >= startedAt && /Tablet|Mouse/u.test(event.method || "")), false,
  "tablet/mouse traffic contaminated the keyboard command");
  const ids = new Set();
  let workerBinding = null;
  for (let index = 0; index < calls.length; index++) {
    const call = calls[index];
    const domEvent = dom[Math.floor(index / 2)];
    const wantedMethod = index % 2 === 0 ? "sendKeyboardEvent" : "syncKeyboard";
    // Each DOM transition is one send immediately followed by one sync.
    assert.equal(call.method, wantedMethod, `worker call ${index} is not send/sync ordered`);
    assert.equal(call.sent, true, `worker call ${index} was not sent`);
    assert.ok(Number.isSafeInteger(call.id), `worker call ${index} has no numeric id`);
    assert.ok(call.worker !== undefined && call.worker !== null, `worker call ${index} has no worker binding`);
    workerBinding ??= call.worker;
    assert.equal(call.worker, workerBinding, `worker call ${index} crossed worker binding`);
    assert.equal(call.context, inputEvents[0]?.context ?? call.context, `worker call ${index} crossed context binding`);
    assert.equal(call.epoch, domEvent.epoch, `worker call ${index} crossed epoch binding`);
    assert.ok(Date.parse(call.timestamp || "") >= Date.parse(domEvent.timestamp || ""), `worker call ${index} predates DOM event`);
    assert.ok(Date.parse(call.timestamp || "") <= Date.parse(keyboard.deadlineAt),
      `worker call ${index} exceeded deadline`);
    assert.equal(ids.has(`${call.worker}:${call.id}`), false, `worker call ${index} id is not unique`);
    ids.add(`${call.worker}:${call.id}`);
    if (wantedMethod === "sendKeyboardEvent") {
      assert.deepEqual(call.args, [1, evdevForCode(domEvent.code), domEvent.type === "keydown" ? 1 : 0],
        `worker call ${index} evdev arguments do not match DOM`);
    } else assert.deepEqual(call.args, [], `worker sync call ${index} has arguments`);
    const ack = traffic.filter((event) => event.type === "input-result" && event.worker === call.worker &&
      event.id === call.id && event.method === call.method);
    assert.equal(ack.length, 1, `worker call ${index} lacks a unique correlated ack`);
    assert.equal(ack[0].error, null, `worker call ${index} returned an error`);
    assert.equal(ack[0].result, true, `worker call ${index} did not return result=true`);
    assert.equal(ack[0].context, call.context, `worker ack ${index} crossed context binding`);
    assert.equal(ack[0].epoch, call.epoch, `worker ack ${index} crossed epoch binding`);
    assert.ok(Date.parse(ack[0].timestamp || "") >= Date.parse(call.timestamp || ""), `worker ack ${index} predates call`);
    assert.ok(Date.parse(ack[0].timestamp || "") <= Date.parse(keyboard.deadlineAt),
      `worker ack ${index} exceeded deadline`);
  }
}

function validateInputDeviceDiagnostics(report) {
  const observations = Array.isArray(report.observations) ? report.observations : [];
  const rows = observations.filter((row) => row?.runtime?.inputDevice);
  const before = rows.find((row) => /physical-keyboard-before/u.test(row.runtime.label || ""));
  const after = rows.find((row) => /physical-keyboard-after-readback/u.test(row.runtime.label || ""));
  assert.ok(before && after, "input-device diagnostics do not bracket the readback");
  for (const row of [before, after]) {
    const stats = row.runtime.inputDevice;
    for (const key of ["pendingEventBudget", "pendingEvents", "pendingFrames", "droppedFrames", "droppedEvents",
      "statusEventsServed", "rejectedEvents"]) assert.ok(Number.isSafeInteger(stats[key]), `input-device stat ${key} is missing`);
    assert.equal(stats.pendingEvents, 0, `${row.runtime.label}: input events remain pending`);
    assert.equal(stats.pendingFrames, 0, `${row.runtime.label}: input frames remain pending`);
    assert.equal(stats.droppedEvents, 0, `${row.runtime.label}: input events were dropped`);
    assert.equal(stats.droppedFrames, 0, `${row.runtime.label}: input frames were dropped`);
    assert.equal(stats.rejectedEvents, 0, `${row.runtime.label}: input events were rejected`);
  }
}

export function validateBuiltReport(report, expected) {
  assert.equal(report?.mode, "verify", "built run was not verify mode");
  assert.equal(report.restored, true, "candidate was not restored");
  assert.ok(Array.isArray(report.errors) && report.errors.length === 0, "built report contains errors");
  const candidate = report.candidate;
  assert.ok(candidate, "built report has no candidate binding");
  assert.equal(candidate.localOnly, true, "built report is not the local-only candidate run");
  assert.equal(candidate.source?.kind, "local-only-candidate", "built candidate source is not exact");
  assert.equal(candidate.source.chunkManifest?.sha256, expected.chunkManifestSha256, "built chunk manifest mismatch");
  assert.equal(candidate.manifest?.chunkedImage?.sha256, expected.chunkManifestSha256, "served chunk manifest mismatch");
  assert.equal(candidate.source.bootSnapshot?.sha256, expected.snapshotSha256, "built RAM snapshot mismatch");
  assert.equal(candidate.source.overlayDelta?.sha256, expected.deltaSha256, "built disk delta mismatch");
  assert.equal(candidate.source.image?.imageLen, EXPECTED.imageSize, "built candidate image length mismatch");
  assert.equal(candidate.source.image?.chunkSize, EXPECTED.chunkSize, "built chunk size differs");
  assert.equal(candidate.source.image?.chunkCount, EXPECTED.chunkCount, "built chunk count differs");
  assert.equal(candidate.source.kernel?.sha256, EXPECTED.kernelSha256, "built kernel differs");
  for (const [key, sha256] of [["kernel", EXPECTED.kernelSha256], ["bootSnapshot", expected.snapshotSha256], ["overlayDelta", expected.deltaSha256]])
    assert.equal(candidate.manifest.artifacts[key].sha256, sha256, `served ${key} differs`);
  const renderer = findRenderer(report);
  assert.equal(renderer.instance?.pid, expected.pid, "built renderer PID is stale or unbound");
  assert.equal(renderer.instance.instance, expected.instance, "built renderer instance differs from paired native guest");
  assert.equal(renderer.expectedLpNumThreads, "0", "built report did not request LP0");
  assert.equal(renderer.expectedRenderer, "llvmpipe", "built renderer request differs");
  exactEnvironment(renderer.environment.stdout);
  const threadText = renderer.threads.stdout;
  assert.ok(threadText.trim(), "empty compositor thread list");
  assert.doesNotMatch(threadText, /(?:^|\n)\s*llvmpipe-[0-9]+\s*(?:\n|$)/u, "built report has an llvmpipe worker");
  const log = renderer.log.stdout;
  if (String(log).trim()) {
    parseHyprlandRendererLog(String(log), "llvmpipe");
    assert.equal(renderer.activeRendererValidated, true, "strict GL label must be positively validated");
  } else {
    assert.deepEqual(renderer.parsedLog, { kind: "lp0-configuration-observed", glLabelAvailable: false, activeRendererValidated: false },
      "blank GL log was not classified strictly");
    assert.equal(renderer.activeRendererValidated, false, "blank log cannot identify the active renderer");
  }
  const observedScreenshots = Array.isArray(report.observations)
    ? report.observations.filter((observation) => observation?.screenshot).map((observation) => observation) : [];
  const screenshots = report.screenshots || (Array.isArray(report.observations?.screenshots)
    ? report.observations.screenshots : observedScreenshots);
  const screenshotEvidence = screenshots.length ? screenshots : (expected.screenshotPaths || []);
  assert.ok(screenshotEvidence.length >= 1, "no screenshot evidence");
  for (const screenshot of screenshotEvidence) {
    const screenshotPath = typeof screenshot === "string" ? screenshot : screenshot.path || screenshot.screenshot;
    assert.ok(screenshotPath && (typeof screenshot === "string" || screenshot.timestamp), "screenshot timestamp/path is missing");
  }
  const inputEvents = report.inputEvents;
  const workerTraffic = report.workerTraffic;
  const serialCommands = report.serialCommands;
  assert.ok(Array.isArray(inputEvents) && Array.isArray(workerTraffic) && Array.isArray(serialCommands),
    "complete browser wire evidence is missing");
  assert.ok(inputEvents.some((event) => event.type === "keydown" && event.trusted === true) &&
    inputEvents.some((event) => event.type === "keyup" && event.trusted === true),
  "trusted physical DOM keyboard evidence is missing");
  assert.ok(workerTraffic.some((event) => event.type === "worker-call" && event.sent === true &&
    /Keyboard|Tablet|Mouse/u.test(event.method || "")), "physical input worker call was not sent");
  assert.ok(workerTraffic.some((event) => event.type === "input-result" && event.error == null &&
    /Keyboard|Tablet|Mouse/u.test(event.method || "")), "physical input worker result is missing");
  const nonce = (report.keyboard || report.input || {}).nonce;
  for (const command of serialCommands) {
    assert.ok(command.timestamp && command.stage && typeof command.command === "string",
      "serial command trace is incomplete");
    if (nonce && command.command.includes(nonce)) {
      assert.doesNotMatch(command.command, /(?:printf|echo|tee|base64|>>?\s*\S)/u,
        "nonce-bearing serial command writes guest input");
    }
  }
  for (const event of workerTraffic) {
    if (event.type === "serial-input") {
      const bytes = Buffer.from(event.bytes || []).toString("utf8");
      assert.ok(!nonce || !bytes.includes(nonce), "nonce was sent through serial input");
    }
  }
  const keyboard = report.keyboard;
  assert.match(keyboard.nonce, /^[0-9a-f]{16}$/u, "keyboard nonce is not random 8-byte hex");
  scanForNonceWrites(report.events || report, keyboard.nonce);
  const asTime = (value) => typeof value === "number" ? value : Date.parse(value || "") || 0;
  const readbackStarted = asTime(keyboard.readbackStartedAt);
  assert.ok(readbackStarted > 0, "readback start time is missing");
  assert.equal(Number(keyboard.readbackTimeoutMs), EXPECTED.inputDeadlineMs, "readback budget is not exactly 120s");
  const deadlineAt = asTime(keyboard.deadlineAt);
  assert.equal(Number(keyboard.deadlineMs), EXPECTED.inputDeadlineMs, "readback deadline budget is not exactly 120s");
  assert.equal(deadlineAt, readbackStarted + EXPECTED.inputDeadlineMs, "readback deadline is not bound to the recorded start");
  if (keyboard.failedAt) assert.ok(asTime(keyboard.failedAt) >= deadlineAt, "failed readback ended before its deadline");
  validatePhysicalKeyboardEvidence(report, keyboard, readbackStarted);
  bindRendererWire(renderer, validateReadbackWire(report, renderer));
  validateInputDeviceDiagnostics(report);
  const completed = asTime(keyboard.completedAtMs ?? keyboard.completedAt);
  if (keyboard.verified === true) {
    assert.ok(completed >= readbackStarted && completed - readbackStarted <= EXPECTED.inputDeadlineMs, "keyboard readback exceeded 120s");
    return { outcome: "provisional-positive-needs-matched-arms", taskGate: false, keyboardVerified: true };
  }
  const failure = String(keyboard.error || report.error || report.result || "");
  assert.match(failure, /120.?s|timed out|timeout/iu,
    "unverified keyboard result is not an explicit 120s measurement");
  const failedAt = asTime(keyboard.failedAt);
  assert.ok(failedAt >= readbackStarted + EXPECTED.inputDeadlineMs, "nonce miss did not reach the 120s deadline");
  if (completed) assert.ok(completed >= readbackStarted && completed - readbackStarted <= EXPECTED.inputDeadlineMs, "readback completed after deadline");
  return { outcome: "measured-negative-input", taskGate: false, keyboardVerified: false };
}

export async function validateRuntimeIdentities(identityFile) {
  return validateRuntimeClosure(identityFile, repo);
}

async function readJson(filename) { return JSON.parse(await fs.readFile(filename, "utf8")); }

export async function verifySeal(sealPath) {
  const seal = await readJson(sealPath);
  assert.equal(seal.schema, "wasm-vm.e5.5-t03g.thread-measurement.v1", "wrong seal schema");
  const records = seal.assets || [];
  assert.ok(records.length > 0, "seal has no assets");
  const assetPaths = new Set();
  for (const record of records) {
    assert.equal(path.isAbsolute(record.path || ""), false, "seal asset path must be repository-relative");
    assert.equal(assetPaths.has(record.path), false, `duplicate seal asset path: ${record.path}`);
    assetPaths.add(record.path);
    assertAssetRecord(await assetRecord(path.resolve(repo, record.path)), record, record.role || record.path);
  }
  for (const reference of [seal.preparation.receiptFile, seal.preparation.source, seal.preparation.candidate,
    seal.preparation.chunkManifest, seal.preparation.snapshot, seal.preparation.delta,
    seal.native.serial, seal.native.log, seal.runtimeIdentity, seal.built.report, seal.baselineFile]) boundReference(records, reference);
  assert.equal(seal.preparation.receiptFile.sha256, EXPECTED.receiptSha256, "preparation receipt is not frozen");
  assert.deepEqual(await readJson(path.resolve(repo, seal.preparation.receiptFile.path)), seal.preparation.receipt,
    "embedded preparation differs from actual receipt");
  assert.deepEqual(await readJson(path.resolve(repo, seal.baselineFile.path)), seal.baseline, "embedded baseline differs");
  validatePreparation(seal.preparation.receipt);
  await compareFiles(path.resolve(repo, seal.preparation.source.path), path.resolve(repo, seal.preparation.candidate.path), seal.preparation.receipt.patches);
  assert.equal(await sha256File(path.resolve(repo, seal.preparation.source.path)), EXPECTED.sourceSha256, "source changed after sealing");
  assert.equal(seal.preparation.candidate.sha256, EXPECTED.candidateSha256, "candidate hash is not pinned");
  const chunks = await validateChunkBinding(path.resolve(repo, seal.preparation.chunkManifest.path), path.resolve(repo, seal.preparation.candidate.path));
  for (const file of chunks) boundReference(records, file);
  const runtime = await validateRuntimeIdentities(path.resolve(repo, seal.runtimeIdentity.path));
  for (const file of runtime.files) boundReference(records, file);
  const native = validateNativeEvidence({ serial: await fs.readFile(path.resolve(repo, seal.native.serial.path), "utf8"),
    log: await fs.readFile(path.resolve(repo, seal.native.log.path), "utf8") });
  const pair = await validatePairHeaders({ manifestPath: path.resolve(repo, seal.preparation.chunkManifest.path),
    snapshotPath: path.resolve(repo, seal.preparation.snapshot.path), deltaPath: path.resolve(repo, seal.preparation.delta.path),
    nativeLog: await fs.readFile(path.resolve(repo, seal.native.log.path), "utf8"),
    snapshotSha256: seal.preparation.snapshot.sha256, deltaSha256: seal.preparation.delta.sha256 });
  assert.deepEqual({ base: seal.preparation.base.binding, generation: seal.preparation.base.generation },
    { base: pair.base, generation: pair.generation }, "sealed pair binding changed");
  const built = await readJson(path.resolve(repo, seal.built.report.path));
  const loaded = await collectResourceRecords(built, { chunkManifestPath: path.resolve(repo, seal.preparation.chunkManifest.path) });
  for (const file of loaded.filter(file => file.path)) boundReference(records, file);
  const builtDir = path.dirname(path.resolve(repo, seal.built.report.path));
  await validateScreenshotEvidence(built, builtDir, records.filter((record) => record.role === "screenshot").map((record) => record.path));
  const outcome = validateBuiltReport(built, { candidateSha256: EXPECTED.candidateSha256,
    chunkManifestSha256: seal.preparation.chunkManifest.sha256,
    snapshotSha256: seal.preparation.snapshot.sha256, deltaSha256: seal.preparation.delta.sha256, pid: native.pid, instance: native.instance,
    screenshotPaths: records.filter((record) => record.role === "screenshot").map((record) => record.path) });
  await validateBaseline(seal.baseline);
  assert.ok(assetPaths.has(seal.baseline.reportPath), "baseline report is not sealed");
  for (const reference of [seal.preparation.source.path, seal.preparation.candidate.path,
    seal.preparation.chunkManifest.path, seal.preparation.snapshot.path, seal.preparation.delta.path,
    seal.native.serial.path, seal.native.log.path, seal.runtimeIdentity.path, seal.built.report.path]) {
    assert.ok(assetPaths.has(reference), `sealed reference has no matching asset: ${reference}`);
  }
  return { status: outcome.outcome === "provisional-positive-needs-matched-arms" ? "unproven" : "measurement-only",
    outcome, pid: native.pid, assets: records.length };
}

async function collectResourceRecords(report, { chunkManifestPath }) {
  assert.ok(Array.isArray(report.resourceIdentities) && report.resourceIdentities.length > 0, "all local resource identities are missing");
  assert.ok(Array.isArray(report.browserRequests), "browser request closure is missing");
  const chunkManifestBytes = await fs.readFile(chunkManifestPath);
  const candidateManifest = report.candidate?.manifest;
  assert.ok(candidateManifest, "dynamic candidate manifest is missing");
  const records = [];
  for (const item of report.resourceIdentities) {
    assert.equal(typeof item.pathname, "string", "resource pathname is missing");
    assert.equal(typeof item.method, "string", "resource method is missing");
    assert.equal(item.status, 200, `resource was not HTTP 200: ${item.pathname}`);
    assert.ok(Number.isSafeInteger(item.size) && item.size >= 0, `resource size is invalid: ${item.pathname}`);
    assert.match(item.sha256 || "", SHA, `resource SHA-256 is invalid: ${item.pathname}`);
    if (item.repoPath) {
      assert.equal(path.isAbsolute(item.repoPath), false, `resource repoPath is absolute: ${item.pathname}`);
      const actual = await assetRecord(path.resolve(repo, item.repoPath), { role: "loaded-resource", url: item.pathname });
      assertAssetRecord(actual, item, `served resource ${item.pathname}`);
      records.push(actual);
    } else {
      let body;
      if (item.pathname === "/artifacts-omarchy.json") body = Buffer.from(JSON.stringify(candidateManifest));
      else if (`/${candidateManifest.chunkedImage?.key}` === item.pathname) body = chunkManifestBytes;
      else error(`dynamic resource is not a declared candidate manifest: ${item.pathname}`);
      const actual = { size: body.length, sha256: createHash("sha256").update(body).digest("hex") };
      assertAssetRecord(actual, item, `served dynamic resource ${item.pathname}`);
      records.push({ role: "dynamic-loaded-resource", pathname: item.pathname, method: item.method,
        status: item.status, size: item.size, sha256: item.sha256, timestamp: item.timestamp });
    }
  }
  const pageOrigin = report.url ? new URL(report.url).origin : null;
  for (const request of report.browserRequests) {
    assert.ok(request.timestamp && request.url && request.method && request.resourceType, "browser request row is incomplete");
    const url = new URL(request.url, "http://local.invalid");
    if (["http:", "https:"].includes(url.protocol) && url.origin !== pageOrigin)
      error(`cross-origin browser request is not allowed: ${request.url}`);
    if (!["http:", "https:"].includes(url.protocol)) {
      assert.ok(!/script|worker|document|stylesheet/iu.test(request.resourceType), `non-local executable request: ${request.url}`);
      continue;
    }
    const matched = report.resourceIdentities.some((item) => item.pathname === url.pathname &&
      item.method === request.method && item.status === 200);
    if (!matched) assert.equal(url.pathname, "/favicon.ico", `browser request has no matching local identity: ${url.pathname}`);
  }
  return records;
}

async function listScreenshots(directory) {
  const names = (await fs.readdir(directory, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && /\.png$/iu.test(entry.name)).map((entry) => entry.name).sort();
  assert.ok(names.length > 0, "built evidence contains no screenshots");
  return names.map((name) => path.relative(repo, path.join(directory, name)));
}

async function validateScreenshotEvidence(report, directory, screenshotPaths) {
  const rows = report.observations?.filter?.((observation) => observation?.screenshot) || report.screenshots || [];
  assert.ok(rows.length > 0, "screenshot rows are missing");
  const names = new Set(screenshotPaths.map((filename) => path.basename(filename)));
  assert.ok(names.has("desktop.png"), "desktop-before screenshot is missing");
  assert.ok(names.has("failure.png") || names.has("desktop-keyboard.png"), "failure/keyboard-after screenshot is missing");
  for (const row of rows) {
    const filename = typeof row === "string" ? row : row.screenshot || row.path;
    const name = path.basename(filename || "");
    assert.ok(names.has(name), `screenshot row is not in the sealed built directory: ${filename}`);
    assert.ok(typeof row !== "string" && row.timestamp && SHA.test(row.sha256 || ""), `screenshot row hash/timestamp missing: ${name}`);
    const actual = await assetRecord(path.join(directory, name));
    assert.ok(actual.size > 0, `screenshot ${name} is empty`);
    assertAssetRecord(actual, { size: actual.size, sha256: row.sha256 }, `screenshot ${name}`);
  }
}

export async function sealEvidence(evidenceDir, outputDir) {
  const root = path.resolve(evidenceDir);
  const out = path.resolve(outputDir);
  const receiptPath = path.join(root, "preparation-receipt.json");
  assert.equal(await sha256File(receiptPath), EXPECTED.receiptSha256, "preparation receipt is not frozen");
  const receipt = validatePreparation(await readJson(receiptPath));
  const sourcePath = path.resolve(repo, receipt.source.path);
  const candidatePath = path.resolve(repo, receipt.candidate.path);
  await compareFiles(sourcePath, candidatePath, receipt.patches);
  assert.equal(await sha256File(sourcePath), EXPECTED.sourceSha256, "source changed before sealing");
  assert.equal(await sha256File(candidatePath), EXPECTED.candidateSha256, "candidate hash is not pinned");
  const runtimePath = path.join(root, "runtime-identities.json");
  const runtime = await validateRuntimeIdentities(runtimePath);
  const chunkManifestPath = path.join(path.dirname(candidatePath), "chunked", "manifest.json");
  const pairRoot = path.join(path.dirname(candidatePath), "pair");
  const snapshotPath = path.join(pairRoot, "omarchy-ready.snap.gz");
  const deltaPath = path.join(pairRoot, "omarchy-overlay-delta.bin.gz");
  const chunkManifest = await assetRecord(chunkManifestPath, { role: "chunk-manifest" });
  const chunkAssets = await validateChunkBinding(chunkManifestPath, candidatePath);
  const snapshot = await assetRecord(snapshotPath, { role: "paired-ram-snapshot" });
  const delta = await assetRecord(deltaPath, { role: "paired-disk-delta" });
  const nativeSerialPath = path.join(root, "native-serial.log");
  const nativeLogPath = path.join(root, "native-capture.log");
  const nativeLog = await fs.readFile(nativeLogPath, "utf8");
  const native = validateNativeEvidence({ serial: await fs.readFile(nativeSerialPath, "utf8"), log: nativeLog });
  const pair = await validatePairHeaders({ manifestPath: chunkManifestPath, snapshotPath, deltaPath, nativeLog,
    snapshotSha256: snapshot.sha256, deltaSha256: delta.sha256 });
  const builtDir = path.join(root, "built-input");
  const reportPath = path.join(builtDir, "report.json");
  const report = await readJson(reportPath);
  const loaded = await collectResourceRecords(report, { chunkManifestPath });
  const screenshotPaths = await listScreenshots(builtDir);
  await validateScreenshotEvidence(report, builtDir, screenshotPaths);
  const built = validateBuiltReport(report, { candidateSha256: EXPECTED.candidateSha256, chunkManifestSha256: chunkManifest.sha256,
    snapshotSha256: snapshot.sha256, deltaSha256: delta.sha256, pid: native.pid, instance: native.instance, screenshotPaths });
  const baseline = await readJson(path.join(root, "baseline.json"));
  await validateBaseline(baseline);
  const baselineReport = await assetRecord(path.resolve(repo, baseline.reportPath), { role: "baseline-report" });
  const assets = [
    await assetRecord(receiptPath, { role: "preparation-receipt" }),
    await assetRecord(sourcePath, { role: "source-image" }), await assetRecord(candidatePath, { role: "candidate-image" }),
    chunkManifest, snapshot, delta, await assetRecord(nativeSerialPath, { role: "native-serial" }),
    await assetRecord(nativeLogPath, { role: "native-log" }),
    await assetRecord(runtimePath, { role: "runtime-identities" }), await assetRecord(reportPath, { role: "built-report" }),
    await assetRecord(path.join(root, "baseline.json"), { role: "baseline" }), baselineReport, ...chunkAssets,
    ...runtime.files, ...loaded.filter((record) => record.path),
  ];
  for (const screenshotPath of screenshotPaths) {
    assets.push(await assetRecord(path.resolve(repo, screenshotPath), { role: "screenshot" }));
  }
  await fs.mkdir(out, { recursive: false });
  const seal = { schema: "wasm-vm.e5.5-t03g.thread-measurement.v1", task: "E5.5-T03g", createdAt: new Date().toISOString(),
    preparation: { receipt, receiptFile: await assetRecord(receiptPath), source: await assetRecord(sourcePath), candidate: await assetRecord(candidatePath), chunkManifest, snapshot, delta,
      base: { binding: pair.base, generation: pair.generation } },
    runtimeIdentity: await assetRecord(runtimePath),
    native: { serial: await assetRecord(nativeSerialPath), log: await assetRecord(nativeLogPath), pid: native.pid },
    built: { report: await assetRecord(reportPath) }, baseline, baselineFile: await assetRecord(path.join(root, "baseline.json")),
    assets: uniqueAssets(assets), outcome: built };
  await fs.writeFile(path.join(out, "seal.json"), json(seal), { flag: "wx" });
  return { status: "sealed", path: path.join(out, "seal.json"), outcome: built };
}

async function main(argv = process.argv.slice(2)) {
  const [command, evidenceDir, outputDir] = argv;
  assert.ok(command === "seal" || command === "verify", "usage: seal EVIDENCE_DIR OUTPUT_DIR | verify SEAL_JSON");
  const result = command === "seal" ? await sealEvidence(evidenceDir, outputDir) : await verifySeal(evidenceDir);
  process.stdout.write(json(result));
  if (result.status === "unproven") process.exitCode = 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main().catch((cause) => {
  process.stderr.write(`${cause.message}\n`);
  process.exitCode = 1;
});
