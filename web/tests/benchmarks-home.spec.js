import { expect, test } from "@playwright/test";

test("homepage shows verified competitor timings and clearly marks wasm-vm as pending", async ({ page }) => {
  const errors = [];
  page.on("console", (message) => {
    if (message.type() === "error" && !message.text().includes("favicon")) errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));

  await page.goto("/landing.html");
  await expect(page.locator("#bench-updated")).not.toHaveText("loading…");
  await expect(page.locator("#bench-rows tr")).toHaveCount(5);
  for (const label of ["Native Node", "WebVM", "almostnode", "WebContainers"]) {
    await expect(page.locator("#bench-rows")).toContainText(label);
  }
  await expect(page.locator("#bench-rows")).toContainText("pending");
  await expect(page.locator("#benchmarks thead")).toContainText("Per-runtime responsive readiness");
  expect(errors, "browser errors: " + errors.join("; ")).toEqual([]);
});
