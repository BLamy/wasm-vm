---
id: E4-T40g
epic: 4
title: Successor-memo hits keep the block cache's second chance; promote the self-loop test
priority: 0.3876436
status: verified
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

### 2026-11-28 — verifier — VERDICT: verified

Fresh session at head `be9e38c8a` (the claim's code head `a2087a72a`; `crates/` unchanged since). Predictions were written
before any run (`evidence/e4-t40g/verifier/predictions.md`). All evidence is under `evidence/e4-t40g/verifier/`.

- P1 turbo-equivalence — HELD. `tools/perf/turbo-equivalence.sh` on my release CLI printed EQUIVALENT with
  `fnv64=eea93e63da8eb29b`, retired 1999798762, state `af37489250dc…` (`turbo-equivalence.log`). This is E4-T40f's digest.
- P2 decoded-cache-equivalence — HELD. CACHE-INDEPENDENT; all six runs gave `eea93e63da8eb29b`. Builds were 25,733,845 at
  4096 slots, 5,800,121 at 16384 and 271,066 at 262144 (`decoded-cache-equivalence.log`). These equal the worker's
  numbers and E4-T40e's level (25,733,847 / 5,801,802). The 2-build gap to before E4-T40f is in the expected direction:
  a memo can touch a shadowed duplicate (E4-T40f P11) that the probe would not reach. It affects performance only.
- P3 core tests — HELD. `cargo test -p wasm-vm-core --features trace`: 1382 passed, 0 failed. The diff adds no new
  `#[ignore]` (`core-tests.log`). The promoted `crates/core/tests/e4_t40f_verifier_attacks.rs` matches
  `evidence/e4-t40f/verifier/tests/verifier_e4t40f.rs` except for its header line, and all 3 tests ran.
- P4 clippy (core `--all-targets --features trace`, wasm `--lib` wasm32) and fmt — HELD (`clippy.log`, `fmt.log`).
- P5 the bit on a block that has left the cache — HELD by construction. Only two places set the bit. One is
  `get_rc_touch`, which only reaches resident, current-generation slots. The other is the memo, which needs
  `successor_for`, and that requires `live && block_gen == generation`. Eviction, `flush_page` and `retire_all` clear
  `live`, and `flush()` bumps the generation. Nothing can re-insert a block: the only slot writer, dispatch.rs:861,
  wraps a freshly decoded `DecodedBlock` (bit `false`, dispatch.rs:428) in a new `Rc`. So a stale `true` on a retired
  block is never read.
- P6 two slots sharing one Rc — HELD, it cannot happen, for the same reason (one `Rc::new` per insert). A shadowed
  duplicate is a distinct `Rc` with its own bit.
- P7 1-slot cache — HELD. `decoded-cache-equivalence.sh 200000000 … 1 4096` gave CACHE-INDEPENDENT with
  `fnv64=adcd89047d9db927` at both sizes; the 1-slot run had 37,334,439 builds (`decoded-cache-equivalence-1slot.log`).
  The promoted self-loop and SMC tests both use `cap1`.
- P8 sabotage, in a scratch sparse worktree (`sabotage.py`) — HELD.
  - S1 (memo touch removed): the digest is unchanged and builds rise to 35,989,761 at 4096 slots, exactly E4-T40f's
    number (`sabotage-S1.log`). So the acceptance's build count separates the fix from the gap.
  - S2 (the scan never clears the bit): the digest is unchanged and builds are 44,191,069 (`sabotage-S2.log`).
  - As predicted, the digest is blind to both. Only the 2e9 perf run discriminates.
- P9 coverage — HELD.
  - The memo `touch()` (lib.rs:6325-6328) ran and was load-bearing: S1 is the S1-vs-HEAD build delta.
  - The scan's `replace(false)` (dispatch.rs:845-850) also ran and was load-bearing: S2's delta.
  - `get_rc_touch`'s touch ran on every probe hit in the same runs.
  - Waived: the scan's `None` arm. A `None` slot is taken as free by the first pass (dispatch.rs:834-837), so the
    scan only ever sees full windows.
  - The wasm build ran in the browser runs.
- P10 browser — HELD. Interleaved old (8134, wasm `9188947f…` = `8b754ab38`) and new (8125, `4f03822c…` = this head's
  `web/dist`), `--n 8 --idle-s 30` (`browser/summary.txt`):
  - click: 236.1 and 234.2 ms (new) vs 242.1 and 234.6 ms (old)
  - node -e: 1480.8 and 1480.4 vs 1542.7 and 1531.1 ms
  - key echo: 39.2 and 46.1 vs 47.3 and 48.4 ms
  - idle: 1.0 % vs 1.1 %
  - Each load has one console error, a 404.
- Own attack — no finding. Integration test `tests/e4_t40g_verifier_second_chance.rs` (hot pair H1↔H2 entered only by
  the memo, plus a cold stream through an 8- or 16-slot cache) is architecturally equal to cache-off. But its build and
  hit counts are identical at HEAD and under S1 for every shape I tried (cold 3-20, cap 8/16): the hash layout keeps the
  hot pair off the cold blocks' window heads. Discarded as a regression test because it does not discriminate. It is
  kept in evidence only as a record.
- Mock hunt: nothing found. All 8 screenshots (worker's and mine) are byte-identical (`863c0aa9…`). That fits a paced,
  architecturally identical desktop and is not a fixture: the timings differ per load.
- SUITE: no new promoted test. Gap (follow-up, not a refutation): no cheap-gate test pins the memo touch. Under S1,
  `--lib` plus the promoted tests pass with 515/515 (`sabotage-S1-core-tests.log`); only the 2e9 build count catches it.
  A crate-internal `BlockCache` unit test would close it. It should fill a window, touch one block through
  `successor_for`, insert, and assert the touched block survives.
Commands: `cargo test -p wasm-vm-core --features trace`; clippy ×2; `cargo fmt --check`; `cargo build --release -p wasm-vm-cli`;
`tools/perf/turbo-equivalence.sh`; `tools/perf/decoded-cache-equivalence.sh` (default, and `200000000 … 1 4096`); S1/S2 CLIs
via `BIN=… decoded-cache-equivalence.sh 2000000000 … 4096`; `desktop-latency.mjs` ×4 interleaved.
Not checked: a cold clone, the live site (`deploy.log` not re-verified), the 1-slot cache at 2e9 instructions (200M only),
and the JIT-on (discovery) browser path.
