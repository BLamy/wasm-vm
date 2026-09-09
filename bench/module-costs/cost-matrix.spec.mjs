// E4-T19 cross-browser cost matrix (Playwright). For each configured browser project it loads the
// harness page, runs the full WebAssembly.compile/instantiate/instance-cliff matrix in-page, and
// writes the result JSON to results/<project>.json. One command (`./run.sh`) runs all three engines.
//
// The committed JSON is a real capture from the pinned Playwright engines. An optional
// `chromium-system` project can be selected by the config for a separately installed browser.

import { test } from "@playwright/test";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { writeFileSync, mkdirSync } from "node:fs";

const __dirname = dirname(fileURLToPath(import.meta.url));

function configuredCliffTargets() {
  const raw = process.env.E4_T19_CLIFF_TARGETS;
  if (!raw) return undefined;
  const targets = raw.split(",").map((value) => Number(value.trim()));
  if (targets.length === 0 || targets.some((target) => !Number.isSafeInteger(target) || target < 1)) {
    throw new Error(`E4_T19_CLIFF_TARGETS must be comma-separated positive integers: ${raw}`);
  }
  return targets;
}

test("wasm module cost matrix", async ({ page, browser }, testInfo) => {
  // Surface page console into the Playwright log so a dev run is legible.
  page.on("console", (m) => console.log(`[page] ${m.text()}`));
  await page.goto("/harness.html");
  await page.waitForFunction(() => typeof window.__runCostMatrix === "function");
  // The canonical cliff test instantiates up to 10k modules. An opt-in target list supports a
  // bounded higher-limit confirmation without changing the clean-checkout default.
  const cliffTargets = configuredCliffTargets();
  const result = await page.evaluate(
    (targets) => window.__runCostMatrix(targets ? { cliffTargets: targets } : {}),
    cliffTargets,
  );
  result.project = testInfo.project.name;
  result.playwrightBrowserVersion = browser.version();
  const outDir = resolve(__dirname, process.env.E4_T19_RESULTS_DIR || "results");
  mkdirSync(outDir, { recursive: true });
  const out = join(outDir, `${testInfo.project.name}.json`);
  writeFileSync(out, JSON.stringify(result, null, 2));
  console.log(`wrote ${out}`);
});
