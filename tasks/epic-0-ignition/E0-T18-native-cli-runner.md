---
id: E0-T18
epic: 0
title: Native CLI runner — load an ELF, execute N instructions, dump trace and state
priority: 18
status: implemented
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
### 2026-07-03 — worker claim — branch task/e0-t18-cli-runner (stacked on e0-t17)
Deliverables: crates/cli/src/main.rs — clap-derive `run <elf>` subcommand with --max-instrs
(default 100M), --ram-mib (default 128), --trace <path|-> (canonical), --trace-json <path|->
(JSON lines), --dump-regs, --dump-state. Assembles Machine + Uart0Stub on stdout + HTIF (via
load_elf's tohost symbol), executes with a counting CliSink that also drives the trace writer(s),
prints retired=<n> to stderr at exit. Core: added Machine::run_traced<T:TraceSink>(max, sink) —
the ONE run-loop / HTIF state machine — and made run() delegate to it with trace::NullSink, so a
traced and untraced run can never diverge in termination and the zero-cost NullSink path is
preserved (check-zero-cost --selftest still green).
CONTRACTS: stdout byte-clean (guest console bytes only; all diagnostics + retired= + trap/max
messages to stderr). Exit status: Exited(c)→(c&0xff) [documented mod-256: guest exit 256→process 0];
Trapped→101 with cause on stderr; MaxInstrs→102. Bad inputs get DISTINCT codes: unreadable file 2,
BadMagic 65, Wrong{Class,Endian,Machine,Type} 66, Truncated 67, SegmentOutOfRam 68, trace-open/IO
74. Broken pipe (SIGPIPE→BrokenPipe since Rust sets SIG_IGN) latches a `broken` flag and stops
output cleanly — no panic/backtrace; dumps skipped when the pipe is gone.
TESTS: crates/cli/tests/run.rs (14, assert_cmd + predicates + tempfile) + 2 trace_json unit tests.
A no-toolchain ELF forge (crates/cli/tests/common/mod.rs) synthesizes exit-code/ebreak/spinner/
print-all-256 guests as minimal RV64 ET_EXEC images with a .symtab/.strtab carrying `tohost`, so
the whole suite runs on a COLD CLONE with only Rust (prebuilt hello/loops ELFs cover the rest).
Coverage: hello byte-exact stdout + exit 0; retired=83; guest exit 42→code 42; guest exit 256→
code 0 (mod-256); ebreak→101 + "Breakpoint" on stderr; --max-instrs 10 on a spinner→102 +
retired=10; --max-instrs 0 + --dump-state→still a valid dump (pc + state sha256=) + retired=0;
--trace - first 40 lines == E0-T16 golden byte-for-byte; STDOUT PURITY: print-all-256 guest yields
exactly bytes 0..=255 (no leakage/BOM/newline-translation); --dump-state final line matches the
E0-T17 regex ^state sha256=[0-9a-f]{64}$; missing file→2, non-ELF→65, rv32 (EI_CLASS flipped)→66,
too-big-for-0-MiB-RAM→68.
Adversarial angles pre-checked by hand: (4) --trace to /no/such/dir → exit 74, clean message, no
panic; (5) stdout | head -c1 (SIGPIPE) → no panic/backtrace (RUST_BACKTRACE=1 stderr clean); (6)
--max-instrs 50_000_000 no --trace → RSS bounded by the RAM allocation (~137 MB = 128 MiB), no
trace buffering (CliSink allocates nothing per-record when both writers are None).
Gates: fmt clean; clippy --workspace --all-targets --all-features -D warnings exit 0 (collapsed two
if-lets into let-chains); workspace tests 0 FAILED; core trace 0 FAILED; all 4 core native + wasm32
feature combos build; wasm-pack test --node green (run_traced refactor didn't perturb wasm
trace/snapshot); check-zero-cost --selftest OK.
rr: N/A locally (macOS). Verifier angles left open: independent SIGPIPE/panic audit, a guest exit
exactly 256 & 0xff==0 vs a real exit-0 (distinguish hang from mod-256), --trace to a read-only dir,
and confirm the ELF forge's `tohost` guests exit via HTIF not by falling off into the spin tail.
