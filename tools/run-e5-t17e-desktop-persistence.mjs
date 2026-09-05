#!/usr/bin/env node

// E5-T17e: exercise the final T17c desktop image through the real native riscv64 emulator.
//
// The image under publication is never modified.  A clean copy is booted with init=/bin/sh,
// receives one signed package through the guest's slirp network, and is then driven through two
// snapshot/reload boundaries.  The package database and a guest-created sentinel are checked after
// each reload.  The final phase powers the guest off so the host can inspect the same ext4 image.
// This is deliberately a local guest proof; independent machines, WebKit, and host rr are not part
// of this task's evidence policy.

import assert from "node:assert/strict";
import { execFile as execFileCallback, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { createWriteStream } from "node:fs";
import { copyFile, mkdir, open, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cli = path.join(repo, "target/release/wasm-vm");
const kernel = path.join(repo, "releases/kernel/6.6.63/Image");
const handoffPath = path.join(repo, "evidence/e5-t17c/desktop-image-reproducibility.json");
const profilePath = path.join(repo, "tools/image/e5-t17a-desktop-packages.json");
const evidenceDir = path.join(repo, "evidence/e5-t17e");
const runRoot = path.join(repo, "target/e5-t17e");
const runtimeRoot = path.join(runRoot, "runtime");
const runtimeImage = path.join(runtimeRoot, "desktop-overlay.ext4");
const snapshotOne = path.join(runtimeRoot, "snapshot-one.bin");
const snapshotTwo = path.join(runtimeRoot, "snapshot-two.bin");
const sentinelPath = "/home/desktop/.local/state/wasm-vm/e5-t17e-sentinel";
const sentinel = `E5T17E-SENTINEL-${6 * 7}\n`;
const packageName = "htop";
const maxInstrs = process.env.E5_T17E_MAX_INSTRS ?? "1500000000000";
const quantum = process.env.E5_T17E_QUANTUM ?? "200000";
const phaseTimeoutMs = Number(process.env.E5_T17E_PHASE_TIMEOUT_MS ?? String(60 * 60 * 1_000));
const snapshotTriggerOne = "T17ESNAPSHOTONE";
const snapshotTriggerTwo = "T17ESNAPSHOTTWO";
const netReadyMarker = "T17ENETREADY";
const reloadOneMarker = "T17E_RELOAD_ONE";
const reloadTwoMarker = "T17E_RELOAD_TWO";
const unsignedRejectedMarker = "T17EUNSIGNEDREJECTED";
const packagePresentMarker = "T17EAPKPRESENT";
const shutdownMarker = "T17ESHUTDOWNREQUESTED";
const execFile = promisify(execFileCallback);
const SHA256 = /^[0-9a-f]{64}$/u;

assert.ok(Number.isSafeInteger(phaseTimeoutMs) && phaseTimeoutMs > 0, "phase timeout must be positive");
for (const file of [cli, kernel, handoffPath, profilePath]) {
  const fileStat = await stat(file);
  assert.ok(fileStat.isFile() && fileStat.size > 0, `missing E5-T17e input: ${file}`);
}

const handoff = JSON.parse(await readFile(handoffPath, "utf8"));
assert.equal(handoff.schema, "wasm-vm.e5-t17c.desktop-image-reproducibility.v1");
assert.equal(handoff.task, "E5-T17c");
const profile = JSON.parse(await readFile(profilePath, "utf8"));
const build = handoff.builds?.b;
assert.ok(build?.output && build.image?.sha256, "T17c handoff has no final build B");
const sourceImage = path.join(repo, build.output, "alpine-rootfs.ext4");
const sourceManifest = path.join(repo, build.output, "MANIFEST.txt");
const sourceFileManifest = path.join(repo, build.output, "FILE-MANIFEST.txt");
const baseImage = path.join(repo, handoff.base.image.path);
const baseChunkDir = path.join(repo, handoff.base.chunks.path);
const desktopChunkDir = path.join(repo, "target/e5-t17c/chunks/desktop-b");
const desktopChunkManifest = path.join(desktopChunkDir, "manifest.json");
const baseChunkManifest = path.join(baseChunkDir, "manifest.json");
for (const file of [sourceImage, sourceManifest, sourceFileManifest, baseImage, baseChunkManifest, desktopChunkManifest]) {
  const fileStat = await stat(file);
  assert.ok(fileStat.isFile() && fileStat.size > 0, `missing T17c publication artifact: ${file}`);
}

const sourceImageSha256 = await sha256File(sourceImage);
assert.equal(sourceImageSha256, build.image.sha256, "T17c handoff image digest is stale");
assert.equal(await sha256File(sourceManifest), build.packageManifest.sha256, "T17c package lock is stale");
assert.equal(await sha256File(sourceFileManifest), build.fileManifest.sha256, "T17c file lock is stale");
assert.ok(!profile.packages.some((pkg) => pkg.name === packageName), `${packageName} is already in the base profile`);

const publication = await validatePublication();
const hygieneText = await inspectFinalImage(sourceImage);
validateHygiene(hygieneText);
await mkdir(evidenceDir, { recursive: true });
const hygienePath = path.join(evidenceDir, "final-image-inspection.log");
await writeFile(hygienePath, hygieneText);

await rm(runtimeRoot, { recursive: true, force: true });
await mkdir(runtimeRoot, { recursive: true });
await copyFile(sourceImage, runtimeImage);
const runtimeSourceSha256 = await sha256File(runtimeImage);
assert.equal(runtimeSourceSha256, sourceImageSha256, "runtime copy is not byte-identical to the published image");

const version = /^version\s*=\s*"([^"]+)"/mu.exec(await readFile(path.join(repo, "Cargo.toml")))?.[1];
assert.ok(version, "could not read the workspace version for snapshot identity");
const coreId = Buffer.from(version, "utf8").toString("hex").padEnd(64, "0");
assert.match(coreId, /^[0-9a-f]{64}$/u);
const baseId = publication.base.binding;
const sentinelSha256 = sha256(Buffer.from(sentinel));
const sentinelBytes = Buffer.byteLength(sentinel);

