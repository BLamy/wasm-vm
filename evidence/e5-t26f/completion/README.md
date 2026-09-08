# Completion-only F diagnostics

This layer reaches previously unobserved functional criteria without suppressing
the original two-second failure. `E5_T26F_DIAGNOSTIC_COMPLETE=1` is explicit,
reuse-only, incompatible with tuning/profiling/command overrides, and never an
acceptance run. Default acceptance remains fail-fast. A failed cap is recorded
before subsequent work, carried into later failures, and rethrown even if all
remaining functional assertions succeed.

## First replay: second restore refused

Frozen runner: `856f3e78eb4872ef8e7020ddaf19eb2938fe9051`.

```sh
E5_T26F_REQUIRE_HEAD=856f3e78eb4872ef8e7020ddaf19eb2938fe9051 \
E5_T26F_DIAGNOSTIC=reuse E5_T26F_DIAGNOSTIC_COMPLETE=1 \
E5_T26F_DIAGNOSTIC_KEY_DELAY_MS=5 E5_T26F_HEADED=1 \
E5_T26F_DIAGNOSTIC_PROFILE=/var/folders/nr/cyvk1qc14jj5c081vj1xts000000gn/T/e5-t26f-residency-L5pPJH \
E5_T26F_DIAGNOSTIC_PORT=61629 \
E5_T26F_IMAGE=target/e5-t26f/desktop-image-aplay-noresize/alpine-rootfs.ext4 \
E5_T26F_IMAGE_INFO=target/e5-t26f/desktop-image-aplay-noresize/desktop-info.json \
E5_T26F_DESKTOP_ASSET_DIR=target/e5-t26f/chunks/desktop-aplay-noresize \
E5_T26F_OUT=evidence/e5-t26f/completion/run-856f3e78 \
node tools/verify/e5-t26f-browser-roundtrip.mjs
```

The actual invocation scrubbed all inherited `E5_T26F_*` variables before setting
exactly those values. The output subdirectory must be new/empty; choose another
subdirectory for a retry. Transcript: `run-856f3e78.log`.

- Normal restore: first-present CRC `09c5c407`, fresh HELLO, no boot. Real physical
  `sh /tmp/a` completes with 1440 fresh PCM frames, 960 non-silent. Both terminal
  screenshots visibly contain recovered 0.063 ms ALSA underruns and green markers.
- Original-T0 interaction: **5014.135 ms**, failed and retained immediately in
  `run-856f3e78/diagnostic-completion-timing.json` and corresponding PNG/server log.
- Actual normal coherence audit passes: decision `resume`, generation **621**,
  approximately 34.3 seconds of audit I/O after the already-frozen timing boundary.
- All four drag-phase saves complete; persisted moving snapshot has CRC `3eee89f2`
  and generation **621**. Input coordinates/hash changes alone do not establish
  the amount of guest-window translation.
- Second reload enters `booting` and is immediately refused. Canonical failure:
  `run-856f3e78/failure-readiness-drag-desktop-ready.json` and corresponding PNG/
  server log. The later failure retains the earlier cap and both timestamps.
- Child exit **1**. No `diagnostic-completion.*` final result or
  `desktop-roundtrip.*` acceptance artifact was produced. F remains in progress.

## Read-only post-failure storage inspection

```sh
node tools/verify/e5-t26f-inspect-resume.mjs \
  evidence/e5-t26f/completion/run-856f3e78/failure-readiness-drag-desktop-ready.json \
  evidence/e5-t26f/completion/failed-resume-metadata-corrected.json
```

The inspector copies the closed failed profile into new retained scratch and opens
an inert, intercepted same-origin document. It does not load the emulator, boot a
guest, run a server, or restore anything. Existing named IndexedDB databases are
opened without upgrades; transactions only read metadata and the first snapshot
chunk. The original failed profile is untouched.

The durable overlay metadata decodes to generation **625**; the stored
`WVMRESU1` header decodes to generation **621**, matching the moving snapshot.
These are post-failure observations, not a measurement of exactly when generation
advanced. Do not bypass the existing stale-overlay guard. The initial inspector
attempt used an incorrect database-name prefix and yielded no selected stores;
`failed-resume-metadata.json` is retained as that empty attempt, not proof. The
corrected inspector selects the repo's actual `wvov-` and `wvsn-` namespaces.

Separately, the original diagnostic session hydrator installs an init script on
every navigation, which refuses the legitimately updated desktop envelope on the
second reload. One-shot hydration and bounded warning/generation observations are
the next harness-only follow-up; they do not weaken any restore guard.

## Scoped tests

`helper-tests.log`: **88/88** passed (68 existing runner, 14 completion, 6 collector).
`worker-profiler-adapter.log`: **1/1** passed separately after the browser replay
closed. The new tests execute the actual bounded helper/control flow, including
failure capture, all four save calls and the second restore call. Existing audit
tests cover the actual audit helper; mocked orchestration is not guest evidence.
Fresh Daybreak predictions and incremental review are in `critic.md`.

## Follow-up chronology: three failed drag diagnostics

