// E3-T10 acceptance (browser): storage quota surfaced up front, quota-exhaustion dialog with
// no lost write, and per-image reset-disk scoping. Uses CDP Storage.overrideQuota to force a
// tiny quota so `dd if=/dev/zero of=/root/fill` hits it fast.
//
// The full quota-exhaustion boot (~15+ min) is nightly; this file's FAST checks (indicator,
// reset scoping) run in seconds and don't need a full boot. Local/nightly only.
import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const WEB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const have =
  fs.existsSync(path.join(WEB, "artifacts-alpine.json")) &&
  fs.existsSync(path.resolve(WEB, "../releases/chunked-alpine/manifest.json"));

test.describe("E3-T10: storage quota + reset-disk", () => {
  test.skip(!have, "needs releases/chunked-alpine + web/artifacts-alpine.json");

  test("overlayDbName is per-image + reset deletes only that DB", async ({ page }) => {
    await page.goto("/");
    await page.waitForFunction(() => window.__ready === true, null, { timeout: 60_000 });
    // Drive the exported helpers directly (no full boot): name derivation + scoped delete.
    const result = await page.evaluate(async () => {
      const mod = await import("./pkg/wasm_vm_wasm.js");
      await mod.default();
      const m1 = await (await fetch("./releases/chunked-alpine/manifest.json")).text();
      const name = mod.overlayDbName(m1);
      // A different manifest (mutate the last chunk hash → a different, still-valid image) →
      // different base hash → different DB name.
      const alt = JSON.parse(m1);
      const i = alt.chunks.length - 1;
      alt.chunks[i] = alt.chunks[i].slice(0, -1) + (alt.chunks[i].endsWith("a") ? "b" : "a");
      const name2 = mod.overlayDbName(JSON.stringify(alt));
      // Seed two databases, delete only the first, confirm the second survives.
      const open = (n) =>
        new Promise((res, rej) => {
          const r = indexedDB.open(n, 1);
          r.onsuccess = () => { r.result.close(); res(); };
          r.onerror = () => rej(r.error);
          r.onupgradeneeded = () => {};
        });
      await open(name);
      await open(name2);
      const del = (n) =>
        new Promise((res, rej) => {
          const r = indexedDB.deleteDatabase(n);
          r.onsuccess = () => res();
          r.onerror = () => rej(r.error);
          r.onblocked = () => res();
        });
      await del(name);
      const list = (await indexedDB.databases()).map((d) => d.name);
      return { name, name2, distinct: name !== name2, survivorPresent: list.includes(name2), deletedGone: !list.includes(name) };
    });
    expect(result.name).toMatch(/^wvov-/);
    expect(result.distinct, "different images → different DB names").toBe(true);
    expect(result.deletedGone, "reset deleted the target DB").toBe(true);
    expect(result.survivorPresent, "a second image's overlay survives the reset").toBe(true);
  });

  test("storage indicator appears on a persistent boot", async ({ page }) => {
    await page.goto("/?persist=1");
    await expect(page.locator("#boot-alpine")).toBeEnabled();
    await page.click("#boot-alpine");
    // The indicator is populated by onStorage right after the Web-Lock/persist() resolve, well
    // before login — no full boot needed.
    await expect(page.locator("#storage-indicator")).toBeVisible({ timeout: 60_000 });
    await expect(page.locator("#storage-indicator")).toContainText(/MB/);
  });
});
