---
id: E6-T12f
epic: 6
title: Preserve PRECISE semantics and close all original captured shader bodies
priority: 525.02700
status: cancelled
depends_on: [E6-T12e9]
estimate: S
risk: high
capstone: false
---

## Boundary

With the separately verified declaration, lane, interface, integer, float,
conditional and loop/address boundaries in place, resolve only the remaining
PRECISE semantic boundary. The inventoried decorated operations are ADD_PRECISE,
MUL_PRECISE, MAX_PRECISE, FSEQ_PRECISE, FSNE_PRECISE and MOV_PRECISE. Audit their
pinned TGSI meaning and dependencies; do not assume that adding one qualifier
preserves all upstream expression ordering or contraction behavior.

Use a defensible ESSL300 implementation with actual semantic evidence, or mark
this task blocked with the exact external/semantic dependency and reproducer.
No speculative feasibility pass. Removing PRECISE, substituting a recaptured
body, changing arithmetic, zero-initializing away unproven dataflow, or silently
cutting off a loop is not completion. If implementation proves to require an
additional independent feature family, split that family before activation.

## Deterministic acceptance

`make verify-E6-T12f` requires all original 19 TGSI SHA-256 bodies to translate
unchanged, preserve checked metadata and compile/link in the actual WebGL2
browser. Execute every newly supported PRECISE path with independent bit/ULP/
pixel oracles appropriate to the audited guarantees, including cancellation and
contraction-sensitive inputs. Exercise the original loop bodies only under their
verified execution/address admission contract; report that contract explicitly.
Require native sanitizer/Wasm parity, previous shader and scene regressions,
exact source/toolchain/output identities and final pristine-clone evidence.

## Adversarial verification

Attack operation ordering, contraction, signed zero, rounding boundaries,
subnormals/infinities/NaNs wherever the admitted contract includes them, modifier
ordering and implementation optimization. Expected values must not be produced
by the lowering under test. Sabotage the required precision mechanism and demand
oracle failure. Compilation alone proves neither production compatibility nor
complete compositor rendering; production negotiation remains separately gated.

## Verification log

### 2026-10-03 — worker — decomposed before activation

The seven remaining exact bodies require plain FSEQ/FSNE and independent
observational-definedness work in addition to PRECISE. In particular the radial
TEMP2.x gap can affect a visible alternate root under the current finite-bank
contract. The previous PRECISE-only boundary would not establish its acceptance.

Replaced by S tasks E6-T12f1 through E6-T12f6: raw equality masks; selected-away
lane definedness; explicit radial admission; precise word operations; precise
binary32 arithmetic; and unchanged 19-body integration. Each has one deterministic
acceptance command. E6-T12f6 is the full-corpus closure dependency for E6-T12g.
All shader bodies remain unchanged; no capability or original acceptance count
changes as part of this planning decomposition.