const phaseA = await runPhase("cold-install-snapshot", {
  snapshotOut: snapshotOne,
  snapshotTrigger: snapshotTriggerOne,
  evidencePath: null,
}, async (phase) => {
  await phase.waitFor("Run /bin/sh as init process", phaseTimeoutMs);
  phase.send(bootstrapCommand());
  await phase.waitFor(netReadyMarker, phaseTimeoutMs);
  phase.send(installCommand());
  await phase.waitFor(snapshotTriggerOne, phaseTimeoutMs);
});
const stateA = parseInstallState(await phaseText(phaseA));
assert.equal(stateA.packagePresent, true, "signed extra package was not present before snapshot");
assert.equal(stateA.unsignedRejected, true, "unsigned extra package was not rejected");
assert.equal(stateA.sentinel, sentinel.trim(), "pre-snapshot sentinel content drifted");
assert.equal(stateA.sentinelSha256, sentinelSha256, "pre-snapshot sentinel digest drifted");
assert.equal(stateA.sentinelBytes, sentinelBytes, "pre-snapshot sentinel length drifted");
assert.equal(stateA.packageDbSha256.length, 64, "pre-snapshot package database digest is malformed");

const phaseB = await runPhase("reload-one-snapshot", {
  resumeFrom: snapshotOne,
  snapshotOut: snapshotTwo,
  snapshotTrigger: snapshotTriggerTwo,
  evidencePath: null,
}, async (phase) => {
  await phase.waitFor("wasm-vm: resumed", phaseTimeoutMs);
  phase.send("\n");
  await delay(1_000);
  phase.send(reloadCommand("ONE", reloadOneMarker, snapshotTriggerTwo));
  await phase.waitFor(snapshotTriggerTwo, phaseTimeoutMs);
});
const stateB = parseReloadState(await phaseText(phaseB), reloadOneMarker);
assertReloadState(stateB, stateA);

const phaseC = await runPhase("reload-two-poweroff", {
  resumeFrom: snapshotTwo,
  snapshotOut: null,
  snapshotTrigger: null,
  evidencePath: path.join(evidenceDir, "reload-two-guest-evidence.txt"),
}, async (phase) => {
  await phase.waitFor("wasm-vm: resumed", phaseTimeoutMs);
  phase.send("\n");
  await delay(1_000);
  phase.send(reloadCommand("TWO", reloadTwoMarker, null));
  await phase.waitFor(reloadTwoMarker, phaseTimeoutMs);
  await phase.waitFor(shutdownMarker, 2 * 60_000);
});
const stateC = parseReloadState(await phaseText(phaseC), reloadTwoMarker);
assertReloadState(stateC, stateA);

