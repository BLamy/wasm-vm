---
id: E0-T14
epic: 0
title: Golden bare-metal guest binaries with crt0, linker script, and reproducible builds
priority: 14
status: pending
depends_on: [E0-T13, E0-T11, E0-T12]
estimate: M
capstone: false
---

## Goal
A `guest/` directory containing small bare-metal rv64i programs — `hello` (prints
"Hello from RV64" via the UART0 stub, exits via `tohost`), `loops` (deterministic
arithmetic, fixed retired-instruction count), `memops` (all load/store widths and sign
modes) — built by a pinned toolchain with a shared `crt0.S` and linker script, with the
resulting ELFs byte-committed so the emulator test suite never needs a cross compiler.

## Context
These are the shared fixtures for the CLI (E0-T18), the Spike differential harness
(E0-T20), the benchmarks (E0-T24), and the capstone (E0-T26). Constraints: pure RV64I
(`-march=rv64i -mabi=lp64`), no libgcc (avoid `*`/`/`/`%` in C so gcc emits no
`__muldi3` calls), no CSR instructions, `.tohost` section with 8-byte-aligned
`tohost`/`fromhost` symbols (Spike locates them by symbol), entry at
`DRAM_BASE = 0x8000_0000`, stack placed at the top of a declared RAM region. Because the
Docker toolchain is pinned, rebuilds must be byte-identical to the committed ELFs — this
is what makes "the binary in the repo is the binary we tested" auditable.

## Deliverables
- `guest/crt0.S`: set `sp`, zero `.bss`, call `main`, write `(a0 << 1) | 1` to `tohost`,
  park in a `j .` loop.
- `guest/link.ld`: `ENTRY(_start)`, `. = 0x80000000`, `.text/.rodata/.data/.bss`,
  `.tohost` with `PROVIDE(tohost)`/`PROVIDE(fromhost)`, symbol `__stack_top`.
- `guest/console.h`: `putc`/`puts` via volatile byte store to `0x1000_0000`.
- `guest/hello.c`, `guest/loops.S`, `guest/memops.c`; `guest/Makefile` with
  `-march=rv64i -mabi=lp64 -nostdlib -nostartfiles -ffreestanding -O2 -T link.ld`.
- `guest/prebuilt/*.elf` committed, plus `guest/check-reproducible.sh` (rebuild in the
  T13 container, `cmp` against prebuilt).

## Acceptance criteria
- [ ] `tools/toolchain/run.sh -- make -C guest` builds all three ELFs; running it twice
      and `cmp`-ing outputs shows byte-identical rebuilds matching `guest/prebuilt/`.
- [ ] `objdump -d` of every ELF contains no instructions outside RV64I (scripted scan
      rejecting `mul|div|rem|csr|amo|lr\.|sc\.|fence\.i|c\.` mnemonics).
- [ ] `readelf -h` shows `EM_RISCV`, `ET_EXEC`, entry `0x80000000`; `tohost` symbol
      present, 8-byte aligned.
- [ ] `spike --isa=rv64i -m0x10000000:0x1000,0x80000000:0x8000000 guest/prebuilt/hello.elf`
      exits 0 (UART page mapped as RAM so stores retire; see E0-T12/E0-T20).
- [ ] All under-16-line programs documented: what each exercises and its expected exit code.

## Adversarial verification
(1) Reproducibility attack: rebuild in a `--no-cache` container on a different host OS and
`cmp` every ELF — any diff refutes (look for embedded timestamps/paths; `-frandom-seed`
and `SOURCE_DATE_EPOCH` may be needed). (2) ISA-purity attack: run the objdump scan
yourself *and* additionally grep for `ecall|ebreak` to confirm they appear only where the
task says. (3) Stack attack: verify `__stack_top` doesn't overlap `.bss` for the largest
binary (`readelf -S` arithmetic). (4) Run `loops.elf` under Spike with `-l` and count
retired instructions; record the count — it becomes the golden count for E0-T24; a
nondeterministic count refutes. (5) Strip one ELF and confirm `check-reproducible.sh`
fails loudly (script sensitivity check).

## Verification log
(empty)
