---
id: E6-T11d74c
epic: 6
title: Restore RAM, disk and reconstructed GPU atomically in the production worker
priority: 525.0270383
status: in-progress
depends_on: [E6-T11d74b]
estimate: S
risk: high
capstone: false
---

## Boundary

Compose native checkpoint and renderer reconstruction with existing paired RAM
snapshot/disk-overlay coherence. Pause/quiesce without losing original pending
fences, release host inputs and bind schema/build/image/overlay/profile/digests.
Load an accelerated warm pair before guest execution in a fresh production
worker. Publish ready only after real scanout and new original submissions;
failed restore must not half-apply CPU/disk/GPU or silently select software.
Keep legacy software snapshots and explicit cold recovery compatible.

## Deterministic acceptance

`make verify-E6-T11d74c` records actual production-worker save/close/fresh-worker
restore with paired disk marker, native identity, clock rebase, new fenced GPU
frames, trusted keyboard and cursor movement. Test corrupt/mismatched/stale
pairs, lost context and unsupported qualification with explicit results. All
four software warm paths still restore and preserve their disk markers. Run
affected native/Wasm/browser gates and final exact-head pristine clone.

## Adversarial verification

Attack a torn publication between GPU/RAM/delta, concurrent save/restore,
context loss during checkpoint/reconstruction and late old-worker receipts.
Use varied schedules and remove one coherence/generation guard in isolation.
No changed snapshot or persistence boundary may be asserted on screenshots
alone; inspect original device state, outputs and commits.

## Verification log

### 2026-10-15 — worker — explicit accelerated warm-boot scope

The user's clarified goal is warm boot with GPU rendering. This is an ordered
implementation boundary of that request, not the cancelled software-default
workaround. Existing independent rendering/timekeeping proofs carry only across
unchanged code and dependency identities; new checkpoint behavior needs its own
recorded acceptance and fresh verifier.

### 2026-10-15 — worker — paired accelerated boundary started

Renderer74b is independently verified at1c1eca625ef139ed9248b956918ea3fe8bd7265c;
native74a at e26e3e83. Continue the existing native PR stack. The implementation
plan is recorded before code in
`target/evidence/production-gpu-warm-restore-plan01/paired-design.json`.
This boundary composes explicit native witness APIs, an actual COW disk snapshot,
a bounded compressed pair, genuine GPU capability compatibility, and staged fresh
worker reconstruction. Ordinary software restore paths stay under their existing
coherence guards. No production GPU warm-boot claim yet;74d publishes the final
actual Omarchy factory image and verifies public warm/repeat behavior.

### 2026-10-15 — worker — scale failures retained before freeze

The first original Omarchy run made268 original jobs/134 transfers and
548,864,000 DMA input bytes before its first3D draw. The bounded512MiB journal
correctly refused further capture (`journal budget exceeded`); rendering continued.
The negative observation is retained in
`target/evidence/production-gpu-paired-stock-cold01/report.json` and its original
heartbeat. A lossless, per-transfer32MiB-bounded word-run representation now
retains exact original DMA without raising the journal budget. The next original
run retained229,376,000 input bytes in a4,230,292-byte available journal before
being deliberately stopped for the independent RAM fix below.

An actual1024MiB production worker save succeeded but fresh restore trapped in
`loadAcceleratedSnapshotBlob` (large-self01). `Ram::restore` allocated a second
guest-sized growable Vec; its sparse high-address DTB caused a further geometric
reallocation within the wasm32 address space. Restore now validates the entire
unchanged sparse wire format before applying the same immutable input directly
to existing RAM. Six native RAM tests, including late malformed refusal against
nonzero destination bytes, pass. The actual1024MiB original-MMIO worker's
save/fresh-worker restore, new real draws/retirement, trusted keyboard, two native
cursor positions, exact saved clock, changed disk and repeat restore now pass
(`target/evidence/production-paired-worker-large-self02/report.json`), with
553.885ms first warm and603.505ms repeat in this small supervisor fixture. This
is not a Linux/Mesa/production-site latency claim. Omarchy cold03 is running on
runtime identity5dd286c9663c5740e1d26873c26e0ea81d1d32bf67b9c31c758842dbf23f3f09;
final frozen submission and independent verification remain required.
