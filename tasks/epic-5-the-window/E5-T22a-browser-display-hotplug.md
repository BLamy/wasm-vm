---
id: E5-T22a
epic: 5
title: Expose bounded display hotplug and actual GPU state to browser controllers
priority: 522.1
status: verified
depends_on: [E5-T04, E5-T18e]
estimate: S
risk: high
capstone: false
---

## Goal

Connect the existing verified GPU display-info/EDID hotplug boundary to WasmLinux
and both browser controller paths, with bounded inputs and truthful device state.

## Boundary

Own the host-to-device API and its direct/whole-machine-worker transport only.
Viewport debounce, presentation policy and real compositor adoption remain T22b-d.
Do not report requested dimensions as a guest scanout mode.

## Deliverables

- Strict WasmLinux setDisplay(width, height), rejecting non-integer, non-finite,
  out-of-range and non-number dimensions before any mutation.
- displayStats reporting the advertised mode, EDID, pending event, actual resource
  count/bytes and actual scanout resource dimensions separately.
- Explicit direct and worker controller methods, with safe absent/stopped behavior.
- Browser-visible demonstration of the real bridge, labeled as host hotplug only.

## Acceptance criteria

- [x] Valid dimensions from 1 through the EDID limit update the advertised mode
      and EDID through the existing GPU boundary. Invalid dimensions do not
      partially mutate either dimension, event state or resources.
- [x] One thousand updates retain the final mode and existing config-event
      coalescing; old resource dimensions, content and allocation accounting stay
      unchanged until the guest explicitly changes them.
- [x] Stats describe the actual device resource map and bound scanout, never
      fabricate guest adoption from a host request. An absent device returns
      false/null; reentrant access returns a bounded error rather than panicking.
- [x] Both actual browser direct and module-worker controllers perform the same
      update/read sequence and reject invalid requests. Stopped controllers
      cannot mutate the device. The built demo runs 126/0 with zero errors.

## Verification command

make verify-E5-T22a

## Adversarial verification

Send fractional, NaN, infinities, strings, booleans, null, negative, zero and
oversized dimensions, including a valid first dimension and invalid second.
Retain a live old-size resource across a storm and inspect its pixels, dimensions
and byte count. Attack a missing GPU and nested RefCell borrow. Use one independent
odd-size sequence through the real worker transport. Sabotage the new acceptance
test once. Carry T04's unchanged transport semantics forward.

## Verification log

### 2026-09-06 — coordinator — in-progress

First ordered S replacement for E5-T22. T18e is independently verified. This
slice makes no compositor-resize or release-to-frame latency claim.

### 2026-09-06 — worker — implemented

Frozen runtime head: `8c3f4e14477292d329783d0eee7451a63d0644fe`.
Final proof/harness head: `179b8fd04e716a24a7b15091b3f7b0de0a356dfb`.
Final pristine clone: `/Users/blamy/Documents/Codex/e5-t22a-portable.JBfGod/repo`.
Scrubbed environment retains only the original HOME/PATH/TMPDIR.
Commands: `npm --prefix web ci --no-audit --no-fund && make verify-E5-T22a`.
Exit 0. Four WasmLinux tests cover invalid-value atomicity, old-resource
invariance, actual accounting, missing device, nested borrow and guest MMIO
observation. The trace at `evidence/e5-t22a/acceptance.log:814` retires LW from
0x10008100 into x10=1; state digest
`79535a41dc7da0934c91fc17c441210501714ba5b1d52fc243491a659676696e`.
Both actual browser controllers passed 1,003 valid updates plus 32 invalid
requests; final preferred mode 750x531, zero allocated resources and null
scanout, proving host request is not fabricated guest adoption. Stopped paths
cannot mutate. The visible diagnostic and built demo were captured, with
126 passed/0 failed and zero page/console/HTTP errors.

