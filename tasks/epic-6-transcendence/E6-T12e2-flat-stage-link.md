---
id: E6-T12e2
epic: 6
title: Derive flat vertex-fragment interfaces from accepted shader pairs
priority: 525.0269902
status: in-progress
depends_on: [E6-T12e1]
estimate: S
risk: high
capstone: false
---

## Boundary

Admit CONSTANT interpolation on fragment GENERIC inputs, including unchanged
original `67c701faf0ee06bcefdc246cd8b73f7b8d6278cc2403aa99c18d1912fbb9a0aa`.
Expose interpolation requirements in checked metadata and derive the matching
vertex output qualifiers from the accepted fragment stage when translating and
linking a pair. Keep the externally supplied shader-key surface closed: the
pair interface is internally derived from bounded declarations, never supplied
as arbitrary guest compiler keys and never produced by editing captured TGSI.

Bind any compiled-stage/program reuse identity to the effective interpolation
interface. Switching a fragment stage between smooth and flat must not reuse an
incompatible vertex program. Preserve existing generation and context ownership.
The standalone flat fragment may be demonstrated against a literal flat VS,
but task completion also requires two translated TGSI stages linked through the
actual bridge/renderer pair path.

## Deterministic acceptance

`make verify-E6-T12e2` requires exactly 12 of the 19 unchanged original hashes
to translate; all seven PRECISE-bearing bodies stay rejected. Record native/Wasm
metadata and generated-source parity. Link and draw the original flat fragment
with a translated vertex stage and independent unequal per-vertex attributes;
assert literal interior pixels that smooth interpolation cannot produce.
Exercise smooth-to-flat-to-smooth relinking, including existing reuse identities.
Retain all prior shader/draw regression oracles and exact-head clean-clone proof.

## Adversarial verification

Attack missing or duplicate semantics, incompatible components/types/qualifiers,
malformed CONSTANT declarations, stage/context reuse and stale interface keys.
Sabotage the derived flat qualifier or reuse key and require the unequal-vertex
pixel oracle to fail. Translation alone is not compositor or Mesa bring-up.

## Verification log

### 2026-10-03 — worker — activation

E6-T12e1 is independently verified at
`d1fd813b786fd6ca5337b4d0f861aaa9aed97037`. This S/high slice adds only
fragment CONSTANT interpolation, a bounded internally derived two-stage API,
and owned vertex variants in the existing command renderer. It does not enable
production GPU negotiation. The accepted language and interpolation metadata
advance explicitly to `virgl-webgl2-straight-line-v4`.

Selected gates: C guard/native ASan+UBSan and fixed-memory Wasm build; exact
native/Wasm shader-pair parity and hostile pair inputs; real hardware smooth,
flat and mixed-interface pixels through both the pair API and actual command
renderer; program identity, allocation budget and cleanup attacks; prior shader,
state and draw acceptance; intended stale-program pixel sabotage; frozen-head
receipt and one scrubbed pristine clone. Unchanged Rust/device/default-web
boundaries carry forward. A fresh independent critic records the final verdict.

