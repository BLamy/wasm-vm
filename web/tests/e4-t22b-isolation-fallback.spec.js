// E4-T22b: prove the served-page isolation gate before the later threaded-worker slices consume it.
// The headerless leg blocks service workers so it tests the clean fallback directly; the shim's
// second-load behavior is exercised by E4-T22g.
import { expect, test } from "@playwright/test";

const NO_HEADERS_BASE = (process.env.E4T22B_NOHEADERS_URL || "").replace(/\/+$/, "");

function collectErrors(page) {
  const errors = [];
  page.on("console", (message) => {
    if (message.type() === "error" && !message.text().includes("favicon")) errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(String(error)));
  return errors;
}

test("COOP/COEP headers select the shared backend before main.js", async ({ page }) => {
  const response = await page.request.get("/");
  expect(response.ok()).toBe(true);
  expect(response.headers()["cross-origin-opener-policy"]).toBe("same-origin");
  expect(response.headers()["cross-origin-embedder-policy"]).toBe("require-corp");

  const errors = collectErrors(page);
  await page.goto("/?noAutoBoot=1&nosw");
  await page.waitForFunction(() => Boolean(globalThis.__cpuBackendSelection));
  const observed = await page.evaluate(() => ({
    isolated: globalThis.crossOriginIsolated === true,
    selection: globalThis.__cpuBackendSelection,
    dataset: document.documentElement.dataset.cpuBackend,
  }));
  expect(observed.isolated).toBe(true);
  expect(observed.selection.backend).toBe("worker-shared");
  expect(observed.selection.wasmVariant).toBe("shared");
  expect(observed.dataset).toBe("worker-shared");
  expect(errors).toEqual([]);
});

test("headerless host with the shim unavailable falls back before wasm initialization", async ({ browser }) => {
  test.skip(!NO_HEADERS_BASE, "set E4T22B_NOHEADERS_URL to a plain static server");
  const context = await browser.newContext({ serviceWorkers: "block" });
  const page = await context.newPage();
  const errors = collectErrors(page);
  try {
    await page.goto(`${NO_HEADERS_BASE}/?noAutoBoot=1&nosw`);
    await page.waitForFunction(() => Boolean(globalThis.__cpuBackendSelection));
    const observed = await page.evaluate(() => ({
      isolated: globalThis.crossOriginIsolated === true,
      selection: globalThis.__cpuBackendSelection,
      dataset: document.documentElement.dataset.cpuBackend,
    }));
    expect(observed.isolated).toBe(false);
    expect(observed.selection.backend).toBe("single-thread");
    expect(observed.selection.shared).toBe(false);
    expect(observed.selection.wasmVariant).toBe("fallback");
    expect(observed.dataset).toBe("single-thread");
    expect(errors).toEqual([]);
  } finally {
    await context.close();
  }
});

test("headerless host reaches the shared backend after the shim-controlled reload", async ({ browser }) => {
  test.skip(!NO_HEADERS_BASE, "set E4T22B_NOHEADERS_URL to a plain static server");
  const context = await browser.newContext({ serviceWorkers: "allow" });
  const page = await context.newPage();
  const errors = collectErrors(page);
  try {
    await page.goto(`${NO_HEADERS_BASE}/?noAutoBoot=1&nosw`);
    await page.waitForFunction(() => Boolean(globalThis.__cpuBackendSelection), null, { timeout: 15_000 });
    const observed = await page.evaluate(() => ({
      isolated: globalThis.crossOriginIsolated === true,
      selection: globalThis.__cpuBackendSelection,
      controller: Boolean(navigator.serviceWorker?.controller),
    }));
    expect(observed.isolated).toBe(true);
    expect(observed.controller).toBe(true);
    expect(observed.selection.backend).toBe("worker-shared");
    expect(errors).toEqual([]);
  } finally {
    await context.close();
  }
});
