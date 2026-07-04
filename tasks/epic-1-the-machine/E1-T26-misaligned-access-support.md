---
id: E1-T26
epic: 1
title: Misaligned load/store support — ma_data (Priv §3.6.3 / Unpriv §2.6)
priority: 126
status: in_progress
depends_on: [E1-T25]
estimate: M
capstone: false
---

## Goal
Support misaligned loads and stores to regular (main-memory) regions so that
`rv64ui-p-ma_data` passes, burning that entry from `tests/riscv-tests-allowlist.txt`. A
Level-1 RV64GC machine that will host xv6/Linux must not fault every unaligned access.

## Context
E0-T08 chose to fault ALL misaligned data accesses (the `ma_data` allowlist entry documents
this as deliberate). The spec permits an implementation to either handle misaligned accesses
in hardware OR trap them for emulation; a hosted OS expects them to WORK for normal memory.
This task makes misaligned accesses to RAM succeed (decomposed into aligned sub-accesses,
preserving byte order and atomicity-at-XLEN-not-required semantics), while still faulting
misaligned accesses that cross into a region where they are not permitted (MMIO, PMP
boundary) with the correct §3.7.1 priority (hence the E1-T25 dependency).

Interaction with E1-T25: once misaligned accesses to RAM succeed, the misaligned-vs-fault
priority only applies to misaligned accesses that ALSO fault for another reason — E1-T25
must land first so this task doesn't reintroduce an ordering ambiguity.

## Deliverables
- Misaligned data-access handling in the load/store path: an access to a valid, permitted
  RAM range completes even when `va & (len-1) != 0`, with correct little-endian byte
  assembly; MMIO / cross-region / PMP-denied misaligned accesses still fault per §3.7.1.
- `AMO`/LR-SC misalignment still faults `Load/StoreAddrMisaligned` (atomics require natural
  alignment — Unpriv §8.2), verified.
- Remove `rv64ui-p-ma_data` from `tests/riscv-tests-allowlist.txt`.
- Regression tests: misaligned lw/ld/sh/sd/lh crossing word/page boundaries within RAM;
  misaligned AMO still faults; misaligned access straddling a PMP boundary faults.

## Acceptance criteria
- [ ] `rv64ui-p-ma_data` passes end-to-end; allowlist entry removed; the riscv-tests CI
      wall (E1-T19) stays green with the smaller allowlist.
- [ ] Misaligned AMO/LR/SC still raise the misaligned trap (alignment required for atomics).
- [ ] `cargo test --workspace` and `make riscof` green; the trace fingerprint (T22) stays
      native==wasm for a misaligned-access program.

## Adversarial verification
Attack byte order: a misaligned store then aligned loads of the overlapping bytes must read
back exactly what a byte-wise model predicts (compare against Spike). Attack the boundary: a
misaligned access with its low half in RAM and high half past RAM-end must fault, not read
garbage. Attack atomics: confirm misaligned `amoadd`/`lr`/`sc` still fault. Fuzz (E1-T21,
once loads/stores land in the generator) misaligned accesses against Spike. Confirm the
determinism fingerprint is identical native vs wasm for a misaligned-heavy program.

## Verification log

### 2026-07-04 — design locked (branch set up; implementation next)
Investigated the load/store + atomic paths and locked a design that makes misaligned RAM
accesses succeed while preserving every E1-T25 §3.7.1 behavior (esp. the e0t08 device-edge
straddle tests) and keeping atomics alignment-required.

**Supportability gate (the crux):** a misaligned data access is supported ONLY when its
whole physical range is contiguous RAM. Concretely, in a `misaligned_load`/`misaligned_store`
helper: translate the first and last byte (`a` and `a+len-1`); require both to succeed,
`pa_last == pa_first + (len-1)` (contiguous — rejects non-contiguous paged mappings and
VA wrap), `bus.ram_contains(pa_first, len)`, and `pmp_ok` over the range. If any fails →
return `*AddrMisaligned` (tval=a), which:
- keeps e0t08 straddle-into-device / past-RAM → `*AddrMisaligned` (range not all-RAM), and
  the device is still never consulted (we never byte-access it);
