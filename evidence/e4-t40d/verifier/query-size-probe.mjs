#!/usr/bin/env node
// E4-T40d verifier probe (not a product test): load the committed Replay desktop page with
// several ?decodedCacheEntries values and record what the page actually does.
//
//   node evidence/e4-t40d/verifier/query-size-probe.mjs [BASE] > evidence/e4-t40d/verifier/query-size-probe.json
//
// For each case: every HTTP response with status >= 400 (to name the one 404 the latency tool
// reports without a URL), every console error with its source URL, page errors, the
// `wvm:desktop-ready` / `wvm:guest-error` lifecycle events, the #status text, and the machine's
// own jitStats / schedulerStats sampled twice (so "no guest execution" is a measured zero, not
// an absence of a reading).
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const base = (process.argv[2] ?? "http://127.0.0.1:8125").replace(/\/+$/u, "");
const { chromium } = await import(pathToFileURL(path.join(repo, "web/node_modules/playwright/index.mjs")));
const browser = await chromium.launch({
  executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true });

// expect: "boot" (desktop must become ready at `size`) or "fail" (must not run a guest).
const cases = [
  { name: "default", query: "", expect: "boot", size: 262144 },
  { name: "65536", query: "&decodedCacheEntries=65536", expect: "fail" },
  { name: "empty", query: "&decodedCacheEntries=", expect: "fail" },
  { name: "262144.0", query: "&decodedCacheEntries=262144.0", expect: "fail" },
  { name: "1048576", query: "&decodedCacheEntries=1048576", expect: "fail" },
  { name: "4096", query: "&decodedCacheEntries=4096", expect: "boot", size: 4096 },
];

const out = { base, browser: browser.version(), startedAt: new Date().toISOString(), cases: [] };
for (const c of cases) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, serviceWorkers: "block" });
  const httpErrors = [], consoleErrors = [], pageErrors = [];
  page.on("response", (r) => { if (r.status() >= 400) httpErrors.push({ status: r.status(), url: r.url() }); });
  page.on("console", (m) => { if (m.type() === "error") consoleErrors.push({ text: m.text().slice(0, 300), url: m.location()?.url ?? null }); });
  page.on("pageerror", (e) => pageErrors.push(String(e).slice(0, 300)));
  await page.addInitScript(() => {
    window.__probe = { ready: null, errors: [] };
    window.addEventListener("wvm:desktop-ready", () => { window.__probe.ready = performance.now(); });
    window.addEventListener("wvm:guest-error", (e) => { window.__probe.errors.push({ at: performance.now(), message: e.detail?.message ?? null }); });
  });
  const url = `${base}/app.html?guest=replay-desktop&desktop=1${c.query}#ide`;
  await page.goto(url);
  // A boot is ready within a few seconds on this server; a refused option must stay refused, so
  // the failing cases are watched for 30 s rather than sampled the moment the error appears.
  if (c.expect === "boot") {
    await page.waitForFunction(() => window.__probe.ready !== null || window.__probe.errors.length > 0, null, { timeout: 180_000, polling: 250 });
    await page.waitForTimeout(3000);
  } else {
    await page.waitForTimeout(30_000);
  }
  const sample = () => page.evaluate(async () => {
    const jit = await (async () => { try { return await window.__jitStats?.() ?? null; } catch (e) { return { threw: String(e) }; } })();
    const sched = await (async () => { try { return await window.__schedulerStats?.() ?? null; } catch (e) { return { threw: String(e) }; } })();
    return {
      at: Math.round(performance.now()),
      ready: window.__probe.ready, guestErrors: window.__probe.errors,
      isGuestUp: window.wvmDemo?.isGuestUp?.() ?? null,
      hasJitStatsHook: typeof window.__jitStats === "function",
      decodedCacheEntries: jit?.decodedCacheEntries ?? null,
      blockBuilds: jit?.blockBuilds ?? null,
      retiredInstructions: sched?.retiredInstructions ?? null,
      status: document.getElementById("status")?.textContent ?? null,
      overlayHidden: document.getElementById("omarchy-boot-overlay")?.hidden ?? null,
    };
  });
  const first = await sample();
  await page.waitForTimeout(2000);
  const second = await sample();
  await page.screenshot({ path: path.join(repo, `evidence/e4-t40d/verifier/query-size-probe-${c.name}.png`) }).catch(() => {});
  out.cases.push({ ...c, url, httpErrors, consoleErrors, pageErrors, first, second });
  await page.close();
}
out.finishedAt = new Date().toISOString();
await browser.close();
console.log(JSON.stringify(out, null, 2));
