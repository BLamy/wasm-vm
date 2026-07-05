# Differential trace harness (E0-T20)

Runs an ELF under **wasm-vm-cli** and **Spike**, normalizes both instruction logs into the
E0-T16 canonical grammar, and byte-compares them — the project's ground-truth correctness
instrument and the capstone's measuring device.

```
tools/diff/run_diff.sh <elf> [--level pc|commit] [--max N]
```

Exit 0 on match, nonzero on divergence (scriptable for CI and E0-T25). Our CLI runs
natively; Spike runs in the E0-T13 container via `tools/toolchain/run.sh`, so this works
from a cold clone with only **Docker + Rust**.

- **`normalize_spike.py`** — stdin→stdout, pure function of the Spike `-l --log-commits`
  text. Keeps only commit lines, re-emits canonical grammar, trims Spike's boot-ROM up to
  the ELF entry (prints the trimmed count; hard-errors if the entry pc never appears).
- **`report.py`** — compares our trace (authoritative on length — the guest halts via
  HTIF) as a prefix of Spike's, reporting the first divergence with 20 lines of context
  and 5 lines of lookahead from each side. Levels: `commit` (pc+insn+rd+mem, the default
  and capstone bar) and `pc` (pc+insn only).
- **`run_diff.sh`** — orchestrates CLI + Spike + normalize + report.
- **`selftest.sh`** (`make diff-selftest`) — proves the harness *detects* divergence
  (injects one corrupted line, asserts it's caught at the exact instruction) and pins the
  normalizer against `golden/loops.spike.trace`.
- **`golden/loops.spike.trace`** — committed normalized Spike trace for `loops.elf`.

## Spike invocation & the two quirks the normalizer owns

`spike --isa=rv64i -m0x80000000:0x8000000 -l --log-commits <elf>`

The UART page (`0x10000000`) is **not** in `-m`: Spike has its own default device there, and
mapping RAM over it errors ("devices … overlap"). Console stores still retire identically
(we compare instruction retirement, not device side effects).

1. **Boot-ROM trim** — Spike runs a reset sequence at `0x1000` before jumping to
   `e_entry`. Normalized output starts at the first commit with `pc == e_entry`; the
   trimmed count is printed and a missing entry is a hard error (never a silent
   misanchor).
2. **Disassembly discarded** — only pc, raw insn bits, and rd/mem writebacks survive.
   Values pass through byte-for-byte, so a corrupted writeback still diverges.

Neither Spike nor QEMU halts on our HTIF `tohost` write; both spin on the guest's
post-exit tail. Our trace ends at the HTIF exit, so comparing our trace as a **prefix** of
Spike's covers every instruction we retire.

**A prefix match is only a MATCH if our trace ended legitimately.** Our trace can also end
because the emulator *trapped* (e.g. an rv64ui-p binary hits `csrr mhartid` and the
stubless CLI raises IllegalInstruction). `run_diff.sh` captures the CLI exit code (never
masks it) and passes `--ours-trapped` on exit 101; `report.py` then reports a **divergence**
("our emulator TRAPPED where Spike continued") instead of accepting the crash-truncated
prefix as a MATCH. So the harness exits nonzero whenever our execution diverges — including
by crashing — not only on a mismatched line.

## QEMU secondary check (pc-level only)

```
tools/diff/run_diff_qemu.sh <elf>   # make diff-qemu
```

`qemu-system-riscv64 -M virt -bios none -kernel <elf> -accel tcg,one-insn-per-tb=on
-d exec,nochain` gives only the PC per executed block — **no** insn word or writeback — so
this is strictly coarser than the Spike differential and exists to catch control-flow
divergence from a second implementation. It matches for compute-only guests (`loops`);
console guests (`hello`, `memops`) diverge at the UART polling loop because QEMU models a
real ns16550 with different THR-empty timing than our always-ready stub. That is a
**documented device-model limitation of the secondary check**, not a CPU bug — the Spike
differential (which maps the UART page as plain RAM) matches all three at commit level.
