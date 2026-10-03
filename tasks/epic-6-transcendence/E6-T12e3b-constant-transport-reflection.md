---
id: E6-T12e3b
epic: 6
title: Bound high constant uploads and active renderer reflection
priority: 525.02699035
status: pending
depends_on: [E6-T12e3]
estimate: S
risk: high
capstone: false
---

## Boundary

Carry the separately verified CONST0..45 shader bank through slot0 VS/FS
SET_CONSTANT_BUFFER transport, reflection, restoration and draw completeness.
Accept at most184 words /46 vec4s per stage; preserve whole-vec4, finite-float,
stage/slot and whole-submission validation. Integer constant semantics remain a
separate boundary. Preserve immutable context/subcontext snapshots and exact
generation ownership. Do not raise the unrelated system-UBO byte budget.

Distinguish the addressable46-entry bank, upstream declared uniform extent
(possibly47 for disjoint CONST45 then CONST0 declarations), actual driver
reflection (which may retain that unused suffix), and the guest addresses the
shader can actually read. Reject guest addresses beyond45; a retained reflected
extent47 alone does not imply that CONST46 is addressable.
Use actual host per-stage limits and successful linking; metadata must describe
the actual declaration. Upload only the admitted addressable prefix. Missing data
that an active shader can read must fail before drawing, never reuse stale
uniforms or silently invent guest inputs. Any padding or inactive suffix policy
must be explicit and proven separately from required data.

## Deterministic acceptance

`make verify-E6-T12e3b` validates literal raw184-word packets, rejects188 words,
non-vec4 lengths and stage/slot neighbors before effects, then executes actual
renderer draws reading CONST45 in both VS and FS. Prove both declaration orders,
optimized-out tails and fully unused constant declarations through native/Wasm
translation, actual link reflection and independent vertex/pixel oracles.
Record bounded memory ownership, source identities, deterministic raw command
evidence, exact-head and pristine-clone proof. Preserve original shader/state/
draw regressions and the12/19 unchanged shader result. Production stays off.

## Adversarial verification

Poison low/high uniforms and switch A/B/A contexts and subcontexts. Destroy and
reuse numeric IDs, supply one fewer required vec4, and verify rejection leaves
state and budgets unchanged. Distinguish unused declarations from active reads;
attack declared47/retained47/addressable46 and required46/provided45 without
off-by-one aliases. Poison any retained unaddressable host padding and prove
that it cannot become a guest input.
Sabotage high-index upload or context restoration and require an independently
computed hardware output to fail. Do not use the lowering itself as the oracle.

## Verification log

(empty)
