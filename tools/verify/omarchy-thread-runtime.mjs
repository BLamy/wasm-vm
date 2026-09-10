#!/usr/bin/env node
// E5.5-T03g runtime identity binding. This module only hashes existing files and
// reads frozen blobs from git; it never builds, boots, or changes the repository.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";

export const SCHEMA = "wasm-vm.e5.5-t03g.runtime-identities.v1";
export const NATIVE_CAPTURE_HEAD = "0d3e609629e45021357b0e07f09ab70f9765edf8";
export const BUILT_CAPTURE_HEAD = "91a45c236b07974a9d7c87a0f8fa66f37e6f7e15";

const SHA = /^[0-9a-f]{64}$/u;
const HEAD = /^[0-9a-f]{40}$/u;
const HARNESS_ROLE = "harness";
const RUNTIME_FILES = Object.freeze([
  { path: "target/release/wasm-vm", role: "native-executable",
    sha256: "d5bc0b0f8c807117cee8822fe14d837cb4e39f4884e950cead54105e7ddd8bf6" },
  { path: "releases/kernel/6.6.63/Image", role: "kernel",
    sha256: "af7c4e471ed4dabdbe5a2717d81cc034b511d2b0f7706de66ad9e84e078c7cce" },
  { path: "web/dist/pkg/wasm_vm_wasm_bg.wasm", role: "core",
    sha256: "c48e9c2d9ec550c7daf4875716fef1dc729072fdfc91b805394d379bee4b9305" },
]);

// Keep this closure explicit. It is intentionally the small set used by the
// capture commands, rather than every nearby test or diagnostic utility.
const NATIVE_HARNESS = Object.freeze([
  "Cargo.toml",
  "Cargo.lock",
  "tools/chunk_image.py",
  "tools/build-omarchy-snapshot.sh",
  "tools/verify/omarchy-native-capture.mjs",
  "tools/verify/omarchy-browser-session.mjs",
  "web/omarchy-desktop-readiness.js",
  "tools/verify/omarchy-thread-setting.mjs",
  "tools/gen-omarchy-manifest.sh",
  "tools/verify/omarchy-thread-candidate.mjs",
  "tools/verify/omarchy-softpipe-candidate.mjs",
]);
const BUILT_HARNESS = Object.freeze([
  "tools/verify/omarchy-desktop-live.mjs",
  "tools/verify/omarchy-browser-session.mjs",
  "tools/verify/omarchy-renderer-log.mjs",
  "tools/verify/omarchy-thread-setting.mjs",
  "tools/verify/omarchy-live-recording.mjs",
  "web/package.json",
  "web/package-lock.json",
]);

const DEFAULT_POLICY = Object.freeze({
  nativeCaptureHead: NATIVE_CAPTURE_HEAD,
  builtCaptureHead: BUILT_CAPTURE_HEAD,
  runtimeFiles: RUNTIME_FILES,
  nativeHarness: NATIVE_HARNESS,
  builtHarness: BUILT_HARNESS,
});

function policyFor(options = {}) {
  const policy = { ...DEFAULT_POLICY, ...options };
  assert.match(policy.nativeCaptureHead, HEAD, "native capture head is invalid");
  assert.match(policy.builtCaptureHead, HEAD, "built capture head is invalid");
  assert.ok(Array.isArray(policy.runtimeFiles) && Array.isArray(policy.nativeHarness)
    && Array.isArray(policy.builtHarness), "runtime identity policy is incomplete");
  return policy;
}

function absoluteRepo(repo) {
  assert.equal(typeof repo, "string", "repo must be a path");
  return path.resolve(repo);
}

function relativePath(value) {
  assert.equal(typeof value, "string", "identity path must be a string");
  assert.ok(value.length > 0 && !path.posix.isAbsolute(value) && !path.win32.isAbsolute(value),
    "identity path must be repository-relative");
  assert.equal(value.includes("\\"), false, "identity path must use repository separators");
  assert.equal(path.posix.normalize(value), value, "identity path must be normalized");
  assert.equal(value === "." || value.startsWith("../") || value.includes("/../"), false,
    "identity path escapes the repository");
  return value;
}

