#!/usr/bin/env node

// E5-T17c: prove that the desktop image is reproducible, account for the real ext4 payload, and
// express the update as a content-addressed chunk delta over the E3 base. The builder and the
// verifier deliberately use separate output directories; the second build may consume only the
// first build's resolved package lock, never a host package cache.

import assert from "node:assert/strict";
import { execFile as execFileCallback } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import {
  mkdtemp,
  mkdir,
  readFile,
  rm,
  stat,
  truncate,
  utimes,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const defaultA = path.join(repo, "target/e5-t17b/desktop-image");
const defaultB = path.join(repo, "target/e5-t17c/repro-b");
const defaultBaseImage = path.join(repo, "releases/rootfs/alpine-rootfs.ext4");
const defaultChunkRoot = path.join(repo, "target/e5-t17c/chunks");
const defaultCli = path.join(repo, "target/release/wasm-vm");
const profilePath = path.join(repo, "tools/image/e5-t17a-desktop-packages.json");
const evidenceDir = path.join(repo, "evidence/e5-t17c");
const evidencePath = path.join(evidenceDir, "desktop-image-reproducibility.json");
const chunkSize = 128 * 1024;
const maxDeltaBytes = 350 * 1024 * 1024;
const SHA256 = /^[0-9a-f]{64}$/u;
const execFile = promisify(execFileCallback);

const outA = path.resolve(argument("--out-a") ?? defaultA);
const outB = path.resolve(argument("--out-b") ?? defaultB);
const baseImage = path.resolve(argument("--base-image") ?? defaultBaseImage);
const chunkRoot = path.resolve(argument("--chunk-root") ?? defaultChunkRoot);
const cli = path.resolve(argument("--cli") ?? defaultCli);
const selfTest = process.argv.includes("--self-test");

const sha256File = (file) => new Promise((resolve, reject) => {
  const hash = createHash("sha256");
  const input = createReadStream(file);
  input.on("error", reject);
  input.on("data", (chunk) => hash.update(chunk));
  input.on("end", () => resolve(hash.digest("hex")));
});

const readJson = async (file) => JSON.parse(await readFile(file, "utf8"));
const relative = (file) => path.relative(repo, file);

async function run(command, args, options = {}) {
  try {
    return await execFile(command, args, {
      cwd: repo,
      maxBuffer: 16 * 1024 * 1024,
      ...options,
    });
  } catch (error) {
    const stdout = typeof error.stdout === "string" ? error.stdout : "";
    const stderr = typeof error.stderr === "string" ? error.stderr : "";
    throw new Error(`${command} ${args.join(" ")} failed\n${stdout}${stderr}`, { cause: error });
  }
}

const profile = await readJson(profilePath);
const profileSha256 = await sha256File(profilePath);
const baseStat = await stat(baseImage);
assert.ok(baseStat.isFile(), `base image is not a file: ${baseImage}`);
assert.ok(baseStat.size > 0, `base image is empty: ${baseImage}`);

const buildA = await validateDesktopOutput(outA, "build-a");
const buildB = await validateDesktopOutput(outB, "build-b");
compareNormalized(buildA, buildB);
assert.equal(buildA.image.sha256, buildB.image.sha256, "two desktop images are not byte-identical");

const baseChunkDir = path.join(chunkRoot, "base");
const aChunkDir = path.join(chunkRoot, "desktop-a");
const bChunkDir = path.join(chunkRoot, "desktop-b");
await rm(chunkRoot, { recursive: true, force: true });
const baseChunks = await chunkAndVerify(baseImage, baseChunkDir);
const desktopChunksA = await chunkAndVerify(buildA.image.path, aChunkDir);
const desktopChunksB = await chunkAndVerify(buildB.image.path, bChunkDir);
assert.deepEqual(desktopChunksA.manifest, desktopChunksB.manifest, "desktop chunk manifests diverged");

const baseExt4 = await inspectExt4Image(baseImage);
const desktopExt4 = await inspectExt4Image(buildA.image.path);
assert.equal(baseExt4.logicalBytes, baseStat.size, "base ext4 logical size differs from its file size");
assert.equal(desktopExt4.logicalBytes, buildA.image.size, "desktop ext4 logical size differs from its file size");

const chunks = await computeChunkDiff({
  base: baseChunks.manifest,
  baseDir: baseChunkDir,
  desktop: desktopChunksA.manifest,
  desktopDir: aChunkDir,
  baseLogicalBytes: baseExt4.logicalBytes,
  desktopLogicalBytes: desktopExt4.logicalBytes,
});

const allocatedDeltaBytes = desktopExt4.usedBytes - baseExt4.usedBytes;
const accountedDeltaBytes = Math.max(0, allocatedDeltaBytes, chunks.fetchedBytes);
assert.ok(
  accountedDeltaBytes <= maxDeltaBytes,
  `desktop ext4 delta ${accountedDeltaBytes} exceeds ${maxDeltaBytes} bytes`,
);

if (selfTest) await runSelfTests({
  buildA,
  buildB,
  baseChunks,
  desktopChunks: desktopChunksA,
  baseExt4,
  desktopExt4,
  chunks,
});

await mkdir(evidenceDir, { recursive: true });
const commit = (await run("git", ["rev-parse", "HEAD"])).stdout.trim();
assert.match(commit, /^[0-9a-f]{40}$/u, "evidence must bind to an exact commit");
const evidence = {
  schema: "wasm-vm.e5-t17c.desktop-image-reproducibility.v1",
  task: "E5-T17c",
  command: "make verify-E5-T17c",
  commit,
  profile: {
    path: relative(profilePath),
    sha256: profileSha256,
    packageCount: profile.packages.length,
  },
  base: {
    image: { path: relative(baseImage), sha256: await sha256File(baseImage), size: baseStat.size },
    ext4: baseExt4,
    chunks: {
      path: relative(baseChunkDir),
      manifestSha256: await sha256File(path.join(baseChunkDir, "manifest.json")),
      count: baseChunks.manifest.chunks.length,
      uniqueCount: new Set(baseChunks.manifest.chunks).size,
    },
  },
  builds: {
    a: portableBuild(buildA),
    b: portableBuild(buildB),
  },
  reproducibility: {
    imageByteIdentical: true,
    normalizedPackageManifestIdentical: true,
    normalizedFileManifestIdentical: true,
    firstDifference: null,
    outputDirectoriesDiffer: outA !== outB,
    timestampNormalization: "package lines and path/content/mode entries; filesystem mtimes ignored",
  },
  ext4Delta: {
    budgetBytes: maxDeltaBytes,
    budgetMiB: maxDeltaBytes / (1024 * 1024),
    allocatedDeltaBytes,
    contentDeltaBytes: chunks.fetchedBytes,
    accountedDeltaBytes,
    passed: true,
    sparseFileRejectedByLogicalExt4Inspection: true,
  },
  chunks: {
    chunkSize: chunkSize,
    baseImageLen: baseChunks.manifest.image_len,
    desktopImageLen: desktopChunksA.manifest.image_len,
    basePositionCount: baseChunks.manifest.chunks.length,
    desktopPositionCount: desktopChunksA.manifest.chunks.length,
    baseUniqueCount: chunks.baseUniqueCount,
    desktopUniqueCount: chunks.desktopUniqueCount,
    reusedObjectCount: chunks.reusedObjectCount,
    reusedObjectBytes: chunks.reusedObjectBytes,
    reusedPositionCount: chunks.reusedPositionCount,
    reusedPositionRatio: chunks.reusedPositionRatio,
    changedPrefixPositionCount: chunks.changedPrefixPositionCount,
    tailPositionCount: chunks.tailPositionCount,
    newObjectCount: chunks.newObjectCount,
    fetchedBytes: chunks.fetchedBytes,
    fullBaseUploadRejected: true,
    reusedObjects: chunks.reusedHashes,
    newDesktopObjects: chunks.newHashes,
    newDesktopPositionIndices: chunks.newPositionIndices,
  },
  selfTests: selfTest ? [
    "touched-manifests-normalize-equal",
    "package-content-mutation-rejected",
    "config-content-mutation-rejected",
    "base-dedupe-index-removal-rejected",
    "sparse-image-rejected",
  ] : [],
  result: "passed",
};
await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);
process.stdout.write(`E5T17C_VERIFIED=${JSON.stringify({
  evidence: relative(evidencePath),
  imageSha256: buildA.image.sha256,
  accountedDeltaBytes,
  reusedPositionCount: chunks.reusedPositionCount,
  newObjectCount: chunks.newObjectCount,
})}\n`);