These are completion-only reuse diagnostics, not acceptance runs. Their canonical
JSON records bind the same runtime SHA-256
`45ce3b925c590fab34b8fd8af85f0bb2ffbec585df2e2586c668869fe4ebca6b`,
image SHA-256 `5530d6585776cf61fcedb98f7a2e75b4293d5f805809e5107cc181fa5dc62550`,
and sealed profile SHA-256
`f6a145f7c15572d77968a5af5a477f7b4231b98fc222922c5d740e1bf40c4c78`.
Each uses `sh /tmp/a`, key delay 5 ms, and `acceptance: false`; the CPU,
latency, clock, JIT, residency and command overrides are unset/disabled in
`milestones.run.diagnostic`. The following head changes are harness changes,
not runtime performance fixes.

### 19fbc770 — coherent-checkpoint guards expose a merged-window detector

Head `19fbc77084a9c02ba0082369ada14abc52dd8e28` changed
[`installCheckpointSession`, `proveAndPauseDrag`, and `auditFrozenDragSnapshot`](../../../tools/verify/e5-t26f-browser-roundtrip.mjs):
hydrate session storage once through an inert same-origin route; require observed
window translation and an independently rechecked paused titlebar before publishing
the moving snapshot; keep the guest paused and audit generation/coherence/envelope
identity both after publication and before reload. It also added bounded warning
and snapshot-generation observations. These guards address the earlier hydration
and stale-generation hazards without bypassing restore refusal.

The [replay transcript](run-19fbc770.log) instead terminates at
`drag:guest-translation`. The [failure JSON](run-19fbc770/failure-drag-guest-translation.json),
`milestones.dragMovement`, records the same `{left:115,right:1253,top:13,bottom:39}`
before and after, with `translation: null`. The old full-height detector combined
the lower window's left edge with the upper window's right edge. The retained
[failure PNG](run-19fbc770/failure-drag-guest-translation.png), decoded by the
committed geometry fixture, instead yields upper-window
`{left:557,right:1253,top:13,bottom:39}`. This is a demonstrated detector error;
it does not establish a successful drag or second restore in this replay.

### 0f467689 — upper-window detection works; strict row matching rejects panel clamp

Head `0f4676893292377376e4b82c28d15f02ce6c4d2f` introduced
`readTopmostDragTitlebar`: skip panel rows 0..31, inspect the first 32 contiguous
qualifying dark-body rows, require each modal edge on at least 24 rows, and reject
ambiguous edges. The drag aims at `titlebar.bottom - 3`, below the panel rather
than the obscured decoration midpoint.

The [failure JSON](run-0f467689/failure-drag-guest-translation.json),
`milestones.dragMovement`, now records
`{left:557,right:1253,top:13,bottom:39}` before and
`{left:644,right:1280,top:32,bottom:58}` after: +87 px horizontally,
unchanged 26 px titlebar height, right edge clipped to the canvas. The
[failure PNG](run-0f467689/failure-drag-guest-translation.png) independently supplies
those after-bounds to the committed fixture. The then-current predicate allowed
only the original row within 1 px, so this panel-clamped result still produced
`translation: null` and the [transcript](run-0f467689.log) ends in the same bounded
wait failure. The observed movement is not a completed moving-snapshot/reload proof.

### 4ae44f3f — panel-aware predicate; headed replay still has no proven translation

Head `4ae44f3ff8294e5e2a6c5c5ba7e08a9cdf1d3a66` allows the after-top to match
either the before-top or `max(before.top, 32)`, within 1 px, while independently
requiring titlebar height within 1 px. Horizontal movement remains rightward
64..96 px. It also refreshes the canvas bounding box before mapping drag points
and records `milestones.dragMapping`, instead of reusing the earlier focus box.

The [failure JSON](run-4ae44f3f/failure-drag-guest-translation.json) records canvas
box `(80,85,1280,800)`, guest drag `(657,36) → (737,36)`, and corresponding page
points `(737,121) → (817,121)`. Nevertheless, `milestones.dragMovement` ends with
unchanged `{left:557,right:1253,top:13,bottom:39}` and `translation: null`.
The [transcript](run-4ae44f3f.log) and
[failure PNG](run-4ae44f3f/failure-drag-guest-translation.png) retain this failed
headed attempt, not a successful panel-clamped drag.

`state.terminal.pointerFrames` is **125**. The retained final 16 pointer samples
include unscripted/off-command activity: sequences 110..122 sweep through tablet
coordinates `(21916,12703)` to `(31946,14829)`, away from the requested titlebar
row, before sequences 123..125 record `(16819,1475)`, button-down, and
`(19059,1475)`. This supports an input-contamination hypothesis for the headed
attempt; it does **not** prove that contamination was the sole cause of the failed
drag, nor identify the exact guest-side causal event. A clean comparison is still
needed; no result from the separate running headless checkpoint is included here.

### Common outcomes and unchanged timing failure

