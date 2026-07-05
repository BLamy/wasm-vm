---
id: E0-T14
epic: 0
title: Golden bare-metal guest binaries with crt0, linker script, and reproducible builds
priority: 14
status: verified
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

### 2026-07-02 — worker claim — commit 4dec5f1 (branch task/e0-t14-golden-binaries, stacked on e0-t13)
Deliverables: guest/ — crt0.S (sp=__stack_top, zero .bss, call main, tohost=(a0<<1)|1,
park), link.ld (ENTRY at 0x80000000, .text/.rodata/.data/.bss, .tohost with 8-aligned
tohost+fromhost as PLAIN assignments so BOTH always emit, __stack_top above bss),
console.h (volatile byte store to 0x10000000). Three <16-line programs: hello.c (prints
"Hello from RV64\n", exit 0), loops.S (counted sum 1..10, pure RV64I no memory, exit 0),
memops.c (all load/store widths+sign modes via typed volatile ptrs, prints "memops done",
exit 0). Makefile: -march=rv64i -mabi=lp64 -mcmodel=medany -nostdlib -nostartfiles
-ffreestanding -O2 -fno-builtin, no libgcc. prebuilt/{hello,loops,memops}.elf byte-
committed; check-reproducible.sh rebuilds in-container + cmp, exits nonzero on drift.
REPRODUCIBILITY (angle 1): byte-identical rebuilds — SOURCE_DATE_EPOCH=0, -ffile-prefix-map,
-frandom-seed=golden, AND separate compile-to-fixed-.o-then-link (root cause found: the
one-step gcc build leaks a random temp-object name ccXXXXXX.o into .strtab). Verified:
sha256 identical across two clean builds; check-reproducible passes; strip one ELF → check
FAILS exit 1 (angle 5).
ISA PURITY (angle 2): objdump scan of all three finds zero mul|div|rem|csr|amo|lr|sc|
fence.i|c. mnemonics; zero ecall/ebreak (exit is via tohost store, not ecall).
HEADERS: EM_RISCV, ET_EXEC, entry 0x80000000; tohost 8-aligned (0x800000c0/0x80000140);
fromhost present; __stack_top (0x80002150) well above __bss_end (0x80000110), no overlap
(angle 3). LOOPS golden retired count = 56 under Spike, DETERMINISTIC across 2 runs (angle
4, metric for E0-T24). SPIKE: all three exit 0 under `spike --isa=rv64i -m0x80000000:
0x8000000` — the built-in ns16550 UART at 0x10000000 both retires the console stores AND
prints (hello → "Hello from RV64"); the task's -m0x10000000 overlap form predates this
Spike and errors, documented in guest/README.md.
PAYOFF — crates/core/tests/golden_run.rs: loads the committed ELFs into OUR Machine (console
attached at UART0), runs, asserts hello prints "Hello from RV64\n"+Exited(0), memops prints
"memops done"+Exited(0), loops Exited(0)+no output, all terminate within budget — the whole
interpreter (loader→hart→console+HTIF) on genuine cross-compiled binaries, 4/4 green.
Gates: fmt / clippy exit 0 / all native suites 0 FAILED (grep-checked) / CI green run
28636616766.
rr: N/A for the guest build; the golden_run.rs emulator tests are the runtime evidence
(host-layer rr on Linux CI arrives with E0-T20).

### 2026-07-02 — adversarial verifier (fresh session) — VERDICT: verified
- P1 reproducibility — HELD. Cold container rebuild sha256-identical to all three committed prebuilt ELFs; two independent rebuilds identical. Root-cause confirmed: one-step build DIFFERS at char 4481 and leaks ccihY9Bi.o into .strtab; committed has no cc-temp. No host paths (strings | grep /work|/tmp|/Users empty).
- P2 ISA purity — HELD. objdump scan of all three: zero mul|div|rem|csr|amo|lr|sc|fence.i|c.<x>, zero ecall|ebreak; crt0 exit is sd a0,0(tohost) then j ., no ecall.
- P3 headers/stack — HELD. EM_RISCV/ET_EXEC/entry 0x80000000; tohost+fromhost 8-aligned all three; memops __stack_top 0x80002150 far above __bss_end 0x80000110, no overlap.
- P4 loops determinism — HELD with caveat. 56 both runs, the two -l logs byte-identical, all 56 are `core 0:` retire lines. CAVEAT: 56 is a WHOLE-RUN count incl. ~6 Spike boot-ROM instrs (entry 0x1000, csrr mhartid) before the jump to 0x80000000; our emulator enters directly at e_entry with no boot ROM so its guest-only count is ~6 lower. E0-T24 must compare guest-region counts, not raw 56. FIXED in guest/README.md.
- P6 check-reproducible sensitivity — HELD. byte-flip → exit 1 naming hello.elf; strip loops.elf → exit 1 naming loops.elf; restored → exit 0.
- RUST TEST — HELD. golden_run 4/4; assertions exact (bytes + Exited(0)); ELFs include_bytes! from prebuilt/; mutation Hello→Goodbye fails loudly with real emulator output bytes.
- COVERAGE/DIFFERENTIAL — HELD, NO DIVERGENCE. Spike vs our Machine byte-identical: hello→"Hello from RV64\n", memops→"memops done\n", loops→empty; exit codes all 0 = Exited(0). Cross-checked on a MODIFIED binary too (NOVEL).
- MOCK/HONESTY — clean. git ls-files shows all three prebuilt genuinely committed; match the container build this run (sha256); README honestly documents medany, temp-.o root cause, spike ns16550-UART / -m overlap. CI 28636616766 not verifiable in the sandbox (SKIPPED non-blocking; local evidence decisive).
- NOVEL — tight 3-instr budget → MaxInstrs, no false Exited. Byte-patch differential: patching rodata byte 4208 changed nothing (root-caused: -O2 hoisted 'H' to li a4,72 and reads rest from rodata+1, so 4208 never runtime-read); re-patched byte 4209 'e'→'Y': BOTH Spike and our emulator print "HYllo from RV64" — real memory-backed execution AND Spike agreement on a novel binary. No fault.
- SUITE: golden_run.rs is a genuine loader→hart→console+HTIF integration test bound to the audited artifact; reproducibility + Spike agreement verified from a cold clone.

### 2026-07-02 — post-verdict actions (worker)
Applied the verifier's one caveat: guest/README.md now documents that the "56" loops count
is a whole-run Spike figure including ~6 boot-ROM instructions, so E0-T24 must compare
guest-region counts (our emulator enters directly at e_entry with no boot ROM). No
code/binary change — the golden ELFs and emulator-vs-Spike agreement stand as verified.
