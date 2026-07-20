// E3-T05 acceptance: guest writes persist across a tab reload via the IndexedDB durable overlay.
// Boot Alpine on OverlayDisk+IdbBackend (?persist=1), write a unique token to /root/idbfile, force a
// durable flush (window.__persist resolves on the IndexedDB transaction complete), reload the page
// (IndexedDB survives a same-origin reload), boot again, and `cat /root/idbfile` — it must print the
// token written before the reload. Local/nightly only — needs the chunked image + artifacts-alpine.json
// (gitignored), so it SKIPS in CI. Two full ~12-min boots.
import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rows = "#term .xterm-rows";
const WEB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const have =
  fs.existsSync(path.join(WEB, "artifacts-alpine.json")) &&
  fs.existsSync(path.resolve(WEB, "../releases/chunked-alpine/manifest.json"));

test.describe("E3-T05: IndexedDB durable overlay survives a reload", () => {
  test.skip(!have, "needs releases/chunked-alpine + web/artifacts-alpine.json");

  test("a file written before reload is readable after reload+reboot", async ({ page }) => {
    test.setTimeout(1_800_000); // ~30 min: two full boots

    const errs = [];
    page.on("console", (m) => {
      const t = m.text();
      if (m.type() === "error" && !t.includes("favicon.ico") && !/Failed to load resource.*404/.test(t)) errs.push(t);
    });

    // A unique token so a stale IndexedDB from a prior run can't false-pass (the guest overwrites the
    // file with THIS token before the reload, so the readback must be exactly this).
    const token = `IDBTOK${Date.now() % 100000000}`;
    const type = (s) => page.evaluate((x) => window.__term.typeBytes(new TextEncoder().encode(x)), s);

    const bootToLogin = async () => {
      await expect(page.locator("#boot-alpine")).toBeEnabled();
      await page.click("#boot-alpine");
      let sawOpenRC = false;
      for (let i = 0; i < 900; i++) {
        const text = await page.locator(rows).textContent().catch(() => "");
        if (/Kernel panic|Unable to mount root/.test(text)) throw new Error("kernel panic");
        if (text.includes("OpenRC")) sawOpenRC = true;
        if (sawOpenRC && text.includes("login:")) return;
        await page.waitForTimeout(1500);
      }
      throw new Error("did not reach login:");
    };
    const rootLogin = async () => {
      await type("root\r");
      await page.waitForTimeout(3000);
      await type("\r"); // dismiss an optional Password:
      await page.waitForTimeout(2000);
    };

    // ── Boot 1: write the token + durably flush to IndexedDB ────────────────────────────────────
    await page.goto("/?persist=1");
    await bootToLogin();
    await rootLogin();
    await type(`echo ${token} > /root/idbfile && sync && echo WROTE_$((6*7))_OK\r`);
    await expect(page.locator(rows)).toContainText("WROTE_42_OK", { timeout: 120_000 });
    // Give the run loop's per-tick persistPending a moment to flush the write to IndexedDB, then force
    // one more flush to catch any last blocks. NOTE: we do NOT assert a specific flushed count — the
    // tick loop may have already drained the queue, so __persist() legitimately returns 0. The real
    // proof is the post-reload readback below.
    await page.waitForTimeout(4000);
    const persisted = await page.evaluate(() => window.__persist());
    expect(persisted, "persistPending resolved without error").toBeGreaterThanOrEqual(0);

    // ── Reload the tab (IndexedDB survives a same-origin reload) ────────────────────────────────
    await page.reload(); // re-navigates to /?persist=1 with a fresh WASM module

    // ── Boot 2: read the file back — it must be the token written before the reload ─────────────
    await bootToLogin();
    await rootLogin();
    await type("cat /root/idbfile\r");
    await expect(page.locator(rows)).toContainText(token, { timeout: 120_000 });

    expect(errs, `console errors: ${errs.join("; ")}`).toEqual([]);
  });
});