All three failure JSONs report normal first-present CRC `09c5c407`, handshake
generation 2, boot-state sequence `fetching → instantiating → restored` (no
`booting` entry), accepted physical command input, nonzero fresh producer PCM,
and a passed normal coherence audit. Their post-restore interaction fields retain
`functionalChecksPassed: true`, `timingPassed: false`, and `checksPassed: false`;
normal restore's overall `checksPassed` also remains false.

The table uses `milestones.deferredInteractionCap`'s original start/end boundary,
rounded to three decimals, not the slightly later interaction-summary sample.
Each failure JSON's entire deferred-cap object was compared with its immediate
timing JSON and is unchanged, including timestamps and original AssertionError.

| Immediate timing record | Original T0 (ms) | Original end (ms) | Failed elapsed (ms), cap 2000 | PCM written / non-silent at command completion |
| --- | ---: | ---: | ---: | ---: |
| [19fbc770](run-19fbc770/diagnostic-completion-timing.json) | 1175.070 | 6125.305 | 4950.235 | 1440 / 960 |
| [0f467689](run-0f467689/diagnostic-completion-timing.json) | 1179.475 | 6315.670 | 5136.195 | 1440 / 960 |
| [4ae44f3f](run-4ae44f3f/diagnostic-completion-timing.json) | 1180.780 | 6073.730 | 4892.950 | 1440 / 1440 |

Each transcript records child exit **1** for
`bounded wait expired: guest window did not complete the requested 80px drag`.
Only the before-drag and held-drag saves completed; both observed generation 621.
There is no completed moving/released save, frozen moving-checkpoint audit, or
second restore in these three records. Their directories contain immediate timing
and later failure JSON/PNG/server-log triples, but no final
`diagnostic-completion.*` or `desktop-roundtrip.*` acceptance result. Timing remains
failed, full functional completion remains unproven, and this evidence does not
verify F.

### Focused regression evidence at 4ae44f3f

[`final-pre-replay-tests.log`](final-pre-replay-tests.log) records **115 passed,
0 failed, 0 skipped**. It includes actual extracted-helper/control-flow coverage
for completion-cap retention, one-shot hydration, paused checkpoint guards,
geometry, and residency counter collection. These are deterministic harness
tests, not a substitute for the missing browser completion proof; they were read,
not rerun for this documentation update.

The 13-test [geometry sidecar](../../../tools/verify/e5-t26f-drag-geometry.test.mjs)
executes the runner's actual detector and translation predicate. The two PNG
fixtures above were committed at `4ae44f3f`; each is 1425×1146, with the cyan
focus-outline anchors checked at rows 81..82, x76..1363, before extracting the
unaltered `(80,85,1280,800)` RGBA canvas. Tests cover the exact real 557→644
panel-clamped transition, independent synthetic 559→639 clipping, panel exclusion,
cursor outliers, ambiguous edges, stale/wrong-window geometry, non-panel vertical
jumps, and independent height-change rejection. The previously rejected top=251
case remains rejected.

### SHA-256 of cited canonical records

Computed directly from retained bytes; paths below are relative to this README.

```text
fad7ae78bd1557b7fa5da6da381c94203cbb365027939238c1c9d7864d82716c  run-19fbc770.log
a8de18ccec29239c599e61027a27ff5cc5d81ec3e56467532d1f69dd8a2a9afb  run-19fbc770/diagnostic-completion-timing.json
7f564e3db2f97e59fb041a6cdd925d78f136f41e45034b4134e2a4d667095b73  run-19fbc770/failure-drag-guest-translation.json
7287f1999a3e4b0f5889d9201dd052fdd93f2e44cb888ace0b69c089f25eb27f  run-19fbc770/failure-drag-guest-translation.png
62a7b0fb9b07d6305f95728cb8384d6ba122a5c9009868a38c0a4fe4f9df8cd9  run-0f467689.log
bacf068615965bab9164a14838b1098aefd626dbff010fcb4b91122a4387b8c8  run-0f467689/diagnostic-completion-timing.json
b5de3e64068c4ef88c9d58af89ea5ca331496b12b1113c4e09f424d9a6a311d7  run-0f467689/failure-drag-guest-translation.json
f9fe96457e3729795071e8188da4868217d1d1629c9dcb22f39197d0b3b36140  run-0f467689/failure-drag-guest-translation.png
5bb55acabcb75eedf624e154dad8b75c42493e45c7f2e5b0ebed41afd486bad9  run-4ae44f3f.log
d38f498f8ee93700a8e808560875412239d81d32d3f0266d361a45a24bcaeb17  run-4ae44f3f/diagnostic-completion-timing.json
b3a87ebe7b242dbf45f6d3ca9ed47cdf85de1e4964ba395df47a87e59424a706  run-4ae44f3f/failure-drag-guest-translation.json
bd9f88b3c73eb3ca1864bdf704167093b8de80f31bd1f53d7593564b8bd09a9c  final-pre-replay-tests.log
```

## Separately sealed headless isolation experiment

The predeclared headless cold create completed with exit 0 at frozen
`4ae44f3ff8294e5e2a6c5c5ba7e08a9cdf1d3a66`. It uses a new profile, not an edited
binding for the headed profile. The kernel, image, chunk manifest and served
runtime are unchanged. `headless-checkpoint/diagnostic-checkpoint.json` records
empty browser/HTTP error lists and the initial two-window/audio/cursor setup.

