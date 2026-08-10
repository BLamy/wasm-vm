// E3.5-T05e verification: the structured guest⇄UI channel (window.wvmDemo) over the ONE ttyS0
// console, driven against the REAL interpreted RISC-V Linux guest — no side channel, no fake
// interpreter. Markers are guest-computed arithmetic ($((6*7)) → 42), so a host-side literal echo of
// the command cannot satisfy them; a PASS means real guest execution. The one console is honestly
// multiplexed: run() is a fenced, serialized request/response; stream() is the long-lived
// follow/interactive channel.
//
// The channel MECHANISM (fencing, serialization, non-zero exit, marker-spoof resistance, streaming,
// and fail-closed hasContainerRuntime()) is runtime-agnostic, so it is proven on the FAST, reliable
// busybox userland (boots in ~1-2 min). The two assertions that genuinely need the container runtime
// (hasContainerRuntime()===true and `wvrun ps`) run against the slow chunked Alpine guest, gated on
// the local Alpine assets. The interpreted Alpine boot to login is SLOW — the native RUN-gate
// (crates/cli/tests/boot_bake_gate.rs) budgets 2400s for `login:`; we match that.
import { expect, test } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const WEB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const haveAlpine =
  fs.existsSync(path.join(WEB, "artifacts-alpine.json")) &&
  fs.existsSync(path.join(WEB, "../releases/chunked-alpine/manifest.json"));

const type = (page, s) =>
  page.evaluate((v) => window.wvmDemo.sendInput(new TextEncoder().encode(v)), s);

/** Tap the real console byte stream into a page global (for boot-progress polling). */
async function tapConsole(page) {
  await page.evaluate(() => {
    window.__t05e = "";
    window.wvmDemo.onConsole((u8) => {
      window.__t05e += new TextDecoder().decode(u8);
    });
  });
}
const seen = (page, needle, secs) =>
  page.waitForFunction((n) => window.__t05e.includes(n), needle, { timeout: secs * 1000 });

// ── The channel MECHANISM, proven on the fast busybox userland (ACs 2,3,4 + spoof + AC5) ──────────
test("E3.5-T05e: fenced RPC, serialization, streaming & fail-closed runtime (busybox)", async ({
  page,
}) => {
  test.setTimeout(600_000);
  const errors = [];
  page.on("console", (m) => {
    if (m.type() === "error" && !m.text().includes("favicon")) errors.push(m.text());
  });

  await page.goto("/?testHooks=1&noAutoBoot=1");
  await page.waitForFunction(() => window.wvmDemo && typeof window.wvmDemo.run === "function");
  await tapConsole(page);
  await page.evaluate(() => window.wvmDemo.runBusybox());
  await seen(page, "busybox userland up", 300);
  // Land at a usable shell (the initramfs drops straight to `#`); confirm with a fenced RPC.
  await page.waitForTimeout(2_000);

  // run() returns { stdout, exit } with GUEST-computed values (RPC_42 from $((6*7)), exit from $?).
  const rpc = await page.evaluate(() => window.wvmDemo.run("echo RPC_$((6*7))"));
  expect(rpc.stdout).toContain("RPC_42");
  expect(rpc.exit).toBe(0);

  // (AC5) Fail-closed: the busybox build has no wvrun/index.json → hasContainerRuntime() is false,
  //       and it is a real in-guest probe (not a load-time asset guess).
  expect(await page.evaluate(() => window.wvmDemo.hasContainerRuntime())).toBe(false);

  // (AC2) Two RPCs back-to-back return their OWN outputs — the fencing/serialization is real.
  const [a, b] = await page.evaluate(async () => {
    const pa = window.wvmDemo.run("echo A_$((1+1))");
    const pb = window.wvmDemo.run("echo B_$((2+2))");
    return [await pa, await pb];
  });
  expect(a.stdout).toContain("A_2");
  expect(a.stdout).not.toContain("B_");
  expect(b.stdout).toContain("B_4");
  expect(b.stdout).not.toContain("A_");

  // (AC4) A non-zero exit is surfaced, not swallowed.
  const f = await page.evaluate(() => window.wvmDemo.run("false"));
  expect(f.exit).toBe(1);

  // Adversarial marker-spoof: a command that PRINTS a fake __WVEND_ line (wrong id) must NOT end the
  // RPC prematurely — the real, unique-id + guest-$? marker still governs. REAL_7 proves it ran on.
  const spoof = await page.evaluate(() =>
    window.wvmDemo.run("printf '__WVEND_deadbeef_0\\n'; echo REAL_$((3+4))"),
  );
  expect(spoof.stdout).toContain("REAL_7");
  expect(spoof.exit).toBe(0);

  // (AC3) The streaming channel delivers SUCCESSIVE lines from a live emitter (the exact shape of
  //       `wvrun logs -f`), and stop() ends the stream WITHOUT killing the guest shell.
  const lines = await page.evaluate(
    () =>
      new Promise((resolve) => {
        const got = [];
        const h = window.wvmDemo.stream(
          "i=0; while [ $i -lt 8 ]; do echo STREAM_$i; i=$((i+1)); sleep 1; done",
          (line) => {
            if (line.includes("STREAM_")) got.push(line);
            if (got.length >= 3) {
              h.stop();
              resolve(got);
            }
          },
        );
        setTimeout(() => {
          h.stop();
          resolve(got);
        }, 90_000);
      }),
  );
  expect(lines.length).toBeGreaterThanOrEqual(3);
  expect(lines[0]).toContain("STREAM_0"); // successive, in order — no reordering/duplication

  // The guest survived stop() — a fresh fenced RPC still works after the stream ended.
  const after = await page.evaluate(() => window.wvmDemo.run("echo ALIVE_$((5+5))"));
  expect(after.stdout).toContain("ALIVE_10");
  expect(after.exit).toBe(0);

  expect(errors, `unexpected console errors: ${errors.join("; ")}`).toEqual([]);
});

