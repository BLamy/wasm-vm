import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  E4T32_NODE_IDENTITY_REQUIRED_TRACKED_FILES,
  createNodeBenchmarkIdentity,
} from "./helpers/e4-t32-node-identity.mjs";

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

const git = (repoRoot, ...args) => execFileSync("git", args, {
  cwd: repoRoot,
  encoding: "utf8",
  stdio: ["ignore", "pipe", "pipe"],
  env: {
    ...process.env,
    GIT_AUTHOR_NAME: "E4 T32",
    GIT_AUTHOR_EMAIL: "e4-t32@example.test",
    GIT_COMMITTER_NAME: "E4 T32",
    GIT_COMMITTER_EMAIL: "e4-t32@example.test",
  },
}).trim();

const write = (repoRoot, relativePath, value) => {
  const absolutePath = path.join(repoRoot, relativePath);
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  fs.writeFileSync(absolutePath, value);
  return absolutePath;
};

const guestManifest = (overrides = {}) => ({
  artifacts: {
    kernel: { sha256: "1".repeat(64) },
    bootSnapshot: { sha256: "2".repeat(64) },
    overlayDelta: { sha256: "3".repeat(64) },
    ...overrides,
  },
});

function fixture() {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "e4-t32-node-identity-"));
  git(repoRoot, "init", "-q");
  git(repoRoot, "config", "user.name", "E4 T32");
  git(repoRoot, "config", "user.email", "e4-t32@example.test");
  write(repoRoot, ".gitignore", "/web/pkg/\n");
  for (const relativePath of E4T32_NODE_IDENTITY_REQUIRED_TRACKED_FILES) {
    const contents = relativePath === "web/artifacts-node-alpine.json"
      ? `${JSON.stringify(guestManifest())}\n`
      : `fixture:${relativePath}\n`;
    write(repoRoot, relativePath, contents);
  }
  write(repoRoot, "web/pkg/wasm_vm.js", "export const generated = 1;\n");
  write(repoRoot, "web/pkg/wasm_vm_bg.wasm", Buffer.from([0, 97, 115, 109]));
  write(repoRoot, "web/pkg/snippets/runtime/inline0.js", "export const inline = 1;\n");
  git(repoRoot, "add", ".gitignore", ...E4T32_NODE_IDENTITY_REQUIRED_TRACKED_FILES);
  git(repoRoot, "commit", "-qm", "frozen candidate");

  const evidenceDir = path.join(repoRoot, "evidence/e4-t32/node-walltime");
  const nodeAssetDir = path.join(repoRoot, ".node-assets");
  const manifestBytes = Buffer.from("immutable node chunk manifest\n");
  const browserExecutablePath = write(repoRoot, ".node-assets/browser", "browser-v1\n");
  write(repoRoot, ".node-assets/manifest.json", manifestBytes);
  write(repoRoot, "evidence/e4-t32/node-walltime/prior-attempt.json", "{}\n");

  const input = {
    repoRoot,
    evidenceDir,
    nodeAssetDir,
    expectedNodeManifestSha256: sha256(manifestBytes),
    plan: [
      { id: "p0:main-interp", passIndex: 0, variant: "main-interp" },
      { id: "p0:worker-interp", passIndex: 0, variant: "worker-interp" },
    ],
    policy: {
      version: "e4-t32-node-ledger-v2",
      maxAttemptsPerSlot: 3,
      processesPerSession: 2,
      processTimeoutMs: 300_000,
      urls: {
        "p0:main-interp": "/?guest=node-alpine&worker=0&jit=0",
        "p0:worker-interp": "/?guest=node-alpine&jit=0",
      },
      browserMode: "headed-foreground",
    },
    browserMetadata: {
      type: "chromium",
      version: "140.0.1",
      executablePath: browserExecutablePath,
      headless: false,
    },
    playwrightMetadata: { version: "1.55.0" },
    hostMetadata: {
      platform: "darwin",
      release: "25.0.0",
      arch: "arm64",
      machine: "arm64",
      logicalCpus: 12,
      cpuModels: ["Apple M4 Pro"],
    },
    runtimeMetadata: { nodeVersion: "v24.5.0" },
  };
  return {
    repoRoot,
    input,
    close: () => fs.rmSync(repoRoot, { recursive: true, force: true }),
  };
}

const clone = (value) => structuredClone(value);

const expectCode = (fn, code) => assert.throws(
  fn,
  (error) => error?.name === "NodeBenchmarkIdentityError" && error.code === code,
);

test("identity hashes every nested generated package file", () => {
  const current = fixture();
  try {
    const before = createNodeBenchmarkIdentity(current.input);
    const inlineBefore = before.candidate.generatedFiles.find(
      (file) => file.path === "web/pkg/snippets/runtime/inline0.js",
    );
    assert.ok(inlineBefore, "recursive package identity must include inline0.js");
    assert.deepEqual(
      before.candidate.generatedFiles.map((file) => file.path),
      [
        "web/pkg/snippets/runtime/inline0.js",
        "web/pkg/wasm_vm_bg.wasm",
        "web/pkg/wasm_vm.js",
      ],
    );

    write(current.repoRoot, "web/pkg/snippets/runtime/inline0.js", "export const inline = 2;\n");
    const after = createNodeBenchmarkIdentity(current.input);
    const inlineAfter = after.candidate.generatedFiles.find(
      (file) => file.path === "web/pkg/snippets/runtime/inline0.js",
    );
    assert.notEqual(after.identitySha256, before.identitySha256);
    assert.notEqual(inlineAfter.sha256, inlineBefore.sha256);
  } finally {
    current.close();
  }
});

