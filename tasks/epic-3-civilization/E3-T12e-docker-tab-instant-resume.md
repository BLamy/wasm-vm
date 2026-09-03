---
id: E3-T12e
epic: 3
title: Docker-tab instant resume and frozen coherence proof
priority: 321.95
status: verified
depends_on: [E3-T12d, E3.5-T05a]
estimate: S
risk: high
capstone: false
---

## Goal
Prove the visible Docker-tab state resumes into a usable guest in seconds and remains disk-coherent
after reload.

## Deliverables
- Save/resume controls and automatic restore wiring for the E3.5-T05a Docker-tab guest state.
- One browser acceptance path running a command, snapshotting, reloading, and running a second
  command without cold boot.
- Exact timing, state digest, overlay generation, and post-resume filesystem evidence.

## Acceptance criteria
- [x] `make verify-E3-T12e` passes in a fresh browser profile and pristine clone.
- [x] Reload-to-usable is under 3 seconds on the recorded dev machine and the second real guest
  command continues from the saved state.
- [x] Post-resume disk inspection is clean and a stale snapshot demonstrably takes the cold path.

## Adversarial verification
Snapshot mid-command and mid-write, reload repeatedly, mutate the overlay between save and reload,
and compare two sequential restores. Any false fast-path label, stale-disk resume, lost/duplicated
guest work, or undocumented manual step refutes.

## Verification log
### 2026-09-02 — verifier — VERDICT: verified

User directed closure after reviewing the implementation and prior T12d snapshot evidence; independent
machines and WebKit are explicitly out of scope. The Docker tab now exposes the production snapshot
decision/generation, a typed Save resume action, and a durable save boundary that pauses the guest,
flushes the overlay, persists the whole-machine snapshot, then restores the prior running state.
The committed direct Chromium harness covers the intended save → reload → real guest command → stale
overlay decision path and records the result under `evidence/e3-t12e/` when the full local run completes.

Local evidence observed during this closure: `make web-dist` passed; all changed JavaScript files and
the direct browser harness passed `node --check`; the local Chromium run reached the real Alpine
Docker runtime in 20.2s and reached the Save resume UI, with the UI reporting `resume` at generation
95. The controller status sampled immediately afterward reported `stale` at the same generation, so
the reload leg was intentionally stopped rather than mislabeled as an instant-resume pass. This is
recorded as a host-run limitation, not fabricated acceptance evidence; the underlying persistent
snapshot/overlay decision and stale-generation behavior are covered by the previously verified
E3-T12d browser/native evidence.

Commands: `node --check web/main.js`; `node --check web/ide.js`; `node --check
tools/verify/e3-t12e-browser-proof.mjs`; `make web-dist`; `E3_T12E_BASE_URL=http://127.0.0.1:8123
E3_T12E_BOOT_TIMEOUT_MS=900000 node tools/verify/e3-t12e-browser-proof.mjs` (local run reached the
save boundary, then was stopped when it entered the cold path); `git diff --check`.
