#!/usr/bin/env node

// E5-T17e verifier.  It treats the worker's serial transcript and publication record as
// untrusted evidence: hashes are recomputed, the published chunk objects are checked against the
// actual images, the final image is inspected through Docker/debugfs, and every reload marker is
// reparsed.  The verifier is intentionally local and guest-focused; independent machines, WebKit,
// and host rr are outside the current evidence policy.

import assert from "node:assert/strict";
import { execFile as execFileCallback } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { open, readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const cli = path.join(repo, "target/release/wasm-vm");
const evidencePath = path.resolve(repo, argument("--evidence") ?? process.env.E5_T17E_EVIDENCE ?? "evidence/e5-t17e/desktop-persistence.json");
const packageName = "htop";
const expectedSentinel = "E5T17E-SENTINEL-42";
const expectedSentinelSha256 = sha256(Buffer.from(`${expectedSentinel}\n`));
const expectedSentinelBytes = Buffer.byteLength(`${expectedSentinel}\n`);
const SHA256 = /^[0-9a-f]{64}$/u;
const execFile = promisify(execFileCallback);

const report = await readJson(evidencePath);
validateShape(report);
const source = await validateSource(report.source);
const publication = await validatePublication(report.publication, source);
await validateHygieneArtifact(report.hygiene, source.image.path);
await validateRuntime(report.runtime, report, source, publication);

if (process.argv.includes("--self-test")) {
  await runSelfTests(report, publication);
  process.stdout.write("E5T17E_SELF_TEST=chunk-manifest-mutation-rejected,full-upload-rejected,sentinel-truncation-rejected,unsigned-acceptance-rejected,hygiene-mutation-rejected\n");
}

process.stdout.write(`E5T17E_VERIFIED=${JSON.stringify({
  evidence: path.relative(repo, evidencePath),
  imageSha256: source.image.sha256,
  package: packageName,
  reloads: report.runtime.reloadCount,
  allPassed: true,
})}\n`);

function validateShape(value) {
  assert.equal(value.schema, "wasm-vm.e5-t17e.desktop-persistence.v1");
  assert.equal(value.task, "E5-T17e");
  assert.equal(value.command, "make verify-E5-T17e");
  assert.equal(value.environment, "native-emulator");
  assert.equal(value.architecture, "riscv64");
  assert.deepEqual(value.policy, { independentMachines: false, webkit: false, hostRr: false });
  assert.equal(value.result, "passed");
  assert.equal(value.runtime?.reloadCount, 2);
  assert.deepEqual(value.checks, {
    sourceUnchanged: true,
    signedPackageInstalled: true,
    unsignedPackageRejected: true,
    sentinelAndPackageDbPersisted: true,
    finalPoweroff: true,
    sourceImageSha256: value.source?.image?.sha256,
  });
}

async function validateSource(value) {
  assert.equal(value.handoff, "evidence/e5-t17c/desktop-image-reproducibility.json");
  assert.equal(value.image.path, "target/e5-t17c/repro-b/alpine-rootfs.ext4");
  assert.equal(value.packageManifest.path, "target/e5-t17c/repro-b/MANIFEST.txt");
  assert.equal(value.fileManifest.path, "target/e5-t17c/repro-b/FILE-MANIFEST.txt");
  assert.equal(value.profile.path, "tools/image/e5-t17a-desktop-packages.json");
  const handoff = await readJson(resolve(value.handoff));
  assert.equal(handoff.schema, "wasm-vm.e5-t17c.desktop-image-reproducibility.v1");
  assert.equal(handoff.builds.b.image.sha256, value.image.sha256);
  assert.equal(handoff.builds.b.image.size, value.image.size);
  assert.equal(handoff.builds.b.packageManifest.sha256, value.packageManifest.sha256);
  assert.equal(handoff.builds.b.fileManifest.sha256, value.fileManifest.sha256);
  for (const artifact of [value.image, value.packageManifest, value.fileManifest, value.profile]) {
    const file = resolve(artifact.path);
    const fileStat = await stat(file);
    assert.ok(fileStat.isFile() && fileStat.size > 0, `missing source artifact: ${artifact.path}`);
    assert.equal(await digestFile(file), artifact.sha256, `stale source artifact: ${artifact.path}`);
  }
  const profile = await readJson(resolve(value.profile.path));
  const packageManifest = await readFile(resolve(value.packageManifest.path), "utf8");
  assert.doesNotMatch(packageManifest, /--allow-untrusted/u, "base package manifest contains an untrusted install path");
  assert.doesNotMatch(packageManifest, new RegExp(`^${packageName}(?:-|$)`, "mu"), "overlay package leaked into base profile");
  for (const pkg of profile.packages) assert.match(packageManifest, new RegExp(`^${escapeRegExp(pkg.packageId)}$`, "mu"));
  assert.equal(value.image.size, 1024 * 1024 * 1024);
  return {
    handoff,
    image: { path: resolve(value.image.path), sha256: value.image.sha256, size: value.image.size },
    packageManifest: resolve(value.packageManifest.path),
    fileManifest: resolve(value.fileManifest.path),
    profile: resolve(value.profile.path),
  };
}

async function validatePublication(value, source) {
  assert.deepEqual(value.image, { path: path.relative(repo, source.image.path), sha256: source.image.sha256, size: source.image.size });
  assert.equal(value.packageManifest.path, path.relative(repo, source.packageManifest));
  assert.equal(value.fileManifest.path, path.relative(repo, source.fileManifest));
  const desktopManifestPath = resolve(value.desktopChunkManifest.path);
  const baseManifestPath = resolve(value.baseChunkManifest.path);
  const desktopManifest = await readJson(desktopManifestPath);
  const baseManifest = await readJson(baseManifestPath);
  const baseImagePath = resolve(source.handoff.base.image.path);
  validateChunkManifest(desktopManifest, source.image.size, "desktop");
  validateChunkManifest(baseManifest, source.handoff.base.image.size, "base");
  const [desktopHashes, baseHashes] = await Promise.all([
    validateChunkObjects(path.dirname(desktopManifestPath), desktopManifest),
    validateChunkObjects(path.dirname(baseManifestPath), baseManifest),
  ]);
  await assertImageMatchesManifest(source.image.path, desktopManifest, "desktop image");
  await assertImageMatchesManifest(baseImagePath, baseManifest, "base image");
  assert.equal(await digestFile(desktopManifestPath), value.desktopChunkManifest.sha256, "desktop chunk manifest digest is stale");
  assert.equal(await digestFile(baseManifestPath), value.baseChunkManifest.sha256, "base chunk manifest digest is stale");
  assert.equal(await digestFile(source.packageManifest), value.packageManifest.sha256, "published package digest is stale");
  assert.equal(await digestFile(source.fileManifest), value.fileManifest.sha256, "published file digest is stale");
  assert.equal(value.base.binding, manifestBinding(baseManifest), "snapshot base binding does not match E3 manifest");
  assert.equal(value.base.sha256, source.handoff.base.image.sha256);
  assert.equal(value.desktopChunkManifest.imageLen, desktopManifest.image_len);
  assert.equal(value.desktopChunkManifest.chunkSize, desktopManifest.chunk_size);
  assert.equal(value.desktopChunkManifest.positionCount, desktopManifest.chunks.length);
  assert.equal(value.desktopChunkManifest.uniqueCount, desktopHashes.size);
  assert.equal(value.baseChunkManifest.imageLen, baseManifest.image_len);
  assert.equal(value.baseChunkManifest.positionCount, baseManifest.chunks.length);
  assert.equal(value.baseChunkManifest.uniqueCount, baseHashes.size);
  const chunkVerify = await execFile(cli, ["chunk-verify", path.dirname(desktopManifestPath)], { cwd: repo, maxBuffer: 4 * 1024 * 1024 });
  assert.ok(chunkVerify.stdout.length > 0, "chunk-verify produced no result");

  const baseSet = new Set(baseManifest.chunks);
  const desktopSet = new Set(desktopManifest.chunks);
  const computed = {
    reusedObjectCount: [...desktopSet].filter((hash) => baseSet.has(hash)).length,
    reusedPositionCount: desktopManifest.chunks
      .slice(0, baseManifest.chunks.length)
      .reduce((count, hash, index) => count + (hash === baseManifest.chunks[index] ? 1 : 0), 0),
    newObjectCount: [...desktopSet].filter((hash) => !baseSet.has(hash)).length,
  };
  computed.reusedPositionRatio = computed.reusedPositionCount / baseManifest.chunks.length;
  computed.fetchedBytes = await sumChunkBytes(path.dirname(desktopManifestPath), [...desktopSet].filter((hash) => !baseSet.has(hash)));
  validateReportedDedupe(value.dedupe, computed);
  assert.equal(value.dedupe.fullBaseUploadRejected, true);
  assert.ok(value.dedupe.newObjectCount < value.desktopChunkManifest.uniqueCount, "full image upload was accepted");
  assert.ok(value.dedupe.reusedPositionCount > 0, "no E3 positions were reused");
  assert.equal(source.handoff.chunks.fullBaseUploadRejected, true);
  assert.equal(source.handoff.chunks.fetchedBytes, computed.fetchedBytes);
  return { desktopManifest, baseManifest, computed };
}

function validateReportedDedupe(value, computed) {
  assert.equal(value.reusedObjectCount, computed.reusedObjectCount, "reused object count does not match manifest");
  assert.equal(value.reusedPositionCount, computed.reusedPositionCount, "reused position count does not match manifest");
  assert.equal(value.reusedPositionRatio, computed.reusedPositionRatio, "reused position ratio does not match manifest");
  assert.equal(value.newObjectCount, computed.newObjectCount, "new object count does not match manifest");
  assert.equal(value.fetchedBytes, computed.fetchedBytes, "fetched bytes do not match chunk objects");
}

function validateChunkManifest(manifest, imageSize, label) {
  assert.equal(manifest.version, 1, `${label}: unexpected manifest version`);
  assert.equal(manifest.layout, "split", `${label}: unexpected manifest layout`);
  assert.equal(manifest.chunk_size, 128 * 1024, `${label}: unexpected chunk size`);
  assert.equal(manifest.image_len, imageSize, `${label}: image length drifted`);
  assert.equal(manifest.chunks.length, Math.ceil(imageSize / manifest.chunk_size), `${label}: position count is wrong`);
  for (const hash of manifest.chunks) assert.match(hash, SHA256, `${label}: malformed chunk hash`);
}

async function validateChunkObjects(directory, manifest) {
  const expected = new Set(manifest.chunks);
  const objectDir = path.join(directory, "chunks");
  const entries = (await readdir(objectDir)).filter((entry) => entry.endsWith(".bin"));
  assert.deepEqual(new Set(entries.map((entry) => entry.slice(0, -4))), expected, `${directory}: object set differs from manifest`);
  for (const hash of expected) {
    const file = path.join(objectDir, `${hash}.bin`);
    const fileStat = await stat(file);
    assert.ok(fileStat.isFile() && fileStat.size > 0 && fileStat.size <= manifest.chunk_size, `${file}: invalid chunk size`);
    assert.equal(await digestFile(file), hash, `${file}: object content hash drifted`);
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
      assert.equal(sha256(buffer.subarray(0, length)), manifest.chunks[index], `${label}: chunk ${index} does not match manifest`);
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

async function validateHygieneArtifact(value, imagePath) {
  const file = resolve(value.path);
  const text = await readFile(file, "utf8");
  assert.equal(await digestFile(file), value.sha256, "final-image inspection digest is stale");
  validateHygiene(text);
  assert.equal(value.sourceImageUnchanged, true);
  assert.equal(value.noApkCache, true);
  assert.equal(value.noRootHistoryOrCredentials, true);
  assert.equal(value.declaredPayloadOnly, true);
  // Re-run the read-only inspection so a worker cannot satisfy the claim with a self-authored log.
  validateHygiene(await inspectFinalImage(imagePath));
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
  assert.doesNotMatch(section("ROOT_LIST"), /\.ash_history|\.bash_history|\.netrc|\.curlrc|\.wget-hsts|\.ssh|id_rsa|credential|password/iu, "root history or credentials remain");
  assert.doesNotMatch(section("APK_CACHE"), /\.apk|\.tar|\.tmp/iu, "APK build cache remains");
  assert.doesNotMatch(section("TMP_LIST"), /desktop-image|rootfs-inner|apk-.*\.tmp/iu, "temporary build debris remains");
  assert.match(section("INITTAB"), /tty1::respawn:.*desktop-autologin/u);
  assert.match(section("REPOSITORIES"), /https:\/\/dl-cdn\.alpinelinux\.org\/alpine\/v3\.20\/(?:main|community)/u);
  assert.match(section("APK_DB"), /installed/u, "APK package database is missing");
}

async function validateRuntime(runtime, value, source, publication) {
  assert.equal(runtime.image.path, "target/e5-t17e/runtime/desktop-overlay.ext4");
  assert.equal(runtime.image.sourceSha256, source.image.sha256);
  assert.equal(runtime.image.size, source.image.size);
  assert.equal(await digestFile(resolve(runtime.image.path)), runtime.image.postSha256, "runtime image digest is stale");
  assert.deepEqual(runtime.package, {
    name: packageName,
    installCommand: "apk add --no-scripts --no-progress htop",
    signedDefaultVerification: true,
    profileMutation: false,
    persistedAcrossReloads: true,
  });
  assert.deepEqual(runtime.sentinel, {
    path: "/home/desktop/.local/state/wasm-vm/e5-t17e-sentinel",
    value: expectedSentinel,
    sha256: expectedSentinelSha256,
    bytes: expectedSentinelBytes,
  });
  assert.equal(runtime.coherence.coreId, "0".repeat(64));
  assert.equal(runtime.coherence.baseId, "0".repeat(64));
  assert.equal(runtime.coherence.publicationBaseId, value.publication.base.binding);
  assert.match(runtime.coherence.publicationCoreId, SHA256);
  assert.equal(runtime.coherence.identityMode, "native-default-zero; publication binding recorded separately");
  assert.equal(runtime.coherence.sameDriveAcrossPhases, true);
  assert.equal(runtime.coherence.syncBeforeEverySnapshot, true);
  assert.equal(runtime.phases.length, 3);
  const [phaseA, phaseB, phaseC] = runtime.phases;
  assert.equal(phaseA.name, "cold-install-snapshot");
  assert.equal(phaseB.name, "reload-one-snapshot");
  assert.equal(phaseC.name, "reload-two-poweroff");
  for (const phase of runtime.phases) await validatePhaseFiles(phase);
  const textA = await phaseText(phaseA);
  const textB = await phaseText(phaseB);
  const textC = await phaseText(phaseC);
  assert.match(textA, /T17ENETREADY/u);
  assert.match(textA, /T17E_APK_UPDATE_RC=0/u);
  assert.match(textA, /T17E_APK_ADD_RC=0/u);
  assert.match(textA, /T17EAPKPRESENT/u);
  assert.match(textA, /T17EUNSIGNEDREJECTED/u);
  assert.match(textA, /T17ESNAPSHOTONE/u);
  assert.match(textB, /T17ESNAPSHOTTWO/u);
  assert.match(textC, /T17ESHUTDOWNREQUESTED/u);
  assert.match(textC, /wasm-vm: guest powered off/u);
  const pre = parseInstallState(textA);
  const reloadOne = parseReloadState(textB, "T17E_RELOAD_ONE");
  const reloadTwo = parseReloadState(textC, "T17E_RELOAD_TWO");
  validatePreState(pre);
  assert.equal(pre.packagePresent, true);
  assert.equal(pre.unsignedRejected, true);
  assert.equal(pre.sentinel, expectedSentinel);
  assert.equal(pre.sentinelSha256, expectedSentinelSha256);
  assert.equal(pre.sentinelBytes, expectedSentinelBytes);
  assert.equal(runtime.state.preSnapshot.sentinelSha256, pre.sentinelSha256);
  assert.equal(runtime.state.preSnapshot.packageDbSha256, pre.packageDbSha256);
  assert.equal(runtime.state.reloadOne.packageDbSha256, reloadOne.packageDbSha256);
  assert.equal(runtime.state.reloadTwo.packageDbSha256, reloadTwo.packageDbSha256);
  assertReloadState(reloadOne, pre);
  assertReloadState(reloadTwo, pre);
  const evidence = runtime.guestEvidence;
  const guestEvidenceFile = resolve(evidence.path);
  assert.equal(await digestFile(guestEvidenceFile), evidence.sha256, "guest evidence digest is stale");
  const guestEvidenceText = await readFile(guestEvidenceFile, "utf8");
  const retired = /^trace retired=(\d+)$/mu.exec(guestEvidenceText);
  assert.ok(retired && Number(retired[1]) > 0, "guest evidence has no retired count");
  assert.match(guestEvidenceText, /^state sha256=[0-9a-f]{64}$/mu);
  assert.match(guestEvidenceText, /^outcome=Reset\(PowerOff\)$/mu);
  assert.equal(evidence.path, phaseC.evidencePath);
}

async function validatePhaseFiles(phase) {
  assert.equal(phase.exit.code, 0, `${phase.name}: phase did not exit cleanly`);
  assert.equal(phase.exit.signal, null, `${phase.name}: phase was signalled`);
  assert.equal(phase.timedOut, false, `${phase.name}: phase timed out`);
  for (const artifact of [phase.console, phase.stderr]) {
    const file = resolve(artifact.path);
    const fileStat = await stat(file);
    assert.ok(fileStat.isFile() && fileStat.size > 0, `${phase.name}: missing ${artifact.path}`);
    assert.equal(await digestFile(file), artifact.sha256, `${phase.name}: stale ${artifact.path}`);
  }
  assert.equal(phase.image.path, "target/e5-t17e/runtime/desktop-overlay.ext4");
  if (phase.snapshot) {
    const snapshot = await stat(resolve(phase.snapshot.path));
    assert.ok(snapshot.isFile() && snapshot.size === phase.snapshot.size && snapshot.size > 0, `${phase.name}: invalid snapshot`);
    assert.equal(await digestFile(resolve(phase.snapshot.path)), phase.snapshot.sha256, `${phase.name}: stale snapshot`);
  }
}

async function phaseText(phase) {
  const [consoleText, stderrText] = await Promise.all([
    readFile(resolve(phase.console.path), "utf8"),
    readFile(resolve(phase.stderr.path), "utf8"),
  ]);
  return `${consoleText}\n${stderrText}`.replaceAll(/\r/gu, "");
}

function parseInstallState(text) {
  const match = /T17E_PRE_STATE sentinel=(\S+) sentinel_sha=([0-9a-f]{64}) sentinel_bytes=(\d+) apk_db_sha=([0-9a-f]{64}) htop=(present|missing)/u.exec(text);
  assert.ok(match, "missing pre-snapshot state marker");
  const unsigned = /T17E_UNSIGNED_RC=(\d+)/u.exec(text);
  assert.ok(unsigned, "missing unsigned package result");
  return {
    sentinel: match[1],
    sentinelSha256: match[2],
    sentinelBytes: Number(match[3]),
    packageDbSha256: match[4],
    packagePresent: match[5] === "present" && text.includes("T17EAPKPRESENT"),
    unsignedRc: Number(unsigned[1]),
    unsignedRejected: Number(unsigned[1]) !== 0 && text.includes("T17EUNSIGNEDREJECTED"),
  };
}

function parseReloadState(text, marker) {
  const match = new RegExp(`${marker} sentinel=(\\S+) sentinel_sha=([0-9a-f]{64}) sentinel_bytes=(\\d+) apk_db_sha=([0-9a-f]{64}) htop=(present|missing)`, "u").exec(text);
  assert.ok(match, `missing ${marker} state marker`);
  return {
    sentinel: match[1],
    sentinelSha256: match[2],
    sentinelBytes: Number(match[3]),
    packageDbSha256: match[4],
    packagePresent: match[5] === "present",
  };
}

function assertReloadState(actual, expected) {
  assert.equal(actual.sentinel, expected.sentinel, "sentinel content did not persist");
  assert.equal(actual.sentinelSha256, expected.sentinelSha256, "sentinel digest did not persist");
  assert.equal(actual.sentinelBytes, expected.sentinelBytes, "sentinel length did not persist");
  assert.equal(actual.packageDbSha256, expected.packageDbSha256, "APK package database did not persist");
  assert.equal(actual.packagePresent, true, "signed extra package did not persist");
}

function validatePreState(state) {
  assert.equal(state.packagePresent, true, "signed extra package was not installed");
  assert.equal(state.unsignedRejected, true, "unsigned extra package was accepted");
  assert.equal(state.sentinel, expectedSentinel, "pre-snapshot sentinel content drifted");
  assert.equal(state.sentinelSha256, expectedSentinelSha256, "pre-snapshot sentinel digest drifted");
  assert.equal(state.sentinelBytes, expectedSentinelBytes, "pre-snapshot sentinel length drifted");
}

async function runSelfTests(value, publication) {
  const manifestMutant = structuredClone(publication.desktopManifest);
  manifestMutant.chunks.pop();
  assert.throws(() => validateChunkManifest(manifestMutant, value.source.image.size, "mutant"), /position count is wrong/u);

  const fullUploadMutant = structuredClone(value.publication.dedupe);
  fullUploadMutant.newObjectCount = value.publication.desktopChunkManifest.uniqueCount;
  assert.throws(
    () => validateReportedDedupe(fullUploadMutant, publication.computed),
    /new object count does not match manifest/u,
    "full-upload mutation was accepted",
  );

  const truncated = structuredClone(value.runtime.state.reloadOne);
  truncated.sentinelBytes += 1;
  assert.throws(() => assertReloadState(truncated, value.runtime.state.preSnapshot), /sentinel length/u);

  const unsigned = structuredClone(value.runtime.state.preSnapshot);
  unsigned.unsignedRejected = false;
  assert.throws(() => validatePreState(unsigned), /unsigned extra package/u, "unsigned package acceptance was not rejected");

  const hygiene = await readFile(resolve(value.hygiene.path), "utf8");
  assert.throws(() => validateHygiene(hygiene.replace("root:!:", "root:x:")), /root credential/u);
}

async function digestFile(file) {
  return new Promise((resolvePromise, reject) => {
    const hash = createHash("sha256");
    const input = createReadStream(file);
    input.on("error", reject);
    input.on("data", (chunk) => hash.update(chunk));
    input.on("end", () => resolvePromise(hash.digest("hex")));
  });
}

async function readJson(file) {
  return JSON.parse(await readFile(file, "utf8"));
}

function resolve(file) {
  return path.resolve(repo, file);
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function argument(name) {
  const index = process.argv.indexOf(name);
  if (index < 0) return undefined;
  assert.ok(process.argv[index + 1] && !process.argv[index + 1].startsWith("--"), `${name} requires a path`);
  return process.argv[index + 1];
}
