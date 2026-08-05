// Roadmap smoke: task evidence stays visible and the panel loads without console errors.
import { test, expect } from "@playwright/test";

test("roadmap panel: image pipeline evidence, E3.5, and E8 render without errors", async ({ page }) => {
  const errs = [];
  page.on("console", (m) => {
    const t = m.text();
    if (m.type() === "error" && !t.includes("favicon.ico")) errs.push(t);
  });
  await page.goto("/");
  const imagePipeline = page.locator(".cap", { hasText: "Chunked disk image format" });
  await expect(imagePipeline).toContainText("cold-cache byte-identical rebuild");
  await expect(imagePipeline.locator(".cap-pip")).toHaveClass(/verified/);
  const e35 = page.locator(".epic-card", {
    has: page.locator(".epic-tag", { hasText: /^E3\.5$/ }),
  });
  await expect(e35).toBeVisible();
  await expect(e35).toContainText("Tiny OCI runner");
  const e8 = page.locator(".epic-card.cancelled", { hasText: "Chrome in Chrome" });
  await expect(e8).toBeVisible();
  await expect(e8).toContainText("cancelled");
  await page.waitForTimeout(1500);
  expect(errs, `console errors: ${errs.join("; ")}`).toEqual([]);
  await page.screenshot({ path: "test-results/roadmap-oci.png", fullPage: false });
});
