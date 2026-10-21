---
id: E9-T18b
epic: 9
title: Restore genuine guest-pending GPU results across coherent keyframes
priority: 524.9182
status: blocked
blocked_on: OpenAI account Advanced Account Security and compatible hardware FIDO2 key for the independent verifier
depends_on: [E9-T18a]
estimate: S
risk: high
capstone: false
---

## Goal

Retain real pending GPU guest work and its exact result frontier across restore.

## Boundary

The native pending-result/keyframe codec and ownership mapping. Persist the
descriptor chain, accepted control/resource/backing state, queue generation,
exchange/result cursor and owned ready completion. Physical GPU work may be
quiescent while a real guest fence remains pending; this distinction must be
explicit. No raw physical handles or fake drained-queue pending claim is allowed.

## Acceptance criteria

- [ ] Capture with an actual uncompleted guest fence, restore CPU/RAM/device/disk
  plus the owned GPU result frontier, and publish the exact bytes/ring/fence
  response once in the original order; no command or host side effect is reissued.
- [ ] Authenticate the logical-to-fresh-physical ownership mapping and revoke old
  callback leases even when numeric tags are reused. Guest-state witnesses retain
  all architectural GPU state; normalization of host tags is explicit and narrow.
- [ ] Corrupt/truncated/crosswired pending payloads, descriptor ranges, queue or
  context generations and unavailable physical work are refused before mutation.
  Existing quiescent T17 checkpoint semantics and clock identity remain intact.

## Deterministic acceptance

`make verify-E9-T18b`. Implement a deterministic pending-keyframe command with
original/restored guest traces and digests plus the high-risk submission required
by AGENTS.md. No passing command is claimed yet.

## Adversarial verification

Capture on both sides of scatter and guest fence publication; reorder callbacks,
seek twice to reuse numeric tags and inject an authentic old completion. Crosswire
descriptor/queue/result ownership, corrupt one saved result and require clean
refusal with the incumbent unchanged. Sabotage the new lease or pending codec
check once. Demonstrate a real pending guest effect, not an empty/drained queue.

## Verification log

### 2026-10-21 — worker — start pending frontier

Selected from the top of Next up after E9-T18a was independently verified and
published on the main site (deployment 3a893fc5, exact assets and 127/0 suite).
Risk remains high. The boundary is the native pending-result checkpoint and
fresh-owner lease mapping; legacy quiescent T17 snapshots and their clock
identity stay intact. Runtime work and this task's recorded acceptance remain
pending.

### 2026-10-21 — worker — reject inconsistent restored frontiers before submission

The first frozen candidate `6c6a55d88b2d9448962dcf1b843de2de84855d58`
is superseded. In the isolated worker checkout
`/Users/blamy/Documents/Codex/.e9-t18b-worker-clock-6c6a55d8`, two rehashed
malformed snapshots loaded with `Ok((1, 3))` and replaced an epoch-2 incumbent:
a queued common-clock effect could strand the prepared result, and removing the
pending owner left `admitted=1/completed=0/cancelled=0/pending=false`.
The fresh critic independently reproduced the latter contradiction during its
preliminary read-only audit. Raw failing and repaired-run logs are preserved in
`target/evidence/e9-t18b-worker-refutations/`; both initial recorders were
stopped before submission and retain failed reports, not passing evidence.

The v2 preflight now rejects a nonempty staged common-clock queue and checks the
pending/completed/cancelled admission ledger and sequence even when the pending
marker says quiescent. Two regressions fail on the old code and pass with the
narrow checks, retaining the incumbent byte-for-byte. The task stays in-progress.
The corrected frozen head will repeat the full high-risk gates and a final
pristine-clone run before the formal worker submission.

### 2026-10-21 — worker — implemented submission

Runtime/source frozen at `7941ea8924dfde14214120eee19b8cadbdb2a8af`.
Initial `6c6a55d8` candidate was refuted before submission; its stopped reports
remain failed. The response fixes both the erased pending ledger and staged-clock
queue contradictions and retains regressions with byte-identical rejected incumbents.

Complete final pristine clone `/Users/blamy/Documents/Codex/.e9-t18b-cold-7941ea89`:
`E9_PENDING_GPU_EVIDENCE_DIR=/Users/blamy/Documents/Codex/e9-t18b-final-cold-7941ea89 make verify-E9-T18b`.
All14 steps passed in423.33s:421 library tests,30 RV64 result/pending tests,
52 ordinary/T17 GPU regressions, source/clock checks, strict native/Wasm Clippy,
no_std Wasm and built-page recording127/0 with zero console/HTTP errors.
Report SHA afb4fc11fc07d6fca304c77e480974d1407dc5649e2e6b133f9114ef208cf62f.
All338 files/459637682B and27 source entries independently rehashed; final clone clean.
Browser reportSHA4cbedf9cd7467787b25201184bf1362aa8c525f970fcd4f889b032c4f6f68af1;
traceZIP589689ef12846124324772e589b59377b3dd4ed9a9dd12e85e12b932a8588632.
The nativeB pip is in-progress, A/T17 verified, and fullGPU replay in-progress.

