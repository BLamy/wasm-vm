#!/usr/bin/env node
// Real guest rdtime over UART in the built browser loader/worker; no WFI or fake host clock.
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
const out = path.resolve(process.env.E5_T26I_WORKER_OUT || path.join(repo, "evidence/e5-t26i/worker"));
await mkdir(out, { recursive: true });
const server = createServer(async (request, response) => {
  const pathname = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
  const file = path.resolve(root, `.${pathname}`);
  if (!file.startsWith(`${root}/`)) { response.writeHead(404).end(); return; }
  try {
    const data = await readFile(file);
    response.writeHead(200, {
      "Content-Type": ({ ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript",
        ".wasm": "application/wasm", ".json": "application/json", ".css": "text/css" })[path.extname(file)] || "application/octet-stream",
      "Cross-Origin-Opener-Policy": "same-origin", "Cross-Origin-Embedder-Policy": "require-corp",
    }).end(data);
  } catch { response.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const browser = await chromium.launch({
  executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true,
});
try {
  const page = await browser.newPage({ serviceWorkers: "block" });
  const errors = [];
  page.on("pageerror", error => errors.push(String(error)));
  page.on("console", message => {
    if (message.type() === "error" && !message.location().url.endsWith("/favicon.ico")) errors.push(message.text());
  });
  await page.goto(`http://127.0.0.1:${server.address().port}/display-hotplug.html`);
  const results = await page.evaluate(async () => {
    const { startLinuxBoot } = await import("./loader.js");
    const { startLinuxBootWorker, stopLinuxController } = await import("./linux-worker-host.js");
    const ensure = (ok, message) => { if (!ok) throw Error(message); };
    const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
    const hash = async bytes => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
      byte => byte.toString(16).padStart(2, "0")).join("");
    // Poll UART LSR (busy, not WFI); read one trigger; rdtime t0; emit 8 little-endian bytes.
    // lui t1; lbu t2,5(t1); andi t2,1; beq -8; lbu t2,0(t1); rdtime t0;
    // li t3,8; sb t0,0(t1); srli t0,8; addi t3,-1; bne -12; jal -40.
    const words = [0x10000337, 0x00534383, 0x0013f393, 0xfe038ce3, 0x00034383, 0xc01022f3,
      0x00800e13, 0x00530023, 0x0082d293, 0xfffe0e13, 0xfe0e1ae3, 0xfd9ff06f];
    const kernel = new Uint8Array(words.length * 4);
    words.forEach((word, index) => new DataView(kernel.buffer).setUint32(index * 4, word, true));
    const manifest = { artifacts: {
      kernel: { url: "data:application/octet-stream;base64," + btoa(String.fromCharCode(...kernel)), sha256: await hash(kernel) },
      initramfs: { url: "data:application/octet-stream;base64,", sha256: await hash(new Uint8Array()) },
    } };
    const results = [];
    for (const backend of ["direct", "worker"]) for (const mode of ["icount", "wall"]) {
      let bytes = [];
      const controller = await (backend === "worker" ? startLinuxBootWorker : startLinuxBoot)({
        manifestUrl: "data:application/json," + encodeURIComponent(JSON.stringify(manifest)),
        ramMib: 16, jit: false, slirpNet: false, startPaused: true, guestClock: mode,
        onOutput: chunk => bytes.push(...chunk),
      });
      try {
        const initial = await controller.guestClockState();
        ensure(initial.mode === mode && initial.mtime === "0", "actual initial clock policy/time");
        ensure(initial.timebaseHz === 10_000_000 && initial.clockDiv === 10, "actual timebase/divisor");
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
        await delay(600);
        const after = await sample();
        await controller.pause();
        const pausedBefore = await controller.guestClockState();
        await delay(500);
        const pausedAfter = await controller.guestClockState();
        ensure(JSON.stringify(pausedAfter) === JSON.stringify(pausedBefore), "explicit pause advanced guest clock");
        await controller.resume();
        const resumed = await sample();
        await controller.pause();
        const final = await controller.guestClockState();
        const scheduler = await controller.schedulerStats();
        const guestDeltaMs = Number(BigInt(after.ticks) - BigInt(before.ticks)) / 10_000;
        const hostDeltaMs = after.receivedAt - before.receivedAt;
        ensure(guestDeltaMs > 0 && scheduler.retiredInstructions > 0, "busy guest made no progress");
        if (mode === "wall") {
          ensure(guestDeltaMs / hostDeltaMs > 0.7 && guestDeltaMs / hostDeltaMs < 1.3,
            "real guest rdtime is not tracking monotonic host time");
          ensure(BigInt(resumed.ticks) >= BigInt(pausedBefore.mtime), "resume regressed rdtime");
          ensure(BigInt(resumed.ticks) - BigInt(pausedBefore.mtime) < 2_500_000n,
            "explicit resume included the paused 500ms host interval");
        } else {
          ensure(BigInt(final.mtime) === BigInt(Math.floor(scheduler.retiredInstructions / 10)),
            "ICount no longer matches exact retirements/divisor");
        }
        results.push({ backend, mode, words, initial, before, after, pausedBefore, pausedAfter,
          resumed, final, scheduler, guestDeltaMs, hostDeltaMs });
      } finally { await stopLinuxController(controller); }
    }
    return results;
  });
  assert.deepEqual(errors, []);
  const digests = {};
  for (const file of ["web/dist/loader.js", "web/dist/guest-clock.js", "web/dist/linux-worker-protocol.js",
    "web/dist/pkg/wasm_vm_wasm_bg.wasm", "tools/verify/e5-t26i-clock-worker.mjs"]) {
    digests[file] = createHash("sha256").update(await readFile(path.join(repo, file))).digest("hex");
  }
  const report = { head: execFileSync("git", ["rev-parse", "HEAD"], { cwd: repo, encoding: "utf8" }).trim(),
    browser: browser.version(), results, digests, errors };
  await writeFile(path.join(out, "guest-rdtime.json"), JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify(results.map(({ backend, mode, guestDeltaMs, hostDeltaMs }) => ({ backend, mode, guestDeltaMs, hostDeltaMs }))));
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}
