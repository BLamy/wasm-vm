// E0-T29 evidence (copied from ../workspace/ for the PR 626 run; traces go to target/): run the in-browser riscv-tests suite once through its real "Run tests" button
// (reachable on the ?testHooks show-all path) and record the counts and the pips.
// Usage: node riscv-suite.mjs <base-url> <out-dir>
import { chromium } from "../../../web/node_modules/@playwright/test/index.mjs";
const [, , base, out] = process.argv;
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1280, height: 1000 } });
await ctx.tracing.start({ screenshots: true, snapshots: false });
const p = await ctx.newPage();
const errors = [];
p.on("pageerror", (e) => errors.push(e.message));
p.on("console", (m) => m.type() === "error" && !m.text().startsWith("Failed to load resource") && errors.push(m.text()));
await p.goto(`${base}/index.html?nosw&noAutoBoot=1&testHooks=1`);
const run = p.locator("#suite-run");
await run.waitFor({ state: "visible" });
await p.waitForFunction(() => !document.getElementById("suite-run").disabled, null, { timeout: 120000 });
const total = await p.evaluate(() => document.querySelectorAll(".test-dot").length);
await run.click();
await p.waitForFunction(() => {
  const dots = [...document.querySelectorAll(".test-dot")];
  return dots.length > 0 && dots.every((d) => !["pending", "running"].includes(d.dataset.status));
}, null, { timeout: 900000, polling: 1000 });
const counts = await p.evaluate(() => {
  const c = {};
  for (const d of document.querySelectorAll(".test-dot")) c[d.dataset.status] = (c[d.dataset.status] ?? 0) + 1;
  return c;
});
const failures = await p.evaluate(() => [...document.querySelectorAll('.test-dot:not([data-status="pass"])')].map((d) => `${d.dataset.name}:${d.dataset.status}`));
await p.locator("#panel-tests").screenshot({ path: `${out}/riscv-suite-pips.png` });
await ctx.tracing.stop({ path: `${out}/riscv-suite-trace.zip` });
console.log(JSON.stringify({ total, counts, failures, errors }, null, 1));
await b.close();
