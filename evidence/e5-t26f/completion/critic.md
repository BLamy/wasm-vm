# E5-T26f completion diagnostic — fresh critic

Fresh pre-evidence review for the proposed completion-only diagnostic layer. I read the
entire E5-T26f task and the runner's current control flow at base
`42bca4f93f0f8a1fff4e5078043c19db0e1ebedf` before inspecting any completion evidence.
At prediction time `HEAD` was still that base and no completion diff or browser record
existed. This file is a diagnostic critic ledger, not an F verdict.

## Boundary observed at the base

The current runner freezes `postRestoreEnd`, performs the existing pointer/button/audio/
terminal assertions, then immediately asserts
`postRestoreEnd - postRestoreStart <= 2_000`. Failure is captured and rethrown before the
normal coherence audit. Independently, every existing diagnostic takes an early
diagnostic-evidence branch and skips the drag-phase saves and second restore. Reaching the
remaining functional path therefore requires two narrowly controlled changes: defer only
the already-materialized cap failure, and let completion mode traverse the existing
normal-audit/drag/second-restore path without entering acceptance mode.

## Falsifiable predictions before diff and evidence

1. **Explicit reuse-only selection.** Completion mode will require
   `E5_T26F_DIAGNOSTIC=reuse` and exact string
   `E5_T26F_DIAGNOSTIC_COMPLETE=1`. Missing, empty, `0`, non-string-equivalent, create,
   or ordinary acceptance selection must reject before browser launch. It will be
   incompatible with CPU/latency profiling, command override, JIT comparison, residency
   comparison, and guest-clock override flags even when a conflicting variable is
   explicitly present with an empty value. Default and ordinary diagnostic selection
   must remain byte-for-byte/control-flow equivalent outside this branch.
2. **Make acceptance remains fail-fast.** `make verify-E5-T26f` will continue to reject
   diagnostic environment selection and will not set completion mode. No default Make
   recipe, acceptance URL, production option, runtime, WASM, package, image, or browser
   asset will change.
3. **Original timing boundary is immutable.** `postRestoreStart` will remain the normal
   restore's original `completedAt`; `postRestoreEnd` will still be captured immediately
   after the existing terminal/input/PCM/render assertions. Completion mode will neither
   reset those values nor replace them with a later audit/drag timestamp. The original
   arithmetic and exact message `post-restore interaction exceeded 2 seconds` will still
   produce an `AssertionError` when elapsed time exceeds 2000 ms.
4. **Only the dedicated cap failure is deferrable.** Deferral will require completion
   mode plus the actual final cap assertion at that control point. A cursor, held-button,
   marker, visual-output, PCM, attachment, render, browser/HTTP, coherence, CRC, snapshot,
   drag, second-restore, or arbitrary same-message error must remain immediately fatal.
   A broad `catch` keyed only by error text, error class, or diagnostic presence would
   fail this prediction.
5. **Failure-first-write survives later work.** Immediately after the cap assertion
   fails—and before coherence I/O, a new save, drag input, or reload—the runner will write
   the canonical cap failure capture with the frozen start/end, actual PCM, input, marker,
   and current browser state. That first write must not claim success and must not be
   overwritten or relabelled by the eventual rethrow.
6. **Existing normal audit is still authoritative.** After deferring the cap only,
   completion mode will await the same normal `auditRestoreCoherence` implementation and
   require its actual passed result before any subsequent save. It must not replace the
   audit with a cached checkpoint value, skip sparse reconstruction, or treat a failed/
   missing/mismatched audit as diagnostic success.
7. **All drag phases and second restore execute unchanged.** The runner will take the
   existing before, held, moving/persisted, and released drag snapshots; perform the real
   second reload/auto-restore; require the persisted moving snapshot hash and first-present
   CRC; reject cold `booting`, missing whole-machine resume, stale/mismatched metadata,
   missing presents, and any retained held button; then run the existing drag coherence
   audit. Completion mode may route output differently but must not weaken these
   assertions.
8. **Acceptance state remains false.** Every completion artifact will use a distinct
   diagnostic-completion schema/name and `acceptance:false`. Any overall `checksPassed`
   field used to summarize the run must remain false because the retained cap failed,
   even when separate functional/audit milestones report success. No
   `desktop-roundtrip.*` acceptance artifact, success exit, F verification field, or
   production result may be emitted.
9. **Later failure retains both facts.** If a post-cap functional assertion fails, the
   resulting failure artifact will retain the original cap failure and frozen timing as
   well as the later functional error, and the process will throw the later error without
   writing a completed diagnostic. If all later functional assertions pass, it will write
   only the bounded diagnostic-completion JSON/PNG/server-log set and then rethrow the
   original cap error, yielding a nonzero child exit.
10. **No same-state oracle or synthesized success.** The completion report will derive
    CRCs, hashes, button state, boot-state absence, coherence status, PCM, and restore
    metadata from the live existing milestones. It will not infer functional success from
    merely reaching a phase, from the first failure capture, from DOM-only text, or from
    values generated by the report itself.
11. **Output and retry isolation.** Completion mode will write only beneath its explicit
    diagnostic output directory, preserve the sealed reuse profile ownership rules, and
    refuse or safely separate pre-existing completion artifacts. Repeated failure capture
    must not turn the original cap error into an unhandled overwrite error.
12. **Prior verified boundaries remain HELD.** H session fencing and device resume,
    T19a sound/XRUN recovery, and T26i monotonic ICount behavior carry forward only because
    this layer changes harness control flow and evidence routing, not runtime bytes. The
    completion replay still must show fresh HELLO/no boot, matching CRC, real guest-visible
    terminal completion and positive fresh PCM before those held facts can be cited for
    that execution.

## Planned bounded attacks after freeze

- **Deferral-identity sabotage:** in an isolated source copy, weaken or remove the exact
  cap-deferral predicate. Dedicated tests must then fail for a non-cap functional error
  and for an impostor error carrying the cap message outside the final timing assertion.
- **Deferred-error retention attack:** drive a synthetic cap failure followed by a normal
  audit/drag failure. The saved record must contain both errors and frozen timing, must not
  write completed diagnostic artifacts, and must reject with the later functional error.
- **Final nonzero sabotage:** neutralize the final rethrow in an isolated copy. A focused
  test must fail because a functionally complete but over-cap run would otherwise exit
  successfully.

## Coverage ledger to apply to the frozen diff

- Diagnostic selection and Make guard: exact flag matrix, conflicts, reuse-only behavior,
  unchanged default path.
- Timing catch/deferral: in-budget path, over-budget completion path, non-cap immediate
  failure, failure-first capture, immutable original T0/end.
- Normal audit and drag traversal: ordered phase evidence, all four saves, second restore,
  CRC/no-boot/released-button/coherence assertions.
- Evidence routing: cap-only completed diagnostic, cap-plus-later-failure record, no
  acceptance artifacts, final nonzero exit, no overwrite on outer cleanup/capture.
- Declarative test/Make hunks may be covered by focused deterministic execution. Any
  runtime/web/package hunk would contradict the stated layer and require separate review.

No implementation, status, queue, runtime, browser, or existing evidence file was changed.

## Preliminary frozen-runner inspection before browser evidence

The uncommitted runner diff was inspected against base `42bca4f9` while `HEAD` still
equalled that base. The scoped changes are limited to the Make test list, the browser
runner, and test extraction boundaries; no runtime/web/WASM byte is changed. Predictions
P1, P3, P4, P5, P6, P7, P8, P9 and P10 are structurally supported as follows:

- `diagnosticOptions` requires exact reuse plus `COMPLETE=1` and rejects every named
  profiler/JIT/residency/clock/command conflict, including present-empty values. Existing
  bounded key pacing remains permitted without changing `sh /tmp/a` or policy defaults.
- `requireEmptyCompletionOutput` runs outside the outer failure-capture block, before any
  browser work, so a nonempty prior output cannot be overwritten by refusal evidence.
- The functional pointer/button/audio/marker and browser/HTTP assertions remain outside
  the cap-only `try`. The latter contains exactly the original assertion. Its helper also
  requires the original `AssertionError` shape, finite nonnegative boundaries and an
  actual elapsed value over 2000 ms before retaining the same Error object.
- The immediate cap capture precedes the normal coherence audit; progress sampling is
  restarted afterward. Completion mode then traverses the unchanged four drag saves,
  second reload, CRC/no-boot/button/display checks and second coherence audit. Overall
  `checksPassed` stays false when a cap is retained while separate functional flags become
  true only after their audits.
- Final completion consistency rechecks the original restore timestamp, elapsed value,
  retained serialized error, every functional flag and the false timing/check flags
  before writing a distinct non-acceptance schema. A later functional throw reaches the
  existing outer failure capture with the retained cap still in `milestones`.

### F1 — contradictory final phase attribution — ACTION REQUIRED BEFORE RECORDING

Prediction P9 does not yet hold cleanly. At
`tools/verify/e5-t26f-browser-roundtrip.mjs:414-418`, the runner writes the completion
JSON/server log, emits `diagnostic:completion-evidence` with event `done`, and then throws
the retained cap. The unchanged outer catch at lines 1697-1707 derives its label from that
same last phase, changes it to `failed`, and writes an additional
`failure-diagnostic-completion-evidence.*` capture. Thus a cap-only run reports the
evidence-writing phase as both completed and failed, while the second capture's label
misattributes the already-known timing failure to completion evidence.

Required boundary: preserve the nonzero rethrow and both the immediate cap record and
completed functional report, but ensure the final retained-cap propagation has a truthful
timing-cap phase/label (or is recognized as already captured) rather than retroactively
failing the completed evidence phase. The dedicated test must assert the exact final
progress/artifact/error sequence, not merely that a promise rejects. No runtime or F
criterion change is requested.

P2 remains pending the final Make/test diff, and all predictions remain pending dedicated
tests plus the one sealed browser replay. No completion evidence has been inspected.

### S1 — real guest-window translation is not presently observed — PROOF GAP FOR F

The base and completion runner detect the guest titlebar once at drag preparation, derive
host pointer coordinates from it, then perform mouse-down, an 80-guest-pixel pointer move,
a 100 ms wait, and the persisted `dragSnapshot`. They do not reacquire titlebar geometry
while the button is held or before that moving snapshot. Snapshot hashes, framebuffer CRC,
host mouse coordinates, pointer-frame counters, and a later released-button check can all
hold even if the compositor never translated the window. They therefore prove an input
phase and snapshot boundary, not by themselves a snapshot taken during an actual guest
window drag.

For the supplied replay I will require retained live guest geometry showing that the same
window titlebar moved in the intended direction before the persisted moving snapshot, or
an equally direct guest-visible displacement observation. The existing T25b oracle at
`web/bench/desktop-perf.js:101-122`, wired after a real drag at
`tools/verify/e5-t25b-browser.mjs:171-173`, is the established bounded model: finite
pre/post titlebar coordinates plus direction and minimum-displacement rejection. Without
such evidence, completion mode may truthfully report that all four input/save phases and
the second restore ran, but the F criterion “snapshot taken during a window drag” remains
**NEEDS EVIDENCE**. This is scoped to F's existing criterion and does not refute the
completion diagnostic's other functional observations or add a performance requirement.

## Exact source and dedicated-test review at `856f3e78`

