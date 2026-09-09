// E3.5-T05f2: direct Chromium proof for the guest-backed Images catalog and detached Run path.
// This deliberately drives the local Alpine image; no browser-side catalog or run result is mocked.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const web = path.join(repo, "web");
const base = process.env.E3_T05F2_BASE_URL || "http://127.0.0.1:8123";
// Match the already-proven T05f1 Alpine boot path: the page uses its configured R2 release
// unless a caller explicitly supplies a local asset base. The local server still supplies the
// page and the load-time Alpine manifest.
const assetBase = process.env.E3_T05F2_ASSET_BASE || null;
const evidenceDir = path.join(repo, "evidence", "e3-t05f2");
const evidencePath = path.join(evidenceDir, "docker-images-run-browser.json");
const screenshotPath = path.join(evidenceDir, "docker-images-run-browser.png");
const haveAlpine = await Promise.all([
  fs.access(path.join(web, "artifacts-alpine.json")),
  fs.access(path.join(repo, "releases/chunked-alpine/manifest.json")),
]).then(() => true).catch(() => false);
if (!haveAlpine) throw new Error("local Alpine artifacts are required for E3.5-T05f2 proof");

const { chromium } = await import(
  pathToFileURL(path.join(web, "node_modules/playwright/index.mjs")).href,
);
const chromePath = process.env.E3_T05F2_CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const launchOptions = {
  headless: process.env.E3_T05F2_HEADED !== "1",
  args: ["--disable-dev-shm-usage", "--js-flags=--max-old-space-size=4096"],
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
const catalog = () => page.evaluate(() => window.__dockerCatalogForTest());
const imageRows = () => page.locator("#ide-dk .ide-dk-sec").first().locator(".ide-dk-row");
page.on("close", () => console.error("[e3-t05f2] page closed"));
page.on("crash", () => console.error("[e3-t05f2] page crashed"));
browser.on("disconnected", () => console.error("[e3-t05f2] browser disconnected"));
const stateTimer = setInterval(async () => {
  try {
    console.error("[e3-t05f2] state", JSON.stringify(await state()));
  } catch (error) {
    console.error("[e3-t05f2] state unavailable", error?.message || String(error));
  }
}, 30_000);

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
  });
  if (assetBase) query.set("assetBase", assetBase);
  await page.goto(`${base}/?${query}#ide`, {
    waitUntil: "domcontentloaded",
    timeout: 120_000,
  });
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

  const loaded = await catalog();
  assert.equal(loaded.status, "available");
  assert.ok(loaded.entries.length > 0, "guest catalog must contain at least one image");
  const rows = imageRows();
  assert.equal(await rows.count(), loaded.entries.length, "one Images row per guest catalog entry");
  for (let i = 0; i < loaded.entries.length; i += 1) {
    const entry = loaded.entries[i];
    const rowText = await rows.nth(i).innerText();
    assert(rowText.includes(entry.name || entry.repo), `row ${i} does not show guest name`);
    assert(rowText.includes(entry.ref || `${entry.repo}:${entry.tag}`), `row ${i} does not show guest ref`);
  }

  const busyboxIndex = loaded.entries.findIndex((entry) =>
    entry.repo === "busybox" || entry.repo.endsWith("/busybox") || entry.name === "busybox",
  );
  assert.ok(busyboxIndex >= 0, "guest catalog must contain busybox");
  const busybox = loaded.entries[busyboxIndex];
  const busyboxRow = rows.nth(busyboxIndex);
  await busyboxRow.locator('button[data-action="inspect-image"]').click();
  const inspectText = await page.locator("#ide-dk-inspect").innerText();
  if (busybox.manifestDigest) {
    assert.match(inspectText, new RegExp(busybox.manifestDigest.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  } else {
    assert.match(inspectText, /not published by guest catalog/i);
  }
  assert.match(inspectText, new RegExp(String(busybox.rootfsBytes)));
  assert.match(inspectText, new RegExp(busybox.bundlePath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(inspectText, new RegExp(busybox.entry.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));

  const duplicateName = "t05f2-duplicate";
  await page.evaluate((name) => window.__dockerSetRunNameForTest(name), duplicateName);
  await busyboxRow.locator('button[data-action="run-image"]').click();
  const starting = await state();
  assert.equal(starting.lastRun.status, "starting");
  assert.match(starting.lastRun.command, /wvrun run -d/);
  await waitFor(() => window.__dockerStateForTest?.().lastRun?.status === "accepted", 120_000);
  const accepted = (await state()).lastRun;
  assert.ok(accepted.id, "successful detached run must return the guest identity");
  assert.match(await page.locator("#ide-dk").innerText(), new RegExp(`guest accepted detached run.*${accepted.id}`));
  const firstPs = await page.evaluate(() => window.wvmDemo.run("wvrun ps -a"));
  assert.equal(firstPs.exit, 0);
  assert.match(firstPs.stdout, new RegExp(`"name":"${duplicateName}"`));
  assert.match(firstPs.stdout, new RegExp(`"id":"${accepted.id}"`));

  await busyboxRow.locator('button[data-action="run-image"]').click();
  await waitFor(() => window.__dockerStateForTest?.().lastRun?.status === "failed", 120_000);
  const duplicate = (await state()).lastRun;
  assert.equal(duplicate.code, "DUPLICATE_NAME");
  assert.notEqual(duplicate.exit, 0);
  assert.match(duplicate.error, /already in use|duplicate|name/i);

  const alpineIndex = loaded.entries.findIndex((entry) =>
    entry.repo === "alpine" || entry.repo.endsWith("/alpine") || entry.name === "alpine",
  );
  assert.ok(alpineIndex >= 0, "guest catalog must contain alpine");
  const alpine = loaded.entries[alpineIndex];
  await page.evaluate((repo) => window.__dockerSetImageForTest(repo, {
    bundlePath: "/opt/containers/does-not-exist-t05f2",
  }), alpine.repo);
  await page.evaluate((name) => window.__dockerSetRunNameForTest(name), "t05f2-missing-bundle");
  await imageRows().nth(alpineIndex).locator('button[data-action="run-image"]').click();
  await waitFor(() => window.__dockerStateForTest?.().lastRun?.status === "failed", 120_000);
  const failed = (await state()).lastRun;
  assert.equal(failed.code, "BUNDLE_NOT_RUNNABLE");
  assert.notEqual(failed.exit, 0);
  assert.match(failed.error, /no rootfs|not found|does-not-exist|bundle/i);
  const finalPs = await page.evaluate(() => window.wvmDemo.run("wvrun ps -a"));
  assert.ok(!finalPs.stdout.includes('"name":"t05f2-missing-bundle"'));

  await page.screenshot({ path: screenshotPath, fullPage: true });
  result.state = await state();
  result.catalog = await catalog();
  result.accepted = accepted;
  result.duplicate = duplicate;
  result.failed = failed;
  result.consoleErrors = consoleErrors;
  result.failedRequests = failedRequests;
  assert.deepEqual(consoleErrors, []);
  assert.deepEqual(failedRequests, []);
} finally {
  clearInterval(stateTimer);
  await page.close().catch(() => {});
  await browser.close().catch(() => {});
}

await fs.mkdir(evidenceDir, { recursive: true });
await fs.writeFile(evidencePath, `${JSON.stringify({ generatedAt: new Date().toISOString(), ...result, screenshot: path.relative(repo, screenshotPath) }, null, 2)}\n`);
console.log(JSON.stringify({ ...result, screenshot: path.relative(repo, screenshotPath) }, null, 2));
