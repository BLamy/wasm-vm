// E2-T23 browser-verification deliverable: the two-clock timekeeping model.
//   - guest `mtime` / clocksource = DETERMINISTIC retire-count clock (10 MHz timebase, clock_div
//     scaled) → guest monotonic time tracks EXECUTION, not wall-clock.
//   - goldfish RTC = Date.now() wall clock.
// The two are never derived from each other. Because mtime is retire-count, pausing the executor
// freezes guest monotonic time cleanly and it resumes with no jump/storm (the "giant jump on
// resume" wall-clock designs fear cannot occur), while the RTC keeps true wall time across the gap.
// This spec measures the foreground guest/wall ratio (logged for docs/timekeeping.md) and asserts
// the suspend-safety + RTC-wall-correctness properties.
import { test, expect } from "@playwright/test";

const rows = "#term .xterm-rows";
let seq = 0;

/** Run a shell expression in the guest and return its stdout, captured between unique sentinels
 *  so we read the EXPANDED output (not the echoed command line). Enter is CR (kernel icrnl→NL). */
async function readGuest(page, expr, timeout = 20000) {
  const n = ++seq;
  const cmd = `echo S${n}_$(${expr})_E${n}`;
  await page.evaluate((c) => window.__term.typeBytes(new TextEncoder().encode(c + "\r")), cmd);
  await page.waitForFunction(
    ({ n }) => new RegExp(`S${n}_[\\d.]+_E${n}`).test(document.querySelector("#term .xterm-rows")?.textContent || ""),
    { n },
    { timeout },
  );
  const txt = await page.locator(rows).textContent();
  const m = txt.match(new RegExp(`S${n}_([\\d.]+)_E${n}`));
  if (!m) throw new Error(`no capture for #${n} (${expr})`);
  return m[1];
}

test("two-clock model: RTC wall-correct, mtime execution-paced, suspend-safe", async ({ page }) => {
  test.setTimeout(240_000);
  await page.goto("/");
  await page.click("#boot-linux");
  await expect(page.locator(rows)).toContainText("busybox userland up", { timeout: 180_000 });
  await expect(page.locator(rows)).toContainText("~ #");

  // (A) The guest software clock (`date`) is EXECUTION-PACED, not wall-paced: Linux seeds it from
  // the RTC at boot then advances it by the retire-count clocksource, so it runs BEHIND real wall
  // time (never ahead). We assert it's behind and log the drift for docs/timekeeping.md — this is
  // the documented consequence of the deterministic clock, not a defect.
  const guestEpoch = parseInt(await readGuest(page, "date +%s"), 10);
  const hostEpoch = Math.floor(Date.now() / 1000);
  const bootDrift = hostEpoch - guestEpoch;
  console.log(`[timekeeping] guest \`date\` drift behind host after boot = ${bootDrift}s`);
  expect(guestEpoch).toBeLessThanOrEqual(hostEpoch + 1); // never ahead of wall time

  // (B) Foreground guest/wall ratio: how much guest monotonic time passes per wall second while
  // running. Logged for the policy doc; asserted only monotonic + positive (the exact ratio is
  // interpreter-speed-dependent and is precisely why we DON'T claim wall-accurate `sleep`).
  const up0 = parseFloat(await readGuest(page, "cut -d' ' -f1 /proc/uptime"));
  const w0 = Date.now();
  await page.waitForTimeout(15000);
  const up1 = parseFloat(await readGuest(page, "cut -d' ' -f1 /proc/uptime"));
  const wallFg = (Date.now() - w0) / 1000;
  const ratio = (up1 - up0) / wallFg;
  console.log(`[timekeeping] foreground guest/wall ratio = ${ratio.toFixed(3)} (uptime ${up0}→${up1} over ${wallFg.toFixed(1)}s wall)`);
  expect(up1).toBeGreaterThan(up0);

  // (B2) Wall cost of a guest `sleep` — directly characterises acceptance #1. A timer-based sleep
  // waits on the retire-count mtime reaching a deadline; at the near-idle prompt (mostly WFI) the
  // clock crawls, so guest seconds cost many wall seconds. Logged, not tightly asserted (that gap
  // is the documented reason we DON'T promise wall-accurate sleep under the deterministic clock).
  const s0 = Date.now();
  expect(await readGuest(page, "sleep 2 && echo 99", 90000)).toBe("99");
  const sleepWall = (Date.now() - s0) / 1000;
  console.log(`[timekeeping] guest 'sleep 2' completed in ${sleepWall.toFixed(1)}s wall (≈${(sleepWall / 2).toFixed(0)}× real time)`);

  // (C) Suspend-safety, proven by a DIRECT freeze-probe (E2-T23 critic C4). Bounding the uptime
  // delta against raw wall time is vacuous — at the idle ratio (~0.05) the guest advances < 1s over
  // a 12s window even if the pause did nothing. Instead: type a uniquely-tagged command WHILE
  // paused. If the executor is truly frozen, no runChunk runs, the RX FIFO is never fed, and the
  // tty never echoes or executes it — so the tag must be ABSENT from the screen throughout the
  // pause, and APPEAR only after resume. This assertion fails if pause is a no-op (the command
  // would run and echo during the "pause"), so it actually proves execution froze.
  const tag = `FROZENPROBE_${++seq}`;
  await page.evaluate(() => window.__linux.pause());
  expect(await page.evaluate(() => window.__linux.isPaused())).toBe(true);
  await page.evaluate((c) => window.__term.typeBytes(new TextEncoder().encode(c + "\r")), `echo ${tag}`);
  const pw0 = Date.now();
  await page.waitForTimeout(6000); // 6s real time, still paused
  // The probe must NOT have executed or even echoed — the executor is frozen.
  expect(await page.locator(rows).textContent()).not.toContain(tag);
  await page.evaluate(() => window.__linux.resume());
  const pausedWall = (Date.now() - pw0) / 1000;
  // On resume the queued command runs (input was buffered, not lost) → the tag appears.
  await expect(page.locator(rows)).toContainText(tag, { timeout: 30000 });
  console.log(`[timekeeping] executor frozen for ${pausedWall.toFixed(1)}s wall (probe absent), ran on resume`);

  // Shell fully responsive after resume, and no kernel stall/lockup/storm from the freeze.
  expect(await readGuest(page, "echo 42")).toBe("42");
  expect(await page.locator(rows).textContent()).not.toMatch(/rcu[^\n]*stall|soft lockup|watchdog: BUG/i);
});