Frozen runner commit: `856f3e78eb4872ef8e7020ddaf19eb2938fe9051`. Its scoped binary
diff against `42bca4f9` is SHA-256
`d2388bf12321422eda7f3df16d550e77208f081f682d5932e6f78706d4fc9cb2`; only the runner
and adaptations to its existing test file are committed. Runner SHA-256 is
`33626397fc3e7ffffd85e327fbe9e4dbaf45512a721165a3c8601d17883d58dc`.
No runtime/web/WASM source is in the commit.

The adapted existing runner suite passes 68/68. The separately worker-frozen dedicated
test, SHA-256 `68869d42391aaa9c0acae1fe5dc30d68e8e66281ab7e7d8b57fac89109bf2615`,
passes 14/14 in the critic's direct run. It executes extracted production selection,
retention, completion, capture, identity, orchestration tail and outer-catch code. It
covers exact flag isolation, original cap uniqueness, exact error identity and boundary
validation, immediate cap capture, progress restart, normal/drag audit ordering, all four
save phases, second restore, later-failure retention, false acceptance/check flags,
persistent-context identity, consistency refusal before result writes, and empty-output
guard ordering. Existing 68 tests retain coverage of the real coherence-audit helper;
the dedicated fixture intentionally substitutes only its external audit result and order.

### Sabotage disposition

- Replacing only `if (!timingPassed) throw timingFailure` with a return in an isolated
  copy makes 2/14 dedicated tests fail. The final nonzero cap boundary is falsifiable.
- Adding one exact cap-only invariant—`captures.length === 1`—to an isolated test copy
  fails with observed value `2`. This directly confirms F1. The current 14-test suite
  checks the first capture and exact final thrown object but does not check the second
  capture's count, label, or phase.

The dedicated test and Make-list addition were still awaiting coordinator integration at
the instant of this review; that is integration state, not a test-design gap. P1 and the
core of P3--P10 are HELD statically/deterministically subject to F1. P2 remains pending
the integrated Make guard/list. S1 remains an independent browser-evidence sufficiency
question. The active browser replay has not been inspected.

## Browser replay result — second restore refused

This is a diagnostic result, not an E5-T26f lifecycle verdict. The single sealed-profile
completion replay exited nonzero at the second restore, after preserving the original
timing failure and completing the normal coherence audit plus all four drag save calls.
The record is bound to source `856f3e78eb4872ef8e7020ddaf19eb2938fe9051`, runtime
`45ce3b925c590fab34b8fd8af85f0bb2ffbec585df2e2586c668869fe4ebca6b`, image
`5530d6585776cf61fcedb98f7a2e75b4293d5f805809e5107cc181fa5dc62550`, and manifest
`b6257e6c0e6789dee28a4f0a7eae1089193fcec545d467d8a70d245226bb9592`.

Artifact SHA-256 values, mechanically recomputed from the files:

- `failure-readiness-drag-desktop-ready.json` —
  `be3f63baf93eba97b43d48488e603212a4813e673ba4d41b910f8359612d6d29`
- `failure-readiness-drag-desktop-ready.png` —
  `74081cf64a9e841ee4f2b6f7492ffc2fe429ecca3f451461e018270b678b1bf6`
- `failure-readiness-drag-desktop-ready-server.log` —
  `824723708e237f58c9304c36fbe28ffd609825f248e1476593ce84bcbc1e0f21`
- `diagnostic-completion-timing.json` —
  `007f79da05ba19012a21c1e9fb189fd57b84ebed365ebd0c04a17a53027ddc63`
- `diagnostic-completion-timing.png` —
  `8d5b2f0fe509ae090bd66d15fb98777b492064fbddfd248762e789dbad977b6a`
- `diagnostic-completion-timing-server.log` —
  `3f9ccd6d8bdc47c3682875364f7ffca115c8e1201d5418add736d55c47dfe596`
- adjacent `run-856f3e78.log` —
  `7abbe4479405448a37048931283904fc14dbf5f0e2f9e5bd915a423a69c49f2f`

### Prediction dispositions

- **P1 HELD; P2 remains integration-pending.** The live record selected explicit reuse
  completion mode with default command, JIT, residency and guest-clock controls and
  remained `acceptance:false`. Source and focused tests hold the selection isolation;
  the then-uncommitted Make-list/guard integration is still outside this historical
  record.
- **P3--P5 HELD.** The immediate timing artifact freezes the normal restore
  `completedAt` as `1195.1899999380112`, end as `6209.324999928474`, and exact retained
  elapsed time as `5014.134999990463` ms against the unchanged 2000 ms limit. It stores
  the original `AssertionError` before the 34.338-second coherence audit begins.
- **P6 HELD.** Normal restore used snapshot
  `e2186e00eb85fb4b82dc6edc7780fef02590ffd666c6ae68b90176d4726ecdf7`,
  produced first-present CRC `09c5c407`, fresh HELLO generation 2, no `booting`, and
  passed the live snapshot decision/generation audit as `resume`/621. The real command
  marker, 20 keyboard frames, positive fresh PCM (1440 produced, 960 nonsilent,
  `maxAbs=0.082000732421875`) and functional interaction checks are retained while timing
  and overall checks remain false. The inspected timing PNG visibly includes ALSA
  `underrun!!! (at least 0.063 ms long)` followed by the green marker and prompt; this is
  successful XRUN recovery, not evidence that no guest XRUN occurred.
- **P7 FAILED at second restore.** Before the failure the transcript records completed
  before, held, moving/persisted and released saves. Their respective snapshot SHA-256
  values are `c2c58105d5557721f4aab7f4f8ac4cf59dcd9170c3abd864e1a9028a4125d506`,
  `4e5fda5b93bf7e5daf80945faa7c180ed19a0bb83266d73dc5bd20ef9e3313da`,
  `99d034a224aeebe415337cdafcaf8d3d67aeef49813dc225d50a7e65f56fdeb6`, and
  `6c5ced5f7095b2fdbf578125bb544f67a8e12f97c7d81bcc9fcb4a66b745c3a2`.
  The moving record claims a persisted paused machine at overlay generation 621 and CRC
  `3eee89f2`. On reload, however, the first readiness sample contained
  `fetching -> instantiating -> booting` (booting at 469 ms), zero presents and no frame;
  the reuse guard correctly aborted rather than accepting cold fallback. The inspected
  PNG is a black guest canvas labelled `linux: booting`.
- **P8 and P9 HELD for the observed failure path.** The later readiness failure retains
  the original cap object and false timing/check state, exits nonzero, and writes no
  `diagnostic-completion.*` result. F1's contradictory final-cap attribution was not
  reached and remains a static action item for an otherwise-complete run.
- **P10 partially HELD; S1 remains.** Normal typed input, terminal marker and PCM are live
  observations. The four distinct drag snapshot hashes establish changed serialized
  states, but no retained pre/post guest titlebar geometry proves actual window
  translation before the moving save.
- **P11 HELD for this path.** The first cap capture remains intact beside the distinctly
  labelled later failure; neither was overwritten. **P12 remains HELD only for unchanged
  runtime boundaries and the successful normal restore.** This failed drag reload does
  not refute H/T19a/T26i, but it supplies no second-restore evidence for F.

### Cause assessment

The record proves that production restore did not complete a resume; it does **not**
retain whether the stored-snapshot decision was non-resume or a selected resume failed
during load. `waitForDesktopReady` sees only the subsequent `booting` state and the
runner records console errors but not the loader's warning. The warning is the only place
the actual `missing`/`corrupt`/`foreign_*`/`stale` decision or storage exception would
have appeared. Consequently the evidence cannot yet distinguish an absent/corrupt/stale
snapshot from a load error or identity/ownership problem.

The proposed specific mechanism—“the released `persist:false` save overwrote the moving
whole-machine resume or persisted desktop envelope”—is not supported by the inspected
call graph. At `web/desktop-terminal.js:485-527`, `machinePersist` defaults to `persist`;
therefore the released call at runner line 1593 pauses, takes only a desktop component
snapshot, and resumes. It does not call `controller.persist`, does not call
`controller.snapshotSave`, and does not write `sessionStorage`. Only the moving
`persist:true` call at runner line 1584 traverses those three durable writes. The released
component save can change or expose live-machine state through quiescing, but the shown
path cannot by itself overwrite the already-published IndexedDB resume blob or its stored
desktop envelope.

Smallest useful next discriminator: around the existing moving/released boundary, retain
the stored envelope SHA, current overlay generation and typed `snapshotDecision` both
immediately after the persisted moving save and immediately after the released
nonpersistent save; on reload, retain the loader's actual `restoreStoredSnapshot` decision
or exception before fallback. If overwrite is still suspected, also compare a bounded
digest/metadata identity for the stored resume at those two points. This should establish
whether the released save changed durable state and classify the refusal without adding a
new F criterion or permitting fallback.

### Diagnostic conclusion

The completion mode usefully localized two independent facts: the original interaction
still fails the fixed cap at 5.014 seconds, while its normal post-restore functionality and
coherence survive; later, the second whole-machine restore is refused after all four save
calls. It therefore cannot yet produce the intended completed functional diagnosis, and
it supplies no F verification. Preserve the held normal evidence, F1, and S1; classify
the second-restore branch as a concrete functional blocker pending the typed refusal
observation above.

## Postmortem IndexedDB inspection and repair boundary

The main session subsequently inspected a private copy of the closed failed profile using
`tools/verify/e5-t26f-inspect-resume.mjs` (SHA-256
`4d2fd88d08c6ca9e775bd2bc27ce3cf9ba4e1bc2d40183cac19e898fe4966173`). The tool launches
only a synthetic same-origin document, enumerates existing IndexedDB databases, and reads
the `meta`/first `chunks` entries through `readonly` transactions; it does not load the
emulator, guest, runtime loader, or source profile. Its corrected output
`failed-resume-metadata-corrected.json` has SHA-256
`8e1482737c726eb7997bcbae0021ba048e383c935ff81f5c07927a5f660df0a1` and is bound to the
canonical failure JSON digest above.

The corrected record is structurally consistent with the checked-in codecs: the `wvsn-*`
first chunk begins with `WVMRESU1` and carries snapshot generation 621 at resume-header
offset 76, while the matching `wvov-*` 60-byte metadata carries durable overlay generation
625 at overlay-meta offset 52. `crates/core/src/resume.rs:312-331` intentionally rejects
any unequal generations. That refusal is the required anti-corruption behavior: restoring
CPU/RAM generation 621 over disk generation 625 would be an unsafe rollback/mixed state.

This is postmortem state, not a timestamped refusal observation. The failed page had already
entered cold fallback and captured its failure before the copied profile was inspected, so
the record does **not** prove that durable generation was already 625 when
`restoreStoredSnapshot` made its decision. It raises the stale path from hypothesis to the
leading explanation, but the exact refusal still needs a live typed decision plus generation
at that point. The first inspection file, `failed-resume-metadata.json` (SHA-256
`8c4c8ccb676f7d3e2bab08eecea0e34535ef7e4e30fd981cccf0c82d91144b39`), is retained and
honestly empty because its original database-name filter omitted the actual `wvov-*` and
`wvsn-*` prefixes; the corrected record supersedes rather than hides it.

### Confirmed harness bootstrap defect

`installCheckpointSession` is registered with `page.addInitScript` at runner lines
216--223. Such a script runs on every navigation in the page. On the initial reuse load it
installs the sealed normal envelope, but the moving `persist:true` save legitimately replaces
that session value. The same init script then runs on the second navigation, compares the
moving envelope with the original normal value, and throws `refusing to overwrite a
different desktop session`. The existing unit fixture invokes the registration function
repeatedly in one fixed sandbox; it does not model one registered init script executing in
successive document realms after the application evolves session storage.

