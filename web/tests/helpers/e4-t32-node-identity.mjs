import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import {
  assertCpuCalibrationCompatibility,
  validateCpuCalibrationPolicy,
  verifyCpuCalibrationReferenceLedger,
} from "./e4-t32-node-calibration.mjs";

export const E4T32_NODE_IDENTITY_SCHEMA_VERSION = 1;

export const E4T32_NODE_IDENTITY_REQUIRED_TRACKED_FILES = Object.freeze([
  "web/artifacts-node-alpine.json",
  "web/playwright.config.js",
  "web/tests/e4-t32-node-walltime.spec.js",
  "web/tests/e4-t32-node-failure.test.mjs",
  "web/tests/e4-t32-node-identity.test.mjs",
  "web/tests/e4-t32-node-attempt-journal.test.mjs",
  "web/tests/e4-t32-node-ledger-store.test.mjs",
  "web/tests/e4-t32-node-ledger.test.mjs",
  "web/tests/e4-t32-node-oracle.test.mjs",
  "web/tests/e4-t32-node-calibration.test.mjs",
  "web/tests/helpers/e4-t32-node-identity.mjs",
  "web/tests/helpers/e4-t32-node-failure.mjs",
  "web/tests/helpers/e4-t32-node-attempt-journal.mjs",
  "web/tests/helpers/e4-t32-node-ledger-store.mjs",
  "web/tests/helpers/e4-t32-node-ledger.mjs",
  "web/tests/helpers/e4-t32-node-oracle.mjs",
  "web/tests/helpers/e4-t32-node-calibration.mjs",
  "web/tests/helpers/e4-t32-node-calibration-fixture.mjs",
  "evidence/e4-t32/node-walltime-aca4484/E4T32_NODE_LEDGER_V2.json",
  "tools/prepare-e4-t32-node-assets.py",
  "tools/serve-dev.sh",
]);

export class NodeBenchmarkIdentityError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "NodeBenchmarkIdentityError";
    this.code = code;
  }
}

const fail = (code, message) => {
  throw new NodeBenchmarkIdentityError(code, message);
};

const sha256Bytes = (bytes) => createHash("sha256").update(bytes).digest("hex");

function canonicalJson(value, label = "identity", seen = new Set()) {
  if (value === null) return "null";
  switch (typeof value) {
    case "string":
    case "boolean":
      return JSON.stringify(value);
    case "number":
      if (!Number.isFinite(value)) fail("invalid-metadata", `${label} contains a non-finite number`);
      return JSON.stringify(value);
    case "object": {
      if (seen.has(value)) fail("invalid-metadata", `${label} contains a cycle`);
      if (!Array.isArray(value)) {
        const prototype = Object.getPrototypeOf(value);
        if (prototype !== Object.prototype && prototype !== null) {
          fail("invalid-metadata", `${label} must contain only plain JSON values`);
        }
      }
      seen.add(value);
      const encoded = Array.isArray(value)
        ? `[${value.map((entry, index) => canonicalJson(entry, `${label}[${index}]`, seen)).join(",")}]`
        : `{${Object.keys(value).sort().map((key) => (
          `${JSON.stringify(key)}:${canonicalJson(value[key], `${label}.${key}`, seen)}`
        )).join(",")}}`;
      seen.delete(value);
      return encoded;
    }
    default:
      fail("invalid-metadata", `${label} contains unsupported ${typeof value}`);
  }
}

const cloneJson = (value, label) => JSON.parse(canonicalJson(value, label));

