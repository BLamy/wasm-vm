---
id: E0-T10
epic: 0
title: ELF64 loader for bare-metal riscv64 executables
priority: 10
status: implemented
depends_on: [E0-T03]
estimate: M
capstone: false
---

## Goal
A dependency-free ELF64 parser/loader in `wasm-vm-core` (`&[u8]` in, `Result` out — works
identically in no_std/wasm) that validates a bare-metal riscv64 `ET_EXEC` image, copies
each `PT_LOAD` segment into guest RAM at `p_paddr`, zero-fills `p_memsz - p_filesz` (BSS),
returns `e_entry`, and can look up the `tohost`/`fromhost` symbols needed by HTIF (E0-T11).

## Context
ELF64 per the System V gABI: magic `\x7fELF`, `EI_CLASS = ELFCLASS64 (2)`,
`EI_DATA = ELFDATA2LSB (1)`, `e_machine = EM_RISCV (243)`, `e_type = ET_EXEC (2)` (reject
`ET_DYN` for now with a distinct error). Bare-metal convention: load at `p_paddr` (not
`p_vaddr`) — Spike does the same, keeping us diffable. Hand-roll the parser (~150 lines)
rather than pulling `goblin`/`object`: it must be no_std, panic-free on garbage, and is a
future fuzz target. Symbol lookup scans `.symtab`/`.strtab` section headers.

## Deliverables
- `crates/core/src/loader.rs`: `load_elf(bytes: &[u8], ram: &mut Ram) -> Result<LoadedImage,
  ElfError>` where `LoadedImage { entry: u64, tohost: Option<u64>, fromhost: Option<u64> }`;
  `ElfError` distinguishes BadMagic/WrongClass/WrongEndian/WrongMachine/WrongType/
  Truncated/SegmentOutOfRam.
- Checked-in fixture `crates/core/tests/fixtures/minimal.elf` (a tiny prebuilt rv64i
  executable, byte-committed) plus hand-crafted malformed variants generated in-test.
- Cross-check test comparing parsed headers against a committed `readelf -l` dump.

## Acceptance criteria
- [ ] `minimal.elf` loads: entry, segment placement, and byte content match the committed
      `readelf -l`/`objdump -s` reference dumps.
- [ ] `p_memsz > p_filesz` zero-fill verified (BSS region reads back 0 even after RAM is
      pre-seeded with `0xAA`).
- [ ] Each malformed case (truncated header, `e_phoff` past EOF, `p_offset + p_filesz`
      overflow, segment ending past RAM, ELFCLASS32 input, `e_machine = 62` x86-64 input)
      returns its specific `ElfError` — no panics, no partial RAM writes before validation.
- [ ] An x86-64 ELF is rejected for *machine*, an rv32 ELF for *class* (error precision).
- [ ] Suite passes natively and under `wasm-pack test --node`.

## Adversarial verification
(1) Fuzz it immediately: 10 minutes of `cargo fuzz` (or a 100k-iteration random-mutation
loop over `minimal.elf`) — any panic, overflow, or out-of-bounds RAM write refutes.
(2) Integer-overflow attacks: `p_filesz = u64::MAX`, `p_paddr = u64::MAX - 100`,
`e_phnum = 0xFFFF` — arithmetic must be checked. (3) Partial-write attack: craft an ELF
whose second PT_LOAD is out of range; if the first segment was already copied, document
whether the API contract says "RAM undefined on error" — an *undocumented* partial write
refutes. (4) Verify against a real toolchain artifact: once E0-T14 lands, load `hello.elf`
and byte-compare loaded RAM against `riscv64-unknown-elf-objcopy -O binary` output.
(5) Confirm the fixture ELF's provenance is documented (source + rebuild command) — an
unreproducible binary blob in-tree refutes.

## Verification log

