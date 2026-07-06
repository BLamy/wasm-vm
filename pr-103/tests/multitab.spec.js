// E3-T09 acceptance: multi-tab safety via the writer Web Lock.
//   Race: two pages started <50ms apart, 20x — exactly ONE ever holds the writer lock (the
//     other shows the RO banner). The lock is decided at boot START, so no full boots needed.
//   RO guest: tab A boots rw to login; tab B (opened during A) shows the banner, reaches
//     login with `/` mounted ro, and a write fails with EROFS (echo-proof markers).
//   Takeover: close A; B's re-boot acquires the writer lock (banner absent).
// Local/nightly only (needs releases/chunked-alpine + web/artifacts-alpine.json).
import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rows = "#term .xterm-rows";
const WEB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const have =
  fs.existsSync(path.join(WEB, "artifacts-alpine.json")) &&
  fs.existsSync(path.resolve(WEB, "../releases/chunked-alpine/manifest.json"));

const bannerVisible = (page) =>
  page.evaluate(() => {
    const el = document.getElementById("ro-banner");
    return !!el && el.style.display !== "none" && el.textContent.includes("read-only");
  });

const startBoot = async (page) => {
  await page.goto("/?persist=1");
  await expect(page.locator("#boot-alpine-chunked")).toBeEnabled();
  await page.click("#boot-alpine-chunked");
};

test.describe("E3-T09: multi-tab single-writer", () => {
  test.skip(!have, "needs releases/chunked-alpine + web/artifacts-alpine.json");

  test("race: 20 simultaneous dual opens — exactly one writer each time", async ({ context }) => {
    test.setTimeout(1_200_000);
    for (let i = 0; i < 20; i++) {
      const a = await context.newPage();
      const b = await context.newPage();
      // Start both boots as close together as the driver allows (<50ms between clicks).
      await Promise.all([startBoot(a), startBoot(b)]);
      // The lock verdict lands right after the manifest fetch, well before the slow boot.
      await a.waitForTimeout(8000);
      const [roA, roB] = [await bannerVisible(a), await bannerVisible(b)];
      expect(
        roA !== roB,
        `iteration ${i}: exactly one RO expected — got roA=${roA} roB=${roB} (double-writer or double-RO)`,
      ).toBe(true);
      await a.close();
      await b.close();
      // Web Locks release on close; brief settle before the next round.
      await context.pages()[0]?.waitForTimeout?.(500).catch(() => {});
    }
  });

  test("RO guest boots usable with / mounted ro; EROFS on write; takeover after writer closes", async ({
    context,
  }) => {
    test.setTimeout(3_600_000);
    const type = (page, s) =>
      page.evaluate((x) => window.__term.typeBytes(new TextEncoder().encode(x)), s);
    const bootToLogin = async (page) => {
      let sawOpenRC = false;
      for (let i = 0; i < 900; i++) {
        const t = await page.locator(rows).textContent().catch(() => "");
        if (/Kernel panic/.test(t)) throw new Error("kernel panic");
        if (t.includes("OpenRC")) sawOpenRC = true;
        if (sawOpenRC && t.includes("login:")) return;
        await page.waitForTimeout(1500);
      }
      throw new Error("no login");
    };
    const login = async (page) => {
      await type(page, "root\r");
      await page.waitForTimeout(3000);
      await type(page, "\r");
      await page.waitForTimeout(2000);
      await type(page, 'echo SHELL_"UP"\r');
      await expect(page.locator(rows)).toContainText("SHELL_UP", { timeout: 60_000 });
    };

    // Tab A: the writer — boot it to login FIRST at full CPU (two parallel interpreter
    // boots starve each other past the login budget; an A idling at login: is nearly free
    // thanks to the E2-T23b WFI fast-forward).
    const a = await context.newPage();
    await startBoot(a);
    await a.waitForTimeout(8000);
    expect(await bannerVisible(a), "tab A must be the writer").toBe(false);
    await bootToLogin(a);
    await login(a);

    // Tab B while A holds the lock: must be RO from the first moment.
    const b = await context.newPage();
    await startBoot(b);
    await b.waitForTimeout(8000);
    expect(await bannerVisible(b), "tab B must be read-only").toBe(true);
    await bootToLogin(b);
    await login(b);

    // B: `/` is mounted ro — assert via a computed marker over /proc/mounts (echo-proof).
    await type(b, 'grep -q " / ext4 ro" /proc/mounts && echo MOUNT_"RO" || echo MOUNT_"RW"\r');
    await expect(b.locator(rows)).toContainText("MOUNT_RO", { timeout: 60_000 });
    // B: writes fail with EROFS, not corruption ("Read-only file system" is output-only).
    await type(b, "touch /root/blocked 2>&1\r");
    await expect(b.locator(rows)).toContainText("Read-only file system", { timeout: 60_000 });

    // A can still write (the writer): sanity marker.
    await type(a, 'touch /root/writer_ok && echo WRITER_"OK"\r');
    await expect(a.locator(rows)).toContainText("WRITER_OK", { timeout: 60_000 });

    // Takeover: close A (Web Lock auto-releases), B re-boots and must acquire the writer lock.
    await a.close();
    await b.waitForTimeout(2000);
    await b.reload();
    await startBoot(b);
    await b.waitForTimeout(8000);
    expect(await bannerVisible(b), "after the writer closed, B re-boots as WRITER").toBe(false);
    // Full rw re-boot to login is the same path every prior persist test proves; the lock
    // acquisition (no banner) is the takeover evidence this test adds.
  });
});
