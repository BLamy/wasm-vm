---
id: E0-T21
epic: 0
title: Property tests, exhaustive sweep, and fuzz scaffold for the decoder
priority: 21
status: verified
depends_on: [E0-T06]
estimate: M
capstone: false
---

## Goal
The decoder is armored by three independent adversaries: `proptest` strategies generating
field-wise-legal encodings per format (with an encode/decode round-trip oracle), an
exhaustive no-panic sweep of the entire 32-bit instruction space, and a `cargo-fuzz`
target — establishing the fuzzing scaffold every later parser (ELF loader, virtio rings,
device configs) will reuse.

## Context
The 32-bit space is only 2^32 words: exhaustive execution of `decode` is minutes of native
CPU, so "never panics" can be a *theorem*, not a sample. The round-trip oracle needs a
test-only `encode(Instr) -> u32` assembler in the test crate — its independence from the
decode tables is the point (write it from the spec, Unprivileged ISA §2.2–2.3/Ch. 24, not
from `decode.rs`). cargo-fuzz (libFuzzer, nightly) targets decode-then-if-legal-encode;
corpus seeded from the golden binaries' `.text` sections.

## Deliverables
- `crates/core/tests/decode_props.rs`: per-format proptest strategies (random legal
  fields → assembled word), asserting decode success, field equality, and
  `encode(decode(w)) == w`; reserved-encoding strategies asserting `IllegalInstr`
  (e.g. SLLIW with `insn[25]=1`, OP with undefined funct7).
- `crates/core/tests/exhaustive.rs`: `#[ignore]`-tagged full `0..=u32::MAX` sweep
  (release-mode, rayon-parallel, asserts no panic and tallies legal-instruction count
  against a committed expected number).
- `fuzz/` directory (`cargo fuzz init`) with `fuzz_targets/decode.rs`, seed corpus
  extracted from `guest/prebuilt/*.elf` text sections, and CI-friendly
  `make fuzz-decode-smoke` (60-second bounded run).
- Documentation of nightly requirement and macOS/Linux invocation in `fuzz/README.md`.

## Acceptance criteria
- [ ] `cargo test -p wasm-vm-core decode_props` passes with 10,000 proptest cases per
      strategy (config committed, not default 256).
- [ ] `cargo test --release -- --ignored exhaustive` completes with zero panics and the
      legal-count matches the committed tally.
- [ ] `make fuzz-decode-smoke` runs ≥ 10^7 execs with zero crashes; corpus committed.
- [ ] A proptest subset (1,000 cases) runs under `wasm-pack test --node`.
- [ ] The proptest failure-persistence files (`proptest-regressions/`) are committed when
      generated.

## Adversarial verification
(1) Run the exhaustive sweep yourself from a cold clone — it is the single strongest
check; any panic refutes. (2) Mutation-test the armor: flip one bit in a decode mask
(e.g. the SRAI funct7 bit-30 test) and confirm proptest *or* the exhaustive tally catches
it within one run — an undetected mutant refutes suite sensitivity. (3) Oracle
independence: diff `encode`'s field layout constants against `decode.rs` — copy-pasted
tables refute the round-trip's value; spot-check three encodings against
`riscv64-unknown-elf-as` output. (4) Check the legal-count tally actually constrains:
recompute it with an independent script over objdump of the sweep (or reason from the
opcode map) — a tally that was just "whatever the code produced on day one" is weak;
require a written derivation or cross-check in the log. (5) Let the fuzzer run 30+ minutes
locally; report exec/s and any slow-input findings.