- keeps a misaligned access to an unmapped page → `*AddrMisaligned` (§3.7.1 misaligned >
  page-fault), matching T25;
- conservatively faults cross-page misaligned (spec-permitted) — ma_data is p-mode/within-page.
When supported, decompose: `for i in 0..len { val |= (bus.load8(pa0+i)? as u64) << (8*i) }`
(stores mirror with `store8`), assembling little-endian; the macro's `as $ty` truncates to
width and `execute` sign/zero-extends as today.

**Implementation steps (next tick):**
1. Add `fn ram_contains(&self, addr, len) -> bool` to the `Bus` trait (default `false`),
   implement in `Ram` and `SystemBus` (`addr >= base && addr+len <= base+ram.len()`).
2. Add `misaligned_load`/`misaligned_store` free fns (the gate + byte loop above).
3. In `checked_load!`/`checked_store!`, branch: `if a & ($len-1) != 0 { misaligned_… }` else
   the current fast path. Keep `xlate_load`/`xlate_store` (aligned callers) as-is.
4. **Atomics stay aligned:** `xlate_amo` keeps its misaligned pre-check (AMO). **LR gotcha:**
   `LrW`/`LrD` call `cload32`/`cload64` and today rely on them faulting misaligned — with NO
   explicit alignment check (unlike `ScW`, which pre-checks `!a.is_multiple_of(4)`). Once the
   load path supports misaligned, LR would silently lose its alignment requirement, so ADD
   explicit `Load/StoreAddrMisaligned` pre-checks to `LrW` and `LrD` (mirror `ScW`/`ScD`).
5. Remove `rv64ui-p-ma_data` from `tests/riscv-tests-allowlist.txt` (2 → 1 allowlist entries).
6. Tests: misaligned lh/lw/ld/sh/sw/sd within RAM succeed (byte-exact LE vs a bytewise model);
   misaligned AMO/LR/SC still fault `*AddrMisaligned`; misaligned straddle into device/past-RAM
   still faults `*AddrMisaligned` with device silent; a misaligned store then aligned readback.
7. Gate: `cargo test --workspace`, `rv64ui-p-ma_data` passes, `make riscof` still GREEN, T22
   determinism fingerprint unchanged for a misaligned-access program.

### 2026-07-04 — implemented per the locked design; ma_data passes
Misaligned data accesses to RAM now succeed (byte-decomposed); MMIO / cross-region / cross-
page / unmapped and all atomics keep the §3.7.1 `*AddrMisaligned` trap.

**Core (`crates/core`):**
- `Bus::ram_contains(addr, len)` — new trait method (default `false`; implemented in `Ram`
  and `SystemBus`) = "does `[addr,addr+len)` lie entirely in a misaligned-supporting region
  (RAM)". Device windows never support misaligned.
- `hart/mod.rs`: `misaligned_ram_base` gate (translate first+last byte; require contiguous,
  in-RAM, PMP-permitted) + `misaligned_load`/`misaligned_store` (byte-wise LE assemble/split).
  The `checked_load!`/`checked_store!` macros branch on `a & (len-1)`: misaligned → the new
  helpers, aligned → the unchanged fast path. Because a handled access is byte-decomposed over
  a verified all-RAM range, a misaligned access can never partially touch a device (E0-T08
  device-silence preserved), and an unsupported one traps BEFORE any byte is written.
- **Atomics stay aligned:** `xlate_amo` keeps its pre-check; **added explicit alignment
  pre-checks to `LrW`/`LrD`** (they route through the now-misaligned-supporting `cload*` and
  had only an implicit guard — `rv64a::misaligned_lr_traps_load_cause` proves the fix).

