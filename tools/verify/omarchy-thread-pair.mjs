#!/usr/bin/env node
// E5.5-T03g paired RAM/delta evidence validator. This module only reads artifacts.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import { createReadStream } from "node:fs";
import { createGunzip } from "node:zlib";

const SHA = /^[0-9a-f]{64}$/u;
const IMAGE_SIZE = 4 * 1024 * 1024 * 1024;
const BLOCK_SIZE = 4096;
const CORE_VERSION = "0.0.1";

function fail(message) { throw new Error(`UNPROVEN: ${message}`); }

function canonicalBase(manifestBytes) {
  let manifest;
  try { manifest = JSON.parse(Buffer.from(manifestBytes).toString("utf8")); }
  catch (cause) { fail(`chunk manifest is not JSON: ${cause.message}`); }
  const identity = {};
  for (const key of ["version", "image_len", "chunk_size", "layout", "chunks"]) {
    assert.ok(Object.prototype.hasOwnProperty.call(manifest, key), `chunk manifest is missing ${key}`);
    identity[key] = manifest[key];
  }
  assert.equal(identity.image_len, IMAGE_SIZE, "chunk manifest image length is not 4 GiB");
  assert.equal(identity.chunk_size, 256 * 1024, "chunk manifest chunk size is not 256 KiB");
  assert.equal(identity.layout, "split", "chunk manifest layout is not split");
  assert.equal(identity.chunks.length, IMAGE_SIZE / identity.chunk_size, "chunk manifest count is not pinned");
  return createHash("sha256").update(JSON.stringify(identity)).digest("hex");
}

function oneLogRecord(lines, pattern, label) {
  const matches = lines.map((line) => line.match(pattern)).filter(Boolean);
  assert.equal(matches.length, 1, `native log must contain exactly one ${label} record`);
  return matches[0];
}

function parseLog(nativeLog) {
  const lines = String(nativeLog).split(/\r?\n/u);
  const core = oneLogRecord(lines, /^\s*\[omarchy-snapshot\]\s+core_id=([0-9a-f]{64})\s+\(version\s+([^\s)]+)\)\s*$/u, "core");
  const base = oneLogRecord(lines, /^\s*\[omarchy-snapshot\]\s+base_id=([0-9a-f]{64})\s*$/u, "base");
  const ram = oneLogRecord(lines, /^\s*\[omarchy-snapshot\]\s+RAM\s+raw=\s*([0-9]+)B\s+gz=\s*([0-9]+)B\s+sha256=([0-9a-f]{64})\s*$/u, "RAM");
  const delta = oneLogRecord(lines, /^\s*\[omarchy-snapshot\]\s+delta\s+raw=\s*([0-9]+)B\s+gz=\s*([0-9]+)B\s+sha256=([0-9a-f]{64})\s*$/u, "delta");
  const overlay = oneLogRecord(lines, /^\s*overlay-delta:\s*([0-9]+)\s+dirty\s+4KiB\s+blocks\s*\/\s*([0-9]+)\s+bytes\s*$/u, "overlay-delta");
  return {
    coreHex: core[1], coreVersion: core[2], baseHex: base[1],
    ramRaw: Number(ram[1]), ramGz: Number(ram[2]), ramSha256: ram[3],
    deltaRaw: Number(delta[1]), deltaGz: Number(delta[2]), deltaSha256: delta[3],
    blocks: Number(overlay[1]), overlayBytes: Number(overlay[2]),
  };
}

