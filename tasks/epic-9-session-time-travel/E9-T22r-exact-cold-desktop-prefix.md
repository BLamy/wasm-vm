---
id: E9-T22r
epic: 9
title: Record an exact-format cold Omarchy first-frame prefix
priority: 524.92202975
status: implemented
depends_on: [E9-T22q]
estimate: S
risk: medium
capstone: false
---

## Goal

Replace the old 20B cold prefix whose GPU notification latches were omitted
from every exact checkpoint. Retain a fresh original-cold recording with the
corrected format through the first real nonblank desktop frame, or a bounded
failure frontier.

## Boundary

One fresh browser recording of the same pinned Omarchy image, kernel,
bootargs, renderer, service-file setup, ICount/64 clock and 50M checkpoint
cadence. This is a diagnostic prefix, not the full C workload or its probe;
it cannot qualify timing. Stop at the first real desktop frame or a declared
finite upper bound with resource preflight. Preserve the old graph as evidence.
If a live HostSpace admission safely stops an already recorded cold prefix,
its last durable checkpoint may become an explicit resource frontier only
through a separate recovery run that proves the original graph unchanged,
finishes the existing witness without stepping the source VM, and replays two
adjacent windows. The source failure and guest errors remain visible; recovery
must never be represented as a first desktop frame or a completed cold run.
If the host browser auto-updated after the source capture, record both exact
versions and require the cloned profile's original manifest and retention
counters to match the exported graph before sealing or replay.

## Acceptance criteria

- [ ] Before starting any new cold capture, calculate a finite guest-transition,
  host-wall, quota and free-disk budget from the old 20B run's measured rate
  and 9.65 GiB storage, with explicit safety headroom for the live profile
  **plus** a complete export. Refuse a new run that cannot fit. Document the
  earlier underadmitted capture as a failed source, not a passing preflight.
- [ ] Record the original cold guest in a fresh browser context. Retain the
  new exact GPU checkpoint format, every 50M witness and physical graph, and
  first nonblank frame plus guest session/process proof if it appears. If the
  cap is reached first, retain an exact failure frontier.
- [ ] Authenticate the saved graph and replay at least the last two adjacent
  checkpoint windows to matching witnesses with zero live egress. A fresh
  Daybreak critic checks source pins, latch witness fidelity and frame evidence.
  For a HostSpace frontier, prove that the recovery changed only the finished
  witness flag and session revision, that all original CAS objects and chunks
  remain byte-identical, and that the reported frontier is the last durable
  checkpoint before the recorded HostSpace failure.

## Deterministic acceptance

`make verify-E9-T22r` at a frozen exact head for a new capture. For the
preserved 2026-10-26 resource frontier, run
`E9_SOURCE=target/evidence/e9-t22r-720f53afe/desktop make verify-E9-T22r-recovery`
at a frozen recovery head. The recovery report must pin the original
`720f53afe` execution and its immutable failed report and exported graph.

## Adversarial verification

Swap a checkpoint's latch byte, remove an unrequested RAM-delta chunk, alter a
physical renderer epoch, and misclassify a compositor process as visible pixels.
Reject reusing the old v2 graph or a warm-start boot as the new prefix.

## Verification log

### 2026-10-26 — worker — necessity established

The old 20B graph's original GPU control shadow stayed `last_avail=used=452`
from cold-395 through cold-399, while guest RAM's control avail index was
`579` in every one of those five checkpoints. Its cursor queue was `0/0`
with RAM avail index `0`. The physical objects and sparse-RAM ancestry were
SHA-256 checked while extracting those ring values. The 127 published but
unserviced control descriptors make the old v2 checkpoint's missing
QueueNotify latch behaviorally decisive. Forced rearm consumed one of them in
the independently observed replay at 19.85B. A guessed latch value cannot
authenticate an exact continuation, so the calibration task needs a newly
recorded source prefix after E9-T22q lands.

### 2026-10-27 — worker — failed cold capture retained, capacity model corrected

The fresh exact-format cold capture at `720f53afe` reached a durable 21.7B
checkpoint (435 total including origin) before the live HostSpace guard refused
the next write at 21.75B. The source browser report remains `failed`; it has no
final witness or replay. Its exported graph has 3,523/3,523 reachable objects,
13,177 hashed chunks and 435 witness pages, but the commitment says
`finished:false` (`target/evidence/e9-t22r-720f53afe/desktop/`). The old
admission reserved the larger of profile and export projections instead of
their sum, so the 36.34 GB initial free space was under the corrected 46+ GB
requirement. The console also reports guest `vda` buffer I/O errors. This
attempt is diagnostic source evidence only; the recovery target must seal the
last durable 21.7B witness, authenticate and replay it without a new cold
boot. A future fresh capture now refuses insufficient disk before launch.

### 2026-10-27 — worker — recovered exact cold HostSpace frontier submitted

At frozen code head `b481f6c71901c2859afc5f79496f9f374a3ae00d`, ran
`E9_SOURCE=target/evidence/e9-t22r-720f53afe/desktop E9_OUT=target/evidence/e9-t22r-recovery-b481f6c71 make verify-E9-T22r-recovery`.
The target passed six preflight tests, `cargo fmt --all --check`, the built-web
check, browser recovery, retained closure and the independent Python byte
oracle (`target/evidence/e9-t22r-recovery-b481f6c71/`). The source failed
capture remains pinned to `720f53afe0153a2425e4f01a607ab16c5705fa6b`:
HostSpace refused the 21.75B write after the last durable 21.7B checkpoint.
The original source-tree digest stayed
`bddc8591d832993ad0f612a4cf1cc6ff1efb2e7534ac3350060c2330811e3f31`
before and after recovery. The cloned Chrome profile matched the exported
manifest and retention counters despite the recorded Chrome 155-to-156 host
version change. Sealing executed zero guest steps and changed only the witness
`finished` flag and session revision; payload bytes, all 3,523 objects and
13,177 chunks stayed unchanged.

The source-pinned public controller replayed cold-431 at 21.6B to cold-432
at 21.65B (`4252975a74f0aa73c645f1581be5acb7d7913268bf4cd83ad30464006d617196`).
The source-pinned production worker replayed the same full anchor through
the next adjacent window to cold-433 at 21.7B
(`0602661729d65d93fc4b88053f148b45b336b3f9727efe44c1edaf2a826a10d8`);
the final result reports two windows and `wholeChain:true`. Both saved raw
states, GPU notification latches `[0,0]`, host queues and physical renderer
artifacts are retained. Profile, contents, non-epoch logical fields and all
1,242 original renderer frames match; replay adds exactly one authenticated
epoch/scanout rebase. Browser errors, blocked requests and replay egress were
zero, and worker provider entries were zero. The trace is
`desktop/browser-trace.zip`; the recovered report SHA-256 is
`0d2d37842f96a7d9b203a420d6debec108f982322a562838605c56d2b74ab17f`;
the closure report SHA-256 is
`81fbecf6c138652d5cf533cd32fbe576c1f4133562864e395664f76cf28f6677`;
the byte-oracle report SHA-256 is
`bf77383a441d5c0edf5d3959852126c99b266ae9eaf5cc713d1cf7c67caaf3c5`.
The source had no nonblank desktop-frame evidence and reported guest `vda`
write errors. This is a bounded HostSpace frontier, not a desktop boot or a
delta-origin public-controller seek. A separate Daybreak diagnostic of the
earlier overly strict renderer oracle is retained in
`target/evidence/e9-t22r-daybreak-renderer-a5792e4d1b/`; the final fresh
verifier must interrogate this submitted exact-head evidence.
