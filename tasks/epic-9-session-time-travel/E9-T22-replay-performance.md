---
id: E9-T22
epic: 9
title: Measure recording storage and seek overhead on real guests
priority: 524.922
status: in-progress
depends_on: [E9-T15, E9-T16, E9-T18c, E9-T19]
estimate: S
risk: medium
capstone: false
---

## Goal

Prove the predeclared recording, storage-growth and seek budgets on software and GPU desktop workloads.

## Boundary

A repeatable equal-work benchmark and bounded regressions, using T01 fixture identities/reference environment. Measure with recording enabled/disabled and distinguish preview, checkpoint restore and replay-forward times.

## Acceptance criteria

- [ ] Publish raw repeated samples, p50/p95 latency, recording overhead, peak memory, bytes per minute and checkpoint cadence for pinned real workloads.
- [ ] Run the seeded seek workload across short and longer sessions, with cached and initial-load measurements reported separately; apply the unchanged T01 budgets.
- [ ] Changing a budget after a failed run requires an explicit revised contract and retains the failed evidence; no MIPS or instant-scrubbing claim follows from a thumbnail.

## Deterministic acceptance

`make verify-E9-T22`. This is a planned target to implement with this slice, not an existing passing command. It must record the assertions above and the risk-tier evidence required by AGENTS.md.

## Adversarial verification

Repeat with dirty RAM, sustained file/network traffic and GPU readback, using independent seeds. Keep first loads and unfavorable samples; fabricated idle-only wins or changed workload amounts refute.

## Verification log

### 2026-10-22 — worker — begin pinned real-workload measurements

E9-T21 is independently verified at `66d655d437fcb644a67f01dc5e9c23fe889edbeb`
and its actual main publication is independently verified at
`e872d93d26f752677f53d32c155c4981e76681a1`. Production deployment `58cada9e`
serves source `62936461529446c8c2f3f17f8a0c2185ee9b45fd`; native PR603 remains
open, draft and unmerged, with the final publication commit pushed. Actions
remain disabled. The performance branch continues that native stack.

This S slice owns one measurement boundary: the unchanged T01 equal-work
software and qualified GPU-desktop campaign, genuine recording-off/on A/B
samples, original fixed workload amounts and budgets, initial/cached preview,
restore, forward-seek and cancellation timings, peak additional recorder
memory and history growth. Literal files, entropy/HTTP bytes, architectural,
RAM/device/disk/clock/cursor witnesses and zero replay egress remain necessary.
The full real guest workloads and frozen EGL/GLES2 guest probe cannot be
replaced by idle or bare-MMIO fixtures. Raw unfavorable attempts and first
loads are retained; no timing or runtime qualification is claimed now.

The read-only preflight `target/evidence/e9-t22-reference-preflight.json`
confirms the M4 Max/16-core/128-GiB host, macOS26.6.2/25G83, Node24.20.0,
Rust1.96.0, Playwright1.49.1 and AC power. Installed Chrome is155.0.8059.85;
T01 records155.0.8059.80. Resolve that reference drift with an explicit
amendment before any timed campaign, preserving all numerical budgets,
seed17,100frames,10rewrites/1KiBHTTPresponses,20LCGseeks,10-minute observation
window and five alternating A/B pairs per profile. Qualification must retain
original asset/probe identities and explicitly document any supported-profile
amendment; do not coerce a legacy paced checkpoint into the pure-ICount exact
GPU profile. Risk remains medium for the benchmark/harness boundary; runtime
semantic work, if actually required, needs its proper risk and atomic proof
boundary before implementation.

Implement `make verify-E9-T22` as the complete deterministic acceptance, then
submit recorded risk-tier evidence and a fresh actual Daybreak adversarial
verifier. Only that verifier may set verified. E9-T23 and E9-T24 remain gated;
no Epic9 completion or performance claim follows from this activation.
