// E4-T22 adversarial leg (#1): serve WITHOUT COOP/COEP and confirm the page falls back cleanly to
// the single-threaded build — no whitescreen, no half-boot, a console warning, same guest behavior.
//
// Runs on `dev` (browser). Uses a header-LESS static server (plain `python3 -m http.server` on
// web/, i.e. `make web-serve`) rather than tools/serve-dev.sh, so crossOriginIsolated is false.
// Point Playwright at it via E4T22_NOHEADERS_URL, e.g.:
//   (cd web && python3 -m http.server 8199) &
//   E4T22_NOHEADERS_URL=http://localhost:8199 npx playwright test e4-t22-fallback-no-headers
import { test, expect } from "@playwright/test";

const BASE = process.env.E4T22_NOHEADERS_URL;

test.describe("E4-T22 non-isolated fallback (browser; runs on dev)", () => {
  test.skip(!BASE, "set E4T22_NOHEADERS_URL to a header-less server (make web-serve)");

  test("no COOP/COEP → single-thread fallback with a console warning, no half-init", async ({
    page,
  }) => {
    const warnings = [];
    page.on("console", (m) => {
      if (m.type() === "warning") warnings.push(m.text());
    });

    await page.goto(BASE + "/");
    const isolated = await page.evaluate(() => globalThis.crossOriginIsolated === true);
    expect(isolated, "a header-less host must NOT be cross-origin isolated").toBe(false);

    const backend = await page.evaluate(async () => {
      const mod = await import("/cpu-isolation.js");
      return mod.chooseCpuBackend(globalThis);
    });
    expect(backend.backend).toBe("single-thread");
    expect(backend.wasmVariant).toBe("fallback");
    expect(warnings.some((w) => /single-threaded fallback/.test(w))).toBe(true);

    // The page must still be interactive (no whitescreen) — the boot control is present & enabled.
    await expect(page.locator("#boot-linux")).toBeEnabled();
  });
});