The narrow repair is an origin-scoped, one-shot bootstrap: on the first eligible navigation,
install the exact sealed checkpoint only if the target slot is absent (or already exactly
the sealed value), and still refuse an unrelated pre-existing value. Once that bootstrap
has succeeded, later navigations must be inert and must neither compare against nor overwrite
the application's evolved moving envelope. Navigations at another origin must not consume
the one shot. A deterministic test should execute the **same registered initializer** over
two target-origin navigations: first seed the normal value, let the simulated application
replace it with a distinct moving record, then prove the second navigation preserves that
record without throwing. Initial foreign-value refusal and off-origin inertness remain
load-bearing.

### Required stale-safe drag boundary

Do not weaken `RestoreDecision` generation equality, accept `stale`, or copy generation 621
disk state back over generation 625. Do not repersist only the desktop envelope while pairing
it with a later released whole-machine state: that would cease to be the required snapshot
during a drag.

The harness must instead make the persisted moving checkpoint the final guest-executing,
disk-committing boundary before reload. A sufficient harness-only sequence is:

1. Let the real pointer move execute and prove the guest window actually translated (S1).
2. Pause the machine, then take the existing `persist:true` moving snapshot while already
   paused. Its explicit overlay flush and whole-machine save establish one generation and
   leave the machine paused rather than automatically resuming it.
3. Release the host pointer while the guest remains paused. A nonpersistent released-state
   observation may be taken only if it also leaves the machine paused; it must not replace
   the stored moving envelope or whole-machine blob.
4. Reload directly. No guest run slice or automatic overlay persistence may occur between
   publication of the moving resume and navigation.

Equivalent sequencing is acceptable if it proves the same invariant. The next replay must
record, from the live run, the moving snapshot header generation, current durable/live
overlay generation and typed snapshot decision immediately after publication and again
after the host release/before reload. It must also retain the loader's exact
`restoreStoredSnapshot` decision or exception before any cold fallback. Expected safe values
are unchanged generation and `resume`; any advancement must remain an explicit `stale`
failure. This evidence both tests the ordering fix and timestamps the cause without changing
F's acceptance criteria or the disk-safety contract.

The one-shot session bootstrap defect and stale-safe sequencing are separate: fixing the init
script prevents a false foreign-envelope exception, while freezing guest/durable progress
after the moving snapshot prevents a genuinely stale machine/disk pair. Both must hold before
the second-restore diagnostic can be interpreted. Prior normal-restore, timing, H, T19a and
T26i results remain HELD; F remains unverified.

## Incremental stale-safe runner review — before replacement replay

I inspected the uncommitted incremental runner at SHA-256
`ec734b3fb22ef9279a7314701e4087e3b5d6a71dce04fa5b611e5a9b7d87184e` before any
replacement browser evidence existed. This is a pre-freeze source review; the coordinator's
forthcoming exact commit and test digests supersede these working-copy hashes.

### Predictions for the next replay

1. The retained drag movement will show the same titlebar row within one pixel, with a
   rightward `deltaX` in `[64, 96]` for the requested 80-pixel move, both immediately before
   and immediately after the controller reports paused.
2. The moving `persist:true` save will begin with the controller already paused and will
   leave it paused. Its returned overlay generation, live generation, final generation and
   stored snapshot decision will agree, and the decision will be `resume`.
3. The host pointer-up and released nonpersistent save will not resume the machine, alter
   the stored moving-envelope SHA, advance the generation, or change the decision from
   `resume` before reload.
4. The second navigation will preserve the evolved moving session record. The synthetic
   checkpoint bootstrap route will no longer exist and no old-normal-envelope comparison,
   overwrite, or page error will occur.
5. The second loader will complete whole-machine resume with no `booting`. If it does not,
   the record will retain the exact loader warning/exception and the pre-reload frozen audit,
   allowing the failure to be classified without accepting fallback.
6. Original timing remains frozen at the first restore's `completedAt` through the existing
   PCM/terminal end. Drag waiting, snapshot persistence, two snapshot-decision audits and the
   second restore cannot move or satisfy the unchanged two-second cap.

### Source disposition

The production runner now meets the requested sequencing boundary in source:

- `observedDragTranslation` reuses the existing `assertWindowMoved` oracle, requires a
  positive displacement of at least 64 pixels, caps it at 96, and separately rejects a
  titlebar whose top or bottom changes by more than one pixel. `proveAndPauseDrag` polls that
  live guest geometry for at most 15 seconds, pauses through the real controller, rechecks
  `isPaused`, and repeats the same geometry assertion after the pause. This closes S1 for a
  replay that retains these live values.
- The moving save runs only after that pause. Because `saveDesktopSnapshot` preserves an
  already-paused controller, the explicit disk flush and paired whole-machine publication no
  longer reopen a guest execution interval. Pointer-up, the released `persist:false` save,
  and the pre-reload audit all occur while paused.
- `auditFrozenDragSnapshot` is on the shared normal/completion path, not merely a diagnostic
  caption. Both after publication and immediately before reload it requires paused before and
  after the potentially long decision read, a safe integer generation equal to the snapshot's
  generation, unchanged final generation, decision `resume`, and the stored envelope SHA equal
  to the moving desktop snapshot. This refuses exactly the stale/mismatched states at issue;
  it does not weaken the core generation guard or roll disk back.
- Checkpoint hydration now uses one exact no-store/CSP-locked synthetic same-origin route,
  writes the sealed value once, removes the route in `finally`, and installs no persistent init
  script. Later application navigations therefore cannot replay the old normal envelope.
  Foreign initial data and origin mismatch still fail before mutation.
- Completion-only console retention observes subsequent loader warnings/errors without
  changing the existing browser-error policy. Generation sampling outside the two mandatory
  audits is likewise completion-only. Default runtime, WASM, guest clock, policy and original
  interaction timing are untouched.

### Current pre-freeze test blocker

The source is not yet ready for a browser record because its in-progress test fixtures lag the
new control flow. My direct combined Node run observed **82 passed / 6 failed**:

- `e5-t26f-browser-roundtrip.test.mjs` executes the new drag body without providing the
  extracted `waitFor` dependency and fails at `proveAndPauseDrag`; its expected action list
  also still describes the removed fixed 100 ms post-move wait rather than pause/audit calls.
- `e5-t26f-completion.test.mjs` has begun modeling real translation, pause and decision RPCs,
  but the extracted orchestration cannot resolve `recordCompletionGeneration`, causing five
  tests to fail before their intended cap/later-failure assertions.

These are test-integration failures, not runtime refutations, and Tesla already owns this
fixture update. Freeze and launch the replacement browser replay only after the same combined
test command is green and asserts: translation rejection, pause remaining true through release,
generation/decision/envelope mismatch rejection at both audits, and the second reload ordered
strictly after the final frozen audit. Sabotaging the pause or either generation equality must
make that focused sequence fail.

F1 also remains in the inspected source: an otherwise successful completion still marks
`diagnostic:completion-evidence` done, throws the retained cap, and lets the outer catch mark
that same phase failed and write a second misleading capture. The stale-safe replay can proceed
for localization once tests are green, but reaching the final completion path will exercise
this already-recorded reporting defect rather than resolve it. No F verification follows from
this diagnostic layer.

## Exact source freeze `19fbc770` — replay pending

Commit `19fbc77084a9c02ba0082369ada14abc52dd8e28` freezes exactly the runner,
its existing test file, and the read-only inspector; it contains no core, WASM, web runtime,
image, clock, policy, or acceptance-default change. The committed runner is byte-identical
to the pre-freeze source reviewed above (SHA-256
`ec734b3fb22ef9279a7314701e4087e3b5d6a71dce04fa5b611e5a9b7d87184e`). The committed
existing-test SHA-256 is
`0fa8803ebee0786ba76e1cd427b634b33c96995f00054ef26f3a34f538908e99`; the inspector
remains `4d2fd88d08c6ca9e775bd2bc27ce3cf9ba4e1bc2d40183cac19e898fe4966173`.
`git diff --check 856f3e78..19fbc770` passes.

The frozen logic preserves every stale-safe property in the preceding review. In particular,
the two mandatory `auditFrozenDragSnapshot` calls are shared by ordinary acceptance and
completion, whereas the extra per-save generation observations and warning retention remain
completion-only. Thus the correctness gate does not depend on diagnostic instrumentation:
ordinary F also cannot reach its second reload unless real translation is observed, the machine
is paused, the stored moving envelope matches, and the whole-machine decision is currently
`resume` at an unchanged generation.

The earlier **82/88** fixture failure is superseded. Tesla completed the extraction wiring while
this source-frozen replay was starting. I independently reran the current pair and observed
**88/88 pass** in 227.6 ms; the current completion-test SHA-256 is
`a7d61f12885482167bf5490acbbd89bb5722782a3f683eeb2ba8e4755e3a7cf4` and the coordinator's
combined helper log SHA-256 is
`a7ded0c7400e95824ccdd7e9ab20f09f0f3e268259c550c0e31616a9e1584316`.
That completion test was still outside commit `19fbc770` at review time, so its eventual frozen
integration must retain the same digest or be reviewed as a later harness layer.

No new semantic finding appears in the exact frozen stale-safe diff. Before treating its replay
as sufficient, the final helper set should make the new predicates demonstrably load-bearing:
wrong-row/stale/leftward/under-64/over-96 geometry, false or lost pause, changed/fractional
generation, non-`resume` decision, and changed session-envelope SHA must each refuse before the
second reload. The current replay is judged only after it closes and its retained live values can
be compared with the six predictions above. The original 5.014-second cap failure, first failed
second-restore record, F1 reporting issue, and non-verification status remain unchanged meanwhile.

## `19fbc770` replay — old geometry oracle correctly refused a false drag

Prediction 1 did not hold in this replay, but the failure localizes to the F harness's window
selection rather than to guest drag handling. The canonical failure record is
`run-19fbc770/failure-drag-guest-translation.json` (SHA-256
`7f564e3db2f97e59fb041a6cdd925d78f136f41e45034b4134e2a4d667095b73`); its inspected PNG
(SHA-256 `7287f1999a3e4b0f5889d9201dd052fdd93f2e44cb888ace0b69c089f25eb27f`)
shows two overlapping Foot windows. The detector reported one merged titlebar
`{left:115,right:1253,top:13,bottom:39}` before and after the attempt, while the upper Foot
window actually starts near x=559. Consequently the derived click at guest x=215 landed on
wallpaper, not that window's CSD. The pointer trace still records the requested host-side move
from x=5312 to x=7552, but `dragMovement.translation` remains null and the bounded guard fails
with `guest window did not complete the requested 80px drag`. This is direct evidence that input
coordinates and host pointer-frame deltas alone do not prove the task's guest-window-drag
criterion.

The failure is a **HELD safety result** for the new movement guard: it refused unchanged guest
geometry after 15 seconds. It did not pause the machine, publish a moving persisted snapshot,
run either frozen-generation audit, or attempt the second reload. Thus it neither tests nor
refutes the stale-safe sequencing reviewed above. Normal resume remained functional at generation
621 with matching CRC `09c5c407`, fresh HELLO generation 2, terminal completion and real PCM; the
unchanged interaction cap still failed at 4950.235 ms. The adjacent transcript SHA-256 is
`fad7ae78bd1557b7fa5da6da381c94203cbb365027939238c1c9d7864d82716c`.

