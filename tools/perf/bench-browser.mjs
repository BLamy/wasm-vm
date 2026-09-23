#!/usr/bin/env node
/**
 * Perf-overhaul browser benchmark suite: HOST wall-clock numbers for one or more built web roots,
 * measured in headless Chromium (Playwright from web/node_modules).
 *
 *   node tools/perf/bench-browser.mjs --root baseline=/path/to/checkout-A \
 *       --root candidate=/path/to/checkout-B --out OUTDIR [--samples 3] [--cases ...]
 *
 * A root is a checkout (its web/ is served) or a web directory, built with `make web-build` (needs
 * web/pkg and web/node_modules). Every root gets its own local HTTP server (own origin, so no
 * shared caches) that sends the COOP/COEP headers the worker JIT needs; every sample gets a fresh
 * browser context. With several roots the samples are interleaved (order flips each rep).
 *
 * Every timing here is read from the host: performance.now() in the page (the browser's monotonic
 * clock), never the guest's clock. Under the icount guest clock, in-guest timers cannot see host
 * speedups; the old "JIT 1.0x" compute result was invalid for exactly that reason.
 *
 * Cases (jit = production default worker JIT, nojit = ?jit=0):
 *   busybox-jit | busybox-nojit  one page load measures two things:
 *                                (a) busybox COLD boot (boot snapshot withheld) -> shell prompt,
 *                                    from navigation start; MIPS from the worker's retired counter
 *                                (b) a busybox shell arithmetic loop typed at that prompt, timed
 *                                    from Enter to its completion marker (same workload as
 *                                    bench-native's compute case)
 *   node-jit | node-nojit        (c) the shipped node-alpine snapshot restored, then a fixed
 *                                `node -e` compute script timed from Enter to its completion marker
 *                                (first run after restore, so it includes Node startup)
 */

import { createServer } from "node:http";
import { createReadStream, existsSync, statSync, readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { randomBytes, createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "../..");
const ALL_CASES = ["busybox-jit", "busybox-nojit", "node-jit", "node-nojit"];
// A fixed, deterministic Node workload (checksum printed so a wrong answer is visible). Kept free
// of single quotes so it can be typed verbatim inside '...'. One string argument to console.log so
// Node does not colorize the number on a TTY.
const NODE_SCRIPT =
  "let s=0;for(let i=0;i<3000000;i++){s=(Math.imul(s,31)+i)|0}console.log(\"NODESUM \"+s)";
const NODE_EXPECTED_SUM = (() => {
  let s = 0;
  for (let i = 0; i < 3000000; i++) s = (Math.imul(s, 31) + i) | 0;
  return s;
})();

function log(msg) {
  process.stderr.write(`[bench-browser ${new Date().toISOString().slice(11, 19)}] ${msg}\n`);
}

function parseArgs(argv) {
  const o = {
    roots: [],
    out: null,
    samples: Number(process.env.SAMPLES || 3),
    cases: (process.env.BROWSER_CASES || ALL_CASES.join(",")).split(",").map((s) => s.trim()).filter(Boolean),
    releases: process.env.RELEASES || null,
    computeIters: Number(process.env.COMPUTE_ITERS || 10000),
    headless: true,
    chrome: process.env.BENCH_CHROME || null,
    bootTimeoutMs: 600_000,
    computeTimeoutMs: 900_000,
    nodeTimeoutMs: 1_200_000,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "-h" || a === "--help") return { help: true };
    const eq = a.indexOf("=");
    const key = eq === -1 ? a.slice(2) : a.slice(2, eq);
    const val = eq === -1 ? argv[++i] : a.slice(eq + 1);
    switch (key) {
      case "root": o.roots.push(val); break;
      case "out": o.out = val; break;
      case "samples": o.samples = Number(val); break;
      case "cases": o.cases = val.split(",").map((s) => s.trim()).filter(Boolean); break;
      case "releases": o.releases = val; break;
      case "compute-iters": o.computeIters = Number(val); break;
      case "headless": o.headless = !["0", "false"].includes(val); break;
      case "chrome": o.chrome = val; break;
      case "boot-timeout-ms": o.bootTimeoutMs = Number(val); break;
      case "compute-timeout-ms": o.computeTimeoutMs = Number(val); break;
      case "node-timeout-ms": o.nodeTimeoutMs = Number(val); break;
      default: throw new Error(`unknown option --${key}`);
    }
  }
  if (!o.out || o.roots.length === 0) throw new Error("need --out and at least one --root LABEL=PATH");
  for (const c of o.cases) if (!ALL_CASES.includes(c)) throw new Error(`unknown case ${c}`);
  return o;
}

