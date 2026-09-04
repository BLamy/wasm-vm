#!/usr/bin/env node

// E5-T09c: deterministic fake-rAF proof of the bounded browser presentation scheduler. The
// integration workload and hidden-tab fallback belong to E5-T09d/e; independent machines, WebKit,
// and host rr are outside this task's acceptance boundary.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const outputPath = parseOutputPath(process.argv.slice(2));
const command = ["node", ["--test", "web/tests/e5-t09c-present-scheduler.test.mjs"]];
const proofFiles = [
  "Makefile",
  "web/main.js",
  "web/src/sink/frame-scheduler.js",
  "web/src/sink/frame-scheduler.ts",
  "web/src/sink/presentation.js",
  "web/tests/e5-t09c-present-scheduler.test.mjs",
  "tools/verify/e5-t09c-present-scheduler.mjs",
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
    outputTail: output.slice(-4_000),
    error: result.error?.message || null,
  };
}

const result = runCommand(command);
const evidence = {
  schema: "wasm-vm.e5-t09c.present-scheduler.v1",
  task: "E5-T09c",
  status: result.status,
  gitHead: gitHead(),
  commands: [result],
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
if (result.status !== "passed") process.exitCode = 1;
