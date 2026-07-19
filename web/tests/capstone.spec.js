// E2-T26/E3-T11 capstone e2e: the production, deterministic Alpine riscv64 image boots to a
// `login:` prompt IN THE BROWSER over lazily fetched chunks, then a root login works. Local/nightly
// only — generated image artifacts are gitignored, so it SKIPS when they are absent.
import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rows = "#term .xterm-rows";
const WEB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const haveAlpine =
  fs.existsSync(path.join(WEB, "artifacts-alpine.json")) &&
  fs.existsSync(path.resolve(WEB, "../releases/chunked-alpine/manifest.json"));

test.describe("capstone: Alpine in the browser", () => {
  test.skip(!haveAlpine, "needs E3-T11 chunked image + web/artifacts-alpine.json");

  test("boots Alpine over virtio-blk to a login: prompt and root logs in", async ({ page }) => {
    test.setTimeout(900_000); // ~15 min: a full OS boot in the interpreter

    const consoleErrors = [];
    page.on("console", (m) => {
      if (m.type() === "error" && !m.text().includes("favicon.ico")) consoleErrors.push(m.text());
    });

    await page.goto("/");
    await expect(page.locator("#boot-alpine")).toBeEnabled();
    await page.click("#boot-alpine");

    // The kernel mounts ext4 over the lazy chunk backend; a panic means the production image,
    // immutable chunk set, or parked-read completion path is broken.
    await expect(page.locator(rows)).toContainText("OpenRC", { timeout: 300_000 });
    await expect(page.locator(rows)).not.toContainText(/Kernel panic|Unable to mount root/);

    // OpenRC runs every service, then getty prints the login prompt.
    await expect(page.locator(rows)).toContainText("login:", { timeout: 720_000 });

    // Root login (passwordless): send the username, dismiss an optional Password:, prove the shell
    // executed a command via an output-only token (not the echoed command).
    const type = (s) => page.evaluate((x) => window.__term.typeBytes(new TextEncoder().encode(x)), s);
    await type("root\r");
    await page.waitForTimeout(3000);
    await type("\r"); // dismiss a Password: prompt if present
    await page.waitForTimeout(2000);
    await type("echo CAP_$((6*7))_OK\r");
    await expect(page.locator(rows)).toContainText("CAP_42_OK", { timeout: 60_000 });

    const stats = await page.evaluate(() => window.__chunkedStats());
    expect(stats).not.toBeNull();
    expect(stats.error).toBeNull();
    expect(stats.fetches).toBeGreaterThan(0);

    expect(consoleErrors, `unexpected console errors: ${consoleErrors.join("; ")}`).toEqual([]);
  });
});
