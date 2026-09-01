import { expect, test } from "@playwright/test";

test("homepage shows the unified Node system workload matrix", async ({ page }) => {
  const errors = [];
  page.on("console", (message) => {
    if ((message.type() === "error" || message.type() === "warning") && !message.text().includes("favicon")) {
      errors.push(message.text());
    }
  });
  page.on("pageerror", (error) => errors.push(error.message));

  await page.goto("/landing.html");
  await expect(page.locator("#workload-updated")).not.toHaveText("loading…");
  await expect(page.locator("#workload-rows tr")).toHaveCount(7);
  for (const label of [
    "Native Node",
    "wasm-vm · worker + JIT",
    "wasm-vm · worker interpreter",
    "wasm-vm · main interpreter",
    "WebContainers",
    "almostnode",
    "WebVM",
  ]) {
    await expect(page.locator("#workload-rows")).toContainText(label);
  }
  await expect(page.locator("#runtime-workloads")).toContainText("HTTP round trip");
  await expect(page.locator("#runtime-workloads")).toContainText("p95");
  await expect(page.locator("#workload-rows")).toContainText("not measured");
  await expect(page.locator("#workload-rows")).not.toContainText("pending");
  await expect(page.locator("body")).not.toContainText("benchmarks.json");
  expect(errors, "browser errors: " + errors.join("; ")).toEqual([]);
});
