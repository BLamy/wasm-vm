// E3-T10's final demo gate: the storage capability remains visible while the complete browser
// compliance suite proves the machine underneath it. Opt-in because all 126 binaries are real.
import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const WEB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("E3-T10 demo: 126/0 compliance + storage quota roadmap evidence", async ({ page }) => {
  test.skip(process.env.E3_T10_DEMO !== "1", "set E3_T10_DEMO=1 for the full demo proof");
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

  const storage = page.locator(".cap", {
    hasText: "Storage quota + honest per-image reset",
  });
  await expect(storage.locator(".cap-pip")).toHaveClass(/verified/);
  await expect(storage).toContainText("50 MiB real-IDB abort");
  expect(errors, `console errors: ${errors.join("; ")}`).toEqual([]);

  const evidenceDir = path.resolve(WEB, "../evidence/e3-t10");
  fs.mkdirSync(evidenceDir, { recursive: true });
  await page.screenshot({ path: path.join(evidenceDir, "browser-demo-126-of-126.png"), fullPage: true });
});
