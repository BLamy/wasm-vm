#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { main } from "./omarchy-desktop-services.mjs";
import { assertGuestMode, assertModeWire } from "./omarchy-render-mode.mjs";

const output = process.argv[2];
const { report } = await main(output, { renderBudget: true });
const mode = report.renderBudget;
assert.ok(mode, "no actual modeset attempt was recorded");
assert.equal(mode.requestCount, 1);
assert.equal(mode.deadlineAtMs, Date.parse(report.startup.deadlineAt));
assertModeWire(report);
let outcome;
if (mode.status === "mode-not-observed") {
  assert.equal(report.keyboard, undefined, "input cannot precede mode adoption");
  assert.equal(report.trial.outcome, "startup-failed-input-not-tested");
  outcome = "mode-not-observed-input-not-tested";
} else {
  assert.equal(mode.status, "guest-mode-observed");
  assertGuestMode(mode.after, mode.before.presentation);
  assert.ok(Date.parse(mode.observedAt) < mode.deadlineAtMs);
  assert.ok(Date.parse(report.keyboard.startedAt) >= Date.parse(mode.observedAt));
  assert.equal(report.keyboard.deadlineMs, 120000);
  outcome = report.result === "input-trial-physical-nonce-and-fresh-presentation"
    ? "physical-input-and-presentation-passed" : "physical-input-failed";
}
await fs.writeFile(path.join(output, "render-budget.json"), JSON.stringify({
  outcome, mode, input: report.keyboard ?? null,
  desktopAcceptance: outcome === "physical-input-and-presentation-passed",
  limitation: "A diagnostic outcome is not product promotion or a complete rendering-causality claim.",
}, null, 2) + "\n");
console.log(JSON.stringify({ outcome }));
process.exitCode = 0; // Complete diagnostic receipt; the nested desktop verdict remains unchanged.
