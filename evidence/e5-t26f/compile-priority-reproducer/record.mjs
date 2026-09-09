// One offline native invocation; preserve streams separately and authenticate source before/after.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const directory = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(directory, "../../..");
const relative = path.relative(root, directory);
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const sources = ["Cargo.toml", "Cargo.lock", ".cargo/config.toml", "crates/core/Cargo.toml",
  "crates/core/src/lib.rs", "crates/core/src/dispatch.rs", "crates/core/src/compile_queue.rs",
  "crates/core/src/decode.rs", `${relative}/Cargo.toml`, `${relative}/src/main.rs`, `${relative}/record.mjs`];
const pins = () => Object.fromEntries(sources.map(file => [file, hash(readFileSync(path.join(root, file)))]));
const sourcePins = pins();
for (const file of ["run.log", "provenance.json"]) assert.equal(existsSync(path.join(directory, file)), false, `refusing overwrite ${file}`);
const head = spawnSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" });
assert.equal(head.status, 0);
const rustc = spawnSync("rustc", ["--version"], { cwd: root, encoding: "utf8" });
assert.equal(rustc.status, 0);
const args = ["run", "--offline", "--manifest-path", `${relative}/Cargo.toml`, "--target-dir", `${relative}/target`];
const startedAt = new Date().toISOString();
const result = spawnSync("cargo", args, { cwd: root, encoding: "utf8", timeout: 120_000, maxBuffer: 2 * 1024 * 1024 });
const finishedAt = new Date().toISOString();
const log = `command: cargo ${args.join(" ")}\ncwd: ${root}\n--- stdout (raw) ---\n${result.stdout ?? ""}--- stderr (raw) ---\n${result.stderr ?? ""}`;
writeFileSync(path.join(directory, "run.log"), log, { flag: "wx" });
const unchanged = JSON.stringify(pins()) === JSON.stringify(sourcePins);
writeFileSync(path.join(directory, "provenance.json"), JSON.stringify({
  schema: "wasm-vm.e5-t26f.compile-priority-reproducer.v1", acceptance: false,
  head: head.stdout.trim(), rustc: rustc.stdout.trim(), cwd: root,
  command: ["cargo", ...args], startedAt, finishedAt, status: result.status, signal: result.signal,
  error: result.error?.message ?? null, sourcePins, sourceBytesUnchanged: unchanged,
  localLockSha256: existsSync(path.join(directory, "Cargo.lock")) ? hash(readFileSync(path.join(directory, "Cargo.lock"))) : null,
  logSha256: hash(log),
}, null, 2) + "\n", { flag: "wx" });
process.stdout.write(log);
assert.equal(unchanged, true, "source changed during recording");
assert.equal(result.error, undefined);
assert.equal(result.signal, null);
assert.equal(result.status, 0);
