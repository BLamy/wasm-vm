import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

test("Sv39 separated-page memory is live in the complete browser suite", async ({ page }) => {
  test.setTimeout(900_000);
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await page.goto("/");
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 60_000 });
  await page.locator("#suite-run").click();
  await expect(page.locator("#metric-done")).toHaveText("127", { timeout: 600_000 });
  await expect(page.locator("#metric-pass")).toHaveText("127");
  await expect(page.locator("#metric-fail")).toHaveText("0");
  await expect(page.locator("#suite-status")).toContainText("complete");
  const capability = page.locator(".cap", { hasText: "Scalar memory across virtual-page boundaries" });
  await expect(capability.locator(".cap-pip")).toHaveClass(/\blive\b/, { timeout: 5_000 });
  await expect(capability).toContainText("live");
  expect(errors).toEqual([]);
  const evidence = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../evidence/omarchy-memory");
  fs.mkdirSync(evidence, { recursive: true });
  await page.screenshot({ path: path.join(evidence, "browser-127-of-127.png"), fullPage: true });
});