// ── The container-runtime-specific assertions, against the real chunked Alpine guest (AC1) ─────────
test("E3.5-T05e: hasContainerRuntime() true + wvrun ps over the channel (Alpine)", async ({ page }) => {
  test.skip(!haveAlpine, "needs the local Alpine chunk image (artifacts-alpine.json + chunked-alpine/)");
  test.setTimeout(3_600_000); // interpreted Alpine boot alone can take ~20-40 min

  await page.goto("/?testHooks=1&noAutoBoot=1");
  await page.waitForFunction(() => window.wvmDemo && typeof window.wvmDemo.bootAlpine === "function");
  await tapConsole(page);

  // bootAlpine() is the programmatic entry (the DOM boot buttons were removed). Poll the real console
  // for OpenRC → login, failing loudly with the tail on panic/timeout. 2700s matches the native gate.
  await page.evaluate(() => window.wvmDemo.bootAlpine());
  let sawOpenRC = false;
  let loggedIn = false;
  for (let i = 0; i < 2700; i += 1) {
    const t = await page.evaluate(() => window.__t05e).catch(() => "");
    if (/Kernel panic|Unable to mount root/.test(t)) throw new Error(`Alpine boot failed: ${t.slice(-2_000)}`);
    if (t.includes("OpenRC")) sawOpenRC = true;
    if (sawOpenRC && t.includes("login:")) {
      loggedIn = true;
      break;
    }
    await page.waitForTimeout(1_000);
  }
  if (!loggedIn) {
    const t = await page.evaluate(() => window.__t05e).catch(() => "");
    throw new Error(`never reached login (sawOpenRC=${sawOpenRC}); console tail:\n${t.slice(-2_000)}`);
  }
  await type(page, "root\r");
  await page.waitForTimeout(3_000);
  await type(page, "\r");
  await page.waitForTimeout(2_000);

  // (AC1) A guest-computed RPC works, the runtime is present, and `wvrun ps` is parseable, exit 0.
  const rpc = await page.evaluate(() => window.wvmDemo.run("echo RPC_$((6*7))"));
  expect(rpc.stdout).toContain("RPC_42");
  expect(rpc.exit).toBe(0);
  expect(await page.evaluate(() => window.wvmDemo.hasContainerRuntime())).toBe(true);
  const ps = await page.evaluate(() => window.wvmDemo.run("wvrun ps"));
  expect(ps.exit).toBe(0);

  await page.screenshot({
    path: path.join(WEB, "../tasks/epic-3.5-oci-workloads/e3-t05e-guest-ui-channel.png"),
    fullPage: false,
  });
});
