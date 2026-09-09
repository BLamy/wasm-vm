// E3.5-T05f2: the Docker Images view is a guest client, not a second image manifest. The Alpine
// boot is intentionally opt-in because it executes the real interpreted RISC-V guest and can take
// several minutes; the focused verifier below is the exact local proof when assets are present.
import { expect, test } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const WEB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const haveLocalAlpine = fs.existsSync(path.join(WEB, "artifacts-alpine.json")) &&
  fs.existsSync(path.join(WEB, "../releases/chunked-alpine/manifest.json"));

async function bootDockerRuntime(page) {
  const assetBase = process.env.E3_T05F2_ASSET_BASE;
  const query = new URLSearchParams({
    noAutoBoot: "1",
    testHooks: "1",
    nosw: "1",
    guest: "alpine",
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

test("E3.5-T05f2: guest catalog, inspect, detached run, and typed failures", async ({ page }) => {
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
  expect(catalog.status).toBe("available");
  expect(catalog.entries.length).toBeGreaterThan(0);

  const imageRows = page.locator("#ide-dk .ide-dk-sec").first().locator(".ide-dk-row");
  await expect(imageRows).toHaveCount(catalog.entries.length);
  for (let i = 0; i < catalog.entries.length; i += 1) {
    const entry = catalog.entries[i];
    await expect(imageRows.nth(i)).toContainText(`${entry.name || entry.repo} ${entry.ref || `${entry.repo}:${entry.tag}`}`);
  }

  const busybox = catalog.entries.find((entry) =>
    entry.repo === "busybox" || entry.repo.endsWith("/busybox") || entry.name === "busybox",
  );
  expect(busybox, "the baked guest catalog must contain busybox").toBeTruthy();
  const busyboxRow = imageRows.nth(catalog.entries.indexOf(busybox));
  await busyboxRow.locator('button[data-action="inspect-image"]').click();
  const inspect = page.locator("#ide-dk-inspect");
  if (busybox.manifestDigest) await expect(inspect).toContainText(busybox.manifestDigest);
  else await expect(inspect).toContainText("not published by guest catalog");
  await expect(inspect).toContainText(String(busybox.rootfsBytes));
  await expect(inspect).toContainText(busybox.bundlePath);
  await expect(inspect).toContainText(busybox.entry);

  const duplicateName = "t05f2-duplicate";
  await page.evaluate((name) => window.__dockerSetRunNameForTest(name), duplicateName);
  await busyboxRow.locator('button[data-action="run-image"]').click();
  await page.waitForFunction(
    () => window.__dockerStateForTest?.().lastRun?.status === "accepted",
    null,
    { timeout: 120_000 },
  );
  const accepted = await page.evaluate(() => window.__dockerStateForTest().lastRun);
  expect(accepted.id).toBeTruthy();
  await expect(page.locator("#ide-dk")).toContainText(`guest accepted detached run · id ${accepted.id}`);
  const psAfterFirst = await page.evaluate(() => window.wvmDemo.run("wvrun ps -a"));
  expect(psAfterFirst.exit).toBe(0);
  expect(psAfterFirst.stdout).toContain(`"name":"${duplicateName}"`);
  expect(psAfterFirst.stdout).toContain(`"id":"${accepted.id}"`);

  // A second real guest invocation with the same name must preserve wvrun's duplicate-name error.
  await busyboxRow.locator('button[data-action="run-image"]').click();
  await page.waitForFunction(
    () => window.__dockerStateForTest?.().lastRun?.status === "failed",
    null,
    { timeout: 120_000 },
  );
  const duplicate = await page.evaluate(() => window.__dockerStateForTest().lastRun);
  expect(duplicate.code).toBe("DUPLICATE_NAME");
  expect(duplicate.exit).not.toBe(0);
  expect(duplicate.error).toMatch(/already in use|duplicate|name/i);
  await expect(page.locator(".ide-dk-run-state[data-state=failed]")).toContainText(/exit|already in use/i);

  // Tampering is applied only to the client copy of the guest record; the following command still
  // goes through wvrun, so the guest's nonzero missing-bundle error must be visible.
  const alpine = catalog.entries.find((entry) =>
    entry.repo === "alpine" || entry.repo.endsWith("/alpine") || entry.name === "alpine",
  );
  expect(alpine, "the baked guest catalog must contain alpine").toBeTruthy();
  await page.evaluate((repo) => window.__dockerSetImageForTest(repo, {
    bundlePath: "/opt/containers/does-not-exist-t05f2",
  }), alpine.repo);
  await page.evaluate((name) => window.__dockerSetRunNameForTest(name), "t05f2-missing-bundle");
  await imageRows.nth(catalog.entries.indexOf(alpine)).locator('button[data-action="run-image"]').click();
  await page.waitForFunction(
    () => window.__dockerStateForTest?.().lastRun?.status === "failed",
    null,
    { timeout: 120_000 },
  );
  const failed = await page.evaluate(() => window.__dockerStateForTest().lastRun);
  expect(failed.code).toBe("BUNDLE_NOT_RUNNABLE");
  expect(failed.exit).not.toBe(0);
  expect(failed.error).toMatch(/no rootfs|not found|does-not-exist|bundle/i);
  const psAfterFailure = await page.evaluate(() => window.wvmDemo.run("wvrun ps -a"));
  expect(psAfterFailure.stdout).not.toContain('"name":"t05f2-missing-bundle"');
  expect(errors, `unexpected console errors: ${errors.join("; ")}`).toEqual([]);
});
