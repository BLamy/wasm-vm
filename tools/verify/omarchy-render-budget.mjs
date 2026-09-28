#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { main } from "./omarchy-desktop-services.mjs";
import { renderBudgetOutcome } from "./omarchy-render-mode.mjs";

const output = process.argv[2];
const { report } = await main(output, { renderBudget: true });
const mode = report.renderBudget;
const outcome = renderBudgetOutcome(report);
await fs.writeFile(path.join(output, "render-budget.json"), JSON.stringify({
  outcome, mode, input: report.keyboard ?? null,
  desktopAcceptance: outcome === "physical-input-and-presentation-passed",
  limitation: "A diagnostic outcome is not product promotion or a complete rendering-causality claim.",
}, null, 2) + "\n");
console.log(JSON.stringify({ outcome }));
process.exitCode = 0; // Complete diagnostic receipt; the nested desktop verdict remains unchanged.
