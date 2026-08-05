// Web UX (Brett 2026-07-06): (1) the riscv-tests suite does NOT auto-run — it runs only via
// the "Run tests" button; (2) when the local-only Alpine artifacts are absent (the GitHub
// Pages case), the Alpine buttons are disabled up front with an explanation instead of a
// mid-boot error; the busybox boot button stays usable.
import { test, expect } from "@playwright/test";

test("suite is button-triggered; Alpine buttons disable gracefully when artifacts are absent", async ({
  page,
}) => {
  // Simulate GitHub Pages: the local-only manifest 404s (an HTML error page, like Pages).
  await page.route("**/artifacts-alpine.json", (r) =>
    r.fulfill({ status: 404, contentType: "text/html", body: "<!DOCTYPE html><h1>404</h1>" }),
  );
  const errs = [];
  page.on("console", (m) => {
    const t = m.text();
    if (m.type() === "error" && !t.includes("favicon.ico") && !/Failed to load resource/.test(t))
      errs.push(t);
  });
  await page.goto("/");
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 60_000 });

  // 1. No auto-run: give it a beat, then assert zero suite results ran.
  await page.waitForTimeout(4000);
  const ranBefore = await page.evaluate(
    () => document.querySelectorAll('[data-status="pass"], [data-status="fail"]').length,
  );
  expect(ranBefore, "suite must NOT auto-run on load").toBe(0);

  // 2. Alpine buttons disabled with the explanation; busybox boot stays enabled.
  await expect(page.locator("#boot-alpine")).toBeDisabled();
  const title = await page.locator("#boot-alpine").getAttribute("title");
  expect(title).toContain("local-only");
  await expect(page.locator("#boot-linux")).toBeEnabled();

  // 3. The button actually runs the suite (spot-check: results appear after clicking).
  await expect(page.locator("#suite-run")).toBeEnabled();
  await page.click("#suite-run");
  await page.waitForFunction(
    () => document.querySelectorAll('[data-status="pass"]').length > 5,
    null,
    { timeout: 300_000 },
  );

  expect(errs, `console errors: ${errs.join("; ")}`).toEqual([]);
});