Reproduction uses the earlier command's image paths and port 61629, with all
inherited `E5_T26F_*` variables scrubbed before setting explicit values:

```text
E5_T26F_REQUIRE_HEAD=4ae44f3ff8294e5e2a6c5c5ba7e08a9cdf1d3a66
E5_T26F_DIAGNOSTIC=create
E5_T26F_DIAGNOSTIC_PROFILE=/private/tmp/e5-t26f-headless.koByhb
E5_T26F_TIMEOUT_MS=1200000
E5_T26F_OUT=evidence/e5-t26f/completion/headless-checkpoint
```

`E5_T26F_HEADED` is absent. A reproduction must choose a fresh empty profile
directory. The one declared completion reuse switches `DIAGNOSTIC` to `reuse`,
adds `DIAGNOSTIC_COMPLETE=1` and `DIAGNOSTIC_KEY_DELAY_MS=5`, and uses output
`evidence/e5-t26f/completion/headless-run-4ae44f3f`. No command, JIT, residency,
clock or profiler override is set. The runner copies the closed baseline for reuse.

| Binding | Value |
| --- | --- |
| Browser | Chrome/152.0.7977.76, `headless: true` |
| Served runtime SHA-256 | `45ce3b925c590fab34b8fd8af85f0bb2ffbec585df2e2586c668869fe4ebca6b` |
| Profile tree SHA-256 | `946af63958837caed903166854c296eaec1b35e05ff2c301aa3598df76c3d1dc` |
| Normal desktop snapshot SHA-256 | `3dee2e4deb67a31e3b1c2a8fa217985a88f6be28a70738a5217d791bd6f97acf` |
| Frozen CRC / overlay generation | `de9083e3` / 627 |
| Local seal JSON SHA-256 | `92efd82dc8d69dd16a151749442edfbd20cd85526efde00aafad785ce3c575e0` |
| Checkpoint report SHA-256 | `6a298e9fcf189f66149e927b363fe8bb19b11919acbfd8be98233091a5308111` |
| Cold transcript SHA-256 | `3c8720c65f393d2bff10aa06573282176d397706c272bd7b6d1c9873f2bb304f` |

The cold create is diagnostic setup, not F acceptance. The headed failures stay
retained.

### Headless reuse: actual drag and second restore, then a live-audit failure

The declared reuse closed with exit 1. The exact original interaction cap remains
failed at **5059.890 ms**, with 1440 fresh PCM frames / 960 non-silent. The normal
first-present CRC is `de9083e3`; its then-current coherence audit passed. The
retained screenshot shows a recovered 0.501 ms ALSA underrun in the upper terminal
and the conditional success marker, not a zero-XRUN claim.

`milestones.dragMovement` proves upper-window translation from
`557..1253 / 13..39` to `637..1280 / 32..58`: **80 px right**, with the same titlebar
height and the permitted panel clamp. Rechecking after the actual pause gives the
same translation. This supports isolation from the headed interference hypothesis;
it does not establish that interference was the exclusive cause of the headed miss.

All four save calls complete. The persisted moving desktop envelope is
`01e516cb885cc772725988923f86b148c9a570c7eed98ccb139b19f5c6e2a8ba`, CRC `68fb7727`.
Both frozen audits (`dragCheckpointPublished`, `dragCheckpointBeforeReload`) read
`isPaused/stillPaused: true`, actual generation **627**, decision **resume**, and
the exact moving envelope hash. The released nonpersistent save has the same byte
hash while the guest is kept paused; it is not independent proof of additional
guest execution after releasing the host pointer.

The second reload restores that envelope and first-present CRC, reports a fresh
HELLO, has no `booting` state, and passes display/button checks. The subsequent
`auditRestoreCoherence` runs its expensive live `snapshotDecision()` read while
the restored guest is executing. After 30.116 seconds it observes **stale** and
current generation **648**. That is the validity of the old checkpoint against a
later disk, not the decision used to admit the earlier successful restoration.
The failure is retained; no final completion or acceptance artifact exists.

The follow-up captures the loader's actual `restoreStoredSnapshot()` return and
actual generation before scheduling the guest. F audits that immutable receipt,
requires a stored `resume` with the saved generation, and separately records
later live generation. It does not reinterpret `stale` as success or alter the
runtime coherence guard. It also closes the default normal-save pause gap and
the duplicate final-cap reporting defect. These served-JS changes require a new
seal, not rebinding this headless profile.

```text
e93e80f42103fc2dd187bcb8963f8dd6f350eaf86b0c80c8c84d36cab67845f5  headless-run-4ae44f3f.log
b0416b0fde1a9a67ac89d94acf0fa05e8db8bdae8df5a840583142b065cc21eb  headless-run-4ae44f3f/diagnostic-completion-timing.json
f421b8c21d8341034d618cf90a3674e2bd54db13f4f2cf35f4352183840cc3ba  headless-run-4ae44f3f/diagnostic-completion-timing.png
4acba52c35a5c01c451e0ddbd0a3e58a5d8ccdf6f489b1c1da573cbf18d14142  headless-run-4ae44f3f/failure-restore-drag-coherence-audit.json
ede8d63830a880dfb74fa5f50c0eb0ba4f9df9f21b94b8c12f394dafb7ece8a6  headless-run-4ae44f3f/failure-restore-drag-coherence-audit.png
```