### Minimum geometry repair boundary

The next harness-only detector must identify one window from a stable cohort of **contiguous dark
runs**, not from each row's global first/last dark pixel and not from the full vertically connected
overlap of both windows. In this fixed two-window fixture, a sufficient predicate is the earliest
post-panel body cohort (`y >= 32`) whose same contiguous run has width at least 240 pixels across a
bounded initial band (approximately 32 rows), with row-to-row overlap/edge continuity tying both
edges to that one upper Foot window. Aggregate dark-pixel count across both windows is
insufficient. Ambiguous qualifying cohorts must fail instead of choosing one using the requested
80-pixel displacement.

The titlebar click must then be derived from that cohort's corresponding CSD and placed below the
32-pixel panel occlusion with an interior margin (near the bottom of the 26-pixel titlebar), while
remaining inside the selected window horizontally. The same independent detector must run before
and after input; it may accept only an unchanged titlebar row within one pixel and a rightward
translation in `[64,96]`. Persist both detected bounds and the chosen click point so the replay is
auditable.

Focused regression coverage should reproduce the overlapping-window image geometry: the old
global-edge method merges x=115..1253, whereas the new cohort selector chooses the upper window.
Moving only that upper cohort by 80 pixels must pass; unchanged pixels despite an 80-pixel host
pointer move, moving only the lower window, a single noisy row, panel-occluded clicks, and ambiguous
same-height runs must refuse. Sabotaging the selector back to global/full-height edges must fail
this fixture. No web/runtime detector or guest semantics need change.

This replay remains diagnostic and **does not verify F**. It is retained as proof that the prior
predicate caught the false drag claim; a corrected replay must still exercise real translation,
pause, persisted moving publication, both frozen-generation audits, and the second restore. F1's
duplicate final completion capture also remains open if that tail is reached.

## Geometry replacement freeze `0f467689` — pre-replay review

I reviewed commit `0f4676893292377376e4b82c28d15f02ce6c4d2f` before inspecting its in-progress
browser replay. The diff is limited to the F runner and one existing fixture adjustment; it
does not change served JavaScript, WASM, the guest, persistence semantics, defaults, or the
two-second deadline. `git diff --check 19fbc770..0f467689` passes. The frozen runner SHA-256
is `5407b3c2a889fcb23fb31b5c0936588f696d9b6d7e1e9b31d2170272d5ebe34d` and the committed
existing-test SHA-256 is
`e70e16e53f9cbd80154bc073834f095cda163c1bd5f25d1f232b783804658623`.

### Falsifiable predictions

1. The first real `readTopmostDragTitlebar` observation will be approximately
   `{left:557,right:1253,top:13,bottom:39}`, not the old merged x=115..1253 result.
2. The derived guest click will be x=657, y=36: horizontally inside the selected upper Foot
   CSD and vertically below the 32-pixel panel. The input trace will retain this mapped point.
3. After the requested 80-pixel host drag, the independently repainted framebuffer will report
   the same titlebar row within one pixel and a rightward guest delta in `[64,96]`. Unchanged
   pixels or movement of only the lower window will still time out before persistence.
4. The paused re-read will retain that translated geometry. A repaint that disappears or changes
   target while pause settles will fail before the moving save.
5. Only after predictions 1--4 hold will the runner publish the moving checkpoint and execute the
   two unchanged generation/decision/envelope audits. Their expected values remain paused,
   unchanged generation, `resume`, and the exact moving-envelope SHA.
6. The retained original timing cap will remain failed; successful geometry cannot alter the
   frozen first-restore start or immediate terminal/PCM end.

### Static disposition and pending coverage

The callback is self-contained for `page.evaluate` and reads painted canvas pixels rather than
host pointer state. It starts below the panel, accepts only the first 32 consecutive rows having
at least 240 dark pixels, and requires each independently selected modal edge to occur on at least
24 of those rows. For the fixed captured fixture, those early rows precede the lower Foot body and
therefore avoid the full-height overlap that produced the x=115 edge. The titlebar is reconstructed
26 pixels above the first body row; `bottom - 3` yields the supplied y=36 and the explicit panel
assertion fails closed if that decoration is fully obscured. The same reader is used for initial,
moving and paused observations, while the existing 64--96-pixel movement bound remains unchanged.

The helper still computes each qualifying row's global dark extrema rather than horizontal
connected runs. That is sufficient only because this is an explicitly fixed two-window fixture
and the retained real PNG establishes that its first qualifying cohort contains the upper window
alone. Regression coverage must keep that premise load-bearing: decode the retained `19fbc770`
PNG through the pinned decoder and assert 557..1253/13..39 and aim 657/36; synthesize the actual
overlap so the old full-height method returns 115..1253; then require unchanged paint, lower-window
movement, broken/nonconsecutive cohorts, unstable modal edges, and panel-obscured aim to refuse.
A sabotage that restores the old global full-height detector must fail the retained-PNG case.

Commit `0f467689` itself does not yet contain those promised real-PNG and synthetic geometry
tests; its only test hunk stubs the new reader in an unrelated generation-order fixture. That is a
pending coverage item, not a source refutation, while Hooke and Tesla finish the focused helper
tests. The browser replay is judged only after it closes. F remains unverified and F1 remains open.

## `0f467689` replay — real translation observed, compositor clamp rejected

The replacement reader fixed the false target. The canonical failure JSON
`run-0f467689/failure-drag-guest-translation.json` has SHA-256
`b5de3e64068c4ef88c9d58af89ea5ca331496b12b1113c4e09f424d9a6a311d7`; its inspected PNG has
SHA-256 `f9fe96457e3729795071e8188da4868217d1d1629c9dcb22f39197d0b3b36140`.
Before input the reader reports the predicted upper Foot bounds x=557..1253, y=13..39. After the
drag, both the pixels and screenshot show that same window at x=644..1280, y=32..58: +87 pixels
horizontally, a preserved 26-pixel titlebar height, and a +19-pixel vertical move to the exact
32-pixel Weston work-area boundary. The visible pointer is on the moved upper CSD. This is now
positive evidence of actual guest-window translation, not merely an 80-pixel host pointer event.

Prediction 3's horizontal component HELD (+87 is within `[64,96]`), while its same-row component
FAILED because it was over-specific. Weston legitimately clamps a window whose titlebar began
partly beneath the panel down to the work area when the user drags it. The guard therefore timed
out with `translation:null` even though S1's real-translation subclaim is visibly true. It again
stopped before pause, moving persistence, frozen-generation audits, and second reload, so the
full during-drag snapshot/restore criterion remains unexercised. The unchanged timing cap failed
at 5136.195 ms. The adjacent transcript SHA-256 is
`62a7b0fb9b07d6305f95728cb8384d6ba122a5c9009868a38c0a4fe4f9df8cd9`.

The narrow follow-up predicate is bounded in source: retain titlebar height within one pixel;
allow either an unchanged top within one pixel or an after-top within one pixel of
`max(32,before.top)`; reject every other vertical jump; and retain the rightward 64--96-pixel
horizontal bound. This accepts 13..39 to 32..58 without making a distant row eligible. The source
explicitly treats after-top 31, 32 or 33 for a before-top of 13 as bounded detector rounding around
the 32-pixel panel clamp, consistently with the unchanged-row ±1 tolerance; this does not loosen
F's requirement for a real during-drag observation. Tests must include the exact +19 clamp,
accepted 31/33 rounding boundaries, unchanged-row success, changed-height refusal, and arbitrary
vertical moves outside both permitted ±1 bands refusing. The pre/post reader remains identical.

Refreshing `desktopBox()` immediately before mapping the drag is also correct: the reader's values
are backing-canvas coordinates, while `guestPoint` must use the canvas's current CSS rectangle.
This call occurs after the original interaction end was frozen and cannot affect the two-second
measurement. The next replay should retain the current box and mapped start/end points, pass the
movement guard, then exercise pause and both stale-safe audits. F remains unverified; the replay
adds a HELD actual-translation component but not a restored moving-checkpoint result.

## Final harness candidate `4ae44f3f` — pre-replay coverage review

I reviewed commit `4ae44f3ff8294e5e2a6c5c5ba7e08a9cdf1d3a66` and its committed tests before
inspecting the in-progress `run-4ae44f3f` browser record. The diff from `0f467689` is confined
to the F runner, F test/Make wiring, retained diagnostic PNG fixtures and their recorded Node
test output. It does not change the served runtime, image, guest, persistence semantics, default
policy, acceptance mode, or two-second deadline. `git diff --check 0f467689..4ae44f3f` passes.

The frozen runner SHA-256 is
`1643d474304f38bd821d4396bffcc8de4b7ef419b105aa5e2725a289467ebdf9`;
the completion test SHA-256 is
`9cc51437336e9cdbb961a4382d394362d32a5cde591c52dbb8ac136c5104efd6`;
the geometry test SHA-256 is
`9451c214ed64105c014df64e3870786e105fae16880de265bb2641b1854bb228`.
The committed `final-pre-replay-tests.log` (SHA-256
`bd9f88b3c73eb3ca1864bdf704167093b8de80f31bd1f53d7593564b8bd09a9c`) records
115/115 passing tests in 224.800 ms.

### Coverage disposition

The geometry suite executes the helper extracted from the frozen runner, not a copied oracle. It
checks synthetic diagonal overlap, panel exclusion, 32-row continuity, 24-row modal-edge stability,
cursor outliers, ambiguous/tied edges, right clipping, stale/absent/wrong-direction/wrong-window
movement, horizontal 64/96 boundaries, original-row and panel-clamp ±1 bands, titlebar-height ±1,
and rejection outside those bands. More importantly, it decodes both retained browser PNGs through
the pinned Playwright PNG implementation, derives the canvas crop from exact focus-outline pixels,
and proves 557..1253/13..39 followed by 644..1280/32..58 and deltaX=87. The retained fixture
SHA-256 values remain
`7287f1999a3e4b0f5889d9201dd052fdd93f2e44cb888ace0b69c089f25eb27f` and
`f9fe96457e3729795071e8188da4868217d1d1629c9dcb22f39197d0b3b36140`.

The completion suite now executes the real movement/pause/coherence helpers and attacks pause loss,
superseded geometry, 15-second timeout, stale/advancing/fractional generations, non-`resume`
decisions, malformed/mismatched session envelopes, and failure before reload. It also requires the
fresh `desktopBox` read before the first mouse move. The runner records `dragMapping` with the live
canvas rectangle, client start/end and guest start/end before input; the replay should therefore
show that x=657/y=36 was mapped through current layout rather than the stale timed-interaction box.

I sabotage-checked the new geometry suite in an isolated `/private/tmp` copy by changing only the
cohort scan start from y=32 to y=277, which selects the lower/merged overlap. The suite failed 9 of
13 tests, including both retained-PNG tests; the synthetic result moved to x=115..1253/y=251..277.
Thus the topmost-cohort boundary is load-bearing rather than a self-licking expected value. The
scratch copy did not alter the workspace or active replay.

### Replay predictions

1. `dragMapping` will retain the current canvas box, guest start 657/36 and guest end 737/36, with
   corresponding finite client coordinates and an 80-pixel guest request.
2. Painted geometry will move right by 64--96 pixels and either remain on its row or enter the
   bounded y=32 panel-clamp band with preserved height. The paused re-read will retain that target.
