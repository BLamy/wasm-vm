---
id: E0-T20
epic: 0
title: Differential trace harness diffing our execution against Spike byte-for-byte
priority: 20
status: pending
depends_on: [E0-T18, E0-T14]
estimate: L
capstone: false
---

## Goal
One command runs an ELF under both `wasm-vm-cli` and Spike, normalizes both instruction
logs into the E0-T16 canonical grammar, and byte-compares them — reporting the first
divergent instruction with surrounding context. This is the project's ground-truth
correctness instrument and the capstone's measuring device.

## Context
Spike invocation: `spike --isa=rv64i -m0x10000000:0x1000,0x80000000:0x8000000 -l
--log-commits <elf>` — the `-m` layout maps the UART0 page as plain RAM so console stores
retire identically (E0-T12 note); `--log-commits` adds register-writeback lines. Two
Spike-side quirks the normalizer must own, explicitly: (a) Spike executes a short reset
sequence in its boot ROM at `0x1000` before jumping to the ELF entry — normalized output
starts at the first record with `pc == e_entry`, and the trim rule plus trimmed-line count
are printed so it cannot silently hide early divergence; (b) Spike's disassembly text is
discarded — only pc, raw instruction bits, and rd writebacks survive normalization.
Comparison levels: `pc` (pc+insn only) and `commit` (pc+insn+rd writes); `commit` is the
default and the capstone bar. QEMU (`qemu-system-riscv64 -M virt -bios none -kernel <elf>
-d exec,nochain -one-insn-per-tb`) is wired as a secondary, pc-level-only cross-check.

## Deliverables
- `tools/diff/normalize_spike.py` (stdin→stdout, pure function of the log text),
  `tools/diff/run_diff.sh <elf> [--level pc|commit] [--max N]` orchestrating CLI + Spike
  (via `tools/toolchain/run.sh` when Spike isn't native), `tools/diff/report.py` printing
  the divergence: last 20 matching lines, then both divergent lines, then 5 lookahead
  lines from each side.
- `make diff-all` running the harness over all `guest/prebuilt/*.elf` at commit level.
- Self-test `make diff-selftest`: corrupts one normalized line (sed) and asserts the
  harness reports divergence at exactly that line; also runs a genuine full match.
- Golden normalized Spike trace for `loops.elf` committed for regression pinning.

## Acceptance criteria
- [ ] `run_diff.sh` on `hello.elf`, `loops.elf`, `memops.elf` reports zero divergence at
      `commit` level, with `cmp` (not `diff -w`) as the final equality check.
- [ ] `diff-selftest` passes: injected corruption is detected at the exact line; clean
      runs report the total compared-line count (must be > 100 for loops.elf).
- [ ] The trim rule prints how many Spike bootrom lines were skipped, and refuses to run
      (hard error) if `pc == e_entry` never appears in Spike's log.
- [ ] Harness exits nonzero on divergence, zero on match (scriptable for CI and E0-T25).
- [ ] Works from a cold clone with only Docker + Rust (Spike used via the T13 container).

## Adversarial verification
(1) Over-normalization attack: take a matching pair, hand-edit one rd *value* in the Spike
log, re-run the comparator — if it still passes, the normalizer is dropping writeback data
and the harness is refuted. Repeat by editing an insn word and a pc. (2) Trim-rule attack:
craft an ELF whose entry instruction sequence begins identically to Spike's bootrom tail
(or set entry ≠ 0x80000000 via the linker script) and check the trim can't misanchor.
(3) Mass evidence: run `run_diff.sh` over every rv64ui-p binary from E0-T19 (with
`zicsr-stub`; expect documented divergence around CSR semantics — verify the harness
*reports* rather than masks it). (4) Determinism: run the harness 3 times on `loops.elf`;
any run-to-run diff in normalized output refutes. (5) Confirm the QEMU path actually
executes (not a dead code path) and documents its pc-level-only limitation.

## Verification log
(empty)
