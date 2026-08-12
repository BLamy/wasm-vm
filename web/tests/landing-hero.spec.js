import { expect, test } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const WEB_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("landing keeps the background shader and omits the scroll-reactive foreground", async ({ page }) => {
  await page.goto("/landing.html");

  const canvas = page.locator("#hero-canvas");
  await expect(canvas).toBeVisible();
  await expect(canvas).toHaveAttribute("data-hero-background", "shader-active");
  await expect(canvas).toHaveAttribute("data-hero-foreground", "none");
  await expect(canvas).toHaveCSS("background-image", /radial-gradient/);

  await page.evaluate(() => scrollTo(0, document.body.scrollHeight));
  await expect(canvas).toHaveAttribute("data-hero-background", "shader-active");
  await expect(canvas).toHaveAttribute("data-hero-foreground", "none");

  const source = fs.readFileSync(path.join(WEB_ROOT, "landing.js"), "utf8");
  expect(source).toContain("renderer.render(bgScene, bgCam)");
  expect(source).not.toContain("THREE.Points");
  expect(source).not.toContain("renderer.render(scene, camera)");
});