## 32841587 — receipt-checkpoint cold setup failed before sealing

The fresh diagnostic `create` at
`32841587c1ace8e8f08b0ac69d05aecce5d67248` ran on 2026-09-08,
06:01:46–06:16:23 UTC. The [transcript](receipt-checkpoint.log) ends with
`page.waitForFunction: Timeout 240000ms exceeded` in
`command:e5t26f-aplay-ok:completion`. This was not acceptance. Its recorded
scratch profile is `/private/tmp/e5-t26f-receipt-wxKfmf`, port 61629, served
runtime SHA-256 `874f63af4e09fa9e23f348b5ef8050ae09382c1273ce459b999525db40962ccd`;
the image and manifest digests remain those recorded above.

Initial desktop readiness, the separate shell marker, and agent readiness passed.
The subsequent setup command was malformed/unfinished on the guest display: the
[failure PNG](receipt-checkpoint/failure-command-e5t26f-aplay-ok-completion.png)
shows a shell continuation `>` prompt. Both the
[immediate command capture](receipt-checkpoint/command-e5t26f-aplay-ok.json) and
[outer failure capture](receipt-checkpoint/failure-command-e5t26f-aplay-ok-completion.json)
retain `terminalMarkerSeen: false` for the aplay setup command. Their
`state.audio.pcm` has `writeIndex: 0`, `nonSilentFrames: 0`, and `maxAbs: 0`,
despite advancing worklet render counts. These do not prove guest PCM production.

**No seal was produced:** the six retained files are only the two failure
JSON/PNG/server-log triples; the recorded `normal-checkpoint.json` is absent.
There is no normal snapshot, restore, or post-restore timing milestone. This is
an initial command-delivery/setup failure, **not an established audio or receipt
semantic failure**. The exact downstream key/quote-loss mechanism is not proven.

The follow-up changes only physical-key scheduling in
[`typePhysicalText`](../../../tools/verify/e5-t26f-browser-roundtrip.mjs): preserve
the same shifted-key map and key order, but separate modifier/key edges and
character boundaries when delay is positive. Setup still defaults to 100 ms;
explicit zero adds no waits. Enter now holds for the selected delay without an
extra trailing wait. Command text and markers are unchanged. The
[seven deterministic tests](../../../tools/verify/e5-t26f-physical-typing.test.mjs)
passed: exact edge times, zero-delay equivalence, control/high-character routing,
Enter timing, original-T0 charging (95 ms for `sh /tmp/a` at 5 ms), and rejection
of the former burst helper even with a padded final elapsed time. The original
two-second cap is unchanged; these tests do not prove guest delivery. A short
browser probe was underway at this point; its results follow below.

SHA-256 computed from all seven retained files (paths relative to this README):

```text
0635b9b3d0a16e9280c390c8b76853027587d8943fc6b1867f9279e55d8975d6  receipt-checkpoint.log
5c9022e54f0588cf6f270fb1832b74dc47f076366156d6549492808e5db6b6f0  receipt-checkpoint/command-e5t26f-aplay-ok-server.log
677a811c781843f94417ff36039ac4fbb3faf36e3bb26ebffa84c64b93622191  receipt-checkpoint/command-e5t26f-aplay-ok.json
e9da14d31d765337d6ae71e6ecdad922187d52d3f30c7d51b68f06f664d927df  receipt-checkpoint/command-e5t26f-aplay-ok.png
5c9022e54f0588cf6f270fb1832b74dc47f076366156d6549492808e5db6b6f0  receipt-checkpoint/failure-command-e5t26f-aplay-ok-completion-server.log
84f262fbab05a209f33b6b75f2cc2d80a79ac65c5160958b4dcc19da0d829c2f  receipt-checkpoint/failure-command-e5t26f-aplay-ok-completion.json
e9da14d31d765337d6ae71e6ecdad922187d52d3f30c7d51b68f06f664d927df  receipt-checkpoint/failure-command-e5t26f-aplay-ok-completion.png
```

## Physical typing localization — both rates retained

The short precheck used copies of the unchanged koBy headless checkpoint, with
its **historical 4ae served runtime**, not the new receipt runtime. A shared local
clone at `/private/tmp/e5-t26f-typing-runtime.Qkphkq` checked out exact
`4ae44f3ff8294e5e2a6c5c5ba7e08a9cdf1d3a66`, copied its committed dist/pkg to pkg,
and retained the original generated one-byte pkg/.gitignore. The first preflight
(`typing-probe-4ae.log`) correctly refused the missing marker before browser launch.
After restoring that marker, the unchanged binding guard authenticated runtime
`45ce3b925c590fab34b8fd8af85f0bb2ffbec585df2e2586c668869fe4ebca6b` and the unchanged
image/kernel/manifest/origin/profile digests above. No checkpoint was rebound.