const git = (repoRoot, args) => {
  try {
    return execFileSync("git", args, {
      cwd: repoRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (error) {
    const detail = String(error.stderr || error.message || "git failed").trim();
    fail("git-error", `${args.join(" ")} failed: ${detail}`);
  }
};

const gitBytes = (repoRoot, args) => {
  try {
    return execFileSync("git", args, {
      cwd: repoRoot,
      encoding: null,
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (error) {
    const detail = String(error.stderr || error.message || "git failed").trim();
    fail("git-error", `${args.join(" ")} failed: ${detail}`);
  }
};

const toPosix = (relativePath) => relativePath.split(path.sep).join("/");

const relativeRepoPath = (repoRoot, absolutePath) => toPosix(path.relative(repoRoot, absolutePath));

const resolveRequiredPath = (repoRoot, relativePath) => {
  if (typeof relativePath !== "string" || !relativePath || path.isAbsolute(relativePath)) {
    fail("invalid-source-path", `required tracked path must be repo-relative: ${relativePath}`);
  }
  const absolutePath = path.resolve(repoRoot, relativePath);
  const normalizedRelativePath = relativeRepoPath(repoRoot, absolutePath);
  if (normalizedRelativePath === ".." || normalizedRelativePath.startsWith("../")) {
    fail("invalid-source-path", `required tracked path escapes the repository: ${relativePath}`);
  }
  return { absolutePath, relativePath: normalizedRelativePath };
};

const fileDigest = (absolutePath, displayPath) => {
  let stats;
  try {
    stats = fs.statSync(absolutePath);
  } catch (error) {
    fail("missing-input", `${displayPath} cannot be read: ${error.message}`);
  }
  if (!stats.isFile()) fail("invalid-input", `${displayPath} must be a regular file`);
  const bytes = fs.readFileSync(absolutePath);
  return { path: displayPath, sha256: sha256Bytes(bytes), bytes: stats.size };
};

const assertTrackedSources = (repoRoot, requiredTrackedFiles) => {
  const normalized = [...new Set(requiredTrackedFiles.map(
    (relativePath) => resolveRequiredPath(repoRoot, relativePath).relativePath,
  ))].sort();
  for (const relativePath of normalized) {
    const tracked = git(repoRoot, ["ls-files", "--", relativePath]).trim();
    if (tracked !== relativePath) {
      fail("source-not-tracked", `${relativePath} is not committed at HEAD`);
    }
    const absolutePath = path.join(repoRoot, relativePath);
    if (!fs.existsSync(absolutePath)) fail("source-missing", `${relativePath} is missing from the worktree`);
    if (!fs.statSync(absolutePath).isFile()) {
      fail("invalid-input", `${relativePath} must be a regular file`);
    }
  }
  return normalized;
};

const isWithin = (candidate, root) => candidate === root || candidate.startsWith(`${root}${path.sep}`);

const allowedUntrackedRoots = (repoRoot, roots) => roots
  .filter((root) => typeof root === "string" && root.trim())
  .map((root) => path.resolve(root))
  // An external asset directory never appears in this repository's status. More importantly, an
  // allowance that is an ancestor of the repository must not accidentally exempt the whole tree.
  .filter((root) => root !== path.resolve(repoRoot) && isWithin(root, path.resolve(repoRoot)));

const assertCleanCandidate = (repoRoot, untrackedAllowanceRoots) => {
  const records = git(repoRoot, [
    "status",
    "--porcelain=v1",
    "-z",
    "--untracked-files=all",
    "--ignored=no",
  ]).split("\0").filter(Boolean);
  const trackedChanges = records.filter((record) => !record.startsWith("?? "));
  if (trackedChanges.length) {
    fail(
      "tracked-tree-dirty",
      `tracked changes are forbidden: ${JSON.stringify(trackedChanges)}`,
    );
  }
  const unexpectedUntracked = records.filter((record) => {
    const absolutePath = path.resolve(repoRoot, record.slice(3));
    return !untrackedAllowanceRoots.some((root) => isWithin(absolutePath, root));
  });
  if (unexpectedUntracked.length) {
    fail(
      "unexpected-untracked",
      `nonignored untracked files are forbidden: ${JSON.stringify(unexpectedUntracked)}`,
    );
  }
};

const listGeneratedFiles = (repoRoot, relativeDirectory) => {
  const { absolutePath: absoluteDirectory, relativePath: normalizedDirectory } = resolveRequiredPath(
    repoRoot,
    relativeDirectory,
  );
  if (!fs.existsSync(absoluteDirectory) || !fs.statSync(absoluteDirectory).isDirectory()) {
    fail("missing-generated-package", `${normalizedDirectory} must be a generated directory`);
  }
  const files = [];
  const visit = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolutePath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        visit(absolutePath);
      } else if (entry.isFile()) {
        files.push(absolutePath);
      } else {
        fail(
          "unsupported-generated-entry",
          `${relativeRepoPath(repoRoot, absolutePath)} is not a regular file or directory`,
        );
      }
    }
  };
  visit(absoluteDirectory);
  if (!files.length) fail("empty-generated-package", `${normalizedDirectory} contains no files`);
  return files
    .map((absolutePath) => fileDigest(absolutePath, relativeRepoPath(repoRoot, absolutePath)))
    .sort((left, right) => left.path.localeCompare(right.path));
};

const requiredObject = (value, label) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail("invalid-metadata", `${label} must be a JSON object`);
  }
  return cloneJson(value, label);
};

const requiredArray = (value, label) => {
  if (!Array.isArray(value) || !value.length) {
    fail("invalid-metadata", `${label} must be a non-empty JSON array`);
  }
  return cloneJson(value, label);
};

const requiredDigest = (value, label) => {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/i.test(value)) {
    fail("invalid-digest", `${label} must be a SHA-256 hex digest`);
  }
  return value.toLowerCase();
};

