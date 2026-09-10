import assert from "node:assert/strict";
import { execFile as execFileCallback } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import {
  BUILT_CAPTURE_HEAD,
  NATIVE_CAPTURE_HEAD,
  SCHEMA,
  collectRuntimeIdentities,
  runtimeIdentityPolicy,
  validateRuntimeIdentities,
} from "./omarchy-thread-runtime.mjs";

const execFile = promisify(execFileCallback);
const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "../..");
const sha256 = (value) => createHash("sha256").update(value).digest("hex");

async function git(cwd, ...args) {
  await execFile("git", args, { cwd });
}

async function scratchRepo() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "omarchy-thread-runtime-"));
  const files = [
    ...runtimeIdentityPolicy.runtimeFiles.map(({ path: pathname }) => pathname),
    ...runtimeIdentityPolicy.nativeHarness,
    ...runtimeIdentityPolicy.builtHarness,
  ];
  for (const pathname of new Set(files)) {
    const bytes = Buffer.from(`fixture:${pathname}\n`);
    const filename = path.join(root, pathname);
    await fs.mkdir(path.dirname(filename), { recursive: true });
    await fs.writeFile(filename, bytes);
  }
  await git(root, "init", "-q");
  await git(root, "config", "user.email", "test@example.invalid");
  await git(root, "config", "user.name", "runtime test");
  await git(root, "add", ".");
  await git(root, "commit", "-qm", "fixture");
  const { stdout } = await execFile("git", ["rev-parse", "HEAD"], { cwd: root });
  const head = stdout.trim();
  const runtimeFiles = runtimeIdentityPolicy.runtimeFiles.map((file, index) => ({
    ...file, sha256: sha256(Buffer.from(`fixture:${file.path}\n`)),
  }));
  const options = {
    nativeCaptureHead: head,
    builtCaptureHead: head,
    runtimeFiles,
  };
  return { root, options };
}

test("real repository collection is frozen and validates without rebuilding", async () => {
  const identity = await collectRuntimeIdentities(repo);
  assert.equal(identity.schema, SCHEMA);
  assert.deepEqual(identity.heads, { nativeCapture: NATIVE_CAPTURE_HEAD, builtCapture: BUILT_CAPTURE_HEAD });
  assert.equal(identity.files.length, runtimeIdentityPolicy.runtimeFiles.length + new Set([
    ...runtimeIdentityPolicy.nativeHarness, ...runtimeIdentityPolicy.builtHarness,
  ]).size);
  await validateRuntimeIdentities(identity, repo);
});

test("synthetic parameterization validates exact records and rejects omission, extras, and traversal", async () => {
  const { root, options } = await scratchRepo();
  try {
    const identity = await collectRuntimeIdentities(root, options);
    await validateRuntimeIdentities(identity, root, options);

    await assert.rejects(() => validateRuntimeIdentities({ ...identity,
      files: identity.files.slice(1),
    }, root, options), /omitted or extra/u);
    await assert.rejects(() => validateRuntimeIdentities({ ...identity,
      files: [...identity.files, { path: "extra", role: "harness", sha256: "a".repeat(64), size: 1 }],
    }, root, options), /omitted or extra/u);
    await assert.rejects(() => validateRuntimeIdentities({ ...identity,
      files: identity.files.map((file, index) => index === 0 ? { ...file, path: "../escape" } : file),
    }, root, options), /repository-relative|escapes/u);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("validation binds current harness bytes to git show and rejects corruption or role swaps", async () => {
  const { root, options } = await scratchRepo();
  try {
    const identity = await collectRuntimeIdentities(root, options);
    const changed = path.join(root, runtimeIdentityPolicy.nativeHarness[0]);
    await fs.appendFile(changed, "corruption\n");
    await assert.rejects(() => validateRuntimeIdentities(identity, root, options), /identity does not match bytes/u);
    const changedBytes = await fs.readFile(changed);
    const rebound = {
      ...identity,
      files: identity.files.map((file) => file.path === runtimeIdentityPolicy.nativeHarness[0]
        ? { ...file, sha256: sha256(changedBytes), size: changedBytes.length } : file),
    };
    await assert.rejects(() => validateRuntimeIdentities(rebound, root, options), /frozen harness/u);

    await fs.writeFile(changed, `fixture:${runtimeIdentityPolicy.nativeHarness[0]}\n`);
    const swapped = {
      ...identity,
      files: identity.files.map((file) => file.path === runtimeIdentityPolicy.nativeHarness[0]
        ? { ...file, role: "kernel" } : file),
    };
    await assert.rejects(() => validateRuntimeIdentities(swapped, root, options), /wrong role/u);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

console.log("T03g runtime identity helper tests: bounded hashes, frozen closures, and rejection cases passed");
