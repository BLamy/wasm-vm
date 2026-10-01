#!/usr/bin/env node
// Alternating frozen native and browser artifacts; exact guest state is checked outside timing.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
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
assert.equal(sha(execFileSync("git", ["show", `${meta.head}:crates/core/src/lib.rs`], { cwd: repo })), meta.coreSourceSha256);
assert.equal(sha(await fs.readFile(path.join(baseline, "libbaseline.rlib"))), meta.rlibSha256);
const report = { head: execFileSync("git", ["rev-parse", "HEAD"], { cwd: repo, encoding: "utf8" }).trim(),
  baseline: meta, compiler: execFileSync("rustc", ["-Vv"], { encoding: "utf8" }),
  producerSha256: sha(await fs.readFile(path.join(repo, "crates/core/examples/clock_loop_probe.rs"))),
  harnessSha256: sha(await fs.readFile(fileURLToPath(import.meta.url))), errors: [], passed: false };
const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
const roots = { baseline, candidate: path.join(repo, "web/dist") };
let browser, server;
try {
  const build = execFileSync("cargo", ["build", "-p", "wasm-vm-core", "--release", "--features", "trace", "--message-format=json"],
    { cwd: repo, encoding: "utf8", maxBuffer: 8 * 1024 * 1024 });
  await fs.writeFile(path.join(out, "native-build.jsonl"), build);
  const artifacts = build.trim().split("\n").map(line => JSON.parse(line)).filter(row => row.reason === "compiler-artifact");
  const library = name => artifacts.find(row => row.target.name === name).filenames.find(file => file.endsWith(".rlib"));
  const core = library("wasm_vm_core"), sha2 = library("sha2");
  report.nativeLibraries = { baseline: meta.rlibSha256, candidate: sha(await fs.readFile(core)), sha2: sha(await fs.readFile(sha2)) };
  const binaries = {};
  report.nativeBinaries = {};
  for (const arm of ["baseline", "candidate"]) {
    binaries[arm] = path.join(out, `native-${arm}`);
    execFileSync("rustc", ["--edition=2024", "-O", path.join(repo, "crates/core/examples/clock_loop_probe.rs"),
      "--extern", `wasm_vm_core=${arm === "baseline" ? path.join(baseline, "libbaseline.rlib") : core}`,
      "--extern", `sha2=${sha2}`, "-L", `dependency=${path.dirname(sha2)}`, "-o", binaries[arm]], { cwd: repo });
    report.nativeBinaries[arm] = sha(await fs.readFile(binaries[arm]));
  }
  const native = (arm, budget, divider, cached, trace) => JSON.parse(execFileSync(binaries[arm],
    [String(budget), String(divider), String(cached), ...(trace ? [trace] : [])], { encoding: "utf8", timeout: 60_000 }));
  const state = ({ seconds, ...rest }) => rest;
  report.native = [];
  for (const [cached, divider] of [[true, 0], [false, 64], [true, 1], [true, 64], [true, 1024]]) {
    const warmups = ["baseline", "candidate"].map(arm => ({ arm, ...native(arm, 8_000_000, divider, cached) }));
    const pairs = [];
    for (let pair = 0; pair < 5; pair++) {
      const order = pair % 2 ? ["candidate", "baseline"] : ["baseline", "candidate"];
      const runs = order.map(arm => ({ arm, ...native(arm, 8_000_000, divider, cached) }));
      const [{ arm: a, ...x }, { arm: b, ...y }] = runs;
      assert.deepEqual(state(x), state(y), "native full resume, registers and clock must match");
      pairs.push({ pair, order, runs });
    }
    const times = arm => pairs.flatMap(p => p.runs).filter(r => r.arm === arm).map(r => r.seconds);
    const baselineSeconds = median(times("baseline")), candidateSeconds = median(times("candidate"));
    report.native.push({ cached, divider, warmups, pairs, baselineSeconds, candidateSeconds, speedup: baselineSeconds / candidateSeconds });
  }
  report.guestTraces = {};
  for (const arm of ["baseline", "candidate"]) {
    const file = path.join(out, `${arm}-guest-trace64.txt`);
    report.guestTraces[arm] = native(arm, 192, 64, true, file);
    assert.equal(sha(await fs.readFile(file)), report.guestTraces[arm].traceSha256);
  }
  assert.deepEqual(state(report.guestTraces.baseline), state(report.guestTraces.candidate));

  report.browserArtifacts = {};
  for (const [arm, root] of Object.entries(roots)) {
    report.browserArtifacts[arm] = {};
    for (const file of ["pkg/wasm_vm_wasm.js", "pkg/wasm_vm_wasm_bg.wasm"])
      report.browserArtifacts[arm][file] = sha(await fs.readFile(path.join(root, file)));
  }
  assert.equal(report.browserArtifacts.baseline["pkg/wasm_vm_wasm_bg.wasm"], meta.wasmSha256);
  assert.notEqual(report.browserArtifacts.baseline["pkg/wasm_vm_wasm_bg.wasm"], report.browserArtifacts.candidate["pkg/wasm_vm_wasm_bg.wasm"]);
  server = createServer(async (req, res) => {
    const url = new URL(req.url, "http://localhost");
    const headers = { "Cross-Origin-Opener-Policy": "same-origin", "Cross-Origin-Embedder-Policy": "require-corp" };
    if (url.pathname === "/") { res.writeHead(200, { ...headers, "Content-Type": "text/html" }).end("<!doctype html><title>Guest timer comparison</title>"); return; }
    const [, arm, ...parts] = url.pathname.split("/");
    const root = roots[arm];
    if (!root) { res.writeHead(404).end(); return; }
    const file = path.resolve(root, parts.join("/"));
    if (!file.startsWith(root + path.sep)) { res.writeHead(404).end(); return; }
    try { const data = await fs.readFile(file); res.writeHead(200, { ...headers, "Content-Type": file.endsWith(".wasm") ? "application/wasm" : "text/javascript" }).end(data); }
    catch { res.writeHead(404).end(); }
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const { chromium } = await import(pathToFileURL(path.join(repo, "web/node_modules/playwright/index.mjs")));
  browser = await chromium.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true });
  report.browserVersion = browser.version();
  const page = await browser.newPage({ serviceWorkers: "block" });
  page.on("pageerror", error => report.errors.push(String(error)));
  page.on("console", m => { if (m.type() === "error" && !m.location().url?.endsWith("/favicon.ico")) report.errors.push(m.text()); });
  page.on("response", response => { if (response.status() >= 400 && !response.url().endsWith("/favicon.ico")) report.errors.push(`${response.status()} ${response.url()}`); });
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  report.browser = await withinTrialDeadline(() => page.evaluate(async () => {
    const bindings = {};
    for (const arm of ["baseline", "candidate"]) { bindings[arm] = await import(`/${arm}/pkg/wasm_vm_wasm.js`); await bindings[arm].default(); }
    const kernel = new Uint8Array(16), view = new DataView(kernel.buffer);
    [0x00128293, 0x00230313, 0x006283b3, 0xff5ff06f].forEach((word, i) => view.setUint32(i * 4, word, true));
    const hexHash = async bytes => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), b => b.toString(16).padStart(2, "0")).join("");
    async function run(arm, config) {
      const vm = new bindings[arm].WasmLinux(8, kernel, new Uint8Array(), "", () => {}, false);
      try {
        vm.setICountDivider(config.divider); vm.setFastInterpreter(config.fast);
        if (config.jit) vm.enableJit(1);
        const prefix = vm.runChunk(20_000);
        const started = performance.now(), result = vm.runChunk(config.budget), elapsedMs = performance.now() - started;
        const blob = vm.saveSnapshot(), tlv = new DataView(blob.buffer, blob.byteOffset, blob.byteLength), sections = {};
        for (let at = 84; at < blob.length;) {
          if (at + 8 > blob.length) throw Error("truncated snapshot section");
          const tag = tlv.getUint32(at, true), len = tlv.getUint32(at + 4, true); at += 8;
          if (at + len > blob.length) throw Error("overflowing snapshot section");
          if ([1, 3, 9].includes(tag)) sections[tag] = blob.slice(at, at + len);
          at += len;
        }
        if (!sections[1] || !sections[3] || sections[9]?.length !== 24) throw Error("missing CPU/CLINT/CLOCK state");
        const phase = new DataView(sections[9].buffer).getBigUint64(0, true).toString();
        return { arm, elapsedMs, prefix, result, clock: vm.guestClockState(), phase,
          cpuSha256: await hexHash(sections[1]), clintSha256: await hexHash(sections[3]), clockSha256: await hexHash(sections[9]),
          ramSha256: vm.stateDigest(), jit: vm.jitStats() };
      } finally { vm.free(); }
    }
    const rows = [];
    for (const config of [{ fast: false, divider: 64 }, { fast: true, divider: 1 }, { fast: true, divider: 64 },
      { fast: true, divider: 1024 }, { fast: true, divider: 64, jit: true }]) {
      config.jit = Boolean(config.jit); config.budget = config.jit ? 40_000_000 : 4_000_000;
      const warmups = [];
      for (const arm of ["baseline", "candidate", "candidate", "baseline"]) warmups.push(await run(arm, config));
      const pairs = [];
      for (let pair = 0; pair < 5; pair++) {
        const order = pair % 2 ? ["candidate", "baseline"] : ["baseline", "candidate"], runs = [];
        for (const arm of order) runs.push(await run(arm, config));
        pairs.push({ pair, order, runs });
      }
      rows.push({ config, warmups, pairs });
    }
    return rows;
  }), Date.now() + 300_000, "paired guest timer benchmark");
  for (const row of report.browser) {
    const all = [...row.warmups, ...row.pairs.flatMap(p => p.runs)], oracle = all[0];
    for (const run of all) {
      assert.deepEqual(run.prefix, { done: false, state: null, retired: 20_000 });
      assert.deepEqual(run.result, { done: false, state: null, retired: row.config.budget });
      assert.equal(run.clock.mtime, String(Math.floor((row.config.budget + 20_000) / row.config.divider)));
      assert.equal(run.phase, String((row.config.budget + 20_000) % row.config.divider));
      for (const key of ["clock", "phase", "cpuSha256", "clintSha256", "clockSha256", "ramSha256"]) assert.deepEqual(run[key], oracle[key], key);
      assert.equal(run.jit.guestRetired, row.config.budget + 20_000);
      if (row.config.jit) assert.ok(run.jit.retiredViaJit > row.config.budget * .99);
      else assert.equal(run.jit.retiredViaJit, 0);
    }
    const times = arm => row.pairs.flatMap(p => p.runs).filter(r => r.arm === arm).map(r => r.elapsedMs);
    row.baselineMs = median(times("baseline")); row.candidateMs = median(times("candidate")); row.speedup = row.baselineMs / row.candidateMs;
  }
  assert.ok(report.browser.find(r => r.config.fast && !r.config.jit && r.config.divider === 64).speedup > 1, "browser divider-64 median must improve");
  assert.deepEqual(report.errors, []);
  report.passed = true;
  console.log(JSON.stringify({ passed: true, native: report.native.map(({ cached, divider, speedup }) => ({ cached, divider, speedup })),
    browser: report.browser.map(({ config, baselineMs, candidateMs, speedup }) => ({ config, baselineMs, candidateMs, speedup })) }));
} catch (error) { report.failure = String(error); throw error; }
finally { await browser?.close(); if (server) await new Promise(resolve => server.close(resolve)); await fs.writeFile(path.join(out, "report.json"), JSON.stringify(report, null, 2) + "\n"); }
