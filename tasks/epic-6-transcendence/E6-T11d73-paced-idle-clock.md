---
id: E6-T11d73
epic: 6
title: Bound opt-in ICount idle jumps by monotonic host progress
priority: 525.027036
status: verified
depends_on: [E5-T26i, E6-T11d70]
estimate: S
risk: high
capstone: false
---

## Boundary

Add an explicit opt-in `paced-icount` machine clock. Busy execution keeps the
existing retire-derived ICount clock and phase. Tickless WFI may advance toward
an armed future deadline only as far as the elapsed host-monotonic ceiling
anchored to guest mtime at selection or explicit rebase. The ceiling never
rewinds mtime, advances busy execution, or changes default ICount/WallClock.
A stalled/backward host clock cannot allow a future idle deadline immediately.
Expose truthful selected mode through the existing Wasm clock API; invalid mode,
source, missing CLINT or invalid phase must refuse before mutation. Explicit
pause/restore rebase excludes paused host time without serializing a host epoch.
Preserve existing keyboard/GPU host-wait guards, interrupt/deadline semantics,
ICount JIT fuel bounds, and all software guest defaults.

This native clock boundary does not claim to fix stock Omarchy input. D72 owns
its later loader selection, unchanged50ms stock acceptance and final full guest
run. The diagnostic records show the wall-clock input batch delays release
flushing while real repeat timers run, but do not prove this new pacing sufficient.

## Deterministic acceptance

`make verify-E6-T11d73` runs recorded fake-clock guest instruction traces/digests
for cached/uncached WFI with a not-yet-due host ceiling, advancing/jittered/stalled
host samples, ordinary retirement, timer/external IRQ delivery, held/broken/reset
keyboard, active GPU waits, selection/refusal and explicit rebase. Assert literal
mtime/deadline and architectural states; retain deterministic unpaced controls.
Run affected native format/lint/tests, no_std Wasm build, actual Wasm API tests
and the built default demo suite. Run this acceptance once from a pristine exact-head clone without borrowed
outputs; D72 may carry the unchanged native component proof forward. No production-default policy,
GPU performance, stock-input fix, deployment or snapshot portability is implied
by an isolated clock test.

## Adversarial verification

Predict concrete timer/IRQ/mtime state before reading traces. Vary initial time,
divider, cached schedules, host gaps and multiple IRQ/input lifecycles. In
particular reach the host ceiling while the guest deadline is still future and
prove host tasks/input can progress rather than spinning forever inside one
machine call. Test guest time already above the ceiling, backward samples,
large arithmetic bounds, exact timer boundaries, pause/rebase and restore.
Remove only the idle ceiling in an isolated copy; its literal WFI test must fail.
Carry unchanged default clock and native71 results by source/evidence identity.

## Verification log

### 2026-10-15 — worker — prerequisite after concurrent input pipeline recording

D72's original and disposable observed-image50ms typing remain failed. In
`target/evidence/production-stock-repeat-investigation03`, original kernel T20
make/break are47.750ms apart; actual compositor serialization is1.013250s apart.
Its release row816 is followed by58 further libinput events and58 corresponding
key emissions before the next observed public flush row933,29.457760s later.
Foot then reads/dispatches the release at row1546,30.423785s after its make;
the make callback body itself is19.195ms. All62 source/key/state/serial/PID
identities match across kernel/libinput/server/client, both published prefixes
are stable with overflow0, and the fresh critic independently holds442 native
timer bounds. Logger observations do not attest per-client socket delivery, and
no exclusive runtime cause or proposed-clock sufficiency is claimed.

This ordered task supplies an explicit native pacing primitive before D72 can
select and evaluate it. The observed binaries and production image are unchanged;
no guest repeat, typing delay or compositor patch is proposed by this task.

### 2026-10-15 — worker — frozen native/Wasm clock submission

