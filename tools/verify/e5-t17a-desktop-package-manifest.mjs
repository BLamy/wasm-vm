#!/usr/bin/env node

// E5-T17a: verify the production desktop package profile against the already-verified T16e
// decision and T16d Alpine riscv64 package audit. Image assembly is intentionally out of scope.

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const profilePath = path.join(repo, "tools/image/e5-t17a-desktop-packages.json");
const decisionPath = path.join(repo, "evidence/e5-t16e/display-server-decision.json");
const auditPath = path.join(repo, "evidence/e5-t16d/package-audit.json");
const auditVerificationPath = path.join(repo, "evidence/e5-t16d/package-audit-verification.json");
const evidenceDir = path.join(repo, "evidence/e5-t17a");
const verificationPath = path.join(evidenceDir, "package-profile-verification.json");
const repositories = Object.freeze([
  "https://dl-cdn.alpinelinux.org/alpine/v3.20/main",
  "https://dl-cdn.alpinelinux.org/alpine/v3.20/community",
]);
const SHA256 = /^[0-9a-f]{64}$/u;
const PACKAGE_ID = /^(.+)-([0-9][^-]*-r[0-9]+)$/u;

const readJson = async (file) => JSON.parse(await readFile(file, "utf8"));
const sha256File = async (file) => createHash("sha256").update(await readFile(file)).digest("hex");

const profile = await readJson(profilePath);
const decision = await readJson(decisionPath);
const audit = await readJson(auditPath);
const auditVerification = await readJson(auditVerificationPath);
const expected = {
  ...buildExpectedSources({ decision, audit, auditVerification }),
  decisionHash: await sha256File(decisionPath),
  auditHash: await sha256File(auditPath),
  auditVerificationHash: await sha256File(auditVerificationPath),
};
validateProfile(profile, expected);

const offlineCacheArg = process.argv.indexOf("--offline-cache");
let offlineCacheChecked = null;
if (offlineCacheArg >= 0) {
  const cacheRoot = process.argv[offlineCacheArg + 1];
  assert.ok(cacheRoot && !cacheRoot.startsWith("--"), "--offline-cache requires a directory");
  await validateOfflineCache(profile, cacheRoot);
  offlineCacheChecked = path.resolve(cacheRoot);
}