3. The guest will be paused before the persisted moving save. Both frozen audits will observe the
   same safe integer generation, `resume`, the exact moving-envelope SHA, and paused state at both
   endpoints; no guest/disk progress will occur before reload.
4. The second loader will restore the exact moving snapshot without cold boot, matching its repair
   CRC and whole-machine metadata, release the held pointer, then pass the existing drag coherence
   audit.
5. The original terminal/PCM interaction will still exceed two seconds, remain `checksPassed:false`,
   and be rethrown after functional diagnostics. No completion result can verify F.

F1 remains unchanged in this source: `finishDiagnosticCompletion` writes the completion result,
marks `diagnostic:completion-evidence` done, then throws the retained cap into the outer catch,
which marks that same phase failed and writes a second failure capture. The new tests assert the
first retained timing capture and final result but do not assert a single final capture or prevent
this duplicate. If the replay reaches the tail, it should expose this already-recorded reporting
defect; it does not invalidate earlier functional milestones, but the diagnostic artifact set is
not yet internally clean. F remains unverified pending the closed replay.

## `4ae44f3f` headed replay — preserved contaminated-input hypothesis

The canonical failure JSON SHA-256 is
`b3a87ebe7b242dbf45f6d3ca9ed47cdf85de1e4964ba395df47a87e59424a706`; its inspected PNG
SHA-256 is `a4729ebdc14e422d3975f3e639e170e20e09d400bea405c1a490c1bd7427f68e`, and the adjacent
transcript SHA-256 is `5bb55acabcb75eedf624e154dad8b75c42493e45c7f2e5b0ebed41afd486bad9`.
The record is retained as a real failure, not discarded or replaced by a fastest successful run.

Prediction 1 HELD exactly: `dragMapping` records canvas client box x=80/y=85/1280x800,
guest start 657/36 and end 737/36, and client start 737/121 and end 817/121. Nevertheless,
painted geometry remained 557..1253/13..39 and the 15-second movement guard correctly timed out.
The screenshot shows the pointer on the intended upper CSD but no window translation. The original
interaction cap independently remained failed at 4892.950 ms.

The same record contains an abnormal input burst: terminal state reports 125 pointer frames versus
the small scripted sequence expected around this phase. Its retained sample has unrelated absolute
pointer moves at sequences 110--122, nearly all stamped 56,211--56,212 ms, traversing widely varying
coordinates. Only then do sequence 123 reach the scripted guest start, sequence 124 press BTN_LEFT,
and sequence 125 reach the scripted endpoint. This temporal burst is concrete evidence of external
headed-session input interference and makes environment contamination a credible hypothesis (for
example, flooding or displacing the critical input sequence); it is not by itself proof that
contamination caused the missed guest drag.

One predeclared fresh headless create followed by one completion reuse is therefore a legitimate
bounded isolation experiment, not pass selection, provided the new checkpoint is separately bound
to `headless:true` and the same exact Chromium version, runtime, image, command, policy and delays.
The headed profile and this failure must remain immutable. The headless replay must still record its
own mapping and pointer-frame sample. If it has only the bounded scripted input and reaches real
translation, the contamination hypothesis is supported; if it again misses movement with clean
input, the hypothesis is falsified and the harness/input path remains the finding. Either outcome
retains the unchanged F cap and cannot verify F. No harness or runtime change is justified by this
headed failure alone.

## F2 — ordinary normal snapshot can resume before reload

The current head has an analogous, previously untested gap on the **default acceptance** normal
save path. At runner line 1448, the caller explicitly pauses before the persisted normal snapshot
only when `diagnostic` is truthy. `saveDesktopSnapshot({persist:true})` itself observes whether the
controller was already paused, pauses while pairing disk/CRC/machine state, but resumes in its
`finally` when it entered from a running controller (`web/desktop-terminal.js` lines 489--530).
Ordinary acceptance therefore publishes the persisted normal envelope and machine snapshot, then
restarts guest execution before `reloadWithAutoRestore` begins at runner line 1484. It performs no
intervening frozen generation/decision/envelope audit.

This is the same class of harness race that made the old moving checkpoint stale, although the
normal interval is shorter and no failure is asserted without a repro: guest disk progress after
publication may advance the durable overlay and correctly make the stored machine snapshot stale
before navigation. The core stale-disk refusal must remain unchanged. Recent diagnostic records do
not cover this branch: diagnostic **create** pre-pauses and closes the profile while paused, while
diagnostic **reuse** consumes that already-sealed normal checkpoint instead of executing the live
default normal-save sequence. Thus the held diagnostic normal restore cannot be generalized to
default acceptance.

The minimum harness proof boundary is to enter the normal persisted save already paused for every
path and remain paused through immediate reload, with a fail-closed assertion that pause was
actually achieved. A pre-reload observation of paused state, unchanged snapshot/current generation,
decision `resume`, and exact stored-envelope SHA would make the boundary directly auditable, as it
is for the moving snapshot. Focused tests should execute `diagnostic=null`, prove no resume occurs
between normal publication and reload, and make an omitted pause or advanced generation refuse.
This does not alter F's criteria or runtime semantics.

F2 does not invalidate the currently running headless diagnostic create/reuse experiment, because
that seal is deliberately created paused. It does mean a later successful diagnostic completion
is still insufficient for the default `make verify-E5-T26f` claim until this distinct ordinary
normal-save boundary is closed and exercised. F remains unverified.

## Headless completion — restore admission observation is discarded

The closed headless reuse materially advances the functional proof. Its canonical
`failure-restore-drag-coherence-audit.json` SHA-256 is
`4acba52c35a5c01c451e0ddbd0a3e58a5d8ccdf6f489b1c1da573cbf18d14142`; the inspected PNG
SHA-256 is `ede8d63830a880dfb74fa5f50c0eb0ba4f9df9f21b94b8c12f394dafb7ece8a6`, and the adjacent
transcript SHA-256 is `e93e80f42103fc2dd187bcb8963f8dd6f350eaf86b0c80c8c84d36cab67845f5`.
The separately authenticated headless seal remains bound to checkpoint generation 627, snapshot
SHA `3dee2e4deb67a31e3b1c2a8fa217985a88f6be28a70738a5217d791bd6f97acf`, CRC `de9083e3`,
Chrome 152.0.7977.76 and `headless:true`.

The clean headless run supports the headed-contamination hypothesis: mapping is guest 657/36 to
737/36, the upper Foot window moves exactly +80 to x=637 with the expected y=32 panel clamp, and
the independent paused read retains the same 637..1280/32..58 geometry. The machine is paused
before moving persistence. Snapshot
`01e516cb885cc772725988923f86b148c9a570c7eed98ccb139b19f5c6e2a8ba` freezes CRC
`68fb7727` at generation 627. Both Published and BeforeReload audits observe paused/still-paused,
generation/finalGeneration 627, decision `resume`, and that exact stored envelope SHA. Prediction
1 through the pre-reload portion of prediction 3 therefore HELD.

The second reload then reports a first-present CRC of `68fb7727`, fresh HELLO generation 2, only
fetching/instantiating/restored boot states, no `booting`, exact moving snapshot/whole-machine
metadata, full repair frame and released button; its display/button checks pass. The screenshot
visibly retains the moved upper window. The original interaction independently remains a failure:
5059.890 ms with 1440 written / 960 non-silent fresh PCM frames. None of these facts waive the cap
or verify F.

The later coherence failure does **not** establish that loader admission rejected the snapshot.
It exposes an observation-order defect. `loader.js` lines 667--675 call
`machine.restoreStoredSnapshot()` and set `restoredFromStoredSnapshot=true` only when its typed
return is `resume`; the Rust method checks build/base/current generation and applies the blob only
on that decision. But the loader discards the decision and generation. The harness initially sets
`result.resume.snapshotDecision` and `overlayGeneration` to null, lets the restored guest run, and
only at `auditRestoreCoherence` lines 1239--1248 asynchronously re-reads the entire stored blob and
compares it with the **then-current** generation. In this run that post-use query occupies about
30.1 seconds while the guest remains running; durable generation legitimately advances from 627 to
648, so the old checkpoint now returns `stale`.

Accepting that late `stale` as proof would be wrong, but requiring an already-consumed checkpoint
to remain reusable after allowed guest writes is also wrong. Pausing immediately before the late
audit can stop further advancement but cannot prove what happened between loader admission and the
pause. The narrow proof fix is to retain a typed loader admission observation at the actual
`restoreStoredSnapshot()` call: source=`stored`, decision=`resume`, restored=true, and the machine's
overlay generation immediately after load, before the guest run loop starts. Expose that immutable
scalar observation to `waitForReadyAndRestore`; require its admission generation to equal the
snapshot's generation and separately retain the existing no-boot/CRC/HELLO/display checks. A
fallback boot snapshot must not be able to satisfy a stored-resume observation.

The later lifecycle query may be retained diagnostically, preferably after pausing, but it must not
replace admission proof. If current generation still equals admission generation, `resume` remains
expected; if it has advanced, `stale` is the expected validity of the **old stored checkpoint** and
must be labeled post-use invalidation rather than restore coherence. Tests should cover stored
`resume` at N followed by guest advancement to N+k/stale, stored `stale` followed by coherent boot
fallback (must fail the stored-resume criterion), missing/malformed admission fields, and admission
generation mismatch. This changes browser observation only; the core stale guard remains strict.

Accordingly the headless run proves real drag, paused publication, both pre-reload frozen audits,
second-load display identity and post-restore functionality, but the exact stored-snapshot admission
boundary is not retained. F1 was not reached and remains open; F2 remains open for ordinary default
normal-save sequencing. F remains unverified.

## Scoped remediation design review

No semantic refutation of the proposed loader-boundary observation was found. Capturing
`restoreStoredSnapshot()`'s actual typed decision and the machine's overlay generation in the loader
before its run loop starts closes the precise proof gap without weakening restore selection,
re-reading a consumed blob, or changing core/device/snapshot formats. The immutable observation
must originate in the loader (including `source:"stored-restore-boundary"`), be fresh per machine,
and be forwarded as already-captured scalars; the later getter/RPC must not recompute decision or
generation. A fallback boot restore must retain the stored attempt's non-`resume` result rather than
masquerade as a stored restore.

One condition is load-bearing for runtime noninterference: obtain the restore decision first, and
isolate the subsequent `machine.overlayGeneration()` metadata read from the existing restore/fallback
catch. If generation capture throws after `restoreStoredSnapshot()` has successfully applied the
machine, that evidence error must not trigger fallback or alter `restoredFromStoredSnapshot`; record
the metadata failure and let F's audit fail later. Similarly, the read-only evidence getter should
return a copy of the frozen scalar record rather than a mutable closure object.

F should require `attempted:true`, loader-owned source, decision `resume`, a safe integer admission
generation equal to the saved generation, and stored-restore success. Current live generation may
then be recorded separately and must be a safe integer greater than or equal to admission. A later
`stale` decision is not needed to prove restore and must never substitute for admission evidence.
Tests should include: stored resume at N followed by live N+k; stored stale/missing/error followed by
successful boot fallback (F still refuses); malformed or absent evidence; admission-generation
mismatch; getter immutability; and a forced generation-metadata exception that leaves the successful
stored restore/fallback control flow unchanged.

