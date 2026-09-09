# E5-T26p semantic admission and verifier attack

**BOUNDED VERDICT: HELD — no semantic-stage blocker found.**

This does not run or adjudicate the scoped task gate, browser demo, final clone, or final task
status. Runtime hashes remained:

```text
ab15c6a854441fc99f28a3c2e34d60fea3c5d2450d2db3577f1b185a7be7cd39  crates/core/src/hart/mod.rs
9e2d235163d528112ab0375886e2bdf4e602c0dbdceaf7e486abad0b6d78b053  crates/core/src/lib.rs
676941521e8882e17b242384ce7d2a737918750b46ec6b302f120d5cfaa92034  crates/wasm/src/lib.rs
```

## Canonical semantics — HELD

I inspected `record-semantics.mjs`, both invocation ledgers, complete producer source, raw native
outputs, result, copied old-source golden, and actual-WASM log. I did not rerun the producer.

- Recorder SHA-256 is
  `a7d4914f582ac3a365991c88a089a9bc8e8417e317b0369cb4c684ac77574a52`.
  Before executing old source it hashes Cargo/config/toolchain/core/runtime inputs and verifies each
  against `git show d7d308a58825e6856db532822e36e1681230027a`; it re-hashes every input after each run
  (`record-semantics.mjs:16-18,25-35,46-53`).
- Old and candidate use identical producer
  `62ce60205676c1ed59b2e11395c36337278cdd65d6fd9d4f56be4a4e13e7c5c9`, Rust 1.96.0,
  LLVM 22.1.2, Cargo 1.96.0, lock/config/profile/features, but distinct old/candidate runtime hashes
  (`semantics-r1/result.json:3-73`). Both raw outputs contain 266 `CASE` rows, are 202,466 bytes,
  and independently hash to
  `5587b4d8fc786ea48a87a2c004466fe7fb2b9a7630c408548fcb264414446cc2`.
  `cmp` also confirms both outputs and `baseline-semantic.stdout` are byte-identical.
- Actual WASM compiles the same producer through wrapper
  `3b051dcbd5dd4e15877ec465e8af7a6b9bae26dfd5ab0837f9314e71a9cc8d18` and compares its full
  captured stdout with that old-native golden. Log SHA-256
  `dbeefd2e7f15c5e4a8b85b6eb8ea952c432fc6d3226f0f25ed737b9fe362f995` ends `1 passed; 0 failed`.

Coverage inspection confirms direct Hart and ordinary/cached Machine unit/recording matrices;
all scalar/FSW/FSD widths with both reservation relationships; live overlapping PMP faults at all
six widths; LR/SC alignment, mismatch, success, and pre-fault consumption; AMO.W sign extension
and AMO.W/D overlap/nonoverlap; counters/x0/control flow; raw compressed `tval`; ordered scalar,
FP, LR/SC and AMO MMIO plus read/write faults; and host-DMA/guest-SMC cross-page cache behavior.
Full Hart snapshots include integer/FP/CSR/counter/reservation state; RAM, trace, UART and MMIO
transcripts are recorded separately.

No frozen-producer expansion is demanded. Explicit WFI/xRET/FenceI regression execution is still
owed by Main's later scoped task gate; those unchanged instruction arms are not a blocker to this
baseline semantic admission and are not marked HELD here.

## Fresh x0/MMIO false-sink attack — HELD

Prediction and final formatted pins are in `novel-attack-r2-pins.md`. The attack uses actual
`Hart::step`/`step_traced` and ordinary/cached `Machine::run`/`run_traced`. Its twelve cases assert
one width-4 ordered MMIO read, x0 and base-register preservation, PC/retirement behavior, exact
successful `TraceRecord { rd: None, mem: load }`, and no callback or retirement on access fault
for a custom sink whose `wants_records()` is false.

- Native: `novel-attack-r2-native.log`, SHA-256
  `dc4e8ad1f02695c3a48014192f2cd10b3330839baa8257caf263c070b4b2b6b2`, 2 passed/0 failed.
- Actual WASM: `novel-attack-r2-wasm.log`, SHA-256
  `b521328b8b8c311e67002658efeaa558c6035771e9b343ddeb4db9025483dfa6`, 2 passed/0 failed.
- Final test hashes are core wrapper
  `46badec8faabdc9bacb30a2f35545015e7b50c52611de54e7af53d2a6f1af748`, shared support
  `b23c2e5e0034cb0f852bbf96f8ecf51b28c098a22aeba7b5993dae0207127a48`, and WASM wrapper
  `d7645b3c4805532dd63319a5904a682b85b4b0457fb9de2aee0d5e965996b57a` before and after both
  runs. The r1 native log predates final rustfmt and is retained but superseded.

The WASM command emitted an unrelated existing `hart_ctrl.rs` unused-import warning; the named
verifier target passed and the warning is outside this task's finding boundary.

## Isolated reservation sabotage — HELD

Scratch `/private/tmp/e5-t26p-verifier-sabotage.TO5uZI` was produced with `git archive` at the
frozen baseline, not a clone, then overlaid with the exact three candidate runtime files and final
producer. The sole mutation suppressed `self.resv = None` in the shared successful-store overlap
tail. Mutant Hart SHA-256 was
`8e15f642b054c021e99e1c6579624071ee4053ce7fd7328ffff7928d99078a1d`; SC.W/SC.D arm-local
reservation clears before fallible stores remained at scratch lines 1550/1570.

The canonical producer exited 101 at producer line 594 on its first overlap case:
`scalar-sb-overlap: reservation`, observed `Some((2147491840, 4))`, expected `None`.
Mutant stdout also differs from the old-source golden (`cmp` exit 1). Raw stdout SHA-256 is
`502f50ea7355b84dba082484e09cd2c16da7fc8a3a08ef4d237388a0ed29ee3c`; stderr SHA-256 is
`207e303872eb26548cf444e32b389694f8022f857c45775dc00843faf7dd37db`.

The scratch Hart was restored to
`ab15c6a854441fc99f28a3c2e34d60fea3c5d2450d2db3577f1b185a7be7cd39`; scratch core lib,
WASM lib and producer, and all workspace runtime files also match their pre-mutation hashes.
