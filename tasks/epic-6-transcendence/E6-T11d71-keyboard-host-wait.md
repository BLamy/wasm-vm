---
id: E6-T11d71
epic: 6
title: Preserve original keyboard host waits across tickless guest idle
priority: 525.027038
status: blocked
blocked_on: [E6-T11d72]
depends_on: [E6-T11d70]
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
