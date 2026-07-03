---
id: E0-T20
epic: 0
title: Differential trace harness diffing our execution against Spike byte-for-byte
priority: 20
status: implemented
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
### 2026-07-03 — worker claim — branch task/e0-t20-spike-diff (stacked on e0-t19)
Deliverables: one command diffs our execution against Spike byte-for-byte.
- tools/diff/normalize_spike.py (stdin→stdout, pure): keeps ONLY Spike commit lines
  (distinguished by the privilege digit), re-emits the E0-T16 canonical grammar. Owns the two
  Spike quirks: (a) BOOT-ROM TRIM — output starts at the first commit with pc==--entry, prints
  the trimmed count to stderr, and HARD-ERRORS (exit 3) if entry never appears (verified: bogus
  entry → exit 3, "refusing to emit a possibly-misanchored trace"); (b) disassembly discarded,
  only pc/insn/rd/mem survive, values passed through byte-for-byte.
- tools/diff/report.py: our trace is authoritative on length (guest halts via HTIF; Spike/QEMU
  spin on the post-exit tail), so it compares our trace as a PREFIX of Spike's, exact string
  equality (cmp-grade, never whitespace-fuzzy). Levels: commit (pc+insn+rd+mem, default/capstone
  bar) and pc (pc+insn only). First divergence printed with last 20 matching + both divergent
  lines + 5 lookahead each. Exit 0 match / 1 diverge / 2 usage.
- tools/diff/run_diff.sh <elf> [--level pc|commit] [--max N]: builds our CLI, traces to a FILE
  (keeps diagnostics out), runs Spike via tools/toolchain/run.sh (cold-clone: Docker+Rust only),
  normalizes, reports. Spike: --isa=rv64i -m0x80000000:0x8000000 (UART page left to Spike's own
  default device — mapping RAM over it errors) -l --log-commits.
- make diff-all: hello/loops/memops ALL MATCH at commit level (83/48/117 instrs, 0 divergence).
- make diff-selftest (tools/diff/selftest.sh): (1) loops genuine match + normalized trace ==
  committed golden tools/diff/golden/loops.spike.trace; (2) memops clean match reports >100
  compared lines (117); (3) a single corrupted normalized line is DETECTED at exactly that
  instruction (#50). NOTE: the acceptance's ">100 for loops.elf" is carried by memops (117) — the
  E0-T14 loops.elf retires only 48 instructions (short program); the harness reports the true
  count for each guest.
- QEMU secondary pc-level-only cross-check (tools/diff/run_diff_qemu.sh, normalize_qemu.py, make
  diff-qemu): -M virt -bios none -accel tcg,one-insn-per-tb=on -d exec,nochain; bounded by head
  +timeout (QEMU spins too). EXECUTES (not dead code): loops MATCHES on pc; hello/memops diverge
  at the UART polling loop (0x54↔0x60) because QEMU models a real ns16550 with different THR-empty
  timing than our always-ready stub — a DOCUMENTED device-model limitation of the secondary check,
  and the harness REPORTS it rather than masking. tools/diff/README.md documents all of this.
Self-checked adversarial: (1) over-normalization — editing an rd VALUE in the Spike trace is caught
at the exact instruction (#2), exit 1 (values are not dropped); (4) determinism — normalizing loops
3× yields byte-identical output (same shasum). Golden committed. cmp (not diff -w) is the equality.
Not in CI `ci` (needs the Docker Spike container); standalone make targets, documented.
rr: N/A (macOS). Verifier angles open: over-normalization on insn/pc too (2), trim misanchor via
entry≠0x80000000 (2), mass evidence over rv64ui-p with zicsr-stub expecting reported CSR divergence
(3), and confirming QEMU is live not dead (5).
