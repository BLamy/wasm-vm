// E3-T02 pass 4 e2e: the SAME unmodified Alpine riscv64 rootfs boots to `login:` IN THE BROWSER,
// but fetched LAZILY one E3-T01 chunk at a time over HTTP — no full-image download. Asserts the
// task's acceptance: reach login transferring < 40% of the image, and (via DevTools network) only
// per-chunk fetches, never the whole image. Local/nightly only — needs the chunked image
// (releases/chunked-alpine, produced by `wasm-vm chunk`) + web/artifacts-alpine.json for the kernel,
// both gitignored, so it SKIPS in CI. A browser Alpine boot is ~8-12 min at interpreter speed.
import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rows = "#term .xterm-rows";
const WEB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CHUNKED = path.resolve(WEB, "../releases/chunked-alpine");
const haveChunked =
  fs.existsSync(path.join(WEB, "artifacts-alpine.json")) &&
  fs.existsSync(path.join(CHUNKED, "manifest.json"));

const IMAGE_LEN = haveChunked
  ? JSON.parse(fs.readFileSync(path.join(CHUNKED, "manifest.json"), "utf8")).image_len
  : 0;

test.describe("E3-T02: Alpine in the browser via lazy chunk fetch", () => {
  test.skip(!haveChunked, "needs releases/chunked-alpine + web/artifacts-alpine.json (run `wasm-vm chunk`)");

  test("boots to login: fetching only touched chunks, under 40% of the image", async ({ page }) => {
    test.setTimeout(1_200_000); // ~20 min: a full OS boot in the interpreter

    const consoleErrors = [];
    page.on("console", (m) => {
      if (m.type() === "error" && !m.text().includes("favicon.ico")) consoleErrors.push(m.text());
    });

    // Record every chunk/manifest request so we can prove there was NO full-image download and
    // count the bytes independently of the in-wasm counter.
    const chunkReqs = [];
    let sawFullImage = false;
    page.on("response", (r) => {
      const u = r.url();
      if (u.includes("/chunked-alpine/chunks/")) chunkReqs.push(u);
      // A request for a single whole-image file would be the failure the task forbids.
      if (u.endsWith("/alpine-rootfs.ext4") || u.endsWith("/image.blob")) sawFullImage = true;
    });

    await page.goto("/");
    await expect(page.locator("#boot-alpine")).toBeEnabled();
    await page.click("#boot-alpine");

    // The kernel mounts the ext4 root over virtio-blk whose bytes arrive lazily — a panic here would
    // mean a parked read never completed or served wrong data.
    await expect(page.locator(rows)).toContainText("OpenRC", { timeout: 600_000 });
    await expect(page.locator(rows)).not.toContainText(/Kernel panic|Unable to mount root/);

    // getty prints the login prompt once every service has run.
    await expect(page.locator(rows)).toContainText("login:", { timeout: 900_000 });

    // Root login (passwordless) proves the shell is live over the lazily-backed rootfs.
    const type = (s) => page.evaluate((x) => window.__term.typeBytes(new TextEncoder().encode(x)), s);
    await type("root\r");
    await page.waitForTimeout(3000);
    await type("\r");
    await page.waitForTimeout(2000);
    await type("echo LAZY_$((6*7))_OK\r");
    await expect(page.locator(rows)).toContainText("LAZY_42_OK", { timeout: 60_000 });

    // E3-T11 pre-networking acceptance: apk itself runs in the production image and the guest is
    // configured for the two HTTPS repositories that Tailscale/relay networking will reach.
    // The full installed-package comparison is prohibitively slow under the wasm interpreter;
    // compare two versions directly to execute the subcommand without scanning the package DB.
    await type("apk version --test 1.0 1.0; echo APK_VERSION_RC=$?\r");
    await expect(page.locator(rows)).toContainText("=", { timeout: 180_000 });
    await expect(page.locator(rows)).toContainText("APK_VERSION_RC=0", { timeout: 180_000 });
    await type("cat /etc/apk/repositories\r");
    await expect(page.locator(rows)).toContainText(
      "https://dl-cdn.alpinelinux.org/alpine/v3.20/main",
      { timeout: 60_000 },
    );
    await expect(page.locator(rows)).toContainText(
      "https://dl-cdn.alpinelinux.org/alpine/v3.20/community",
      { timeout: 60_000 },
    );

    // Acceptance: the in-wasm instrumentation reports bytes transferred < 40% of the image, and the
    // network trace shows only per-chunk fetches (no whole-image request), with no fetch error.
    const stats = await page.evaluate(() => window.__chunkedStats());
    expect(stats, "chunked stats should be present").not.toBeNull();
    expect(stats.error, `fetch error: ${stats && stats.error}`).toBeNull();
    expect(sawFullImage, "must never request the whole image file").toBe(false);
    expect(chunkReqs.length, "should have fetched per-chunk").toBeGreaterThan(0);

    const pct = (stats.bytes / IMAGE_LEN) * 100;
    console.log(
      `[E3-T02] booted to login: ${stats.fetches} chunk fetches, ${stats.bytes} bytes ` +
        `(${pct.toFixed(1)}% of the ${IMAGE_LEN}-byte image); ${chunkReqs.length} network chunk requests`,
    );
    expect(pct, `transferred ${pct.toFixed(1)}% of the image (must be < 40%)`).toBeLessThan(40);

    expect(consoleErrors, `unexpected console errors: ${consoleErrors.join("; ")}`).toEqual([]);
  });
});
