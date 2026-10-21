---
id: E9-T18c
epic: 9
title: Replay durable GPU session results through the real browser bridge
priority: 524.9183
status: implemented
depends_on: [E9-T18b, E9-T17, E9-T09, E9-T14]
estimate: S
risk: high
capstone: false
---

## Goal

Complete E9-T18's graphics nondeterminism adapter in the admitted Wasm profile.

## Boundary

Connect the accepted native result/pending boundary to the real production GPU
transport, durable session tape and replay controller. Preserve exact guest
results separately from physical rendering witnesses. Full desktop performance
and final product integration remain required by E9-T22/E9-T24.

## Acceptance criteria

- [ ] Record every admitted guest-visible result, shared-memory write and
  query/error/fence completion in bounded durable history. Reopen and replay exact
  bytes/order, including genuine pending work across a keyframe, using the
  existing version/identity and committed-prefix rules.
- [ ] An actual RV64 GPU workload through the production Wasm/physical GPU bridge
  produces matching replay CPU/RAM/device/disk/result witnesses and documented
  physical scanout. Vary live GPU results/timing during replay; no physical
  cross-GPU bit-identical pixel claim or software/canned-frame substitution.
- [ ] Missing/corrupt results, unsupported host/build/clock profiles, context loss
  and authentic stale replies after seek resolve explicitly without live result
  substitution, stranded fences, corruption of the original or replay egress.
  T17 paced-on-keyboard sessions remain checkpoints-only unless their exact clock
  policy is admitted; do not rewrite authenticated configuration or the T01
  unsupported-clock/performance contract.

## Deterministic acceptance

`make verify-E9-T18c` (and final aggregate `make verify-E9-T18`). Implement the
bounded real hardware-browser acceptance, retained raw results/keyframes,
trace/screenshots and final pristine-clone proof plus the high-risk submission
required by AGENTS.md. No passing command is claimed yet.

## Adversarial verification

Independently change upload/draw/readback completion schedules and host results,
corrupt a recorded readback, remove a required payload and seek while an old GPU
reply is pending. Inspect actual guest state/physical witnesses and original
history. Fail on silent live substitution, a stale owner changing new state,
stranded control or a falsely enabled replay profile. Sabotage one new bridge
generation/result check. All original E9-T18 criteria remain required here or in
its verified a/b predecessors.

## Verification log

### 2026-10-21 — worker — start the production GPU replay adapter

Selected from Next up after T18b was independently verified (`17d45b8d6`) and
published to the main URL as `c50b963d`; production receipt is `5ddba9c2d`.
Risk remains high. This slice connects the accepted native result/frontier
boundary to the admitted Wasm profile, durable session data and physical browser
bridge. T17 paced keyboard histories retain their authenticated checkpoint-only
policy. No browser GPU replay, performance or completion claim is made yet.

### 2026-10-21 — worker — exact-head production GPU result replay submission

Implementation: `7c1354a20a49af1c91cfe477157722ca82be10d2`; high-gate wrapper: `1f21eaa2f0bcb1ad86851823125b0c2fa45b9a39`. Final proof-only commits `e2ab203c4` and `3835885099576a7538e721655d4adb0f9f826a95` add recorded coverage and repair two older UI-test fixtures; they change no Native, Wasm, renderer or dependency semantics. Frozen 88-file bytes/modes: `target/evidence/e9-t18c-frozen-sources-383588509.json`, SHA256 `b91910d941431325b11722f9f2b58d9c5ec9a9a8799df6cdbfeb2fc4b55475f3`. Runtime identity remains `44020aa34d9df5e7124dde3b9fffea1ee33dc71050b3215be8667550ceb0ff88` (67 files); Native11 catalogue remains `9e1009b7d1da010c85f89c3530093020347aed2e1f7d1398d9ad971ec9f7e1b5`.

Commands and retained evidence:

