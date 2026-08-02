// E3-T24c: versioned offline app shell (service worker). Verified against the real dev server with a
// real browser service worker + Playwright offline mode — no mocks. The SW (web/sw.js) runtime-caches
// same-origin app-shell GETs under a build-versioned cache, serves them cache-first, and excludes the
// disk chunks/overlay so it never double-owns the E3-T03 store.
import { expect, test } from "@playwright/test";

const SHELL_PREFIX = "wasm-vm-shell-";

// Wait until the SW controls the page and has cached the shell (one shell cache with entries).
async function shellCached(page) {
  await page.waitForFunction(() => navigator.serviceWorker && navigator.serviceWorker.controller !== null, null, {
    timeout: 30_000,
  });
  await page.waitForFunction(
    async (prefix) => {
      const keys = await caches.keys();
      const shell = keys.filter((k) => k.startsWith(prefix));
      if (shell.length !== 1) return false;
      const n = await (await caches.open(shell[0])).keys();
      return n.length > 0;
    },
    SHELL_PREFIX,
    { timeout: 30_000 },
  );
}

test("app shell loads offline after one visit, from one versioned cache", async ({ page, context }) => {
  await page.goto("/");
  await page.evaluate(() => navigator.serviceWorker.ready);
  // Reload once so the now-controlling SW caches the shell subresources it serves.
  await page.reload();
  await shellCached(page);

  // Exactly one shell cache — no half-old/half-new coexistence.
  const shellCaches = await page.evaluate(
    (p) => caches.keys().then((k) => k.filter((x) => x.startsWith(p))),
    SHELL_PREFIX,
  );
  expect(shellCaches).toHaveLength(1);

  // Go offline and reload — the shell must still load entirely from cache.
  await context.setOffline(true);
  await page.reload();
  await expect(page).toHaveTitle(/wasm|riscv|vm/i);
  // The real JS+wasm shell booted from cache: main.js's module ran and defined the bridge.
  await page.waitForFunction(() => typeof window.wvmDemo === "object" && window.wvmDemo !== null, null, {
    timeout: 30_000,
  });
  await context.setOffline(false);
});

test("a new build version purges the old shell cache atomically (no half-old/half-new)", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  await shellCached(page);

  // Seed a stale-version shell cache alongside the current one (simulating a prior build's cache
  // lingering), then run the exact purge that `activate` runs on an upgrade — via the SW's message
  // hook, so the assertion is deterministic (no re-registration timing). It must delete every
  // non-current shell cache, leaving exactly the current build's.
  const { before, after } = await page.evaluate(async (prefix) => {
    await caches.open(prefix + "STALEBUILD0001");
    const before = (await caches.keys()).filter((k) => k.startsWith(prefix)).sort();
    await new Promise((resolve) => {
      const ch = new MessageChannel();
      ch.port1.onmessage = () => resolve();
      navigator.serviceWorker.controller.postMessage({ type: "purge-other-shell-caches" }, [ch.port2]);
    });
    const after = (await caches.keys()).filter((k) => k.startsWith(prefix)).sort();
    return { before, after };
  }, SHELL_PREFIX);

  expect(before).toContain(`${SHELL_PREFIX}STALEBUILD0001`); // the stale cache was really present
  expect(before.length).toBeGreaterThanOrEqual(2);
  expect(after).toHaveLength(1); // atomic: exactly one build's cache survives
  expect(after[0]).not.toContain("STALEBUILD0001"); // and it's not the stale one
});

test("the shell cache is separate from disk storage and never holds disk chunks", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  await shellCached(page);

  const result = await page.evaluate(async (prefix) => {
    // (AC2) Clearing the SW cache must not touch IndexedDB (the overlay/chunk store owner). Put a
    // sentinel in IDB, delete the shell cache, confirm IDB survives.
    await new Promise((res, rej) => {
      const r = indexedDB.open("t24c-probe", 1);
      r.onupgradeneeded = () => r.result.createObjectStore("s");
      r.onsuccess = () => {
        const tx = r.result.transaction("s", "readwrite");
        tx.objectStore("s").put("kept", "k");
        tx.oncomplete = () => {
          r.result.close();
          res();
        };
        tx.onerror = () => rej(tx.error);
      };
      r.onerror = () => rej(r.error);
    });
    const shell = (await caches.keys()).filter((k) => k.startsWith(prefix));
    // (AC2) The shell cache must NOT contain the disk artifacts (owned by the E3-T03 chunk layer).
    const cache = await caches.open(shell[0]);
    const urls = (await cache.keys()).map((req) => req.url);
    const leakedDiskChunk = urls.some(
      (u) => u.includes("/releases/") || u.includes("/chunked-alpine") || u.endsWith(".ext4"),
    );
    await caches.delete(shell[0]); // clear ONLY the worker cache
    const idbSurvived = await new Promise((res) => {
      const r = indexedDB.open("t24c-probe", 1);
      r.onsuccess = () => {
        const tx = r.result.transaction("s", "readonly");
        const g = tx.objectStore("s").get("k");
        g.onsuccess = () => {
          r.result.close();
          res(g.result === "kept");
        };
        g.onerror = () => res(false);
      };
      r.onerror = () => res(false);
    });
    indexedDB.deleteDatabase("t24c-probe");
    return { leakedDiskChunk, idbSurvived };
  }, SHELL_PREFIX);

  expect(result.leakedDiskChunk, "shell cache must not own disk chunks").toBe(false);
  expect(result.idbSurvived, "clearing the SW cache must preserve IndexedDB").toBe(true);
});

test("cached responses retain their declared headers (AC3)", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  await shellCached(page);

  const ok = await page.evaluate(async (prefix) => {
    const shell = (await caches.keys()).filter((k) => k.startsWith(prefix));
    const cache = await caches.open(shell[0]);
    const cached = await cache.match("./main.js");
    if (!cached) return false;
    const net = await fetch("./main.js", { cache: "no-store" });
    // The cached response preserves the network response's declared content-type header.
    return (
      !!cached.headers.get("content-type") &&
      cached.headers.get("content-type") === net.headers.get("content-type")
    );
  }, SHELL_PREFIX);

  expect(ok, "cached main.js must retain its content-type header").toBe(true);
});
