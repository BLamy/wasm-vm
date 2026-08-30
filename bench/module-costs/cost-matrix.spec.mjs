// E4-T19 cross-browser cost matrix (Playwright). For each configured browser project it loads the
// harness page, runs the full WebAssembly.compile/instantiate/instance-cliff matrix in-page, and
// writes the result JSON to results/<project>.json. One command (`./run.sh`) runs all three engines.
//
// The committed JSON is a real capture from the pinned Playwright engines. An optional
// `chromium-system` project can be selected by the config for a separately installed browser.

import { test } from "@playwright/test";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { writeFileSync, mkdirSync } from "node:fs";

const __dirname = dirname(fileURLToPath(import.meta.url));

test("wasm module cost matrix", async ({ page, browser }, testInfo) => {
  // Surface page console into the Playwright log so a dev run is legible.
  page.on("console", (m) => console.log(`[page] ${m.text()}`));
  await page.goto("/harness.html");
  await page.waitForFunction(() => typeof window.__runCostMatrix === "function");
  // The cliff test instantiates up to 10k modules; give it room.
  const result = await page.evaluate(() => window.__runCostMatrix(), null, { timeout: 300_000 });
  result.project = testInfo.project.name;
  result.playwrightBrowserVersion = browser.version();
  const outDir = join(__dirname, "results");
  mkdirSync(outDir, { recursive: true });
  const out = join(outDir, `${testInfo.project.name}.json`);
  writeFileSync(out, JSON.stringify(result, null, 2));
  console.log(`wrote ${out}`);
});
