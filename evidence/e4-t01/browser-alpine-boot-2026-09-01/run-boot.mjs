// E4-T01 phase-6 / reap-hypothesis probe — 2026-09-01, Apple M4 Max (16 cores, 128 GB).
// Proves (or refutes) that a FULL COLD in-browser Alpine boot (?guest=alpine&noSnapshot&persist=0,
// i.e. NO RAM-snapshot restore, NO persistent-overlay fast path) survives to `login:` on this
// machine — the run that was OS-reaped on the old mac (lore: browser-alpine-boot-reaped-on-mac).
// Also pulls the armed profiler's report (?profile=1 → linuxCtl.profileStats(), the worker-mode
// proxy of WasmLinux.getProfile()) at login for the E4-T01 AC1 browser leg, then logs in as root
// and runs a probe command to show the shell is live.
//
// NOTE (run 1 post-mortem, preserved as run1-harness-bug-*): window.__consoleBytes is fed only by
// the riscv-tests ELF runner, NOT the Linux guest console — the guest console reaches the page via
// wvmDemo.onConsole(). Run 1 waited on the wrong tap, saw 0 bytes forever, and the healthy page
// eventually crashed its renderer at t+49.5 min. This version subscribes the real tap.
//
//   node run-boot.mjs <baseURL> <outDir>
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire("/Users/blamy/Documents/Codex/wasm-vm/web/package.json");
const { chromium } = require("@playwright/test");

const baseURL = process.argv[2] || "http://localhost:8123";
const outDir = process.argv[3] || ".";
const BOOT_TIMEOUT_MS = 120 * 60_000; // 2 h ceiling — the old machine died at ~35 min.

const log = (...a) => console.log(`[alpine-cold-boot ${new Date().toISOString()}]`, ...a);
const save = (name, data) => fs.writeFileSync(path.join(outDir, name), data);

