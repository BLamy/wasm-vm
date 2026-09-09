// E3.5-T05f1: Docker's bootstrap/capability boundary. The Docker sidebar must distinguish a
// guest-ready busybox shell from the Alpine guest that actually contains wvrun, and it must keep the
// no-provider/public states honest. The optional Alpine case drives the same in-tab button against the
// local chunked image when E3_T05F1_ALPINE=1 is explicitly requested.
import { expect, test } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const WEB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const haveAlpineAssets = fs.existsSync(path.join(WEB, "artifacts-alpine.json")) &&
  fs.existsSync(path.join(WEB, "../releases/chunked-alpine/manifest.json"));

async function openDocker(page, query = "") {
  await page.goto(`/?noAutoBoot=1&testHooks=1&nosw=1${query}#ide`);
  await page.waitForFunction(() => window.wvmDemo && typeof window.wvmDemo.runBusybox === "function", null, {
    timeout: 60_000,
  });
  await page.locator("#ide-act-docker").click();
  await expect(page.locator("#ide-dk-runtime")).toBeVisible();
}

test("E3.5-T05f1: busybox is guest-ready but Docker stays degraded and Pull is honest", async ({ page }) => {
  test.setTimeout(360_000);
  const errors = [];
  page.on("console", (message) => {
    if (message.type() === "error" && !message.location().url.includes("/favicon.ico")) errors.push(message.text());
  });

  await openDocker(page, "&guest=busybox");
  await page.evaluate(() => window.wvmDemo.runBusybox());
  await page.waitForFunction(() => window.wvmDemo.isGuestReady?.() === true, undefined, { timeout: 300_000 });
  await page.waitForFunction(() => window.__dockerStateForTest?.().runtime === "unavailable", undefined, {
    timeout: 90_000,
  });

  const state = await page.evaluate(() => window.__dockerStateForTest());
  expect(state.ready).toBe(true);
  expect(state.guestUp).toBe(true);
  expect(state.runtime).toBe("unavailable");
  await expect(page.locator("#ide-dk-runtime-status")).toContainText("Runtime absent");
  await expect(page.locator('#ide-dk button[data-action="run-image"]').first()).toBeDisabled();
  await expect(page.locator("#ide-dk-clist")).toContainText("stay locked");

  await page.locator("#ide-dk-pull").click();
  await expect(page.locator("#ide-dk-runtime")).toContainText("Live pull is unavailable");
  await expect(page.locator("#ide-dk-runtime")).toContainText("baked guest set");
  await page.locator("#ide-sb-net").click();
  await page.locator("#network-provider").selectOption("relay");
  await expect(page.locator("#ide-dk-runtime")).toContainText("provider relay");
  await page.locator("#network-provider").selectOption("offline");

  // When local Alpine metadata is present, the real bridge must reject switching an already-owned
  // busybox guest instead of pretending that Alpine booted. Public builds leave this button disabled.
  if (haveAlpineAssets) {
    await page.locator("#ide-dk-boot-alpine").click();
    await page.waitForFunction(() => window.__dockerStateForTest?.().runtime === "error", undefined, {
      timeout: 30_000,
    });
    await expect(page.locator("#ide-dk-runtime-status")).toContainText(/boot|owns|another guest/i);
    await expect(page.locator('#ide-dk button[data-action="run-image"]').first()).toBeDisabled();
  }

  expect(errors, `unexpected console errors: ${errors.join("; ")}`).toEqual([]);
});

test("E3.5-T05f1: public busybox build disables the Alpine bootstrap affordance", async ({ page }) => {
  const errors = [];
  const expectedMissingArtifactErrors = [];
  page.on("console", (message) => {
    if (message.type() !== "error" || message.location().url.includes("/favicon.ico")) return;
    if (/status of 404/i.test(message.text())) expectedMissingArtifactErrors.push(message.text());
    else errors.push(message.text());
  });
  await page.route("**/artifacts-alpine.json", (route) =>
    route.fulfill({ status: 404, contentType: "text/html", body: "<!doctype html><h1>404</h1>" }),
  );
  await openDocker(page, "&guest=busybox");
  await page.waitForFunction(() => window.__dockerStateForTest?.().alpineStatus === "absent", undefined, {
    timeout: 30_000,
  });

  const boot = page.locator("#ide-dk-boot-alpine");
  await expect(boot).toBeDisabled();
  await expect(boot).toHaveAttribute("title", /not deployed/i);
  await expect(page.locator("#ide-dk-runtime-status")).toContainText(/public busybox|catalog-only/i);
  await expect(page.locator('#ide-dk button[data-action="run-image"]').first()).toBeDisabled();
  expect(expectedMissingArtifactErrors.length).toBeGreaterThan(0);
  expect(errors, `unexpected console errors: ${errors.join("; ")}`).toEqual([]);
});

test("E3.5-T05f1: the in-tab Alpine button reaches the real runtime when explicitly enabled", async ({ page }) => {
  test.skip(process.env.E3_T05F1_ALPINE !== "1" || !haveAlpineAssets, "set E3_T05F1_ALPINE=1 with local Alpine assets");
  test.setTimeout(2_400_000);
  const errors = [];
  page.on("console", (message) => {
    if (message.type() === "error" && !message.text().includes("favicon")) errors.push(message.text());
  });

  await openDocker(page, "&guest=alpine&persist=0&noSnapshot=1");
  await page.waitForFunction(() => window.__dockerStateForTest?.().alpineStatus === "present", undefined, {
    timeout: 30_000,
  });
  await page.locator("#ide-dk-boot-alpine").click();
  await page.waitForFunction(() => window.wvmDemo.isGuestReady?.() === true, undefined, { timeout: 2_300_000 });
  await page.waitForFunction(() => window.__dockerStateForTest?.().runtime === "available", undefined, {
    timeout: 120_000,
  });
  await expect(page.locator("#ide-dk-runtime-status")).toContainText("Container runtime ready");
  await expect(page.locator('#ide-dk button[data-action="run-image"]').first()).toBeEnabled();
  expect(errors, `unexpected console errors: ${errors.join("; ")}`).toEqual([]);
});