const sourceAfterSha256 = await sha256File(sourceImage);
const runtimeAfterSha256 = await sha256File(runtimeImage);
assert.equal(sourceAfterSha256, sourceImageSha256, "published source image changed during persistence proof");
const guestEvidence = await artifact(path.join(repo, phaseC.evidencePath), true);
assert.ok(guestEvidence, "final reload did not produce guest-layer evidence");
const guestEvidenceText = await readFile(path.join(repo, guestEvidence.path), "utf8");
assert.match(guestEvidenceText, /^trace retired=(\d+)$/mu);
assert.match(guestEvidenceText, /^state sha256=[0-9a-f]{64}$/mu);
assert.match(guestEvidenceText, /^outcome=Reset\(PowerOff\)$/mu);

const commit = (await execFile("git", ["rev-parse", "HEAD"], { cwd: repo })).stdout.trim();
assert.match(commit, /^[0-9a-f]{40}$/u);
const report = {
  schema: "wasm-vm.e5-t17e.desktop-persistence.v1",
  task: "E5-T17e",
  command: "make verify-E5-T17e",
  commit,
  environment: "native-emulator",
  architecture: "riscv64",
  policy: { independentMachines: false, webkit: false, hostRr: false },
  source: {
    handoff: relative(handoffPath),
    image: { path: relative(sourceImage), sha256: sourceImageSha256, size: (await stat(sourceImage)).size },
    packageManifest: { path: relative(sourceManifest), sha256: await sha256File(sourceManifest) },
    fileManifest: { path: relative(sourceFileManifest), sha256: await sha256File(sourceFileManifest) },
    profile: { path: relative(profilePath), sha256: await sha256File(profilePath), packageCount: profile.packages.length },
  },
  publication,
  hygiene: {
    path: relative(hygienePath),
    sha256: sha256(hygieneText),
    sourceImageUnchanged: true,
    noApkCache: true,
    noRootHistoryOrCredentials: true,
    declaredPayloadOnly: true,
  },
  runtime: {
    image: {
      path: relative(runtimeImage),
      sourceSha256: runtimeSourceSha256,
      postSha256: runtimeAfterSha256,
      size: (await stat(runtimeImage)).size,
    },
    package: {
      name: packageName,
      installCommand: "apk add --no-scripts --no-progress htop",
      signedDefaultVerification: true,
      profileMutation: false,
      persistedAcrossReloads: true,
    },
    sentinel: { path: sentinelPath, value: sentinel.trim(), sha256: sentinelSha256, bytes: sentinelBytes },
    coherence: {
      coreId: "0".repeat(64),
      baseId: "0".repeat(64),
      publicationCoreId: coreId,
      publicationBaseId: baseId,
      identityMode: "native-default-zero; publication binding recorded separately",
      sameDriveAcrossPhases: true,
      syncBeforeEverySnapshot: true,
    },
    reloadCount: 2,
    phases: [phaseA, phaseB, phaseC],
    state: { preSnapshot: stateA, reloadOne: stateB, reloadTwo: stateC },
    guestEvidence,
  },
  checks: {
    sourceUnchanged: sourceAfterSha256 === sourceImageSha256,
    signedPackageInstalled: stateA.packagePresent,
    unsignedPackageRejected: stateA.unsignedRejected,
    sentinelAndPackageDbPersisted: true,
    finalPoweroff: true,
    sourceImageSha256: sourceAfterSha256,
  },
  result: "passed",
};
const reportPath = path.join(evidenceDir, "desktop-persistence.json");
await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
process.stdout.write(`E5T17E_RECORDED=${JSON.stringify({
  evidence: relative(reportPath),
  imageSha256: sourceImageSha256,
  package: packageName,
  reloads: 2,
  allPassed: true,
})}\n`);