Evidence: `evidence/e5-t22a/browser-proof.json` SHA-256
`8596d057ec660e689d4d7ba5e8423a7e8e520e6ec46703052edcac7fc2a329d1`;
`acceptance.log` SHA-256
`410f8b337c5f2ddf76cd40da7e5318565a0ddf3b3fd2c4bc200ecebf243a4fae`.
Final deployed wasm bytes SHA-256
`563fb01ba0eb5bcfbf5de2b0f76471881f06f165aa0ff56380edc14acb9d05fc`.
See the evidence README for exact raw files and retained preliminary failures.

Submission gates: fmt and strict scoped native/wasm library lint passed; 267
core tests, scoped wasm tests, feature builds, native ISA 127/127 and performance
55.4 MIPS passed. Full make ci was attempted, not claimed green: unchanged
all-feature dead code, Linux-only workspace compilation, unchanged normal-wasm
input-queue fixture, historical zicsr-stub cursor test and test-only
determinism-static warnings are recorded separately.
The initial cold-clone missing deploy-staged manifest was a proof portability
gap; only the harness was corrected and a new pristine clone passed. Runtime
semantics did not change after the frozen head. Production remains deferred to
the user's Epic 5 merge and Omarchy milestone.

### 2026-09-06 — fresh verifier — VERDICT: verified

- P1/P2 HELD: strict atomic validation and old-resource invariance at
  `evidence/e5-t22a/acceptance.log:808-812`; executed assertions preserve
  resource 17 at 7x5, 140 bytes and identical pixels through 1,000 updates.
  T04 unchanged coalescing tests pass at lines 90-93.
- P3 HELD: absent GPU and both nested RefCell boundaries return bounded errors
  or false/null, at `acceptance.log:819-822`; independent stats-error recovery
  is recorded in `verifier/coverage-result.json`.
- P4/P6 HELD: actual direct and module-worker paths each pass 1,003 updates
  and 32 invalid requests, stopped requests cannot mutate, and built demo
  is 126/0 with zero errors (`acceptance.log:859`, `browser-proof.json`).
  Independently exercised active main-page wrappers and direct diagnostic UI.
- P5 HELD: `acceptance.log:816` reads MMIO 0x10008100 into x10=1;
  line 817 digest `79535a41dc7da0934c91fc17c441210501714ba5b1d52fc243491a659676696e`.
- P7 HELD for scoped proof: final clean clone is exact `179b8fd0`; verified
  browser/source/wasm/screenshot hashes and all 2,006 EDID samples.
  `verifier/final-audit.json` records the independent audit. Full make ci is
  not green; unchanged baseline failures remain explicitly carried.
- A1/S1 HELD: independent seed `0x22a5c019` passes 65 odd worker modes with
  invalid interleaving, EDID copy and stopped checks. Served no-op setter
  sabotage makes the final acceptance harness fail at `1280 !== 1367`.
  See `verifier/odd-mode-result.json` and `verifier/sabotage.log:7`.
- COVERAGE/SUITE: every hunk is mapped in `verifier/coverage.md`; full
  predictions, citations, digests and retained deterministic proof artifacts
  are in `verifier/report.md`. Retain the four WasmLinux tests, acceptance
  target and verifier scripts. Host boundary only; T22b-d remain pending.

Correction to worker summary: normal wasm tests did NOT all pass.
`regression.log:603-662` records unchanged `input_queues.rs:91` observing
EV_SYN/0/0 instead of EV_KEY/30/1. Its input/MMIO/queue code, test, lockfile and
manifest are byte-identical to parent and never invoke this patch's API.
This joins the grounded all-feature lint, Linux-on-Mac, zicsr-stub cursor and
test-only static determinism baseline failures under the no-fire rule.
The scoped final acceptance and all independent hotplug predictions held.

Commands: `node evidence/e5-t22a/verifier/attack.mjs`, final-harness
`--sabotage-only`, `node evidence/e5-t22a/verifier/coverage.mjs`, and
`node evidence/e5-t22a/verifier/audit-final.mjs`. No implementation, merge or
deployment changes were made by this verifier.
