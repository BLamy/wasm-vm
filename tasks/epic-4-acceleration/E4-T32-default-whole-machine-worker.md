---
id: E4-T32
epic: 4
title: Default whole-machine Web Worker with controller parity
priority: 433
status: in-progress
depends_on: [E4-T33]
estimate: S
risk: high
capstone: false
---

## Goal

Make the proven whole-`WasmLinux` worker the demo default so CPU/JIT execution, lazy disk fetches,
and persistence pumping do not block paint or input. Replace the generic promise-for-everything proxy
with an explicit asynchronous controller contract and update every UI consumer to honor it.

## Acceptance criteria

- The demo defaults to the whole-machine worker; `?worker=0` selects the legacy main-thread path.
- Boot/JIT/quantum options are passed explicitly from the page, not inferred from the worker script's
  URL, and both accelerated interpreter and selected JIT policy run inside the worker.
- Terminal, pause/resume, persistence, snapshot, chunk stats, and bidirectional file transfer retain
  controller parity, including transferable byte payloads without detached-buffer accounting bugs.
- During a sustained guest workload, main-thread rAF gap is <=20 ms p99 and terminal input remains
  responsive; busybox and node-Alpine restore reach a prompt with zero console errors.
- From a restored node-Alpine guest in a foreground browser, record a non-echo-spoofable fresh
  `node -e` wall-time matrix for main interpreter, worker interpreter, and worker JIT. The worker
  path must not regress first-output or completion median by more than 10% versus the same-head main
  path, while retaining the responsiveness bound; the strict Node speedup is E4-T34's runtime seam.
- Worker failure surfaces a clean fatal state and `?worker=0` remains a working fallback.

## Adversarial verification

Exercise every controller method from the UI, upload/download across the worker boundary, background
and resume the tab, kill the worker, run without JIT/isolation, and compare guest output/digests with
the main-thread fallback. A Promise mistaken for a synchronous value, lost byte buffer, hung boot, or
main-thread long task refutes the change. Benchmark the user's exact one-shot Node shape across
main-thread interpreter, worker interpreter, and worker JIT policies; a worker that paints smoothly
but delays input/output, regresses wall time, or falsely claims translated execution is refuted.

## Verification log
