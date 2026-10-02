#!/usr/bin/env node
// Paired host-clock measurements; preserve raw samples and check state outside timing.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { createServer } from "node:http";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
assert.equal(process.argv.length, 4, "NEW_OUTPUT_DIR CLOCK_INVESTIGATION_BASELINE_DIR");
const out = path.resolve(process.argv[2]), baseline = path.resolve(process.argv[3]);
await fs.mkdir(out, { recursive: false });
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
const meta = JSON.parse(await fs.readFile(path.join(baseline, "baseline.json"), "utf8"));
assert.equal(sha(await fs.readFile(path.join(baseline, "libwasm_vm_core.rlib"))), meta.rlibSha256);
assert.equal(sha(await fs.readFile(path.join(baseline, "pkg/wasm_vm_wasm_bg.wasm"))), meta.wasmSha256);
const report = { head: execFileSync("git", ["rev-parse", "HEAD"], { cwd: repo, encoding: "utf8" }).trim(), baseline: meta,
  sourceSha256: sha(await fs.readFile(path.join(repo, "crates/core/src/hart/regs.rs"))),
  harnessSha256: sha(await fs.readFile(fileURLToPath(import.meta.url))), errors: [], passed: false };
const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
const summarize = (pairs, key) => {
  const times = arm => pairs.map(p => p.runs.find(r => r.arm === arm)[key]);
  const base = median(times("baseline")), candidate = median(times("candidate"));
  return { baseline: base, candidate, speedup: base / candidate,
    pairedSpeedup: median(pairs.map(p => p.runs.find(r => r.arm === "baseline")[key] / p.runs.find(r => r.arm === "candidate")[key])) };
};
let server, browser;
try {
  const output = execFileSync("cargo", ["build", "-p", "wasm-vm-core", "--release", "--features", "trace", "--message-format=json"], { cwd: repo, encoding: "utf8" });
  await fs.writeFile(path.join(out, "native-build.jsonl"), output);
  const artifact = output.trim().split("\n").map(l => JSON.parse(l)).find(r => r.reason === "compiler-artifact" && r.target.name === "wasm_vm_core");
  const core = artifact.filenames.find(f => f.endsWith(".rlib"));
  const producer = path.join(repo, "crates/core/examples/jit_handoff_probe.rs");
  report.producerSha256 = sha(await fs.readFile(producer));
  report.compiler = execFileSync("rustc", ["-Vv"], { encoding: "utf8" });
  report.nativeLibraries = { baseline: meta.rlibSha256, candidate: sha(await fs.readFile(core)) };
  report.nativeBinaries = {};
  for (const arm of ["baseline", "candidate"]) {
    const library = arm === "baseline" ? path.join(baseline, "libwasm_vm_core.rlib") : core;
    const binary = path.join(out, `native-${arm}`);
    execFileSync("rustc", ["--edition=2024", "-O", "-C", "lto=fat", "-C", "codegen-units=1", producer,
      "--extern", `wasm_vm_core=${library}`, "-L", `dependency=${path.join(repo, "target/release/deps")}`, "-o", binary], { cwd: repo });
    report.nativeBinaries[arm] = sha(await fs.readFile(binary));
  }
  report.native = [];
  for (const mask of [0, 1, 0x80000000, 0x80000082, 0xfffffffe]) {
    const run = arm => ({ arm, ...JSON.parse(execFileSync(path.join(out, `native-${arm}`), [String(mask), "4000000"], { encoding: "utf8", timeout: 60_000 })) });
    const warmups = [run("baseline"), run("candidate")], pairs = [];
    for (let pair = 0; pair < 7; pair++) {
      const order = pair % 2 ? ["candidate", "baseline"] : ["baseline", "candidate"];
      const runs = order.map(run);
      assert.deepEqual(runs[0].words, runs[1].words); assert.equal(runs[0].version, runs[1].version);
      pairs.push({ pair, order, runs });
    }
    report.native.push({ mask, warmups, pairs, ...summarize(pairs, "seconds") });
  }
  const roots = { baseline, candidate: path.join(repo, "web/dist") };
  report.wasm = {};
  for (const [arm, root] of Object.entries(roots)) report.wasm[arm] = sha(await fs.readFile(path.join(root, "pkg/wasm_vm_wasm_bg.wasm")));
  report.identicalBrowserBinary = report.wasm.baseline === report.wasm.candidate;
  server = createServer(async (req, res) => {
    const url = new URL(req.url, "http://localhost"), headers = { "Cross-Origin-Opener-Policy": "same-origin", "Cross-Origin-Embedder-Policy": "require-corp" };
    if (url.pathname === "/") { res.writeHead(200, { ...headers, "Content-Type": "text/html" }).end("<!doctype html><title>JIT handoff comparison</title>"); return; }
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
  report.browserVersion = browser.version();
  const page = await browser.newPage({ serviceWorkers: "block" });
  page.on("pageerror", error => report.errors.push(String(error)));
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  report.browser = await page.evaluate(async () => {
    const modules = {};
    for (const arm of ["baseline", "candidate"]) { modules[arm] = await import(`/${arm}/pkg/wasm_vm_wasm.js`); await modules[arm].default(); }
    const hash = async bytes => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), b => b.toString(16).padStart(2, "0")).join("");
    const sections = blob => {
      const view = new DataView(blob.buffer, blob.byteOffset, blob.byteLength), result = {};
      for (let at = 84; at < blob.length;) {
        const tag = view.getUint32(at, true), len = view.getUint32(at + 4, true); at += 8;
        if (at + len > blob.length) throw Error("truncated section");
        result[tag] = blob.slice(at, at + len); at += len;
      }
      return result;
    };
    const configs = [{ name: "empty", regs: [0] }, { name: "one", regs: [31] },
      { name: "sparse", regs: [1, 7, 31] }, { name: "dense", regs: Array.from({ length: 31 }, (_, i) => i + 1) }];
    const rows = [];
    for (const config of configs) {
      const words = config.regs.map(reg => (1 << 20) | (reg << 15) | (reg << 7) | 0x13);
      const off = -4 * words.length;
      words.push(((off >>> 20 & 1) << 31) | ((off >>> 1 & 0x3ff) << 21) | ((off >>> 11 & 1) << 20) | ((off >>> 12 & 0xff) << 12) | 0x6f);
      const kernel = new Uint8Array(words.length * 4), view = new DataView(kernel.buffer);
      words.forEach((word, i) => view.setUint32(i * 4, word, true));
      async function run(arm, jit = true, budget = 40_000_000) {
        const vm = new modules[arm].WasmLinux(8, kernel, new Uint8Array(), "", () => {}, false);
        try {
          vm.setICountDivider(64); vm.setFastInterpreter(true); if (jit) vm.enableJit(1);
          const initial = sections(vm.saveSnapshot())[1], initialView = new DataView(initial.buffer);
          const prefix = vm.runChunk(20_000);
          const started = performance.now(), result = vm.runChunk(budget), elapsedMs = performance.now() - started;
          const saved = sections(vm.saveSnapshot()), cpu = new DataView(saved[1].buffer);
          const total = budget + 20_000, loops = Math.floor(total / words.length), tail = total % words.length;
          if (cpu.getBigUint64(0, true) !== initialView.getBigUint64(0, true) + BigInt(tail * 4)) throw Error("PC oracle");
          for (let reg = 1; reg < 32; reg++) {
            const index = config.regs.indexOf(reg), increments = index < 0 ? 0 : loops + Number(index < tail);
            if (cpu.getBigUint64(reg * 8, true) !== BigInt.asUintN(64, initialView.getBigUint64(reg * 8, true) + BigInt(increments))) throw Error(`x${reg} oracle`);
          }
          const state = { cpu: await hash(saved[1]), clint: await hash(saved[3]), clock: await hash(saved[9]), ram: vm.stateDigest() };
          return { arm, elapsedMs, prefix, result, state, jit: vm.jitStats() };
        } finally { vm.free(); }
      }
      const oracle = [await run("baseline", false, 100_000), await run("candidate", true, 100_000)];
      const warmups = [await run("baseline"), await run("candidate"), await run("candidate"), await run("baseline")], pairs = [];
      for (let pair = 0; pair < 7; pair++) {
        const order = pair % 2 ? ["candidate", "baseline"] : ["baseline", "candidate"], runs = [];
        for (const arm of order) runs.push(await run(arm));
        pairs.push({ pair, order, runs });
      }
      rows.push({ config, oracle, warmups, pairs });
    }
    return rows;
  });
  for (const row of report.browser) {
    assert.deepEqual(row.oracle[0].state, row.oracle[1].state, "interpreter/JIT state");
    const all = [...row.warmups, ...row.pairs.flatMap(p => p.runs)];
    for (const run of all) {
      assert.deepEqual(run.state, all[0].state);
      assert.deepEqual(run.result, { done: false, state: null, retired: 40_000_000 });
      assert.equal(run.jit.guestRetired, 40_020_000);
      assert.ok(run.jit.retiredViaJit > 39_900_000, "real compiled execution");
    }
    Object.assign(row, summarize(row.pairs, "elapsedMs"));
  }
  assert.deepEqual(report.errors, []);
  report.passed = true;
  report.sparseSpeedup = report.browser.find(row => row.config.name === "sparse").pairedSpeedup;
  report.acceptanceHeld = !report.identicalBrowserBinary && report.sparseSpeedup > 1.02;
  console.log(JSON.stringify({ native: report.native.map(({ mask, speedup }) => ({ mask, speedup })), browser: report.browser.map(({ config, speedup, pairedSpeedup }) => ({ config, speedup, pairedSpeedup })), acceptanceHeld: report.acceptanceHeld }));
} finally {
  await fs.writeFile(path.join(out, "report.json"), JSON.stringify(report, null, 2) + "\n");
  await browser?.close(); if (server) await new Promise(resolve => server.close(resolve));
}