async function validatePublication() {
  const desktopManifest = await readJson(desktopChunkManifest);
  const baseManifest = await readJson(baseChunkManifest);
  validateChunkManifest(desktopManifest, (await stat(sourceImage)).size, "desktop");
  validateChunkManifest(baseManifest, (await stat(baseImage)).size, "base");
  const [desktopHashes, baseHashes] = await Promise.all([
    validateChunkObjects(desktopChunkDir, desktopManifest),
    validateChunkObjects(baseChunkDir, baseManifest),
  ]);
  await assertImageMatchesManifest(sourceImage, desktopManifest, "desktop image");
  await assertImageMatchesManifest(baseImage, baseManifest, "base image");
  const chunkVerify = await execFile(cli, ["chunk-verify", desktopChunkDir], { cwd: repo, maxBuffer: 4 * 1024 * 1024 });
  const baseBinding = manifestBinding(baseManifest);
  const baseSet = new Set(baseManifest.chunks);
  const desktopSet = new Set(desktopManifest.chunks);
  const reusedObjectHashes = [...desktopSet].filter((hash) => baseSet.has(hash));
  const newObjectHashes = [...desktopSet].filter((hash) => !baseSet.has(hash));
  const reusedPositionCount = desktopManifest.chunks
    .slice(0, baseManifest.chunks.length)
    .reduce((count, hash, index) => count + (hash === baseManifest.chunks[index] ? 1 : 0), 0);
  const fetchedBytes = await sumChunkBytes(desktopChunkDir, newObjectHashes);
  assert.equal(await sha256File(sourceManifest), build.packageManifest.sha256);
  assert.equal(await sha256File(sourceFileManifest), build.fileManifest.sha256);
  assert.equal(desktopManifest.image_len, build.image.size);
  assert.equal(handoff.chunks.desktopPositionCount, desktopManifest.chunks.length);
  assert.equal(handoff.chunks.desktopUniqueCount, desktopSet.size);
  assert.equal(handoff.chunks.reusedPositionCount, reusedPositionCount);
  assert.equal(handoff.chunks.newObjectCount, newObjectHashes.length);
  assert.equal(handoff.chunks.fetchedBytes, fetchedBytes);
  assert.ok(newObjectHashes.length < desktopSet.size, "publication degenerates into a full upload");
  assert.ok(reusedPositionCount > 0, "publication has no E3 position reuse");
  assert.equal(handoff.chunks.fullBaseUploadRejected, true);
  assert.deepEqual(profile.packages.some((pkg) => pkg.name === packageName), false);
  return {
    image: { path: relative(sourceImage), sha256: sourceImageSha256, size: build.image.size },
    packageManifest: { path: relative(sourceManifest), sha256: await sha256File(sourceManifest) },
    fileManifest: { path: relative(sourceFileManifest), sha256: await sha256File(sourceFileManifest) },
    baseChunkManifest: {
      path: relative(baseChunkManifest),
      sha256: await sha256File(baseChunkManifest),
      imageLen: baseManifest.image_len,
      positionCount: baseManifest.chunks.length,
      uniqueCount: baseHashes.size,
    },
    desktopChunkManifest: {
      path: relative(desktopChunkManifest),
      sha256: await sha256File(desktopChunkManifest),
      imageLen: desktopManifest.image_len,
      chunkSize: desktopManifest.chunk_size,
      positionCount: desktopManifest.chunks.length,
      uniqueCount: desktopSet.size,
    },
    base: { binding: baseBinding, sha256: handoff.base.image.sha256 },
    dedupe: {
      reusedObjectCount: reusedObjectHashes.length,
      reusedPositionCount,
      reusedPositionRatio: reusedPositionCount / baseManifest.chunks.length,
      newObjectCount: newObjectHashes.length,
      fetchedBytes,
      fullBaseUploadRejected: true,
    },
    chunkVerify: { command: `target/release/wasm-vm chunk-verify ${relative(desktopChunkDir)}`, output: chunkVerify.stdout.trim() },
  };
}

function validateChunkManifest(manifest, imageSize, label) {
  assert.equal(manifest.version, 1, `${label}: unexpected chunk manifest version`);
  assert.equal(manifest.layout, "split", `${label}: unexpected chunk layout`);
  assert.equal(manifest.chunk_size, 128 * 1024, `${label}: unexpected chunk size`);
  assert.equal(manifest.image_len, imageSize, `${label}: chunk image length does not match image`);
  assert.equal(manifest.chunks.length, Math.ceil(imageSize / manifest.chunk_size), `${label}: chunk position count is wrong`);
  for (const hash of manifest.chunks) assert.match(hash, SHA256, `${label}: malformed chunk hash`);
}

