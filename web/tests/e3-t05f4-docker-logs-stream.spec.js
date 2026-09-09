// E3.5-T05f4: the Docker Logs pane owns one real wvrun logs -f stream at a time.
import { expect, test } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const WEB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const haveLocalAlpine = fs.existsSync(path.join(WEB, "artifacts-alpine.json")) &&
  fs.existsSync(path.join(WEB, "../releases/chunked-alpine/manifest.json"));

const shq = (value) => `'${String(value).replace(/'/g, "'\\''")}'`;

async function bootDockerRuntime(page) {
  const assetBase = process.env.E3_T05F4_ASSET_BASE;
  const query = new URLSearchParams({
    noAutoBoot: "1",
    testHooks: "1",
    nosw: "1",
    guest: "alpine",
    worker: "0",
    jit: "0",
  });
  if (assetBase) query.set("assetBase", assetBase);
  await page.goto(`/?${query}#ide`);
  await page.waitForFunction(() => window.wvmDemo && typeof window.wvmDemo.bootAlpine === "function", null, {
    timeout: 120_000,
  });
  await page.locator("#ide-act-docker").click();
  await page.waitForFunction(() => window.__dockerStateForTest?.().alpineStatus === "present", null, {
    timeout: 30_000,
  });
  await page.locator("#ide-dk-boot-alpine").click();
  await page.waitForFunction(
    () => window.wvmDemo.isGuestReady?.() === true &&
      window.__dockerStateForTest?.().runtime === "available" &&
      window.__dockerStateForTest?.().catalogStatus === "available",
    null,
    { timeout: 900_000 },
  );
}

test("E3.5-T05f4: guest logs follow owns one cancellable stream", async ({ page }) => {
  test.skip(!haveLocalAlpine, "needs local artifacts-alpine.json and releases/chunked-alpine");
  test.setTimeout(3_600_000);
  const errors = [];
  page.on("console", (message) => {
    if (message.type() === "error" && !message.location().url.includes("/favicon.ico")) {
      errors.push(message.text());
    }
  });
  page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));

  await bootDockerRuntime(page);
  const catalog = await page.evaluate(() => window.__dockerCatalogForTest());
  const busybox = catalog.entries.find((entry) =>
    entry.repo === "busybox" || entry.repo.endsWith("/busybox") || entry.name === "busybox",
  );
  expect(busybox, "the guest catalog must contain busybox").toBeTruthy();
  const name = "t05f4-logs";
  const command = `wvrun run -d --name ${shq(name)} ${shq(busybox.bundlePath)} /bin/sh -c ${shq(
    "echo CONTAINED_$((6*7)); while :; do sleep 1; done",
  )}`;
  const started = await page.evaluate((cmd) => window.wvmDemo.run(cmd), command);
  expect(started.exit).toBe(0);
  const id = String(started.stdout).trim().split(/\s+/).pop();
  expect(id).toMatch(/^[0-9a-f]{12}$/i);

  await page.locator('button[data-action="refresh-containers"]').click();
  const row = () => page.locator(`#ide-dk-clist .ide-dk-ctr[data-name="${name}"]`);
  await expect(row()).toHaveCount(1, { timeout: 60_000 });
  await expect(row()).toHaveAttribute("data-status", /^(running|created)$/);
  await row().click();
  await expect(page.locator(".ide-ctr-panel.active")).toHaveCount(1);
  const follow = page.locator('.ide-ctr-panel.active input[data-a="follow"]');
  await follow.check();
  await page.waitForFunction(
    () => window.__dockerLogStateForTest?.()[0]?.streamActive === true,
    null,
    { timeout: 30_000 },
  );
  await page.waitForFunction(
    () => window.__dockerLogStateForTest?.()[0]?.logsText.includes("CONTAINED_42"),
    null,
    { timeout: 120_000 },
  );
  let logState = await page.evaluate(() => window.__dockerLogStateForTest()[0]);
  expect((logState.logsText.match(/CONTAINED_42/g) || []).length).toBe(1);

  // Sidebar re-rendering must not create a second subscriber or replay the current tail.
  await page.locator("#ide-act-docker").click();
  await page.waitForTimeout(100);
  logState = await page.evaluate(() => window.__dockerLogStateForTest()[0]);
  expect(logState.streamActive).toBe(true);
  expect((logState.logsText.match(/CONTAINED_42/g) || []).length).toBe(1);

  // Closing the pane cancels only the stream. The same guest tty is immediately usable and the
  // container remains running in a fresh ps -a projection.
  await page.locator("#ide-tabstrip .ide-tab .t-close").click();
  await page.waitForFunction(() => window.__dockerLogStateForTest?.().length === 0, null, {
    timeout: 30_000,
  });
  const afterClose = await page.evaluate(async () => {
    const rpc = await window.wvmDemo.run("echo AFTER_CLOSE_$((6*7))");
    const ps = await window.wvmDemo.run("wvrun ps -a");
    return { rpc, ps };
  });
  expect(afterClose.rpc.exit).toBe(0);
  expect(afterClose.rpc.stdout).toContain("AFTER_CLOSE_42");
  expect(afterClose.ps.stdout).toContain(`"id":"${id}"`);
  expect(afterClose.ps.stdout).toContain('"status":"running"');

  // Reattach and follow again: the projection is replayed once from the guest log, never appended
  // twice to the same pane. Stop from the Containers view must release the stream before wvrun stop.
  await row().click();
  await page.locator('.ide-ctr-panel.active input[data-a="follow"]').check();
  await page.waitForFunction(
    () => window.__dockerLogStateForTest?.()[0]?.logsText.includes("CONTAINED_42"),
    null,
    { timeout: 120_000 },
  );
  logState = await page.evaluate(() => window.__dockerLogStateForTest()[0]);
  expect((logState.logsText.match(/CONTAINED_42/g) || []).length).toBe(1);

  await row().locator('button[data-action="stop-container"]').click();
  await expect(row()).toHaveAttribute("data-status", /^(exited|stopped|dead)$/, { timeout: 120_000 });
  await page.waitForFunction(
    () => {
      const state = window.__dockerLogStateForTest?.()[0];
      return state && !state.streamActive && state.follow === false;
    },
    null,
    { timeout: 30_000 },
  );
  const afterStop = await page.evaluate(() => window.wvmDemo.run("echo AFTER_STOP_$((6*7))"));
  expect(afterStop.exit).toBe(0);
  expect(afterStop.stdout).toContain("AFTER_STOP_42");
  expect(errors, `unexpected console errors: ${errors.join("; ")}`).toEqual([]);
});
