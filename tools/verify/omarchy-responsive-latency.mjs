#!/usr/bin/env node
// Keypress-to-visible-response latency of the real Omarchy browser desktop.
//
// Serves the built page (web/dist, with this checkout's top-level web/*.js on top so unbuilt source
// changes are exercised) plus a local Omarchy RAM/disk pair, drives system Chrome headless with
// Playwright, types a command with trusted DOM key events on the display canvas, and measures from
// the first keydown / the Enter keydown to the first *received guest frame* that shows:
//   * firstEchoMs     the first typed character echoed on the prompt row;
//   * fullEchoMs      the whole typed command echoed on the prompt row;
//   * outputMs        (from Enter) the command's output line on the next row;
// and then reads the command's side-effect file once over the serial console (nonce check), so
// the pixels are tied to the typed command having actually run.
//
// Measurement rules (both learned the hard way, see evidence/omarchy-responsive/README.md):
//   * Pixels come from the frames the guest hands the presentation controller (a hook on
//     PresentationController.present over the full-resource words), never from WebGL readPixels,
//     which without preserveDrawingBuffer returns whichever swap buffer is current.
//   * Nothing talks to the guest serial console between the first keystroke and the last
//     milestone: every serial RPC is typed into a readline shell over the emulated UART and costs
//     the single guest hart tens of millions of instructions, which would be billed to the desktop.
// Guest MIPS (retired instructions per host second, read from the worker, not the guest) is
// sampled throughout so emulator speed can be attributed separately from guest-side work.
//
//   node tools/verify/omarchy-responsive-latency.mjs OUT_DIR --pair DIR --kernel FILE --chunks DIR
//        [--label NAME] [--deadline-s 600] [--idle-s 20] [--query 'k=v&k2=v2']
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { crc32, deflateSync } from "node:zlib";
import { physicalStroke } from "./omarchy-browser-session.mjs";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
export const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

// Foot's window sits at (12,38) with 14 px padding; JetBrains Mono rows are 17 px tall and cells
// 7 px wide at the demo's 1280x800 output. Row 0 holds the prompt, row 1 the command's output.
export const GEOMETRY = Object.freeze({ x0: 20, x1: 1260, rowTop: 52, rowHeight: 17, cell: 7, bgX: 640, bgY: 500 });

export function parseArgs(argv) {
  const [out, ...rest] = argv;
  assert.ok(out && !out.startsWith("--"), "usage: omarchy-responsive-latency.mjs OUT_DIR --pair DIR --kernel FILE --chunks DIR");
  const opts = { out: path.resolve(out), label: "run", "deadline-s": "600", "idle-s": "20", query: "" };
  for (let i = 0; i < rest.length; i += 2) {
    assert.match(rest[i], /^--(pair|kernel|chunks|label|deadline-s|idle-s|query)$/u, `unknown argument ${rest[i]}`);
    assert.ok(rest[i + 1] !== undefined, `${rest[i]} needs a value`);
    opts[rest[i].slice(2)] = rest[i + 1];
  }
  for (const key of ["pair", "kernel", "chunks"]) assert.ok(opts[key], `--${key} is required`);
  return opts;
}

async function hashFile(file) {
  const hash = createHash("sha256");
  for await (const bytes of createReadStream(file)) hash.update(bytes);
  return hash.digest("hex");
}
const artifact = async (file, url) => ({ url, size: (await fs.stat(file)).size, sha256: await hashFile(file) });

const TYPES = { ".js": "text/javascript", ".mjs": "text/javascript", ".html": "text/html", ".json": "application/json",
  ".wasm": "application/wasm", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".gz": "application/gzip" };

