#!/usr/bin/env node
// Pure/bounded pair-validator fixtures. Temporary files are isolated under the OS temp dir.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { validatePairBuffers, validatePairHeaders } from "./omarchy-thread-pair.mjs";

const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const coreHex = "302e302e31000000000000000000000000000000000000000000000000000000";
const snapshotHash = "a".repeat(64);
const deltaHash = "c".repeat(64);
const count = 2;
const deltaRawSize = 61 + count * 4104;

const manifest = { version: 1, image_len: 4 * 1024 * 1024 * 1024, chunk_size: 256 * 1024,
  layout: "split", chunks: Array.from({ length: 16384 }, (_, index) => index.toString(16).padStart(64, "0")) };
const manifestBytes = () => Buffer.from(JSON.stringify(manifest));
const base = sha(Buffer.from(JSON.stringify({ version: manifest.version, image_len: manifest.image_len,
  chunk_size: manifest.chunk_size, layout: manifest.layout, chunks: manifest.chunks })));

function headers() {
  const ram = Buffer.alloc(100);
  ram.write("WVMRESU1", 0, "ascii"); ram.writeUInt32LE(1, 8); Buffer.from(coreHex, "hex").copy(ram, 12);
  Buffer.from(base, "hex").copy(ram, 44); ram.writeBigUInt64LE(0n, 76);
  const delta = Buffer.alloc(deltaRawSize);
  delta.write("WVOD1", 0, "ascii"); delta.writeUInt32LE(4096, 5); delta.writeBigUInt64LE(BigInt(4 * 1024 * 1024 * 1024), 9);
  Buffer.from(base, "hex").copy(delta, 17); delta.writeBigUInt64LE(0n, 49); delta.writeUInt32LE(count, 57);
  return { ram, delta };
}

function nativeLog(ramGzSize, deltaGzSize, ramSha = snapshotHash, deltaSha = deltaHash) {
  return [
    " [omarchy-snapshot] core_id=302e302e31000000000000000000000000000000000000000000000000000000 (version 0.0.1) ",
    `  [omarchy-snapshot] base_id=${base}`,
    `[omarchy-snapshot] RAM raw=    100B gz=    ${ramGzSize}B sha256=${ramSha}`,
    `[omarchy-snapshot] delta raw=${deltaRawSize}B gz=${deltaGzSize}B sha256=${deltaSha}`,
    `overlay-delta: ${count} dirty 4KiB blocks / ${count * 4096} bytes`,
  ].join("\n");
}

const { ram, delta } = headers();
const ramGz = gzipSync(ram, { level: 9 });
const deltaGz = gzipSync(delta, { level: 9 });
const valid = { manifestBytes: manifestBytes(), snapshotHeader: ram, deltaHeader: delta,
  nativeLog: nativeLog(ramGz.length, deltaGz.length), snapshotSha256: snapshotHash, deltaSha256: deltaHash,
  snapshotRawSize: ram.length, deltaRawSize: delta.length, snapshotGzipSize: ramGz.length, deltaGzipSize: deltaGz.length };

// The pure buffer path validates exact production headers and the actual native log grammar.
assert.deepEqual(validatePairBuffers(valid), { base, generation: 0, snapshotSha256: snapshotHash, deltaSha256: deltaHash });

const reject = (mutated, pattern) => assert.throws(() => validatePairBuffers({ ...valid, ...mutated }), pattern);
reject({ snapshotHeader: Buffer.from(ram).fill(0x31, 12, 13) }, /RAM core binding/u);
reject({ nativeLog: valid.nativeLog.replace(base, "d".repeat(64)) }, /base_id/u);
reject({ snapshotHeader: Buffer.from(ram).fill(1, 76, 84) }, /generation/u);
reject({ snapshotSha256: "d".repeat(64) }, /hash claim/u);
reject({ nativeLog: `${valid.nativeLog}\n${valid.nativeLog.split("\n")[1]}` }, /exactly one base/u);
reject({ nativeLog: valid.nativeLog.replace(/\noverlay-delta:[^\n]+/u, "") }, /exactly one overlay-delta/u);
const wrongCount = Buffer.from(delta); wrongCount.writeUInt32LE(3, 57);
reject({ deltaHeader: wrongCount }, /header count/u);
reject({ deltaRawSize: delta.length - 1 }, /delta raw size/u);

const directory = await fs.mkdtemp(path.join(os.tmpdir(), "omarchy-thread-pair-"));
try {
  const manifestPath = path.join(directory, "manifest.json");
  const snapshotPath = path.join(directory, "snapshot.gz");
  const deltaPath = path.join(directory, "delta.gz");
  const actualSnapshotHash = sha(ramGz), actualDeltaHash = sha(deltaGz);
  await fs.writeFile(manifestPath, valid.manifestBytes);
  await fs.writeFile(snapshotPath, ramGz);
  await fs.writeFile(deltaPath, deltaGz);
  const result = await validatePairHeaders({ manifestPath, snapshotPath, deltaPath, nativeLog: nativeLog(ramGz.length, deltaGz.length,
    actualSnapshotHash, actualDeltaHash), snapshotSha256: actualSnapshotHash, deltaSha256: actualDeltaHash });
  assert.deepEqual(result, { base, generation: 0, snapshotSha256: actualSnapshotHash, deltaSha256: actualDeltaHash });
  await assert.rejects(() => validatePairHeaders({ manifestPath, snapshotPath, deltaPath,
    nativeLog: nativeLog(ramGz.length, deltaGz.length, snapshotHash, actualDeltaHash), snapshotSha256: snapshotHash, deltaSha256: actualDeltaHash }), /compressed bytes/u);
} finally {
  await fs.rm(directory, { recursive: true, force: true });
}

console.log("T03g pair validator harness-only tests: focused assertions passed");
