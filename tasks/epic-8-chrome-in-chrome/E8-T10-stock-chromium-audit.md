---
id: E8-T10
epic: 8
title: Stock-Chromium audit — prove determinism lives in the VM, not in the browser
priority: 810
status: cancelled
depends_on: [E8-T02]
estimate: S
capstone: false
---

> **CANCELLED 2026-07-06** (Brett's direction): Epic 8 "Chrome in Chrome" is cancelled as a
> goal. Superseded in spirit by **Epic 3.5 — OCI Workloads in the Browser**
> (`tasks/epic-3.5-oci-workloads/`): real container workloads are the payoff instead of a
> nested browser. The Layer-G record/replay ideas in E8-T03..T09 may be resurrected as their
> own epic later if VM time-travel becomes a goal again.

## Goal
Certify the design invariant that defines this epic: **the Chromium being recorded is stock and
unmodified; all determinism/record/replay lives in the VM around it.** This is explicitly *not*
Replay.io's instrumented browser-in-browser — there is no Chromium fork, no injected
recording/devtools instrumentation. The VM's determinism replaces browser-side instrumentation.

## Context
This is an audit/attestation task, not new machinery. Take the running browser from E8-T02 and the
record/replay stack (E8-T04/T05) and prove, in writing and in tests, that: (1) the chromium-riscv64
binary is byte-identical to the stock upstream/distro build (E8-T01 provenance), (2) nothing in the
record/replay path modifies, instruments, or cooperates with Chromium — it observes only at the VM
boundary (devices, interrupts, memory, clock), (3) the same stock binary a user would download is
the one made time-travelable. Contrast documented against Replay.io's approach to make the design
call unambiguous for future contributors.

## Deliverables
- `docs/determinism/stock-chromium.md`: the attestation — binary provenance, the boundary-only
  observation argument, and an explicit contrast with browser-instrumentation approaches.
- A test asserting the running binary's hash equals the E8-T01 stock artifact, and that no
  Chromium flags/env enabling special recording instrumentation are in use.
- A grep/scan check for instrumentation markers, wired into CI as a guard against regression.

## Acceptance criteria
- [ ] The running browser binary is provably the stock E8-T01 artifact (hash match at runtime via
      `/proc/PID/exe`); zero local patches; no recording-specific Chromium build flags.
- [ ] Record/replay demonstrably touches nothing inside Chromium (it operates only on VM-boundary
      state); the attestation doc makes the stock-vs-instrumented distinction explicit.

## Adversarial verification
Attempt to find *any* Chromium-side dependency in the record/replay path — a hook, a flag, a
cooperating agent inside the guest browser; any found refutes the "stock" claim. Swap the browser
binary for a freshly-downloaded identical stock build and confirm record/replay works unchanged
(if it needed a special build, it isn't stock). Confirm the CI marker scan fails if someone later
introduces an instrumented build. Verify the attestation's provenance chain independently against
upstream.

## Verification log
(empty)