test("only explicit evidence and Node asset roots may contain nonignored untracked files", () => {
  const current = fixture();
  try {
    assert.doesNotThrow(() => createNodeBenchmarkIdentity(current.input));
    write(current.repoRoot, "web/runtime-cache.bin", "not allowed\n");
    expectCode(() => createNodeBenchmarkIdentity(current.input), "unexpected-untracked");
  } finally {
    current.close();
  }
});

test("tracked changes fail closed even when they are beneath an allowed root", () => {
  const current = fixture();
  try {
    write(current.repoRoot, "web/playwright.config.js", "dirty tracked input\n");
    expectCode(() => createNodeBenchmarkIdentity(current.input), "tracked-tree-dirty");
  } finally {
    current.close();
  }
});

test("required harness sources must exist and be tracked", async (t) => {
  await t.test("missing tracked source", () => {
    const current = fixture();
    try {
      fs.unlinkSync(path.join(current.repoRoot, "tools/serve-dev.sh"));
      expectCode(() => createNodeBenchmarkIdentity(current.input), "source-missing");
    } finally {
      current.close();
    }
  });

  await t.test("source removed from the index", () => {
    const current = fixture();
    try {
      git(current.repoRoot, "rm", "--cached", "-q", "tools/serve-dev.sh");
      expectCode(() => createNodeBenchmarkIdentity(current.input), "source-not-tracked");
    } finally {
      current.close();
    }
  });
});

test("Node manifest bytes are hashed and must match the declared immutable digest", () => {
  const current = fixture();
  try {
    const before = createNodeBenchmarkIdentity(current.input);
    assert.equal(before.guest.nodeManifest.sha256, current.input.expectedNodeManifestSha256);
    write(current.repoRoot, ".node-assets/manifest.json", "different manifest\n");
    expectCode(() => createNodeBenchmarkIdentity(current.input), "node-manifest-mismatch");

    const changed = clone(current.input);
    changed.expectedNodeManifestSha256 = sha256(Buffer.from("different manifest\n"));
    const after = createNodeBenchmarkIdentity(changed);
    assert.notEqual(after.identitySha256, before.identitySha256);
  } finally {
    current.close();
  }
});

test("every resumability metadata boundary changes the identity hash", async (t) => {
  const current = fixture();
  try {
    const baseline = createNodeBenchmarkIdentity(current.input);
    const cases = [
      ["plan", (input) => { input.plan[0].passIndex = 9; }],
      ["max attempts", (input) => { input.policy.maxAttemptsPerSlot = 4; }],
      ["URL", (input) => { input.policy.urls["p0:worker-interp"] += "&assetBase=/other"; }],
      ["policy", (input) => { input.policy.processTimeoutMs += 1; }],
      ["Node runtime", (input) => { input.runtimeMetadata.nodeVersion = "v24.6.0"; }],
      ["Playwright", (input) => { input.playwrightMetadata.version = "1.56.0"; }],
      ["browser type", (input) => { input.browserMetadata.type = "chromium-beta"; }],
      ["browser version", (input) => { input.browserMetadata.version = "140.0.2"; }],
      ["browser headless mode", (input) => { input.browserMetadata.headless = true; }],
      ["OS platform", (input) => { input.hostMetadata.platform = "linux"; }],
      ["OS release", (input) => { input.hostMetadata.release = "25.1.0"; }],
      ["architecture", (input) => { input.hostMetadata.arch = "x64"; }],
      ["CPU model", (input) => { input.hostMetadata.cpuModels = ["Apple M4 Max"]; }],
      ["CPU count", (input) => { input.hostMetadata.logicalCpus = 14; }],
    ];
    for (const [label, mutate] of cases) {
      await t.test(label, () => {
        const input = clone(current.input);
        mutate(input);
        assert.notEqual(createNodeBenchmarkIdentity(input).identitySha256, baseline.identitySha256);
      });
    }

    await t.test("browser executable", () => {
      write(current.repoRoot, ".node-assets/browser", "browser-v2\n");
      assert.notEqual(
        createNodeBenchmarkIdentity(current.input).identitySha256,
        baseline.identitySha256,
      );
      write(current.repoRoot, ".node-assets/browser", "browser-v1\n");
    });

    await t.test("commit HEAD", () => {
      git(current.repoRoot, "commit", "--allow-empty", "-qm", "same files, new head");
      assert.notEqual(
        createNodeBenchmarkIdentity(current.input).identitySha256,
        baseline.identitySha256,
      );
    });
  } finally {
    current.close();
  }
});

test("kernel, snapshot, and overlay guest digests are explicit identity inputs", () => {
  const current = fixture();
  try {
    let prior = createNodeBenchmarkIdentity(current.input);
    const fields = [
      ["kernel", "kernelSha256", "a"],
      ["bootSnapshot", "bootSnapshotSha256", "b"],
      ["overlayDelta", "overlayDeltaSha256", "c"],
    ];
    for (const [artifact, identityField, fill] of fields) {
      const manifest = JSON.parse(fs.readFileSync(
        path.join(current.repoRoot, "web/artifacts-node-alpine.json"),
        "utf8",
      ));
      manifest.artifacts[artifact].sha256 = fill.repeat(64);
      write(
        current.repoRoot,
        "web/artifacts-node-alpine.json",
        `${JSON.stringify(manifest)}\n`,
      );
      git(current.repoRoot, "add", "web/artifacts-node-alpine.json");
      git(current.repoRoot, "commit", "-qm", `change ${artifact} digest`);
      const next = createNodeBenchmarkIdentity(current.input);
      assert.equal(next.guest[identityField], fill.repeat(64));
      assert.notEqual(next.identitySha256, prior.identitySha256);
      prior = next;
    }
  } finally {
    current.close();
  }
});
