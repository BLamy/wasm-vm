#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { main } from "./omarchy-desktop-services.mjs";
import { compositorModeOutcome } from "./omarchy-compositor-command.mjs";

const output = process.argv[2];
const { report } = await main(output, { renderBudget: true, compositorMode: true });
const outcome = compositorModeOutcome(report);
await fs.writeFile(path.join(output, "compositor-mode.json"), JSON.stringify({
  outcome, command: report.compositorMode, mode: report.renderBudget,
  input: report.keyboard ?? null,
  desktopAcceptance: outcome === "physical-input-and-presentation-passed",
}, null, 2) + "\n");
console.log(JSON.stringify({ outcome }));
process.exitCode = 0; // A complete diagnostic preserves the nested desktop verdict.
