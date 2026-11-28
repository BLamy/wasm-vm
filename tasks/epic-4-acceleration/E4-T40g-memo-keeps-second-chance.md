---
id: E4-T40g
epic: 4
title: Successor-memo hits keep the block cache's second chance; promote the self-loop test
priority: 0.3876436
status: in-progress
depends_on: [E4-T40f]
estimate: S
risk: high
capstone: false
---

## Boundary

From E4-T40f's verifier (`evidence/e4-t40f/verifier/equivalence/block-cache-stats.txt`): a successor-memo hit
skips `get_rc_touch`, so the slot's `referenced` bit (the second chance in `insert_rc_evicting`) is never set
for blocks reached that way. Natively the decoded-cache rebuilds rise from 25.7 M to 36.0 M at 4096 slots
and from 5.8 M to 10.3 M at 16384 (no change at 262144, the browser's size). Keep the second-chance bit on
the block itself (a `Cell<bool>` set on every entry, memo or probe; read and cleared by the eviction scan)
so a memo hit marks it without touching the slot table. Promote the verifier's self-looping-block test
(`evidence/e4-t40f/verifier/tests/`) into `crates/core/tests/`.

## Deterministic acceptance

`turbo-equivalence.sh` digest unchanged (E4-T40f's); `decoded-cache-equivalence.sh` CACHE-INDEPENDENT; native
block builds at 4096 and 16384 slots back to E4-T40e's level or below (25.7 M / 5.8 M over the 2e9 run);
browser click and node -e not slower than E4-T40f.

## Adversarial verification

High risk (core). Attack list: eviction order changes cannot change architecture (the equivalence digests);
the bit on a block that has left the cache; the 1-slot cache.

## Verification log
