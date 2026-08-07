// E4-T01 / E4-T02 browser-evidence driver (reaping-deferred to dev — the Alpine wasm boot
// OS-reaps on the dev mac, see the E3 memory note; dev/Linux sustains the ~35 min boot).
//
// Boots the SAME chunked Alpine rootfs in a real headless Chromium with the sampled hot-PC +
// subsystem-time profiler ARMED from the first instruction (`?profile=1`, wired in web/loader.js),
// waits for the getty `login:` marker, then pulls `window.__machine.getProfile()` and writes the
// wasm-engine profile JSON — the direct counterpart to the native `--profile` report so the two can
// be diffed (E4-T01 AC4) and the top-5 Alpine hot regions symbolized against the kernel System.map
// (E4-T01 AC1 Alpine-symbol leg).
//
//   node tools/e4-browser-profile.mjs <baseURL> <out.json> [--optional-chrome-trace <trace.json>]
//
// Requires: a running dev server (tools/serve-dev.sh) at <baseURL>, releases/chunked-alpine +
// web/artifacts-alpine.json present, and @playwright/test's Chromium installed.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
// Playwright is installed under web/node_modules (the repo's browser-test workspace), so resolve it
// from there regardless of this script's location under tools/.
const webDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../web");
const require = createRequire(path.join(webDir, "package.json"));
const { chromium } = require("@playwright/test");

const baseURL = process.argv[2] || "http://localhost:8123";
const outPath = process.argv[3] || "evidence/e4-t01/browser-alpine-profile.json";
// Optional E4-T02 leg: capture a bounded (~60 s) V8 CPU profile during boot via the CDP
// Profiler domain → a .cpuprofile loadable in the Chrome DevTools Performance panel, whose
// callFrames carry the demangled Rust wasm frame names (the shipped wasm keeps its `-g` name
// section). A whole ~35-min boot profile would be unwieldy, so we sample a representative window.
const cpuIdx = process.argv.indexOf("--cpuprofile");
const cpuPath = cpuIdx > 0 ? process.argv[cpuIdx + 1] : null;
const cpuWindowMs = 60_000;

const rows = "#term .xterm-rows";
const BOOT_TIMEOUT_MS = 2_700_000; // 45 min — a full Alpine boot in the wasm interpreter on dev

function log(...a) { console.log(`[e4-browser-profile ${new Date().toISOString()}]`, ...a); }

const browser = await chromium.launch({
  headless: true,
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});
const context = await browser.newContext();
const page = await context.newPage();
page.setDefaultTimeout(BOOT_TIMEOUT_MS);

const consoleErrors = [];
page.on("console", (m) => {
  const t = m.text();
  if (m.type() === "error" && !t.includes("favicon.ico")) consoleErrors.push(t);
});
page.on("pageerror", (e) => consoleErrors.push(`pageerror: ${e.message}`));

try {
  const url = `${baseURL}/?assetBase=/releases&profile=1`;
  log("navigating", url);
  await page.goto(url);
  // Wait until the wasm module is instantiated (readiness getter added in web/main.js).
  await page.waitForFunction(() => typeof window.__wasmReady === "function" && window.__wasmReady(),
    { timeout: 180_000 });
  log("wasm ready");

  log("starting chunked Alpine boot (window.__bootAlpineChunked)");
  await page.evaluate(() => { window.__bootAlpineChunked(); });

  // E4-T02: bounded V8 CPU profile capture once boot is underway (interpreter dispatch is hot).
  if (cpuPath) {
    const cdp = await context.newCDPSession(page);
    await cdp.send("Profiler.enable");
    await cdp.send("Profiler.setSamplingInterval", { interval: 100 }); // 100 µs
    await cdp.send("Profiler.start");
    log(`CPU profiling for ${cpuWindowMs / 1000}s (CDP Profiler)…`);
    await page.waitForTimeout(cpuWindowMs);
    const { profile } = await cdp.send("Profiler.stop");
    fs.mkdirSync(cpuPath.replace(/\/[^/]*$/, ""), { recursive: true });
    fs.writeFileSync(cpuPath, JSON.stringify(profile));
    const named = new Set((profile.nodes || [])
      .map((n) => n.callFrame && n.callFrame.functionName)
      .filter((n) => n && /wasm_vm|core::|riscv|Machine|dispatch|run_/i.test(n)));
    log(`wrote ${cpuPath} — ${profile.nodes?.length ?? 0} nodes; sample of named wasm frames:`,
      [...named].slice(0, 12));
  }

  // Confirm profiling armed from the first instruction.
  await page.waitForFunction(() => window.__profilingArmed === true, { timeout: 60_000 })
    .then(() => log("profiler armed (?profile=1)"))
    .catch(() => log("WARNING: __profilingArmed not observed — profile may be empty"));

  // Progress breadcrumbs so a long boot is visibly alive. Read the FULL console byte log
  // (window.__consoleBytes in web/main.js records every byte delivered to the terminal) rather than
  // the xterm .xterm-rows viewport — early boot lines scroll out of the viewport and would be missed.
  const consoleText = async () => page.evaluate(() =>
    new TextDecoder().decode(Uint8Array.from(window.__consoleBytes || [])));
  const waitForMark = async (mark) => {
    const deadline = Date.now() + BOOT_TIMEOUT_MS;
    while (Date.now() < deadline) {
      const txt = await consoleText();
      if (/Kernel panic|Unable to mount root/.test(txt)) throw new Error("kernel panic during boot");
      if (txt.includes(mark)) { log("saw", JSON.stringify(mark)); return; }
      await page.waitForTimeout(5000);
    }
    throw new Error(`timed out waiting for console marker ${JSON.stringify(mark)}`);
  };
  for (const mark of ["Linux version", "OpenRC", "login:"]) await waitForMark(mark);

  // Pull the wasm-engine profile (same schema as the native --profile report).
  const profile = await page.evaluate(() => {
    if (!window.__machine || typeof window.__machine.getProfile !== "function") return null;
    return window.__machine.getProfile();
  });
  if (!profile) throw new Error("window.__machine.getProfile() unavailable");

  const out = {
    engine: "browser",
    source: "web/loader.js ?profile=1 → WasmLinux.getProfile()",
    captured_at: new Date().toISOString(),
    boot_reached: "login:",
    console_errors: consoleErrors,
    profile,
  };
  fs.mkdirSync(outPath.replace(/\/[^/]*$/, ""), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2) + "\n");
  log("wrote", outPath, `— ${profile.regions?.length ?? 0} hot regions, ${profile.sampleCount ?? profile.sample_count ?? "?"} samples`);
} catch (e) {
  log("FAILED:", e.message);
  process.exitCode = 1;
} finally {
  await browser.close();
}