function resolveRoot(spec) {
  const eq = spec.indexOf("=");
  const label = eq === -1 ? path.basename(path.resolve(spec)) : spec.slice(0, eq);
  let p = path.resolve(eq === -1 ? spec : spec.slice(eq + 1));
  let web = existsSync(path.join(p, "web", "index.html")) ? path.join(p, "web") : p;
  const checkout = path.basename(web) === "web" ? path.dirname(web) : null;
  const need = [["pkg/wasm_vm_wasm_bg.wasm", "make web-build"], ["node_modules/@xterm/xterm/lib/xterm.js", "make web-build (npm ci)"],
    ["releases/kernel/6.6.63/Image", "make web-build"]];
  for (const [rel, fix] of need) {
    if (!existsSync(path.join(web, rel))) throw new Error(`${label}: ${web}/${rel} missing — run \`${fix}\` in ${checkout ?? web}`);
  }
  let git = {};
  if (checkout) {
    try {
      git.rev = execFileSync("git", ["-C", checkout, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
      git.branch = execFileSync("git", ["-C", checkout, "rev-parse", "--abbrev-ref", "HEAD"], { encoding: "utf8" }).trim();
      git.dirty = execFileSync("git", ["-C", checkout, "status", "--porcelain", "--", "crates", "web", "Cargo.toml"], { encoding: "utf8" }).trim().length > 0;
    } catch { /* not a git checkout */ }
  }
  const wasm = readFileSync(path.join(web, "pkg/wasm_vm_wasm_bg.wasm"));
  const wasmMtime = statSync(path.join(web, "pkg/wasm_vm_wasm_bg.wasm")).mtime.toISOString();
  return { label, web, checkout, git, wasmSha256: createHash("sha256").update(wasm).digest("hex"), wasmBytes: wasm.length, wasmMtime };
}

const TYPES = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".mjs": "text/javascript", ".json": "application/json",
  ".wasm": "application/wasm", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon",
  ".woff2": "font/woff2", ".map": "application/json", ".txt": "text/plain",
};

/** Static server for one root: COOP/COEP (cross-origin isolation -> SharedArrayBuffer -> worker
 * JIT), `/releases/*` resolved from the root's web/releases, then its checkout's releases/ (the
 * tracked boot snapshots), then RELEASES (gitignored chunked images). `/artifacts.json` is served
 * without its bootSnapshot entry so the busybox boot is a real cold boot, not a snapshot restore. */
async function startServer(root, releasesDir) {
  // `log` is every served path in order; runSample slices it per sample (samples on one server are
  // sequential) to prove a busybox "cold boot" never fetched a snapshot and a node restore did.
  const requests = { count: 0, bytes: 0, notFound: [], log: [] };
  const server = createServer((req, res) => {
    let pathname;
    try { pathname = decodeURIComponent(new URL(req.url, "http://x").pathname); } catch { res.writeHead(400).end(); return; }
    if (pathname === "/") pathname = "/index.html";
    requests.log.push(pathname);
    const headers = {
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "require-corp",
      "Cross-Origin-Resource-Policy": "same-origin",
      "Cache-Control": "no-store",
    };
    if (pathname === "/artifacts.json") {
      const j = JSON.parse(readFileSync(path.join(root.web, "artifacts.json"), "utf8"));
      if (j.artifacts) delete j.artifacts.bootSnapshot;
      const body = Buffer.from(JSON.stringify(j));
      res.writeHead(200, { ...headers, "Content-Type": "application/json", "Content-Length": body.length }).end(body);
      requests.count++;
      return;
    }
    const candidates = [];
    if (pathname.startsWith("/releases/")) {
      const rel = pathname.slice("/releases/".length);
      candidates.push(path.join(root.web, "releases", rel));
      if (root.checkout) candidates.push(path.join(root.checkout, "releases", rel));
      if (releasesDir) candidates.push(path.join(releasesDir, rel));
    } else {
      candidates.push(path.join(root.web, pathname));
    }
    for (const file of candidates) {
      const norm = path.normalize(file);
      if (norm.includes(`${path.sep}..${path.sep}`)) continue;
      let st;
      try { st = statSync(norm); } catch { continue; }
      if (!st.isFile()) continue;
      requests.count++;
      requests.bytes += st.size;
      res.writeHead(200, { ...headers, "Content-Type": TYPES[path.extname(norm)] || "application/octet-stream", "Content-Length": st.size });
      if (req.method === "HEAD") { res.end(); return; }
      createReadStream(norm).pipe(res);
      return;
    }
    if (!pathname.endsWith("favicon.ico")) requests.notFound.push(pathname);
    res.writeHead(404, headers).end();
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { server, origin: `http://127.0.0.1:${server.address().port}`, requests };
}

function loadPlaywright(roots) {
  const candidates = [path.join(REPO, "web"), ...roots.map((r) => r.web)];
  for (const dir of candidates) {
    try {
      const req = createRequire(path.join(dir, "package.json"));
      return { playwright: req("playwright"), from: dir };
    } catch { /* try next */ }
  }
  throw new Error("playwright not found — run `make web-build` (npm ci) in a checkout");
}

/** In-page instrumentation installed before any page script: guest lifecycle event timestamps
 * (performance.now() = ms since navigation start) and a console tap. */
function initScript() {
  window.__bench = { events: [], out: "" };
  for (const name of ["wvm:guest-booting", "wvm:guest-ready", "wvm:guest-error"]) {
    window.addEventListener(name, () => window.__bench.events.push({ name, t: performance.now() }));
  }
}

async function waitReady(page, timeoutMs) {
  await page.waitForFunction(() => {
    const b = window.__bench;
    return b.events.some((e) => e.name === "wvm:guest-ready") || b.events.some((e) => e.name === "wvm:guest-error") ||
      Boolean(document.querySelector("body")?.dataset?.bootError);
  }, null, { timeout: timeoutMs, polling: 100 });
  const ev = await page.evaluate(() => window.__bench.events);
  const err = ev.find((e) => e.name === "wvm:guest-error");
  if (err && !ev.some((e) => e.name === "wvm:guest-ready")) throw new Error("guest reported an error before ready");
  return ev;
}

async function pageStats(page) {
  return page.evaluate(async () => {
    const sched = await window.__schedulerStats?.().catch?.(() => null) ?? null;
    let jit = null;
    try { jit = await window.__jitStats?.(); } catch { /* optional */ }
    return {
      sched,
      jit,
      policy: window.__executionPolicy ?? null,
      jitPolicy: document.documentElement.dataset.jitPolicy ?? null,
      crossOriginIsolated: globalThis.crossOriginIsolated === true,
      backend: document.documentElement.dataset.linuxBackend ?? null,
    };
  });
}

/** The scalar fields of the page's jitStats() (hasExecutor, compiledBlocks, retiredViaJit, ...). */
function summarizeJit(jit) {
  if (!jit || typeof jit !== "object") return null;
  const pick = {};
  for (const [k, v] of Object.entries(jit)) {
    if ((typeof v === "number" || typeof v === "boolean") && Object.keys(pick).length < 40) pick[k] = v;
  }
  return pick;
}

/** Type `command` at the guest shell, let the echo settle, then time Enter -> `doneRe` with the
 * page's performance.now(), bracketing the worker's retired counter. Runs entirely in the page so
 * no CDP round trip sits inside the timed region. */
async function timedCommand(page, command, doneSource, timeoutMs) {
  return page.evaluate(async ({ command, doneSource, timeoutMs }) => {
    const api = window.wvmDemo;
    const dec = new TextDecoder();
    let out = "";
    let done = null;
    let doneAt = null;
    const strip = (s) => s.replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, "").replace(/[\r\n]/g, "");
    // Stamp completion inside the console callback itself, so the end time is the moment the
    // marker bytes reached the page (no polling granularity).
    const unsub = api.onConsole((bytes) => {
      out += dec.decode(bytes, { stream: true });
      if (done && doneAt === null && done.test(out)) doneAt = performance.now();
    });
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const until = async (pred, ms) => {
      const end = performance.now() + ms;
      while (!pred()) {
        if (performance.now() > end) return false;
        await sleep(5);
      }
      return true;
    };
    try {
      api.sendInput(new TextEncoder().encode(command));
      const tail = command.slice(-16);
      const echoed = await until(() => strip(out).includes(tail), 20_000);
      await sleep(300);
      const s1 = await window.__schedulerStats?.();
      const j1 = await window.__jitStats?.().catch(() => null);
      out = "";
      done = new RegExp(doneSource);
      const t0 = performance.now();
      api.sendInput(new Uint8Array([13]));
      const ok = await until(() => doneAt !== null, timeoutMs);
      const t1 = doneAt ?? performance.now();
      const s2 = await window.__schedulerStats?.();
      const j2 = await window.__jitStats?.().catch(() => null);
      const m = out.match(done);
      return {
        ok, echoed, regionMs: t1 - t0,
        match: m ? m.slice(1) : null,
        output: out.replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, "").slice(-3000),
        retiredViaJit: j1 && j2 && typeof j2.retiredViaJit === "number" ? j2.retiredViaJit - j1.retiredViaJit : null,
        retired: s1 && s2 ? s2.retiredInstructions - s1.retiredInstructions : null,
        execMs: s1 && s2 ? s2.totalSliceMs - s1.totalSliceMs : null,
        slices: s1 && s2 ? s2.slices - s1.slices : null,
      };
    } finally {
      unsub();
    }
  }, { command, doneSource, timeoutMs });
}

async function runSample(browser, root, server, kase, rep, opts) {
  const [kind, variant] = kase.split("-");
  const params = new URLSearchParams();
  params.set("guest", kind === "node" ? "node-alpine" : "busybox");
  if (kind === "node") params.set("assetBase", `${server.origin}/releases`);
  if (variant === "nojit") params.set("jit", "0");
  const url = `${server.origin}/index.html?${params}`;
  const rec = { case: kase, label: root.label, rep, url, ok: false, loadavg1m: os.loadavg()[0] };
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: "block" });
  const page = await context.newPage();
  const consoleErrors = [];
  page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text().slice(0, 300)); });
  page.on("pageerror", (e) => consoleErrors.push(`pageerror: ${String(e).slice(0, 300)}`));
  await page.addInitScript(initScript);
  const log0 = server.requests.log.length;
  const region = (r) => {
    rec.regionMs = r.regionMs;
    rec.retired = r.retired;
    rec.execMs = r.execMs;
    rec.slices = r.slices;
    rec.echoed = r.echoed;
    rec.mips = r.retired != null && r.regionMs ? r.retired / r.regionMs / 1000 : null;
    rec.mipsExec = r.retired != null && r.execMs ? r.retired / r.execMs / 1000 : null;
    rec.jitFraction = r.retiredViaJit != null && r.retired ? r.retiredViaJit / r.retired : null;
  };
  try {
    const hostT0 = performance.now();
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 120_000 });
    const ev = await waitReady(page, opts.bootTimeoutMs);
    rec.hostReadyMs = performance.now() - hostT0;
    const booting = ev.find((e) => e.name === "wvm:guest-booting");
    const ready = ev.find((e) => e.name === "wvm:guest-ready");
    rec.readyMs = ready.t; // ms since navigation start, page clock (host)
    rec.bootingAtMs = booting ? booting.t : null;
    const st = await pageStats(page);
    rec.crossOriginIsolated = st.crossOriginIsolated;
    rec.jitPolicy = st.jitPolicy;
    rec.backend = st.backend;
    rec.policy = st.policy;
    if (st.sched) {
      rec.retiredAtReady = st.sched.retiredInstructions;
      rec.execMsAtReady = st.sched.totalSliceMs;
      if (kind === "busybox" && booting) {
        rec.bootMipsWall = st.sched.retiredInstructions / (ready.t - booting.t) / 1000;
        rec.bootMipsExec = st.sched.totalSliceMs ? st.sched.retiredInstructions / st.sched.totalSliceMs / 1000 : null;
      }
    }
    rec.jitAtReady = summarizeJit(st.jit);
    // Which boot path actually ran: a withheld bootSnapshot must mean a real cold boot (the page
    // could learn a new way to find one), and the node case must really be a snapshot restore.
    rec.snapshotRequests = [...new Set(server.requests.log.slice(log0).filter((p) => /\.snap(\.gz)?$|boot-snapshot\//.test(p)))];
    if (kind === "busybox" && rec.snapshotRequests.length) {
      throw new Error(`busybox cold-boot sample fetched a snapshot: ${rec.snapshotRequests.join(", ")}`);
    }
    if (kind === "node" && !rec.snapshotRequests.length) throw new Error("node sample did not restore a snapshot");
    if (kind === "busybox" && typeof st.jit?.retiredViaJit === "number" && st.sched?.retiredInstructions) {
      rec.bootJitFraction = st.jit.retiredViaJit / st.sched.retiredInstructions;
    }
    if (!st.crossOriginIsolated) throw new Error("page is not crossOriginIsolated (COOP/COEP) — the JIT cannot run");
    if (variant === "jit" && st.jitPolicy !== "enabled") throw new Error(`JIT variant but jitPolicy=${st.jitPolicy}`);
    if (variant === "nojit" && st.jitPolicy !== "forced-off") throw new Error(`nojit variant but jitPolicy=${st.jitPolicy}`);
    rec.bootOk = true;
    const nonce = randomBytes(4).toString("hex");
    if (kind === "busybox") {
      const n = opts.computeIters;
      const cmd = `i=0; while [ $i -lt ${n} ]; do i=$((i+1)); done; echo BENCH""DONE${nonce} $i`;
      const r = await timedCommand(page, cmd, `BENCHDONE${nonce} (\\d+)`, opts.computeTimeoutMs);
      region(r);
      rec.ok = Boolean(r.ok && r.match && Number(r.match[0]) === n);
      if (!rec.ok) rec.output = r.output;
    } else {
      const cmd = `node -e '${NODE_SCRIPT}'; echo BENCH""DONE${nonce} $?`;
      const r = await timedCommand(page, cmd, `BENCHDONE${nonce} (\\d+)`, opts.nodeTimeoutMs);
      region(r);
      const sum = /NODESUM (-?\d+)/.exec(r.output);
      rec.nodeSum = sum ? Number(sum[1]) : null;
      rec.ok = Boolean(r.ok && r.match && r.match[0] === "0" && rec.nodeSum === NODE_EXPECTED_SUM);
      if (!rec.ok) rec.output = r.output;
    }
    const end = await pageStats(page);
    rec.jit = summarizeJit(end.jit);
    rec.retiredTotal = end.sched?.retiredInstructions ?? null;
  } catch (e) {
    rec.error = String(e?.message || e).slice(0, 1000);
    try {
      rec.consoleTail = (await page.evaluate(() => document.querySelector(".xterm-rows")?.innerText ?? "")).slice(-1500);
    } catch { /* page gone */ }
  } finally {
    rec.consoleErrors = consoleErrors.slice(0, 20);
    await context.close().catch(() => {});
  }
  return rec;
}

const median = (xs) => {
  const v = xs.filter((x) => typeof x === "number" && Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return null;
  const m = v.length >> 1;
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
};

function summarize(records) {
  const out = {};
  for (const r of records) {
    const s = (out[r.case] ??= {});
    (s[r.label] ??= []).push(r);
  }
  const summary = {};
  for (const [kase, per] of Object.entries(out)) {
    summary[kase] = {};
    for (const [label, rs] of Object.entries(per)) {
      const good = rs.filter((r) => r.ok);
      const col = (k) => good.map((r) => r[k]);
      const booted = rs.filter((r) => r.bootOk);
      const bcol = (k) => booted.map((r) => r[k]);
      const s = { samples: rs.length, ok: good.length, loadavg1m: median(rs.map((r) => r.loadavg1m)) };
      // Boot/restore metrics count every sample that reached the prompt; region metrics only
      // samples whose workload completed and verified.
      s.readyS = median(bcol("readyMs").map((x) => x / 1000));
      s.readyS_all = bcol("readyMs").map((x) => +(x / 1000).toFixed(3));
      if (kase.startsWith("busybox")) {
        s.bootMipsWall = median(bcol("bootMipsWall"));
        s.bootMipsExec = median(bcol("bootMipsExec"));
        s.bootRetired = median(bcol("retiredAtReady"));
        s.bootJitFraction = median(bcol("bootJitFraction"));
      }
      s.regionS = median(col("regionMs").map((x) => x / 1000));
      s.regionS_all = col("regionMs").map((x) => +(x / 1000).toFixed(3));
      s.mips = median(col("mips"));
      s.mipsExec = median(col("mipsExec"));
      s.retired = median(col("retired"));
      s.jitFraction = median(col("jitFraction"));
      // Per-rep headline values for paired (same-rep, back-to-back) ratios.
      s.byRep = Object.fromEntries(booted.map((r) => [String(r.rep), {
        readyS: r.readyMs != null ? r.readyMs / 1000 : null,
        bootMipsWall: r.bootMipsWall ?? null,
        bootMipsExec: r.bootMipsExec ?? null,
        regionS: r.ok && r.regionMs != null ? r.regionMs / 1000 : null,
        mips: r.ok ? r.mips ?? null : null,
      }]));
      summary[kase][label] = s;
    }
  }
  return summary;
}

function fmt(v, nd = 2) {
  return v == null ? "–" : typeof v === "number" ? v.toFixed(nd) : String(v);
}

function markdown(summary, labels, meta) {
  const base = labels[0];
  const others = labels.slice(1);
  const L = [];
  L.push(`# Browser benchmark (${meta.date})\n`);
  L.push(`Chromium ${meta.browserVersion} (headless=${meta.headless}) · ${meta.host.cpu} · samples=${meta.samples} · medians · interleaved=${labels.length > 1}\n`);
  for (const r of meta.roots) {
    L.push(`- **${r.label}**: \`${r.web}\` rev \`${(r.git?.rev || "?").slice(0, 10)}\`${r.git?.dirty ? " (+uncommitted changes)" : ""} wasm sha256 \`${r.wasmSha256.slice(0, 12)}\` (${(r.wasmBytes / 1e6).toFixed(2)} MB)`);
  }
  L.push("");
  L.push(`| case | metric | ${labels.join(" | ")}${others.map((o) => ` | speedup ${o} vs ${base}`).join("")} | ok |`);
  L.push(`|---|---|${labels.map(() => "---:|").join("")}${others.map(() => "---:|").join("")}---:|`);
  const row = (kase, metric, key, better, nd = 2) => {
    const per = summary[kase] ?? {};
    const vals = labels.map((l) => per[l]?.[key] ?? null);
    const cells = labels.map((l, i) => {
      const reps = Object.values(per[l]?.byRep ?? {}).map((x) => x[key]).filter((x) => typeof x === "number");
      return fmt(vals[i], nd) + (reps.length > 1 ? ` [${Math.min(...reps).toFixed(nd)}–${Math.max(...reps).toFixed(nd)}]` : "");
    });
    const sp = others.map((o, i) => {
      const a = vals[0], b = vals[i + 1];
      if (!a || !b) return "–";
      const ra = per[base]?.byRep ?? {}, rb = per[o]?.byRep ?? {};
      const pr = Object.keys(ra).filter((k) => ra[k]?.[key] && rb[k]?.[key])
        .map((k) => (better === "lower" ? ra[k][key] / rb[k][key] : rb[k][key] / ra[k][key]));
      const paired = pr.length > 1 ? ` (paired ${median(pr).toFixed(2)}x)` : "";
      return `${(better === "lower" ? a / b : b / a).toFixed(2)}x${paired}`;
    });
    const oks = labels.map((l) => `${per[l]?.ok ?? 0}/${per[l]?.samples ?? 0}`).join(" · ");
    return `| ${kase} | ${metric} | ${cells.join(" | ")}${sp.map((x) => ` | ${x}`).join("")} | ${oks} |`;
  };
  for (const kase of ALL_CASES) {
    if (!summary[kase]) continue;
    if (kase.startsWith("busybox")) {
      L.push(row(kase, "(a) cold boot: navigation -> shell prompt s", "readyS", "lower"));
      L.push(row(kase, "(a) boot MIPS (boot span, wall)", "bootMipsWall", "higher", 1));
      L.push(row(kase, "(a) boot MIPS (inside runChunk)", "bootMipsExec", "higher", 1));
      if (kase.endsWith("-jit")) L.push(row(kase, "(a) boot JIT-retired fraction", "bootJitFraction", "higher", 3));
      L.push(row(kase, `(b) shell loop x${meta.computeIters}: Enter -> done s`, "regionS", "lower"));
      L.push(row(kase, "(b) shell loop MIPS (wall)", "mips", "higher", 1));
      if (kase.endsWith("-jit")) L.push(row(kase, "(b) shell loop JIT-retired fraction", "jitFraction", "higher", 3));
    } else {
      L.push(row(kase, "(c) snapshot restore: navigation -> prompt s", "readyS", "lower"));
      L.push(row(kase, "(c) node -e script: Enter -> done s", "regionS", "lower"));
      L.push(row(kase, "(c) node -e MIPS (wall)", "mips", "higher", 1));
      if (kase.endsWith("-jit")) L.push(row(kase, "(c) node -e JIT-retired fraction", "jitFraction", "higher", 3));
    }
  }
  L.push("");
  L.push("Cells: median [min–max over samples]. Speedup = ratio of medians; 'paired' = median of the per-rep ratios (each A/B pair ran back to back).");
  L.push("");
  L.push("All times are host clock (page performance.now()); MIPS = worker retired-instruction counter delta / host time. " +
    "'boot span' runs from the page's guest-booting event (includes kernel fetch + worker/wasm start) to the prompt; " +
    "'inside runChunk' divides by the worker's summed slice time (excludes scheduler yields and idle).");
  L.push("");
  L.push(`Median 1-minute load average: ${Object.entries(summary).flatMap(([k, per]) => Object.entries(per).map(([l, s]) => `${k}/${l}=${fmt(s.loadavg1m, 1)}`)).join(", ")}\n`);
  return L.join("\n");
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    process.stdout.write(readFileSync(fileURLToPath(import.meta.url), "utf8").split("*/")[0]);
    return 0;
  }
  const roots = opts.roots.map(resolveRoot);
  const releasesDir = opts.releases ? path.resolve(opts.releases) : null;
  if (opts.cases.some((c) => c.startsWith("node"))) {
    const have = [releasesDir, path.join(REPO, "releases")].filter(Boolean)
      .some((d) => existsSync(path.join(d, "chunked-node-alpine", "manifest.json")));
    if (!have) {
      log("no chunked-node-alpine image under RELEASES — skipping node cases (set RELEASES to a checkout's releases/)");
      opts.cases = opts.cases.filter((c) => !c.startsWith("node"));
    }
  }
  const relForServer = releasesDir ?? path.join(REPO, "releases");
  await mkdir(opts.out, { recursive: true });
  const servers = new Map();
  for (const r of roots) servers.set(r.label, await startServer(r, relForServer));
  const { playwright, from } = loadPlaywright(roots);
  const launch = { headless: opts.headless };
  if (opts.chrome) launch.executablePath = opts.chrome;
  const browser = await playwright.chromium.launch(launch);
  const meta = {
    date: new Date().toISOString(),
    browserVersion: browser.version(),
    headless: opts.headless,
    playwrightFrom: from,
    samples: opts.samples,
    cases: opts.cases,
    computeIters: opts.computeIters,
    nodeScript: NODE_SCRIPT,
    nodeExpectedSum: NODE_EXPECTED_SUM,
    host: { cpu: os.cpus()[0]?.model, ncpu: os.cpus().length, platform: `${os.platform()} ${os.release()}`, hostname: os.hostname() },
    roots: roots.map((r) => ({ ...r, origin: servers.get(r.label).origin })),
  };
  const records = [];
  const save = async () => {
    const summary = summarize(records);
    await writeFile(path.join(opts.out, "browser.json"), `${JSON.stringify({ meta, summary, records }, null, 2)}\n`);
    await writeFile(path.join(opts.out, "browser.md"), markdown(summary, roots.map((r) => r.label), meta));
    return summary;
  };
  const t0 = performance.now();
  try {
    for (let rep = 0; rep < opts.samples; rep++) {
      for (const kase of opts.cases) {
        const order = rep % 2 === 0 ? roots : [...roots].reverse();
        for (const root of order) {
          const t = performance.now();
          const rec = await runSample(browser, root, servers.get(root.label), kase, rep, opts);
          records.push(rec);
          log(`${kase.padEnd(13)} ${root.label.padEnd(10)} rep ${rep}: ready ${fmt(rec.readyMs != null ? rec.readyMs / 1000 : null)} s` +
            `${kase.startsWith("busybox") ? ` (boot mips ${fmt(rec.bootMipsWall, 1)})` : ""}` +
            ` region ${fmt(rec.regionMs != null ? rec.regionMs / 1000 : null)} s mips ${fmt(rec.mips, 1)} ok=${rec.ok}` +
            `${rec.error ? ` error=${rec.error.slice(0, 160)}` : ""} (${((performance.now() - t) / 1000).toFixed(0)}s)`);
          await save();
        }
      }
    }
  } finally {
    meta.suiteWallS = (performance.now() - t0) / 1000;
    meta.requests = Object.fromEntries([...servers].map(([l, s]) => [l, { count: s.requests.count, bytes: s.requests.bytes, notFound: [...new Set(s.requests.notFound)].slice(0, 20) }]));
    await save();
    await browser.close().catch(() => {});
    for (const s of servers.values()) s.server.close();
  }
  process.stdout.write(readFileSync(path.join(opts.out, "browser.md"), "utf8"));
  const bad = records.filter((r) => !r.ok);
  if (bad.length) {
    log(`${bad.length} sample(s) failed: ${bad.map((r) => `${r.case}/${r.label}/${r.rep}`).join(", ")}`);
    return 1;
  }
  return 0;
}

main().then((code) => process.exit(code), (e) => {
  console.error(e);
  process.exit(2);
});
