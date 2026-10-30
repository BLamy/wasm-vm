// E0-T30: the homepage's visual is the interactive architecture model (hero-scene.js). The
// decorative full-screen background shader (formerly landing.js) was removed; this spec used to
// assert that background and now asserts its absence alongside the model's real behavior.
import { expect, test } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const WEB_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("landing renders the architecture model and no decorative background", async ({ page }) => {
  await page.goto("/landing.html");
  await expect(page.locator("#hero-canvas")).toHaveCount(0);
  const model = page.locator("#machine-canvas");
  await expect(model).toHaveAttribute("data-model-ready", "true");
  expect(Number(await model.getAttribute("data-model-triangles"))).toBeGreaterThan(0);
  await page.evaluate(() => scrollTo(0, document.body.scrollHeight));
  await expect(model).toHaveAttribute("data-hero-foreground", "three-mesh-cutaway");

  expect(fs.existsSync(path.join(WEB_ROOT, "landing.js"))).toBe(false);
  const page_ = fs.readFileSync(path.join(WEB_ROOT, "landing-page.js"), "utf8");
  expect(page_).not.toContain("initHero");
  expect(page_).toContain("initMachineModel");
});
