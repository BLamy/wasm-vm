---
id: E4-T22d
epic: 4
title: Imported-memory CPU worker bootstrap and sliced dispatch
priority: 422.4
status: in-progress
depends_on: [E4-T22c]
estimate: S
risk: high
capstone: false
---

## Goal

Boot the interpreter/JIT dispatch loop on a dedicated module worker using the imported shared wasm
memory and control block, with an explicit ready/halted/fatal handshake and bounded slices that can
park for WFI.

## Context

`cpu-worker.js` and `cpu-worker-host.js` currently describe the intended seam, but the raw shared
module, generated glue, and dispatch export must agree on one instance and one memory. This task
closes that ABI boundary without pulling DOM or device ownership into the worker.

## Deliverables

- Worker bootstrap accepting a cloned module or URL, importing the caller's shared memory, and
  returning a typed ready/fatal result.
- `run_slice`/equivalent bounded dispatch export, halt propagation, WFI park, and clean terminate.
- A deterministic worker fixture/spec that proves the worker sees the same memory bytes as its host.

## Acceptance criteria

- `node --test web/tests/e4-t22-worker-bootstrap.test.mjs` (added in this task) passes from a clean
  checkout, covering boot handshake, shared-memory identity, one guest slice, WFI wake, halt, and
  worker error propagation.
- No DOM, xterm, IndexedDB, or main-thread-only API is reachable from the worker dispatch path.
- A missing dispatch export and a killed worker produce a bounded fatal result rather than a hung
  promise or a half-ready controller.

## Adversarial verification

Send a malformed boot message, a non-shareable memory, a duplicate boot, a spurious wake, and a
worker termination during a slice. Verify that the host observes one terminal state and never
continues using a stale instance.

## Verification log