- `E9_GPU_REPLAY_EVIDENCE_DIR=target/evidence/e9-t18c-frozen-submission-3 make verify-E9-T18`: full local wall completed in 2234 seconds, strict production/GPU Clippy, 42 native GPU cases, independent a/b raw-byte parsers, existing GPU regression cases, storage26, no_std/Wasm, proof feature, rebuilt dist comparison, renderer codecs, built127/0 browser, physical-GPU record/replay and independent browser-byte oracle passed. The aggregate then stopped at the pre-existing Node control fixture's missing DOM stub; this failed aggregate is retained, not relabelled passed. The prescribed wall records exactly the five historical quarantined `zicsr-stub` dead-code diagnostics and its existing scoped waiver; production Clippy stays strict. `target/evidence/e9-t18c-frozen-submission-3/report.json` and `gauntlet/report.json` retain all commands and raw artifacts; perf smoke was 65.8 MIPS against the existing 15 floor, not a desktop recording benchmark.
- `python3 -B target/evidence/e9-t18c-proof-promotion/run-incremental.py --baseline target/evidence/e9-t18c-frozen-submission-3/report.json --output target/evidence/e9-t18c-proof-submission-383588509`: passed in 543 seconds, exact runtime/source carry, both fixture rebuilds, Node5/5, software timeline127/0 with14 independent VM/console oracles and100 obsolete requests cancelled, legacy checkpoints, new full hardware paths and actual timeline controls. Report SHA256 `6f941e810a8f3dd19d10edbdb5d95b8bab7f0263320f1b097fbb16ee892b7c98`. Initial proof-only runs are retained: an executable-bit mismatch (binary bytes unchanged) and the old checkpoint-only GPU status-message regex. Both are corrected without runtime changes or repeated unrelated wall gates.
- `python3 -B tools/verify/e9-gpu-replay-cold.py --output target/evidence/e9-t18c-cold-383588509 --clone /Users/blamy/Documents/Codex/.e9-t18c-cold-383588509`: passed on the exact final head in a pristine no-hardlinks clone with no inherited target/npm directory, scrubbed Rust/Cargo environment, locked Native builds, own fresh target, rebuilt runtime byte equality, both hardware fixtures/raw oracles and actual UI controls. Final checkout is clean. Report SHA256 `1cea6b52210cd1d0692893610850a3b3dde38cf50ad5e90340ab2c17bb46e05a`; all commands/artifacts are catalogued in that report.

The recording demonstrates a real original RV64 supervisor MMIO workload through production Wasm and the physical Apple M4 Max/Metal renderer. The default history has 11 genuine keyframes, 32 GPU rows and 3 result bodies; independent reconstruction checks CPU/native bytes, full 1 GiB RAM digests, query1/0, green 16 KiB readback, COW sector 8 filled 0x4d, genuine native pending work, an above-2^53 fence and expected0x1205 error. Its final framed witness is `d3e017b082613411e5ac5f5de50ba3117d0340033e34005a213f892db5632f06`. The layered fixture adds actual owned upload/readback of a 2x2x2 image, offset 5, row8/stride13/count2, layer stride37/count2. All 96 RAM bytes, literal112233ff/445566ff colors and untouched0xc7 guard bytes independently match; 39 GPU rows / 4 result bodies end at `d1357d130463ddd0d7fde31a974871a3efeb129ada4b2f855efa54f843e561f9`.

Replay changes actual live scatter bytes/query values, holds readiness and varies execution/pumping schedules while preserving the recorded guest witness. Missing/corrupt bodies and unsupported clock/Wasm/renderer/host profiles explicitly refuse. Authentic old completion/DMA capabilities, four legacy numeric bypasses, cancellation/replacement, actual context loss, interval64MiB/256-body and global4096-row bounds preserve the original or committed prefix. An actual publication-authorizer abort leaves CPU/RAM/manifest/revision unchanged, clears its frozen epoch and retains dirty pages for an identical-ID retry; the depth 8 chain then rolls to a full frame. Actual `app.html` timeline DOM selects/opens the saved GPU session, seeks, clicks Back/Forward, displays the expected position/digest/console and a genuine64x64 green canvas, and leaves storage unchanged. Browser traces/screenshots/raw IndexedDB chunks are retained; replay makes no external HTTP/socket requests or live guest fetches and produces zero unexpected console/HTTP errors.

Fresh critic preaudits (all read-only so far) are sealed at `target/evidence/e9-t18c-verifier/frozen-browser-preaudit-1f21eaa2/report.md` (SHA256 `2b76e74c3f0073cf914e232ce26e6086ea1c3dcde7d1f19c3a7b4cdc5a6337a0`), `proof-incremental-e2ab203c4/report.md` (`734cb96c7473b85a5c29d5c79fbb14046f273a12e33bbc9c40abc3e2d97c1725`), and `final-preaudit-383588509/report.md` (`0231a6340f791e0cf156f4fc988d0c853c36083d4edeee0afdee7476d7ffb941`). They carry Native/storage/cancellation/cache results, independently authenticate raw state and literal layered bytes, kill a receipt-intent mutant, exercise a new physical schedule and inherited owned-capability method lookup, and classify 286 diff hunks with worker/Wasm coverage limits explicit. Formal cold authentication and verdict belong to the fresh verifier.

Scope: the admitted 1 GiB pure ICount/64 profile only. This original MMIO fixture is not Linux/Mesa or full desktop qualification. T17 paced keyboard histories keep their authenticated checkpoint-only policy. No cross-GPU bit-identical rendering, instant-seek or new performance claim is made; T22/T24 retain their declared budgets/product integration. Publication and roadmap metadata follow the verifier's decision. Worker sets only implemented, never verified.
