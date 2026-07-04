---
id: E1-T18
epic: 1
title: satp mode switching (Bare/Sv39/Sv48) with config-gated Sv48 support
priority: 118
status: pending
depends_on: [E1-T15, E1-T17]
estimate: M
capstone: false
---

## Goal
satp becomes a fully WARL-correct mode switch: Bare (MODE=0) ⇔ Sv39 (MODE=8) transitions
behave per spec, and a config-gated Sv48 (MODE=9) generalizes the T16 walker to four
levels — proving the walker isn't hard-coded to three levels and giving Level 2+ a
bigger-VA escape hatch that QEMU-virt guests may probe for.

## Context
Privileged spec §4.1.11 (satp), §4.5 (Sv48). Key WARL behavior: if satp is written with
an unsupported MODE, the *entire write takes no effect* — MODE, ASID, and PPN all keep
their old values (not just MODE legalization; this exact behavior is what Linux's
`set_satp_mode` probing relies on to detect Sv48/Sv57 support). With Sv48 gated OFF, a
write of MODE=9 must therefore be a complete no-op; gated ON it must switch. Bare mode:
no translation, no PMP change, ASID/PPN fields still WARL-writable per our documented
choice (match Spike). Sv48: VA[47:0], sign-check against bit 47, four levels (512^4),
superpages at 512 GiB/1 GiB/2 MiB. satp writes in S with mstatus.TVM=1 trap (T09); satp
access in U always traps. Mode changes do not flush the TLB (T17) — SFENCE.VMA required;
TLB entries must be tagged or flushed such that stale cross-mode hits cannot occur
(document the chosen scheme: we tag entries with the translation mode).

## Deliverables
- Machine config flag `sv48: bool` (default on for native tests, exercised both ways in
  CI); walker refactored to a level-count-parameterized walk shared by Sv39/Sv48.
- satp write path implementing all-or-nothing WARL and ASID width (16 bits) masking.
- Non-canonical VA checks parameterized per mode (bit 38 vs bit 47 sign extension).
- Tests: mode-probe sequence (write 9, read back — both gate settings), Bare→Sv39→Sv48→
  Bare transitions with fences, a 4-level walk hitting each superpage size, boundary
  canonical/non-canonical VAs per mode.

## Acceptance criteria
- [ ] With Sv48 gated off: `csrw satp, (9<<60)|asid|ppn` leaves satp bit-identical to its
      previous value (ASID/PPN unchanged too); with the gate on, readback equals the
      written legal value.
- [ ] MODE=1..7 and 10..15 writes are complete no-ops under both gate settings.
- [ ] In Bare mode, VA==PA for the full address space (probe high addresses that Sv39
      would reject as non-canonical — they must work bare, subject to PMP only).
- [ ] Under Sv48: a 4-level walk translates correctly; VA with bits 63:48 != bit 47
      raises the access-type page fault; the same VA pattern under Sv39 applies the
      bit-38 rule instead.
- [ ] 512 GiB, 1 GiB, 2 MiB Sv48 superpages translate with correct offset passthrough
      and misalignment faults.
- [ ] After Sv39→Sv48 switch without SFENCE.VMA, no translation is served from a
      Sv39-tagged TLB entry (mode tagging test); rv64si suite passes under both gates.

## Adversarial verification
Diff the Linux-style probe against Spike/QEMU: write MODE=10 (Sv57, unsupported by us),
MODE=9, MODE=8 in sequence with distinct ASID/PPN payloads, reading satp after each —
byte-exact match with Spike (`--isa=rv64gc` supports sv48; also run our sv48-off config
against documented spec text where Spike can't be restricted) is required; partial-write
legalization (MODE rejected but ASID updated) is the expected implementation bug and an
immediate refutation. Attack the shared walker: run the T16 hostile PTE corpus under
Sv48 at level 3 (the new level) — pointer-PTE-at-level-0 and superpage-misalignment
rules must generalize. Attack mode-switch staleness: translate VA X under Sv39, switch
to Sv48 with tables making X map elsewhere, access without fence — serving the Sv39 PA
refutes (mode tag broken). Attack Bare: with satp=0, verify zero PTW memory traffic via
bus counters (a walker that "walks" bare mode refutes). Confirm both CI matrix legs
(sv48 on/off) actually ran — a green run with the gate never exercised off refutes the
config claim.

## Verification log

### 2026-07-04 — implementation
- **`crates/core/src/csr.rs`** — `satp` write is now **all-or-nothing WARL** (a new `SATP` arm in
  `write_raw`): a write whose MODE is unsupported (anything but Bare/Sv39, plus Sv48 iff configured)
  leaves the ENTIRE register — MODE, ASID, and PPN — at its old value, exactly what Linux's
  `set_satp_mode` probe reads back. New `pub sv48: bool` config field (default true) gates MODE=9;
  it is a hardware config bit, so `Hart::reset` PRESERVES it across a reset (not architectural
  state). A mode change does NOT flush the TLB (SFENCE.VMA required, T17).
- **`crates/core/src/mmu.rs`** — the walker is now **level-count-parameterized**, shared by
  Sv39/Sv48. `mode_params(csr, eff) -> Option<(levels, sign_bit, mode_tag)>` returns `(3, 38, 8)`
  for Sv39, `(4, 47, 9)` for Sv48, and `None` (identity) for Bare / unsupported MODE / M-effective.
  `canonical(va, sign_bit)` parameterizes the sign-extension check (bit 38 vs bit 47). `walk_leaf`
  takes `levels` and iterates `(0..levels).rev()`; the per-level VPN slices, superpage low-bit
  masks, and PA composition already generalize, so Sv48 adds level-3 (512 GiB) superpages for free.
- **`crates/core/src/tlb.rs`** — entries carry a **`mode` tag** (satp MODE, 8/9); `lookup`/`fill`
  thread it and a hit requires a mode match, so a Sv39→Sv48 switch WITHOUT an SFENCE.VMA can never
  serve a cross-mode stale entry (and switching back still hits the surviving Sv39 entry — a tag,
  not a flush). `VPN_MASK` widened to 36 bits (Sv48 VPN width; an Sv39 VA's upper VPN bits are its
  sign extension, so no conflation) and `LEVELS` to 4 (Sv48 probes level 3; Sv39 simply misses it).

**Tests** (`crates/core/tests/sv48.rs`, 8): all-or-nothing WARL (Sv39/Sv48 take effect gated on;
MODE=10 and every reserved MODE 1..7/10..15 are total no-ops incl. ASID/PPN); Sv48 write is a
no-op gated off (readback == old); Bare identity for high addresses Sv39 rejects; Sv48 4-level walk
with offset passthrough; the canonical rule differs by mode (a VA Sv48 admits but Sv39 rejects);
Sv48 non-canonical (bit-48) fault; Sv48 superpages at 2 MiB/1 GiB/512 GiB with offset passthrough +
misalignment faults; and the mode-tagged staleness test (Sv39→Sv48 without fence re-walks to the
Sv48 mapping, and back still hits the Sv39 entry). All prior Sv39/TLB suites unchanged (Sv39 now
flows through the parameterized path).

Local gate: fmt clean; clippy 0 (workspace + zicsr-stub, all-targets); `cargo test --workspace`
0 `test result: FAILED`; both wasm32 builds (no_std, +trace) clean.
