#!/usr/bin/env node

// E5-T16e: repeat the selected Weston/pixman workload from two fresh copies of one clean,
// signed T16c image. The candidate-neutral T16a harness owns counter normalization; this driver
// owns the clean-copy binding and keeps each run's serial/GPU/evidence files separate.

import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { runDriver } from "./display-server-workload.mjs";

import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourceDir = path.join(repo, "target/e5-t16e/weston-image");
const sourceImage = path.join(sourceDir, "alpine-rootfs.ext4");
const sourceManifest = path.join(sourceDir, "MANIFEST.txt");
const sourceFileManifest = path.join(sourceDir, "FILE-MANIFEST.txt");
const runRoot = path.join(repo, "target/e5-t16e/reruns");
const evidenceRoot = path.join(repo, "evidence/e5-t16e");
const sha256File = async (file) => createHash("sha256").update(await readFile(file)).digest("hex");
const relative = (file) => path.relative(repo, file);
const runTimeoutMs = 30 * 60 * 1_000;
const { stdout: commitOutput } = await execFileAsync("git", ["rev-parse", "HEAD"], { cwd: repo });
const sourceCommit = commitOutput.trim();
assert.match(sourceCommit, /^[0-9a-f]{40}$/u, "reruns must bind to an exact git commit");

for (const file of [sourceImage, sourceManifest, sourceFileManifest]) {
  const fileStat = await stat(file);
  assert.ok(fileStat.size > 0, `missing clean T16e image input: ${file}`);
}
await mkdir(runRoot, { recursive: true });
await mkdir(evidenceRoot, { recursive: true });

const source = {
  commit: sourceCommit,
  image: { path: relative(sourceImage), sha256: await sha256File(sourceImage) },
  packageManifest: { path: relative(sourceManifest), sha256: await sha256File(sourceManifest) },
  fileManifest: { path: relative(sourceFileManifest), sha256: await sha256File(sourceFileManifest) },
  derivation: "fresh E5-T16c Weston scratch build, copied before each T16a workload replay",
};
const runs = [];

for (const ordinal of [1, 2]) {
  const id = `weston-rerun-${ordinal}`;
  const imageDir = path.join(runRoot, id);
  const image = path.join(imageDir, "alpine-rootfs.ext4");
  const manifest = path.join(imageDir, "MANIFEST.txt");
  const fileManifest = path.join(imageDir, "FILE-MANIFEST.txt");
  const runEvidenceDir = path.join(evidenceRoot, id);
  const capturePath = path.join(evidenceRoot, `${id}-capture.json`);
  await mkdir(imageDir, { recursive: true });
  await mkdir(runEvidenceDir, { recursive: true });
  await Promise.all([
    copyFile(sourceImage, image),
    copyFile(sourceManifest, manifest),
    copyFile(sourceFileManifest, fileManifest),
  ]);
  const imageSha256 = await sha256File(image);
  assert.equal(imageSha256, source.image.sha256, `${id}: clean-copy digest drifted before replay`);

  const capture = await runDriver({
    cwd: repo,
    imagePath: image,
    runner: ["node", "tools/run-weston-pixman.mjs"],
    outputPath: capturePath,
    timeoutMs: runTimeoutMs,
    env: {
      ...process.env,
      E5_T16C_EVIDENCE_DIR: relative(runEvidenceDir),
    },
  });
  assert.deepEqual(capture.candidate, {
    id: "weston-pixman",
    server: "drm",
    wm: "weston",
    terminal: "foot",
    renderer: "pixman",
    clipboard: "wl-clipboard",
  });
  const postRunSha256 = await sha256File(image);
  assert.notEqual(postRunSha256, imageSha256, `${id}: workload did not mutate runtime image state`);

  const artifactNames = [
    "weston-console.log",
    "weston-stderr.log",
    "weston-guest-evidence.txt",
    "weston-gpu-trace.log",
    "weston-run.json",
  ];
  const artifacts = {};
  for (const name of artifactNames) {
    const file = path.join(runEvidenceDir, name);
    await stat(file);
    artifacts[name] = { path: relative(file), sha256: await sha256File(file) };
  }
  runs.push({
    id,
    image: { path: relative(image), sha256: imageSha256, postRunSha256 },
    capture: { path: relative(capturePath), sha256: await sha256File(capturePath) },
    artifacts,
    summary: capture.summary,
  });
}

const output = {
  schema: "wasm-vm.e5-t16e.winner-reruns.v1",
  task: "E5-T16e",
  candidate: "weston-pixman",
  workload: "E5-T16a frozen six-phase workload",
  source,
  runCount: runs.length,
  runs,
};
const outputPath = path.join(evidenceRoot, "winner-reruns.json");
await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`);
process.stdout.write(`E5T16E_RERUNS=${JSON.stringify({
  output: relative(outputPath),
  sourceImageSha256: source.image.sha256,
  runs: runs.map((run) => ({ id: run.id, imageSha256: run.image.sha256, postRunSha256: run.image.postRunSha256 })),
})}\n`);
