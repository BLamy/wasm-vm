#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { pins, pinned, inspectPausedRam } from "./omarchy-wait-checkpoint.mjs";
import { assertFailedInput } from "./omarchy-failure-checkpoint.mjs";
import { assertInputTrialSource } from "./omarchy-input-trial.mjs";

const [input, output] = process.argv.slice(2);
assert.ok(input && output, "usage: omarchy-input-wait-inspect.mjs RECORDED_TRIAL NEW_OUTPUT_DIR");
assert.ok(!fs.existsSync(output), "output must be new");
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
const reportBytes = fs.readFileSync(path.join(input, "desktop/report.json")), report = JSON.parse(reportBytes);
assertFailedInput(report); assertInputTrialSource(report.candidate.source);
assert.equal(report.failureCheckpoint.status, "captured");
assert.equal(report.cleanup.closed, true);
const capture = report.failureCheckpoint.snapshot;
const compressed = pinned(fs.readFileSync(capture.file), capture.compressedSha256, "captured RAM gzip");
const ram = pinned(gunzipSync(compressed, { maxOutputLength: 1024 ** 3 }), capture.sha256, "captured RAM");
assert.equal(ram.length, 1024 ** 3);
assert.equal(capture.stateDigestBefore, sha(ram)); assert.equal(capture.stateDigestAfter, sha(ram));
const layout = JSON.parse(pinned(fs.readFileSync("evidence/omarchy-profile/checkpoint-wait-layout/layout.json"), pins.layout, "layout"));
const image = pinned(fs.readFileSync("releases/kernel/6.6.63/Image"), layout.kernelFiles["arch/riscv/boot/Image"], "kernel");
const map = pinned(fs.readFileSync("releases/kernel/6.6.63/System.map"), layout.kernelFiles["System.map"], "map").toString();
const result = inspectPausedRam(ram, image, map, layout);
const earlierBytes = pinned(fs.readFileSync("evidence/omarchy-profile/checkpoint-wait-r1/checkpoint.json"),
  "1278b8bdd81471590bbb37cccdf6c392c09132fd0bfc24f274b26981cfb1b49a", "earlier evidence");
const earlier = JSON.parse(earlierBytes);
const comparisons = result.targets.map(target => {
  const before = earlier.result.targets.find(t => t.pid === target.pid && t.tgid === target.tgid);
  assert.ok(before, "target identity changed");
  assert.equal(BigInt(before.startBoottimeNs), target.startBoottimeNs, "target PID was reused");
  return { pid: target.pid, tgid: target.tgid, sameStartBoottime: true,
    earlierState: before.state, state: target.state, earlierWait: before.wait?.address ?? null,
    wait: target.wait?.address ?? null, earlierSavedPc: before.trap?.PT_EPC.value ?? null,
    savedPc: target.trap?.PT_EPC.value ?? null, contextKind: target.contextKind ?? "saved off-CPU switch and user trap" };
});
fs.mkdirSync(output);
fs.writeFileSync(path.join(output, "checkpoint.json"), JSON.stringify({
  head: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
  command: process.argv, report: { path: path.join(input, "desktop/report.json"), sha256: sha(reportBytes) },
  ram: { path: capture.file, sha256: sha(ram), compressedSha256: sha(compressed) },
  layoutSha256: pins.layout, kernelSha256: sha(image), comparisons, result,
}, (_, value) => typeof value === "bigint" ? `0x${value.toString(16)}` : value, 2) + "\n");
console.log(JSON.stringify(comparisons));
