---
id: E9-T22
epic: 9
title: Measure recording storage and seek overhead on real guests
priority: 524.922
status: cancelled
depends_on: [E9-T15, E9-T16, E9-T18c, E9-T19]
estimate: S
risk: medium
capstone: false
decomposed_into: [E9-T22a, E9-T22b, E9-T22e, E9-T22i, E9-T22f, E9-T22g, E9-T22h, E9-T22c, E9-T22d]
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

### 2026-10-22 — worker — explicit runtime prerequisites discovered

This planning container is replaced by ordered S slices E9-T22a, E9-T22b,
E9-T22c and E9-T22d. E9-T23/T24 now depend on E9-T22d. The original complete
performance acceptance, numerical budgets and workload amounts remain required;
this cancellation is a decomposition, not completion or a scope reduction.

The fresh actual Daybreak read-only audit completed on the requested
`gpt-daybreak-blue-latest` / `daybreakBlue` route without service errors:
`target/evidence/e9-t22-daybreak-design-1/final-message.md`, SHA-256
`e9e596f914e0ed5ab7737f482a59d149dd340e3255cf2c87313c2bff5cd814b9`.
It found no faithful current recording-OFF mode and no complete exact full-guest
HTTP route to the frozen `10.0.2.2:9191`. Ordinary factory substitution and
skipping IndexedDB writes cannot supply the missing control. These runtime and
provider changes are high-risk prerequisites, outside a medium-risk benchmark
harness. They need separate recorded proof and fresh Daybreak verification.

The original offline qualification attempt is preserved, including the gaps
Daybreak identified. Corrected development receipt
`target/evidence/e9-t22-alpine-qualification-2/report.json` has SHA-256
`ae3a443103a7749f524709a1b9942aa4d2dc4eca1fdb9065fbd7ee7310e6e171`.
It hashes the complete original rootfs and boot manifest, bounds console bytes,
retains and reopens all RTC/entropy source receipts, and explicitly labels the
artifact an offline setup prefix. The direct native-COW filesystem oracle
`filesystem-oracle/report.json` has SHA-256
`e029785e8da3d4b496e92a8e618f30733a8b68207fdede8a77b05ef091d0be5b`;
it recovers only owned scratch filesystem copies and reads the literal frozen
before/after bytes at their original captured positions. Reading the original
snapshots avoids modifying the frozen guest setup with extra shell commands.
These remain worker development prechecks, not a final independent verdict or
T22 performance acceptance.

`docs/design/session-replay-performance-reference-v1.json` explicitly records
the browser patch amendment before timing; all original amounts/budgets and
asset pins are retained. The unchanged frozen GPU probe cross-compiled in the
existing reference container to RV64 ELF SHA-256
`3080482f8bd8749f8947371d762570dcf699da00b952887c8eb1449a3652e213`.
Its real desktop execution/renderer qualification remains required by T22c.


### 2026-10-22 — worker — long-history runtime boundaries

A fresh actual Daybreak audit of the corrected original cold Omarchy run
proved the production journal lifetime bound rejects the 702nd receipt,
before the desktop/workload. The full authenticated report and exact repro
are recorded in E9-T22c. Add ordered high-risk S prerequisites E9-T22e/f/g/h
for bounded durable publication, authenticated reading, exact replay windows
and browser integration. This preserves all C/D requirements and numerical
budgets; it does not complete the parent or qualify a shortened workload.


### 2026-10-22 — worker — bounded witness commitment prerequisite

A fresh Daybreak audit recovered authentic checkpoint witnesses and reproduced
an 8192-byte extension failure in the real session validator without another
VM run. E9-T22i now follows E and precedes F; C's exact repro and report hashes
are in its log. This adds the observed durable witness boundary, preserving
all original C/D requirements and numerical budgets.
