// E3.5-T05f4: direct Chromium proof for the guest-backed Logs stream lifecycle.
// The run is intentionally real: Alpine, wvrun, the detached container log, and the shared tty
// bridge all execute in the browser. No log output or lifecycle result is mocked.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const web = path.join(repo, "web");
const base = process.env.E3_T05F4_BASE_URL || "http://127.0.0.1:8123";
const assetBase = process.env.E3_T05F4_ASSET_BASE || null;
const evidenceDir = path.join(repo, "evidence", "e3-t05f4");
const evidencePath = path.join(evidenceDir, "docker-logs-stream-browser.json");
const screenshotPath = path.join(evidenceDir, "docker-logs-stream-browser.png");
const haveAlpine = await Promise.all([
  fs.access(path.join(web, "artifacts-alpine.json")),
  fs.access(path.join(repo, "releases/chunked-alpine/manifest.json")),
]).then(() => true).catch(() => false);
if (!haveAlpine) throw new Error("local Alpine artifacts are required for E3.5-T05f4 proof");

const { chromium } = await import(
  pathToFileURL(path.join(web, "node_modules/playwright/index.mjs")).href,
);
const chromePath = process.env.E3_T05F4_CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const launchOptions = {
  headless: process.env.E3_T05F4_HEADED !== "1",
  args: ["--disable-dev-shm-usage", "--disable-gpu", "--js-flags=--max-old-space-size=4096"],
};
try {
  await fs.access(chromePath);
  launchOptions.executablePath = chromePath;
} catch {
  // Use Playwright's bundled Chromium when the local Chrome app is absent.
}

const shq = (value) => `'${String(value).replace(/'/g, "'\\''")}'`;
const browser = await chromium.launch(launchOptions);
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
const consoleErrors = [];
const failedRequests = [];
page.on("console", (message) => {
  if (message.type() === "error" && !message.location().url.includes("/favicon.ico")) {
    consoleErrors.push(message.text());
  }
});
page.on("pageerror", (error) => consoleErrors.push(`pageerror: ${error.message}`));
page.on("requestfailed", (request) => {
  if (!request.url().endsWith("/favicon.ico")) {
    failedRequests.push({ url: request.url(), failure: request.failure()?.errorText || "unknown" });
  }
});

const waitFor = (predicate, timeout = 900_000) =>
  page.waitForFunction(predicate, undefined, { timeout });
const logState = () => page.evaluate(() => window.__dockerLogStateForTest());
const result = {
  base,
  assetBase: assetBase || "page default release base",
  browser: { name: browser.browserType().name(), version: browser.version() },
};

