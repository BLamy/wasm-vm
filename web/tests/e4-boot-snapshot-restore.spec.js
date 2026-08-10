// E4 restore-on-first-load — the browser fast-boot path: instead of executing the ~40 s busybox
// Linux boot, the page restores a shipped build-time boot snapshot and lands at a live shell.
//
// DEFERRED VERIFICATION DEBT (see the task ledger): the Mac dev box OS-reaps long-running browser
// wasm boots, so the LIVE in-browser restore-to-ready STOPWATCH number is captured on `ssh dev`, not
// here. This spec is the wired driver: run it against a dev server that serves
// releases/boot-snapshot/busybox-ready.snap.gz (built by tools/build-boot-snapshot.sh) with
//   npx playwright test web/tests/e4-boot-snapshot-restore.spec.js
// It records the real restore time; NO number is fabricated in the deliverable — the only measured
// figure to date is the NATIVE 0.96 s (evidence/epic-3.6/snapshot-restore-prototype.md).
import { expect, test } from "@playwright/test";

test("busybox fast-boot restores from the shipped boot snapshot (no Linux boot)", async ({ page }) => {
  const marks = [];
  page.on("console", (m) => marks.push(m.text()));

  await page.goto("/?noAutoBoot=1");
  // Kick the busybox boot (the same entry point main.js's Boot button calls). Don't await — restore
  // completes mid-boot and we poll the flag below.
  await page.evaluate(() => { window.wvmDemo?.runBusybox?.(); });

  // The restore path emits a "host ready in Xs (restored…)" line into the terminal and flips the
  // controller's restoredFromBootSnapshot() flag. Wait for the restored state, then read the time.
  const t0 = Date.now();
  await page.waitForFunction(
    () => window.__linux?.restoredFromBootSnapshot?.() === true,
    null,
    { timeout: 120_000 },
  );
  const wallMs = Date.now() - t0;

  // A restored boot must NOT have paid the full Linux boot cost.
  expect(wallMs).toBeLessThan(60_000);
  // The terminal shows the honest stopwatch line.
  const ready = marks.some((m) => /host ready in [\d.]+s \(restored/.test(m));
  expect(ready).toBeTruthy();

  // eslint-disable-next-line no-console
  console.log(`E4 in-browser restore-to-restored wall time: ${(wallMs / 1000).toFixed(2)}s`);
});