export async function startServer(opts) {
  const dist = path.join(repo, "web/dist");
  const kernel = path.resolve(opts.kernel), pair = path.resolve(opts.pair), chunks = path.resolve(opts.chunks);
  const manifestPath = path.join(chunks, "manifest.json");
  const manifestSha = await hashFile(manifestPath);
  const routes = new Map([
    ["/pair/kernel", kernel],
    ["/pair/omarchy-ready.snap.gz", path.join(pair, "omarchy-ready.snap.gz")],
    ["/pair/omarchy-overlay-delta.bin.gz", path.join(pair, "omarchy-overlay-delta.bin.gz")],
    [`/chunked-omarchy/manifest-${manifestSha}.json`, manifestPath],
  ]);
  const manifest = {
    generated: "local responsive-latency harness",
    artifacts: {
      kernel: await artifact(kernel, "pair/kernel"),
      bootSnapshot: await artifact(routes.get("/pair/omarchy-ready.snap.gz"), "pair/omarchy-ready.snap.gz"),
      overlayDelta: await artifact(routes.get("/pair/omarchy-overlay-delta.bin.gz"), "pair/omarchy-overlay-delta.bin.gz"),
    },
    chunkedImage: { key: `chunked-omarchy/manifest-${manifestSha}.json`, sha256: manifestSha, size: (await fs.stat(manifestPath)).size },
  };
  const served = [];
  const server = createServer(async (request, response) => {
    try {
      const pathname = decodeURIComponent(new URL(request.url, "http://x").pathname);
      assert.ok(!pathname.includes(".."), "traversal");
      let body = null, file = null;
      if (pathname === "/artifacts-omarchy.json") body = Buffer.from(JSON.stringify(manifest));
      else if (routes.has(pathname)) file = routes.get(pathname);
      else if (/^\/chunked-omarchy\/chunks\/[0-9a-f]{64}\.bin$/u.test(pathname)) file = path.join(chunks, "chunks", path.basename(pathname));
      else if (/^\/[^/]+\.(js|mjs)$/u.test(pathname) && await fs.stat(path.join(repo, "web", pathname)).then(() => true, () => false)) {
        file = path.join(repo, "web", pathname); // unbuilt top-level source wins over its dist copy
      } else file = path.join(dist, pathname === "/" ? "index.html" : pathname);
      if (file) body = await fs.readFile(file);
      if (!pathname.startsWith("/chunked-omarchy/chunks/")) served.push({ pathname, bytes: body.length });
      response.writeHead(200, { "Content-Type": TYPES[path.extname(pathname)] || "application/octet-stream",
        "Cross-Origin-Embedder-Policy": "require-corp", "Cross-Origin-Opener-Policy": "same-origin",
        "Cross-Origin-Resource-Policy": "same-origin", "Cache-Control": "no-store" });
      response.end(request.method === "HEAD" ? undefined : body);
    } catch {
      response.writeHead(404); response.end();
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  return { server, origin, manifest, served,
    url: `${origin}/app.html?guest=omarchy&desktop=1&testHooks&perfHooks&omarchyAssetBase=${encodeURIComponent(origin)}${opts.query ? `&${opts.query}` : ""}#ide` };
}

// ---- guest frame capture ------------------------------------------------------------------------

export function wordsToRgb(words, width, height) {
  const out = Buffer.alloc(width * height * 3);
  for (let i = 0; i < width * height; i++) {
    const v = words[i]; // little-endian B8G8R8A8 words, as the core FrameSink hands them out
    out[i * 3] = (v >>> 16) & 255; out[i * 3 + 1] = (v >>> 8) & 255; out[i * 3 + 2] = v & 255;
  }
  return out;
}

export function encodePng(width, height, rgb) {
  assert.equal(rgb.length, width * height * 3);
  const stride = width * 3, raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) rgb.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  const chunk = (type, data) => {
    const body = Buffer.concat([Buffer.from(type, "latin1"), data]);
    const head = Buffer.alloc(4); head.writeUInt32BE(data.length);
    const tail = Buffer.alloc(4); tail.writeUInt32BE(crc32(body) >>> 0);
    return Buffer.concat([head, body, tail]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

// Runs in the page. Wraps PresentationController.present so every received guest frame is scored
// over the full-resource words, and the first frame meeting each milestone is copied aside.
export function installFrameHook(g) {
  const controller = window.__presentation?.controller?.();
  if (!controller || typeof controller.present !== "function") return false;
  const st = (window.__wv ??= { frames: [], shots: {}, cfg: null, hooks: 0, errors: [] });
  const band = (px, w, n) => {
    const bg = px[g.bgY * w + g.bgX];
    let count = 0, right = -1, hash = 2166136261;
    for (let y = g.rowTop + g.rowHeight * n; y < g.rowTop + g.rowHeight * (n + 1); y++) {
      for (let x = g.x0; x < g.x1; x++) {
        const v = px[y * w + x];
        if (v === bg) continue;
        count++; if (x > right) right = x;
        hash = Math.imul(hash ^ (y * 4096 + x), 16777619) >>> 0;
        hash = Math.imul(hash ^ (v & 0xffffff), 16777619) >>> 0;
      }
    }
    return { count, right, hash };
  };
  st.score = (px, w) => [band(px, w, 0), band(px, w, 1)];
  if (controller.__wvHooked) return true;
  const original = controller.present.bind(controller);
  controller.present = (frame) => {
    try {
      if (frame && frame.type !== "clear" && frame.pixels && frame.resourceWidth >= g.x1 && frame.resourceHeight > g.bgY) {
        const w = frame.resourceWidth, h = frame.resourceHeight, px = frame.pixels;
        const rec = { t: performance.now(), rect: { ...frame.rect }, rows: st.score(px, w) };
        st.frames.push(rec);
        if (st.frames.length > 20000) st.frames.splice(0, 10000);
        const cfg = st.cfg;
        if (cfg && rec.t >= cfg.armedAt) {
          const [r0, r1] = rec.rows;
          const hits = {
            firstEcho: r0.right >= cfg.base0Right + g.cell,
            // The cursor cell leaves the prompt row once Enter is processed, so the complete
            // command is visible when the text alone reaches the last typed cell.
            fullEcho: r0.right >= cfg.base0Right + g.cell * (cfg.cells - 1) - 1,
            output: r1.count >= cfg.base1Count + 30,
          };
          for (const [name, ok] of Object.entries(hits)) {
            if (ok && !st.shots[name]) st.shots[name] = { t: rec.t, rect: rec.rect, rows: rec.rows, w, h, px: px.slice(0, w * h) };
          }
        }
      }
    } catch (error) { st.errors.push(String(error)); }
    return original(frame);
  };
  controller.__wvHooked = true;
  st.hooks += 1;
  return true;
}

// Runs in the page: the most recently received full-resource frame (base64 words) plus its score.
function latestFrame() {
  const latest = window.__presentation?.controller?.()?._latest;
  if (!latest?.pixels) return null;
  const w = latest.resourceWidth, h = latest.resourceHeight, px = latest.pixels.slice(0, w * h);
  return { w, h, rows: window.__wv?.score?.(px, w) ?? null };
}

function frameBase64(which) {
  const source = which === "latest" ? window.__presentation?.controller?.()?._latest : window.__wv?.shots?.[which];
  if (!source) return null;
  const w = source.resourceWidth ?? source.w, h = source.resourceHeight ?? source.h;
  const words = (source.pixels ?? source.px).slice(0, w * h);
  const bytes = new Uint8Array(words.buffer, words.byteOffset, words.byteLength);
  let text = "";
  for (let i = 0; i < bytes.length; i += 0x8000) text += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return { w, h, b64: btoa(text) };
}

async function dumpFrame(page, which, file, visibleHeight = 800) {
  const frame = await page.evaluate(frameBase64, which);
  if (!frame) return null;
  const bytes = Buffer.from(frame.b64, "base64");
  const words = new Uint32Array(bytes.buffer, bytes.byteOffset, bytes.length / 4);
  const height = Math.min(frame.h, visibleHeight);
  const png = encodePng(frame.w, height, wordsToRgb(words, frame.w, height));
  await fs.writeFile(file, png);
  return { file: path.basename(file), width: frame.w, height, sha256: createHash("sha256").update(png).digest("hex") };
}

export function summarize(values) {
  const v = values.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  return v.length ? { median: v[Math.floor(v.length / 2)], min: v[0], max: v.at(-1), samples: v.length } : null;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  await fs.mkdir(opts.out, { recursive: false });
  const report = { kind: "omarchy-responsive-latency", version: 2, label: opts.label, startedAt: new Date().toISOString(),
    inputs: { pair: path.resolve(opts.pair), kernel: path.resolve(opts.kernel), chunks: path.resolve(opts.chunks), query: opts.query },
    host: { loadavg: (await import("node:os")).loadavg() }, errors: [], mipsSamples: [], timeline: [], images: {} };
  const save = () => fs.writeFile(path.join(opts.out, "report.json"), JSON.stringify(report, null, 2) + "\n");
  const wasm = path.join(repo, "web/dist/pkg/wasm_vm_wasm_bg.wasm");
  report.wasm = { size: (await fs.stat(wasm)).size, sha256: await hashFile(wasm) };
  report.head = (await import("node:child_process")).execFileSync("git", ["rev-parse", "HEAD"], { cwd: repo, encoding: "utf8" }).trim();
  const { server, manifest, url, served } = await startServer(opts);
  report.manifest = manifest; report.url = url;
  const t0 = Date.now();
  const mark = (event, extra = {}) => { const entry = { event, ms: Date.now() - t0, ...extra }; report.timeline.push(entry); console.log(JSON.stringify(entry)); };
  const { chromium } = await import(path.join(repo, "web/node_modules/playwright/index.mjs"));
  const browser = await chromium.launch({ headless: true, executablePath: CHROME,
    args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
  let sampler = null;
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1, serviceWorkers: "block" });
    await context.addInitScript(() => {
      window.__resp = { events: [], keys: [] };
      for (const type of ["wvm:guest-booting", "wvm:guest-ready", "wvm:desktop-ready", "wvm:guest-error", "wvm:guest-halted"]) {
        window.addEventListener(type, () => window.__resp.events.push({ type, t: performance.now() }));
      }
      window.addEventListener("keydown", (e) => window.__resp.keys.push({ code: e.code, t: e.timeStamp, trusted: e.isTrusted }), true);
    });
    const page = await context.newPage();
    page.on("pageerror", (error) => report.errors.push(String(error)));
    page.on("console", (message) => {
      if (message.type() === "error" && !/favicon/u.test(message.location().url || "")) report.errors.push(message.text());
    });
    const shot = async (name) => {
      try { await page.screenshot({ path: path.join(opts.out, name), timeout: 60000 }); mark("screenshot", { name }); }
      catch (error) { report.errors.push(`screenshot ${name}: ${error}`); }
    };
    const exec = (command, timeoutMs) => page.evaluate(({ command, timeoutMs }) =>
      window.wvmDemo.exec(command, timeoutMs, { quiet: true }), { command, timeoutMs });
    let lastSample = null;
    const sampleMips = async () => {
      const retired = await page.evaluate(() => window.__schedulerStats?.()).then((s) => s?.retiredInstructions ?? null, () => null);
      const now = Date.now();
      if (retired != null && lastSample && now > lastSample.now) {
        report.mipsSamples.push({ phase: report.phase, ms: now - t0, mips: (retired - lastSample.retired) / (now - lastSample.now) / 1000, retired });
      }
      if (retired != null) lastSample = { retired, now };
    };
    report.phase = "startup";
    sampler = setInterval(() => void sampleMips(), 1000);

    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
    mark("navigated");
    const deadline = Date.now() + Number(opts["deadline-s"]) * 1000;
    const waitEvent = async (type) => {
      while (Date.now() < deadline) {
        const events = await page.evaluate(() => window.__resp.events);
        const hit = events.find((e) => e.type === type);
        if (hit) return hit;
        if (events.some((e) => e.type === "wvm:guest-error" || e.type === "wvm:guest-halted")) throw new Error(`guest failed: ${JSON.stringify(events)}`);
        await new Promise((r) => setTimeout(r, 500));
      }
      throw new Error(`timed out waiting for ${type}`);
    };
    await waitEvent("wvm:guest-ready"); mark("guest-ready");
    await shot("01-guest-ready.png");
    try { await waitEvent("wvm:desktop-ready"); mark("desktop-ready"); } catch (error) { mark("desktop-ready-timeout", { error: String(error) }); }
    await shot("02-desktop.png");
    while (!(await page.evaluate(installFrameHook, GEOMETRY))) await new Promise((r) => setTimeout(r, 250));

    // Idle window: received frames and guest instructions while nothing is typed.
    report.phase = "idle";
    const framesBefore = await page.evaluate(() => window.__wv.frames.length);
    const idleStart = Date.now(), idleRetired0 = lastSample?.retired;
    await new Promise((r) => setTimeout(r, Number(opts["idle-s"]) * 1000));
    const idleFrames = await page.evaluate((n) => window.__wv.frames.slice(n), framesBefore);
    report.idle = { seconds: (Date.now() - idleStart) / 1000, frames: idleFrames.length,
      framePixels: idleFrames.reduce((n, f) => n + f.rect.width * f.rect.height, 0),
      guestMips: lastSample && idleRetired0 != null ? (lastSample.retired - idleRetired0) / (lastSample.now - idleStart) / 1000 : null };
    mark("idle-measured", report.idle);

    // Focus the terminal on the real canvas, let the pointer frame settle, then score the prompt.
    report.phase = "focus";
    await page.locator("#ide-display-canvas").click({ position: { x: 640, y: 420 } });
    await new Promise((r) => setTimeout(r, 3000));
    const before = await page.evaluate(latestFrame);
    assert.ok(before?.rows, "no received guest frame to score");
    report.before = before.rows;
    report.images.beforeTyping = await dumpFrame(page, "latest", path.join(opts.out, "03-before-typing.png"));
    const nonce = randomBytes(6).toString("hex");
    const guestFile = `/tmp/wvm-resp-${randomBytes(6).toString("hex")}`;
    const command = `echo ${nonce} | tee ${guestFile}`;
    report.command = command;
    await page.evaluate(({ base0Right, base1Count, cells }) => {
      window.__resp.keys.length = 0;
      window.__wv.cfg = { base0Right, base1Count, cells, armedAt: performance.now() };
    }, { base0Right: before.rows[0].right, base1Count: before.rows[1].count, cells: command.length });

    // Type at a steady human-like pace with trusted key events; Enter last.
    report.phase = "response";
    const typedAt = Date.now();
    for (const character of command) {
      const { code, shift } = physicalStroke(character);
      if (shift) await page.keyboard.down("ShiftLeft");
      await page.keyboard.press(code, { delay: 40 });
      if (shift) await page.keyboard.up("ShiftLeft");
      await new Promise((r) => setTimeout(r, 60));
    }
    await page.keyboard.press("Enter", { delay: 40 });
    mark("typed", { chars: command.length, typingMs: Date.now() - typedAt });
    const keys = await page.evaluate(() => window.__resp.keys);
    const firstKey = keys.find((k) => k.code !== "ShiftLeft");
    const enterKey = keys.filter((k) => k.code === "Enter").at(-1);
    assert.ok(firstKey && enterKey && keys.every((k) => k.trusted), "trusted key events were not observed");
    report.keys = { count: keys.length, firstKey, enterKey, lastTyped: keys.filter((k) => k.code !== "Enter").at(-1) };

    // Pixel-only wait: no serial traffic until every milestone is on screen or the deadline passes.
    const milestones = ["firstEcho", "fullEcho", "output"];
    let shots = {};
    while (Date.now() < deadline) {
      shots = await page.evaluate(() => Object.fromEntries(Object.entries(window.__wv.shots).map(([k, v]) => [k, { t: v.t, rect: v.rect, rows: v.rows }])));
      if (milestones.every((m) => shots[m])) break;
      await new Promise((r) => setTimeout(r, 500));
    }
    const result = {
      firstEchoMs: shots.firstEcho ? shots.firstEcho.t - firstKey.t : null,
      fullEchoMs: shots.fullEcho ? shots.fullEcho.t - firstKey.t : null,
      fullEchoAfterLastKeyMs: shots.fullEcho ? shots.fullEcho.t - report.keys.lastTyped.t : null,
      outputMs: shots.output ? shots.output.t - enterKey.t : null,
    };
    report.result = result; report.shots = shots;
    mark("milestones", result);
    for (const [name, file] of [["firstEcho", "04-first-echo.png"], ["fullEcho", "05-full-echo.png"], ["output", "06-output.png"]]) {
      if (shots[name]) report.images[name] = await dumpFrame(page, name, path.join(opts.out, file));
    }
    const responseFrames = await page.evaluate((t) => window.__wv.frames.filter((f) => f.t >= t), firstKey.t);
    report.responseFrames = responseFrames.map((f) => ({ t: Math.round(f.t - firstKey.t), rect: f.rect, row0: f.rows[0], row1: f.rows[1] }));
    report.phase = "readback";
    report.images.final = await dumpFrame(page, "latest", path.join(opts.out, "07-final-frame.png"));
    await save();

    // Tie the pixels to the typed command: one serial readback of its side-effect file.
    const readStart = Date.now();
    try {
      const read = await exec(`cat '${guestFile}'`, 240000);
      report.nonce = { expected: nonce, exit: read?.exit, stdout: read?.stdout?.trim(), ms: Date.now() - readStart,
        ok: read?.exit === 0 && read?.stdout?.trim() === nonce };
    } catch (error) {
      report.nonce = { expected: nonce, ok: false, error: String(error), ms: Date.now() - readStart };
    }
    mark("nonce", report.nonce);
    await shot("08-page.png");
    report.jit = await page.evaluate(() => window.__jitStats?.()).catch(() => null);
    report.hook = await page.evaluate(() => ({ hooks: window.__wv.hooks, errors: window.__wv.errors, frames: window.__wv.frames.length }));
    report.mips = Object.fromEntries(["startup", "idle", "focus", "response", "readback"].map((phase) =>
      [phase, summarize(report.mipsSamples.filter((s) => s.phase === phase).map((s) => s.mips))]));
    report.passed = milestones.every((m) => shots[m]) && report.nonce.ok === true;
  } catch (error) {
    report.error = String(error.stack || error);
    process.exitCode = 1;
  } finally {
    if (sampler) clearInterval(sampler);
    report.finishedAt = new Date().toISOString();
    report.served = served.slice(0, 400);
    await save();
    await browser.close();
    server.close();
  }
  console.log(JSON.stringify({ label: report.label, passed: report.passed, result: report.result, nonce: report.nonce?.ok,
    idle: report.idle, mips: report.mips, errors: report.errors.length }));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