function inside(root, candidate) {
  return candidate === root || candidate.startsWith(`${root}${path.sep}`);
}

async function noSymlinkFile(repo, relative) {
  const absolute = path.resolve(repo, relative);
  assert.ok(inside(repo, absolute), "identity path escapes the repository");
  const pieces = path.relative(repo, absolute).split(path.sep).filter(Boolean);
  let current = repo;
  for (const piece of pieces) {
    current = path.join(current, piece);
    const info = await fs.lstat(current);
    assert.equal(info.isSymbolicLink(), false, `identity path contains a symlink: ${relative}`);
  }
  const info = await fs.lstat(absolute);
  assert.equal(info.isFile(), true, `identity is not a regular file: ${relative}`);
  const realRoot = await fs.realpath(repo);
  const real = await fs.realpath(absolute);
  assert.ok(inside(realRoot, real), `identity path escapes through a symlink: ${relative}`);
  return { absolute, size: info.size };
}

async function hashStream(stream) {
  const digest = createHash("sha256");
  let size = 0;
  for await (const chunk of stream) {
    size += chunk.length;
    digest.update(chunk);
  }
  return { size, sha256: digest.digest("hex") };
}

async function fileIdentity(repo, relative) {
  const file = await noSymlinkFile(repo, relative);
  return { path: relative, size: file.size, ...(await hashStream(createReadStream(file.absolute))) };
}

async function frozenIdentity(repo, head, relative) {
  return await new Promise((resolve, reject) => {
    const child = spawn("git", ["show", "--format=", "--no-ext-diff", `${head}:${relative}`], {
      cwd: repo, stdio: ["ignore", "pipe", "pipe"],
    });
    const digest = createHash("sha256");
    let size = 0;
    let stderr = "";
    child.stdout.on("data", (chunk) => { size += chunk.length; digest.update(chunk); });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString("utf8"); });
    child.once("error", reject);
    child.once("close", (code, signal) => {
      if (code !== 0) {
        reject(new Error(`git show ${head}:${relative} failed${signal ? ` (${signal})` : ""}: ${stderr.trim()}`));
        return;
      }
      resolve({ path: relative, size, sha256: digest.digest("hex") });
    });
  });
}

function expectedFiles(policy) {
  const harness = new Map();
  for (const pathname of policy.nativeHarness) {
    harness.set(pathname, [...(harness.get(pathname) || []), policy.nativeCaptureHead]);
  }
  for (const pathname of policy.builtHarness) {
    harness.set(pathname, [...(harness.get(pathname) || []), policy.builtCaptureHead]);
  }
  return [
    ...policy.runtimeFiles.map(({ path: pathname, role, sha256 }) =>
      ({ path: pathname, role, sha256, frozenHead: undefined })),
    ...[...harness].map(([pathname, frozenHeads]) =>
      ({ path: pathname, role: HARNESS_ROLE, frozenHead: frozenHeads[0], frozenHeads })),
  ];
}

function assertUnique(values, label) {
  assert.equal(new Set(values).size, values.length, `${label} contains duplicates`);
}

export async function collectRuntimeIdentities(repo, options = {}) {
  const root = absoluteRepo(repo);
  const policy = policyFor(options);
  const files = [];
  for (const runtime of policy.runtimeFiles) {
    const pathname = relativePath(runtime.path);
    const actual = await fileIdentity(root, pathname);
    assert.equal(actual.sha256, runtime.sha256, `${pathname} is not the pinned runtime`);
    files.push({ path: pathname, role: runtime.role, sha256: actual.sha256, size: actual.size });
  }
  const expectedHarness = expectedFiles(policy).filter((file) => file.role === HARNESS_ROLE);
  for (const { path: rawPath, frozenHeads } of expectedHarness) {
    const pathname = relativePath(rawPath);
    const actual = await fileIdentity(root, pathname);
    for (const head of frozenHeads) {
      const frozen = await frozenIdentity(root, head, pathname);
      assert.deepEqual(actual, frozen, `${pathname} differs from frozen capture head ${head}`);
    }
    files.push({ path: pathname, role: HARNESS_ROLE, sha256: actual.sha256, size: actual.size,
      frozenHead: frozenHeads[0] });
  }
  return {
    schema: SCHEMA,
    heads: { nativeCapture: policy.nativeCaptureHead, builtCapture: policy.builtCaptureHead },
    files,
  };
}