Runtime implementation isdcf3d38e; complete root and pristine commands are
frozen at5537fbe6 (actual browser harness includes the compiled-tier control).
Both `VIRGL_PACED_IDLE_EVIDENCE_DIR=target/evidence/production-paced-idle-frozen01
make verify-E6-T11d73` and
`python3 tools/virgl-production/cold.py --task E6-T11d73 --output
target/evidence/production-paced-idle-cold01` pass. The latter is a full-history
`--no-local` clone, its own build, and all13 acceptance commands. Each records
390 core unit tests,23 selected native clock/input tests,6 Wasm API tests,
11 Wasm integration fixtures, actual ordinary browser clock checks and the
127/0 default suite with zero console errors. Native selection preserves time
and phase; busy native/cached/actual compiled execution stays retire-derived.
The actual compiled browser control retires16384instructions withmtime256 at
divider64,128 executed blocks and16258retirements via JIT. The literal browser
SBI TIME/WFI fixture waits at a future deadline, progresses between host turns,
excludes its explicit200ms pause after rebase and retains the unpaced control.

Tests/harness-only commits73bd3eb8 and2192c4c6 add the fresh critic's independent
high-time/source-replacement/IRQ fixture, requested private invalid-phase refusal
coverage and the paced/GPU-mailbox combination. Clean-head incremental recordings
are `production-paced-idle-final-supplement01` (four commands,73bd) and
`production-paced-idle-final-gpu01` (three commands,2192). The former records
three private divider/residue refusals before new-source sampling or replacement
of the original wall anchor, then an actual retirement still driven by that old
source. The four independent cache/high-time rows preserve nonzero phase and
losslessmtime above2^53 through source replacement, ignore discarded sources,
retain pending IRQ semantics and execute the real exact-deadline handler.
The latter runs original pending GPU success/failure/reset/loss in both cache
modes with a host ceiling already beyond the deadline, plus unchanged unpaced
controls: pendingmtime0, settledmtime500000 and matching original mailbox/used
ownership. Earlier whole-suite/cold results carry forward: production lib bytes
are identical after removing the cfg(test)-only module declaration; time module,
Wasm adapter, dependency boundary and actual ordinary Wasm are unchanged. Both
root and pristine ordinary Wasm SHA-256 are
`d055c473b686ce543d8b87da68034e240ba0f66cf8aacbb482e03a405a64363f`.

Worker isolated ceiling-removal control compiles and fails101 on the first
stalled-host WFI (mtime200000 instead of0), preserving the exact one-hunk delta
and raw output. Its borrowed-object clone is explicitly not the cold proof.
The critic independently runs a different four-row attack and its own removal
control; those results are for its separate verdict. Self-validation negatives
are also retained: an initial test mistook trap work slots for retirements; the
first browser fixture used unsupported legacy SBI timer0 instead of modern
SBI TIME; the first private test compile missed the Bus trait import. These
are corrected test/fixture failures, not substituted product successes.

Worker archive
`evidence/virgl-production-paced-idle-clock/worker/paced-idle-clock-submission.tar.gz`
is1,372,859bytes, SHA-256
`bea622c1049539743340a05e7dd874914e2b844da785b8df9bedd58e8df09c1c`;
all146 members/145 identities were reopened. Its source head is2192c4c6,
with exact full commands, source/payload pins, original root/cold reports,
all incremental and failed records, traces/digests, default/capability PNGs,
ordinary Wasm and the isolated removal evidence. The recordings prove only
this explicit opt-in clock contract. The production launcher still selects
wall-on-keyboard; D72's stock input remains refuted and blocked until this
fresh verdict. No stock-input fix, deployment, full GPU offload completion or
300MIPS result is claimed here.


### 2026-10-15 — independent verifier

VERDICT: verified

- P1 selection/refusal — HELD. Predicted admission preserves architectural time,
  phase and snapshot bytes; invalid source/mode/CLINT/private phase refuses before
  replacement. Native/actual-Wasm fixtures hold. Clean private rows divider/residue
  `0/0`, `7/7`, `7/8` each sample the new source zero times and preserve the old
  wall policy, anchor and jump. After restoring only the test-invalid phase, an
  actual retirement still uses the old source and reaches mtime133456. Citation:
  worker archive `production-paced-idle-final-supplement01/private.stderr` and
  independent `final-worker-authentication.json`.
