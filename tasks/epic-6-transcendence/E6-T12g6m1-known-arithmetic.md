---
id: E6-T12g6m1
epic: 6
title: Materialize exact known ADD and MUL producer words for bounded consumers
priority: 525.027010585
status: in-progress
depends_on: [E6-T12g6l]
estimate: S
risk: high
capstone: false
---

## Boundary

The unchanged larger compositor bodies still reject after opcode closure: full
92cb866a first fails at computed SIN (PC38), and c5806d5f at computed POW (PC31).
Neither a numeric origin nor a host floating calculation proves their source
encodings. One prerequisite is exact known ADD/MUL producer facts. On a final
whole-text retry only, fold fully known, already authorized normal-or-zero
post-modifier operands with integer binary32 round-to-nearest/ties-to-even.
Materialize the exact normal-or-zero result word and its matching numeric shadow
before granting that producer version a fact. Preserve masked/aliased reads,
joins, source versions, grammar and bounded IR storage. Dynamic operands,
exceptional results and unproven computed consumers retain existing rejection.

This does not admit the full originals or grant typed uniform/interpolated input
ranges. Full-source acceptance remains E6-T12g6m. Production negotiation and
public imports remain disabled; no FPS or MIPS claim follows.

## Deterministic acceptance

`make verify-E6-T12g6m1`: strict affected C/JS checks, ASan/UBSan recorded native
fixtures with original LLVM binary/profiles, exact native/Wasm single/pair
parity, independent integer binary32 predictions, actual physical hardware
carrier words and RGBA bytes over three seeds, consumer metadata/owned-bank
attacks and zero-error/disposal. Exercise ADD/MUL masks, swizzles, aliasing,
signed zeros, rounding ties, cancellation, overflow/subnormal nonfold cases,
known versus dynamic/overwritten/joined sources, and computed SIN/POW/F2I and
address consumers. Old admitted fixtures must remain byte-identical; explicitly
inventory formerly rejected known-producer extensions without changing old
evidence. Bind both larger full literal source hashes and their continued gate.

Record source-fault sensitivity, complete changed-runtime coverage and one
scrubbed pristine clone at the frozen source. Submit original binaries,
source/index digests and raw captures to a fresh adversarial critic.

## Adversarial verification

Predict rounding, post-modifier source version, masked writes and domain facts
before inspecting reports. Attack integer-manufactured unknown words, unsafe
results, missing source lanes, branch joins, indirect addresses, metadata
forgeries/accessors and source-size/depth/instruction bounds. The exact literal
emission must execute before a fact is used; a host-only result is insufficient.
Run all scoped acceptance angles, one bounded novel attack and sabotage the new
tests. Hold changed hunks against original native/V8 profiles; uncovered behavior
needs evidence or deletion. Preserve predecessor HELD evidence when unchanged.

## Verification log

### 2026-10-04 — worker — activation

Discard predecessor verified at bfd5c97f. Read-only full-body native prechecks
and diagnostic scratch compiler under /tmp locate PC38 SIN and PC31 POW as
the first final-retry failures. The bounded reproducer `ADD TEMP[0], IMM[0],
IMM[1]; SIN OUT[0], TEMP[0]` with normal known operands also rejects. This leaf
adds exact emitted known-producer authority; unknown uniform/geometry facts
remain separate prerequisites. Planning diagnostics are not acceptance evidence.
