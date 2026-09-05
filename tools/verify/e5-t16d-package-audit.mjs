#!/usr/bin/env node

// E5-T16d: verify that package availability was proven inside clean Alpine riscv64 guests.
// This verifier never consults the host package database: it checks the guest's architecture,
// repository file, apk output, signed install transaction, and installed package manifest.

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const auditPath = path.join(repo, "evidence/e5-t16d/package-audit.json");
const verificationPath = path.join(repo, "evidence/e5-t16d/package-audit-verification.json");
const baseManifestPath = path.join(repo, "releases/rootfs/MANIFEST.txt");
const repositories = Object.freeze([
  "https://dl-cdn.alpinelinux.org/alpine/v3.20/main",
  "https://dl-cdn.alpinelinux.org/alpine/v3.20/community",
]);
const expectedPackages = Object.freeze({
  "labwc-pixman": Object.freeze([
    "labwc",
    "foot",
    "seatd",
    "eudev",
    "udev-init-scripts",
    "pixman",
    "xkeyboard-config",
    "wlr-randr",
    "wl-clipboard",
    "font-dejavu",
  ]),
  "weston-pixman": Object.freeze([
    "weston",
    "weston-backend-drm",
    "weston-shell-desktop",
    "foot",
    "seatd",
    "eudev",
    "udev-init-scripts",
    "pixman",
    "xkeyboard-config",
    "wl-clipboard",
    "font-dejavu",
  ]),
});
const sha256File = async (file) => new Promise((resolve, reject) => {
  const hash = createHash("sha256");
  const stream = createReadStream(file);
  stream.on("data", (chunk) => hash.update(chunk));
  stream.on("error", reject);
  stream.on("end", () => resolve(hash.digest("hex")));
});

const audit = JSON.parse(await readFile(auditPath, "utf8"));
const baseManifest = (await readFile(baseManifestPath, "utf8"))
  .split(/\r?\n/u)
  .map((line) => line.trim())
  .filter(Boolean);
const summary = validateStructure(audit, baseManifest);
const artifactSummary = await validateArtifacts(audit, baseManifest);

if (process.argv.includes("--self-test")) {
  const cases = [
    ["untrusted install flag", (mutant) => { mutant.candidates[0].commands.add += " --allow-untrusted"; }],
    ["wrong architecture", (mutant) => { mutant.architecture = "x86_64"; }],
    ["missing repository", (mutant) => { mutant.repositories = [repositories[0]]; }],
    ["failed install", (mutant) => { mutant.candidates[0].install.rc = 1; }],
  ];
  for (const [name, mutate] of cases) {
    const mutant = structuredClone(audit);
    mutate(mutant);
    assert.throws(() => validateStructure(mutant, baseManifest), /E5-T16d|expected|forbidden|missing|failed|riscv64/u, name);
  }
  process.stdout.write(`E5T16D_SELF_TEST=${cases.map(([name]) => name.replaceAll(" ", "-")).join(",")}\n`);
}

const output = {
  schema: "wasm-vm.e5-t16d.package-audit-verification.v1",
  task: "E5-T16d",
  command: "make verify-E5-T16d",
  audit: {
    path: path.relative(repo, auditPath),
    sha256: await sha256File(auditPath),
  },
  architecture: audit.architecture,
  repositories,
  base: {
    imageSha256: audit.source.imageSha256,
    packageManifestSha256: audit.source.packageManifestSha256,
    fileManifestSha256: audit.source.fileManifestSha256,
  },
  candidates: artifactSummary,
};
await writeFile(verificationPath, `${JSON.stringify(output, null, 2)}\n`);
process.stdout.write(`E5T16D_VERIFIED=${JSON.stringify({
  audit: path.relative(repo, auditPath),
  candidates: summary.candidates,
  packageCount: summary.packageCount,
  architecture: audit.architecture,
})}\n`);

