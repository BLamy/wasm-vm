#!/usr/bin/env node
// E4-T23 adversarial #5 — placement audit. A worker-side device class that reaches for a
// main-thread-only API (DOM / document / window / IndexedDB / OPFS-via-main / xterm) is a hidden
// cross-thread dependency that REFUTES the split-device architecture doc (docs/worker-devices.md).
// This static audit greps the worker-side device sources for those APIs and FAILS (exit 1) on a hit.
//
// Wire into CI: `node tools/worker-device-audit.mjs` (Makefile target web-test-cpu-worker).
//
// Scope: the modules that run INSIDE the CPU worker or define worker-local device logic. The
// main-thread server (MainDeviceServer) legitimately touches backends, so its main-thread-only calls
// are matched to an allow-list of symbols that are only ever constructed on the main thread.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");

// Files whose code runs (or is imported) on the CPU WORKER thread. These must be free of
// main-thread-only APIs outside of clearly main-thread-only classes.
const WORKER_FILES = ["web/cpu-worker.js", "web/cpu-control-block.js", "web/device-proxy.js"];

// Main-thread-only globals/APIs that must NEVER be reachable from worker-side device code.
// (`self` and `WorkerGlobalScope` ARE legal in a worker; they are deliberately absent here.)
const FORBIDDEN = [
  /\bdocument\b/,
  /\bwindow\b/,
  /\bindexedDB\b/,
  /\blocalStorage\b/,
  /\bsessionStorage\b/,
  /\bnavigator\.storage\b/, // OPFS root is reached from a dedicated I/O worker, not device code
  /\bTerminal\b/, // xterm.js
  /\brequestAnimationFrame\b/,
  /\bHTMLElement\b/,
];

// Classes/functions in device-proxy.js that RUN ONLY on the main thread — their bodies may name
// backends but are never constructed worker-side. The audit skips forbidden matches inside them.
const MAIN_ONLY_BLOCKS = ["class MainDeviceServer"];

let failures = 0;

for (const rel of WORKER_FILES) {
  const path = join(ROOT, rel);
  let src;
  try {
    src = readFileSync(path, "utf8");
  } catch {
    console.error(`AUDIT: cannot read ${rel}`);
    failures++;
    continue;
  }
  const lines = src.split("\n");
  // Precompute main-only class line ranges (a class body ends at the next top-level `}`  at col 0).
  const mainRanges = [];
  for (const marker of MAIN_ONLY_BLOCKS) {
    const start = lines.findIndex((l) => l.includes(marker));
    if (start < 0) continue;
    let end = lines.length;
    for (let i = start + 1; i < lines.length; i++) {
      if (lines[i] === "}") {
        end = i;
        break;
      }
    }
    mainRanges.push([start, end]);
  }
  const inMainOnly = (i) => mainRanges.some(([s, e]) => i >= s && i <= e);

  lines.forEach((line, i) => {
    // Skip comments and the audit's own allow-list documentation.
    const code = line.replace(/\/\/.*$/, "");
    if (inMainOnly(i)) return;
    for (const pat of FORBIDDEN) {
      if (pat.test(code)) {
        console.error(`AUDIT FAIL: ${rel}:${i + 1} worker-side code touches ${pat} → ${line.trim()}`);
        failures++;
      }
    }
  });
}

if (failures > 0) {
  console.error(`\nplacement audit FAILED: ${failures} hidden main-thread dependency(ies)`);
  process.exit(1);
}
console.log(`placement audit OK: ${WORKER_FILES.length} worker-side files clean of main-thread-only APIs`);
