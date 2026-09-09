#!/usr/bin/env node

// E5-T09a: deterministic guest-side damage-coalescer proof.  The acceptance boundary is the
// local Rust core plus its wasm target; independent machines, WebKit, and host rr are excluded by
// the task policy and user scope.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const outputPath = parseOutputPath(process.argv.slice(2));
const commands = [
  ["cargo", ["fmt", "--all", "--", "--check"]],
  ["cargo", ["clippy", "-p", "wasm-vm-core", "--lib", "--tests", "--", "-D", "warnings"]],
  ["cargo", ["test", "-p", "wasm-vm-core", "--lib"]],
  ["cargo", ["test", "-p", "wasm-vm-core", "--test", "virtio_gpu_machine"]],
  ["cargo", ["build", "-p", "wasm-vm-wasm", "--target", "wasm32-unknown-unknown"]],
];
const proofFiles = [
  "Makefile",
  "crates/core/src/dev/virtio/gpu/damage.rs",
  "crates/core/src/dev/virtio/gpu/mod.rs",
  "crates/core/src/dev/virtio/gpu/resources.rs",
  "tools/verify/e5-t09a-damage-coalescer.mjs",
];

function parseOutputPath(args) {
  const index = args.indexOf("--output");
  if (index >= 0) {
    if (!args[index + 1]) throw new Error("--output requires a path");
    return path.resolve(repo, args[index + 1]);
  }
  const equals = args.find((arg) => arg.startsWith("--output="));
  return equals ? path.resolve(repo, equals.slice("--output=".length)) : null;
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function gitHead() {
  const result = spawnSync("git", ["rev-parse", "HEAD"], {
    cwd: repo,
    encoding: "utf8",
  });
  if (result.status !== 0) throw new Error(result.stderr || "git rev-parse failed");
  return result.stdout.trim();
}

function runCommand([program, args]) {
  const startedAt = Date.now();
  const result = spawnSync(program, args, {
    cwd: repo,
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  });
  const output = `${result.stdout || ""}${result.stderr || ""}`;
  return {
    command: [program, ...args].join(" "),
    status: result.status === 0 ? "passed" : "failed",
    exitCode: result.status,
    signal: result.signal,
    durationMs: Date.now() - startedAt,
    outputSha256: sha256(output),
    outputTail: output.slice(-2_000),
    error: result.error?.message || null,
  };
}

const results = [];
let status = "passed";
for (const command of commands) {
  const result = runCommand(command);
  results.push(result);
  if (result.status !== "passed") {
    status = "failed";
    break;
  }
}

const evidence = {
  schema: "wasm-vm.e5-t09a.damage-coalescer.v1",
  task: "E5-T09a",
  status,
  gitHead: gitHead(),
  commands: results,
  proofFiles: Object.fromEntries(
    proofFiles.map((file) => [file, sha256(fs.readFileSync(path.join(repo, file)))]),
  ),
  scope: {
    independentMachines: false,
    webkit: false,
    hostRr: false,
  },
};

if (outputPath) {
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(evidence, null, 2)}\n`);
}

console.log(JSON.stringify(evidence, null, 2));
if (status !== "passed") process.exitCode = 1;
