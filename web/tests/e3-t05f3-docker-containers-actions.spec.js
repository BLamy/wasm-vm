// E3.5-T05f3: Containers is a confirmed projection of the guest's wvrun lifecycle state. The
// Alpine boot is intentionally opt-in because this test drives the real interpreted RISC-V guest.
import { expect, test } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const WEB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const haveLocalAlpine = fs.existsSync(path.join(WEB, "artifacts-alpine.json")) &&
  fs.existsSync(path.join(WEB, "../releases/chunked-alpine/manifest.json"));

async function bootDockerRuntime(page) {
  const assetBase = process.env.E3_T05F3_ASSET_BASE;
  const query = new URLSearchParams({
    noAutoBoot: "1",
    testHooks: "1",
    nosw: "1",
    guest: "alpine",
    workerHeartbeatTimeoutMs: "10000",
  });
  if (assetBase) query.set("assetBase", assetBase);
  await page.goto(`/?${query}#ide`);
  await page.waitForFunction(() => window.wvmDemo && typeof window.wvmDemo.bootAlpine === "function", null, {
    timeout: 120_000,
  });
  await page.locator("#ide-act-docker").click();
  await page.locator("#ide-dk-runtime").waitFor({ state: "visible", timeout: 30_000 });
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

test("E3.5-T05f3: guest ps projection and lifecycle actions", async ({ page }) => {
  test.skip(!haveLocalAlpine, "needs local artifacts-alpine.json and releases/chunked-alpine");
  test.setTimeout(3_600_000);
  const errors = [];
  page.on("console", (message) => {
    if (message.type() === "error" && !message.location().url.includes("/favicon.ico")) {
      errors.push(message.text());
    }
  });

  await bootDockerRuntime(page);
  const catalog = await page.evaluate(() => window.__dockerCatalogForTest());
  const busybox = catalog.entries.find((entry) =>
    entry.repo === "busybox" || entry.repo.endsWith("/busybox") || entry.name === "busybox",
  );
  expect(busybox, "the baked guest catalog must contain busybox").toBeTruthy();
  const imageRows = page.locator("#ide-dk .ide-dk-sec").first().locator(".ide-dk-row");
  const busyboxRow = imageRows.nth(catalog.entries.indexOf(busybox));
  const name = "t05f3-actions";
  await page.evaluate((value) => window.__dockerSetRunNameForTest(value), name);
  await busyboxRow.locator('button[data-action="run-image"]').click();
  await page.waitForFunction(
    () => window.__dockerStateForTest?.().lastRun?.status === "accepted",
    null,
    { timeout: 120_000 },
  );

  const row = () => page.locator(`#ide-dk-clist .ide-dk-ctr[data-name="${name}"]`);
  await expect(row()).toHaveCount(1);
  await expect(row()).toHaveAttribute("data-status", /^(running|created)$/);
  const first = await row().getAttribute("data-id");
  await expect(row()).toContainText(/busybox/);
  await expect(row()).toContainText(first);

  await row().locator('button[data-action="stop-container"]').click();
  await expect(row()).toHaveAttribute("data-status", /^(exited|stopped|dead)$/, { timeout: 120_000 });
  await expect(row()).toContainText(first);

  await row().locator('button[data-action="restart-container"]').click();
  await expect(row()).toHaveAttribute("data-status", /^(running|created)$/, { timeout: 180_000 });
  const replacement = await row().getAttribute("data-id");
  expect(replacement).toBeTruthy();
  expect(replacement).not.toBe(first);

  // A deliberately malformed guest response must not erase or rewrite the last confirmed row.
  const originalExec = await page.evaluate(() => {
    const original = window.wvmDemo.exec.bind(window.wvmDemo);
    window.wvmDemo.exec = async (command, ...args) =>
      command === "wvrun ps -a" ? { stdout: "{malformed", exit: 0 } : original(command, ...args);
    return true;
  });
  expect(originalExec).toBe(true);
  await page.locator('button[data-action="refresh-containers"]').click();
  await page.waitForFunction(() => window.__dockerContainerStateForTest?.().code === "PS_MALFORMED", null, {
    timeout: 30_000,
  });
  await expect(row()).toHaveAttribute("data-id", replacement);
  await expect(row()).toHaveAttribute("data-status", /^(running|created)$/);

  await page.evaluate(() => window.location.reload());
  await page.waitForFunction(() => window.__runConfiguredAutoBootForTest && window.wvmDemo, null, {
    timeout: 120_000,
  });
  await page.evaluate(() => window.__runConfiguredAutoBootForTest());
  await page.waitForFunction(() => window.wvmDemo.isGuestReady?.() === true, null, {
    timeout: 900_000,
  });
  await page.locator("#ide-act-docker").click();
  await expect(row()).toHaveCount(1, { timeout: 30_000 });
  await expect(row()).toHaveAttribute("data-status", /^(running|created)$/);

  // The terminal bridge is the same guest command path used by the visible Terminal tab. A
  // bounded refresh must reconcile an external stop, rather than keep the last active state.
  const externalStop = await page.evaluate((id) => window.wvmDemo.run(`wvrun stop '${id}'`), replacement);
  expect(externalStop.exit).toBe(0);
  await page.locator('button[data-action="refresh-containers"]').click();
  await expect(row()).toHaveAttribute("data-status", /^(exited|stopped|dead)$/, { timeout: 120_000 });
  await expect(row()).toHaveAttribute("data-id", replacement);

  await row().locator('button[data-action="restart-container"]').click();
  await expect(row()).toHaveAttribute("data-status", /^(running|created)$/, { timeout: 180_000 });
  const externallyRestarted = await row().getAttribute("data-id");
  expect(externallyRestarted).toBeTruthy();
  expect(externallyRestarted).not.toBe(replacement);

  await row().locator('button[data-action="remove-container"]').click();
  await expect(row()).toHaveCount(0, { timeout: 120_000 });
  await expect(page.locator("#ide-dk-clist")).toContainText("No containers");
  expect(errors, `unexpected console errors: ${errors.join("; ")}`).toEqual([]);
});