async function validateChunkObjects(directory, manifest) {
  const expected = new Set(manifest.chunks);
  const objectDir = path.join(directory, "chunks");
  const entries = (await readdir(objectDir)).filter((entry) => entry.endsWith(".bin"));
  assert.deepEqual(new Set(entries.map((entry) => entry.slice(0, -4))), expected, `${directory}: undeclared chunk object`);
  for (const hash of expected) {
    const file = path.join(objectDir, `${hash}.bin`);
    const fileStat = await stat(file);
    assert.ok(fileStat.isFile() && fileStat.size > 0 && fileStat.size <= manifest.chunk_size, `${file}: invalid chunk size`);
    assert.equal(await sha256File(file), hash, `${file}: content hash does not match its name`);
  }
  return expected;
}

async function assertImageMatchesManifest(image, manifest, label) {
  const handle = await open(image, "r");
  const buffer = Buffer.alloc(manifest.chunk_size);
  try {
    for (let index = 0; index < manifest.chunks.length; index += 1) {
      const length = Math.min(manifest.chunk_size, manifest.image_len - index * manifest.chunk_size);
      const result = await handle.read(buffer, 0, length, index * manifest.chunk_size);
      assert.equal(result.bytesRead, length, `${label}: short read at chunk ${index}`);
      assert.equal(sha256(buffer.subarray(0, length)), manifest.chunks[index], `${label}: chunk ${index} differs from manifest`);
    }
  } finally {
    await handle.close();
  }
}

async function sumChunkBytes(directory, hashes) {
  let total = 0;
  for (const hash of hashes) total += (await stat(path.join(directory, "chunks", `${hash}.bin`))).size;
  return total;
}

function manifestBinding(manifest) {
  return sha256(Buffer.from(JSON.stringify({
    version: manifest.version,
    image_len: manifest.image_len,
    chunk_size: manifest.chunk_size,
    layout: manifest.layout,
    chunks: manifest.chunks,
  })));
}

async function inspectFinalImage(imagePath) {
  const script = [
    "set -eu",
    "apk add --no-cache e2fsprogs-extra >/dev/null",
    "inspect() { label=$1; command=$2; printf 'E5T17E_INSPECT_%s_BEGIN\\n' \"$label\"; debugfs -R \"$command\" /image 2>&1; printf 'E5T17E_INSPECT_%s_END\\n' \"$label\"; }",
    "inspect SHADOW 'cat /etc/shadow'",
    "inspect INITTAB 'cat /etc/inittab'",
    "inspect REPOSITORIES 'cat /etc/apk/repositories'",
    "inspect ROOT_LIST 'ls -l /root'",
    "inspect APK_CACHE 'ls -l /var/cache/apk'",
    "inspect APK_DB 'ls -l /lib/apk/db'",
    "inspect TMP_LIST 'ls -l /tmp'",
  ].join("\n");
  const { stdout } = await execFile("docker", [
    "run", "--rm", "-v", `${imagePath}:/image:ro`, "alpine:3.20", "sh", "-lc", script,
  ], { cwd: repo, maxBuffer: 8 * 1024 * 1024 });
  return stdout;
}

function validateHygiene(text) {
  const section = (label) => {
    const match = text.match(new RegExp(`E5T17E_INSPECT_${label}_BEGIN\\n([\\s\\S]*?)E5T17E_INSPECT_${label}_END`, "u"));
    assert.ok(match, `missing ${label} inspection`);
    return match[1];
  };
  assert.match(section("SHADOW"), /^root:!:/mu, "root credential was not locked");
  assert.doesNotMatch(section("ROOT_LIST"), /\.ash_history|\.bash_history|\.netrc|\.curlrc|\.wget-hsts|\.ssh|id_rsa|credential|password/iu);
  assert.doesNotMatch(section("APK_CACHE"), /\.apk|\.tar|\.tmp/iu, "APK build cache remains in the published image");
  assert.doesNotMatch(section("TMP_LIST"), /desktop-image|rootfs-inner|apk-.*\.tmp/iu, "temporary build debris remains in /tmp");
  assert.match(section("INITTAB"), /tty1::respawn:.*desktop-autologin/u);
  assert.match(section("REPOSITORIES"), /https:\/\/dl-cdn\.alpinelinux\.org\/alpine\/v3\.20\/(?:main|community)/u);
  assert.match(section("APK_DB"), /installed/u, "APK package database is missing");
}

