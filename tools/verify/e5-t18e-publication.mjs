import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";

export const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
export async function hashFile(file) {
  const hash = createHash("sha256");
  for await (const bytes of createReadStream(file)) hash.update(bytes);
  return hash.digest("hex");
}

export async function verifyChunkStore(directory, expected, dimensions = { image: 1_073_741_824, chunk: 131_072 }) {
  const raw = await readFile(path.join(directory, "manifest.json"));
  assert.equal(sha256(raw), expected.chunkManifestSha256, "chunk manifest drift");
  const manifest = JSON.parse(raw);
  assert.equal(manifest.image_len, dimensions.image, "image dimensions drift");
  assert.equal(manifest.chunk_size, dimensions.chunk, "chunk dimensions drift");
  assert.equal(manifest.layout, "split");
  assert.equal(manifest.chunks.length, Math.ceil(dimensions.image / dimensions.chunk));
  const unique = new Map(), complete = createHash("sha256");
  for (let index = 0; index < manifest.chunks.length; index++) {
    const digest = manifest.chunks[index];
    assert.match(digest, /^[0-9a-f]{64}$/);
    if (!unique.has(digest)) {
      const bytes = await readFile(path.join(directory, "chunks", `${digest}.bin`));
      assert.equal(sha256(bytes), digest, "chunk content drift");
      unique.set(digest, bytes);
    }
    const bytes = unique.get(digest);
    assert.equal(bytes.length, Math.min(dimensions.chunk, dimensions.image - index * dimensions.chunk));
    complete.update(bytes);
  }
  assert.equal(complete.digest("hex"), expected.imageSha256, "reconstructed image drift");
  return { positions: manifest.chunks.length, uniqueObjects: unique.size, imageBytes: manifest.image_len };
}

export async function verifyPublication(repo, imageDir, chunkDir) {
  const lock = JSON.parse(await readFile(path.join(repo, "tools/image/e5-t18d-desktop-image.json"), "utf8"));
  assert.equal(lock.schema, "wasm-vm.e5-t18d.image-lock.v1");
  const files = [
    ["alpine-rootfs.ext4", "imageSha256"],
    ["MANIFEST.txt", "packageManifestSha256"],
    ["FILE-MANIFEST.txt", "fileManifestSha256"],
  ];
  for (const [name, key] of files) assert.equal(await hashFile(path.join(imageDir, name)), lock[key], `${name} drift`);
  for (const [name, key] of files.slice(1)) {
    assert.equal(await hashFile(path.join(repo, "tools/image/e5-t18e", name)), lock[key], `committed ${name} drift`);
  }
  const info = JSON.parse(await readFile(path.join(imageDir, "desktop-info.json"), "utf8"));
  assert.equal(info.image.sha256, lock.imageSha256, "builder metadata drift");
  assert.equal(info.startup.boundedRecovery, true);
  assert.equal(info.startup.backend, "drm");
  assert.equal(info.startup.renderer, "pixman");
  const chunks = await verifyChunkStore(chunkDir, lock);
  return { ...lock, ...chunks, imageDir: path.relative(repo, imageDir), chunkDir: path.relative(repo, chunkDir) };
}
