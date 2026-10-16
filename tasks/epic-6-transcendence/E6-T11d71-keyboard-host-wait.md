---
id: E6-T11d71
epic: 6
title: Preserve original keyboard host waits across tickless guest idle
priority: 525.027038
status: verified
depends_on: [E6-T11d70, E6-T11d72, E6-T11d73]
estimate: S
risk: high
capstone: false
---

## Boundary

A delivered physical keyboard make awaits a future host break. ICount tickless
WFI must preserve that host turn rather than jump arbitrarily to guest repeat
or other timer deadlines. Guard original staged/pending/delivered keyboard state
through the actual input transport; normal instruction-count time still advances.
Break, release-all and transport reset clear the wait after their original frames
settle. A quiet or absent keyboard retains existing deterministic idle behavior.
Do not change guest repeat settings, synthesize keyboard results, alter API caps,
or shorten the trusted typing to hide the recorded clean-run failure.

## Deterministic acceptance

`make verify-E6-T11d71` records original keyboard MMIO/DMA plus guest WFI traces in
cached and uncached modes at multiple initial times/deadlines. Exercise staged,
pending, delivered make, original break, release-all, reset, refused input and
quiet/absent-device controls. Held input cannot cause an idle clock jump; normal
retirement continues and successful break/reset restores ordinary deadline jumps.
Run affected format/lint/native/wasm gates. Run the full existing
`make verify-E6-T11d` inside this acceptance so final real Mesa/Hyprland/scanout,
software fast boots for all images and stock bar/Foot/trusted keyboard/cursor
proof use the same frozen runtime. One final pristine full-history cold clone
runs this acceptance without borrowed outputs. Parent may carry this exact-head
proof after fresh verification; do not restart its unchanged gates again.

## Adversarial verification

Independently vary key codes, initial mtime/deadline and chunk/cache schedules.
Attack dropped/refused makes, an undelivered break, release-all and device reset.
Verify no-key controls still jump and instruction-count time is never frozen.
Remove only the new wait guard in an isolated copy; the original held-key test
must fail. Inspect the stock desktop's original balanced physical transitions,
actual typed command, absent-before/present-after marker and deliberately displaced
guest cursor. The old clean negative remains evidence, not a passed final run.

## Verification log

### 2026-10-14 — worker — ordered prerequisite from clean desktop negative

Parent `E6-T11d` is blocked by the preserved cold03 input failure. The fresh
critic's exact original transport test demonstrates the held-key idle-jump gap
at runtime head `ed63d292`, unchanged core from5943. Two old-source executions
both exit101 with four held failures and four quiet controls; one guest WFI
retires with digest `dd8c58e8d6e657e4`. Source/test/predictions/audit are in
`target/evidence/critic-production-parent-keyboard-wfi-negative01`, including
literal original down+SYN DMA and used.idx2. This task repairs that one boundary;
exclusive causation of the observed Linux repeated character is not inferred.

### 2026-10-14 — worker — native repair held; original desktop negatives

Frozen runtime `5c0b909048eac8a7d8511be68b6d04482372527c` passed all seven
selected native gates and the complete parent software-warm, actual Mesa/cube/
Hyprland and original-handshake components in both hot and pristine cold runs.
Fresh native review carries48 lifecycle,4 ordinary-retirement,8 original held/
quiet and4 independent two-key rows, plus the isolated guard-removal control.
Those native holds do not establish that the Linux userspace repeat failure is
resolved.

The unchanged hot stock typing at50ms produced `tttouch /tmp/gpukeyboard42touch`,
then Bash command-not-found. All60 trusted DOM transitions and their original
evdev frames were balanced; pending/dropped/rejected/held counts were zero. All23
bar probes were retained, the final crop passed, and actual Foot was focused.
Final GPU state has649 begun/649 completed/0 failed,270 draws, no pending job,
no loss or browser timer gap. All20 marker reads failed. This is a real product
negative, not a final acceptance; the native fix alone is insufficient.

The pristine cold stock run reached the desktop and focused Foot, then requested
the same `/app` document again at1792016236931 (initial1792014840430) during the
fresh-monitor read before typing. Its execution context disappeared. The old
harness did not capture the navigation initiator; no cause is assigned. This is
missing closed stock proof, not a keyboard refutation before typing. Passive CDP
document-request/navigation/crash observation was added to the recording harness;
it neither retries nor alters the guest. Syntax and its two protocol tests pass.

A separate diagnostic driver invokes the same unmodified trusted input helper
on only the original software-warm Omarchy initial route. It passes the actual
marker and displaced guest cursor. Its exact driver differences/hashes are in
`target/evidence/production-keyboard-software-diagnostic01/harness.json`; this
software result does not discharge GPU acceptance. A private original-GPU guest
diagnostic is now collecting monotonic evdev and Wayland timestamps with a
separate, source-recorded observer. It is not public stock acceptance.