**Allowlist:** removed `rv64ui-p-ma_data` from `tests/riscv-tests-allowlist.txt` (2 → 1) AND
from the `crates/core/tests/riscv_tests.rs` SKIP list (so it now RUNS and must pass). The
bidirectional wall (`riscv_tests_suite`) is green — a still-listed passing test would fail it.

**Test ripple (5 tests across 2 files — the inverse of T25):** tests that encoded E0-T08
"misaligned always faults" updated to the new contract, each with an E1-T26 citation:
- `hart_memory.rs`: `misaligned_ld_sd_*` → now asserts in-RAM misaligned SUCCEEDS (byte-exact
  LE round-trip) + a new `…causes_4_and_6_when_unsupported` (straddle past RAM still traps);
  `misaligned_…every_width` → in-RAM success at every width; the faulting-store and
  pc-unmoved tests repointed their misaligned FAULT cases to straddles past RAM_END.
- `verifier_e0t08_attacks.rs::every_memory_fault_shape…` → misaligned fault cases use
  `RAM_END-2` (ea straddles past RAM) instead of an in-RAM address.

**Gate:** `cargo fmt --check` clean; `cargo clippy --workspace --all-targets` clean; `cargo
test --workspace` → **90 ok-suites, 0 FAILED**; `rv64ui-p-ma_data` PASSES (runs in the suite);
T22 determinism GREEN (native AND wasm32 fingerprints match golden — the misaligned path is
the same code on both targets by construction, so acceptance #3 holds; wasm signature-equiv is
covered by that shared-code determinism proof). RISCOF regression check pending (next entry).

Second of the 45 Level-1-capstone (E1-T24) deferrals burned to zero: 44 → 43 remaining.

### 2026-07-04 — RISCOF revealed a Spike-reference conflict; resolving via the Sail reference
**The conflict:** with our DUT now HANDLING misaligned (spec-legal, `hw_data_misaligned_support:
True`), the 8 RISCOF `privilege/misalign-*` tests (ld/lh/lhu/lw/lwu/sd/sh/sw) went RED. The
signature diff is decisive — for `misalign-lh`, our DUT stores the loaded halfword (`ffffbeca`)
while the **Spike reference stores a TRAP frame** (`00000004` = mcause 4 LoadAddrMisaligned +
mepc/mtval). So **Spike-1.1.1-dev hardcodes misaligned trapping** — the `hw_data_misaligned_support`
yaml only selects the test case, not Spike's runtime. This Spike build has no `--misaligned` flag.

**Decision (user):** provision the canonical **Sail** reference, which honors
`hw_data_misaligned_support`. Progress:
- **Sail provisioned** — `sail-riscv 0.12` ships PREBUILT binaries (no opam/source build):
  `compliance/provision.sh` now downloads the platform-matched `sail_riscv_sim` (Mac-arm64 here,
  Linux for CI) into gitignored `compliance/sail-riscv/`.
- **Proven to match our DUT:** ran `sail_riscv_sim --test-signature … misalign-lh.elf` with Sail's
  DEFAULT config → signature **byte-identical** to our DUT (`ffffbeca ffffffff …`). Sail's default
  `memory.misaligned.exceptions.load_store = {"None": null}` lets misaligned scalar accesses proceed,
  exactly like us.
- **Sail RISCOF plugin built** — `compliance/sail/riscof_sail.py` (mirrors the spike plugin: compile
  via Docker gcc, run Sail natively on the host; resolves the binary via `$SAIL_SIM` or the
  provisioned tree). `tools/run_riscof.sh` now takes `RISCOF_REF` (default `sail`, `spike` fallback).