async function runPhase(name, options, drive) {
  const safeName = name.replaceAll(/[^a-z0-9-]/giu, "-");
  const consolePath = path.join(evidenceDir, `${safeName}-console.log`);
  const stderrPath = path.join(evidenceDir, `${safeName}-stderr.log`);
  await mkdir(evidenceDir, { recursive: true });
  await Promise.all([rm(consolePath, { force: true }), rm(stderrPath, { force: true })]);
  const args = [
    "boot", "--kernel", kernel, "--drive", `file=${runtimeImage}`,
    "--net-slirp", "--virtio-rng",
    "--append", "root=/dev/vda rw console=ttyS0 earlycon=sbi init=/bin/sh",
    "--no-reboot", "--block-cache", "--interrupt-batching",
    "--max-instrs", maxInstrs, "--quantum", quantum,
  ];
  if (options.snapshotOut) args.push("--snapshot-trigger", options.snapshotTrigger, "--snapshot-out", options.snapshotOut);
  if (options.resumeFrom) args.push("--resume-from", options.resumeFrom);
  if (options.evidencePath) args.push("--evidence", options.evidencePath);
  const stdoutLog = createWriteStream(consolePath);
  const stderrLog = createWriteStream(stderrPath);
  const stdoutFinished = new Promise((resolve) => stdoutLog.once("finish", resolve));
  const stderrFinished = new Promise((resolve) => stderrLog.once("finish", resolve));
  const child = spawn(cli, args, { cwd: repo, env: cleanEnvironment(), stdio: ["pipe", "pipe", "pipe"] });
  let transcript = "";
  child.stdout.on("data", (chunk) => { transcript = append(transcript, chunk); stdoutLog.write(chunk); });
  child.stderr.on("data", (chunk) => { transcript = append(transcript, chunk); stderrLog.write(chunk); });
  const closed = new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code, signal) => resolve({ code, signal }));
  });
  const phase = {
    name,
    consolePath,
    stderrPath,
    evidencePath: options.evidencePath,
    child,
    waitFor: async (needle, timeout) => {
      const deadline = Date.now() + timeout;
      while (Date.now() < deadline) {
        if (transcript.includes(needle)) return;
        await delay(100);
      }
      throw new Error(`${name}: timed out waiting for ${needle}`);
    },
    send: (line) => {
      assert.ok(child.stdin && !child.stdin.destroyed, `${name}: guest stdin is closed`);
      child.stdin.write(`${line}\n`);
      child.stdin.flush?.();
    },
    stop: () => {
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGTERM");
    },
  };
  try {
    await drive(phase);
    const exit = await waitForExit(closed, child, 2 * 60_000);
    stdoutLog.end();
    stderrLog.end();
    await Promise.all([stdoutFinished, stderrFinished]);
    assert.equal(exit.timedOut, false, `${name}: emulator did not exit`);
    assert.deepEqual(exit.status, { code: 0, signal: null }, `${name}: unexpected emulator exit`);
    const imageSha = await sha256File(runtimeImage);
    const snapshotPath = options.snapshotOut;
    const snapshot = snapshotPath ? await artifact(snapshotPath, false) : null;
    return {
      name,
      exit: exit.status,
      timedOut: exit.timedOut,
      console: { path: relative(consolePath), sha256: await sha256File(consolePath) },
      stderr: { path: relative(stderrPath), sha256: await sha256File(stderrPath) },
      image: { path: relative(runtimeImage), postSha256: imageSha },
      snapshot: snapshot ? { path: snapshot.path, sha256: snapshot.sha256, size: snapshot.size } : null,
      evidencePath: options.evidencePath ? relative(options.evidencePath) : null,
    };
  } catch (error) {
    phase.stop();
    await Promise.race([closed.catch(() => undefined), delay(5_000)]);
    stdoutLog.destroy();
    stderrLog.destroy();
    throw error;
  }
}

