---
id: E5-T34f
epic: 5
title: Bind warm desktop snapshots to the wasm module content hash, not the crate version
priority: 0.3875
status: pending
depends_on: [E5-T34e]
estimate: S
risk: medium
capstone: false
---

## Boundary

Follow-up from the E5-T34e verifier. Warm snapshots for both the Replay desktop and
Omarchy bind their "wasm build" identity to the crate version (`0.0.1`). A rebuilt
wasm with the same version and a same-length but different device-state encoding
would therefore not be refused by identity; it would be caught only by structural
device-state checks. Bind the identity to the SHA-256 of the shipped wasm module
(or an equivalent build-content id stamped at build time), for every published warm
snapshot. A mismatch must cold-boot, as today.

## Deterministic acceptance

Native/wasm tests show that a snapshot carrying another build-content id is refused
(`foreign_build`) even at the same crate version. A browser run restores the
published Replay desktop and Omarchy snapshots after re-capture with the new
identity, and a stale-identity snapshot cold-boots.

## Adversarial verification

Medium risk: check the acceptance criteria against recorded evidence, and try one
bounded novel attack.

## Verification log

(empty)
