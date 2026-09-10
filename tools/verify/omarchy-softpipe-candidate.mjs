#!/usr/bin/env node

// E5.5-T03f: prepare an isolated, byte-scoped softpipe image candidate.
// This tool never opens the verified source image for writing. Filesystem
// inspection is read-only debugfs inside the pinned image, and the candidate
// is made with an APFS clone before the two equal-length substitutions.

import assert from "node:assert/strict";
import { execFile as execFileCallback } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { promisify } from "node:util";
import { fileURLToPath, pathToFileURL } from "node:url";

export const BASE_SHA256 = "2b4143df63085141f7cf017ed2d11c9808bd38dd30925bc86c4a15b4a64cf83c";
export const BASE_SIZE = 4 * 1024 * 1024 * 1024;
export const DEBUGFS_IMAGE = "wasm-vm-omarchy-image:profile";
export const DEFAULT_SOURCE = "target/omarchy-profile-sdr-r3.ext4";
export const DECLARED_FILES = [
  "/etc/environment.d/60-omarchy-browser.conf",
  "/home/omarchy/.config/uwsm/env",
];
export const OLD_VALUE = Buffer.from("GALLIUM_DRIVER=llvmpipe", "ascii");
export const NEW_VALUE = Buffer.from("GALLIUM_DRIVER=softpipe", "ascii");
export const STREAM_CHUNK_SIZE = 1024 * 1024;

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const execFile = promisify(execFileCallback);
const SHA256 = /^[0-9a-f]{64}$/u;

function fail(message) {
  throw new Error(message);
}

function assertSha256(value, label) {
  assert.match(value, SHA256, `${label} must be a lowercase SHA-256 digest`);
}