The paired harness fixes are also correctly scoped. F2 must pause and assert paused before every
normal persisted save, remain paused through its pre-reload generation/decision/envelope audit and
reload, and exercise `diagnostic=null`. F1's bypass must use exact error-object identity set only
after the truthful completion artifacts are durably written: the outer catch should skip only the
duplicate phase-failure/capture for that sentinel, still rethrow it for exit 1, and capture every
other error normally. Tests must assert one retained timing capture, one completion result, no
`failure-diagnostic-completion-evidence` artifact, final phase `done`, and the same original cap
object at process failure. A new seal is required because loader/worker served bytes change; the old
headless seal remains immutable evidence.

## Pre-build remediation review — current unfrozen candidate

The current scoped source change has no core, device, Wasm, snapshot-format, or default timing
mutation. Against `4ae44f3ff8294e5e2a6c5c5ba7e08a9cdf1d3a66`, the semantic changes are confined to
the loader's retained observation, one forwarded worker method, and the F harness's F1/F2/receipt
audits. The earlier headless success through real drag and moving restore, its late stale-query
failure, and the unchanged 5059.890 ms cap failure remain the applicable evidence boundary.

The receipt implementation satisfies the load-bearing control-flow predictions. In
`web/loader.js:671-693`, the awaited stored restore completes before generation is sampled; the
generation read has its own catch and therefore cannot turn a successful restore into fallback;
the initial result is frozen before the guest loop; and `web/loader.js:1126` returns a copy. A
stored `stale`, `missing`, `corrupt`, `foreign`, or thrown restore remains distinguishable even if
the separate shipped fallback later succeeds. The F audit consumes that retained receipt and
requires attempted=true, decision=`resume`, a safe nonnegative admission generation equal to the
saved generation, and a non-regressing current generation. It no longer asks the live guest whether
the old consumed checkpoint is reusable.

F1 also holds under sabotage. The runner records the exact cap object only after both completion
files and stdout are written, and the outer catch bypasses duplicate capture only by object identity
(`tools/verify/e5-t26f-browser-roundtrip.mjs:561-568,1889`). In the isolated copy
`/private/tmp/e5-t26f-receipt-sabotage.FgqKN7`, replacing identity with equal-message comparison
made the focused suite fail exactly `F1: only the identical successfully reported cap bypasses
outer failure reporting` (28 pass / 1 fail): a distinct same-shaped error escaped capture. The
unaltered candidate passes that attack. F2 likewise now pauses and confirms paused for every normal
save, publishes while paused, and runs the same generation/decision/envelope audit before reload
(`tools/verify/e5-t26f-browser-roundtrip.mjs:1465-1485`); its fixtures make a false pause or an
advanced generation fail before acceptance.

Independent execution of the five focused files produced 144/144 passing tests in 253.832375 ms:
the 19 actual-loader/linked-protocol receipt results, 29 completion/F1/F2 results, 77 existing runner
results, 13 geometry results, and 6 residency collector results. The worker's retained helper log SHA-256
is `ff38e20d4d39478f55e454d21293b59cdf6dfe7a25c8bea2cbd12ae666797a2b`; its 68-test
web-adapted log SHA-256 is
`bc4dc2fcad3ca37e42c80f294e03b896ff53b6a29544a1e023cb80b8636de850`. Scoped
`git diff --check` is clean. The new receipt tests are production-boundary extractions rather than
a duplicate implementation: they exercise the actual loader block and actual linked worker RPC,
including metadata-read failure, delayed restore, fallback non-overwrite, immutable copies, and
post-restore live advancement.

### R1 — loader provenance label is not part of the retained receipt

One narrow evidence-authorship gap should be corrected before the served-byte freeze. The immutable
loader observation contains only `{attempted, decision, overlayGeneration}` at
`web/loader.js:671-680`, but the later F harness assigns
`result.resume.source = "stored-restore-boundary"` itself at
`tools/verify/e5-t26f-browser-roundtrip.mjs:1255`. The runner test asserts its own assigned string,
so that assertion cannot falsify a receipt sourced elsewhere. Decision and generation remain genuine
and this is not a restore-semantic refutation, but the report must not present that string as
loader-owned provenance.

The smallest correction is either to include a fixed `source:"stored-restore-boundary"` in every
loader-created observation (including not-attempted/error records), forward it unchanged, and require
`receipt.source` in the F audit/tests, or to remove the source field and claim and identify provenance
solely by the typed getter. The former matches the predeclared design. No additional runtime,
snapshot-format, browser criterion, or native gate follows from this finding.

Subject to R1 and a fresh seal because the served loader/protocol bytes changed, this candidate is
ready for the bounded browser replay. That replay must still fail the original 2-second cap unless
the measured workload genuinely meets it; passing the repaired receipt/F1/F2 functional path alone
cannot verify F.

## Post-build pre-freeze recheck

R1 remains unresolved in the built candidate and is the sole concrete pre-run blocker. Source and
dist are byte-identical (`web/loader.js` and `web/dist/loader.js` SHA-256
`9cba0189542ac5917793008a406bfd1054f8498b1f0926ec21c4df0ecc05b335`; both protocol copies
SHA-256 `74371557f737f07c59881d404817b30c040f9ad6a207a9c6871db73019eec5d2`), so the built page
faithfully contains the issue: the loader receipt still has no source field, while the runner at
line 1255 assigns the provenance label itself. The current tests likewise assert the runner-created
label rather than a loader-created scalar. Correct or remove that claim before freezing/sealing;
browser success cannot make a self-authored provenance assertion independent.

The F2 phase-order adjustment is correct: `snapshot:normal` is marked done only after the normal
snapshot has been saved while confirmed paused and `auditFrozenSnapshot(..., "normal")` has passed.
Thus a failed pause or frozen-pair audit cannot leave a success-shaped phase. F1's exact-object
sentinel remains correctly ordered after durable completion writes. No other blocking source-level
finding emerged, and no core/device/snapshot-format or 2-second acceptance boundary changed.

## R1 closure and frozen pre-run disposition

R1 is closed by the explicitly offered removal route. The runner no longer creates
`result.resume.source`, no assigned-string assertion remains, and the regression now requires that
`resume` have no own `source` property. A scoped search finds no `stored-restore-boundary` or
`resume.source` claim in the runner, loader, protocol, or focused tests. Provenance is now stated
only by the typed `storedSnapshotRestoreEvidence` loader getter and its real linked worker-protocol
method; its attempted/decision/admission-generation values remain loader-captured and immutable.

The final helper rerun records 144/144 passing tests in
`r1-final-helpers.log`, SHA-256
`4b1be81a0f5f38285abec9962b22cffc16ea7c8f9df12fd63c87dbffc8b7cc2c`. The harness-only
removal changes no served bytes: source/dist loader parity remains exact at SHA-256
`9cba0189542ac5917793008a406bfd1054f8498b1f0926ec21c4df0ecc05b335`, and source/dist
protocol parity remains exact at SHA-256
`74371557f737f07c59881d404817b30c040f9ad6a207a9c6871db73019eec5d2`. The held Wasm digest
is unchanged as reported (`30c8f2ab3b1f3c25db77c03d6161d39e55de7ea3d88447f83f5d7942952c3a28`), and the built demo record independently shows 126 passed,
0 failed, `errors:[]`, and E5-T26f visibly `IN PROGRESS`:
`completion/demo/demo-suite.json` SHA-256
`3ea6dae46589741bd8a2c95a934c5ec6e6cff9049629a6697604477d9c533ab4` and inspected PNG
SHA-256 `e6ea1e7082e148c59354ce698dd914a64d43ce6c636ddb960913f4ca14715fe0`.

There is no remaining pre-run source refutation. The fresh headless create/reuse is still required
to exercise the changed served receipt boundary and repaired F1/F2 sequencing. Its functional
success would not waive the unchanged two-second acceptance cap.

## Frozen 32841587 cold-create failure — shifted physical input

The attempted fresh headless create at frozen head
`32841587c1ace8e8f08b0ac69d05aecce5d67248` produced no seal and cannot be reused. Its canonical
failure JSON SHA-256 is `84f262fbab05a209f33b6b75f2cc2d80a79ac65c5160958b4dcc19da0d829c2f`, inspected PNG
SHA-256 `e9da14d31d765337d6ae71e6ecdad922187d52d3f30c7d51b68f06f664d927df`, and transcript
SHA-256 `0635b9b3d0a16e9280c390c8b76853027587d8943fc6b1867f9279e55d8975d6`. The screenshot shows
the shell's `>` continuation prompt after a visibly malformed/truncated quoted command. The marker
never appears and PCM write index remains zero. The 240-second wait therefore proves neither an
audio hang nor a receipt failure; command parsing never reached `aplay`.

The browser-side event record falsifies simple DOM-event omission. The successful unshifted
50-character shell probe requires 100 character transitions plus Enter down/up and records exactly
102 keyboard frames. The 208-character audio setup contains 18 characters routed through
`shiftedPhysicalKey`: 190 unshifted characters at two transitions, 18 shifted chords at four
transitions, plus Enter down/up totals exactly 454. The final terminal state records 556 frames,
exactly 102+454. Thus every planned browser/bridge transition was emitted; loss is downstream of
that observation boundary.

The timing asymmetry is concrete at runner lines 1092--1102. An unshifted character uses
`keyboard.type(character,{delay:100})`, placing the delay between its keydown and keyup. A shifted
character emits Shift-down, an undelayed base-key press (base down/up), and Shift-up as a burst,
then waits 100 ms only after the whole chord. The existing mock checks character ordering and total
delay but does not model guest consumption of modifier transitions. The malformed quoted/redirection
tail is consistent with shifted punctuation being interpreted under stale modifier state; this is
a harness physical-input defect, not evidence against unchanged runtime audio or restore semantics.

The bounded remedy/proof is limited to `typePhysicalText`: pace the individual transitions of a
shifted chord while keeping Shift held for the base key, and add a deterministic regression that
fails the current zero-delay burst (including adjacent shifted punctuation and a shifted character
followed by an unshifted one). A direct browser/guest routing fixture should type a short quoted and
redirected command and require the exact guest-visible result before spending another cold boot.
Because the post-restore workload remains the unshifted literal `sh /tmp/a`, this setup-only repair
must not alter the original restore T0, command, key-delay setting, PCM criterion, or two-second cap.
The failed profile and six artifacts remain immutable negative evidence; do not select or reuse it.

## Archived-runtime typing probe — pacing hypothesis refuted

The bounded sidecar against a copied, digest-bound 4ae headless seal also fails before audio. Its
canonical JSON SHA-256 is `8c0b7ca4303769bdd843d55434106ab9b79a1542fee8211a2f8d18f1735daed5`, inspected PNG
SHA-256 `3c902ba724d48a8714062d8c3ac4a1c5a125c893cbefc29beb121193b54a1d2c`, and transcript
SHA-256 `a0c751837eb9e8ffa6fdfc5ecb7d7ed6025981be505ba2e7e99e4290a9b472de`. The screenshot shows
the received line starting with a truncated command and `/bin/sh: c: not found`; the independent
byte comparison does not succeed, `sh a` is not reached, the marker is absent, and PCM remains zero.

The 61-character probe contains 14 shifted characters, so its exact planned count is 47*2 + 14*4
+ Enter down/up = 152 transitions. Both `keyboardFrames` and `keyboardEvents` are exactly 152. The
25 ms helper additionally records separated ordinary down/up edges and a 120-second marker timeout,
yet the guest shell receives only a suffix/corruption. Consequently 25 ms per-edge pacing is not a
proven fix, and the earlier shifted-only stale-modifier explanation is refuted. This result remains
an input-delivery/focus/readiness failure, not an audio result.

