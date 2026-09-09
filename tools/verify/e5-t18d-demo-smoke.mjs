#!/usr/bin/env node
// One built-demo load: actual in-browser ISA suite plus the visible task-roadmap entry.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createHash } from "node:crypto";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const root = path.join(repo, "web/dist");
const out = path.resolve(process.env.E5_T18D_EVIDENCE_DIR || path.join(repo, "evidence/e5-t18d"));
let server;
let base = process.env.E5_T18D_DEMO_URL;
if (!base) {
  server = createServer(async (request, response) => {
    const pathname = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
    const file = path.resolve(root, `.${pathname}`);
    if (!file.startsWith(`${root}/`)) { response.writeHead(404).end(); return; }
    try {
      const data = await readFile(file);
      const types = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".wasm": "application/wasm", ".json": "application/json", ".css": "text/css" };
      response.writeHead(200, { "Content-Type": types[path.extname(file)] || "application/octet-stream",
        "Cross-Origin-Opener-Policy": "same-origin", "Cross-Origin-Embedder-Policy": "require-corp" });
      response.end(data);
    } catch { response.writeHead(404).end(); }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${server.address().port}`;
}
const { chromium } = await import(pathToFileURL(path.join(repo, "web/node_modules/playwright/index.mjs")));
const browser = await chromium.launch({ executablePath: process.env.E5_T18D_CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1050 }, serviceWorkers: "block" });
  const errors = [], consoleLog = [], httpErrors = [];
  page.on("pageerror", (failure) => errors.push(String(failure)));
  page.on("response", (response) => { if (response.status() >= 400 && !response.url().endsWith("/favicon.ico")) httpErrors.push({ url: response.url(), status: response.status() }); });
  page.on("console", (message) => {
    const entry = { type: message.type(), text: message.text(), url: message.location().url };
    consoleLog.push(entry);
    if (entry.type === "error" && !entry.url?.endsWith("/favicon.ico")) errors.push(entry);
  });
  await page.goto(`${base}/app.html?noAutoBoot=1`);
  await page.waitForFunction(() => document.getElementById("suite-run")?.disabled === false, null, { timeout: 60_000 });
  await page.locator("#suite-run").evaluate((element) => element.click());
  await page.waitForFunction(() => document.querySelector("#metric-done")?.textContent.trim() === "126", null, { timeout: 120_000 });
  const metrics = await page.evaluate(() => Object.fromEntries(["metric-pass", "metric-fail", "metric-done"].map((id) => [id, document.getElementById(id)?.textContent.trim()])));
  assert.deepEqual(metrics, { "metric-pass": "126", "metric-fail": "0", "metric-done": "126" });
  await page.locator("#rm-search").fill("E5-T18d");
  await page.locator(".rm-g-label").filter({ hasText: "E5-T18d" }).click();
  await page.locator("#rm-detail").waitFor({ state: "visible" });
  const detail = await page.locator("#rm-detail").innerText();
  if (process.env.E5_T18D_DEMO_VERIFIED === "1") await page.locator("#rm-detail .st-verified").waitFor({ state: "visible" });
  assert.deepEqual(errors, []);
  assert.deepEqual(httpErrors, []);
  await mkdir(out, { recursive: true });
  const screenshot = await page.screenshot({ path: path.join(out, "demo-suite.png") });
  const result = { url: `${base}/app.html?noAutoBoot=1`, browser: browser.version(), metrics, detail, errors, httpErrors, consoleLog,
    screenshotSha256: createHash("sha256").update(screenshot).digest("hex") };
  await writeFile(path.join(out, "demo-suite.json"), `${JSON.stringify(result, null, 2)}\n`);
  console.log(JSON.stringify({ metrics, errors, httpErrors, detail }));
} finally { await browser.close(); server?.close(); }
