// E3.5-T05a browser-verification deliverable: the Docker tab boots the bundled busybox image on the
// REAL RISC-V Linux guest and runs ONE real command through it, streaming the guest's real output
// back into the Docker tab. Nothing here is faked — the marker is arithmetic the guest evaluates
// (echo CONTAINED_$((6*7)) → CONTAINED_42), so a host-side literal echo cannot satisfy it, and the
// transcript is the exact console byte stream xterm renders (wvmDemo.onConsole), not a JS buffer.
//
// Mirrors boot.spec.js / terminal.spec.js (real cold boot, ~1–2 min) and the long timeouts in
// playwright.config.js. Under Playwright every panel is revealed (tabs.js e2e-showall), so the
// Docker Run button is actionable without a tab click.
import { test, expect } from "@playwright/test";

const CONSOLE = "#dk-console";

/** Wait until the Docker tab + the boot bridge are wired. */
async function ready(page) {
  await page.goto("/#docker");
  await page.waitForFunction(() => window.wvmDemo && typeof window.wvmDemo.runBusybox === "function", null, {
    timeout: 60_000,
  });
  await expect(page.locator('[data-run="busybox"]').first()).toBeVisible();
}

test("Docker tab: Run boots the real guest and runs one real command (CONTAINED_42 from the guest)", async ({
  page,
}) => {
  test.setTimeout(240_000);
  const consoleErrors = [];
  page.on("console", (m) => {
    if (m.type() === "error" && !m.text().includes("favicon.ico")) consoleErrors.push(m.text());
  });

  await ready(page);
  await page.locator('[data-run="busybox"]').first().click();

  // 1) The bundled boot artifact (path + real sha256) is shown — proves we display the real asset.
  await expect(page.locator("#dk-artifact")).toContainText("initramfs.cpio.gz");
  await expect(page.locator("#dk-artifact")).toContainText(/[0-9a-f]{64}/);

  // 2) A live boot transcript appears in the Docker tab's own pane (the real console byte stream).
  await expect(page.locator(CONSOLE)).toContainText("busybox userland up", { timeout: 180_000 });

  // 3) The one real command runs IN the guest. CONTAINED_42 is computed via $((6*7)) — a host-side
  //    literal echo of the command string would print CONTAINED_$((6*7)), not CONTAINED_42, so this
  //    marker can only be satisfied by real guest execution.
  await expect(page.locator(CONSOLE)).toContainText("CONTAINED_42", { timeout: 60_000 });
  // 4) uname -m reports a RISC-V arch, and the command exits 0 (WVM_EXIT_$? is the real $?).
  await expect(page.locator(CONSOLE)).toContainText("riscv64");
  await expect(page.locator(CONSOLE)).toContainText("WVM_EXIT_0");

  // No typed-error box on the happy path.
  await expect(page.locator("#dk-error")).toBeHidden();

  await page.screenshot({ path: "test-results/docker-busybox.png", fullPage: false });
  expect(consoleErrors, `unexpected console errors: ${consoleErrors.join("; ")}`).toEqual([]);
});

test("Docker Run shows a typed error and NO canned output when the bundled artifact is missing", async ({
  page,
}) => {
  // Simulate a removed/undeployed artifact: the boot manifest 404s (an HTML error page, like Pages).
  await page.route("**/artifacts.json", (r) =>
    r.fulfill({ status: 404, contentType: "text/html", body: "<!DOCTYPE html><h1>404</h1>" }),
  );
  await ready(page);
  await page.locator('[data-run="busybox"]').first().click();

  // A typed error is shown; Run must NOT fall back to a mock shell or canned output.
  await expect(page.locator("#dk-error")).toBeVisible({ timeout: 30_000 });
  await expect(page.locator("#dk-error")).toContainText(/unavailable|not found|HTTP/i);

  // The computed guest marker must never appear from a fake path — now or after a beat.
  await expect(page.locator(CONSOLE)).not.toContainText("CONTAINED_42");
  await page.waitForTimeout(2500);
  await expect(page.locator(CONSOLE)).not.toContainText("CONTAINED");
});

test("Docker Run refuses corrupt busybox bytes with a typed error (no boot of corrupt bytes)", async ({
  page,
}) => {
  test.setTimeout(120_000);
  // The manifest is intact (artifact path + digest still display), but the initramfs bytes are
  // corrupted → the loader's sha256 integrity check must reject them → typed boot error, no fallback.
  await page.route("**/releases/initramfs/initramfs.cpio.gz", (r) =>
    r.fulfill({ status: 200, contentType: "application/gzip", body: Buffer.from("corrupt-not-a-real-initramfs") }),
  );
  await ready(page);
  await page.locator('[data-run="busybox"]').first().click();

  // The real artifact metadata still renders (manifest was fine)...
  await expect(page.locator("#dk-artifact")).toContainText("initramfs.cpio.gz");
  // ...but the boot is refused with a typed error mentioning the integrity failure.
  await expect(page.locator("#dk-error")).toBeVisible({ timeout: 60_000 });
  await expect(page.locator("#dk-error")).toContainText(/integrity|Boot failed|refus/i);

  await expect(page.locator(CONSOLE)).not.toContainText("CONTAINED_42");
});

test("no fake command-interpreter / canned-output / fake-digest path exists in docker.js", async ({
  page,
}) => {
  const src = await (await page.request.get("/docker.js")).text();

  // The computed marker must NEVER be shipped in JS — it can only come from the guest.
  expect(src).not.toMatch(/CONTAINED_42/);
  // No canned `id`/shell output baked into the page.
  expect(src).not.toMatch(/uid=\d+\(/);
  // No JS evaluation of guest commands (a fake interpreter smell).
  expect(src).not.toMatch(/\beval\s*\(/);

  // Positively confirm the real path is what's wired: the command uses in-guest arithmetic, and the
  // pane attaches to the real console stream + input bridge exposed by main.js.
  expect(src).toContain("$((6*7))");
  expect(src).toContain("onConsole");
  expect(src).toContain("sendInput");
  expect(src).toContain("runBusybox");
});
