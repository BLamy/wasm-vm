// Deterministic guards for the responsive pair preparer's header/delta handling. No guest proof.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { coreIdHex, encodeDelta, manifestBaseId, parseArgs, readPairHeaders } from "./prepare-omarchy-responsive.mjs";

const BASE = "ab".repeat(32);
function snapshotHeader({ core = coreIdHex("0.0.1"), base = BASE, generation = 0n } = {}) {
  const bytes = Buffer.alloc(128);
  bytes.write("WVMRESU1", 0, "latin1");
  bytes.writeUInt32LE(1, 8);
  Buffer.from(core, "hex").copy(bytes, 12);
  Buffer.from(base, "hex").copy(bytes, 44);
  bytes.writeBigUInt64LE(generation, 76);
  return bytes;
}
const block = (fill) => Buffer.alloc(4096, fill);

test("encoded deltas round-trip through the pair header reader", () => {
  const delta = encodeDelta([{ index: 3, bytes: block(1) }, { index: 9, bytes: block(2) }], 1 << 20, BASE);
  const headers = readPairHeaders(snapshotHeader(), delta);
  assert.equal(headers.snapshotCore, coreIdHex("0.0.1"));
  assert.equal(headers.snapshotBase, BASE);
  assert.equal(headers.deltaBase, BASE);
  assert.equal(headers.deltaImageLen, 1 << 20);
  assert.equal(headers.snapshotGeneration, 0);
  assert.equal(headers.deltaGeneration, 0, "a prepared pair is written with generation 0");
  assert.deepEqual(headers.records.map((r) => r.index), [3, 9]);
  assert.equal(delta[headers.records[1].at], 2);
});

test("the reader reports a browser-exported overlay generation and rejects malformed deltas", () => {
  const delta = encodeDelta([{ index: 1, bytes: block(7) }], 1 << 20, BASE);
  delta.writeBigUInt64LE(48n, 49);
  const headers = readPairHeaders(snapshotHeader({ generation: 48n }), delta);
  assert.equal(headers.snapshotGeneration, 48);
  assert.equal(headers.deltaGeneration, 48);
  const unordered = encodeDelta([{ index: 5, bytes: block(1) }, { index: 5, bytes: block(2) }], 1 << 20, BASE);
  assert.throws(() => readPairHeaders(snapshotHeader(), unordered), /strictly increasing/u);
  assert.throws(() => readPairHeaders(snapshotHeader(), delta.subarray(0, delta.length - 1)), /truncated/u);
  const badMagic = snapshotHeader(); badMagic.write("XXXXXXXX", 0, "latin1");
  assert.throws(() => readPairHeaders(badMagic, delta), /resume snapshot/u);
});

test("identity helpers match the browser's canonical manifest id and padded core id", () => {
  const manifest = { chunks: ["c1"], version: 1, layout: "split", chunk_size: 262144, image_len: 4096, extra: "ignored" };
  const canonical = JSON.stringify({ version: 1, image_len: 4096, chunk_size: 262144, layout: "split", chunks: ["c1"] });
  assert.equal(manifestBaseId(manifest), createHash("sha256").update(canonical).digest("hex"));
  assert.equal(coreIdHex("0.0.1"), Buffer.from("0.0.1").toString("hex").padEnd(64, "0"));
});

test("arguments are required and unknown flags are rejected", () => {
  const argv = ["--bin", "b", "--kernel", "k", "--pair", "p", "--base-image", "i", "--chunks", "c", "--out", "o"];
  assert.equal(parseArgs(argv).out, "o");
  assert.throws(() => parseArgs(argv.slice(0, -2)), /--out is required/u);
  assert.throws(() => parseArgs([...argv, "--nope", "1"]), /unknown argument/u);
});
