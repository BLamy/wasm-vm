# Golden bare-metal guest binaries (E0-T14)

Small, pure-RV64I programs built by the pinned [T13 toolchain](../tools/toolchain/) with
a shared `crt0.S` and `link.ld`, with the resulting ELFs **byte-committed** under
`prebuilt/` so the emulator test suite (`crates/core/tests/golden_run.rs`) never needs a
cross compiler. The same ELFs feed the Spike differential harness (E0-T20), the CLI
(E0-T18), the benchmarks (E0-T24), and the capstone (E0-T26).

## The programs (each < 16 lines)

| Program | Exercises | Expected exit |
|---|---|---|
| `hello.c`  | rodata + the UART0-stub console store path; prints `Hello from RV64\n` | 0 |
| `loops.S`  | pure-RV64I counted-loop arithmetic (sums 1..10); no memory, no libgcc — Spike retires **56 instructions total** (deterministic; metric for E0-T24, see caveat below) | 0 |
| `memops.c` | every load/store width and sign mode (sb/sh/sw/sd, lb/lbu/lh/lw/ld) via typed volatile pointers; prints `memops done\n` | 0 |

All exit via `crt0`'s HTIF convention: `tohost = (main's return << 1) | 1`.

## Constraints (why the binaries stay diffable against Spike)

- `-march=rv64i -mabi=lp64 -mcmodel=medany` — pure RV64I; `medany` gives PC-relative
  addressing so code works at `DRAM_BASE = 0x80000000` (the default `medlow` model
  cannot reach it with `lui`).
- `-nostdlib -nostartfiles -ffreestanding -fno-builtin` and no `*`/`/`/`%` in C, so gcc
  emits no libgcc calls (`__muldi3` etc.). No CSR, no compressed, no atomics.
- `.tohost` section with 8-byte-aligned `tohost`/`fromhost` symbols Spike locates by name.

## Building & reproducibility

```sh
tools/toolchain/run.sh -- make -C guest              # build all three ELFs
tools/toolchain/run.sh -- guest/check-reproducible.sh # rebuild + cmp vs prebuilt/
```

Builds are **byte-identical**: `SOURCE_DATE_EPOCH=0`, `-ffile-prefix-map` strips the
build path, `-frandom-seed` fixes symbol mangling, and — the subtle one — each source is
compiled to a **fixed-name `.o` before linking**, because compiling+linking in one step
makes gcc leak a random temp-object name (`ccXXXXXX.o`) into `.strtab`.
`check-reproducible.sh` exits nonzero on any divergence, so a stale committed ELF fails
loudly.

## Running under Spike

Spike's built-in ns16550 UART sits at `0x10000000` and both retires the console stores
*and prints* them, so no explicit device mapping is needed:

```sh
tools/toolchain/run.sh -- spike --isa=rv64i -m0x80000000:0x8000000 guest/prebuilt/hello.elf
```

> The task sketch's `-m0x10000000:0x1000,...` predates this Spike's built-in UART and now
> *overlaps* it (Spike errors "devices … overlap"); the single-region form above is correct
> for the pinned Spike and prints the output.

> **E0-T24 caveat (verifier finding):** Spike's `-l` count of **56** is a *whole-run* count
> that includes ~6 instructions of Spike's reset boot-ROM (entry at `0x1000`,
> `csrr a0, mhartid`, …) before the jump to `0x80000000`. Our emulator enters directly at
> `e_entry = 0x80000000` with no boot ROM, so its guest-only retired count is ~6 lower.
> The benchmark harness must compare *guest-region* counts, not raw `56`.
