// E3.5-T05f3: direct Chromium proof for the guest-backed Containers projection and lifecycle UI.
// Every transition below is driven through the real Alpine guest bridge; only the malformed ps
// response is deliberately replaced to exercise the typed-error/last-confirmed-state boundary.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const web = path.join(repo, "web");
const base = process.env.E3_T05F3_BASE_URL || "http://127.0.0.1:8123";
const assetBase = process.env.E3_T05F3_ASSET_BASE || null;
const evidenceDir = path.join(repo, "evidence", "e3-t05f3");
const evidencePath = path.join(evidenceDir, "docker-containers-actions-browser.json");
const screenshotPath = path.join(evidenceDir, "docker-containers-actions-browser.png");
const containerName = "t05f3-actions";
const haveAlpine = await Promise.all([
  fs.access(path.join(web, "artifacts-alpine.json")),
  fs.access(path.join(repo, "releases/chunked-alpine/manifest.json")),
]).then(() => true).catch(() => false);
if (!haveAlpine) throw new Error("local Alpine artifacts are required for E3.5-T05f3 proof");

const { chromium } = await import(
  pathToFileURL(path.join(web, "node_modules/playwright/index.mjs")).href,
);
const chromePath = process.env.E3_T05F3_CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const launchOptions = {
  headless: process.env.E3_T05F3_HEADED !== "1",
  args: ["--disable-dev-shm-usage", "--disable-gpu", "--js-flags=--max-old-space-size=4096"],
};
try {
  await fs.access(chromePath);
  launchOptions.executablePath = chromePath;
} catch {
  // Use Playwright's bundled Chromium when the local Chrome app is absent.
}

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
const state = () => page.evaluate(() => window.__dockerStateForTest());
const containerState = () => page.evaluate(() => window.__dockerContainerStateForTest());
page.on("close", () => console.error("[e3-t05f3] page closed"));
page.on("crash", () => console.error("[e3-t05f3] page crashed"));
browser.on("disconnected", () => console.error("[e3-t05f3] browser disconnected"));
const stateTimer = setInterval(async () => {
  try {
    console.error("[e3-t05f3] state", JSON.stringify(await state()));
  } catch (error) {
    console.error("[e3-t05f3] state unavailable", error?.message || String(error));
  }
}, 30_000);
const containerRow = () => page.locator(
  `#ide-dk-clist .ide-dk-ctr[data-name="${containerName}"]`,
);
const readContainerRow = async () => {
  await containerRow().waitFor({ state: "visible", timeout: 30_000 });
  return {
    id: await containerRow().getAttribute("data-id"),
    name: await containerRow().getAttribute("data-name"),
    status: await containerRow().getAttribute("data-status"),
    text: await containerRow().innerText(),
  };
};
const active = (row) => /^(running|created)$/.test(row?.status || "");
const stopped = (row) => /^(exited|stopped|dead)$/.test(row?.status || "");

async function bootCurrentPage() {
  await page.waitForFunction(() => window.wvmDemo && typeof window.wvmDemo.bootAlpine === "function", null, {
    timeout: 120_000,
  });
  await page.locator("#ide-act-docker").click();
  await page.locator("#ide-dk-runtime").waitFor({ state: "visible", timeout: 30_000 });
  await waitFor(() => window.__dockerStateForTest?.().alpineStatus === "present", 30_000);
  await page.locator("#ide-dk-boot-alpine").click();
  await waitFor(
    () => window.wvmDemo.isGuestReady?.() === true &&
      window.__dockerStateForTest?.().runtime === "available" &&
      window.__dockerStateForTest?.().catalogStatus === "available",
  );
}

const query = new URLSearchParams({
  noAutoBoot: "1",
  testHooks: "1",
  nosw: "1",
  guest: "alpine",
  worker: "0",
  jit: "0",
});
if (assetBase) query.set("assetBase", assetBase);

