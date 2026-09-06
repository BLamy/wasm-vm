import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { sha256, verifyChunkStore } from "./e5-t18e-publication.mjs";

async function fixture(run) {
  const dir = await mkdtemp(path.join(tmpdir(), "e5-t18e-publication-"));
  try {
    await mkdir(path.join(dir, "chunks"));
    const a = Buffer.from("0123456789abcdef"), b = Buffer.from("abcdefghijklmnop");
    const hashes = [sha256(a), sha256(b), sha256(a)];
    await writeFile(path.join(dir, "chunks", `${hashes[0]}.bin`), a);
    await writeFile(path.join(dir, "chunks", `${hashes[1]}.bin`), b);
    const manifest = { image_len: 48, chunk_size: 16, layout: "split", chunks: hashes };
    const raw = JSON.stringify(manifest);
    await writeFile(path.join(dir, "manifest.json"), raw);
    const expected = { imageSha256: sha256(Buffer.concat([a, b, a])), chunkManifestSha256: sha256(raw) };
    await run({ dir, hashes, manifest, expected, dimensions: { image: 48, chunk: 16 } });
  } finally { await rm(dir, { recursive: true, force: true }); }
}

test("all chunk positions, including duplicate objects, reconstruct the image", () => fixture(async ({ dir, expected, dimensions }) => {
  assert.deepEqual(await verifyChunkStore(dir, expected, dimensions), { positions: 3, uniqueObjects: 2, imageBytes: 48 });
}));
test("one mutated published byte is rejected", () => fixture(async ({ dir, hashes, expected, dimensions }) => {
  const file = path.join(dir, "chunks", `${hashes[1]}.bin`), bytes = await readFile(file);
  bytes[0] ^= 1; await writeFile(file, bytes);
  await assert.rejects(verifyChunkStore(dir, expected, dimensions), /chunk content drift/);
}));
test("a mutated published manifest is rejected", () => fixture(async ({ dir, expected, dimensions }) => {
  await writeFile(path.join(dir, "manifest.json"), "{}");
  await assert.rejects(verifyChunkStore(dir, expected, dimensions), /chunk manifest drift/);
}));
test("missing published object fails closed", () => fixture(async ({ dir, hashes, expected, dimensions }) => {
  await rm(path.join(dir, "chunks", `${hashes[0]}.bin`));
  await assert.rejects(verifyChunkStore(dir, expected, dimensions), /ENOENT/);
}));
test("self-consistent manifest cannot change required dimensions", () => fixture(async ({ dir, manifest, expected, dimensions }) => {
  const raw = JSON.stringify({ ...manifest, image_len: 64 });
  await writeFile(path.join(dir, "manifest.json"), raw);
  await assert.rejects(verifyChunkStore(dir, { ...expected, chunkManifestSha256: sha256(raw) }, dimensions), /image dimensions drift/);
}));
test("reordered valid chunks cannot claim the original full-image hash", () => fixture(async ({ dir, manifest, expected, dimensions }) => {
  const raw = JSON.stringify({ ...manifest, chunks: [...manifest.chunks].sort() });
  assert.notEqual(raw, JSON.stringify(manifest));
  await writeFile(path.join(dir, "manifest.json"), raw);
  await assert.rejects(verifyChunkStore(dir, { ...expected, chunkManifestSha256: sha256(raw) }, dimensions), /reconstructed image drift/);
}));
