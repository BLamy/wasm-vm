import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, open, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { verifyPublication } from "./e5-t18e-publication.mjs";

// Exercise the complete publication boundary, independently of any recorded guest
// image. The 1-GiB raw fixture is sparse; its only chunk is 128 KiB of zeroes.
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");

test("verifier: full publication rejects stale image, locks, metadata and chunk bytes", async (t) => {
  const repo = await mkdtemp(path.join(tmpdir(), "e5-t18e-verifier-"));
  try {
    const imageDir = path.join(repo, "image");
    const chunkDir = path.join(repo, "publication");
    const inputDir = path.join(repo, "tools/image/e5-t18e");
    await mkdir(imageDir);
    await mkdir(path.join(chunkDir, "chunks"), { recursive: true });
    await mkdir(inputDir, { recursive: true });
    const imageBytes = 1_073_741_824;
    const bytes = Buffer.alloc(131_072);
    const positions = imageBytes / bytes.length;
    const imageHash = createHash("sha256");
    for (let index = 0; index < positions; index++) imageHash.update(bytes);
    const imagePath = path.join(imageDir, "alpine-rootfs.ext4");
    const imageHandle = await open(imagePath, "w");
    await imageHandle.truncate(imageBytes);
    await imageHandle.close();
    const chunkPath = path.join(chunkDir, "chunks", `${digest(bytes)}.bin`);
    await writeFile(chunkPath, bytes);
    const manifestPath = path.join(chunkDir, "manifest.json");
    const manifest = JSON.stringify({ image_len: imageBytes, chunk_size: bytes.length,
      layout: "split", chunks: Array(positions).fill(digest(bytes)) });
    await writeFile(manifestPath, manifest);
    const packages = "verifier-fixture-1.0-r0\n";
    const customFiles = `${digest("fixture")} 0644 /etc/verifier-fixture\n`;
    for (const directory of [imageDir, inputDir]) {
      await writeFile(path.join(directory, "MANIFEST.txt"), packages);
      await writeFile(path.join(directory, "FILE-MANIFEST.txt"), customFiles);
    }
    const lock = { schema: "wasm-vm.e5-t18d.image-lock.v1",
      imageSha256: imageHash.digest("hex"), chunkManifestSha256: digest(manifest),
      packageManifestSha256: digest(packages), fileManifestSha256: digest(customFiles) };
    await writeFile(path.join(repo, "tools/image/e5-t18d-desktop-image.json"), JSON.stringify(lock));
    const infoPath = path.join(imageDir, "desktop-info.json");
    const info = { image: { sha256: lock.imageSha256 },
      startup: { boundedRecovery: true, backend: "drm", renderer: "pixman" } };
    await writeFile(infoPath, JSON.stringify(info));
    const verify = () => verifyPublication(repo, imageDir, chunkDir);
    await t.test("positive control reconstructs all 8192 positions", async () => {
      const result = await verify();
      assert.equal(result.imageSha256, lock.imageSha256);
      assert.equal(result.positions, positions);
      assert.equal(result.uniqueObjects, 1);
      assert.equal(result.imageBytes, imageBytes);
    });

    await t.test("one raw-image byte changed after publication is rejected", async () => {
      const handle = await open(imagePath, "r+");
      try {
        await handle.write(Buffer.from([1]), 0, 1, 65537);
        await assert.rejects(verify(), /alpine-rootfs\.ext4 drift/);
      } finally {
        await handle.write(Buffer.from([0]), 0, 1, 65537);
        await handle.close();
      }
    });

    async function changedFile(file, replacement, expected) {
      const original = await readFile(file);
      try {
        await writeFile(file, replacement);
        await assert.rejects(verify(), expected);
      } finally { await writeFile(file, original); }
    }

    for (const [directory, prefix] of [[imageDir, "output"], [inputDir, "committed input"]]) {
      for (const name of ["MANIFEST.txt", "FILE-MANIFEST.txt"]) {
        await t.test(`${prefix} ${name} changed after publication is rejected`, () =>
          changedFile(path.join(directory, name), "mutated\n", new RegExp(`${name.replaceAll(".", "\\.")} drift`)));
      }
    }
    await t.test("changed served manifest is rejected", () =>
      changedFile(manifestPath, `${manifest}\n`, /chunk manifest drift/));
    await t.test("changed chunk object is rejected through the full publication API", async () => {
      const mutant = Buffer.from(bytes);
      mutant[32769] = 1;
      await changedFile(chunkPath, mutant, /chunk content drift/);
    });
    await t.test("stale builder image metadata is rejected", () =>
      changedFile(infoPath, JSON.stringify({ ...info, image: { sha256: "0".repeat(64) } }), /builder metadata drift/));
    for (const [key, value] of [["boundedRecovery", false], ["backend", "headless"], ["renderer", "gles2"]]) {
      await t.test(`builder profile cannot silently change ${key}`, () =>
        changedFile(infoPath, JSON.stringify({ ...info, startup: { ...info.startup, [key]: value } }),
          { code: "ERR_ASSERTION" }));
    }
    await t.test("restored fixture still passes, excluding cross-case contamination", async () => {
      assert.equal((await verify()).imageSha256, lock.imageSha256);
    });
  } finally {
    await rm(repo, { recursive: true, force: true });
  }
});