function recordKeys(record) {
  return Object.keys(record).sort();
}

export async function validateRuntimeIdentities(identityFileOrObject, repo, options = {}) {
  const root = absoluteRepo(repo);
  const policy = policyFor(options);
  const identity = typeof identityFileOrObject === "string"
    ? JSON.parse(await fs.readFile(identityFileOrObject, "utf8")) : identityFileOrObject;
  assert.ok(identity && typeof identity === "object" && !Array.isArray(identity), "runtime identity is not an object");
  assert.deepEqual(recordKeys(identity), ["files", "heads", "schema"], "runtime identity has unexpected fields");
  assert.equal(identity.schema, SCHEMA, "runtime identity schema mismatch");
  assert.deepEqual(identity.heads, {
    nativeCapture: policy.nativeCaptureHead, builtCapture: policy.builtCaptureHead,
  }, "runtime capture heads are not frozen");

  const expected = expectedFiles(policy);
  const files = identity.files;
  assert.ok(Array.isArray(files), "runtime identity files are missing");
  assert.equal(files.length, expected.length, "runtime identity has omitted or extra records");
  assertUnique(files.map((file) => file?.path), "runtime identity paths");
  const expectedByPath = new Map(expected.map((file) => [file.path, file]));
  for (const file of files) {
    assert.ok(file && typeof file === "object" && !Array.isArray(file), "runtime file record is invalid");
    const pathname = relativePath(file.path);
    const wanted = expectedByPath.get(pathname);
    assert.ok(wanted, `runtime identity contains an unexpected path: ${pathname}`);
    assert.equal(file.role, wanted.role, `${pathname} has the wrong role`);
    assert.match(file.sha256 || "", SHA, `${pathname} SHA-256 is invalid`);
    assert.ok(Number.isSafeInteger(file.size) && file.size >= 0, `${pathname} size is invalid`);
    const allowedKeys = wanted.frozenHeads ? ["frozenHead", "path", "role", "sha256", "size"]
      : ["path", "role", "sha256", "size"];
    assert.deepEqual(recordKeys(file), allowedKeys, `${pathname} record has unexpected fields`);
    const actual = await fileIdentity(root, pathname);
    assert.deepEqual({ path: pathname, size: actual.size, sha256: actual.sha256 },
      { path: pathname, size: file.size, sha256: file.sha256 }, `${pathname} identity does not match bytes`);
    if (wanted.frozenHead) {
      assert.equal(file.frozenHead, wanted.frozenHead, `${pathname} frozen head is not bound`);
      for (const head of wanted.frozenHeads) {
        assert.deepEqual(await frozenIdentity(root, head, pathname),
          { path: pathname, size: file.size, sha256: file.sha256 }, `${pathname} is not the frozen harness`);
      }
    } else {
      assert.equal(Object.prototype.hasOwnProperty.call(file, "frozenHead"), false,
        `${pathname} must not carry a harness frozen head`);
      assert.equal(file.sha256, wanted.sha256, `${pathname} runtime hash is not pinned`);
    }
  }
  return identity;
}

export const runtimeIdentityPolicy = Object.freeze({
  runtimeFiles: RUNTIME_FILES,
  nativeHarness: NATIVE_HARNESS,
  builtHarness: BUILT_HARNESS,
  nativeCaptureHead: NATIVE_CAPTURE_HEAD,
  builtCaptureHead: BUILT_CAPTURE_HEAD,
});