The physically typed command was exactly:

```sh
cd /tmp;printf '!'>k;[ "$(cat k)" = "$(printf '\41')" ]&&sh a
```

It writes literal punctuation through quoted/redirection syntax, compares the
guest result with an independently octal-encoded expected value, and runs the
existing real playback script only on equality. The current paced helper was
copied into the scratch runner. Neither run is receipt proof or F acceptance.

- **25 ms:** all 152 planned transitions were emitted, but the screenshot shows
  truncated guest input beginning `c>k;...` and `/bin/sh: c: not found`. Marker and
  PCM remained absent; the 120-second command timeout failed. Helper pacing at this
  rate is not a fix. Runner SHA-256:
  `55d23aa258de2e17429e5486d82e8d51bd77e21c1b30bc1e64380a26f5d1cdea`.
- **100 ms (actual cold-setup rate):** all 152 transitions matched the DOM ledger,
  the full command is visible, the comparison passed, and the real script produced
  its conditional marker and **1440 fresh non-silent PCM frames** (maximum magnitude
  0.082000732421875). The screenshot shows no XRUN message. The unchanged cap still
  failed at **19401.350 ms**, including 15.417 seconds of physical typing. Only the
  scratch parser admitted exactly 100 in addition to 0–25; the repository parser,
  normal playback command, and acceptance budget are unchanged. Scratch runner
  SHA-256: `bccb2b7effe9f2ccb7e260cf646c429d71af67b298ee83724148ea63d61ffa23`.
  Its complete diff from 4ae is retained in `typing-probe-scratch.patch`.

The bounded read-only inspector in `tools/verify/e5-t26f-inspect-input.mjs` copied
the closed failed profile and read only snapshot chunks 0, 136 and 139, without
loading an emulator. Its TLV walk finds the stored keyboard codec at byte
146163345: pending budget **2048**, zero pending/staged events, zero recorded
drops. This refutes the proposed stored-budget-256 explanation. It describes the
**pre-run stored checkpoint**, not post-failure live counters. Kernel/userspace
backlog or another downstream cause is not established by these records.

The narrow conclusion is that the new helper delivered this command at the
actual cold setup's 100 ms rate, warranting one new cold checkpoint attempt.
It does not prove all long input, fix the failed 25 ms route, or meet the two-second
product criterion. All 151 focused helper/receipt regressions pass. The new served
receipt runtime still needs its own cold seal and confirming replay.

Canonical SHA-256 (relative to this README):

```text
5f9767a4e3f8790415ceb17cac3a9c3b4347a86774344e58352cee8db7944d9c  typing-probe-4ae.log
a0c751837eb9e8ffa6fdfc5ecb7d7ed6025981be505ba2e7e99e4290a9b472de  typing-probe-4ae-bound.log
8c0b7ca4303769bdd843d55434106ab9b79a1542fee8211a2f8d18f1735daed5  typing-probe-4ae-bound/failure-command-e5t26f-post-aplay-completion.json
3c902ba724d48a8714062d8c3ac4a1c5a125c893cbefc29beb121193b54a1d2c  typing-probe-4ae-bound/failure-command-e5t26f-post-aplay-completion.png
ec5455e2b92bf36616cd37fa7a7b103e9d2fadadea0a04e639ab6adf88098c5c  typing-probe-100ms.log
36cdbb5cf6040247689287fd0529ac6fa8dc6645f9a9decb78bcb2a43275896e  typing-probe-100ms/failure-post-restore-interaction-checks.json
fbcab7198546fd01bca9714eca2cc55e1bc7b9cee912e720f1608eca1cf04337  typing-probe-100ms/failure-post-restore-interaction-checks.png
8acbd001b97bf12d284dc3938968585ba5172821e7076d82253de2835e9b74b9  typing-probe-stored-input.json
c9afd9429b68322e80ee92588b18a30d996c0098f09cb52ab40ad19ec51dbb2b  typing-probe-scratch.patch
4e311e31a53706ab43712a1a07650d50045e679dbbfd674f4690b701d854fafd  physical-pacing-151-tests.log
```

## 89865ea5 — new cold seal and full functional COMPLETE replay; timing still fails

Both runs use exact head `89865ea5465a94512d966388b2aa57c9442627a1`, Chromium
`Chrome/152.0.7977.76`, headless. The [cold transcript](paced-receipt-checkpoint-8986.log)
starts at 2026-09-08 06:46:25 UTC; checkpoint sealing completes at 06:59:59 UTC,
exit **0**. The [checkpoint report](paced-receipt-checkpoint-8986/diagnostic-checkpoint.json)
records the full 208-character setup command, **454 keyboard/DOM transitions**,
`inputSequenceMatch: true`, the accepted conditional marker, attached audio output,
and **1440 fresh PCM frames, all 1440 non-silent**. Two windows and the initial
cursor proof complete. Normal publication is confirmed paused and its frozen
audit reads `resume`, generation **616**, and the saved envelope hash.

