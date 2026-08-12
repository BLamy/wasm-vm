// E4-T32 adversarial leg: the whole-machine worker uses postMessage, not shared guest RAM, so it
// remains the default without COOP/COEP. Only JIT falls back to the fast interpreter. Serve `web/`
// with a plain static server and set E4T22_NOHEADERS_URL.
import { test, expect } from "@playwright/test";

const BASE = process.env.E4T22_NOHEADERS_URL;

test.describe("whole-machine worker on a non-isolated host", () => {
  test.skip(!BASE, "set E4T22_NOHEADERS_URL to a header-less server");

  test("worker remains active, JIT reports unavailable, and BusyBox stays usable", async ({ page }) => {
    test.setTimeout(240_000);
    const errors = [];
    page.on("console", (message) => {
      if (message.type() === "error" && !message.text().includes("favicon")) errors.push(message.text());
    });
    await page.goto(BASE + "/?guest=busybox&nosw&jit=1&jitThreshold=512");
    expect(await page.evaluate(() => globalThis.crossOriginIsolated)).toBe(false);
    await page.waitForFunction(() => window.wvmDemo?.isGuestReady(), null, { timeout: 180_000 });
    await page.waitForFunction(() => typeof window.__jitStats === "function", null, { timeout: 30_000 });
    const policy = await page.evaluate(async () => ({
      backend: document.documentElement.dataset.linuxBackend,
      jitPolicy: document.documentElement.dataset.jitPolicy,
      jit: await window.__jitStats(),
    }));
    expect(policy.backend).toBe("whole-machine-worker");
    expect(policy.jitPolicy).toBe("unavailable-no-isolation");
    expect(policy.jit.hasExecutor).toBe(false);
    const result = await page.evaluate(() => window.wvmDemo.run("echo NOHEADERS_$((6*7))", 30_000));
    expect(result.stdout).toContain("NOHEADERS_42");
    expect(errors).toEqual([]);
  });
});
