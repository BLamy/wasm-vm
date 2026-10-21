---
id: E9-T18b
epic: 9
title: Restore genuine guest-pending GPU results across coherent keyframes
priority: 524.9182
status: verified
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

### 2026-10-21 — worker — resume the same independent verifier after hardware setup

The user reports that the hardware key is now added and explicitly requests
another GPU validation attempt. The external account prerequisite is ready to
retry, so this task returns to implemented for the same independent critic
session `01a15e74-a699-7b43-905d-b0d2834b5180` to finish its interrupted review.
No native implementation changed. Retain the exact `7941ea89` native submission,
completed full wall and final pristine-clone receipts above; the UI reparent
changes no GPU dependency or binary. The timeline's verified release is now
`9ff9906c` at the main URL; B remains excluded from production until a passing
fresh verdict. This status is a worker submission, not a verification claim.


### 2026-10-21 — independent verifier — VERDICT: verified

VERDICT: verified

Same fresh critic session `01a15e74-a699-7b43-905d-b0d2834b5180`, never the
worker. Submission `8361086a818a44c9f9f83b10641a02a288a9700f` preserves
frozen native runtime `7941ea8924dfde14214120eee19b8cadbdb2a8af`.
Full report, predictions, coverage and receipts:
`target/evidence/e9-t18b-standard-verifier/final-8361086a/`.

- **F1 / erased owner — CLOSED, HELD.** The original failing input SHA
  `765d198174a253eca720096605dc42561471f86dab009d484a42c9c5a0e87783`
  and its accepted/reissued6c logs remain intact. The exact input now refuses
  three times with tag12 before mutation (`7941ea89-preaudit/response-probes.log:148-150`).
  Incumbent SHA `cb72630bb4e1369e5d3c39c4ce01fc9feb0edcbea6080551617f7a9598f21d6c`
  remains exact and every host-call/lease counter stays0. The intact owner stops
  at Before189/retired189/ordinal1/sequence6 on three further single steps,
  then retires the original fence exactly once, used5/cursor3, full CPU/RAM
  identical and no reissued host job (:160-163; retained finished trace/blobs).
- **Sequence and staged-clock response — HELD.** The worker's erased-admission
  fixture also hit the older fenced<=admitted bound. Independent variants isolate
  next_sequence3 with pending0/completed1/cancelled0/admitted1/fenced1, and an
  erased admission with fenced0/next_sequence2. All prior scalar bounds and the
  ledger balance hold; each still refuses tag12 three times without mutation
  (`promoted-pending.log:84-86,188-194`). Counter-sum overflow refuses too.
  The original staged-clock image rejects tag22 three times with the incumbent
  unchanged (`response-probes.log:157-159`), exercising the decoded staged clock.
- **Native malformed/coherence coverage — HELD.** Bounded direct tests cover
  malformed marker/boolean/request/kind/trace tags, bounded lengths/counts and
  u32 conversion, duplicate resources, all transfer kinds, non-render/context
  DMA authority, queue alignment/ranges/head, exact next-event ordinal/sequence,
  restored-settled cancel and replay/parked-block wrapper guards. Independent
  raw parsing verifies repaired seals and164 candidates/492 unchanged pairs
  (`raw-receipt-audit.json`). Layered prepared/retained transport and unattached
  transfers were rerun through7941, preserving every CPU/RAM byte with no host
  work (`positive-probes.log:5-8`). Private guard fixtures are identified as
  such; no full-machine or physical-render proof is inferred from them.
- **Submission/reparent — HELD.** This critic independently rehashed all338 cold
  files/459637682B and27 sources, all3 wall logs/288061B, and the old474-file
  critic receipt. Cold clone remains clean at7941 and its actual source files
  match. Cold report SHA
  `afb4fc11fc07d6fca304c77e480974d1407dc5649e2e6b133f9114ef208cf62f`;
  wall SHA `bed929abcc6ae086c55dfd4f53dd1f43daee4704eb7b6f9af4c7d103ae720f60`.
  Strict production Clippy and all remaining targets pass under only the exact
  five historical stub diagnostics, independently compared with A. Browser
  report/trace/asset checks prove127/0/errors0 with A/T17 verified and B/fullGPU
  in-progress. All13 changed native/test/proof files,110 full native source/
  manifest/lock entries and56 GPU inputs retain their exact dependency boundary;
  GPUbuild remains `abe65b7af35437a31d88c17de9272a7ac4809200ae4a996013e218e68cecb204`.
  No unrelated wall/cold rerun was required for the UI reparent or test-only work.