if (process.argv.includes("--self-test")) {
  const cases = [
    ["wrong architecture", (mutant) => { mutant.architecture = "x86_64"; }],
    ["wrong repository", (mutant) => { mutant.repositories = [repositories[0]]; }],
    ["package version drift", (mutant) => { mutant.packages[0].version = "12.0.4-r1"; }],
    ["package source drift", (mutant) => { mutant.packages[0].sourceEvidence = "unverified"; }],
    ["untrusted install option", (mutant) => { mutant.install.addCommand += " --allow-untrusted"; }],
    ["non fail-closed cache", (mutant) => { mutant.offlineCache.missingInputPolicy = "download-anything"; }],
  ];
  for (const [name, mutate] of cases) {
    const mutant = structuredClone(profile);
    mutate(mutant);
    assert.throws(() => validateProfile(mutant, expected), assert.AssertionError, name);
  }

  const fixtureRoot = await mkdtemp(path.join(tmpdir(), "wasm-vm-e5-t17a-"));
  try {
    await createCompleteOfflineFixture(profile, fixtureRoot);
    await validateOfflineCache(profile, fixtureRoot);
    const missingPackage = path.join(fixtureRoot, "main", `${profile.packages[0].packageId}.apk`);
    await rm(missingPackage);
    await assert.rejects(() => validateOfflineCache(profile, fixtureRoot), /missing offline package/u);
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
  process.stdout.write(`E5T17A_SELF_TEST=${cases.map(([name]) => name.replaceAll(" ", "-")).join(",")},offline-cache-fail-closed\n`);
}

await mkdir(evidenceDir, { recursive: true });
const output = {
  schema: "wasm-vm.e5-t17a.desktop-package-profile-verification.v1",
  task: "E5-T17a",
  command: "make verify-E5-T17a",
  profile: {
    path: path.relative(repo, profilePath),
    sha256: await sha256File(profilePath),
  },
  sourceEvidence: {
    decision: { path: path.relative(repo, decisionPath), sha256: await sha256File(decisionPath) },
    packageAudit: { path: path.relative(repo, auditPath), sha256: await sha256File(auditPath) },
    packageAuditVerification: {
      path: path.relative(repo, auditVerificationPath),
      sha256: await sha256File(auditVerificationPath),
    },
  },
  architecture: profile.architecture,
  repositories: profile.repositories,
  resolutionMode: profile.resolutionMode,
  packages: profile.packages.map(({ name, packageId, version }) => ({ name, packageId, version })),
  offlineCache: {
    root: profile.offlineCache.root,
    missingInputPolicy: profile.offlineCache.missingInputPolicy,
    checkedPath: offlineCacheChecked,
  },
  result: "passed",
};
await writeFile(verificationPath, `${JSON.stringify(output, null, 2)}\n`);
process.stdout.write(`E5T17A_VERIFIED=${JSON.stringify({
  profile: path.relative(repo, profilePath),
  packageCount: profile.packages.length,
  architecture: profile.architecture,
  repositories: profile.repositories,
  evidence: path.relative(repo, verificationPath),
})}\n`);

function buildExpectedSources({ decision: decisionValue, audit: auditValue, auditVerification: verificationValue }) {
  assert.equal(decisionValue.schema, "wasm-vm.e5-t16e.display-server-decision.v1");
  assert.equal(decisionValue.decision.selected, "weston-pixman");
  assert.equal(auditValue.schema, "wasm-vm.e5-t16d.package-audit.v1");
  assert.equal(auditVerification.schema, "wasm-vm.e5-t16d.package-audit-verification.v1");
  const selected = auditValue.candidates.find((candidate) => candidate.id === "weston-pixman");
  const selectedVerification = verificationValue.candidates.find((candidate) => candidate.id === "weston-pixman");
  assert.ok(selected, "T16d package audit has no weston-pixman candidate");
  assert.ok(selectedVerification, "T16d verification has no weston-pixman candidate");
  return {
    decision: decisionValue,
    audit: auditValue,
    auditVerification: verificationValue,
    selected,
    selectedVerification,
    packageIds: selectedVerification.installedRequestedPackages,
  };
}

function validateProfile(value, source) {
  assert.equal(value.schema, "wasm-vm.e5-t17a.desktop-package-profile.v1");
  assert.equal(value.task, "E5-T17a");
  assert.equal(value.profileVersion, 1);
  assert.equal(value.architecture, "riscv64", "desktop packages must target riscv64");
  assert.equal(value.alpineBranch, "v3.20");
  assert.deepEqual(value.repositories, repositories, "only the audited Alpine v3.20 repositories are allowed");
  assert.equal(value.resolutionMode, "online-or-offline");
  assert.deepEqual(value.install, {
    updateCommand: "apk update",
    addCommand: "apk add --no-scripts --no-progress",
    signatureVerification: "apk default signature verification",
    trustedKeysDir: "/usr/share/apk/keys/riscv64",
    disallowedOptions: ["allow-untrusted"],
    networkArchitecture: "riscv64",
  });
  assert.equal(JSON.stringify(value).includes("--allow-untrusted"), false, "profile contains an untrusted install path");
  assert.deepEqual(value.offlineCache.repositoryDirs, ["main", "community"]);
  assert.deepEqual(value.offlineCache.requiredIndexFiles, [
    "main/APKINDEX.tar.gz",
    "main/APKINDEX.tar.gz.eds",
    "community/APKINDEX.tar.gz",
    "community/APKINDEX.tar.gz.eds",
  ]);
  assert.equal(value.offlineCache.packageFileTemplate, "{repository}/{packageId}.apk");
  assert.equal(value.offlineCache.requiredTrustedKeyDir, "keys/riscv64");
  assert.equal(value.offlineCache.missingInputPolicy, "fail-closed");

  for (const [label, reference, expectedHash] of [
    ["decision", value.provenance.decision, source.decision && source.decisionHash],
    ["package audit", value.provenance.packageAudit, source.auditHash],
    ["package audit verification", value.provenance.packageAuditVerification, source.auditVerificationHash],
  ]) {
    assert.ok(reference && SHA256.test(reference.sha256), `${label}: missing source digest`);
    assert.equal(reference.path, expectedPath(label), `${label}: unexpected source path`);
    assert.equal(reference.sha256, expectedHash, `${label}: source digest drifted`);
  }
  assert.equal(value.provenance.verifiedBaseImageSha256, source.audit.source.imageSha256);

  assert.deepEqual(value.packages.map((pkg) => pkg.packageId), source.packageIds, "profile package order/set drifted from T16d");
  assert.equal(value.packages.length, 11);
  for (const pkg of value.packages) {
    assert.match(pkg.packageId, PACKAGE_ID, `${pkg.name}: malformed package id`);
    const [, parsedName, parsedVersion] = pkg.packageId.match(PACKAGE_ID);
    assert.equal(pkg.name, parsedName, `${pkg.name}: package id name mismatch`);
    assert.equal(pkg.version, parsedVersion, `${pkg.name}: package id version mismatch`);
    assert.equal(pkg.signature, "apk-default", `${pkg.name}: signature policy drifted`);
    assert.equal(pkg.sourceEvidence, "E5-T16d/weston-pixman", `${pkg.name}: source evidence drifted`);
    assert.equal(source.selected.searches[pkg.name].rc, 0, `${pkg.name}: T16d search did not pass`);
    assert.equal(source.selected.packageInfo.rc, 0, `${pkg.name}: T16d package-info did not pass`);
    assert.equal(source.selected.install.rc, 0, `${pkg.name}: T16d install did not pass`);
    assert.ok(source.selected.installedManifest.includes(pkg.packageId), `${pkg.name}: exact installed version missing`);
    assert.ok(source.selected.packageInfo.output.includes(pkg.packageId), `${pkg.name}: exact package-info version missing`);
  }
  assert.deepEqual(
    Object.fromEntries(value.packages.map((pkg) => [pkg.name, pkg.packageId])),
    source.decision.packageHandoff.versions,
    "T16e package handoff and profile disagree",
  );
}

function expectedPath(label) {
  return {
    decision: "evidence/e5-t16e/display-server-decision.json",
    "package audit": "evidence/e5-t16d/package-audit.json",
    "package audit verification": "evidence/e5-t16d/package-audit-verification.json",
  }[label];
}

async function validateOfflineCache(value, cacheRoot) {
  const root = path.resolve(cacheRoot);
  const inside = (relativePath) => {
    const resolved = path.resolve(root, relativePath);
    assert.ok(resolved === root || resolved.startsWith(`${root}${path.sep}`), `offline cache path escapes root: ${relativePath}`);
    return resolved;
  };
  for (const relativePath of value.offlineCache.requiredIndexFiles) {
    const file = inside(relativePath);
    const fileStat = await stat(file).catch(() => null);
    assert.ok(fileStat?.isFile() && fileStat.size > 0, `missing offline index: ${relativePath}`);
  }
  const keyDir = inside(value.offlineCache.requiredTrustedKeyDir);
  const keyEntries = await readdir(keyDir).catch(() => []);
  assert.ok(keyEntries.length > 0, "missing offline trusted key material");
  for (const pkg of value.packages) {
    const found = await Promise.any(value.offlineCache.repositoryDirs.map(async (repository) => {
      const relativePath = `${repository}/${pkg.packageId}.apk`;
      const fileStat = await stat(inside(relativePath));
      assert.ok(fileStat.isFile() && fileStat.size > 0);
      return relativePath;
    })).catch(() => null);
    assert.ok(found, `missing offline package: ${pkg.packageId}`);
  }
}

async function createCompleteOfflineFixture(value, cacheRoot) {
  for (const relativePath of value.offlineCache.requiredIndexFiles) {
    const file = path.join(cacheRoot, relativePath);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, "signed-index\n");
  }
  const keyFile = path.join(cacheRoot, value.offlineCache.requiredTrustedKeyDir, "alpine.rsa.pub");
  await mkdir(path.dirname(keyFile), { recursive: true });
  await writeFile(keyFile, "trusted-key\n");
  for (const pkg of value.packages) {
    const file = path.join(cacheRoot, "main", `${pkg.packageId}.apk`);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, `${pkg.packageId}\n`);
  }
}