### 2026-07-02 — worker claim — commit 60b1cf7 (branch task/e0-t10-elf-loader, stacked on e0-t09)
Deliverables: crates/core/src/loader.rs — dependency-free, no_std, panic-free ELF64
parser/loader. load_elf validates header identity with PRECISE errors (machine checked
before type: x86-64 rejects WrongMachine, rv32 rejects WrongClass, ET_DYN rejects
WrongType); TWO-PASS load: pass 1 validates every PT_LOAD (checked u64/u128 arithmetic,
file bounds AND RAM bounds) before pass 2 writes a byte — CONTRACT: RAM bit-identical on
any Err (stronger than the task's "document partial writes" option; tested with a
valid-first/invalid-second image). Loads at p_paddr (Spike convention); BSS zero-fill in
512-byte chunks with no over-fill past p_memsz; tohost/fromhost via best-effort
.symtab/.strtab scan (bounded loops, malformed → Nones, never panic/error).
FIXTURE PROVENANCE (angle 5 pre-empted): minimal.elf (ET_EXEC rv64i, entry 0x80000000,
2 PT_LOADs, second with filesz 0x21 < memsz 0x121, tohost/fromhost symbols) built by the
COMMITTED fixtures/build.sh (docker alpine clang+lld with committed minimal.s + link.ld);
committed llvm-readelf/objdump dumps are the cross-check references.
Tests: 6 native — dump CROSS-CHECK test parses the committed readelf text (entry +
segment placement + byte content per LOAD line, not hardcoded); BSS zero-fill over
0xAA-preseeded RAM incl. no-over-fill probe; 9-case malformed battery with exact error
asserts; overflow attacks (p_filesz=u64::MAX, p_paddr=u64::MAX-100, e_phnum=0xFFFF,
filesz>memsz); no-partial-write; 100k-iteration mutation fuzz + garbage buffers (angle 1
proactive; miri-reduced to 500 per established pattern). 3 wasm32 mirrors (32-bit usize
arithmetic; the mirror caught a golden-word rd mixup in its own first draft — documented
in-test). miri: 6/6 (88s). Gates: fmt / clippy exit 0 / 20 native + 9 wasm suites /
no_std wasm32 build / CI green run 28628224873.
rr: SKIPPED locally (macOS/no PMU per AGENTS.md).
Angle 4 follow-up recorded: byte-compare vs objcopy output when E0-T14 lands.

### 2026-07-02 — adversarial verifier (fresh session) — VERDICT: refuted
- P1 fuzz (angle 1) — HELD. 0 panics over 2,000,000 targeted-mutation iters + ~34k random buffers, verifier seed, overflow-checks-on.
- P2 overflow battery (angle 2) — HELD. e_phoff/e_shoff=u64::MAX, p_offset+p_filesz>usize, p_paddr+p_memsz wrap → all Err, no panic.
- P3 symbol-scan malformed — HELD. bogus sh_link=0xFFFFFFFF, sh_offset past EOF, sh_size=u64::MAX, truncated strtab, shentsize=0xFFFF → None, no panic, miri-clean.
- P4 no-partial-write (angle 3) — HELD. RAM bit-identical across out-of-RAM/file-overflow/filesz>memsz second-segment failures; zero-PT_LOAD and memsz=0 succeed with RAM untouched.
- P5 error precision on GENUINE artifacts — IMPL HELD, COVERAGE FAILED. Real x86-64 EXEC/DYN and rv32 ELFs → WrongMachine/WrongMachine/WrongClass correct on real code.
- P6 fixture provenance (angle 5) — HELD. Rebuilt minimal.elf from committed build.sh → sha256 bit-identical to committed; dumps match; cross-check test genuinely parses the dump.
- P7 wasm+miri — HELD. loader 3/3 wasm, loader_elf 6/6 + verifier 4/4 miri, no UB.
- rr — SKIPPED (macOS/no PMU); pure &[u8]→Result, no concurrency.
- COVERAGE — REFUTATION: mutation (a) "e_machine checked AFTER e_type" SURVIVES the committed suite yet mis-reports a GENUINE x86-64 PIE (ET_DYN+machine 62) as WrongType not WrongMachine — the byte-patched x86-64 test kept ET_EXEC, so type-first still falls through to the machine check; the ordering the acceptance criterion rests on is UNPROVEN. Mutations (b)-(f) correctly RED. DEMAND: committed test with machine≠243 AND type≠2 asserting WrongMachine (genuine x86_64_dyn.elf is a ready fixture).
- MOCK/HONESTY: claim-commit tasks-only; fixture bit-identical reproducible. Caveat: CI run could not be independently verified from a local-origin clone (green-CI rests on worker's word here).
- NOVEL: genuine-x86-64-PIE probe (ET_DYN + machine 62) — the input where machine/type ordering is observable — exposed the gap; byte-patched ET_EXEC cannot. Zero-PT_LOAD/memsz=0 untouched-RAM success held.
- SUITE: promote verifier_genuine.rs + genuine/*.elf (real-toolchain error-precision regression, the mutation-(a) kill); promote verifier_e0t10 symtab/partial-write/zero-seg cases (fuzz reworked to committed volume); discard 2M fuzz as-is (keep as corpus seeds).

### 2026-07-02 — rework after refutation (worker)
Applied all demands: (1) promoted verifier_genuine.rs + genuine/{x86_64_exec,x86_64_dyn,
rv32}.elf (real toolchain artifacts) and verifier_e0t10.rs (fuzz reworked 2M→200k CI
volume, miri 500; 2M campaign preserved as corpus provenance); (2) re-ran the exact
surviving mutation (e_machine checked after e_type): now KILLED by
genuine_x86_64_dyn_rejected_for_machine_not_type, reverted, loader.rs clean; mutations
(b)-(f) re-confirmed red. Gates: clippy exit 0, 22 native suites green. Status
implemented; re-verification requested.