async function validateDesktopOutput(outputDir, label) {
  const imagePath = path.join(outputDir, "alpine-rootfs.ext4");
  const infoPath = path.join(outputDir, "desktop-info.json");
  const packageManifestPath = path.join(outputDir, "MANIFEST.txt");
  const fileManifestPath = path.join(outputDir, "FILE-MANIFEST.txt");
  const checksumsPath = path.join(outputDir, "SHA256SUMS");
  const [info, packageManifest, fileManifest, checksums, imageStat] = await Promise.all([
    readJson(infoPath),
    readFile(packageManifestPath, "utf8"),
    readFile(fileManifestPath, "utf8"),
    readFile(checksumsPath, "utf8"),
    stat(imagePath),
  ]);
  assert.ok(imageStat.isFile() && imageStat.size > 0, `${label}: desktop image is missing or empty`);
  assert.equal(info.schema, "wasm-vm.e5-t17b.desktop-image-info.v1", `${label}: wrong desktop-info schema`);
  assert.equal(info.task, "E5-T17b", `${label}: wrong desktop-info task`);
  assert.equal(info.architecture, "riscv64", `${label}: wrong image architecture`);
  assert.equal(info.profile.path, "tools/image/e5-t17a-desktop-packages.json", `${label}: wrong profile path`);
  assert.equal(info.image.path, relative(imagePath), `${label}: wrong image path`);
  assert.equal(info.packageManifest.path, relative(packageManifestPath), `${label}: wrong package manifest path`);
  assert.equal(info.fileManifest.path, relative(fileManifestPath), `${label}: wrong file manifest path`);
  assert.equal(info.profile.sha256, profileSha256, `${label}: stale profile digest`);
  assert.equal(info.image.sha256, await sha256File(imagePath), `${label}: stale image digest`);
  assert.equal(info.image.size, imageStat.size, `${label}: stale image size`);
  assert.equal(info.packageManifest.sha256, await sha256File(packageManifestPath), `${label}: stale package digest`);
  assert.equal(info.fileManifest.sha256, await sha256File(fileManifestPath), `${label}: stale file digest`);
  assert.deepEqual(info.startup, {
    backend: "drm",
    renderer: "pixman",
    autologinTty: "tty1",
    desktopUser: "desktop",
    seatdRunlevel: "default",
  }, `${label}: startup contract drifted`);

  const packages = normalizePackageManifest(packageManifest);
  for (const pkg of profile.packages) {
    assert.ok(packages.includes(pkg.packageId), `${label}: missing profile package ${pkg.packageId}`);
  }
  const files = normalizeFileManifest(fileManifest);
  const checksumLines = checksums.split(/\r?\n/u).filter(Boolean);
  assert.equal(checksumLines.length, 2, `${label}: SHA256SUMS contains undeclared output`);
  assert.ok(checksumLines.includes(`${info.packageManifest.sha256}  MANIFEST.txt`), `${label}: package checksum missing`);
  assert.ok(checksumLines.includes(`${info.fileManifest.sha256}  FILE-MANIFEST.txt`), `${label}: file checksum missing`);
  return {
    output: relative(outputDir),
    image: { path: imagePath, sha256: info.image.sha256, size: imageStat.size },
    packageManifest: {
      path: packageManifestPath,
      sha256: info.packageManifest.sha256,
      normalized: packages,
    },
    fileManifest: {
      path: fileManifestPath,
      sha256: info.fileManifest.sha256,
      normalized: files,
    },
    startup: info.startup,
  };
}

