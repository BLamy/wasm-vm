// E2-T26 capstone e2e: unmodified Alpine riscv64 boots to a `login:` prompt IN THE BROWSER over
// virtio-blk, then a root login works. Local/nightly only — it needs the 512 MB rootfs +
// web/artifacts-alpine.json (both gitignored, produced by tools/demo-capstone.sh), so it SKIPS if
// they're absent (e.g. in CI). A browser Alpine boot is ~8-12 min at interpreter speed.
import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rows = "#term .xterm-rows";
const WEB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const haveAlpine =
  fs.existsSync(path.join(WEB, "artifacts-alpine.json")) &&
  fs.existsSync(path.resolve(WEB, "../releases/rootfs/alpine-rootfs.ext4"));

test.describe("capstone: Alpine in the browser", () => {
  test.skip(!haveAlpine, "needs web/artifacts-alpine.json + releases/rootfs (run tools/demo-capstone.sh)");

  test("boots Alpine over virtio-blk to a login: prompt and root logs in", async ({ page }) => {
    test.setTimeout(900_000); // ~15 min: a full OS boot in the interpreter

    const consoleErrors = [];
    page.on("console", (m) => {
      if (m.type() === "error" && !m.text().includes("favicon.ico")) consoleErrors.push(m.text());
    });

    await page.goto("/");
    await expect(page.locator("#boot-alpine")).toBeEnabled();
    await page.click("#boot-alpine");

    // The 512 MB image fetches + integrity-checks, then the kernel mounts the ext4 root over
    // virtio-blk — a panic here would mean the browser block device is broken.
    await expect(page.locator("#boot-progress")).toContainText("rootfs 100%", { timeout: 120_000 });
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

    expect(consoleErrors, `unexpected console errors: ${consoleErrors.join("; ")}`).toEqual([]);
  });
});
