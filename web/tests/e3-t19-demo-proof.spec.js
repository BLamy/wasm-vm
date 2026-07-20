// E3-T19's browser-facing gate: the provider lifecycle/security row must remain visible while the
// complete live compliance suite proves the machine underneath it. Opt-in because all 126 binaries
// are real and the screenshot is a committed evidence artifact.
import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const WEB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("E3-T19 demo: 126/0 compliance + hardened provider lifecycle evidence", async ({ page }) => {
  test.skip(process.env.E3_T19_DEMO !== "1", "set E3_T19_DEMO=1 for the full demo proof");
  test.setTimeout(900_000);

  const errors = [];
  page.on("console", (message) => {
    const text = message.text();
    if (
      message.type() === "error" &&
      !text.includes("favicon.ico") &&
      !/Failed to load resource.*404/.test(text)
    ) {
      errors.push(text);
    }
  });

  await page.goto("/");
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 60_000 });
  await expect(page.locator("#suite-run")).toBeEnabled();
  await page.click("#suite-run");

  await expect(page.locator("#metric-done")).toHaveText("126", { timeout: 600_000 });
  await expect(page.locator("#metric-pass")).toHaveText("126");
  await expect(page.locator("#metric-fail")).toHaveText("0");
  await expect(page.locator("#suite-status")).toContainText("complete");

  const capability = page.locator(".cap", {
    hasText: "Network provider lifecycle + relay policy",
  });
  await expect(capability.locator(".cap-pip")).toHaveClass(/verified/);
  await expect(capability).toContainText("Origin-bound relay tokens");
  await expect(capability).toContainText("shared abuse budgets");
  expect(errors, `console errors: ${errors.join("; ")}`).toEqual([]);

  const evidenceDir = path.resolve(WEB, "../evidence/e3-t19");
  fs.mkdirSync(evidenceDir, { recursive: true });
  await page.screenshot({
    path: path.join(evidenceDir, "browser-demo-126-of-126.png"),
    fullPage: true,
  });
});