export function sha256Bytes(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

export function countOccurrences(bytes, needle) {
  assert.ok(Buffer.isBuffer(bytes), "bytes must be a Buffer");
  assert.ok(Buffer.isBuffer(needle) && needle.length > 0, "needle must be a non-empty Buffer");
  let count = 0;
  for (let offset = 0; offset <= bytes.length - needle.length; offset += 1) {
    if (bytes.subarray(offset, offset + needle.length).equals(needle)) count += 1;
  }
  return count;
}

export function planFilePatch({ pathname, data, metadata, blockSize }) {
  assert.ok(DECLARED_FILES.includes(pathname), `undeclared environment file: ${pathname}`);
  assert.ok(Buffer.isBuffer(data), `${pathname}: debugfs data must be a Buffer`);
  assert.ok(Number.isSafeInteger(blockSize) && blockSize > 0 && blockSize % 512 === 0,
    `${pathname}: invalid ext4 block size`);
  assert.equal(data.length, metadata.size, `${pathname}: debugfs data size disagrees with inode size`);
  assert.ok(data.length > 0 && data.length <= blockSize,
    `${pathname}: configuration must occupy exactly one bounded data block`);
  assert.equal(metadata.blockCount, blockSize / 512,
    `${pathname}: unexpected multi-block or inline allocation (${metadata.blockCount} sectors)`);
  assert.ok(Number.isSafeInteger(metadata.physicalBlock) && metadata.physicalBlock >= 0,
    `${pathname}: invalid physical data-block mapping`);
  const occurrenceCount = countOccurrences(data, OLD_VALUE);
  assert.equal(occurrenceCount, 1,
    `${pathname}: expected exactly one GALLIUM_DRIVER=llvmpipe string, found ${occurrenceCount}`);
  const logicalOffset = data.indexOf(OLD_VALUE);
  assert.ok(logicalOffset >= 0 && logicalOffset + OLD_VALUE.length <= blockSize,
    `${pathname}: patch crosses the mapped block boundary`);
  assert.equal(OLD_VALUE.length, NEW_VALUE.length, "renderer substitutions must be equal length");
  const firstDifference = [...OLD_VALUE.keys()].find(index => OLD_VALUE[index] !== NEW_VALUE[index]);
  const lastDifference = [...OLD_VALUE.keys()].findLast(index => OLD_VALUE[index] !== NEW_VALUE[index]);
  assert.ok(firstDifference !== undefined && lastDifference !== undefined, "renderer substitution must change bytes");
  const writeAbsoluteOffset = metadata.physicalBlock * blockSize + logicalOffset;
  const absoluteOffset = writeAbsoluteOffset + firstDifference;
  const length = lastDifference - firstDifference + 1;
  assert.ok(Number.isSafeInteger(writeAbsoluteOffset) && Number.isSafeInteger(absoluteOffset),
    `${pathname}: patch offset is not safely representable`);
  return {
    path: pathname,
    inode: metadata.inode,
    logicalOffset,
    physicalBlock: metadata.physicalBlock,
    blockSize,
    writeAbsoluteOffset,
    writeLength: OLD_VALUE.length,
    writeOldHex: OLD_VALUE.toString("hex"),
    writeNewHex: NEW_VALUE.toString("hex"),
    absoluteOffset,
    length,
    oldHex: OLD_VALUE.subarray(firstDifference, lastDifference + 1).toString("hex"),
    newHex: NEW_VALUE.subarray(firstDifference, lastDifference + 1).toString("hex"),
    oldAscii: OLD_VALUE.subarray(firstDifference, lastDifference + 1).toString("ascii"),
    newAscii: NEW_VALUE.subarray(firstDifference, lastDifference + 1).toString("ascii"),
  };
}

export function makePatchPlan(inspections, blockSize) {
  assert.ok(Array.isArray(inspections), "inspections must be an array");
  assert.equal(inspections.length, DECLARED_FILES.length, "exactly two declared files are required");
  const paths = inspections.map(item => item.pathname);
  assert.deepEqual([...paths].sort(), [...DECLARED_FILES].sort(), "inspection set differs from declared files");
  const plan = inspections.map(item => planFilePatch({ ...item, blockSize }));
  const sorted = [...plan].sort((a, b) => a.absoluteOffset - b.absoluteOffset);
  for (let index = 1; index < sorted.length; index += 1) {
    assert.ok(sorted[index - 1].absoluteOffset + sorted[index - 1].length <= sorted[index].absoluteOffset,
      "patch ranges overlap");
  }
  return plan;
}

export function validateBase({ size, sha256 }) {
  assert.equal(size, BASE_SIZE, `source image must be exactly ${BASE_SIZE} bytes (4 GiB)`);
  assertSha256(sha256, "source image SHA-256");
  assert.equal(sha256, BASE_SHA256, "source image is not the verified SDR base");
}

export function assertPatchRangesWithinImage(plan, imageSize) {
  assert.ok(Number.isSafeInteger(imageSize) && imageSize > 0, "image size must be a positive safe integer");
  for (const patch of plan) {
    assert.ok(Number.isSafeInteger(patch.writeAbsoluteOffset) && patch.writeAbsoluteOffset >= 0,
      `${patch.path}: write offset is invalid`);
    assert.ok(patch.writeAbsoluteOffset + patch.writeLength <= imageSize,
      `${patch.path}: full write range is outside the image`);
    assert.ok(Number.isSafeInteger(patch.absoluteOffset) && patch.absoluteOffset >= 0,
      `${patch.path}: changed offset is invalid`);
    assert.ok(patch.absoluteOffset + patch.length <= imageSize,
      `${patch.path}: changed range is outside the image`);
  }
}

export function compareBuffers(base, candidate, expectedRanges) {
  assert.ok(Buffer.isBuffer(base) && Buffer.isBuffer(candidate), "images must be Buffers");
  assert.equal(base.length, candidate.length, "candidate image size changed");
  const expected = [...expectedRanges].sort((a, b) => a.absoluteOffset - b.absoluteOffset)
    .map(range => ({ start: range.absoluteOffset, end: range.absoluteOffset + range.length }));
  const actual = [];
  let runStart = null;
  for (let offset = 0; offset < base.length; offset += 1) {
    if (base[offset] !== candidate[offset]) {
      if (runStart === null) runStart = offset;
    } else if (runStart !== null) {
      actual.push({ start: runStart, end: offset });
      runStart = null;
    }
  }
  if (runStart !== null) actual.push({ start: runStart, end: base.length });
  assert.deepEqual(actual, expected, "candidate differs outside the two declared byte ranges");
  for (const range of expectedRanges) {
    const start = range.absoluteOffset;
    const end = start + range.length;
    assert.equal(base.subarray(start, end).toString("hex"), range.oldHex,
      `${range.path}: source bytes at the planned offset changed unexpectedly`);
    assert.equal(candidate.subarray(start, end).toString("hex"), range.newHex,
      `${range.path}: candidate bytes do not contain the planned replacement`);
  }
}

async function sha256File(file) {
  const digest = createHash("sha256");
  for await (const chunk of createReadStream(file, { highWaterMark: STREAM_CHUNK_SIZE })) digest.update(chunk);
  return digest.digest("hex");
}

async function fileSize(file) {
  return (await fs.stat(file)).size;
}

async function compareImageStreams(baseFile, candidateFile, expectedRanges) {
  const baseHash = createHash("sha256");
  const candidateHash = createHash("sha256");
  const baseStream = createReadStream(baseFile, { highWaterMark: STREAM_CHUNK_SIZE });
  const candidateStream = createReadStream(candidateFile, { highWaterMark: STREAM_CHUNK_SIZE });
  const candidateIterator = candidateStream[Symbol.asyncIterator]();
  const expected = [...expectedRanges].sort((a, b) => a.absoluteOffset - b.absoluteOffset)
    .map(range => ({ start: range.absoluteOffset, end: range.absoluteOffset + range.length }));
  const actual = [];
  let offset = 0;
  let runStart = null;
  try {
    for await (const baseChunk of baseStream) {
      const next = await candidateIterator.next();
      assert.equal(next.done, false, "candidate image ended before the source image");
      const candidateChunk = next.value;
      assert.equal(candidateChunk.length, baseChunk.length, "candidate image stream chunk size differs");
      baseHash.update(baseChunk);
      candidateHash.update(candidateChunk);
      for (let index = 0; index < baseChunk.length; index += 1) {
        if (baseChunk[index] !== candidateChunk[index]) {
          if (runStart === null) runStart = offset + index;
        } else if (runStart !== null) {
          actual.push({ start: runStart, end: offset + index });
          runStart = null;
        }
      }
      offset += baseChunk.length;
    }
    const extra = await candidateIterator.next();
    assert.equal(extra.done, true, "candidate image has trailing bytes");
    if (runStart !== null) actual.push({ start: runStart, end: offset });
  } finally {
    baseStream.destroy();
    candidateStream.destroy();
  }
  assert.deepEqual(actual, expected, "candidate differs outside the two declared byte ranges");
  for (const range of expectedRanges) {
    const [baseBytes, candidateBytes] = await Promise.all([
      readFileRange(baseFile, range.absoluteOffset, range.length),
      readFileRange(candidateFile, range.absoluteOffset, range.length),
    ]);
    assert.equal(baseBytes.toString("hex"), range.oldHex,
      `${range.path}: source bytes at the planned offset changed unexpectedly`);
    assert.equal(candidateBytes.toString("hex"), range.newHex,
      `${range.path}: candidate bytes do not contain the planned replacement`);
  }
  return { baseSha256: baseHash.digest("hex"), candidateSha256: candidateHash.digest("hex") };
}

async function readFileRange(file, offset, length) {
  const handle = await fs.open(file, "r");
  const bytes = Buffer.alloc(length);
  try {
    const result = await handle.read(bytes, 0, length, offset);
    assert.equal(result.bytesRead, length, `could not read planned range from ${file}`);
    return bytes;
  } finally {
    await handle.close();
  }
}

async function assertNoSymlinkComponents(target, { allowMissingLeaf = false } = {}) {
  const absolute = path.resolve(target);
  const pieces = absolute.split(path.sep).filter(Boolean);
  let current = path.parse(absolute).root;
  for (let index = 0; index < pieces.length; index += 1) {
    current = path.join(current, pieces[index]);
    try {
      const info = await fs.lstat(current);
      assert.ok(!info.isSymbolicLink(), `symlink path component is not allowed: ${current}`);
    } catch (error) {
      if (error.code === "ENOENT" && allowMissingLeaf && index === pieces.length - 1) return;
      throw error;
    }
  }
}

async function run(command, args, commandLog, options = {}) {
  commandLog.push({ command, args: [...args] });
  try {
    return await execFile(command, args, {
      cwd: repo,
      maxBuffer: 16 * 1024 * 1024,
      ...options,
    });
  } catch (error) {
    const stdout = Buffer.isBuffer(error.stdout) ? error.stdout.toString("utf8") : (error.stdout || "");
    const stderr = Buffer.isBuffer(error.stderr) ? error.stderr.toString("utf8") : (error.stderr || "");
    throw new Error(`${command} ${args.join(" ")} failed\n${stdout}${stderr}`, { cause: error });
  }
}

async function debugfs(image, expression, commandLog, encoding = "utf8", debugfsImage = DEBUGFS_IMAGE) {
  const args = [
    "run", "--rm", "--network=none", "--read-only", "--cap-drop=ALL",
    "--security-opt=no-new-privileges", "-v", `${image}:/image:ro`, debugfsImage,
    "debugfs", "-R", expression, "/image",
  ];
  const result = await run("docker", args, commandLog, { encoding });
  return result.stdout;
}

async function resolveDebugfsImage(commandLog) {
  const result = await run("docker", ["image", "inspect", DEBUGFS_IMAGE, "--format", "{{.Id}}"], commandLog);
  const imageId = result.stdout.trim();
  assert.match(imageId, /^sha256:[0-9a-f]{64}$/u,
    "debugfs Docker image did not resolve to a full immutable image ID");
  return imageId;
}

function parseInteger(text, expression, label) {
  const match = text.match(expression);
  assert.ok(match, `debugfs output did not contain ${label}`);
  const value = Number(match[1]);
  assert.ok(Number.isSafeInteger(value) && value >= 0, `debugfs ${label} is invalid`);
  return value;
}

function parseInodeStat(text) {
  const modeMatch = text.match(/\bMode:\s+([0-7]+)/u);
  const userMatch = text.match(/\bUser:\s+(\d+)\s+Group:\s+(\d+)/u);
  assert.ok(modeMatch && userMatch, "debugfs stat did not report inode mode and ownership");
  return {
    inode: parseInteger(text, /\bInode:\s+(\d+)/u, "inode"),
    mode: modeMatch[1],
    uid: Number(userMatch[1]),
    gid: Number(userMatch[2]),
    size: parseInteger(text, /\bSize:\s+(\d+)/u, "size"),
    blockCount: parseInteger(text, /\bBlockcount:\s+(\d+)/u, "blockcount"),
    raw: text,
  };
}

function parseBlockSize(text) {
  return parseInteger(text, /^Block size:\s+(\d+)$/mu, "block size");
}

export function parsePhysicalBlock(text) {
  const output = text.trim();
  assert.match(output, /^\d+$/u, "debugfs bmap must return one bare physical block number");
  const block = Number(output);
  assert.ok(Number.isSafeInteger(block), "debugfs bmap physical block is not safely representable");
  return block;
}

async function inspectExt4File(image, pathname, blockSize, commandLog, debugfsImage) {
  const statText = await debugfs(image, `stat ${pathname}`, commandLog, "utf8", debugfsImage);
  const metadata = parseInodeStat(statText);
  const physicalBlock = parsePhysicalBlock(await debugfs(image, `bmap ${pathname} 0`, commandLog, "utf8", debugfsImage));
  const data = Buffer.from(await debugfs(image, `cat ${pathname}`, commandLog, "buffer", debugfsImage));
  return { pathname, data, metadata: { ...metadata, physicalBlock }, blockSize };
}

async function copyCandidate(source, candidate, commandLog) {
  await assertAbsent(candidate, "candidate image");
  try {
    await run("cp", ["-c", source, candidate], commandLog);
    return { method: "cp -c" };
  } catch (error) {
    if (await exists(candidate)) {
      fail("cp -c failed after creating a candidate destination; refusing fallback overwrite");
    }
    await run("cp", ["-p", "-n", source, candidate], commandLog);
    if (!(await exists(candidate))) fail("exclusive fallback copy did not create the candidate image");
    return { method: "cp -p -n", fallbackReason: error.message.split("\n", 1)[0] };
  }
}

async function exists(file) {
  try {
    await fs.lstat(file);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}

async function assertAbsent(file, label) {
  if (await exists(file)) fail(`${label} already exists; refusing to overwrite it`);
}

function parseArguments(argv) {
  assert.equal(argv[0], "prepare", "usage: omarchy-softpipe-candidate.mjs prepare [--source IMAGE] --out NEW_DIRECTORY");
  let source = path.join(repo, DEFAULT_SOURCE);
  let out;
  for (let index = 1; index < argv.length; index += 1) {
    if (argv[index] === "--source") {
      assert.ok(argv[index + 1], "--source requires an image path");
      source = path.resolve(argv[++index]);
    } else if (argv[index] === "--out") {
      assert.ok(argv[index + 1], "--out requires a new output directory");
      out = path.resolve(argv[++index]);
    } else {
      fail(`unknown argument: ${argv[index]}`);
    }
  }
  assert.ok(out, "--out requires a new output directory");
  return { source, out };
}

export async function prepare({ source, out }) {
  await assertNoSymlinkComponents(source);
  const sourceInfo = await fs.lstat(source);
  assert.ok(sourceInfo.isFile() && !sourceInfo.isSymbolicLink(), "source image must be a regular file");
  await assertNoSymlinkComponents(out, { allowMissingLeaf: true });
  await assert.rejects(() => fs.lstat(out), error => error?.code === "ENOENT",
    "output directory already exists; use a new isolated output directory");
  const sourceSize = sourceInfo.size;
  const sourceSha256 = await sha256File(source);
  validateBase({ size: sourceSize, sha256: sourceSha256 });

  const commandLog = [];
  const debugfsImageId = await resolveDebugfsImage(commandLog);
  const statsText = await debugfs(source, "stats", commandLog, "utf8", debugfsImageId);
  const blockSize = parseBlockSize(statsText);
  const blockCount = parseInteger(statsText, /^Block count:\s+(\d+)$/mu, "block count");
  assert.equal(blockSize * blockCount, sourceSize, "source ext4 logical size differs from its file size");
  const inspections = [];
  for (const pathname of DECLARED_FILES) {
    inspections.push(await inspectExt4File(source, pathname, blockSize, commandLog, debugfsImageId));
  }
  const plan = makePatchPlan(inspections, blockSize);
  assertPatchRangesWithinImage(plan, sourceSize);

  await fs.mkdir(out, { mode: 0o700 });
  await fs.chmod(out, 0o700);
  assert.equal((await fs.stat(out)).mode & 0o7777, 0o700, "candidate output directory must be mode 0700");
  const candidate = path.join(out, "omarchy-profile-softpipe.ext4");
  const copy = await copyCandidate(source, candidate, commandLog);
  await assertNoSymlinkComponents(candidate);
  const candidateInfo = await fs.lstat(candidate);
  assert.ok(candidateInfo.isFile() && !candidateInfo.isSymbolicLink(),
    "candidate clone must be a regular non-symlink file");
  const handle = await fs.open(candidate, "r+");
  try {
    for (const patch of plan) {
      assertPatchRangesWithinImage([patch], sourceSize);
      const oldBytes = Buffer.alloc(patch.writeLength);
      const readResult = await handle.read(oldBytes, 0, patch.writeLength, patch.writeAbsoluteOffset);
      assert.equal(readResult.bytesRead, patch.writeLength, `${patch.path}: could not read old bytes before writing`);
      assert.equal(oldBytes.toString("hex"), patch.writeOldHex,
        `${patch.path}: candidate clone does not contain the expected old bytes`);
      const writeResult = await handle.write(NEW_VALUE, 0, NEW_VALUE.length, patch.writeAbsoluteOffset);
      assert.equal(writeResult.bytesWritten, NEW_VALUE.length, `${patch.path}: short renderer patch write`);
    }
  } finally {
    await handle.close();
  }
  const candidateSize = await fileSize(candidate);
  assert.equal(candidateSize, sourceSize, "candidate image size changed after patching");
  const imageHashes = await compareImageStreams(source, candidate, plan);
  assert.equal(imageHashes.baseSha256, BASE_SHA256,
    "source image SHA-256 changed during preparation; refusing a TOCTOU receipt");

  const candidateStatsText = await debugfs(candidate, "stats", commandLog, "utf8", debugfsImageId);
  const candidateBlockSize = parseBlockSize(candidateStatsText);
  const candidateBlockCount = parseInteger(candidateStatsText, /^Block count:\s+(\d+)$/mu, "candidate block count");
  assert.equal(candidateBlockSize, blockSize, "candidate ext4 block size changed");
  assert.equal(candidateBlockCount, blockCount, "candidate ext4 block count changed");
  const candidateMetadata = [];
  for (const pathname of DECLARED_FILES) {
    const item = await inspectExt4File(candidate, pathname, candidateBlockSize, commandLog, debugfsImageId);
    const sourceItem = inspections.find(value => value.pathname === pathname);
    assert.deepEqual(
      { inode: item.metadata.inode, mode: item.metadata.mode, uid: item.metadata.uid, gid: item.metadata.gid,
        size: item.metadata.size, blockCount: item.metadata.blockCount, physicalBlock: item.metadata.physicalBlock },
      { inode: sourceItem.metadata.inode, mode: sourceItem.metadata.mode, uid: sourceItem.metadata.uid, gid: sourceItem.metadata.gid,
        size: sourceItem.metadata.size, blockCount: sourceItem.metadata.blockCount, physicalBlock: sourceItem.metadata.physicalBlock },
      `${pathname}: candidate inode ownership/mode/allocation metadata changed`,
    );
    candidateMetadata.push({
      path: pathname,
      source: { inode: sourceItem.metadata.inode, mode: sourceItem.metadata.mode, uid: sourceItem.metadata.uid,
        gid: sourceItem.metadata.gid, size: sourceItem.metadata.size, blockCount: sourceItem.metadata.blockCount,
        physicalBlock: sourceItem.metadata.physicalBlock },
      candidate: { inode: item.metadata.inode, mode: item.metadata.mode, uid: item.metadata.uid, gid: item.metadata.gid,
        size: item.metadata.size, blockCount: item.metadata.blockCount, physicalBlock: item.metadata.physicalBlock },
    });
  }

  const receipt = {
    schema: "wasm-vm.e5.5-t03f.softpipe-candidate.v1",
    task: "E5.5-T03f",
    command: "node tools/verify/omarchy-softpipe-candidate.mjs prepare --out <new-directory>",
    source: { path: path.relative(repo, source), size: sourceSize, sha256: sourceSha256 },
    candidate: { path: path.relative(repo, candidate), size: candidateSize, sha256: imageHashes.candidateSha256 },
    baseSha256: imageHashes.baseSha256,
    derivedSha256: imageHashes.candidateSha256,
    copy,
    ext4: { blockSize, blockCount, debugfsImage: DEBUGFS_IMAGE, debugfsImageId },
    patches: plan,
    metadata: candidateMetadata,
    commands: commandLog,
    result: "passed",
  };
  await fs.writeFile(path.join(out, "receipt.json"), `${JSON.stringify(receipt, null, 2)}\n`, { flag: "wx" });
  return receipt;
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const receipt = await prepare(options);
  process.stdout.write(`E5T03F_CANDIDATE=${JSON.stringify({
    receipt: path.relative(repo, path.join(options.out, "receipt.json")),
    sourceSha256: receipt.source.sha256,
    candidateSha256: receipt.candidate.sha256,
    patchOffsets: receipt.patches.map(patch => patch.absoluteOffset),
  })}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch(error => {
    process.stderr.write(`omarchy-softpipe-candidate: ${error.stack || error}\n`);
    process.exitCode = 1;
  });
}
