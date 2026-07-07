// Backlog restructure check: the roadmap panel shows the new E3.5 OCI epic and the
// cancelled E8 card, with zero console errors on load.
import { test, expect } from "@playwright/test";

test("roadmap panel: E3.5 present, E8 cancelled, no console errors", async ({ page }) => {
  const errs = [];
  page.on("console", (m) => {
    const t = m.text();
    if (m.type() === "error" && !t.includes("favicon.ico")) errs.push(t);
  });
  await page.goto("/");
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