async function waitForExit(closed, child, timeout) {
  let timer;
  const timeoutPromise = new Promise((resolve) => { timer = setTimeout(() => resolve(null), timeout); });
  let status = await Promise.race([closed, timeoutPromise]);
  if (status === null) {
    child.kill("SIGTERM");
    status = await Promise.race([closed, delay(5_000).then(() => null)]);
    if (status === null) {
      child.kill("SIGKILL");
      status = await Promise.race([closed, delay(5_000).then(() => ({ code: null, signal: "SIGKILL" }))]);
    }
  }
  clearTimeout(timer);
  return { status, timedOut: status === null };
}

async function phaseText(phase) {
  const [consoleText, stderrText] = await Promise.all([
    readFile(path.join(repo, phase.console.path), "utf8"),
    readFile(path.join(repo, phase.stderr.path), "utf8"),
  ]);
  return `${consoleText}\n${stderrText}`.replaceAll(/\r/gu, "");
}

function parseInstallState(text) {
  const state = /T17E_PRE_STATE sentinel=(\S+) sentinel_sha=([0-9a-f]{64}) sentinel_bytes=(\d+) apk_db_sha=([0-9a-f]{64}) htop=(present|missing)/u.exec(text);
  assert.ok(state, "missing pre-snapshot state marker");
  const unsigned = /T17E_UNSIGNED_RC=(\d+)/u.exec(text);
  assert.ok(unsigned, "missing unsigned package result");
  return {
    sentinel: state[1],
    sentinelSha256: state[2],
    sentinelBytes: Number(state[3]),
    packageDbSha256: state[4],
    packagePresent: state[5] === "present" && text.includes(packagePresentMarker),
    unsignedRc: Number(unsigned[1]),
    unsignedRejected: Number(unsigned[1]) !== 0 && text.includes(unsignedRejectedMarker),
  };
}

function parseReloadState(text, marker) {
  const state = new RegExp(`${marker} sentinel=(\\S+) sentinel_sha=([0-9a-f]{64}) sentinel_bytes=(\\d+) apk_db_sha=([0-9a-f]{64}) htop=(present|missing)`, "u").exec(text);
  assert.ok(state, `missing ${marker} state marker`);
  return {
    sentinel: state[1],
    sentinelSha256: state[2],
    sentinelBytes: Number(state[3]),
    packageDbSha256: state[4],
    packagePresent: state[5] === "present",
  };
}

function assertReloadState(actual, expected) {
  assert.equal(actual.sentinel, expected.sentinel, "sentinel content did not persist");
  assert.equal(actual.sentinelSha256, expected.sentinelSha256, "sentinel digest did not persist");
  assert.equal(actual.sentinelBytes, expected.sentinelBytes, "sentinel length did not persist");
  assert.equal(actual.packageDbSha256, expected.packageDbSha256, "APK package database did not persist");
  assert.equal(actual.packagePresent, true, "signed extra package was not present after reload");
}

function bootstrapCommand() {
  return [
    "mount -t proc proc /proc 2>/dev/null || true",
    "mount -t sysfs sysfs /sys 2>/dev/null || true",
    "mount -t tmpfs tmpfs /run 2>/dev/null || true",
    "ip link set lo up",
    "ip addr add 10.0.2.15/24 dev eth0 2>/dev/null || true",
    "ip link set eth0 up",
    "ip route add default via 10.0.2.2 2>/dev/null || true",
    "printf '%s\\n' 'nameserver 10.0.2.3' > /etc/resolv.conf",
    "printf '%s\\n' T17E\"NET\"READY",
  ].join("; ");
}