const requireStringField = (value, field, label) => {
  if (typeof value[field] !== "string" || !value[field].trim()) {
    fail("invalid-metadata", `${label}.${field} must be a non-empty string`);
  }
};

const validatePlanAndPolicy = (planValue, policyValue) => {
  const plan = requiredArray(planValue, "plan");
  const ids = new Set();
  for (const [index, slot] of plan.entries()) {
    if (!slot || typeof slot !== "object" || Array.isArray(slot)) {
      fail("invalid-metadata", `plan[${index}] must be an object`);
    }
    requireStringField(slot, "id", `plan[${index}]`);
    requireStringField(slot, "variant", `plan[${index}]`);
    if (!Number.isSafeInteger(slot.passIndex) || slot.passIndex < 0) {
      fail("invalid-metadata", `plan[${index}].passIndex must be a non-negative safe integer`);
    }
    if (ids.has(slot.id)) fail("invalid-metadata", `plan contains duplicate slot id ${slot.id}`);
    ids.add(slot.id);
  }
  const policy = requiredObject(policyValue, "policy");
  if (!Number.isSafeInteger(policy.maxAttemptsPerSlot) || policy.maxAttemptsPerSlot < 1) {
    fail("invalid-metadata", "policy.maxAttemptsPerSlot must be a positive safe integer");
  }
  if (!policy.urls || typeof policy.urls !== "object" || Array.isArray(policy.urls)) {
    fail("invalid-metadata", "policy.urls must be an object keyed by slot id");
  }
  for (const slot of plan) requireStringField(policy.urls, slot.id, "policy.urls");
  try {
    policy.preflight = validateCpuCalibrationPolicy(policy.preflight);
  } catch (error) {
    fail("invalid-calibration-policy", error.message);
  }
  return { plan, policy };
};

/**
 * Construct the immutable identity for a resumable E4-T32 Node benchmark matrix.
 *
 * Browser/host facts are inputs so this module never launches a browser and can be tested with a
 * temporary repository. `browserMetadata.executablePath` is consumed and replaced with the exact
 * executable basename, byte length, and SHA-256 in the identity.
 */
