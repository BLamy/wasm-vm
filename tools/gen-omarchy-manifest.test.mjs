import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);
const repo = process.cwd();
const generator = path.join(repo, "tools/gen-omarchy-manifest.sh");

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function pairedHeaders(baseHex, generation = 7) {
  const base = Buffer.from(baseHex, "hex");
  const delta = Buffer.alloc(61);
  delta.write("WVOD1", 0, "ascii");
  delta.writeUInt32LE(4096, 5);
  delta.writeBigUInt64LE(8192n, 9);
  base.copy(delta, 17);
  delta.writeBigUInt64LE(BigInt(generation), 49);
  delta.writeUInt32LE(0, 57);

  const ram = Buffer.alloc(84);
  ram.write("WVMRESU1", 0, "ascii");
  ram.writeUInt32LE(1, 8);
  base.copy(ram, 44);
  ram.writeBigUInt64LE(BigInt(generation), 76);
  return { delta: gzipSync(delta), ram: gzipSync(ram) };
}

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "wasm-vm-omarchy-manifest-"));
  const manifestPath = path.join(root, "chunks", "manifest.json");
  const outputPath = path.join(root, "artifacts-omarchy.json");
  const kernelPath = path.join(root, "Image");
  const ramPath = path.join(root, "omarchy-ready.snap.gz");
  const deltaPath = path.join(root, "omarchy-overlay-delta.bin.gz");
  const manifest = {
    version: 1,
    image_len: 8192,
    chunk_size: 4096,
    layout: "split",
    chunks: ["a".repeat(64), "b".repeat(64)],
  };
  const rawManifest = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`);
  const identity = JSON.stringify({
    version: manifest.version,
    image_len: manifest.image_len,
    chunk_size: manifest.chunk_size,
    layout: manifest.layout,
    chunks: manifest.chunks,
  });
  const baseHex = sha256(Buffer.from(identity));
  const pair = pairedHeaders(baseHex);
  await mkdir(path.dirname(manifestPath), { recursive: true });
  await writeFile(manifestPath, rawManifest);
  await writeFile(kernelPath, Buffer.from("kernel"));
  await writeFile(ramPath, pair.ram);
  await writeFile(deltaPath, pair.delta);
  return {
    root,
    manifest,
    rawManifest,
    baseHex,
    paths: { manifestPath, outputPath, kernelPath, ramPath, deltaPath },
    env: {
      ...process.env,
      OMARCHY_CHUNK_MANIFEST: manifestPath,
      OMARCHY_KERNEL: kernelPath,
      OMARCHY_RAM_SNAPSHOT: ramPath,
      OMARCHY_OVERLAY_DELTA: deltaPath,
      OMARCHY_MANIFEST_OUT: outputPath,
    },
  };
}

async function runGenerator(env) {
  return execFileAsync("bash", [generator], { cwd: repo, env });
}

test("generator binds chunkedImage to pretty JSON raw bytes, not canonical identity", async () => {
  const f = await fixture();
  try {
    const canonical = Buffer.from(JSON.stringify(f.manifest));
    assert.notEqual(sha256(f.rawManifest), sha256(canonical));
    await runGenerator(f.env);
    const output = JSON.parse(await readFile(f.paths.outputPath, "utf8"));
    const rawSha = sha256(f.rawManifest);
    assert.equal(output.chunkedImage.sha256, rawSha);
    assert.equal(output.chunkedImage.size, f.rawManifest.length);
    assert.equal(output.chunkedImage.key, `chunked-omarchy/manifest-${rawSha}.json`);
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});

test("generator rejects a mixed RAM/delta pair before rewriting output", async () => {
  const f = await fixture();
  try {
    await runGenerator(f.env);
    const before = await readFile(f.paths.outputPath);
    const rawDelta = Buffer.alloc(61);
    rawDelta.write("WVOD1", 0, "ascii");
    rawDelta.writeUInt32LE(4096, 5);
    rawDelta.writeBigUInt64LE(8192n, 9);
    Buffer.alloc(32, 0xff).copy(rawDelta, 17);
    rawDelta.writeBigUInt64LE(7n, 49);
    rawDelta.writeUInt32LE(0, 57);
    await writeFile(f.paths.deltaPath, gzipSync(rawDelta));

    await assert.rejects(runGenerator(f.env), /overlay delta is not bound to the canonical chunk manifest/u);
    assert.deepEqual(await readFile(f.paths.outputPath), before);
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});
