---
id: E0-T18
epic: 0
title: Native CLI runner — load an ELF, execute N instructions, dump trace and state
priority: 18
status: pending
depends_on: [E0-T10, E0-T11, E0-T12, E0-T16, E0-T17]
estimate: M
capstone: false
---

## Goal
`wasm-vm-cli run <elf>` assembles a complete machine (RAM + UART0 stub on stdout + HTIF),
loads a bare-metal ELF, executes until HTIF exit / trap / `--max-instrs`, and can emit the
canonical trace and state dump — the native workhorse used by the differential harness,
the riscv-tests runner, benchmarks, and every human debugging session from here on.

## Context
This is the first end-to-end integration of T03–T17 and the tool the adversarial verifier
lives in. Interface stability matters: E0-T19/T20/T24/T25 scripts call it. Exit-status
contract: guest exit code 0 ⇒ process exit 0; nonzero guest code ⇒ that code (mod 256,
documented); trap ⇒ exit 101 with the trap printed to stderr; `--max-instrs` reached ⇒
exit 102. Guest console bytes go to stdout *unmodified*; all diagnostics go to stderr so
stdout is byte-clean for `cmp`-based tests.

## Deliverables
- `crates/cli/src/main.rs` with clap derive: `run` subcommand, flags `--max-instrs <n>`
  (default 100M), `--ram-mib <n>` (default 128), `--trace <path>` (canonical format;
  `-` = stderr), `--trace-json <path>` (JSON lines), `--dump-regs`, `--dump-state`.
- Retired-instruction count reported on stderr at exit (`retired=<n>`), used by E0-T24/T26.
- Integration tests (`assert_cmd` + `predicates`) running `guest/prebuilt/*.elf`.

## Acceptance criteria
- [ ] `cargo run -p wasm-vm-cli -- run guest/prebuilt/hello.elf` prints exactly
      `Hello from RV64\n` on stdout (verified with `cmp` against a fixture) and exits 0,
      on a cold clone with only Rust installed (prebuilt ELFs, no cross toolchain).
- [ ] Exit-status contract holds for: exit-42 guest (42), EBREAK guest (101 + cause on
      stderr), `--max-instrs 10` on an infinite loop (102, `retired=10`).
- [ ] `--trace` output on `loops.elf` is byte-identical to the E0-T16 golden trace prefix.
- [ ] Bad inputs produce distinct nonzero exits and stderr messages: missing file,
      non-ELF file, rv32 ELF, ELF larger than `--ram-mib`.
- [ ] `--dump-state` final line matches the E0-T17 `state sha256=` format.

## Adversarial verification
(1) Stdout purity attack: run a guest that prints all 256 byte values; `xxd` the captured
stdout — any extra byte (logging leakage, BOM, flush duplication) refutes. (2) Contract
attack: guest exit code 256 — document/verify the mod-256 behavior explicitly; a hang or
wrong code refutes. (3) `--max-instrs 0` must execute zero instructions and still produce
a valid state dump. (4) Trace-to-unwritable-path (`/proc/nonexistent/x` or a read-only
dir) must fail cleanly with exit ≠ 0, not panic. (5) Pipe stdout through `head -c 1` to
force SIGPIPE mid-output — a panic backtrace refutes (broken-pipe must be handled).
(6) Run under `time` with `--max-instrs 50_000_000` — a hang or unbounded memory growth
(trace accidentally buffered when no `--trace` given) refutes.

## Verification log
(empty)