- **Coverage — CLOSED.** Original115-hunk map and its13 needs are preserved.
  Current B diff has106 text hunks:77 executed,29 specifically waived, zero
  unexplained needs/dead; the changed Wasm is separately browser-executed.
  Coverage SHA `867540364ac22033e4ad7c06fd926af5d19948bb006d9d21be720cd523325fb9`.
  Every zero counter has a direct/equivalent execution or narrow propagation,
  type, generated-metadata, private-invariant or test-sentinel disposition.
  No task acceptance behavior is waived. Unchanged HELD schedules, whole pending
  tuple,32MiB/before-FIRST-GATHER, disk OUT/IN, subsequent job identity, no-trace
  and T17/clock results retain their original code/evidence boundaries.
- **SUITE — HELD.** Promoted five portable independent integration regressions
  into the existing cheap gate and the exact lease test that detected the one
  earlier scratch sabotage. The restored source and original failure are kept.
  Four same-key schedules3/17/47/101 pass; five pending tests pass both with and
  without gpu-trace. Affected strict Clippy and formatting pass; commands and
  digests are in `promoted-report.json`. Production source prefix is byte-exact;
  the only source-file addition is cfg(test). No runtime implementation fix.

Report SHA `8ccc1b47f9fe4b3105312023494924763c5a08092a8d58748afec39610747508`.
Sealed receipt SHA `4b0a695dfa4dbbe548887369476cfbb8c525f8eb23b9a0e5b4eeb86954fd4cde`
binds784 final files/17289399B and183 response files/11687632B, plus linked original
and official catalogues. Policy is checked before queue regeneration; the
verifier commit contains only this log/status, QUEUE and promoted tests. The
repository hook's documented SKIP_WEB_BUILD=1 option preserves the explicitly
unchanged publication boundary for these test-only changes.

All acceptance predictions hold for the native B boundary. External disk
reconstruction remains explicit; physical GPU rendering and durable Wasm replay
remain T18c. No deployment, production pip change, budget change, PR merge, push,
CI/GHA, rr/ssh dev, model change or account-gate bypass was performed.

### 2026-10-21 — worker — publish verified native keyframes on the main URL

After independent verdict `17d45b8d6`, publication commit
`592a639a16f90602bd1b5f5d45d55638f4ce33b0` rebuilt the bundle and marked the native pending-GPU
capability verified. Production Wasm remains exactly2400211 bytes, SHA-256
`fca09f12b9969e54cfdbbc0e17b584d128249048cbe7ef19429d6dfe652af766`, GPUbuild
`abe65b7af35437a31d88c17de9272a7ac4809200ae4a996013e218e68cecb204`.
The new permanent tests are cfg(test)/integration-only. Root independently
rehashed969 verifier/response/coverage files (56651103 bytes), including the final
receipt SHA `4b0a695dfa4dbbe548887369476cfbb8c525f8eb23b9a0e5b4eeb86954fd4cde`
(`target/evidence/e9-t18b-final-critic-audit-17d45b8d.json`).

The evergreen acceptance runner now expects the published verified pip by default.
Its explicit `--pending-status in-progress` option / `E9_PENDING_GPU_STATUS` Make
override preserve worker-submission checks. Actual argparse default/override
checks, Python syntax/help and Make expansion were checked; no native proving
logic changed (`target/evidence/e9-t18b-publication-status-selector.json`).
The affected T19 built-browser path was recorded once on the published B binary:
127/0, zero console/HTTP/MIME errors,14 independent actual Linux state/console
oracles, cancellation/control/admission/early-finish assertions. Report:
`target/evidence/e9-t18b-timeline-release/report.json`, SHA-256
`c8925af2b8e19122807cb759528e441e5943e17a75a07d7582fa10d34ae49962`.

`bash tools/deploy-cloudflare.sh` published Cloudflare `c50b963d` to
**https://wasm-vm.pages.dev/**. The actual main URL served14 checked assets exactly,
including Case Studies and the timeline, passed127/0 with no console/HTTP errors,
and restored a fresh real Linux recording to transition3000000/digest
`c1b1ac22df2fb67e3d2d0b2cf8914d15007b554d8f2d990ec2e484380e4b99ce` with genuine kernel text.
The native pending-GPU and timeline pips are verified; physical/browser GPU replay
remains gated for T18c. This production browser check proves served bytes and
software compatibility; the native pending-fence proof is the independent verdict
above, and no physical replay claim is added.

Production receipt: `target/evidence/e9-t18b-production-release/receipt.json`; main
report SHA-256 `4042122bb6432c36580af8989aa54a6c6a2cd40c6050f3f388e72310c1574ced`; trace SHA-256
`d9de66ce8563a71e87b88064bb75d2530e21f34b520589628d98c084a8406652`. Deployed/original manifest pairs, executed checker, screenshot
and deploy log are preserved beside it. Only the five rewritten manifests were
restored to their committed originals. Native stack598 retained21 open/unqueued
PRs; no merge or GitHub Actions operation was performed.