export function createNodeBenchmarkIdentity({
  repoRoot,
  evidenceDir,
  nodeAssetDir,
  expectedNodeManifestSha256,
  plan,
  policy,
  browserMetadata,
  playwrightMetadata,
  hostMetadata,
  runtimeMetadata,
  requiredTrackedFiles = E4T32_NODE_IDENTITY_REQUIRED_TRACKED_FILES,
  generatedDirectory = "web/pkg",
  guestManifestPath = "web/artifacts-node-alpine.json",
}) {
  if (typeof repoRoot !== "string" || !repoRoot.trim()) fail("invalid-path", "repoRoot is required");
  if (typeof evidenceDir !== "string" || !evidenceDir.trim()) {
    fail("invalid-path", "evidenceDir is required");
  }
  if (typeof nodeAssetDir !== "string" || !nodeAssetDir.trim()) {
    fail("invalid-path", "nodeAssetDir is required");
  }
  const absoluteRepoRoot = path.resolve(repoRoot);
  const expectedManifest = requiredDigest(expectedNodeManifestSha256, "expectedNodeManifestSha256");
  const trackedPaths = assertTrackedSources(
    absoluteRepoRoot,
    [...requiredTrackedFiles, guestManifestPath],
  );
  const allowances = allowedUntrackedRoots(absoluteRepoRoot, [evidenceDir, nodeAssetDir]);
  assertCleanCandidate(absoluteRepoRoot, allowances);

  const nodeManifestPath = path.join(path.resolve(nodeAssetDir), "manifest.json");
  const nodeManifest = fileDigest(nodeManifestPath, "manifest.json");
  if (nodeManifest.sha256 !== expectedManifest) {
    fail(
      "node-manifest-mismatch",
      `local Node manifest mismatch: expected ${expectedManifest}, got ${nodeManifest.sha256}`,
    );
  }

  const guestManifestResolved = resolveRequiredPath(absoluteRepoRoot, guestManifestPath);
  let guestManifest;
  try {
    guestManifest = JSON.parse(fs.readFileSync(guestManifestResolved.absolutePath, "utf8"));
  } catch (error) {
    fail("invalid-guest-manifest", `${guestManifestResolved.relativePath}: ${error.message}`);
  }
  const browser = requiredObject(browserMetadata, "browserMetadata");
  requireStringField(browser, "type", "browserMetadata");
  requireStringField(browser, "version", "browserMetadata");
  if (typeof browser.headless !== "boolean") {
    fail("invalid-metadata", "browserMetadata.headless must be boolean");
  }
  const browserExecutablePath = browser.executablePath;
  delete browser.executablePath;
  if (typeof browserExecutablePath !== "string" || !browserExecutablePath.trim()) {
    fail("invalid-metadata", "browserMetadata.executablePath is required");
  }
  browser.executable = fileDigest(
    path.resolve(browserExecutablePath),
    path.basename(browserExecutablePath),
  );
  browser.executable.basename = browser.executable.path;
  delete browser.executable.path;

  const playwright = requiredObject(playwrightMetadata, "playwrightMetadata");
  requireStringField(playwright, "version", "playwrightMetadata");
  const runtime = requiredObject(runtimeMetadata, "runtimeMetadata");
  requireStringField(runtime, "nodeVersion", "runtimeMetadata");
  const host = requiredObject(hostMetadata, "hostMetadata");
  for (const field of ["platform", "release", "arch"]) {
    requireStringField(host, field, "hostMetadata");
  }
  if (!Number.isSafeInteger(host.logicalCpus) || host.logicalCpus < 1) {
    fail("invalid-metadata", "hostMetadata.logicalCpus must be a positive safe integer");
  }
  if (!Array.isArray(host.cpuModels) || !host.cpuModels.length || host.cpuModels.some(
    (model) => typeof model !== "string" || !model.trim(),
  )) {
    fail("invalid-metadata", "hostMetadata.cpuModels must contain at least one CPU model");
  }
  const validated = validatePlanAndPolicy(plan, policy);
  const referencePath = resolveRequiredPath(
    absoluteRepoRoot,
    validated.policy.preflight.reference.repoPath,
  );
  try {
    const worktreeReference = fs.readFileSync(referencePath.absolutePath);
    const committedReference = gitBytes(absoluteRepoRoot, [
      "show",
      `${validated.policy.preflight.reference.evidenceCommit}:${referencePath.relativePath}`,
    ]);
    verifyCpuCalibrationReferenceLedger(worktreeReference, validated.policy.preflight);
    verifyCpuCalibrationReferenceLedger(committedReference, validated.policy.preflight);
    if (!worktreeReference.equals(committedReference)) {
      fail("invalid-calibration-reference", "worktree capacity reference differs from its provenance commit");
    }
  } catch (error) {
    fail("invalid-calibration-reference", error.message);
  }
  try {
    assertCpuCalibrationCompatibility({ browser, playwright, runtime, host }, validated.policy.preflight);
  } catch (error) {
    fail("calibration-incompatible", error.message);
  }

  const identity = {
    schemaVersion: E4T32_NODE_IDENTITY_SCHEMA_VERSION,
    candidate: {
      head: git(absoluteRepoRoot, ["rev-parse", "HEAD"]).trim(),
      trackedTreeClean: true,
      sourceFiles: trackedPaths.map((relativePath) => fileDigest(
        path.join(absoluteRepoRoot, relativePath),
        relativePath,
      )),
      generatedFiles: listGeneratedFiles(absoluteRepoRoot, generatedDirectory),
    },
    harness: {
      runtime,
      playwright,
      browser,
    },
    host,
    policy: {
      ...validated.policy,
      plan: validated.plan,
    },
    guest: {
      nodeManifest,
      expectedNodeManifestSha256: expectedManifest,
      artifactManifest: fileDigest(
        guestManifestResolved.absolutePath,
        guestManifestResolved.relativePath,
      ),
      kernelSha256: requiredDigest(
        guestManifest.artifacts?.kernel?.sha256,
        "guest kernel digest",
      ),
      bootSnapshotSha256: requiredDigest(
        guestManifest.artifacts?.bootSnapshot?.sha256,
        "guest boot snapshot digest",
      ),
      overlayDeltaSha256: requiredDigest(
        guestManifest.artifacts?.overlayDelta?.sha256,
        "guest overlay delta digest",
      ),
    },
  };
  return {
    ...identity,
    identitySha256: sha256Bytes(Buffer.from(canonicalJson(identity))),
  };
}
