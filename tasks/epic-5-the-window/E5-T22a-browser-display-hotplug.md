---
id: E5-T22a
epic: 5
title: Expose bounded display hotplug and actual GPU state to browser controllers
priority: 522.1
status: implemented
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

- [ ] Valid dimensions from 1 through the EDID limit update the advertised mode
      and EDID through the existing GPU boundary. Invalid dimensions do not
      partially mutate either dimension, event state or resources.
- [ ] One thousand updates retain the final mode and existing config-event
      coalescing; old resource dimensions, content and allocation accounting stay
      unchanged until the guest explicitly changes them.
- [ ] Stats describe the actual device resource map and bound scanout, never
      fabricate guest adoption from a host request. An absent device returns
      false/null; reentrant access returns a bounded error rather than panicking.
- [ ] Both actual browser direct and module-worker controllers perform the same
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
core tests, normal wasm tests, feature builds, native ISA 127/127 and performance
55.4 MIPS passed. Full make ci was attempted, not claimed green: unchanged
all-feature dead code, Linux-only workspace compilation, historical zicsr-stub
cursor test and test-only determinism-static warnings are recorded separately.
The initial cold-clone missing deploy-staged manifest was a proof portability
gap; only the harness was corrected and a new pristine clone passed. Runtime
semantics did not change after the frozen head. Production remains deferred to
the user's Epic 5 merge and Omarchy milestone.