The earlier assumption that the restored browser necessarily retains its assembly-time 2048 budget
is withdrawn. The assembly initially sets `INTERACTIVE_PENDING_EVENT_BUDGET` at
`crates/wasm/src/lib.rs:2486-2494` (2048 at
`crates/core/src/dev/virtio/input/keyboard.rs:32`), but the input snapshot wire explicitly encodes
`pending_event_budget` (`input/snapshot.rs:93-96,160-163`) and restore overwrites the fresh target
with that decoded value (`:248-251`). Each browser transition is an EV_KEY plus SYN_REPORT, so this
152-transition probe represents 304 pending input events. If the actual restored payload contains
the generic default 256 and the guest does not drain concurrently, the whole-frame enforcement at
`input/mod.rs:435-449` can drop complete queued frames; preserving a partially delivered head while
dropping middle frames is consistent with the observed first `c` plus later suffix.

That mechanism does not yet prove the koBy blob contains 256. The exact 4ae Wasm assembly also set
2048, the desktop entry point explicitly passes `bootSnapshot:false`
(`web/desktop-terminal.js:1162-1171`), and koBy was created as a fresh cold profile rather than from
a stored machine snapshot. Its normal snapshot should therefore contain 2048 by source inspection.
If direct decoding finds 256, that contradicts the recorded creation path and requires its own
provenance explanation. No budget/drop counter was recorded. Decode the VIRTIO_KEYBOARD input payload from the
immutable stored snapshot, or expose the already-existing read-only budget/drop scalars in a bounded
diagnostic, before naming overflow as the cause. Do not infer the value solely from the shell line.

Do not launch another cold create on the pacing hypothesis alone. The next bounded localization
should separate post-restore input readiness from shifted syntax: first require a short, entirely
unshifted guest-visible command to complete after the same focus path, then send the independently
encoded shifted-byte probe. If the unshifted preflight truncates, investigate the restore/focus/
virtqueue-consumption boundary; if it passes and only the shifted probe fails, modifier sequencing
remains localized. Preserve exact emitted/guest-visible text and counters rather than inferring loss
from host event totals. This diagnostic may not alter F's actual command or acceptance clock.

## Stored-input decode — restored-256 hypothesis refuted

The read-only TLV inspection resolves the restored-budget question. It copies the closed failed
profile, opens only read-only IndexedDB transactions, reads only chunks 0, 136, and 139 needed for
the section table/input payloads, and never boots an emulator. Result
`typing-probe-stored-input.json` SHA-256
`8acbd001b97bf12d284dc3938968585ba5172821e7076d82253de2835e9b74b9` is bound to the canonical
failed record SHA-256 `8c0b7ca4303769bdd843d55434106ab9b79a1542fee8211a2f8d18f1735daed5`.

At whole-machine VIRTIO_KEYBOARD tag 13 / section offset 146163050 / codec offset 146163345, the
stored version-1 codec contains budget 2048, pending frames/events/staged events all zero, and
dropped frames/events both zero. Tablet and mouse separately contain their expected generic 256;
that contrast is an additional parser sanity check. Thus restoration from this immutable checkpoint
cannot explain the probe as a serialized keyboard budget of 256. The stored record cannot reveal
post-failure live drops, so a Linux evdev/userspace overrun under interpreter load remains only a
hypothesis, not a finding.

One scratch-only 100 ms probe against another copy of the same profile is a legitimate next
localization. It must use the exact same 61-character conditional byte oracle, archived runtime
binding, and current helper hash, with the parser/default product configuration untouched; record
the explicit scratch override. A pass would show that this representative route succeeds at the
cold helper's per-edge pacing, not establish a universal threshold or prove an overrun cause. A
failure must stop the cold create. Either outcome preserves the failed 25 ms record and does not
prove the new receipt path, F acceptance, or the full 208-character cold setup command.

## 100 ms physical-routing localization — pacing boundary held

The single prescribed 100 ms scratch probe succeeds at the physical routing/audio boundary. Its
canonical failure-at-retained-cap JSON SHA-256 is
`36cdbb5cf6040247689287fd0529ac6fa8dc6645f9a9decb78bcb2a43275896e`, inspected PNG SHA-256
`fbcab7198546fd01bca9714eca2cc55e1bc7b9cee912e720f1608eca1cf04337`, and transcript SHA-256
`ec5455e2b92bf36616cd37fa7a7b103e9d2fadadea0a04e639ab6adf88098c5c`. The record identifies
diagnostic reuse, exact 61-character conditional command, and `keyDelayMs:100`; its scratch runner
hash is `bccb2b7effe9f2ccb7e260cf646c429d71af67b298ee83724148ea63d61ffa23`. The repository's
diagnostic parser remains unchanged at 0..25, so this is an explicit scratch observation rather than
a product option or default change.

The guest-visible screenshot shows the full command, successful real `aplay` output, conditional
green marker and prompt with no displayed XRUN. The command record has exactly 152 keyboard frames
and 152 DOM events, `inputSequenceMatch:true`, `terminalMarkerSeen:true`, and `accepted:true`.
Fresh PCM advances 0 to 1440 frames; all 1440 are non-silent, max absolute amplitude is
0.082000732421875, and the output remains attached/running. This directly distinguishes the 100 ms
result from the preserved 25 ms truncation on another copy of the same koBy seal and archived
runtime.

The run still fails exactly the unchanged two-second assertion: its frozen cap interval is
`postRestoreEnd - postRestoreStart = 19401.350000023842 ms`, with PCM first sampled at
19348.950 ms. The separately gathered `postRestoreInteraction.elapsedMs = 19401.6550000906` is
about 0.305 ms later and is telemetry, not the value tested by the cap. Most of the frozen interval
is the deliberate 15.4-second physical typing, so it is not performance or F-acceptance evidence
and cannot motivate a deadline waiver. It also does not prove a kernel/userspace overrun or identify a precise drop queue;
the stored 2048 budget refutation remains held. The justified conclusion is only that this
representative shifted route is pacing-dependent and succeeds at the existing cold helper's 100 ms
edge spacing.

The harness-only pacing candidate is therefore suitable for one new cold create using the original
208-character setup command. The focused record `physical-pacing-151-tests.log` SHA-256
`4e311e31a53706ab43712a1a07650d50045e679dbbfd674f4690b701d854fafd` passes 151/151, including
the seven new helper cases and old-burst mutation. Default post-restore delay remains zero; the
future diagnostic completion replay remains the explicitly recorded 5 ms path and is made slightly
harder, never easier. Do not call the helper fixed for the full cold workload until that cold setup
actually types, compares/executes, produces PCM, and seals successfully.

## Final `89865ea5` cold/reuse review — functional path observed, timing still fails

This is still a diagnostic disposition, not an E5-T26f verification verdict. Frozen source is
`89865ea5465a94512d966388b2aa57c9442627a1`, and the served runtime is SHA-256
`874f63af4e09fa9e23f348b5ef8050ae09382c1273ce459b999525db40962ccd`. Relative to
`32841587c1ace8e8f08b0ac69d05aecce5d67248`, the executable harness delta is the physical-key
pacing change: modifier/base/ordinary key edges and Enter are separated by the selected delay.
The three scoped runner/test-file binary diff has SHA-256
`e59511320878f278c4b16f1163dc9dd3ebe5ff18ef7d59f2884ded1d676130fe`; scoped
`git diff --check` is clean. No core, Wasm, snapshot-format, image, timing-cap, or default command
semantic changes are in that delta.

The fresh cold create closes the full-setup qualification that the earlier malformed-command run
left open. `paced-receipt-checkpoint-8986/diagnostic-checkpoint.json` has SHA-256
`8c79bc9e7f4d0f2c129465e2e805752ad2a5b103c0948c17810d61cad49ca7de`, and its transcript has
SHA-256 `0fe098b5b44642fdd10695b6b4e08f33766497ee7d75bf115c2915d58926f412`.
The real 208-character setup emits all 454 expected physical transitions, reaches its conditional
marker, produces 1440/1440 non-silent PCM frames at maxAbs 0.082000732421875, pauses the normal
snapshot, and publishes a generation-616 checkpoint with SHA-256
`4123ec771362109ed9153bdc6635470aad357c2d8ef729da9b19412544e66f95` and CRC `a9a1eba9`.
This is sufficient cold setup evidence for the same sealed profile; it is not F acceptance.

The canonical completion record
`receipt-completion-8986/diagnostic-completion.json`, mechanically verified at SHA-256
`903120cbf2f21b2e80acbbb0dd781d40960ba1fd4232a51475c008f8601a5c19`, correctly reports
`acceptance:false`, `functionalChecksPassed:true`, `timingPassed:false`, and `checksPassed:false`.
Its associated digests are:

- completion PNG `09382f2517e2f6bf5f3d3dd632cc8779defe01fcc9afa996d96015d60efed76f`;
- immediate timing JSON `aa70a0768775fe18afb52983ed09fe7ab975a5106b0ef4d02a06b85f3eb4bb5e`;
- immediate timing PNG `ca0ba94780350dd3eacde27ce503f3fc53a36de9feaa23c98d2a7ea31b22777a`;
- completion server log `db703350149be6fbd6df20e0b4e8dbba74b04ad0e32f4f31807bd8fe2e32058f`;
- timing server log `8c8e2d071eee906404e631527803c803c1f695ec7b1792758c2de0df13c8823f`;
- adjacent run transcript `89a77a2e47f4548c254fa0756ad198e710b01bbd8ac091442fafdf475d29d241`.

The immutable cap boundary is preserved exactly: `postRestoreStart=1175.170000076294`,
`postRestoreEnd=6364.735000014305`, and their difference is
**5189.564999938011 ms**, versus the unchanged 2000 ms limit. The separately collected
`postRestoreInteraction.elapsedMs=5189.840000033379` is later telemetry and is not the asserted
cap value. Thus P3's harness prediction HELD, but F's second acceptance criterion **FAILED**. No
functional result below waives or substitutes for this failure.

The normal restore otherwise carries the real checkpoint SHA/CRC, observes a generation-2 fresh
HELLO, records only `fetching`, `instantiating`, and `restored` (never `booting`), and consumes the
loader-owned restore receipt `{attempted:true, decision:"resume", overlayGeneration:616}` while the
live generation is still 616. The physical `sh /tmp/a` path records 20 keyboard and 20 DOM events,
exact sequence match, real guest-visible terminal text, conditional green marker and prompt, and
positive fresh PCM: 2400 written/inspected frames, 1440 non-silent, maxAbs
0.082000732421875, with attached output and a running context. The inspected screenshot also shows
`underrun!!! (at least 4.276 ms long)` before the successful marker. This proves T19a's held XRUN
recovery path executed; it must not be relabelled as a no-XRUN run.

The drag path now supplies the missing direct movement evidence. A guest titlebar at
`557..1253 x 13..39` moves exactly 80 px right to `637..1280`, with the expected panel clamp to
`32..58`, and remains there after the controller is paused. The persisted moving checkpoint is
SHA-256 `3d03bd245708ee6e6bf0d9d228dd3c85dab032fe6897f939130074829fd8701c`, CRC `eb2e0bd3`.
Both publication and pre-reload frozen audits observe paused/still-paused state, generation/final
generation 616, decision `resume`, and the exact envelope SHA. The second reload restores that SHA
and CRC, reports another fresh generation-2 HELLO with no `booting`, and consumes a second genuine
receipt at generation 616. P5--P7 and the restore/CRC/no-reboot portion of P12 therefore HELD.