function portableBuild(build) {
  return {
    ...build,
    image: { ...build.image, path: relative(build.image.path) },
    packageManifest: { ...build.packageManifest, path: relative(build.packageManifest.path) },
    fileManifest: { ...build.fileManifest, path: relative(build.fileManifest.path) },
  };
}

function normalizePackageManifest(value) {
  const entries = value.split(/\r?\n/u).map((line) => line.trim()).filter(Boolean);
  assert.ok(entries.length > 0, "package manifest is empty");
  assert.equal(new Set(entries).size, entries.length, "package manifest contains duplicate entries");
  return entries.toSorted();
}

function normalizeFileManifest(value) {
  const entries = [];
  const paths = new Set();
  for (const line of value.split(/\r?\n/u).map((item) => item.trim()).filter(Boolean)) {
    const match = line.match(/^(\S+)\s+(\S+)\s+(.+)$/u);
    assert.ok(match, `malformed FILE-MANIFEST line: ${line}`);
    const [, digest, mode, filePath] = match;
    assert.ok(digest === "directory" || SHA256.test(digest), `invalid file digest for ${filePath}`);
    assert.match(mode, /^0[0-7]{3,4}$/u, `invalid file mode for ${filePath}`);
    assert.ok(!paths.has(filePath), `duplicate FILE-MANIFEST path: ${filePath}`);
    paths.add(filePath);
    entries.push({ digest, mode, path: filePath });
  }
  assert.ok(entries.length > 0, "file manifest is empty");
  return entries.toSorted((a, b) => a.path.localeCompare(b.path));
}