await fs.mkdir(evidenceDir, { recursive: true });
const result = {
  base,
  assetBase: assetBase || "page default release base",
  browser: { name: browser.browserType().name(), version: browser.version() },
  containerName,
  stages: {},
};
let stage = "initial-load";
try {
  await page.goto(`${base}/?${query}#ide`, {
    waitUntil: "domcontentloaded",
    timeout: 120_000,
  });
  await bootCurrentPage();

  stage = "catalog-run";
  const catalog = await page.evaluate(() => window.__dockerCatalogForTest());
  const busyboxIndex = catalog.entries.findIndex((entry) =>
    entry.repo === "busybox" || entry.repo.endsWith("/busybox") || entry.name === "busybox",
  );
  assert.ok(busyboxIndex >= 0, "guest catalog must contain busybox");
  const imageRows = page.locator("#ide-dk .ide-dk-sec").first().locator(".ide-dk-row");
  const busyboxRow = imageRows.nth(busyboxIndex);
  await page.evaluate((name) => window.__dockerSetRunNameForTest(name), containerName);
  await busyboxRow.locator('button[data-action="run-image"]').click();
  await waitFor(() => window.__dockerStateForTest?.().lastRun?.status === "accepted", 120_000);
  await waitFor(() => window.__dockerContainerStateForTest?.().rows?.some((row) =>
    row.name === "t05f3-actions" && /^(running|created)$/.test(row.status),
  ), 120_000);
  const first = await readContainerRow();
  assert.equal(first.name, containerName);
  assert.ok(active(first), `detached busybox must be active, got ${first.status}`);
  assert.match(first.text, /busybox/);
  assert.match(first.text, new RegExp(first.id));
  result.stages.initial = first;

  stage = "race-stop";
  // Start the refresh first, then Stop before its promise settles. runContainerAction must join
  // that refresh and issue a fresh confirming ps -a; it must not optimistically rewrite the row.
  await page.evaluate((name) => {
    document.querySelector('button[data-action="refresh-containers"]')?.click();
    const row = [...document.querySelectorAll("#ide-dk-clist .ide-dk-ctr")]
      .find((candidate) => candidate.dataset.name === name);
    row?.querySelector('button[data-action="stop-container"]')?.click();
  }, containerName);
  await waitFor(() => {
    const ledger = window.__dockerContainerStateForTest?.();
    const row = ledger?.rows?.find((item) => item.name === "t05f3-actions");
    return ledger?.action === null && row && /^(exited|stopped|dead)$/.test(row.status);
  }, 120_000);
  const afterStop = await readContainerRow();
  assert.equal(afterStop.id, first.id, "Stop must retain the guest identity");
  assert.ok(stopped(afterStop));
  result.stages.afterStop = afterStop;

  stage = "restart";
  await containerRow().locator('button[data-action="restart-container"]').click();
  await waitFor(() => {
    const ledger = window.__dockerContainerStateForTest?.();
    const row = ledger?.rows?.find((item) => item.name === "t05f3-actions");
    return ledger?.action === null && row && /^(running|created)$/.test(row.status) && row.id !== "";
  }, 180_000);
  const afterRestart = await readContainerRow();
  assert.ok(active(afterRestart));
  assert.notEqual(afterRestart.id, first.id, "Restart must create a new guest identity");
  result.stages.afterRestart = afterRestart;

  stage = "malformed-ps";
  await page.evaluate(() => {
    const original = window.wvmDemo.exec.bind(window.wvmDemo);
    window.__e3T05f3OriginalExec = original;
    window.wvmDemo.exec = async (command, ...args) =>
      command === "wvrun ps -a" ? { stdout: "{malformed", exit: 0 } : original(command, ...args);
  });
  await page.locator('button[data-action="refresh-containers"]').click();
  await waitFor(() => window.__dockerContainerStateForTest?.().code === "PS_MALFORMED", 30_000);
  const malformed = await containerState();
  assert.equal(malformed.code, "PS_MALFORMED");
  assert.equal(malformed.rows.find((row) => row.name === containerName)?.id, afterRestart.id);
  assert.equal(malformed.rows.find((row) => row.name === containerName)?.status, afterRestart.status);
  assert.match(await page.locator("#ide-dk-clist").innerText(), /Guest state not updated \(PS_MALFORMED\)/);
  result.stages.malformedPs = {
    code: malformed.code,
    error: malformed.error,
    retainedId: malformed.rows.find((row) => row.name === containerName)?.id,
    retainedStatus: malformed.rows.find((row) => row.name === containerName)?.status,
  };
  await page.screenshot({ path: screenshotPath, fullPage: true });

  // Reload the Docker tab itself: the activity-bar view is torn down and rebuilt while the same
  // guest remains authoritative. A browser-document reload after dirtying the guest overlay would
  // deliberately reject the build snapshot and require an unbounded cold Alpine boot, so it is
  // not a bounded proof of this UI reconciliation slice.
  stage = "docker-tab-reload";
  await page.evaluate(() => {
    const original = window.__e3T05f3OriginalExec;
    if (original) window.wvmDemo.exec = original;
    delete window.__e3T05f3OriginalExec;
    document.querySelector("#ide-act-files")?.click();
    document.querySelector("#ide-act-docker")?.click();
  });
  await waitFor(() => window.__dockerContainerStateForTest?.().rows?.some((row) =>
    row.name === "t05f3-actions" && /^(running|created)$/.test(row.status),
  ), 120_000);
  const afterReload = await readContainerRow();
  assert.equal(afterReload.id, afterRestart.id, "reload must show the confirmed guest identity");
  assert.ok(active(afterReload));
  result.stages.afterReload = afterReload;

  stage = "external-terminal-stop";
  const externalStop = await page.evaluate(
    (id) => window.wvmDemo.run(`wvrun stop ${id}`),
    afterReload.id,
  );
  assert.equal(externalStop.exit, 0, "the Terminal-tab guest stop must succeed");
  await page.locator('button[data-action="refresh-containers"]').click();
  await waitFor(() => {
    const ledger = window.__dockerContainerStateForTest?.();
    const row = ledger?.rows?.find((item) => item.name === "t05f3-actions");
    return ledger?.action === null && row && /^(exited|stopped|dead)$/.test(row.status);
  }, 120_000);
  const afterExternalStop = await readContainerRow();
  assert.equal(afterExternalStop.id, afterReload.id);
  assert.ok(stopped(afterExternalStop));
  result.stages.externalTerminalStop = { command: `wvrun stop ${afterReload.id}`, result: externalStop, row: afterExternalStop };

  stage = "remove";
  await containerRow().locator('button[data-action="remove-container"]').click();
  await waitFor(() => {
    const ledger = window.__dockerContainerStateForTest?.();
    return ledger?.action === null && ledger.status === "ready" &&
      !ledger.rows.some((row) => row.name === "t05f3-actions");
  }, 120_000);
  assert.equal(await containerRow().count(), 0);
  assert.match(await page.locator("#ide-dk-clist").innerText(), /No containers/);
  result.stages.afterRemove = await containerState();
  result.consoleErrors = consoleErrors;
  result.failedRequests = failedRequests;
  assert.deepEqual(consoleErrors, []);
  assert.deepEqual(failedRequests, []);
} catch (error) {
  error.message = `[${stage}] ${error.message || error}`;
  throw error;
} finally {
  clearInterval(stateTimer);
  await page.close().catch(() => {});
  await browser.close().catch(() => {});
}

await fs.writeFile(evidencePath, `${JSON.stringify({
  generatedAt: new Date().toISOString(),
  ...result,
  screenshot: path.relative(repo, screenshotPath),
}, null, 2)}\n`);
console.log(JSON.stringify({ ...result, screenshot: path.relative(repo, screenshotPath) }, null, 2));