Full high-risk wall: `python3 -B tools/verify/e9-local-gauntlet.py --task E9-T18b
--output /Users/blamy/Documents/Codex/e9-t18b-gauntlet-7941ea89` passed in 2110.31 seconds.
Report SHA-256 `bed929abcc6ae086c55dfd4f53dd1f43daee4704eb7b6f9af4c7d103ae720f60`; all three catalogue logs independently
rehashed. Strict production Clippy passed. `make ci` stopped only at the exact five
historical quarantined `zicsr-stub` dead-code diagnostics; the stub-scoped rerun and
all remaining native/Wasm/feature/RISC-V/determinism/performance targets passed.
The performance regression floor measured67.8 MIPS against15; no T22 performance
claim or budget change is made. Both former6c6a interrupted reports stay failed.

The genuine RV64 guest publishes available heads, notifies GPU MMIO, waits on an
uncompleted fenced response and reads results into architectural registers. V2
retains immutable accepted descriptor/control/backing/request authority and owned
result/payload/transport frontier; restore changes only explicitly host-owned epoch
and queue coordinates and opaque completion leases. Full CPU/RAM, pending tuple,
final rings/responses/fence, all non-host GPU state and instruction suffixes match.
Snapshots cover before scatter, after scatter and after fence;32MiB is exercised.
A subsequent real guest submission has identical logical receipts despite fresh
physical ownership. Real block OUT/IN and the separately reconstructed frozen disk
are paired by existing base/build/generation coherence. No guest command or physical
job is reissued by restore. Original stale/same-numeric leases, malformed/crosswired
native state and unavailable work refuse without changing the incumbent. The old
quiescent v1 API and ICount/source identity remain intact. Native mock sinks establish
guest effects; physical browserGPU/durable replay stayT18c.

Fresh critic session `01a15e74-a699-7b43-905d-b0d2834b5180` must review the formal
submission, its original F1 input against the response and final coverage. Only that
verifier may setverified. Publication to main follows verification. PR595 stays open;
no merge, GitHub Actions or sshdev/rr is involved.

### 2026-10-21 — worker — external verifier account gate

The completed worker submission remains recorded above; no new product failure
was reported. The independent verifier confirmed the original erased-owner input
now refuses repeatedly with an unchanged incumbent, the clock-queue candidate
refuses, and the intact pending job completes once without another host job.
Its remaining coverage/final-verdict work stopped at the account gate.

Exact reproduction: in this checkout,
`codex exec resume 01a15e74-a699-7b43-905d-b0d2834b5180
--dangerously-bypass-approvals-and-sandbox --json --output-last-message
target/evidence/e9-t18b-standard-verifier/response-final.txt - <
target/evidence/e9-t18b-standard-verifier/response-prompt.txt`.
The process exited1; final `error` and `turn.failed` events require Advanced
Account Security enrollment and a compatible hardware FIDO2 security key.
The exact error events/line numbers and event-file SHA-256 are preserved in
`target/evidence/e9-t18b-verifier-account-gate.json`. The complete frozen high-risk
wall and final cold proof remain passed and unchanged.

The user has been asked to complete the account security setup. The available
Code Review connector only reads CI diagnostics and cannot replace the required
fresh local evidence verifier. This task is blocked on that named external
requirement; it is not verified. Independent eligible E9-T19 may proceed, while
E9-T18c and the GPU replay release stay gated. Resume the same fresh verifier once
the account gate is resolved, preserve the recorded findings, and finish coverage
and verdict before publication.

### 2026-10-21 — worker — preserve blocked work above the verified UI release

Reparented this draft above verified T19 release `003e4b478` so the timeline can
ship on the accepted A runtime without publishing this blocked native change.
The original chain is retained at `refs/codex-safety/e9-t18b-before-reorder`
(`9aba75f4c7e7b77457efe34153e256443dd8e226`). All changed native implementation,
tests and pending-GPU proof harness files byte-match that retained submission.
The rebuilt Wasm remains exactly 2400211 bytes, SHA-256
`fca09f12b9969e54cfdbbc0e17b584d128249048cbe7ef19429d6dfe652af766`; all 56 GPU
worker inputs produce the unchanged build ID
`abe65b7af35437a31d88c17de9272a7ac4809200ae4a996013e218e68cecb204`.
Identity audit: `target/evidence/e9-t18b-reparent-after-timeline.json`; build log:
`/tmp/e9-t18b-reparent-build.log`. Prior native predictions and final wall/cold
proofs retain their source/binary scope; no new passing critic verdict is claimed.
The account security block is unchanged. This branch is not deployed.