function compareNormalized(a, b) {
  const packageDifference = firstDifference(a.packageManifest.normalized, b.packageManifest.normalized);
  if (packageDifference) {
    throw new Error(`package manifest first difference at index ${packageDifference.index}: ${JSON.stringify(packageDifference)}`);
  }
  const fileDifference = firstDifference(a.fileManifest.normalized, b.fileManifest.normalized);
  if (fileDifference) {
    throw new Error(`file manifest first difference at index ${fileDifference.index}: ${JSON.stringify(fileDifference)}`);
  }
}

function firstDifference(a, b) {
  const length = Math.max(a.length, b.length);
  for (let index = 0; index < length; index += 1) {
    if (JSON.stringify(a[index]) !== JSON.stringify(b[index])) {
      return { index, a: a[index] ?? null, b: b[index] ?? null };
    }
  }
  return null;
}

async function chunkAndVerify(imagePath, outputDir) {
  await mkdir(path.dirname(outputDir), { recursive: true });
  await run(cli, ["chunk", imagePath, "--out", outputDir, "--chunk-size", String(chunkSize), "--layout", "split"]);
  await run(cli, ["chunk-verify", outputDir]);
  const manifest = await readJson(path.join(outputDir, "manifest.json"));
  validateChunkManifest(manifest, (await stat(imagePath)).size);
  return { path: outputDir, manifest };
}

function validateChunkManifest(manifest, expectedImageLen) {
  assert.equal(manifest.version, 1, "unsupported chunk manifest version");
  assert.equal(manifest.layout, "split", "chunk manifest must use split layout");
  assert.equal(manifest.chunk_size, chunkSize, "chunk size is not the E3 128 KiB size");
  assert.equal(manifest.image_len, expectedImageLen, "chunk manifest image length is stale");
  assert.ok(Number.isSafeInteger(manifest.image_len) && manifest.image_len > 0, "invalid chunk image length");
  const expectedCount = Math.ceil(manifest.image_len / manifest.chunk_size);
  assert.equal(manifest.chunks.length, expectedCount, "chunk manifest position count is wrong");
  for (const hash of manifest.chunks) assert.match(hash, SHA256, "chunk manifest contains an invalid hash");
}