Commands: `VIRGL_KEYBOARD_WAIT_EVIDENCE_DIR=target/evidence/production-keyboard-host-wait-frozen01 make verify-E6-T11d71`;
`python3 tools/virgl-production/cold.py --task E6-T11d71 --output target/evidence/production-keyboard-host-wait-cold01`;
software diagnostic command and original output are recorded alongside its
harness. Closed hot/cold originals and software diagnostic are sealed in
`evidence/virgl-production-keyboard-host-wait/worker/stock-repeat-and-navigation-negatives-01.tar.gz`
(8,417,433 bytes, SHA-256
`a77ed05d56d25a88502a342a625abf2bb6a1b850d5307b9e4fc13c730ab4fec5`).
All272 members were reopened and checked. The task remains in-progress; no
deployment or verified verdict is claimed.

### 2026-10-14 — worker — blocked on explicit interactive clock policy

Exact repro: run `make verify-E6-T11d71` at frozen5c. The original stock50ms
physical typing ends in `tttouch`, Bash command-not-found and20 failed marker
reads, as preserved above. The valid native guard does not establish correct
userspace interactive timing. Ordered S/high `E6-T11d72` owns an explicit
accelerated-desktop clock policy and its actual browser measurements;71 may
reuse that final full parent proof after its fresh verdict. This leaves no
unverified native dependency for72, which reuses verified E5-T26i timekeeping.

### 2026-10-15 — worker — resume for incremental proof closure

D72 is independently verified at `8c902c7076fcb6eee3075abc42b4a3a662558a93`;
D73 is independently verified at `7e2739f28b9c539be894ecd8f693cf743c35258e`.
Resume this native guard task for evidence-only closure. The final D72 original
stock, software, private Mesa/Hyprland, pristine clone and valid-frame carry
close the previously missing desktop proof. Native guard/lifecycle predictions
and their negative control remain HELD within the unchanged boundary. No new
runtime edit, broad suite, cold clone or long stock boot is required by the
incremental rule. The original native-only repeated-t run remains failed.

### 2026-10-15 — worker — final native host-wait claim with verified components

Submission head `8b895e75` changes only task/queue metadata from D72 verifier
head8c902c70. The original native keyboard guard, transport lifecycle, tests,
Wasm adapter and renderer are byte-identical to frozen61. The closure archive's
empty scoped diff and eight source copies bind that statement. The D73 timing
implementation supersedes the old unpaced dependency and is independently
verified; its original keyboard/GPU wait and busy-retirement predictions carry.

Native evidence carries the original independent48 lifecycle,4 ordinary
retirement,8 held/quiet and4 two-key rows with the isolated guard-removal
negative. Their raw independent archive is included, not merely its summary.
The final D72 pristine run also executes both native host-wait tests and both
independent original-keyboard critic tests, all passing. Native retirement is
not frozen; staged/pending/delivered keys hold only idle jumps, and original
breaks, release-all and transport reset clear the wait.

D72's independently verified final components close the earlier desktop gap:
all10 software fast-boot/repeat/persistence phases; actual VirGL-only Mesa with
768 textured pixels and index83,1000 cube frames, Hyprland/Foot scanout and
13-family original handshake; stock UID1000 keyboard literal command from60
trusted transitions/62 original frames, absent-before/present-after marker,
readable bar and displaced guest cursor. Stock final657 begun/completed,308
draws, no pending/failed/cancelled job and worker/page errors[] hold. The
original five-second pause and retirement-aware resume bound also hold.
Stock cursor resource0 is not cursor-plane recovery evidence.

The final input boundary passed hot and pristine no-local/full-history clone
proof at61eeb1b5, with own build, no alternates,89 tests,17 actual-worker rows
and default127/0. The ordinary Wasm digest is
`d055c473b686ce543d8b87da68034e240ba0f66cf8aacbb482e03a405a64363f`.
D72's explicit five-line guard domain-equivalence proof carries the valid stock
frames from e17, while new rejection paths are exercised by actual shipping
Wasm and worker. This is incremental composed acceptance, not a relabelled
whole earlier wrapper. The old native-only repeated-t stock failure, cold
navigation failure, private readiness timeouts and task-allowlist wrapper
failure remain failed. No deployment, recovery or300MIPS claim is made.

Command: `python3 target/evidence/production-keyboard-host-wait-closure01/seal.py`.
Artifact: `evidence/virgl-production-keyboard-host-wait/worker/keyboard-host-wait-proof-closure.tar.gz`,
2,902,259bytes, SHA-256
`c37868db24a5938b2592cabfa34605497a5cca927271b44fd0f77df8c2ccd4df`,
23members/22identities all reopened. Five referenced proof archives are rehashed
and all their members reopened. D72 verifier8c902c70 and D73 verifier7e2739f2
remain the independent authority for unchanged components. Fresh D71 verdict
is required before the parent can resume.


