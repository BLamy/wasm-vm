#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { gunzipSync } from "node:zlib";
import { main } from "./omarchy-desktop-services.mjs";
import { assertFailedInput } from "./omarchy-failure-checkpoint.mjs";

const output = process.argv[2];
const { report } = await main(output, { failureCheckpoint: true });
const capture = report.failureCheckpoint;
assertFailedInput(report);
assert.equal(capture?.status, "captured", "actual failed-input snapshot was not captured");
const raw = gunzipSync(await fs.readFile(capture.snapshot.file), { maxOutputLength: 2 * 1024 ** 3 });
assert.equal(raw.length, capture.snapshot.bytes);
assert.equal(createHash("sha256").update(raw).digest("hex"), capture.snapshot.sha256);
assert.equal(raw.length, 1024 ** 3);
const digest = bytes => createHash("sha256").update(bytes).digest("hex");
await fs.writeFile(path.join(output, "ram-capture.json"), JSON.stringify({
  result: "coherent failed-input diagnostic captured; desktop acceptance remains failed",
  ram: { bytes: raw.length, sha256: digest(raw) }, inputResult: report.result,
  limitation: "RAM only. Current CPU registers and device state were not exported; not a reusable snapshot pair.",
}, null, 2) + "\n");
console.log("FAILED_INPUT_STATE_CAPTURED (desktop acceptance still failed)");
// This command's criterion is diagnostic capture. The nested run retains its failure.
process.exitCode = 0;