The new seal is `/private/tmp/e5-t26f-paced-receipt-78h2h4/normal-checkpoint.json`.
Its local JSON SHA-256 is
`dbe6e74f7e9e68d4d4468dd30cd9f794893b5a93a9f17a73bff660af00bbfc6d`;
its closed profile tree SHA-256 is
`85c02f515233eca69df87bfbeeb06c32a50215f0a810739f1966775dedabbf9a`.
The desktop envelope's decoded-byte hash was checked against the seal and both
run records. Cold and reuse bindings agree: served runtime
`874f63af4e09fa9e23f348b5ef8050ae09382c1273ce459b999525db40962ccd`, with the
unchanged kernel/image/manifest hashes recorded for the preceding receipt attempt.
This is a new seal, not a rebound historical profile.

### Reproduction configuration

The following reconstructs the recorded policy/profile configuration using the
earlier image paths; the transcripts do not preserve a literal parent-shell
invocation. Start with inherited `E5_T26F_*` variables cleared. These are the
recorded paths: a new cold reproduction must choose a **fresh empty profile and
output directories**, and use that new profile for its reuse. Never recreate over
the retained seal. `HEADED`, command, JIT, residency, guest-clock, CPU and latency
overrides are absent; cold setup uses the helper's default 100 ms pacing.

```sh
export E5_T26F_REQUIRE_HEAD=89865ea5465a94512d966388b2aa57c9442627a1
export E5_T26F_DIAGNOSTIC_PROFILE=/private/tmp/e5-t26f-paced-receipt-78h2h4
export E5_T26F_DIAGNOSTIC_PORT=61629
export E5_T26F_IMAGE=target/e5-t26f/desktop-image-aplay-noresize/alpine-rootfs.ext4
export E5_T26F_IMAGE_INFO=target/e5-t26f/desktop-image-aplay-noresize/desktop-info.json
export E5_T26F_DESKTOP_ASSET_DIR=target/e5-t26f/chunks/desktop-aplay-noresize

E5_T26F_DIAGNOSTIC=create \
E5_T26F_OUT=evidence/e5-t26f/completion/paced-receipt-checkpoint-8986 \
node tools/verify/e5-t26f-browser-roundtrip.mjs

E5_T26F_DIAGNOSTIC=reuse E5_T26F_DIAGNOSTIC_COMPLETE=1 \
E5_T26F_DIAGNOSTIC_KEY_DELAY_MS=5 \
E5_T26F_OUT=evidence/e5-t26f/completion/receipt-completion-8986 \
node tools/verify/e5-t26f-browser-roundtrip.mjs
```

### COMPLETE result

The [reuse transcript](receipt-completion-8986.log) runs from 07:00:50 to
07:01:34 UTC. The [final report](receipt-completion-8986/diagnostic-completion.json)
has schema `wasm-vm.e5-t26f.diagnostic-completion.v1`,
`functionalChecksPassed: true`, but `acceptance: false`, `timingPassed: false`
and `checksPassed: false`. It finishes writing evidence, then rethrows the
original cap with exit **1**, without a duplicate completion-evidence failure
capture or a `desktop-roundtrip.*` acceptance artifact.

| Restored checkpoint | Desktop snapshot SHA-256 | Matching first-present CRC |
| --- | --- | --- |
| Normal | `4123ec771362109ed9153bdc6635470aad357c2d8ef729da9b19412544e66f95` | `a9a1eba9` |
| Moving | `3d03bd245708ee6e6bf0d9d228dd3c85dab032fe6897f939130074829fd8701c` | `eb2e0bd3` |

Both restores report fresh agent re-handshakes (HELLO version 1, generation 2),
full repair frames, and `fetching → instantiating → restored`, with no `booting`.
Both actual admission receipts record `attempted: true`, `decision: resume`,
generation **616**; both later live generation observations are also 616.
The second restore passes display and released-button checks.

Physical `sh /tmp/a` at 5 ms pacing is accepted with its conditional marker and
20 matching keyboard/DOM transitions. The rendered cursor is observed at
**829.920 ms** after the original restore boundary. Immediate PCM capture records
**2400 written frames / 1440 non-silent**, maximum magnitude 0.082000732421875;
the completion-time output attachment is true. The
[final PNG](receipt-completion-8986/diagnostic-completion.png) shows a recovered
ALSA underrun of **at least 4.276 ms**, then the conditional green marker.
This is successful playback with recovery, **not a zero-XRUN claim**.

The unchanged cap uses original T0 **1175.170000076294 ms** and end
**6364.735000014305 ms**: **5189.565 ms**, still above 2000 ms. The entire retained
cap object matches the [immediate timing record](receipt-completion-8986/diagnostic-completion-timing.json);
the later interaction-summary sample is not substituted for that endpoint.

All four drag-phase saves complete. Actual upper-window bounds move from
`557..1253 / 13..39` to `637..1280 / 32..58`: **80 px right**, with the permitted
panel clamp and unchanged height. The paused recheck agrees. Published and
before-reload audits both retain `isPaused/stillPaused: true`, generation/final
generation **616**, `resume`, and the exact moving-envelope hash. The released
nonpersistent snapshot has the same SHA-256 and 2695339-byte length as the moving
snapshot while paused; it is not evidence of new guest execution after release.

