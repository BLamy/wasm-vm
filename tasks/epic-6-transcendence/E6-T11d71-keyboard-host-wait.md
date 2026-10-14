---
id: E6-T11d71
epic: 6
title: Preserve original keyboard host waits across tickless guest idle
priority: 525.027038
status: in-progress
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