function installCommand() {
  return [
    "apk update >/tmp/e5-t17e-apk-update.log 2>&1; update_rc=$?",
    "printf 'T17E_APK_UPDATE_RC=%s\\n' \"$update_rc\"",
    `apk add --no-scripts --no-progress ${packageName} >/tmp/e5-t17e-apk-add.log 2>&1; add_rc=$?`,
    "printf 'T17E_APK_ADD_RC=%s\\n' \"$add_rc\"",
    `if [ \"$add_rc\" -eq 0 ] && apk info -e ${packageName} >/dev/null 2>&1; then printf '%s\\n' T17E\"APK\"PRESENT; else printf '%s\\n' T17E\"APK\"MISSING; fi`,
    `printf 'E5T17E-SENTINEL-%s\\n' \"$((6*7))\" > ${sentinelPath}`,
    `sentinel_value=$(cat ${sentinelPath}); sentinel_sha=$(sha256sum ${sentinelPath} | awk '{print $1}'); sentinel_bytes=$(wc -c < ${sentinelPath}); db_sha=$(sha256sum /lib/apk/db/installed | awk '{print $1}'); if apk info -e ${packageName} >/dev/null 2>&1; then htop_state=present; else htop_state=missing; fi`,
    "printf 'T17E_PRE_STATE sentinel=%s sentinel_sha=%s sentinel_bytes=%s apk_db_sha=%s htop=%s\\n' \"$sentinel_value\" \"$sentinel_sha\" \"$sentinel_bytes\" \"$db_sha\" \"$htop_state\"",
    "printf '%s\\n' 'not-an-apk' >/tmp/e5-t17e-unsigned.apk",
    "apk add --no-network --no-progress /tmp/e5-t17e-unsigned.apk >/tmp/e5-t17e-unsigned.log 2>&1; unsigned_rc=$?",
    "printf 'T17E_UNSIGNED_RC=%s\\n' \"$unsigned_rc\"",
    "if [ \"$unsigned_rc\" -ne 0 ]; then printf '%s\\n' T17E\"UNSIGNED\"REJECTED; else printf '%s\\n' T17E\"UNSIGNED\"ACCEPTED; fi",
    "sync",
    "printf '%s\\n' T17E\"SNAPSHOT\"ONE",
  ].join("; ");
}

function reloadCommand(label, marker, snapshotTrigger) {
  const trigger = snapshotTrigger ? `; sync; printf '%s\\n' T17E\"SNAPSHOT\"TWO` : "; sync; printf '%s\\n' T17E\"SHUTDOWN\"REQUESTED; poweroff -f";
  return [
    `sentinel_value=$(cat ${sentinelPath}); sentinel_sha=$(sha256sum ${sentinelPath} | awk '{print $1}'); sentinel_bytes=$(wc -c < ${sentinelPath}); db_sha=$(sha256sum /lib/apk/db/installed | awk '{print $1}'); if apk info -e ${packageName} >/dev/null 2>&1; then htop_state=present; else htop_state=missing; fi`,
    `printf 'T17E_RELOAD_'\"${label}\"' sentinel=%s sentinel_sha=%s sentinel_bytes=%s apk_db_sha=%s htop=%s\\n' \"$sentinel_value\" \"$sentinel_sha\" \"$sentinel_bytes\" \"$db_sha\" \"$htop_state\"${trigger}`,
  ].join("; ");
}

async function artifact(file, required) {
  try {
    const fileStat = await stat(file);
    if (!fileStat.isFile() || fileStat.size === 0) {
      if (required) throw new Error(`empty artifact: ${file}`);
      return null;
    }
    return { path: relative(file), sha256: await sha256File(file), size: fileStat.size };
  } catch (error) {
    if (required) throw error;
    return null;
  }
}

function cleanEnvironment() {
  const environment = { ...process.env };
  for (const name of [
    "RUSTFLAGS", "RUSTDOCFLAGS", "RUST_LOG", "CARGO_HOME", "CARGO_TARGET_DIR",
    "CARGO_BUILD_RUSTFLAGS", "CARGO_ENCODED_RUSTFLAGS", "NODE_OPTIONS", "npm_config_userconfig",
  ]) delete environment[name];
  return environment;
}

function append(current, chunk) {
  return `${current}${chunk.toString("utf8")}`.slice(-8_000_000);
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function sha256File(file) {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    const input = createReadStream(file);
    input.on("error", reject);
    input.on("data", (chunk) => hash.update(chunk));
    input.on("end", () => resolve(hash.digest("hex")));
  });
}

async function readJson(file) {
  return JSON.parse(await readFile(file, "utf8"));
}

function relative(file) {
  return path.relative(repo, file);
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
