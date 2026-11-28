---
id: E4-T40g
epic: 4
title: Successor-memo hits keep the block cache's second chance; promote the self-loop test
priority: 0.3876436
status: implemented
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

### 2026-11-28 — worker — claim (head `a2087a72a`)

Commits: `d7e594c02` (the bit moves from `CacheSlot` to `DecodedBlock::referenced`; `DecodedBlock::touch` from
`get_rc_touch` and from a successor-memo entry in `enter_block`; the eviction scan reads and clears it on the slot's
block; the E4-T40f verifier's tests promoted as `crates/core/tests/e4_t40f_verifier_attacks.rs`), `a2087a72a` (build id).

- `bash tools/perf/decoded-cache-equivalence.sh` (`evidence/e4-t40g/decoded-cache-equivalence.log`): CACHE-INDEPENDENT,
  all six runs `fnv64=eea93e63da8eb29b`; builds at 4096 / 16384 / 262144 slots: **25,733,845 / 5,800,121 / 271,066**
  (before E4-T40f: 25,733,847 / 5,801,802 / 271,066; E4-T40f: 35,989,761 / 10,315,043 / 273,872).
- `tools/perf/turbo-equivalence.sh` (`turbo-equivalence.log`): EQUIVALENT, `fnv64=eea93e63da8eb29b`, state
  `af37489250dc…` — the E4-T40f digest.
- `cargo test -p wasm-vm-core --features trace`: 1382 passed, 0 failed; clippy (core --all-targets --features trace,
  wasm --lib wasm32) and fmt clean.
- Browser, committed bundle (8125, wasm `4f03822c62dd…`) vs E4-T40f's (`8b754ab38` on 8134), two interleaved loads a side
  (`evidence/e4-t40g/browser/`): click 232.6, 234.9 vs 237.1, 238.0 ms; key echo 44.1, 41.9 vs 44.1, 47.7 ms; node -e
  1503, 1492 vs 1529, 1529 ms; idle 1.1 % both.
- Deployed (`deploy.log`).
