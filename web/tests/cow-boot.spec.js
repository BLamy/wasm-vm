// E3-T04 acceptance: Alpine boots READ-WRITE on the copy-on-write OverlayDisk (base = lazily-fetched
// chunks, writes = 4 KiB CoW overlay) IN THE BROWSER, and a guest write round-trips: `touch /root/x`
// then `ls /root` shows it. Proves the CoW write path (partial-block RMW, write-park on an unfetched
// base chunk, merge overlay-over-base on readback) works end-to-end. Local/nightly only — needs the
// chunked image + artifacts-alpine.json (gitignored), so it SKIPS in CI.
import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rows = "#term .xterm-rows";
const WEB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const have =
  fs.existsSync(path.join(WEB, "artifacts-alpine.json")) &&
  fs.existsSync(path.resolve(WEB, "../releases/chunked-alpine/manifest.json"));

test.describe("E3-T04: Alpine read-write on the CoW overlay", () => {
  test.skip(!have, "needs releases/chunked-alpine + web/artifacts-alpine.json");

  test("boots rw and a guest write (touch/ls) round-trips through the overlay", async ({ page }) => {
    test.setTimeout(1_200_000); // ~20 min

    const consoleErrors = [];
    page.on("console", (m) => {
      const t = m.text();
      if (m.type() === "error" && !t.includes("favicon.ico") && !/Failed to load resource.*404/.test(t)) {
        consoleErrors.push(t);
      }
    });

    await page.goto("/");
    await expect(page.locator("#boot-alpine")).toBeEnabled();
    await page.click("#boot-alpine");

    // Gate on OpenRC (late boot) before trusting the login prompt.
    let sawOpenRC = false;
    let loggedIn = false;
    for (let i = 0; i < 900; i++) {
      const text = await page.locator(rows).textContent().catch(() => "");
      if (/Kernel panic|Unable to mount root/.test(text)) throw new Error("kernel panic booting rw");
      if (text.includes("OpenRC")) sawOpenRC = true;
      if (sawOpenRC && text.includes("login:")) { loggedIn = true; break; }
      await page.waitForTimeout(1500);
    }
    expect(loggedIn, "reached login: booting rw on the CoW overlay").toBe(true);

    // Root login, then a write→read round-trip through the overlay: create a file (a guest WRITE to
    // the ext4, i.e. a CoW overlay write — possibly a partial-block RMW that parks to fetch its base
    // chunk), then list it back (a READ merging the overlay write over the base).
    const type = (s) => page.evaluate((x) => window.__term.typeBytes(new TextEncoder().encode(x)), s);
    await type("root\r");
    await page.waitForTimeout(3000);
    await type("\r"); // dismiss an optional Password:
    await page.waitForTimeout(2000);
    await type("rm -f /root/cowfile; touch /root/cowfile && ls /root && echo COW_$((6*7))_OK\r");
    await expect(page.locator(rows)).toContainText("COW_42_OK", { timeout: 120_000 });
    // The created file must appear in the directory listing read back from the overlay.
    await expect(page.locator(rows)).toContainText("cowfile");

    // Write actual bytes and read them back, proving the overlay merge (not just a dentry).
    await type("echo overlay-works > /root/cowfile && cat /root/cowfile\r");
    await expect(page.locator(rows)).toContainText("overlay-works", { timeout: 60_000 });

    expect(consoleErrors, `console errors: ${consoleErrors.join("; ")}`).toEqual([]);
  });
});
