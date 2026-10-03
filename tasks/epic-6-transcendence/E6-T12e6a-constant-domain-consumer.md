---
id: E6-T12e6a
epic: 6
title: Enforce compiler constant-domain contracts at shared draw issue
priority: 525.02699061
status: pending
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

## Verification log

(empty)
