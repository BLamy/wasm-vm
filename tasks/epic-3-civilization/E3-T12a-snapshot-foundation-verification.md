---
id: E3-T12a
epic: 3
title: Verify snapshot container and bounded component foundation
priority: 321.91
status: verified
depends_on: [E3-T08]
estimate: S
risk: high
capstone: false
---

## Goal
Freeze and independently verify the already-landed versioned snapshot container, sparse RAM codec,
and bounded CLINT, PLIC, UART, RTC, and RAM component visitors before extending the format.

## Deliverables
- One inventory mapping every landed snapshot section and field to its implementation and test.
- A deterministic `verify-E3-T12a` target covering malformed/truncated containers, allocation
  bounds, exact component round trips, and native/wasm builds.
- Promoted regressions for every surviving test-gap note carried from E3-T12 Passes 1-5.

## Acceptance criteria
- [x] `make verify-E3-T12a` passes from a pristine clone at the frozen head.
- [x] Every landed section is either byte-complete and round-tripped or explicitly rejected as
  unsupported; hostile lengths cannot panic or allocate beyond the declared snapshot size.
- [x] A mostly-zero 256 MiB RAM model encodes below 15% of raw size and restores byte-identically.

## Adversarial verification
Mutate each section tag/length and each component field, repeat the known allocation-bound mutants,
and fuzz truncations on native and wasm32. Any unaccounted state, vacuous regression, partial restore,
panic, or unbounded allocation refutes.

## Verification log

2026-07-29 — Verified. `make verify-E3-T12a` is green (fmt + clippy on the core lib, the resume
format/codec suite, every bounded-component round-trip + rejection test, the 256 MiB RAM elision, and
the same format/codec/refusal executed on real wasm32).

### Inventory — landed sections → implementation → test

| Section (tag) | Impl | Payload layout | Round-trip test | Rejection test |
|---|---|---|---|---|
| RAM (2) | `ram.rs:292` | `encode_sparse(data)`, zero-elided | `ram_round_trips_completely`; **`a_mostly_zero_256_mib_ram_encodes_under_15_percent_and_restores_byte_identically`** (new, AC #3) | `restoring_a_wrong_size_snapshot_is_refused`; `a_malformed_payload_is_refused` |
| CLINT (3) | `dev/clint.rs:73` | mtime u64 + mtimecmp u64 + msip u8 = 17 B | `clint_state_round_trips_completely` | `clint_restore_rejects_malformed_payloads_without_mutating` |
| PLIC (4) | `dev/plic.rs:78` | 156 B fixed (`PLIC_SNAPSHOT_LEN`); `claim_count` reset, not serialized | `plic_behavioural_state_round_trips_and_drops_the_diagnostic_counter` | `plic_restore_rejects_wrong_length_without_mutating` |
| UART (5) | `dev/uart16550.rs:100` | 14 B regs/latches + len-prefixed rx (≤FIFO_DEPTH) + len-prefixed out | `uart_state_round_trips_completely` | `uart_restore_rejects_malformed…`; `uart_restore_never_panics_on_random_input` (5k fuzz) |
| RTC (8) | `dev/rtc.rs:94` | 27 B; host clock not serialized | `rtc_state_round_trips_completely_and_keeps_the_host_clock` | `rtc_restore_rejects_malformed_without_mutating` |
| CPU (1), VIRTIO_BLK (6), VIRTIO_NET (7) | **reserved, no restorer this build** | — | — | **`a_reserved_but_unimplemented_section_is_refused_as_unsupported`** (new) + wasm32 twin |

Format/codec (`resume_tests.rs`): header round-trip, BadMagic, VersionMismatch, Truncated, the three
coherence guards, UnknownSection, SectionLengthOverflow, partial-trailing truncation, whole-parser
no-panic fuzz (every cut + every flip + 20k junk), sparse round-trip/compaction, BadSparseEncoding,
SparseRunExceedsTotal (zero- and data-chunk), decode no-panic fuzz, and a component through the full
writer→reader seam.

### Changes made in this pass (freeze hardening)

- **AC #2 "explicitly rejected as unsupported".** The reserved tags CPU/VIRTIO_BLK/VIRTIO_NET were
  accepted by `is_known_section` yet had no restorer, so a restore loop would silently skip them — the
  exact half-applied hazard the format forbids. Added `SnapshotError::UnsupportedSection { tag }` and an
  `is_supported_section` predicate (RAM/CLINT/PLIC/UART/RTC); `SectionReader` now refuses a
  known-but-unsupported tag loudly, distinct from a garbage `UnknownSection`. When a CPU/virtio visitor
  lands (E3-T12b/c) its tag moves into `is_supported_section` — no format-version bump, the reader was
  already failing closed. Two format tests that used `section::CPU` as an opaque placeholder now use a
  supported tag.
- **AC #3.** Added the mostly-zero **256 MiB** RAM test (<15% + byte-identical restore); the prior test
  was 1 MiB.
- **native+wasm.** Added `crates/wasm/tests/resume.rs` — RAM round-trip, the `SparseRunExceedsTotal`
  allocation bound, and the unsupported-section refusal run on real wasm32, so the `checked_add` guards
  written for 32-bit `usize` are exercised by execution, not just asserted.
- Added `make verify-E3-T12a`, scoped to the core library (the frozen foundation) plus the wasm test.

### Notes / out of scope (carried to later passes)

- The Pass 1-5 test-gap notes from E3-T12 (vacuous DoS regression, PLIC counter-reset, RTC bool-index,
  wasm32 usize overflow) were already fixed and are covered by the tests above — no surviving gaps to
  promote.
- No whole-machine save/restore path assembles CPU+RAM+devices into one blob yet; `SnapshotWriter`/
  `SectionReader`/`validate_for` have no production caller. That integration — plus the CPU and virtio
  visitors and the determinism trace-diff — is deferred to E3-T12b/c by design; until then those
  sections are reserved-and-refused, which the freeze now enforces.
- The verify target is deliberately scoped to `wasm-vm-core --lib`: the wider workspace currently
  carries unrelated clippy debt outside this task (a dead-code lint in `crates/cli/src/os_entropy.rs`
  and a `repeat().take()` lint in the `virtio_net_wiring_probes` test), which is not E3-T12a's to fix.