const browser = await chromium.launch({ headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await context.newPage();
page.setDefaultTimeout(BOOT_TIMEOUT_MS);

const consoleErrors = [];
page.on("console", (m) => {
  const t = m.text();
  if (m.type() === "error" && !t.includes("favicon.ico")) consoleErrors.push(`[${new Date().toISOString()}] ${t}`);
});
page.on("pageerror", (e) => consoleErrors.push(`[${new Date().toISOString()}] pageerror: ${e.message}`));
page.on("crash", () => consoleErrors.push(`[${new Date().toISOString()}] PAGE CRASHED`));
let chunkFetches = 0;
page.on("response", (r) => { if (r.url().includes("/chunked-alpine/chunks/")) chunkFetches++; });

// Subscribe the REAL guest console stream (wvmDemo.onConsole) as early as possible, before the
// guest=alpine autoboot emits its first byte.
await page.addInitScript(() => {
  window.__evConsoleBytes = [];
  const arm = () => {
    if (window.wvmDemo && typeof window.wvmDemo.onConsole === "function") {
      window.wvmDemo.onConsole((chunk) => { const a = window.__evConsoleBytes; for (let i = 0; i < chunk.length; i++) a.push(chunk[i]); });
      window.__evTapArmed = true;
    } else setTimeout(arm, 5);
  };
  arm();
});

const t0 = Date.now();
try {
  // Full cold boot: noSnapshot kills the RAM-snapshot restore AND the overlay-delta seed;
  // persist=0 forces the non-persistent lazy chunked boot (no restore path at all).
  // `#ide` deep-links the Demo tab (web/tabs.js) so screenshots show the live terminal.
  const url = `${baseURL}/?guest=alpine&noSnapshot&persist=0&profile=1#ide`;
  log("navigating", url);
  await page.goto(url);
  await page.waitForFunction(() => window.__evTapArmed === true, { timeout: 60_000 });
  log("guest-console tap armed; autoboot (guest=alpine) proceeds — cold chunked Alpine boot");

  const consoleText = () => page.evaluate(() => new TextDecoder().decode(Uint8Array.from(window.__evConsoleBytes || [])));

  const markTimes = {};
  let lastLen = -1;
  const deadline = t0 + BOOT_TIMEOUT_MS;
  const waitFor = async (mark, re) => {
    for (;;) {
      if (Date.now() > deadline) throw new Error(`timed out waiting for ${JSON.stringify(mark)}`);
      const txt = await consoleText();
      if (/Kernel panic|Unable to mount root/.test(txt)) { save("console-transcript.txt", txt); throw new Error("kernel panic during boot"); }
      if (re ? re.test(txt) : txt.includes(mark)) {
        markTimes[mark] = +((Date.now() - t0) / 1000).toFixed(1);
        log("saw", JSON.stringify(mark), "at", markTimes[mark] + "s", `(console ${txt.length} bytes)`);
        return;
      }
      if (txt.length !== lastLen) { log(`waiting for ${JSON.stringify(mark)} — console ${txt.length} bytes, t+${((Date.now() - t0) / 60000).toFixed(1)} min`); lastLen = txt.length; }
      await page.waitForTimeout(5_000);
    }
  };
  for (const mark of ["Linux version", "OpenRC", "login:"]) await waitFor(mark);
  const wallMs = Date.now() - t0;
  log(`BOOT REACHED login: in ${(wallMs / 60000).toFixed(2)} min (${wallMs} ms), ${chunkFetches} lazy chunk fetches`);

  // Under Playwright tabs.js reveals ALL panels stacked (e2e-showall), so a viewport screenshot
  // catches the roadmap at the top of the page — screenshot the terminal element itself.
  const shootTerm = async (name) => {
    const term = page.locator("#term");
    try { await term.scrollIntoViewIfNeeded(); await term.screenshot({ path: path.join(outDir, name) }); }
    catch { await page.screenshot({ path: path.join(outDir, name), fullPage: true }); }
  };
  await shootTerm("login-screenshot.png");

  // Prove the shell is live: root login (passwordless) + a computed echo, through the REAL
  // terminal input bridge (the same path keystrokes take).
  const type = (s) => page.evaluate((x) => window.__term.typeBytes(new TextEncoder().encode(x)), s);
  await type("root\r");
  await waitFor("~#", /alpine.*~#|~ #|:~#/);
  await type("echo COLD_BOOT_$((6*7))_OK; uname -a\r");
  await waitFor("COLD_BOOT_42_OK");
  await waitFor("riscv64");
  await shootTerm("shell-screenshot.png");

  // Profiler report (?profile=1): worker mode proxies WasmLinux.getProfile() as
  // linuxCtl.profileStats(); main-thread mode exposes window.__machine.getProfile().
  let profile = null, profileSource = null;
  try {
    const got = await page.evaluate(async () => {
      if (window.__linuxCtl && typeof window.__linuxCtl.profileStats === "function") {
        const p = await window.__linuxCtl.profileStats();
        if (p) return { via: "__linuxCtl.profileStats() (worker-mode proxy of getProfile)", p };
      }
      if (window.__machine && typeof window.__machine.getProfile === "function") {
        return { via: "window.__machine.getProfile()", p: window.__machine.getProfile() };
      }
      return null;
    });
    if (got) { profileSource = got.via; profile = got.p; }
  } catch (e) { log("profile pull failed:", e.message); }
  log(`profile via ${profileSource}: ${profile ? `${profile.sampleCount ?? "?"} samples, ${profile.regions?.length ?? "?"} regions` : "NONE"}`);

  const transcript = await consoleText();
  save("console-transcript.txt", transcript);
  if (profile) save("browser-alpine-profile.json", JSON.stringify(profile, null, 2) + "\n");
  save("result.json", JSON.stringify({
    outcome: "login-reached",
    machine: "Apple M4 Max, 16 cores, 128 GB (2026-09-01)",
    url,
    boot_mode: "full cold chunked Alpine boot — noSnapshot & persist=0 (no snapshot restore); default whole-machine worker + browser JIT",
    started_at: new Date(t0).toISOString(),
    finished_at: new Date().toISOString(),
    wall_ms_to_login: wallMs,
    wall_min_to_login: +(wallMs / 60000).toFixed(2),
    marker_times_s: markTimes,
    lazy_chunk_fetches: chunkFetches,
    console_bytes: transcript.length,
    console_errors: consoleErrors,
    profile_source: profileSource,
    profile_summary: profile ? { totalNs: profile.totalNs, sampleCount: profile.sampleCount, walkCount: profile.walkCount, collisions: profile.collisions, regions: profile.regions?.length, subsystems: profile.subsystems } : null,
  }, null, 2) + "\n");
  log(`console errors: ${consoleErrors.length}`);
  log("DONE — evidence written to", outDir);
} catch (e) {
  log("FAILED:", e.message);
  try { save("console-transcript.txt", await page.evaluate(() => new TextDecoder().decode(Uint8Array.from(window.__evConsoleBytes || []))).catch(() => "")); } catch {}
  save("result.json", JSON.stringify({
    outcome: "failed", error: e.message, elapsed_ms: Date.now() - t0,
    died_at: new Date().toISOString(), console_errors: consoleErrors,
  }, null, 2) + "\n");
  process.exitCode = 1;
} finally {
  await browser.close().catch(() => {});
}
