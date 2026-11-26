#!/usr/bin/env node
// E5-T37b verifier round 2: the last acceptance bullet, on the committed bundle after the flip.
// One load of the built demo page (web/dist, served here on an ephemeral port): the in-browser
// suite reaches its full count with 0 failed, no page/console/HTTP errors (a favicon 404 aside),
// and the roadmap row for this task shows `verified`.
//
//   node evidence/e5-t37b/verifier-r2/demo-row.mjs      (writes demo-row.json and demo-row.png beside itself)
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "../../..");
const root = path.join(repo, "web/dist");
const ROW = "Replay desktop keeps real time while idle and lets its worker sleep";
const { RISCV_TESTS } = await import(pathToFileURL(path.join(root, "riscv-tests.js")));
const expectedTotal = String(RISCV_TESTS.length);
const sha = async (f) => createHash("sha256").update(await readFile(path.join(root, f))).digest("hex");

const server = createServer(async (request, response) => {
  const pathname = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
  const file = path.resolve(root, `.${pathname}`);
  if (!file.startsWith(`${root}/`)) { response.writeHead(404).end(); return; }
  try {
    const data = await readFile(pathname === "/artifacts-alpine.json" ? path.join(repo, "web/artifacts-alpine.json") : file);
    const types = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".wasm": "application/wasm", ".json": "application/json", ".css": "text/css" };
    response.writeHead(200, { "Content-Type": types[path.extname(file)] || "application/octet-stream",
      "Cross-Origin-Opener-Policy": "same-origin", "Cross-Origin-Embedder-Policy": "require-corp" });
    response.end(data);
  } catch { response.writeHead(404).end(); }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const { chromium } = await import(pathToFileURL(path.join(repo, "web/node_modules/playwright/index.mjs")));
const browser = await chromium.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true });
let result;
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1050 }, serviceWorkers: "block" });
  const errors = [], httpErrors = [], favicon = [];
  page.on("pageerror", (failure) => errors.push(String(failure)));
  page.on("response", (response) => {
    if (response.status() < 400) return;
    (response.url().endsWith("/favicon.ico") ? favicon : httpErrors).push({ url: response.url(), status: response.status() });
  });
  page.on("console", (message) => {
    if (message.type() === "error" && !message.location().url?.endsWith("/favicon.ico")) errors.push({ text: message.text(), url: message.location().url });
  });
  await page.goto(`${base}/app.html?noAutoBoot=1`);
  await page.waitForFunction(() => document.getElementById("suite-run")?.disabled === false, null, { timeout: 60_000 });
  await page.locator("#suite-run").evaluate((element) => element.click());
  await page.waitForFunction((total) => document.querySelector("#metric-done")?.textContent.trim() === total
    && document.getElementById("suite-run")?.disabled === false, expectedTotal, { timeout: 120_000 });
  const metrics = await page.evaluate(() => Object.fromEntries(["metric-pass", "metric-fail", "metric-done"].map((id) => [id, document.getElementById(id)?.textContent.trim()])));
  const row = page.locator(".cap").filter({ has: page.locator(".cap-name", { hasText: ROW }) });
  const rows = await row.count();
  const pipClass = rows === 1 ? await row.locator(".cap-pip").getAttribute("class") : null;
  const text = rows === 1 ? await row.innerText() : null;
  // The capability panel is kept in the page hidden (app.html: #legacy-roadmap); the pip's class
  // is what the page binds the status to, and what the repo's demo-suite.mjs reads.
  const rowVisible = rows === 1 ? await row.isVisible() : null;
  const ledger = JSON.parse(await readFile(path.join(root, "tasks.json"), "utf8"));
  const find = (o) => { if (Array.isArray(o)) { for (const x of o) { const r = find(x); if (r) return r; } } else if (o && typeof o === "object") { if (o.id === "E5-T37b") return o; for (const v of Object.values(o)) { const r = find(v); if (r) return r; } } return null; };
  const ledgerStatus = find(ledger)?.status ?? null;
  const screenshot = await page.screenshot({ path: path.join(here, "demo-row.png") });
  result = {
    head: execFileSync("git", ["-C", repo, "rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
    distCleanAgainstHead: execFileSync("git", ["-C", repo, "status", "--porcelain", "--", "web/dist"], { encoding: "utf8" }).trim() === "",
    at: new Date().toISOString(), url: `${base}/app.html?noAutoBoot=1`, browser: browser.version(),
    bundle: { "pkg/wasm_vm_wasm_bg.wasm": await sha("pkg/wasm_vm_wasm_bg.wasm"), "roadmap.js": await sha("roadmap.js"), "loader.js": await sha("loader.js") },
    expectedTotal, metrics, row: { name: ROW, matches: rows, pipClass, visibleOnThisPage: rowVisible, text }, tasksJsonStatus: ledgerStatus, errors, httpErrors, favicon404: favicon.length,
    screenshotSha256: createHash("sha256").update(screenshot).digest("hex"),
  };
  await writeFile(path.join(here, "demo-row.json"), `${JSON.stringify(result, null, 2)}\n`);
  assert.deepEqual(metrics, { "metric-pass": expectedTotal, "metric-fail": "0", "metric-done": expectedTotal });
  assert.equal(rows, 1, "the row is on the page once");
  assert.equal(pipClass, "cap-pip verified");
  assert.equal(ledgerStatus, "verified", "the bundle's task ledger");
  assert.deepEqual(errors, []);
  assert.deepEqual(httpErrors, []);
  console.log(JSON.stringify({ head: result.head, metrics, pipClass, errors: errors.length, httpErrors: httpErrors.length, favicon404: favicon.length }));
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