try {
  const query = new URLSearchParams({
    noAutoBoot: "1",
    testHooks: "1",
    nosw: "1",
    guest: "alpine",
    worker: "0",
    jit: "0",
    workerHeartbeatTimeoutMs: "10000",
  });
  if (assetBase) query.set("assetBase", assetBase);
  await page.goto(`${base}/?${query}#ide`, { waitUntil: "domcontentloaded", timeout: 120_000 });
  await page.waitForFunction(() => window.wvmDemo && typeof window.wvmDemo.bootAlpine === "function", null, {
    timeout: 120_000,
  });
  await page.locator("#ide-act-docker").click();
  await waitFor(() => window.__dockerStateForTest?.().alpineStatus === "present", 30_000);
  await page.locator("#ide-dk-boot-alpine").click();
  await waitFor(
    () => window.wvmDemo.isGuestReady?.() === true &&
      window.__dockerStateForTest?.().runtime === "available" &&
      window.__dockerStateForTest?.().catalogStatus === "available",
  );

  const catalog = await page.evaluate(() => window.__dockerCatalogForTest());
  const busybox = catalog.entries.find((entry) =>
    entry.repo === "busybox" || entry.repo.endsWith("/busybox") || entry.name === "busybox",
  );
  assert(busybox, "guest catalog must contain busybox");
  const name = "t05f4-logs";
  const command = `wvrun run -d --name ${shq(name)} ${shq(busybox.bundlePath)} /bin/sh -c ${shq(
    "echo CONTAINED_$((6*7)); while :; do sleep 1; done",
  )}`;
  const started = await page.evaluate((cmd) => window.wvmDemo.run(cmd), command);
  assert.equal(started.exit, 0);
  const id = String(started.stdout).trim().split(/\s+/).pop();
  assert.match(id, /^[0-9a-f]{12}$/i);

  await page.locator('button[data-action="refresh-containers"]').click();
  const row = () => page.locator(`#ide-dk-clist .ide-dk-ctr[data-name="${name}"]`);
  await page.locator(`#ide-dk-clist .ide-dk-ctr[data-name="${name}"]`).waitFor({ timeout: 60_000 });
  await row().click();
  await page.locator('.ide-ctr-panel.active input[data-a="follow"]').check();
  await waitFor(() => window.__dockerLogStateForTest?.()[0]?.streamActive === true, 30_000);
  await waitFor(() => window.__dockerLogStateForTest?.()[0]?.logsText.includes("CONTAINED_42"), 120_000);
  let current = (await logState())[0];
  assert.equal((current.logsText.match(/CONTAINED_42/g) || []).length, 1);
  const beforeRenderGeneration = current.streamGeneration;
  await page.locator("#ide-act-docker").click();
  await new Promise((resolve) => setTimeout(resolve, 100));
  current = (await logState())[0];
  assert.equal(current.streamActive, true);
  assert.equal(current.streamGeneration, beforeRenderGeneration);
  assert.equal((current.logsText.match(/CONTAINED_42/g) || []).length, 1);

  await page.locator("#ide-tabstrip .ide-tab .t-close").click();
  await waitFor(() => window.__dockerLogStateForTest?.().length === 0, 30_000);
  const afterClose = await page.evaluate(async () => ({
    rpc: await window.wvmDemo.run("echo AFTER_CLOSE_$((6*7))"),
    ps: await window.wvmDemo.run("wvrun ps -a"),
  }));
  assert.equal(afterClose.rpc.exit, 0);
  assert.match(afterClose.rpc.stdout, /AFTER_CLOSE_42/);
  assert.match(afterClose.ps.stdout, new RegExp(`"id":"${id}"`));
  assert.match(afterClose.ps.stdout, /"status":"running"/);

  await row().click();
  await page.locator('.ide-ctr-panel.active input[data-a="follow"]').check();
  await waitFor(() => window.__dockerLogStateForTest?.()[0]?.logsText.includes("CONTAINED_42"), 120_000);
  current = (await logState())[0];
  assert.equal((current.logsText.match(/CONTAINED_42/g) || []).length, 1);
  await row().locator('button[data-action="stop-container"]').click();
  await expectStopped(row);
  await waitFor(() => {
    const state = window.__dockerLogStateForTest?.()[0];
    return state && !state.streamActive && state.follow === false;
  }, 30_000);
  const afterStop = await page.evaluate(() => window.wvmDemo.run("echo AFTER_STOP_$((6*7))"));
  assert.equal(afterStop.exit, 0);
  assert.match(afterStop.stdout, /AFTER_STOP_42/);
  assert.deepEqual(consoleErrors, []);
  assert.deepEqual(failedRequests, []);
  result.id = id;
  result.logState = await logState();
  result.afterClose = afterClose;
  result.afterStop = afterStop;
  result.consoleErrors = consoleErrors;
  result.failedRequests = failedRequests;
  await page.screenshot({ path: screenshotPath, fullPage: true });
} finally {
  await page.close().catch(() => {});
  await browser.close().catch(() => {});
}

await fs.mkdir(evidenceDir, { recursive: true });
await fs.writeFile(evidencePath, `${JSON.stringify({
  generatedAt: new Date().toISOString(),
  ...result,
  screenshot: path.relative(repo, screenshotPath),
}, null, 2)}\n`);
console.log(JSON.stringify({ ...result, screenshot: path.relative(repo, screenshotPath) }, null, 2));

async function expectStopped(row) {
  await row.waitFor({ timeout: 120_000 });
  await waitForRowStatus(row, /^(exited|stopped|dead)$/);
}

async function waitForRowStatus(row, pattern) {
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    if (pattern.test(await row.getAttribute("data-status"))) return;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`container did not reach ${pattern}: ${await row.getAttribute("data-status")}`);
}
