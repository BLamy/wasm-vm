---
id: E9-T22c
epic: 9
title: Qualify both full pinned performance workloads
priority: 524.92203
status: in-progress
depends_on: [E9-T22b]
estimate: S
risk: medium
capstone: false
---

## Goal

Qualify the unchanged real software and hardware GPU desktop workloads before timing.

## Boundary

One qualification harness and explicit reference/profile receipts. Reuse the
original software kernel/rootfs and GPU kernel/chunked-image/probe source pins.
Retain the old reference and every development failure. Explicitly document any
necessary supported-profile amendment before timing; never coerce a legacy
paced checkpoint or relabel a software renderer. Runtime semantic changes must
be their own prerequisite, not hidden in this harness task.

## Acceptance criteria

- [ ] Complete the frozen full Alpine workload with literal before/after bytes, real RTC/entropy receipts, 100 exact scheduled inputs, ten rewrites and ten counted 1 KiB HTTP responses.
- [ ] Boot the real Omarchy desktop in the accepted exact profile, compile the original frozen probe for RV64 against its qualified EGL/GLES libraries, execute it inside that guest and retain hardware GL_RENDERER, GL_ERROR0 and the complete red readback. Exercise the frozen viewport sequence.
- [ ] Prove both full recordings reopen/replay with complete architectural, RAM, device, disk, clock, pending/cursor, literal file/entropy/HTTP and GPU witnesses; zero live replay egress. Do not substitute tiny Linux, idle or bare-MMIO GPU fixtures.
- [ ] Seal executable source/asset/compiler/binary/renderer/reference receipts before the later timed campaign. Obtain a fresh actual Daybreak qualification verdict with one bounded novel attack; no performance/budget claim belongs here.

## Deterministic acceptance

`make verify-E9-T22c`. Planned target for full real-workload qualification and
affected harness/build/browser proof. The original development setup prefix
and frozen GPU probe cross-build are inputs to inspect, not passing acceptance.

## Adversarial verification

Corrupt an unrequested base chunk, vary workload seeds, dirty RAM/files,
sustained real HTTP and GPU readback. Independently read snapshots/filesystems
and count live server calls. Refuse software renderer or changed probe/assets,
missing GL results, hidden live replay I/O and an incomplete long recording.

## Verification log

### 2026-10-22 — worker — begin complete real-workload qualification

Activated only after fresh actual Daybreak verified E9-T22b at
`8b99d05a0e5b3ee23198e72ea9d4d324eb3e8744`, including actual main deployment
`a14eb837` / release `3efeff9dd069d94c3577cefd4eb9439870ef32d3`.
The native branch `codex/e9-real-workload-qualification` is the next layer;
all 29 preceding PRs remain open/unmerged/unqueued. This task alone occupies
the active lane. Risk is medium for the qualification harness/reference
boundary; no runtime semantic change is included.

A preparatory fresh actual Daybreak read-only design audit is retained at
`target/evidence/e9-t22c-daybreak-design/final-message.md`, SHA-256
`b60fed572468ef464510251985c058edc1f1cd06d765875de1c85dc876c80768`.
It establishes no acceptance verdict. Compose the genuine full-Alpine owned
HTTP path with a sealed absolute-transition scheduler and complete journal;
boot the original full Omarchy kernel/chunk manifest in fresh 1 GiB pure
ICount/64, use the production physical renderer, transfer/execute the original
RV64 EGL/GLES probe and verify both adopted viewports. Reopen both stores and
replay from their actual initial frames through the complete histories, with
full state/files/source/network/GPU witnesses and zero replay egress.

Seal original source/asset/compiler/library/ELF/renderer identities and explicit
profile receipts before execution/timing. Preserve the original Chrome .80
reference and existing .85 amendment, all workload amounts, all numeric budgets,
and every failed attempt. The pinned Omarchy manifest is authoritative (12 GiB
base, distinct from 1 GiB RAM); do not substitute a different base for stale
4 GiB prose. Keep setup, exactly 100 scheduled UART deliveries, and auxiliary
GPU controls separate and seal the exact payloads/origin. No performance claim
belongs in this task.

The 4096-receipt/64 MiB GPU inspection window is an immediate capacity risk to
check against the real boot. If it or another runtime boundary prevents the
full qualification, retain the exact repro and create an ordered prerequisite;
do not hide semantic fixes, raise constants in a harness, truncate history,
begin after boot, reuse a paced warm pair, or label a software renderer GPU.
A fresh actual Daybreak critic must independently audit the complete frozen
proof and apply one bounded novel attack before marking verified. T22d, T23
and T24 remain required, and no merge is authorized.


### 2026-10-22 — worker — qualification input preparation (development only)

Adds the exact frozen schedule serializer, absolute-u64-coordinate checks,
accepted-offer validator and a disjoint byte-identified ledger for every UART
producer. The immutable input helper authenticates original manifests/kernels,
the complete Alpine raw base, and every materialized cached desktop chunk,
including unused local cache members. It preserves the original 12 GiB desktop
base, reference amendment and all numeric budgets. This is input preparation;
`make verify-E9-T22c` and the two complete qualifying workloads are not yet
implemented or accepted.

`node --test tools/verify/e9-workload-schedule.test.mjs
 tools/verify/e9-workload-assets.test.mjs` passes six direct tests; the latest
log is `target/evidence/e9-t22c-direct-harness-development-2.log`.
`target/evidence/e9-t22c-assets-development-1.json` separately retains the
original source-asset loader self-check (before the later ledger clarification).
The original negative-test fixture failure is preserved: an aliased
`Buffer.slice` changed the expected filename when corrupting its body; the
helper correctly failed closed. An independent copy fixed the test fixture.
No runtime or acceptance result was relabelled.

The fresh actual Daybreak bootstrap source audit is retained at
`target/evidence/e9-t22c-daybreak-bootstrap/final-message.md`, SHA-256
`f7fd3c1fd531a5142132a42cd052c3d8780f12dbf06d8eb45e9dc6ec177399ef`.
It proved missing production-terminal replies in the diagnostic page, the need
for complete input-ledger partitioning, and that the current journal's lifetime
limits do not reset at keyframes. It confirmed first real pending TX is a valid
provider-open boundary: the emulated net device advertises no carrier-status
feature, so the hub's initial link field is not guest carrier-down. This is a
source audit, not a task verdict or an accepted runtime failure.

Development attempts remain preserved separately. Attempt 1 was operator-stopped
because the driver flushed every small batch and repeatedly authenticated the
whole stored closure. Attempt 2 reached original Omarchy userspace and captured
partial native/renderer state, but its Node parent exhausted its default heap
while handling large numeric-byte-array/trace transfers; no complete report,
trace or store export exists. Its raw files, OOM log, later STOP chronology and
own-orphan-browser shutdown are retained under
`target/evidence/e9-t22c-desktop-development-2/` and the adjacent log. Those facts
do not establish a production-workload capacity verdict. Attempt 3 uses the
actual pinned production terminal bridge, records its responses separately,
streams raw receipt sidecars instead of returning large arrays, and keeps
screenshots/source/action traces with network snapshots disabled. It is a new
run, not a patch to either earlier attempt. It remains development only.

Next: finish the genuine corrected bootstrap and full software/desktop workloads,
seal the RV64 original-probe/compiler/guest-library/renderer receipts, prove all
literal and full-state witnesses through beginning-to-end offline replay, then
freeze the medium-risk submission for a fresh actual Daybreak critic. Correct
checkpoint scheduling must stay within the original 50M gap; do not silently
accept a late capture. Any actual runtime prerequisite must be its own ordered
task, never a harness limit change or a shortened history. All PRs stay open.
