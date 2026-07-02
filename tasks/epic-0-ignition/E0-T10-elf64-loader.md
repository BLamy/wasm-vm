---
id: E0-T10
epic: 0
title: ELF64 loader for bare-metal riscv64 executables
priority: 10
status: in-progress
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
(empty)
