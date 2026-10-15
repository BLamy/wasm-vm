---
id: E6-T11d74d1
epic: 6
title: Preserve the displayed GPU front buffer until the next valid frame
priority: 525.02703831
status: in-progress
depends_on: [E6-T11d74c]
estimate: S
risk: high
capstone: false
---

## Boundary

Separate cancellation of obsolete scanout ownership/recovery state from erasing
the visible front buffer. Valid renderer/2D page flips retain the displayed pixels
until a fresh binding frame is drawn; explicit display disable/reset/teardown
still clears them. Old queued frames cannot draw or satisfy new receipts.

## Deterministic acceptance

`make verify-E6-T11d74d1` records original worker/native-MMIO GPU buffer switches,
physical browser pixels across the between-bind-and-present interval, exact old
receipt cancellation and fresh receipt acceptance. Cover explicit disable/reset,
context loss before replacement, rapid rebind, partial next frame and both
ordinary scheduled and retained production presentation. Build the ordinary
Wasm/dist, run relevant native/protocol/physical regressions and default127/0,
then one final complete pristine clone without alternates. Actual Omarchy final
factory/input/publication remains74d after74d2; no old factory is relabelled
compatible with new runtime bytes.

## Adversarial verification

Fresh verifier predicts actual canvas bytes before each transition, then attacks
queued old receipt delivery, disable, reset and recovery replay. A screenshot
after the replacement frame does not prove continuity between frames. Sabotage
the new no-blank assertion with the original unconditional clear once. Carry
unchanged native/DMA/security proofs by their recorded dependency identities.

## Verification log

### 2026-10-15 — worker — reproduce before changing runtime

Original worker build5dd286c9 / ordinary Wasm9b7fd924 reproduces40 completely
transparent samples out of379 during six trusted pointer moves and a bar click;
`target/evidence/production-gpu-ready-warm-self04/pointer-flicker.json` retains
the executed read-only sampler, original wire messages, GPU counters, pointer
frames and raw transparent PNGs. Separate allocation refusals remain74d2.