F1 is also closed in the live path. The output directory contains exactly the six intended timing
and completion artifacts. The transcript reaches `diagnostic:completion-evidence` with event
`done`, emits no later failed phase or duplicate `failure-diagnostic-completion-evidence` capture,
and exits nonzero by rethrowing the original exact cap `AssertionError`. P8--P11 HELD. Browser and
HTTP error arrays are empty. The two retained generic console 404 entries are both independently
resolved by the two server logs to `GET /favicon.ico` at 03:00:54 and 03:00:59; there is no hidden
guest, loader, or artifact HTTP failure.

### Third acceptance criterion — guest no-stuck-button remains NEEDS EVIDENCE

The current browser assertion at `tools/verify/e5-t26f-browser-roundtrip.mjs:1808` checks only the
host pointer bridge's `heldButtons` array after the second reload. It does not move the pointer or
observe the guest compositor after restore. The report's `inputReleaseEvents:0` is not stronger
evidence: `Machine::save_resume` already calls `release_all()` before serializing the persisted
tablet/mouse state, so the protected release can be carried in the saved pending queue rather than
newly synthesized by desktop restore.

The unchanged H tests remain valid and materially narrow the gap. They prove save-time
keyboard/tablet/mouse reconciliation, discard of fresh-target host-held state, preservation of a
protected release frame, and resumed input-ring continuity. They do not prove that this Linux/Weston
execution consumed the queued release before the browser declared the drag restore functional.
Because F explicitly requires a drag snapshot to restore with **no stuck button**, bridge state plus
native queue semantics is sufficient runtime-unit coverage but not the final browser endpoint.

Required bounded proof: after the second restore, send one hover-only pointer move over the restored
titlebar, require the real tablet-frame count to advance, then reacquire the same titlebar and assert
that it remains stationary within the existing geometry rounding tolerance. If the guest still
believes BTN_LEFT is down, that move drags the window and falsifies the criterion. This uses the
existing live geometry oracle and adds no runtime semantic, click, performance condition, or new
task requirement. Until recorded, the normal/drag CRC, receipt, no-boot, audio, typed-terminal and
real-drag observations are HELD, but the third criterion is **NEEDS EVIDENCE** rather than fully
functional-HELD.

### Source-command diagnostic control

The explicit `. /tmp/a` reuse control is negative for policy promotion. Its canonical cap-failure
JSON has SHA-256 `ee7b8415d2e6cde2139882d8f5d2c4b7e344c1f6fb9b1206e1ad0bb8812bf63a`, inspected PNG
`42d4cdc92e7f2a4d0c4374f9c03b0a18235d3b976387774d028b322a8fdcd441`, server log
`66025b66d14a8a501ed509880e276b1ce17071c68b81df38b2568e2ba7826784`, and transcript
`688ee811faccd0c2e581a4d51cfba4d151213c1e7ad38827e4970a62008a0197`. It produces a real green
marker and 1440/1440 non-silent PCM frames with no displayed XRUN, but still fails the original cap
at **4750.099999904633 ms**. The single approximately 439.465 ms difference from `sh /tmp/a` is not
a stable benefit estimate and supports neither a default-command change nor F verification.

**Incremental verdict: not verified (timing failed; one browser proof gap).** No new runtime
refutation. The repaired receipt, F1/F2 sequencing,
physical setup path, normal and moving snapshot coherence, real drag, second restore, terminal and
XRUN-recovered PCM paths are exercised and hold at frozen `89865ea5`. E5-T26f remains unverified
because the measured acceptance interval is 5189.565 ms (>2000 ms), and the guest-side
no-stuck-button endpoint still needs the single bounded post-second-restore stationary-hover proof
above.

## Pre-replay review — bounded restored guest-release oracle

The uncommitted incremental diff adds only a post-second-restore browser oracle; it does not change
the served runtime, snapshot format, original interaction timestamps, cap, command, or prior
coherence checks. The helper runs after the drag restore coherence audit and before
`dragRestore.functionalChecksPassed=true`, so a refusal cannot be hidden beneath a completed
functional flag.

### Falsifiable replay predictions

1. The initial restored titlebar must match the exact paused moving titlebar on all four edges
   within one pixel. This binds the probe to the saved window rather than whichever dark client is
   topmost after reload.
2. The target must differ visibly from the saved drag endpoint, and the helper must issue exactly
   a pointer move—no down, up, click, or synthetic release transition.
3. Evidence must start with host `heldButtons:[]`, observe a strictly increased real pointer-frame
   count, and identify the newest tablet `pointermove` frame at the independently mapped 0..32767
   coordinates (within one rounding unit).
4. The guest front buffer must render its actual custom cursor at the target point. A host ledger
   update or stale frame alone is insufficient.
5. Every sample from move through at least 1000 ms after that guest cursor acknowledgment must keep
   all four titlebar edges within one pixel of the pre-move restored rectangle. Any missing/
   ambiguous titlebar, retained host button, stale cursor, coordinate mismatch, or two-pixel window
   displacement must fail closed within the bounded 15-second resource wait.
6. The wait occurs after the second restore and therefore must not alter
   `postRestoreStart`, `postRestoreEnd`, or the already-retained 5189.565 ms cap failure. A passing
   hover can close only the third-criterion evidence gap; it cannot verify F.

### Static adversarial disposition

The implementation is sufficient for those predictions. The target is the restored titlebar's
`left+32,bottom-3`, while the saved drag ended 68 px away in the current fixture, so this is not a
zero-motion self-oracle. Browser-to-tablet mapping duplicates the shipped bridge formula using
1280x800 and 32767, and requires both frame-count progress and exact mapped coordinates. The
rendered-cursor check independently anchors consumption in guest-visible pixels. The one-second
stationarity interval starts only after both anchors hold, preventing an immediate host-state update
from masking a later compositor drag. Because the restored window is against the right/panel edges
and the probe moves left/down, a stuck drag is not hidden by the prior boundary clamp.

No blocking source finding remains. Focused helper tests should still sabotage each independent
guard: stale frame count, matching stale frame without cursor pixels, held button, absent titlebar,
two-pixel edge motion, no post-ack dwell, and accidental down/up. The one sealed 8986 reuse must
record the actual samples, guest frame coordinates, rendered cursor, unchanged titlebar, and final
nonzero original-cap exit before the prior no-stuck-button finding can move from NEEDS EVIDENCE to
HELD.

## `8c892667` replay result — guest no-stuck-button HELD

The single same-runtime replay closes the narrow browser endpoint predicted above. Frozen harness
and tests are commit `8c892667be0da360af2329f2ae8bf7bf7ef6f10d`; the runtime remains SHA-256
`874f63af4e09fa9e23f348b5ef8050ae09382c1273ce459b999525db40962ccd`, and the immutable seal is
the existing 8986 profile (`creatorHead=89865ea5`, profile SHA-256
`85c02f515233eca69df87bfbeeb06c32a50215f0a810739f1966775dedabbf9a`). The 165-test focused
record has SHA-256 `1423906b1ecc702dae1230101c3347b601cadee3a369c7748ab1cd87b69a0f8f` and reports
165 passed, 0 failed, including the real Chromium adapter and each predeclared guest-release
sabotage. Runner SHA-256 is
`d49ce58fcd1130e46ac73dbd95e15efac1ad6bdce5ab92e6a009ccf4544465a6`; the dedicated helper-test
file is SHA-256 `52680cc6a1957cf40898553115718c6cd25b26888604d5f3cff75fee61bf366f`.

Canonical replay artifacts were mechanically hashed as follows:

- `diagnostic-completion.json` —
  `28046f748fc855531d5bc77874cfff7c57ce85992e231eb68d369d85bdbf2e8a`;
- `diagnostic-completion.png` —
  `7c6124ffed75baee70e118908e5e063c21e910ca60ad1a13e52b6cf72677e211`;
- `diagnostic-completion-timing.json` —
  `8d00637b247ec7e35925f4dc9e89bdcc3c0f1432c5128b0fab3dd2635a0c032b`;
- `diagnostic-completion-timing.png` —
  `170ba93cd9b1956f190cde31814905db406e73db73d0d9c6510eb72b48b573cf`;
- completion server log —
  `63ac6c1e54e9239e1ad452590bf2ab63e5af68eaf6db583942d41ffa0e268836`;
- timing server log —
  `c0b745f4f54973a2be072b6e543151ef67244ab4faf1b2a015c7aee048333302`;
- adjacent run transcript —
  `660a5b1fdeb5aeac458054a0a074eaeb075d0d0215530cac2635a9493923d607`.

The live `dragGuestRelease` observation satisfies all six predictions. Its initial frame count is
zero with `heldButtons:[]`. The move produces exactly one new tablet `pointermove` frame at
`{x:17126,y:2253}`, which is the independently rounded 32767-range mapping of guest point
`{x:669,y:55}`. The front buffer then renders the custom cursor at that exact point with 94 matched
pixels. Across all eight finite, non-regressing samples, every held-button array remains empty and
every titlebar remains exactly `{left:637,right:1280,top:32,bottom:58}`—stricter than the permitted
one-pixel tolerance. Cursor acknowledgment occurs at 1874.375 ms and the final stationary sample at
2897.194999933243 ms, a **1022.8199999332428 ms** post-ack dwell. The helper emits only the mapped
move; no down/up or synthetic release participates. This independently proves that Linux/Weston
consumed the restored release before processing the new motion: a retained BTN_LEFT would have
translated the titlebar.

The surrounding whole-machine facts also carry on the new execution. The normal snapshot SHA/CRC
remain `4123ec771362109ed9153bdc6635470aad357c2d8ef729da9b19412544e66f95` / `a9a1eba9` and match
the normal first present. The new moving snapshot SHA/CRC
`565dacbf461a372cd4ab5d353eae7753cab21527801cbe8777296ecfd6c02161` / `d028fe13` match the second
restore and first present. Both restores consume genuine generation-616 `resume` receipts, report a
fresh HELLO generation 2, and never enter `booting`; both frozen moving audits remain paused and
coherent. The real `sh /tmp/a` marker succeeds with 1440 fresh PCM frames / 960 non-silent at maxAbs
0.082000732421875. Browser and HTTP error arrays are empty; the two generic console 404s again map
exactly to `/favicon.ico` in both server logs.

F1 remains closed: exactly six intended completion/timing files exist, the transcript records
`restore:drag:guest-release` start/done followed by `diagnostic:completion-evidence` done, and the
process exits 1 by rethrowing the original cap assertion without a duplicate failure capture. The
cap itself is unchanged and still fails: `postRestoreStart=1131.2849999666214`,
`postRestoreEnd=6181.514999985695`, difference **5050.2300000190735 ms** > 2000 ms.

**Incremental verdict: functional criteria HELD; E5-T26f remains in progress on timing only.** The
previous guest no-stuck-button NEEDS EVIDENCE finding is closed. Acceptance criterion 1 and the
functional portions of criterion 2 remain HELD; criterion 3 now HELD end-to-end through the actual
browser guest. Criterion 2 still FAILS solely at its explicit two-second bound. This diagnostic is
`acceptance:false`, `functionalChecksPassed:true`, `timingPassed:false`, and `checksPassed:false`;
it supplies no timing waiver or F verification claim.