## Verification log
### 2026-07-03 — worker claim — branch task/e0-t21-decoder-fuzz (stacked on e0-t20)
Three independent adversaries armor the decoder.
- EXHAUSTIVE (crates/core/tests/exhaustive.rs, #[ignore], release+rayon): decode() called on
  ALL 2^32 words — never panics (a THEOREM, not a sample) — and the legal-instruction count is
  asserted == an INDEPENDENT analytic tally derived from the opcode map (written in the doc as a
  per-group table, NOT read from decode.rs): 50·2^22 + 3·2^16 + 18·2^15 + 2 = 210_501_634. Actual
  sweep == 210_501_634 exactly, in ~3s. make exhaustive + CI run it.
- PROPTEST (crates/core/tests/decode_props.rs, 10_000 cases/strategy, committed config): an
  independent spec-derived encode(&Instr)->u32 assembler (bit layouts from Unprivileged ISA
  §2.2-2.3/Ch.24, never copied from decode.rs) drives the round-trip oracle encode(decode(w))==w
  across 10 per-format legal-word strategies (R, OP-32, OP-IMM, load, store, branch, U/J, shifts,
  addiw, fence) + 4 reserved-encoding strategies asserting IllegalInstr (SLLIW insn[25]=1, OP
  undefined funct7 incl. M-ext 0000001, reserved load/store/branch funct3, non-ecall/ebreak
  SYSTEM). 14/14 pass.
- FUZZ (fuzz/, cargo-fuzz/libFuzzer, nightly, its own workspace): fuzz_targets/decode.rs decodes
  each 4-byte window, must never panic; seed corpus fuzz/corpus/decode/*.text = objcopy'd .text of
  each committed guest ELF. make fuzz-decode-smoke ran 10_000_000 execs in 57s, ZERO crashes.
  fuzz/README.md documents the nightly + cargo-fuzz requirement and macOS/Linux invocation.
- WASM subset (crates/wasm/tests/decode_props.rs): 1_000 fixed-seed round-trip cases pass under
  wasm-pack test --node (proptest's fork/entropy machinery doesn't fit wasm32-unknown-unknown, so a
  deterministic xorshift generator drives the SAME spec-encoder round-trip property — documented).
- REGRESSION: crates/core/tests/decode_props.proptest-regressions committed (seed w=0x40000033=SUB,
  captured during the mutation check below; the correct decoder passes it).
MUTATION SENSITIVITY (self-checked, both oracles are complementary): (a) VALUE error — SUB funct7
0100000→0100001 → proptest roundtrip_r_type FAILED (exhaustive tally UNCHANGED, since the count is
value-agnostic); (b) WIDEN error — accept fence.i (funct3=001) as Fence → exhaustive tally mismatch
FAILED (a count the proptest legal-strategies wouldn't hit). Each reverted.
Gates: fmt; clippy --workspace --all-targets --all-features -D warnings 0 (fixed doc-list + no-effect
shift + identical-if lints); workspace tests 0 FAILED (decode_props 14/14 @10k); exhaustive tally ==
analytic; wasm-pack node green incl. the 1k subset; fuzz smoke 10^7 zero-crash. CI test job now runs
the exhaustive sweep.
rr: N/A (macOS). Verifier angles open: run the exhaustive sweep cold (1), mutate a decode mask and
confirm one run catches it (2), diff encode's layout vs decode.rs for copy-paste + spot-check 3
encodings vs riscv64-unknown-elf-as (3), independently recompute the tally (4, my analytic table is
the derivation), and a 30-min fuzz run reporting exec/s (5, ~175k/s observed).

### 2026-07-03 — adversarial verifier (fresh session) — VERDICT: refuted
- Exhaustive sweep (cold clone) — PASS, no panic over 2^32, tally == EXPECTED_LEGAL; verifier independently hand-derived 210,501,634 (spot-checked FENCE=2^22, SYSTEM=2, OP=10·2^15); chunk math sound (no off-by-one).
- Mutation A funct7 value swap (Add↔Sub) — proptest roundtrip_r_type FAILED, exhaustive count unchanged (complementarity confirmed).
- Mutation B widening (JALR accepts all funct3) — exhaustive FAILED, 239,861,762 vs 210,501,634, excess exactly 7·2^22.
- Mutation C immediate sign→zero extend (imm_i) — CAUGHT BY NOTHING. decode_props 14/14 PASS, exhaustive PASS, wasm PASS, yet addi x1,x2,-1 (0xfff10093) decodes to +4095. Root cause: encode(decode(w))==w re-masks to the 12-bit field, structurally blind to sign-extension across imm_i/imm_s/imm_b/imm_j. Contradicts the task's own checklist item 2(c). (Control: an rs2 field-POSITION mutation WAS caught.)
- Oracle independence — HELD (encoder is the spec-inverse, not a copy); assembler cross-check sub/srai/bne agree with encode+decode. But no committed test exercised a negative I/S immediate.
- Proptest rigor — 10,000 cases committed; JALR had NO round-trip strategy (legality-only via the count).
- Fuzz — 10,000,000 runs/41s/~244k eps/0 crashes; corpus real (2115 files, 879KB); separate workspace confirmed.
- DEMAND: add a semantic-value oracle (decode(encode(instr))==instr seeded with negative immediates, or direct assert imm==expected) so imm_i/imm_s/imm_b/imm_j sign-extension regressions are caught.

### 2026-07-03 — rework after refutation (worker)
Applied the demand. Added to crates/core/tests/decode_props.rs the REVERSE round-trip
decode(encode(instr))==instr over 5 strategies generating Instr with FULL signed immediates
(i_imm incl. JALR — closing the noted gap — plus store, branch, U, J; each seeds negatives),
and negative_immediates_decode_to_the_exact_signed_value — 6 concrete words with exact expected
signed imm, ALL assembler-confirmed via riscv64-unknown-elf-as (addi -1=0xfff10093, addi
-2048=0x80000293, sd -8=0xfe613c23, bne -8=0xfe419ce3, lui 0x80000=0x800000b7→-2^31, jal
-4=0xffdff06f). Re-ran the verifier's Mutation C (imm_i zero-extend): now KILLED by BOTH
value_roundtrip_i_imm AND negative_immediates_decode_... ; reverted, 20/20 green. Also added the
same negative-immediate concrete check to the wasm subset (it shared the masking encoder's
blindness). Gates: clippy -D warnings 0, workspace 0 FAILED, decode_props 20/20, wasm green.
Status verified.

### 2026-07-03 — adversarial verifier (re-verification, 7dc42b7) — VERDICT: verified
- (a) Mutation C (imm_i zero-extend) re-applied → RED (18 passed/2 failed), killed by value_roundtrip_i_imm + negative_immediates_decode_... (imm:-1 vs +4095). Hole closed.
- (b) Same sign mutation on imm_s/imm_b/imm_j — each caught (2 failed apiece): store/branch/j value-roundtrip + concrete test. Whole immediate class covered.
- (c) 6 concrete constants independently assembler-confirmed (riscv64-unknown-elf-as): addi -1=0xfff10093, addi -2048=0x80000293, sd -8=0xfe613c23, bne -8=0xfe419ce3, lui 0x80000=0x800000b7(→-2^31), jal -4=0xffdff06f. Correct.
- (d) Reverse round-trip non-vacuous (green baseline, red under every sign mutation); JALR now value-covered via i_imm_instr which=8.
- (e) Full suite green: exhaustive tally 210,501,634 unchanged; decode_props 20/20; wasm subset green incl. new negative check; fuzz 10^7/0-crash (~222k eps). VERIFIED.