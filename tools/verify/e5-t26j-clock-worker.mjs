#!/usr/bin/env node
// Actual busy guest rdtime through the built direct/worker loaders. No desktop timing claim.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "../../web/node_modules/playwright/index.mjs";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const root = path.join(repo, "web/dist");
const out = path.resolve(process.env.E5_T26J_WORKER_OUT || path.join(repo, "evidence/e5-t26j/worker"));
await mkdir(path.dirname(out), { recursive: true });
await mkdir(out); // Every invocation must preserve prior evidence.
const server = createServer(async (request, response) => {
  try {
    const file = path.resolve(root, `.${decodeURIComponent(new URL(request.url, "http://localhost").pathname)}`);
    if (!file.startsWith(`${root}/`)) { response.writeHead(404).end(); return; }
    const data = await readFile(file);
    response.writeHead(200, {
      "Content-Type": ({ ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript",
        ".wasm": "application/wasm", ".json": "application/json", ".css": "text/css" })[path.extname(file)] || "application/octet-stream",
      "Cross-Origin-Opener-Policy": "same-origin", "Cross-Origin-Embedder-Policy": "require-corp",
    }).end(data);
  } catch { response.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
let browser;
const errors = [];
try {
  browser = await chromium.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true });
  const page = await browser.newPage({ serviceWorkers: "block" });
  page.on("pageerror", error => errors.push(String(error)));
  page.on("console", message => {
    if (message.type() === "error" && !message.location().url.endsWith("/favicon.ico")) errors.push(message.text());
  });
  page.on("response", response => {
    if (response.status() >= 400 && !new URL(response.url()).pathname.endsWith("/favicon.ico")) errors.push(`${response.status()} ${response.url()}`);
  });
  await page.goto(`http://127.0.0.1:${server.address().port}/display-hotplug.html`);
  const results = await page.evaluate(async () => {
    const { startLinuxBoot } = await import("./loader.js");
    const { startLinuxBootWorker, stopLinuxController } = await import("./linux-worker-host.js");
    const ensure = (ok, message) => { if (!ok) throw new Error(message); };
    const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
    const hash = async bytes => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
      byte => byte.toString(16).padStart(2, "0")).join("");
    // Busy UART poll, read trigger, rdtime, emit eight LE bytes, repeat. No WFI/host-derived time.
    const words = [0x10000337, 0x00534383, 0x0013f393, 0xfe038ce3, 0x00034383, 0xc01022f3,
      0x00800e13, 0x00530023, 0x0082d293, 0xfffe0e13, 0xfe0e1ae3, 0xfd9ff06f];
    const kernel = new Uint8Array(words.length * 4);
    words.forEach((word, index) => new DataView(kernel.buffer).setUint32(index * 4, word, true));
    const manifest = { artifacts: {
      kernel: { url: "data:application/octet-stream;base64," + btoa(String.fromCharCode(...kernel)), sha256: await hash(kernel) },
      initramfs: { url: "data:application/octet-stream;base64,", sha256: await hash(new Uint8Array()) },
    } };
    const results = [];
    for (const backend of ["direct", "worker"]) for (const divider of [null, 10, 1]) {
      let bytes = [];
      const controller = await (backend === "worker" ? startLinuxBootWorker : startLinuxBoot)({
        manifestUrl: "data:application/json," + encodeURIComponent(JSON.stringify(manifest)),
        ramMib: 16, jit: true, slirpNet: false, startPaused: true, guestClock: "icount",
        ...(divider === null ? {} : { icountDivider: divider }), onOutput: chunk => bytes.push(...chunk),
      });
      try {
        const expected = divider ?? 10;
        const initial = await controller.guestClockState();
        const selection = await controller.icountDividerSelection();
        ensure(initial.mode === "icount" && initial.mtime === "0" && initial.clockDiv === expected &&
          initial.timebaseHz === 10_000_000, "actual initial divider/time");
        if (divider === null) ensure(selection === null, "omission manufactured a divider override");
        else ensure(selection.requested === divider && selection.before.clockDiv === 10 && selection.after.clockDiv === divider &&
          selection.before.mtime === "0" && selection.after.mtime === "0", "actual selection receipt");
        const sample = async () => {
          ensure(bytes.length === 0, "unexpected UART bytes before trigger");
          const requestedAt = performance.now();
          await controller.sendInput(new Uint8Array([1]));
          const deadline = requestedAt + 10_000;
          while (bytes.length < 8 && performance.now() < deadline) await delay(5);
          ensure(bytes.length === 8, "busy guest did not emit exactly one rdtime value");
          const raw = bytes;
          bytes = [];
          let ticks = 0n;
          for (let i = 7; i >= 0; i--) ticks = (ticks << 8n) | BigInt(raw[i]);
          return { raw, ticks: ticks.toString(), requestedAt, receivedAt: performance.now() };
        };
        await controller.resume();
        const before = await sample();
        await delay(250);
        const after = await sample();
        await controller.pause();
        const pausedBefore = await controller.guestClockState();
        await delay(100);
        const final = await controller.guestClockState();
        const scheduler = await controller.schedulerStats();
        const jit = await controller.jitStats();
        ensure(JSON.stringify(final) === JSON.stringify(pausedBefore), "paused ICount state changed");
        ensure(BigInt(after.ticks) > BigInt(before.ticks), "actual rdtime failed to advance");
        ensure(BigInt(final.mtime) === BigInt(Math.floor(scheduler.retiredInstructions / expected)), "mtime differs from exact retirements/divider");
        ensure(jit.hasExecutor === true && jit.retiredViaJit > 0 && jit.jitRegionChaining && jit.jitDynamicChaining,
          "divider selection lost real JIT/chaining execution");
        results.push({ backend, divider, words, initial, selection, before, after, pausedBefore, final, scheduler, jit });
      } finally { await stopLinuxController(controller); }
    }
    return results;
  });
  assert.deepEqual(errors, []);
  const digests = {};
  for (const file of ["web/dist/loader.js", "web/dist/guest-clock.js", "web/dist/linux-worker-protocol.js",
    "web/dist/pkg/wasm_vm_wasm_bg.wasm", "tools/verify/e5-t26j-clock-worker.mjs"]) {
    digests[file] = createHash("sha256").update(await readFile(path.join(repo, file))).digest("hex");
  }
  const report = { head: execFileSync("git", ["rev-parse", "HEAD"], { cwd: repo, encoding: "utf8" }).trim(),
    browser: browser.version(), claim: "deterministic divider plumbing and real guest rdtime, not F timing", results, digests, errors };
  await writeFile(path.join(out, "guest-rdtime.json"), JSON.stringify(report, null, 2) + "\n", { flag: "wx" });
  console.log(JSON.stringify(results.map(({ backend, divider, final, jit }) => ({ backend, divider, final, retiredViaJit: jit.retiredViaJit }))));
} catch (error) {
  await writeFile(path.join(out, "failure.json"), JSON.stringify({ error: String(error), stack: error.stack, errors }, null, 2) + "\n", { flag: "wx" });
  throw error;
} finally {
  if (browser) await browser.close();
  await new Promise(resolve => server.close(resolve));
}