**REMAINING BLOCKER (next step — do NOT push until green):** Sail's DEFAULT config declares a much
larger ISA than ours — `--print-isa-string` = `rv64imafdcbv_…svnapot_svpbmt_…sv57…` (B, V, crypto,
Svnapot, Svpbmt, Sv57, Sscofpmf, …). Using it as-is would DIVERGE on exactly the vm_* tests E1-T20
fixed (Sail would ACCEPT svnapot/svpbmt/reserved-PTE-bits and Sv57 where our DUT correctly
page-faults / WARL-rejects), and misa reads would mismatch. So a precise **`--config-override`
matching rv64gc + S/U + Sv39/Sv48 only** (disable B/V/crypto/Svnapot/Svpbmt/Sv57/Sscofpmf; set misa
= 0x800000000014112D) must be authored and wired into the plugin, then the full RISCOF re-run
validated against Sail. The plugin already layers `compliance/sail/sail_config_override.json` when
present. Only then does T26 land green (and it should ALSO clear the current Sv57/etc. Spike
exclusions if Sail is configured to reject them identically — to be verified).

State at checkpoint: T26 CORE is complete and correct (misaligned RAM support; `cargo test
--workspace` 90/0; ma_data passes; determinism GREEN native+wasm). RISCOF is RED pending the Sail
config-override above. Committed as WIP on the branch; NOT opened as a PR until RISCOF is green.

### 2026-07-04 — Sail diagnostic: 8 misalign-* now PASS; Sail caught a real §3.7.1 bug (5 left)
Ran the full RISCOF against Sail (default config): **352 passed / 43 failed, 5 UNEXCUSED** — the
**8 privilege/misalign-* tests now PASS against Sail** (the whole point). The 5 remaining unexcused
failures split into two kinds:

**(a) Sail-config mismatch (4 tests) — fix with a `--config-override`:**
`vm_sv39/48 reserved_svnapot` and `vm_sv39/48 pte_reserved_field`. Sail's DEFAULT config has
**Svnapot/Svpbmt enabled**, so Sail ACCEPTS PTE bit 63 (N) / bits 62:61 (PBMT) / reserved [60:54]
where our DUT correctly page-faults (E1-T20). Authoring `compliance/sail/sail_config_override.json`
disabling `extensions.Svnapot`/`Svpbmt` (and Sv57, and pinning misa) makes Sail reject them too. The
plugin already layers this file when present.

**(b) A REAL correctness bug in OUR misaligned impl that Sail exposed (1 test → but it's a class):**
`vm_sv39 VA_all_zeros` — a MISALIGNED access to an UNMAPPED page. Sail reports **page-fault**; our
DUT reports `*AddrMisaligned`. Per Priv §3.7.1, a machine that SUPPORTS misaligned (which we now do)
must NOT raise a misaligned exception for the misaligned-ness — the access proceeds and the
translation page-faults, so **page-fault is correct**. Our `misaligned_ram_base` does
`translate(...).ok()?` → `None` → blanket `*AddrMisaligned`, SWALLOWING the real page/access fault.
That is a bug: for a misaligned-supporting machine the priority flips (misaligned no longer outranks
page-fault, because there IS no misaligned exception). **This is the genuine value of switching to
the canonical Sail reference — it caught a §3.7.1 subtlety the trapping-Spike reference could not.**

**Required core fix (next pass — this is why T26 stays WIP):** rework `misaligned_load`/
`misaligned_store` so that when a byte's translation or access FAULTS, the real trap (page-fault
12/13/15, or access-fault 5/7) is PROPAGATED — not converted to `*AddrMisaligned`. Only genuinely
misaligned-unsupported *regions* (per a policy decision) would raise `*AddrMisaligned`. This ripples
back into the E1-T25-updated e0t08/hart_memory straddle tests (a misaligned straddle past RAM_END is
now an access-fault on the out-of-range byte, not `*AddrMisaligned`), and must respect store
atomicity (no partial write before a faulting byte — gate the whole range first, as the current code
already does for the RAM case; extend the gate to classify the fault). Then re-run RISCOF vs Sail →
expect GREEN with the 8 misalign-* passing and NO new exclusions, and re-verify the workspace.

Net once complete: allowlist −1 (ma_data), RISCOF exclusions unchanged (Sail validates misalign-*
without exclusions) → **capstone deferrals 44 → 43**, as intended. T26 remains WIP (RISCOF red) until
the core §3.7.1 fix + Sail config-override land and validate.