### 2026-10-15 — verifier — original host-wait evidence closure

VERDICT: verified

- **Original P1–P4 native predictions — HELD by unchanged evidence.** Staged,
  pending and delivered keyboard makes block only the WFI idle jump; original
  break/release-all/reset settlement restores it. Quiet, absent, refused and
  dropped controls still jump; normal128 instruction retirements advance2ticks.
  Renewed pristine e17 native recording contains48 lifecycle,4 retirement,
  8 held/quiet and4 independent two-key rows, all literal expectations intact.
  Original WFI digest `dd8c58e8d6e657e4`,128-retirement digest
  `f1ab8763a78f2b25` and two-key259-retirement digest `5af09e729e0aa754` bind
  these points. Original MMIO/DMA used extents and bytes, multiple initial times,
  deadlines and cached/uncached schedules remain independently held.
- **Novel attack / negative control — HELD.** Carry the original four two-key
  rows and healthy12-row isolated run. Removing only the original keyboard wait
  condition compiled and exited101: `production_keyboard_wfi_critic.rs:215`
  observed500037 instead of39, with four original held-key refusals also failing.
  Raw original sources, predictions and output remain embedded in the591-member
  native archive SHA-256
  `a5d28ab63f64cdffbc67fb2871f90dd3f8e595a5a82272be74eae37702143c5d`.
  This held attack was not rerun or weakened.
- **C1 / P5 source and timing dependency — HELD.** Independently compared exact
  `awaiting_host_key_release`, `external_keyboard_io_pending` and
  `after_wfi_retire` function bodies: unchanged from original5c to frozen61.
  Entire input/mod.rs and independent critic test are unchanged. All current
  native/renderer/dependency code equals independently verified D73. Its10
  paced-mode original transport rows preserve the keyboard wait while the host
  ceiling exceeds the deadline; break/reset restores idle progress. D73 is the
  verified timing dependency, not an unreviewed change folded into this task.
- **C2–C3 / P6–P9 composed final acceptance — HELD.** D72 verifier8c902c70
  authenticates all10 software initial/repeat/persistence phases, actual
  Mesa768pixel/index83/cube1000/Hyprland/Foot/13-family handshake, and original
  stock UID1000 package bar and unchanged nominal50ms physical typing. Sixty
  trusted transitions/62 original frames create the absent-before marker at
  serial5577, with guest cursor640,400→430,412 and finalGPU657/657,308draws,
  no pending/failed/cancelled job or worker/page errors. The actual five-second
  pause and measured retirement-aware bound hold. The new pure ABI guard accepts
  all62 original integer frames; stripping its five lines restores the original
  e17 loader exactly. Final61 hot and new pristine own-build input proof supplies
  89 tests,17 actual worker rows and default127/0, ordinary Wasm
  `d055c473b686ce543d8b87da68034e240ba0f66cf8aacbb482e03a405a64363f`.
  Required native and desktop observations are thereby closed by explicit
  incremental component custody, without inventing another full successful
  wrapper or repeating unchanged long boots.
- **C4–C5 custody and preserved negatives — HELD.** Rehashed/reopened every
  closure member:23 members/22 identities; all eight source copies match61 and
  the scoped product diff is empty. Reopened all five referenced proof archives,
  including the raw native archive's590 paired identities. Worker closure
  archive SHA-256 is
  `c37868db24a5938b2592cabfa34605497a5cca927271b44fd0f77df8c2ccd4df`.
  Original D71 repeated-t/navigation archive remains exact
  `a77ed05d56d25a88502a342a625abf2bb6a1b850d5307b9e4fc13c730ab4fec5`;
  native guard alone was insufficient. D72 full-cold/private timeout and stock
  outer task-option failures remain failed. The pacing dependency's later valid
  recording does not relabel them or establish exclusive causation.
- **COVERAGE / SUITE.** No native runtime hunk changed during this closure;
  original predicate/after-WFI paths and lifecycle/retirement controls remain
  executed under their held source boundary. Keep both original critic tests
  and worker lifecycle tests. The independent closure ledger maps C1–C5 and
  each changed boundary; there is no remaining required D71 proof gap.
  Seal `evidence/virgl-production-keyboard-host-wait/verifier/final-closure/independent-keyboard-host-wait-closure.tar.gz`:
  10172bytes, SHA-256
  `9271161e07450a82169fb332655636e9bcab53d8232d27aa42a25eec16d25ab8`,
  8members/7identities reopened. Stock cursor resource0 does not prove cursor-plane
  recovery; parent deployment, E6e recovery and300MIPS remain outside this verdict.

Read-only command:
`python3 target/evidence/critic-production-keyboard-wfi-closure02/audit-closure.py`.
Original selected native/negative-control commands and raw bytes are preserved
inside the embedded independent archive. No implementation, runtime test,
pristine clone or long browser boot was changed or repeated for this closure.