Both reports retain `errors.browser: []` and `errors.http: []`. COMPLETE also
retains two console 404 messages; the [server log](receipt-completion-8986/diagnostic-completion-server.log)
identifies both as `/favicon.ico` requests (lines 6 and 11), consistent with the
existing favicon exclusion. Fresh read-only Rawls review is ongoing; no verdict
is asserted here. The separate source-command probe is reported chronologically
below. Functional diagnostic completion does **not** verify F
or satisfy its still-failed timing criterion.

SHA-256 of all nine retained run artifacts (relative to this README):

```text
0fe098b5b44642fdd10695b6b4e08f33766497ee7d75bf115c2915d58926f412  paced-receipt-checkpoint-8986.log
8c79bc9e7f4d0f2c129465e2e805752ad2a5b103c0948c17810d61cad49ca7de  paced-receipt-checkpoint-8986/diagnostic-checkpoint.json
89a77a2e47f4548c254fa0756ad198e710b01bbd8ac091442fafdf475d29d241  receipt-completion-8986.log
db703350149be6fbd6df20e0b4e8dbba74b04ad0e32f4f31807bd8fe2e32058f  receipt-completion-8986/diagnostic-completion-server.log
8c8e2d071eee906404e631527803c803c1f695ec7b1792758c2de0df13c8823f  receipt-completion-8986/diagnostic-completion-timing-server.log
aa70a0768775fe18afb52983ed09fe7ab975a5106b0ef4d02a06b85f3eb4bb5e  receipt-completion-8986/diagnostic-completion-timing.json
ca0ba94780350dd3eacde27ce503f3fc53a36de9feaa23c98d2a7ea31b22777a  receipt-completion-8986/diagnostic-completion-timing.png
903120cbf2f21b2e80acbbb0dd781d40960ba1fd4232a51475c008f8601a5c19  receipt-completion-8986/diagnostic-completion.json
09382f2517e2f6bf5f3d3dd632cc8779defe01fcc9afa996d96015d60efed76f  receipt-completion-8986/diagnostic-completion.png
```

### Subsequent source-command diagnostic — still over cap; no default promotion

The [separate transcript](source-command-8986.log) ends at 07:02:42 UTC with
exit **1**. This uses another copy of the same sealed profile and identical
head/runtime/image/manifest bindings, with a reuse-only command override and
5 ms pacing; COMPLETE is absent. With the shared configuration above:

```sh
E5_T26F_DIAGNOSTIC=reuse E5_T26F_DIAGNOSTIC_COMMAND='. /tmp/a' \
E5_T26F_DIAGNOSTIC_KEY_DELAY_MS=5 \
E5_T26F_OUT=evidence/e5-t26f/completion/source-command-8986 \
node tools/verify/e5-t26f-browser-roundtrip.mjs
```

The [failure record](source-command-8986/failure-post-restore-interaction-checks.json)
retains the actual `. /tmp/a` command, 18 matching keyboard/DOM transitions,
the conditional marker, attached output, and **1440 fresh PCM frames, all
non-silent**. The [PNG](source-command-8986/failure-post-restore-interaction-checks.png)
shows the green marker and no displayed XRUN message; that is not a general
zero-XRUN guarantee. Normal first-present CRC remains `a9a1eba9`, with no cold
boot. The cap stops this run before its deferred coherence audit or drag proof.

Original T0 **1155.9350000619888 ms** to end **5906.034999966621 ms** gives
**4750.100 ms**, not the later 4750.370 ms summary sample. It remains above the
unchanged 2000 ms limit. Compared with the preceding default `sh /tmp/a` result
of 5189.565 ms, this is **one pair**, not evidence of a stable causal improvement
or grounds for default promotion. Both are diagnostic failures of the timing
criterion; no acceptance claim changes.

```text
688ee811faccd0c2e581a4d51cfba4d151213c1e7ad38827e4970a62008a0197  source-command-8986.log
66025b66d14a8a501ed509880e276b1ce17071c68b81df38b2568e2ba7826784  source-command-8986/failure-post-restore-interaction-checks-server.log
ee7b8415d2e6cde2139882d8f5d2c4b7e344c1f6fb9b1206e1ad0bb8812bf63a  source-command-8986/failure-post-restore-interaction-checks.json
42d4cdc92e7f2a4d0c4374f9c03b0a18235d3b976387774d028b322a8fdcd441  source-command-8986/failure-post-restore-interaction-checks.png
66025b66d14a8a501ed509880e276b1ce17071c68b81df38b2568e2ba7826784  source-command-8986/post-restore-server.log
89a8ff631b11fa8efc1b4a21eeb3b6a206e2dc65bda6fd6fa47cf65affa9e213  source-command-8986/post-restore.json
42d4cdc92e7f2a4d0c4374f9c03b0a18235d3b976387774d028b322a8fdcd441  source-command-8986/post-restore.png
```
