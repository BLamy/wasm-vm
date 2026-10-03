#!/usr/bin/env node
// Exact fixed-work browser A/B for direct memory-import bindings. No guest-clock timing.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { createServer } from "node:http";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { withinTrialDeadline } from "./omarchy-input-trial.mjs";
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
assert.equal(process.argv.length, 4, "NEW_OUTPUT_DIR PRESERVED_BASELINE_DIR");
const out = path.resolve(process.argv[2]), baseline = path.resolve(process.argv[3]);
await fs.mkdir(out, { recursive: false });
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
const meta = JSON.parse(await fs.readFile(path.join(baseline, "baseline.json"), "utf8"));
assert.equal(sha(execFileSync("git", ["show", `${meta.head}:crates/wasm/src/jit_browser.rs`], { cwd: repo })), meta.jitBrowserSha256);
const roots = { baseline, candidate: path.join(repo, "web") };
const report = { head: execFileSync("git", ["rev-parse", "HEAD"], { cwd: repo, encoding: "utf8" }).trim(), baseline: meta,
  sourceSha256: sha(await fs.readFile(path.join(repo, "crates/wasm/src/jit_browser.rs"))),
  harnessSha256: sha(await fs.readFile(fileURLToPath(import.meta.url))),
  startedAt: new Date().toISOString(), host: { model: os.cpus()[0].model, cpus: os.cpus().length, load: os.loadavg() },
  errors: [], wasm: {}, passed: false };
