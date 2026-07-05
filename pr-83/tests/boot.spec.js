// E2-T21 browser-verification deliverable. Encodes the two acceptance checks that were first
// verified interactively (Playwright MCP) so they are reproducible in CI-style headless runs.
//
//   1. Cold load boots unmodified Linux 6.6.63 + busybox to the shell prompt IN THE BROWSER,
//      with honest per-artifact progress reaching 100%.
//   2. A hash mismatch is REJECTED at the verify stage — the state machine never reaches
//      "booting" and a specific integrity error is surfaced. Corrupt bytes must never boot.
import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WEB_DIR = path.resolve(__dirname, "..");

test("cold load boots unmodified Linux to the busybox shell in the browser", async ({ page }) => {
  const consoleErrors = [];
  page.on("console", (m) => {
    // The only expected error is the benign favicon 404; anything else is a real regression.
    if (m.type() === "error" && !m.text().includes("favicon.ico")) consoleErrors.push(m.text());
  });

  await page.goto("/");
  // The demo initialises the ELF WasmMachine first; the Boot Linux button must be present.
  await expect(page.locator("#boot-linux")).toBeEnabled();

  await page.click("#boot-linux");

  // Progress must reach 100% for both artifacts (streamed fetch, honest counter).
  await expect(page.locator("#boot-progress")).toContainText("kernel 100%", { timeout: 60_000 });
  await expect(page.locator("#boot-progress")).toContainText("initramfs 100%", { timeout: 60_000 });

  // The definitive acceptance: the kernel hands off to /init and busybox comes up as PID 1,
  // rendered live in the xterm terminal. This is the E2-T15 banner, now in the browser.
  await expect(page.locator("#term .xterm-rows")).toContainText("busybox userland up", {
    timeout: 180_000,
  });
  await expect(page.locator("#term .xterm-rows")).toContainText("Run /init as init process");

  expect(consoleErrors, `unexpected console errors: ${consoleErrors.join("; ")}`).toEqual([]);
});

test("a corrupt kernel hash is rejected before boot (no booting corrupt bytes)", async ({ page }) => {
  // Serve a manifest whose kernel sha256 is deliberately wrong, alongside the real one.
  const good = JSON.parse(fs.readFileSync(path.join(WEB_DIR, "artifacts.json"), "utf8"));
  good.artifacts.kernel.sha256 = "deadbeef".repeat(8); // 64 hex chars, guaranteed mismatch
  const badPath = path.join(WEB_DIR, "artifacts-bad.test.json");
  fs.writeFileSync(badPath, JSON.stringify(good));
  try {
    await page.goto("/");
    const result = await page.evaluate(async () => {
      const m = await import("./loader.js");
      const states = [];
      let errMsg = null,
        reachedBooting = false;
      try {
        await m.startLinuxBoot({
          manifestUrl: "./artifacts-bad.test.json",
          onState: (s) => {
            states.push(s);
            if (s === "booting") reachedBooting = true;
          },
          onError: (e) => (errMsg = e.message),
        });
      } catch (e) {
        errMsg = errMsg || e.message;
      }
      return { states, reachedBooting, errMsg };
    });

    expect(result.reachedBooting).toBe(false);
    expect(result.states).toContain("verifying");
    expect(result.states).not.toContain("booting");
    expect(result.errMsg).toMatch(/integrity check failed for kernel/);
    expect(result.errMsg).toMatch(/refusing to boot corrupt bytes/);
  } finally {
    fs.rmSync(badPath, { force: true });
  }
});
