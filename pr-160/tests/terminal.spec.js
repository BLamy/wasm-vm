// E2-T22 browser-verification deliverable: xterm.js ↔ 16550 UART wiring. One boot, then three
// checks against a live in-page busybox shell. Input is injected through the real terminal bridge
// (window.__term.typeBytes → the same backpressure queue keystrokes use), and Enter is sent as
// CR (0x0d) — the kernel's icrnl maps it to NL — so command execution proves the CR path works.
import { test, expect } from "@playwright/test";

const rows = "#term .xterm-rows";
const CR = "\r";

/** Inject bytes through the terminal's input bridge exactly as a keystroke/paste would. */
async function type(page, str) {
  await page.evaluate((s) => window.__term.typeBytes(new TextEncoder().encode(s)), str);
}

test("xterm ↔ UART: echo, ^C survival, and byte-exact bulk input", async ({ page }) => {
  test.setTimeout(240_000);
  await page.goto("/");
  await page.click("#boot-linux");

  // Boot to the interactive shell.
  await expect(page.locator(rows)).toContainText("busybox userland up", { timeout: 180_000 });
  await expect(page.locator(rows)).toContainText("~ #");

  // 1) Echo + command execution. Enter is CR; the shell runs `ls` (icrnl mapped CR→NL) and the
  //    typed command echoes back. /proc exists (mounted by init), so `ls /` shows it.
  await type(page, "ls /" + CR);
  await expect(page.locator(rows)).toContainText("proc", { timeout: 15_000 });
  await expect(page.locator(rows)).toContainText("sys");

  // 2) ^C kills a runaway `yes` without killing the shell (cttyhack gave the shell a real ctty,
  //    so SIGINT hits the foreground group, not PID 1). Start yes, let it flood, send ^C (0x03),
  //    then prove the SAME shell is alive by running a uniquely-marked echo.
  await type(page, "yes" + CR);
  await page.waitForTimeout(1500); // let it produce output
  await type(page, "\x03"); // ^C
  await page.waitForTimeout(500);
  await type(page, "echo T22_SHELL_ALIVE_$((6*7))" + CR);
  await expect(page.locator(rows)).toContainText("T22_SHELL_ALIVE_42", { timeout: 15_000 });

  // 3) Byte-exact bulk input (the "paste" path). Send 100 000 bytes as 1000 lines of 99 chars +
  //    CR (each CR→NL, so the file gets 100-byte lines). Canonical tty delivers line-by-line, so
  //    no line hits the 4095-char canonical limit. `wc -c` must report exactly 100000 — any lost
  //    byte refutes the no-drop backpressure claim. Also assert the JS high-water metric engaged.
  const line = "0123456789".repeat(9) + "012345678"; // 99 chars
  const payload = Array.from({ length: 1000 }, () => line).join(CR) + CR; // 1000 lines × 100 bytes
  expect(payload.length).toBe(100_000);

  await type(page, "cat > /tmp/paste" + CR);
  await page.waitForTimeout(300);
  await type(page, payload);
  await type(page, "\x04"); // ^D ends cat

  // The whole payload must be queued at once → high-water reflects it (proves the JS queue ran).
  const hw = await page.evaluate(() => window.__term.highWater());
  expect(hw).toBeGreaterThanOrEqual(100_000);

  await type(page, "wc -c /tmp/paste" + CR);
  await expect(page.locator(rows)).toContainText("100000 /tmp/paste", { timeout: 120_000 });
});

test("real keyboard input reaches the guest without first clicking the terminal", async ({ page }) => {
  test.setTimeout(240_000);
  await page.goto("/");
  await page.click("#boot-linux");
  await expect(page.locator(rows)).toContainText("busybox userland up", { timeout: 180_000 });
  await expect(page.locator(rows)).toContainText("~ #");

  // Deliberately do NOT click the terminal. Boot must have focused it (the "can't type" fix).
  // Use the real keyboard — page.keyboard dispatches to document.activeElement, so this only
  // reaches the guest if the xterm textarea is actually focused. Enter is sent as \r (CR).
  await page.keyboard.type("echo KBD_FOCUS_$((6*7))");
  await page.keyboard.press("Enter");
  await expect(page.locator(rows)).toContainText("KBD_FOCUS_42", { timeout: 15_000 });
});

test("Fit button surfaces a matching stty hint", async ({ page }) => {
  await page.goto("/");
  await page.click("#term-fit");
  const hint = await page.locator("#stty-hint").textContent();
  expect(hint).toMatch(/^stty rows \d+ cols \d+$/);
  // The hint must match the terminal's actual fitted grid.
  const grid = await page.evaluate(() => ({ cols: window.__term.term.cols, rows: window.__term.term.rows }));
  expect(hint).toBe(`stty rows ${grid.rows} cols ${grid.cols}`);
});