async function computeChunkDiff({ base, baseDir, desktop, desktopDir, baseLogicalBytes, desktopLogicalBytes }) {
  assert.equal(base.chunk_size, desktop.chunk_size, "base and desktop chunk sizes differ");
  assert.equal(base.chunk_size, chunkSize, "unexpected chunk size");
  assert.ok(baseLogicalBytes <= desktopLogicalBytes, "desktop image is smaller than the E3 base");
  const baseHashes = new Set(base.chunks);
  const desktopHashes = new Set(desktop.chunks);
  const reusedHashes = [...desktopHashes].filter((hash) => baseHashes.has(hash)).toSorted();
  const newHashes = [...desktopHashes].filter((hash) => !baseHashes.has(hash)).toSorted();
  const reusedPositionCount = desktop.chunks.reduce(
    (count, hash, index) => count + (index < base.chunks.length && hash === base.chunks[index] ? 1 : 0),
    0,
  );
  const changedPrefixPositionCount = desktop.chunks
    .slice(0, base.chunks.length)
    .reduce((count, hash, index) => count + (hash === base.chunks[index] ? 0 : 1), 0);
  const tailPositionCount = Math.max(0, desktop.chunks.length - base.chunks.length);
  const newPositionIndices = desktop.chunks
    .map((hash, index) => (baseHashes.has(hash) ? null : { index, sha256: hash }))
    .filter(Boolean);

  const [reusedObjectBytes, fetchedBytes] = await Promise.all([
    sumChunkBytes(desktopDir, reusedHashes),
    sumChunkBytes(desktopDir, newHashes),
  ]);
  assert.ok(reusedHashes.length > 0, "desktop image has no reusable E3 base chunk object");
  assert.ok(reusedPositionCount > 0, "desktop image has no unchanged E3 base positions");
  assert.ok(newHashes.length > 0, "desktop image has no desktop delta chunk objects");
  assert.ok(newHashes.length < desktopHashes.size, "desktop update degenerates into a full-base upload");
  assert.ok(fetchedBytes < desktopLogicalBytes, "desktop chunk diff fetches the full logical image");
  const reusedPositionRatio = reusedPositionCount / base.chunks.length;
  assert.ok(reusedPositionRatio >= 0.1, `only ${(reusedPositionRatio * 100).toFixed(1)}% of base positions are reused`);
  return {
    baseUniqueCount: baseHashes.size,
    desktopUniqueCount: desktopHashes.size,
    reusedHashes,
    reusedObjectCount: reusedHashes.length,
    reusedObjectBytes,
    reusedPositionCount,
    reusedPositionRatio,
    changedPrefixPositionCount,
    tailPositionCount,
    newHashes,
    newObjectCount: newHashes.length,
    fetchedBytes,
    newPositionIndices,
  };
}

async function sumChunkBytes(directory, hashes) {
  let total = 0;
  for (const hash of hashes) {
    const file = path.join(directory, "chunks", `${hash}.bin`);
    const fileStat = await stat(file);
    assert.ok(fileStat.isFile(), `chunk object is not a regular file: ${file}`);
    assert.ok(fileStat.size > 0 && fileStat.size <= chunkSize, `invalid chunk object size: ${file}`);
    total += fileStat.size;
  }
  return total;
}

async function inspectExt4Image(imagePath) {
  const fileStat = await stat(imagePath);
  const script = [
    "set -eu",
    "apk add --no-cache e2fsprogs-extra >/dev/null",
    "debugfs -R stats /image 2>&1",
  ].join("\n");
  const { stdout } = await run("docker", [
    "run",
    "--rm",
    "-v",
    `${imagePath}:/image:ro`,
    "alpine:3.20",
    "sh",
    "-lc",
    script,
  ], { maxBuffer: 4 * 1024 * 1024 });
  const blockSize = parseStat(stdout, "Block size");
  const blockCount = parseStat(stdout, "Block count");
  const freeBlocks = parseStat(stdout, "Free blocks");
  assert.ok(blockSize > 0 && blockSize % 512 === 0, "ext4 block size is invalid");
  assert.ok(blockCount > 0 && freeBlocks >= 0 && freeBlocks <= blockCount, "ext4 block counts are invalid");
  const logicalBytes = blockSize * blockCount;
  assert.equal(fileStat.size, logicalBytes, "image file is truncated or has a stale sparse logical size");
  const usedBlocks = blockCount - freeBlocks;
  assert.ok(usedBlocks > 0, "ext4 image contains no allocated blocks");
  return {
    logicalBytes,
    blockSize,
    blockCount,
    freeBlocks,
    usedBlocks,
    usedBytes: usedBlocks * blockSize,
    hostAllocatedBytes: Number.isSafeInteger(fileStat.blocks) ? fileStat.blocks * 512 : null,
  };
}

