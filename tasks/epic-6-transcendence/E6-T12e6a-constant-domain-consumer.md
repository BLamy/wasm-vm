---
id: E6-T12e6a
epic: 6
title: Enforce compiler constant-domain contracts at shared draw issue
priority: 525.02699061
status: in-progress
depends_on: [E6-T12e6]
estimate: S
risk: high
capstone: false
---

## Boundary

Before admitting new numeric CONST shaders, enforce one versioned stage-local
finite-binary32 constant-bank contract in the shared synchronous/asynchronous
renderer. Check the same immutable current raw words that the draw uploads.
Unknown, malformed, stripped or inconsistent conditional metadata must reject
before dispatch. Preserve existing unconditional profiles and full results.
No new compiler admission, wire transport domain or production negotiation is
claimed by this consumer-only slice.

Cover every active uploaded word of the existing slot-zero bank. Preserve
completeness independently of finiteness: a shorter replacement bank must not be
completed with restore's temporary zero defaults. Respect declared/reflected
extents, the 46-register guest address limit and existing extent-47 declaration
quirk. Finite includes signed zero and subnormals; reject exponent-all-ones words
using their u32 encoding without coercion or normalization. Existing decoder
Inf/NaN rejection stays intact.

Bind selected shaders/program generations, subcontext identity and checked banks
to the same bounded draw plan. Reuse existing ownership and busy-lock rules.
After an async yield, either upload exactly the checked immutable snapshot or
reject a changed identity. Restore external GL bindings with the checked values.
Rejected contracts/words must produce zero draws and unchanged framebuffer data.

## Deterministic acceptance

`make verify-E6-T12e6a` records metadata/predicate tests and real synchronous and
yielding asynchronous renderer draws with independent whole-frame and uploaded-
word oracles. Cover both stages, CONST45, sparse uses, bank replacement/shortening,
A/B/A subcontexts, handle reuse, bound-state restoration, zero/normal/subnormal
words and rejection recovery. Any metadata wrapper is an explicitly identified
trusted host contract harness, not a guest compiler capability claim.

Run real invalid wire inputs through the normal decoder (zero applied commands),
then source-bound decoder-finite-check sabotage so the same Inf/NaN payloads
reach the new guard and still produce zero draws. Preserve affected state,
constants and async regression gates. Record exact-head evidence, repeated
varied async schedules, one final pristine clone and a fresh verifier verdict.

## Adversarial verification

Attack wrong stages/names/kinds, duplicate constraints, inconsistent profile,
missing contract, oversized extent, stale finite proof after bank replacement,
short-bank zero filling, external GL rebinding and state mutation during async
yield. Remove or bypass the new guard and require an independently measured
invalid upload/draw or framebuffer contradiction. Confirm subnormals remain
unaltered in the raw channel and are not accidentally rejected as nonfinite.

## Execution notes

The consumer recognizes `virgl-webgl2-raw-bits-v7` with one
`constant-bank-finite-f32-v1` stage-local constraint. The declaration extent is
1..47, while the checked upload remains the reflected prefix capped at the
46 addressable guest registers. Existing unconditional profiles retain their
metadata and restoration behavior.

The shader bridge is a trusted host capability. A stripped-contract attack
retains v7, and a relabelled-profile attack retains the constraint. Removing both
markers from a previously accepted unconditional result is indistinguishable
from that required legacy result; this slice does not authenticate arbitrary
host metadata or infer contracts from GLSL text.

The shared non-draw restore path skips incomplete/nonfinite conditional uploads,
preserving command-prefix CPU state. The strict draw plan validates both stages
before index readback and binds immutable checked prefixes to selected identities.
Under the isolated decoder bypass, SET may therefore store an invalid bank; the
following DRAW must reject without uploading it. Normal wire rejection remains
atomic at predecode.

The final gate replays the affected constants, state, resources, draw and async
workloads. Their existing independent oracles remain authoritative. The historical
E3b top-level receipt pins a much older compiler, so a named successor compatibility
receipt compares complete legacy translations while preserving that historical
receipt's policy. Compiler semantics are unchanged from verified E6.

## Verification log

(empty)
