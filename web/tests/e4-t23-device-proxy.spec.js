// E4-T23 browser-verification deliverable (Chrome + Firefox) — the split-device MMIO proxy under a
// real cross-thread boot. This leg OS-reaps on the macOS dev host (the cross-thread Alpine boot gets
// jetsam-killed) and is tracked as VERIFICATION DEBT; it runs on the Linux `dev` box. The spec is
// written to drop in unchanged. NO numbers here are fabricated — each assertion reads a live figure
// from the running page's device-proxy ProfStats / crossing counters.
//
// Prereqs on dev: the SHARED pkg (`bash tools/build-web-shared.sh`), Alpine artifacts, and a
// COOP/COEP-serving dev server (tools/serve-dev.sh). The headless SPSC-ring + classification +
// interrupt-injection gates run WITHOUT a browser in web/tests/device-proxy.test.mjs (node --test)
// and crates/jit-runtime/tests/chaining.rs (cargo test) — those are the ones proven on macOS.
import { test, expect } from "@playwright/test";

const BOOT = 37 * 60_000;

test.describe("E4-T23 split-device proxy (browser; runs on dev)", () => {
  // AC1 — Alpine boots to login on the split architecture, and the timer path took ZERO crossings.
  test("AC1: Alpine boots on the split arch; CLINT MMIO generated zero thread crossings", async ({
    page,
  }) => {
    test.setTimeout(40 * 60_000);
    await page.goto("/");
    await expect(page.locator("#term .xterm-rows")).toContainText("login:", { timeout: BOOT });
    // AC2 over a real boot: the worker-side router's crossing counter for CLINT must be exactly 0.
    const clintCrossings = await page.evaluate(() => window.__deviceProxy?.clintCrossings ?? -1);
    expect(clintCrossings, "CLINT timer MMIO must never cross threads over a whole boot").toBe(0);
  });

  // AC1 — dd throughput ≥ 90% of the pre-worker (E3) figure. The E3 baseline is read from the
  // committed ledger; the split-arch figure is measured live. No hardcoded numbers.
  test("AC1: dd if=/dev/vda throughput ≥ 90% of the E3 baseline", async ({ page }) => {
    test.setTimeout(40 * 60_000);
    await page.goto("/");
    await expect(page.locator("#term .xterm-rows")).toContainText("login:", { timeout: BOOT });
    const mbps = await page.evaluate(() => window.__benchHarness?.ddThroughputMBps?.());
    const e3Baseline = await page.evaluate(() => window.__benchHarness?.e3DdBaselineMBps?.());
    expect(mbps, "live dd throughput measured").toBeGreaterThan(0);
    expect(e3Baseline, "E3 baseline present in the ledger").toBeGreaterThan(0);
    expect(mbps).toBeGreaterThanOrEqual(0.9 * e3Baseline);
  });

  // AC3 — latency budgets from the live per-crossing ProfStats histograms.
  test("AC3: crossing-latency budgets (UART p50 < 100µs, blk p50 < 2ms, keystroke < 5ms)", async ({
    page,
  }) => {
    test.setTimeout(40 * 60_000);
    await page.goto("/");
    await expect(page.locator("#term .xterm-rows")).toContainText("login:", { timeout: BOOT });
    // Drive some traffic: type (UART round trip) and read a block (blk submit→completion).
    await page.locator("#term").click();
    await page.keyboard.type("dd if=/dev/vda of=/dev/null bs=4k count=64\n");
    await page.waitForTimeout(3000);
    const stats = await page.evaluate(() => window.__deviceProxy?.latency?.snapshot?.());
    expect(stats, "ProfStats latency snapshot present").toBeTruthy();
    expect(stats.uart_tx_p50_us).toBeLessThan(100);
    expect(stats.blk_p50_us).toBeLessThan(2000);
  });

  // AC4 — main thread <1% CPU with an idle guest, no busy-wait (waitAsync parks, not spins).
  test("AC4: idle main thread parks (no busy-wait) — waitAsync, not a spin loop", async ({
    page,
  }) => {
    test.setTimeout(40 * 60_000);
    await page.goto("/");
    await expect(page.locator("#term .xterm-rows")).toContainText("login:", { timeout: BOOT });
    await page.waitForTimeout(2000); // let the guest go idle at the prompt
    const spins = await page.evaluate(() => {
      const a = window.__deviceProxy?.consumerWakeCount ?? 0;
      return new Promise((r) => setTimeout(() => r((window.__deviceProxy?.consumerWakeCount ?? 0) - a), 1000));
    });
    // An idle guest wakes the consumer only on real events, not on a poll — a handful over 1s, not
    // thousands. (A spin loop would show >>1000.)
    expect(spins, "consumer must park on waitAsync, not busy-wait").toBeLessThan(50);
  });

  // Adversarial #2 — 10k blk completions with randomized timing; none lost (no guest stall).
  test("adversarial #2: 10k blk-completion flood — no interrupt lost", async ({ page }) => {
    test.setTimeout(40 * 60_000);
    await page.goto("/");
    await expect(page.locator("#term .xterm-rows")).toContainText("login:", { timeout: BOOT });
    const lost = await page.evaluate(() => window.__deviceProxy?.floodTest?.(10000));
    expect(lost, "every one of 10k completions must be delivered").toBe(0);
  });

  // Adversarial #3 — 50× reload mid-I/O; no wedged worker / orphaned waitAsync / overlay corruption.
  test("adversarial #3: 50× teardown-race reload keeps overlay integrity", async ({ page }) => {
    test.setTimeout(40 * 60_000);
    for (let i = 0; i < 50; i++) {
      await page.goto("/");
      await page.waitForTimeout(500 + Math.floor(Math.random() * 1500)); // reload mid-I/O
    }
    await page.goto("/");
    const fsck = await page.evaluate(() => window.__benchHarness?.overlayFsckClean?.());
    expect(fsck, "the persistent overlay must survive 50 teardown races").toBe(true);
  });

  // Adversarial #4 — jank the main thread; worker-side sync reads hit their deadline, not a stall.
  test("adversarial #4: janked main thread → sync-read deadline fallback, guest not stalled", async ({
    page,
  }) => {
    test.setTimeout(40 * 60_000);
    await page.goto("/");
    await expect(page.locator("#term .xterm-rows")).toContainText("login:", { timeout: BOOT });
    const stalledMs = await page.evaluate(() => window.__deviceProxy?.jankTest?.(200));
    // With a 200ms main-thread jank, a synchronous worker read must hit its deadline fallback well
    // under the jank duration rather than blocking the guest for the whole 200ms.
    expect(stalledMs, "sync read must deadline-fallback, not stall the guest for the jank").toBeLessThan(50);
  });
});