- P2–P7 idle, IRQ and lifecycle — HELD. Original WFI stalled/advancing/backward
  traces hold literal0/50000/200000 and71M-offset controls, then execute the real
  timer handler. Independent cache0/1 × initial0/`2^53+1234`, divider37 rows preserve
  residue and exact time through busy77, replacing the host source, a pending
  original MSIP, backward samples and exact1000-tick deadline/MTIP. All40 promoted
  state/digest lines exactly match my original four-row run. With an earned host
  ceiling10M exceeding deadline500000, the original GPU mailbox still holds
  mtime0 until success/failure/reset/loss settlement, then500000: eight paced plus
  eight unpaced controls. Rebase/restore fixtures exclude paused elapsed time;
  snapshot fields contain no host epoch. Citations: independent
  `novel-positive01/stderr`, `literal-state-and-browser-audit.json`, worker
  `root/native-clock.stderr` and `production-paced-idle-final-gpu01/gpu.stderr`.
- P8/P9 defaults, real Wasm and JIT — HELD. Predicted busy retirement remains
  retire-derived and default ICount remains unchanged. Actual ordinary-Wasm
  compiled control retires16384 at divider64 to mtime256,128 executed JIT blocks
  and16258 retirements via JIT. Actual modern SBI_TIME/WFI runChunk returns within
  its work budget before a future deadline and progresses on later host turns;
  the explicit pause/rebase bound holds. Six Wasm API and11 integration fixtures
  pass, with truthful lossless mode/time and rejection paths. Both default demo
  suites are127/0 with no browser errors. Citations: worker `root/browser-clock/`
  and `cold/acceptance/browser-clock/`, plus independent literal/browser audit.
- P10 evidence/environment — HELD. Reopened all146 worker archive members and
  authenticated145 identities, full13-gate hot and full-history `--no-local`
  pristine-clone/build/13-gate cold at5537fbe6. The clone has no alternates, is
  tracked-clean after build and uses the scrubbed command environment. The
  clean73bd four-command and2192 three-command supplements change tests/harness
  only: production lib equality after removing its exact cfg(test) declaration,
  time/Wasm/dependency equality, and identical1744311-byte ordinary Wasm SHA-256
  `d055c473b686ce543d8b87da68034e240ba0f66cf8aacbb482e03a405a64363f`
  carry earlier results forward. Citations: independent
  `frozen-hot-cold-authentication.json` and `final-worker-authentication.json`.
- P11 novel/control — HELD. My original-Machine four-row literal attack passes.
  Removing only the idle-ceiling call in a separate copied core compiles, then
  fails101 at first WFI: observedmtime1000 versus predicted2; the original source
  is unchanged. Exact commands, delta and raw failure are in independent
  `novel-positive01/report.json`, `isolated-ceiling-control/source.delta` and
  `novel-ceiling-control01/report.json`/`stderr`.
- COVERAGE/SUITE — Every changed semantic boundary is exercised or explicitly
  waived in `verdict-and-coverage.json`. Declarations/docs and the unreachable
  public-invariant missing-source tuple are waived. The Wasm harness emits no
  raw eprintln trace rows, so no raw native/Wasm logging equality is claimed;
  the shared literal fixtures and real Wasm API/browser execution prove the
  required states. Retain the promoted independent test SHA-256
  `4fbf10ace355a5256caa57f88fd3b11481fe15b08df5962a0b4e7a43f9cac2be`,
  private guard/GPU combination tests and `make verify-E6-T11d73`.

Independent archive
`evidence/virgl-production-paced-idle-clock/verifier/independent-paced-idle-clock-review.tar.gz`
is 607608 bytes, SHA-256
`496e53dbccffd922e1fd63287cf1b2038f62f3abd6c82ef360eadac35935a14f`; all118 members/117 identities reopened. Its paired JSON
pins every member, the original pre-data predictions, both independent runs,
raw traces/digests, exact copied-core delta and worker authentication. The
canonical worker archive remains pinned at SHA-256
`bea622c1049539743340a05e7dd874914e2b844da785b8df9bedd58e8df09c1c`.

This verifies only the explicit opt-in native/Wasm primitive. No production JS
selects it yet. D72's stock50ms input remains refuted/blocked pending its own
selection and proof; parent, recovery, live deployment, complete guest GPU
offload and300MIPS are not established by this verdict. Original diagnostic
negatives and earlier component holds remain intact.