function validateStructure(value, basePackages) {
  assert.equal(value.schema, "wasm-vm.e5-t16d.package-audit.v1");
  assert.equal(value.task, "E5-T16d");
  assert.equal(value.environment, "emulator");
  assert.equal(value.architecture, "riscv64", "audit must come from a riscv64 guest");
  assert.deepEqual(value.repositories, repositories, "real Alpine main/community repositories are required");
  assert.equal(value.source.image, "releases/rootfs/alpine-rootfs.ext4");
  assert.equal(value.source.packageManifest, "releases/rootfs/MANIFEST.txt");
  assert.equal(value.source.fileManifest, "releases/rootfs/FILE-MANIFEST.txt");
  assert.match(value.source.imageSha256, /^[0-9a-f]{64}$/u);
  assert.match(value.source.packageManifestSha256, /^[0-9a-f]{64}$/u);
  assert.match(value.source.fileManifestSha256, /^[0-9a-f]{64}$/u);
  assert.match(value.source.derivation, /E3 base image/u);
  assert.equal(value.policy.install, "apk add --no-scripts --no-deps --no-progress <package>");
  assert.equal(value.policy.signatureVerification, "apk default signature verification");
  assert.equal(value.policy.forbiddenInstallFlag, "--allow-untrusted");
  assert.equal(value.policy.network, "native emulator riscv64 guest via --net-slirp");
  assert.deepEqual(value.candidates.map((candidate) => candidate.id), Object.keys(expectedPackages));

  const allCommands = JSON.stringify({
    repositories: value.repositories,
    candidates: value.candidates.map((candidate) => ({
      commands: candidate.commands,
      run: candidate.run,
    })),
  });
  assert.doesNotMatch(allCommands, /--allow-untrusted|--arch\s+(?:x86_64|aarch64|armv7|ppc64|s390x)/iu);

  let packageCount = 0;
  for (const candidate of value.candidates) {
    const expected = expectedPackages[candidate.id];
    assert.ok(expected, `unexpected candidate ${candidate.id}`);
    assert.deepEqual(candidate.packages, expected, `${candidate.id}: package proposal changed`);
    assert.equal(candidate.server, "drm");
    assert.equal(candidate.renderer, "pixman");
    assert.equal(candidate.run.exit.code, 0, `${candidate.id}: emulator run failed`);
    assert.equal(candidate.run.exit.signal, null);
    assert.equal(candidate.run.loginReached, true);
    assert.equal(candidate.run.shellReached, true);
    assert.equal(candidate.run.passMarker, true);
    assert.match(candidate.run.command, /--net-slirp/u);
    assert.deepEqual(candidate.repositoriesObserved, repositories, `${candidate.id}: guest repository file drifted`);
    assert.equal(candidate.architectureObserved.trim(), "riscv64", `${candidate.id}: guest apk architecture mismatch`);
    assert.equal(candidate.update.rc, 0, `${candidate.id}: apk update failed`);
    assert.match(candidate.update.output, /(?:OK:|APKINDEX)/u, `${candidate.id}: apk update had no repository result`);
    assert.equal(candidate.simulate.rc, 0, `${candidate.id}: full dependency resolver simulation failed`);
    assert.match(candidate.simulate.output, /(?:package|world|install)/iu, `${candidate.id}: dependency simulation was not recorded`);
    assert.equal(candidate.install.rc, 0, `${candidate.id}: apk add failed`);
    assert.match(candidate.install.output, /OK:/u, `${candidate.id}: apk add did not report success`);
    assert.match(candidate.image.sha256, /^[0-9a-f]{64}$/u);
    assert.equal(candidate.image.sha256, value.source.imageSha256, `${candidate.id}: not derived from clean E3 image`);
    assert.match(candidate.image.postRunSha256, /^[0-9a-f]{64}$/u);
    assert.notEqual(candidate.image.postRunSha256, candidate.image.sha256, `${candidate.id}: install did not change the guest image`);
    assert.ok(candidate.commands.search, `${candidate.id}: apk search command missing`);
    for (const pkg of expected) {
      assert.match(candidate.commands.search, new RegExp(`\\b${escapeRegExp(pkg)}\\b`, "u"));
      assert.equal(candidate.searches[pkg]?.rc, 0, `${candidate.id}/${pkg}: apk search failed`);
      assert.match(candidate.searches[pkg]?.output ?? "", new RegExp(`${escapeRegExp(pkg)}-`, "u"), `${candidate.id}/${pkg}: search returned no package`);
      assert.ok(candidate.installedManifest.some((line) => line.startsWith(`${pkg}-`)), `${candidate.id}/${pkg}: installed manifest missing package`);
      packageCount += 1;
    }
    assert.equal(candidate.packageInfo.rc, 0, `${candidate.id}: apk package metadata query failed`);
    for (const pkg of expected) {
      assert.match(candidate.packageInfo.output, new RegExp(`\\b${escapeRegExp(pkg)}\\b`, "u"), `${candidate.id}/${pkg}: package metadata missing dependency record`);
    }
    for (const basePackage of basePackages) {
      assert.ok(candidate.installedManifest.includes(basePackage), `${candidate.id}: E3 base package missing: ${basePackage}`);
    }
  }
  return { candidates: value.candidates.map((candidate) => candidate.id), packageCount };
}

async function validateArtifacts(value, basePackages) {
  const summaries = [];
  for (const candidate of value.candidates) {
    const logPaths = [candidate.log.console, candidate.log.stderr, candidate.log.guestEvidence];
    const texts = [];
    for (const entry of logPaths) {
      const file = path.join(repo, entry.path);
      assert.equal(await sha256File(file), entry.sha256, `${candidate.id}: evidence digest mismatch for ${entry.path}`);
      texts.push(await readFile(file, "utf8"));
    }
    const combined = texts.join("\n");
    assert.doesNotMatch(combined, /UNTRUSTED|--allow-untrusted|x86_64|aarch64|armv7|ppc64|s390x/iu, `${candidate.id}: unsafe trust or architecture evidence`);
    assert.match(texts[0], /E5T16D_PACKAGE_PASS=1/u, `${candidate.id}: pass marker missing from guest console`);
    assert.match(texts[0], /E5T16D_REPOSITORIES_BEGIN[\s\S]*main[\s\S]*community[\s\S]*E5T16D_REPOSITORIES_END/u);
    assert.match(texts[2], /^outcome=Exited\(0\)$/mu, `${candidate.id}: guest evidence is not a clean exit`);
    summaries.push({
      id: candidate.id,
      imageSha256: candidate.image.sha256,
      postRunSha256: candidate.image.postRunSha256,
      installedRequestedPackages: candidate.packages.map((pkg) => candidate.installedManifest.find((line) => line.startsWith(`${pkg}-`))),
      logDigests: Object.fromEntries(logPaths.map((entry) => [entry.path, entry.sha256])),
    });
  }
  return summaries;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}