for (const [arm, root] of Object.entries(roots)) report.wasm[arm] = sha(await fs.readFile(path.join(root, "pkg/wasm_vm_wasm_bg.wasm")));
assert.equal(report.wasm.baseline, meta.wasmSha256);
let server, browser;
try {
  server = createServer(async (req, res) => {
    const url = new URL(req.url, "http://localhost");
    const headers = { "Cross-Origin-Opener-Policy": "same-origin", "Cross-Origin-Embedder-Policy": "require-corp" };
    if (url.pathname === "/") { res.writeHead(200, { ...headers, "Content-Type": "text/html" }).end("<!doctype html><title>JIT memory imports</title>"); return; }
    if (url.pathname === "/favicon.ico") { res.writeHead(204, headers).end(); return; }
    const [, arm, ...parts] = url.pathname.split("/"), root = roots[arm];
    if (!root) { res.writeHead(404).end(); return; }
    const file = path.resolve(root, parts.join("/"));
    if (!file.startsWith(root + path.sep)) { res.writeHead(404).end(); return; }
    try { const bytes = await fs.readFile(file); res.writeHead(200, { ...headers, "Content-Type": file.endsWith(".wasm") ? "application/wasm" : "text/javascript" }).end(bytes); }
    catch { res.writeHead(404).end(); }
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const { chromium } = await import(pathToFileURL(path.join(repo, "web/node_modules/playwright/index.mjs")));
  browser = await chromium.launch({ executablePath: process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true });
  report.browser = browser.version();
  const page = await browser.newPage({ serviceWorkers: "block" });
  page.on("pageerror", e => report.errors.push(String(e)));
  page.on("console", m => { if (m.type() === "error") report.errors.push({ text: m.text(), url: m.location().url }); });
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  report.workloads = await withinTrialDeadline(() => page.evaluate(async () => {
    const bindings = {};
    for (const arm of ["baseline", "candidate"]) { bindings[arm] = await import(`/${arm}/pkg/wasm_vm_wasm.js`); await bindings[arm].default(); }
    const hash = async bytes => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), b => b.toString(16).padStart(2, "0")).join("");
    const jal = off => (((off >>> 20 & 1) << 31) | ((off >>> 1 & 1023) << 21) | ((off >>> 11 & 1) << 20) | ((off >>> 12 & 255) << 12) | 0x6f) >>> 0;
    const addi = (rd, rs, imm) => ((imm & 4095) << 20) | rs << 15 | rd << 7 | 0x13;
    const ld = (rd, rs) => rs << 15 | 3 << 12 | rd << 7 | 3;
    const sd = (val, addr) => val << 20 | addr << 15 | 3 << 12 | 0x23;
    const atomic = (op, rd, rs1, rs2) => op << 27 | rs2 << 20 | rs1 << 15 | 3 << 12 | rd << 7 | 0x2f;
    const specs = [
      { name: "amoadd-d", setup: [0x00001317, addi(7, 0, 1)], loop: [atomic(0, 5, 6, 7), addi(8, 8, 1), jal(-8)], budget: 4_000_000 },
      { name: "lr-sc-d", setup: [0x00001317], loop: [atomic(2, 5, 6, 0), addi(5, 5, 1), atomic(3, 7, 6, 5), addi(8, 8, 1), jal(-16)], budget: 4_000_000 },
      { name: "tlb-collision", setup: [0x00001317, 0x001004b7, 0x006484b3], loop: [ld(5, 6), ld(10, 9), addi(5, 5, 1), sd(5, 6), sd(5, 9), addi(8, 8, 1), jal(-24)], budget: 4_000_000 },
      { name: "tlb-hit-control", setup: [0x00001317, addi(9, 6, 8)], loop: [ld(5, 6), ld(10, 9), addi(5, 5, 1), sd(5, 6), sd(5, 9), addi(8, 8, 1), jal(-24)], budget: 20_000_000 },
      { name: "integer-control", setup: [], loop: [addi(5, 5, 1), addi(6, 6, 2), 0x006283b3, jal(-12)], budget: 80_000_000 },
    ];
    const sections = blob => {
      const view = new DataView(blob.buffer, blob.byteOffset, blob.byteLength), result = {};
      for (let at = 84; at < blob.length;) {
        const tag = view.getUint32(at, true), len = view.getUint32(at + 4, true); at += 8;
        if (at + len > blob.length) throw Error("truncated snapshot section");
        result[tag] = blob.slice(at, at + len); at += len;
      }
      return result;
    };
    const rows = [];
    for (const spec of specs) {
      const words = [...spec.setup, ...spec.loop], kernel = new Uint8Array(words.length * 4), view = new DataView(kernel.buffer);
      words.forEach((word, i) => view.setUint32(i * 4, word >>> 0, true));
      async function run(arm, jit = true, budget = spec.budget) {
        const vm = new bindings[arm].WasmLinux(8, kernel, new Uint8Array(), "", () => {}, false);
        try {
          vm.setICountDivider(64); vm.setFastInterpreter(true); if (jit) vm.enableJit(1);
          const initial = new DataView(sections(vm.saveSnapshot())[1].buffer), pc0 = initial.getBigUint64(0, true);
          const prefix = vm.runChunk(20_000);
          const start = performance.now(), result = vm.runChunk(budget), elapsedMs = performance.now() - start;
          const saved = sections(vm.saveSnapshot()), cpu = new DataView(saved[1].buffer), total = budget + 20_000;
          const cycles = Math.floor((total - spec.setup.length) / spec.loop.length), tail = (total - spec.setup.length) % spec.loop.length;
          const pc = pc0 + BigInt(4 * (spec.setup.length + tail));
          if (cpu.getBigUint64(0, true) !== pc) throw Error(`${spec.name} literal PC`);
          if (cpu.getBigUint64(0x40, true) !== (spec.name === "integer-control" ? initial.getBigUint64(0x40, true) : BigInt(cycles + Number(tail > spec.loop.length - 2)))) throw Error(`${spec.name} literal loop counter`);
          if (spec.name === "lr-sc-d" && cpu.getBigUint64(7 * 8, true) !== 0n) throw Error("SC must succeed");
          const state = { cpu: await hash(saved[1]), clint: await hash(saved[3]), clock: await hash(saved[9]), ram: vm.stateDigest() };
          return { arm, elapsedMs, prefix, result, state, jit: vm.jitStats() };
        } finally { vm.free(); }
      }
      const oracle = [await run("baseline", false, 100_000), await run("baseline", true, 100_000), await run("candidate", true, 100_000)];
      const warmups = [await run("baseline"), await run("candidate")], pairs = [];
      for (let pair = 0; pair < 7; pair++) {
        const order = pair % 2 ? ["candidate", "baseline"] : ["baseline", "candidate"], runs = [];
        for (const arm of order) runs.push(await run(arm));
        pairs.push({ pair, order, runs });
      }
      rows.push({ spec, oracle, warmups, pairs });
    }
    return rows;
  }), Date.now() + 300_000, "direct-memory paired timing");
  const median = xs => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
  for (const row of report.workloads) {
    for (const oracle of row.oracle) assert.deepEqual(oracle.state, row.oracle[0].state, "interpreter and JIT exact state");
    const runs = [...row.warmups, ...row.pairs.flatMap(p => p.runs)];
    for (const run of runs) {
      assert.deepEqual(run.state, runs[0].state);
      assert.deepEqual(run.result, { done: false, state: null, retired: row.spec.budget });
      assert.equal(run.jit.guestRetired, row.spec.budget + 20_000);
      assert.ok(run.jit.retiredViaJit > row.spec.budget * 0.9, "actual compiled execution");
    }
    row.baselineMs = median(row.pairs.map(p => p.runs.find(r => r.arm === "baseline").elapsedMs));
    row.candidateMs = median(row.pairs.map(p => p.runs.find(r => r.arm === "candidate").elapsedMs));
    row.speedup = row.baselineMs / row.candidateMs;
    row.pairedSpeedup = median(row.pairs.map(p => p.runs.find(r => r.arm === "baseline").elapsedMs / p.runs.find(r => r.arm === "candidate").elapsedMs));
    row.baselineMips = row.spec.budget / row.baselineMs / 1000;
    row.candidateMips = row.spec.budget / row.candidateMs / 1000;
  }
  assert.deepEqual(report.errors, []);
  report.passed = true;
  console.log(JSON.stringify(report.workloads.map(({ spec, baselineMips, candidateMips, speedup, pairedSpeedup }) => ({ name: spec.name, baselineMips, candidateMips, speedup, pairedSpeedup })), null, 2));
} finally {
  report.finishedAt = new Date().toISOString(); report.finalLoad = os.loadavg();
  await fs.writeFile(path.join(out, "report.json"), JSON.stringify(report, null, 2) + "\n");
  await browser?.close(); if (server) await new Promise(resolve => server.close(resolve));
}