function validateHeaders({ manifestBytes, snapshotHeader, deltaHeader, nativeLog,
  snapshotSha256, deltaSha256, snapshotRawSize, deltaRawSize, snapshotGzipSize, deltaGzipSize }) {
  const base = canonicalBase(manifestBytes);
  const log = parseLog(nativeLog);
  assert.equal(log.coreVersion, CORE_VERSION, "native core version is not 0.0.1");
  const core = Buffer.alloc(32);
  Buffer.from(log.coreVersion, "utf8").copy(core);
  assert.equal(log.coreHex, core.toString("hex"), "native core_id is not the padded core version");
  assert.equal(log.baseHex, base, "native base_id differs from canonical manifest");
  assert.equal(snapshotSha256, log.ramSha256, "RAM hash claim differs from native log");
  assert.equal(deltaSha256, log.deltaSha256, "delta hash claim differs from native log");
  assert.match(snapshotSha256 || "", SHA, "RAM SHA-256 is invalid");
  assert.match(deltaSha256 || "", SHA, "delta SHA-256 is invalid");
  assert.ok(Buffer.isBuffer(snapshotHeader) && snapshotHeader.length >= 84, "RAM header is truncated");
  assert.equal(snapshotHeader.subarray(0, 8).toString("ascii"), "WVMRESU1", "RAM magic is invalid");
  assert.equal(snapshotHeader.readUInt32LE(8), 1, "RAM version is invalid");
  assert.equal(snapshotHeader.subarray(12, 44).toString("hex"), log.coreHex, "RAM core binding differs from native log");
  assert.equal(snapshotHeader.subarray(44, 76).toString("hex"), base, "RAM base binding differs from canonical manifest");
  assert.equal(snapshotHeader.readBigUInt64LE(76), 0n, "RAM generation is not native generation zero");
  assert.ok(Buffer.isBuffer(deltaHeader) && deltaHeader.length >= 61, "delta header is truncated");
  assert.equal(deltaHeader.subarray(0, 5).toString("ascii"), "WVOD1", "delta magic is invalid");
  assert.equal(deltaHeader.readUInt32LE(5), BLOCK_SIZE, "delta block size is invalid");
  assert.equal(deltaHeader.readBigUInt64LE(9), BigInt(IMAGE_SIZE), "delta image length is invalid");
  assert.equal(deltaHeader.subarray(17, 49).toString("hex"), base, "delta base binding differs from canonical manifest");
  assert.equal(deltaHeader.readBigUInt64LE(49), 0n, "delta generation is not native generation zero");
  const count = deltaHeader.readUInt32LE(57);
  assert.equal(count, log.blocks, "delta header count differs from overlay-delta log");
  assert.equal(log.overlayBytes, count * BLOCK_SIZE, "overlay-delta byte count is inconsistent");
  assert.equal(log.deltaRaw, 61 + count * 4104, "delta raw size log is inconsistent with header count");
  if (snapshotRawSize !== undefined) assert.equal(snapshotRawSize, log.ramRaw, "RAM raw size differs from native log");
  if (deltaRawSize !== undefined) assert.equal(deltaRawSize, log.deltaRaw, "delta raw size differs from native log");
  if (snapshotGzipSize !== undefined) assert.equal(snapshotGzipSize, log.ramGz, "RAM compressed size differs from native log");
  if (deltaGzipSize !== undefined) assert.equal(deltaGzipSize, log.deltaGz, "delta compressed size differs from native log");
  return { base, generation: 0, snapshotSha256, deltaSha256 };
}

export function validatePairBuffers(args) { return validateHeaders(args); }

async function sha256File(filename) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(filename)) hash.update(chunk);
  return hash.digest("hex");
}

async function gzipStats(filename, prefixLength) {
  const source = createReadStream(filename);
  const gunzip = source.pipe(createGunzip());
  source.on("error", error => gunzip.destroy(error));
  const prefix = Buffer.alloc(prefixLength);
  let prefixSize = 0, rawSize = 0;
  try {
    for await (const chunk of gunzip) {
      rawSize += chunk.length;
      if (prefixSize < prefix.length) {
        const count = Math.min(prefix.length - prefixSize, chunk.length);
        chunk.copy(prefix, prefixSize, 0, count); prefixSize += count;
      }
    }
  } finally { source.destroy(); gunzip.destroy(); }
  return { prefix: prefix.subarray(0, prefixSize), rawSize };
}

export async function validatePairHeaders({ manifestPath, snapshotPath, deltaPath, nativeLog, snapshotSha256, deltaSha256 }) {
  const manifestBytes = await fs.readFile(manifestPath);
  const snapshotStat = await fs.stat(snapshotPath);
  const deltaStat = await fs.stat(deltaPath);
  const actualSnapshotSha256 = await sha256File(snapshotPath);
  const actualDeltaSha256 = await sha256File(deltaPath);
  assert.equal(actualSnapshotSha256, snapshotSha256, "RAM compressed bytes do not match supplied hash");
  assert.equal(actualDeltaSha256, deltaSha256, "delta compressed bytes do not match supplied hash");
  const snapshot = await gzipStats(snapshotPath, 84);
  const delta = await gzipStats(deltaPath, 61);
  return validateHeaders({ manifestBytes, snapshotHeader: snapshot.prefix, deltaHeader: delta.prefix, nativeLog,
    snapshotSha256: actualSnapshotSha256, deltaSha256: actualDeltaSha256, snapshotRawSize: snapshot.rawSize,
    deltaRawSize: delta.rawSize, snapshotGzipSize: snapshotStat.size, deltaGzipSize: deltaStat.size });
}