function parseStat(text, label) {
  const match = text.match(new RegExp(`^${label}:\\s+(\\d+)$`, "mu"));
  assert.ok(match, `debugfs did not report ${label}; image is not a readable ext4 filesystem`);
  return Number(match[1]);
}

async function runSelfTests({ buildA, buildB, baseChunks, desktopChunks, baseExt4, desktopExt4, chunks }) {
  const fixture = await mkdtemp(path.join(tmpdir(), "wasm-vm-e5-t17c-"));
  try {
    const touchedPackage = path.join(fixture, "MANIFEST-touched.txt");
    const touchedFiles = path.join(fixture, "FILE-MANIFEST-touched.txt");
    await writeFile(touchedPackage, await readFile(buildA.packageManifest.path));
    await writeFile(touchedFiles, await readFile(buildA.fileManifest.path));
    const old = new Date("2000-01-01T01:01:01Z");
    await utimes(touchedPackage, old, old);
    await utimes(touchedFiles, new Date("2035-05-05T05:05:05Z"), new Date("2035-05-05T05:05:05Z"));
    const touched = {
      packageManifest: { normalized: normalizePackageManifest(await readFile(touchedPackage, "utf8")) },
      fileManifest: { normalized: normalizeFileManifest(await readFile(touchedFiles, "utf8")) },
    };
    compareNormalized(buildA, touched);

    const packageMutant = (await readFile(buildA.packageManifest.path, "utf8")).replace(
      /^(.+?)(-r\d+)$/mu,
      "$1-r999",
    );
    const packageMutantBuild = {
      packageManifest: { normalized: normalizePackageManifest(packageMutant) },
      fileManifest: buildA.fileManifest,
    };
    assert.throws(() => compareNormalized(buildA, packageMutantBuild), /package manifest first difference/u);

    const fileLines = (await readFile(buildA.fileManifest.path, "utf8")).split(/\r?\n/u);
    const fileIndex = fileLines.findIndex((line) => SHA256.test(line.split(/\s+/u)[0] ?? ""));
    assert.ok(fileIndex >= 0, "self-test found no file content digest");
    const originalDigest = fileLines[fileIndex].split(/\s+/u)[0];
    fileLines[fileIndex] = `${originalDigest.slice(0, -1)}${originalDigest.endsWith("0") ? "1" : "0"}${fileLines[fileIndex].slice(originalDigest.length)}`;
    const fileMutantBuild = {
      packageManifest: buildA.packageManifest,
      fileManifest: { normalized: normalizeFileManifest(fileLines.join("\n")) },
    };
    assert.throws(() => compareNormalized(buildA, fileMutantBuild), /file manifest first difference/u);

    const missingBaseIndex = structuredClone(baseChunks.manifest);
    const reusedHash = chunks.reusedHashes[0];
    missingBaseIndex.chunks = missingBaseIndex.chunks.filter((hash) => hash !== reusedHash);
    assert.throws(
      () => validateChunkManifest(missingBaseIndex, baseExt4.logicalBytes),
      /position count is wrong/u,
      "base dedupe-index removal was accepted",
    );

    const sparse = path.join(fixture, "sparse.ext4");
    await writeFile(sparse, "");
    await truncate(sparse, desktopExt4.logicalBytes);
    await assert.rejects(
      () => inspectExt4Image(sparse),
      /debugfs did not report Block size|debugfs did not report Block count|not a readable ext4|image file is truncated/u,
      "a sparse non-filesystem image was accepted by the size check",
    );

    assert.notEqual(buildA.output, buildB.output, "self-test outputs must be distinct directories");
    process.stdout.write("E5T17C_SELF_TEST=touched-manifests-normalize-equal,package-content-mutation-rejected,config-content-mutation-rejected,base-dedupe-index-removal-rejected,sparse-image-rejected\n");
  } finally {
    await rm(fixture, { recursive: true, force: true });
  }
}

function argument(name) {
  const index = process.argv.indexOf(name);
  if (index < 0) return undefined;
  assert.ok(process.argv[index + 1] && !process.argv[index + 1].startsWith("--"), `${name} requires a path`);
  return process.argv[index + 1];
}
