// E3-T08 crashtest (browser leg): kill the tab MID-WRITE-BURST, reboot from the persisted
// IndexedDB overlay, and prove crash consistency — the ext4 root mounts rw (journal clean or
// recovered), the guest sees ZERO EXT4 error lines, and a file that was durably synced BEFORE
// the kill is intact afterwards. This is the honest-FLUSH contract (#100) under real fire:
// FLUSH acks only after the IndexedDB strict-durability transaction, so a tab kill at any
// moment must leave a mountable filesystem and never lose an acked sync.
//
// Echo-proof discipline throughout (E3-T13 F1): markers computed in-guest, never literal in
// the typed command.
//
// Local/nightly only (needs releases/chunked-alpine + web/artifacts-alpine.json). TWO full
// boots per kill cycle; KILLS=2 keeps the evidence run ~50 min. The task's ≥10-30-kill loop
// is the nightly-scale extension of exactly this harness.
import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rows = "#term .xterm-rows";
const WEB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const have =
  fs.existsSync(path.join(WEB, "artifacts-alpine.json")) &&
  fs.existsSync(path.resolve(WEB, "../releases/chunked-alpine/manifest.json"));
const KILLS = Number(process.env.CRASHTEST_KILLS || 2);

test.describe("E3-T08: tab-kill crash consistency on the durable overlay", () => {
  test.skip(!have, "needs releases/chunked-alpine + web/artifacts-alpine.json");

  test(`survives ${KILLS} mid-write-burst tab kills (journal clean/recovered, synced data intact)`, async ({
    context,
  }) => {
    test.setTimeout(KILLS * 2 * 1_200_000 + 600_000);

    const bootToShell = async (page) => {
      await page.goto("/?persist=1");
      await expect(page.locator("#boot-alpine")).toBeEnabled();
      await page.click("#boot-alpine");
      let sawOpenRC = false;
      for (let i = 0; i < 900; i++) {
        const t = await page.locator(rows).textContent().catch(() => "");
        if (/Kernel panic/.test(t)) throw new Error("kernel panic");
        if (t.includes("OpenRC")) sawOpenRC = true;
        if (sawOpenRC && t.includes("login:")) break;
        await page.waitForTimeout(1500);
      }
      const type = (s) =>
        page.evaluate((x) => window.__term.typeBytes(new TextEncoder().encode(x)), s);
      await type("root\r");
      await page.waitForTimeout(3000);
      await type("\r");
      await page.waitForTimeout(2000);
      await type('echo SHELL_"UP"\r');
      await expect(page.locator(rows)).toContainText("SHELL_UP", { timeout: 60_000 });
      return type;
    };

    for (let cycle = 1; cycle <= KILLS; cycle++) {
      // ── Boot N: write a durable marker, start the burst, then KILL mid-burst ─────────────
      let page = await context.newPage();
      let type = await bootToShell(page);

      const token = `CRASHTOK_${cycle}_${Date.now() % 1000000}`;
      // The marker is durably synced BEFORE the burst: with honest FLUSH (#100), once this
      // sync's ack round-trips, a kill at ANY later moment must not lose it.
      await type(`echo ${token} > /root/durable.txt && sync && echo SYNCED_"OK"\r`);
      await expect(page.locator(rows)).toContainText("SYNCED_OK", { timeout: 180_000 });
      // Give the persist pump a beat to complete the strict-durability transaction the FLUSH
      // ack was gated on (ack implies it landed; the wait is belt-and-suspenders).
      await page.waitForTimeout(3000);

      // Journal churn: copy/sync/delete in a loop, detached.
      await type(
        "(while :; do cp -r /etc /root/burst 2>/dev/null; sync; rm -rf /root/burst; done) & echo BURST_\"ON\"\r",
      );
      await expect(page.locator(rows)).toContainText("BURST_ON", { timeout: 60_000 });

      // Random mid-transaction kill: 3-15s into the burst, close the page with no shutdown.
      await page.waitForTimeout(3000 + Math.floor(Math.random() * 12000));
      await page.close({ runBeforeUnload: false });

      // ── Boot N+1 (same context → same IndexedDB): recovery + integrity checks ────────────
      page = await context.newPage();
      type = await bootToShell(page);

      // 1. Root mounted rw (we got a shell, and remount proves writability).
      await type('touch /root/rwprobe && echo RW_"OK"\r');
      await expect(page.locator(rows)).toContainText("RW_OK", { timeout: 60_000 });

      // 2. Zero EXT4 error lines (journal either clean or recovered — recovery is FINE and
      //    expected after a kill; errors/corruption refute).
      await type("dmesg | grep -cE 'EXT4-fs error|EXT4-fs warning|corrupt' | sed 's/^/EXTBAD=/'\r");
      await expect(page.locator(rows)).toContainText("EXTBAD=0", { timeout: 60_000 });

      // 3. The durably-synced marker survived the kill (the honest-FLUSH acceptance).
      await type("cat /root/durable.txt\r");
      await expect(page.locator(rows)).toContainText(token, { timeout: 60_000 });

      // Clean up burst leftovers for the next cycle (their state is legitimately arbitrary).
      await type('rm -rf /root/burst && sync && echo CLEAN_"OK"\r');
      await expect(page.locator(rows)).toContainText("CLEAN_OK", { timeout: 120_000 });
      await page.waitForTimeout(3000);
      await page.close();
    }
  });
});
