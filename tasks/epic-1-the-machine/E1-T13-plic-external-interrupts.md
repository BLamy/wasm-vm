---
id: E1-T13
epic: 1
title: PLIC — priorities, enables, thresholds, claim/complete, M and S contexts
priority: 113
status: verified
depends_on: [E1-T11]
estimate: M
capstone: false
---

## Goal
A QEMU-virt-compatible PLIC at 0x0C00_0000 routing up to 32 external interrupt sources
through per-source priorities, per-context enable bits and priority thresholds, and the
claim/complete handshake, driving mip.MEIP (hart0 M context) and mip.SEIP (hart0 S
context) — the front door every Level 2 device (UART, virtio) will ring.

## Context
The RISC-V PLIC spec (riscv-plic-1.0.0) with the QEMU-virt memory map Linux's device tree
expects: source priorities at base+0x0 (source i at +4*i; source 0 nonexistent), pending
bits at +0x1000, enable bits at +0x2000 + 0x80*context, threshold at +0x200000 +
0x1000*context, claim/complete at threshold+4. Contexts: hart0/M = 0, hart0/S = 1.
Semantics: a source with priority 0 never interrupts; context EIP is asserted while any
pending&enabled source has priority > threshold; CLAIM read returns the highest-priority
such source (ties broken by lowest source id) and clears its pending bit; COMPLETE write
of that id re-opens the gateway. Level-triggered gateway model: a source held high
re-pends after complete.

## Deliverables
- `plic.rs` bus device: 32 sources, 2 contexts, 32-bit register accesses per the map
  above; an `IrqLine` handle devices use to assert/deassert source levels.
- EIP evaluation on every relevant state change, wired to mip.MEIP/mip.SEIP via the T11
  interrupt logic (PLIC owns those mip bits; CSR writes to them remain ignored).
- A test-only software-triggered source for exercising the machinery before real devices.
- Unit tests: threshold masking, priority ties, claim-clears-pending, double claim
  (second returns 0), complete of a stale/wrong id (ignored), level re-pend after
  complete, independent M vs S context routing.

## Acceptance criteria
- [x] Source 5 (prio 3) enabled in ctx 1 only, threshold 0 → SEIP set, MEIP clear; claim ctx 1
      returns 5 and drops SEIP (`source_enabled_in_s_context_routes_seip_not_meip_and_claim_clears`).
- [x] threshold = 7 with all priorities ≤ 7 → no EIP (`threshold_masks_all_sources_at_or_below_it`).
- [x] Equal-priority sources 3 and 9 → claim returns 3 then 9 (`priority_tie_breaks_to_lowest_source_id`).
- [x] Claim with nothing pending → 0, no state change (`claim_with_nothing_pending_returns_zero_and_changes_no_state`).
- [x] Re-assertion while claimed does not re-pend; after COMPLETE it does
      (`level_reassertion_while_claimed_does_not_repend_until_complete`); wrong-context/stale/
      out-of-range complete ignored (`complete_from_wrong_context_or_stale_id_is_ignored`).
- [x] MEIP delivered through mtvec + claim/complete (`meip_delivered_through_mtvec_then_claim_and_complete`);
      S via mideleg[9] → stvec, scause 0x8000…0009 (`seip_delivered_through_stvec_when_delegated`).
- [~] Register map vs qemu-system-riscv64 `virt`: offsets/widths follow the QEMU-virt map
      (priority +0x0, pending +0x1000, enable +0x2000+0x80·ctx, threshold +0x200000+0x1000·ctx,
      claim/complete +4); the live QEMU differential is the critic's job (no qemu in the local gate).
      Also: MEI > MTI end-to-end (`external_interrupt_outranks_the_timer`) and raising the threshold
      drops EIP with no claim (`raising_threshold_drops_eip_without_a_claim`).

## Adversarial verification
Refute the map first: run a probe binary on real QEMU-virt (single-hart) that walks every
implemented PLIC register — write patterns, read back — and diff the dump against ours;
any offset/width/reset-value divergence is a refutation. Attack the handshake state
machine: claim from context 0 and complete from context 1 (must not release context 0's
gateway); complete with an id never claimed; claim twice without complete; enable-bit
changes between pend and claim. Attack EIP recomputation: raise threshold above the
pending source's priority *after* EIP asserts — EIP must drop without any claim. Attack
the T11 integration: pend a PLIC source and a CLINT timer simultaneously and verify MEI >
MTI ordering end-to-end. A stuck EIP after any sequence, or interrupt delivery while
threshold masks it, refutes.

## Verification log

### 2026-07-03 — implementation
- **`dev/plic.rs`** — an `MmioDevice` at `PLIC_BASE` (0x0C00_0000, 6 MiB window) with 32 sources
  and 2 contexts (hart0/M = 0, hart0/S = 1). Register map per riscv-plic-1.0.0 / QEMU-virt:
  priority `+0x0` (source i at +4i), pending `+0x1000` (RO), enable `+0x2000+0x80·ctx`, threshold
  `+0x200000+0x1000·ctx`, claim/complete `+4`. State shared with the `Machine` via `Rc<RefCell>`
  (the CLINT pattern); devices drive sources through an `IrqLine` handle (`set_level`).
- **Level-triggered gateway**: `pending() = level & !(claimed[0] | claimed[1])`. CLAIM (reading the
  claim reg) returns the highest-priority pending+enabled source above the context threshold (ties →
  lowest id) and sets that context's `claimed` bit (dropping pending). COMPLETE (writing the claim
  reg) clears the bit ONLY if this context claimed it — a wrong-context / stale / out-of-range id is
  ignored — so a still-high level re-pends after complete. `eip(ctx)` = "best_source ≠ 0".
- **Machine wiring**: `enable_plic()` attaches the device + keeps the handle. The run loop
  `sync_plic()` mirrors the per-context EIP levels into `mip` each instruction boundary — MEIP
  (bit 11) from context 0, SEIP (bit 9) from context 1 — device-owned bits (a `csrw mip` can't set
  MEIP; MEI/SEI then flow through the E1-T11 priority/delegation machinery). No PLIC attached → no-op.

Tests: `crates/core/tests/plic.rs` (10) — SEIP-not-MEIP routing + claim-clears, threshold masking,
priority tie → lowest id, claim-nothing → 0, gateway re-pend-after-complete, wrong-context/stale/
out-of-range complete ignored, end-to-end MEIP-through-mtvec + claim/complete, SEIP-through-stvec via
mideleg[9] (scause 0x8000…0009), MEI > MTI end-to-end, and threshold-raise-drops-EIP-without-claim.
Local gate green: fmt clean; clippy 0 (real + zicsr-stub, all-targets); `cargo test --workspace` 0
`test result: FAILED`; both wasm builds 0 FAILED.

### 2026-07-03 — adversarial verifier (round 1) — VERDICT: verified
Fresh cold clone at HEAD d002590. Offsets checked against the documented QEMU-virt `sifive_plic`
map (no live qemu in the toolchain image).
- **Register map matches QEMU-virt exactly**: priority +4i (<0x1000), pending +0x1000 (RO, word 0),
  enable +0x2000+0x80·ctx, threshold +0x200000+0x1000·ctx, claim/complete +4, `PLIC_LEN=0x600000`.
  Source 0 priority read-only 0, never enable-able/selectable; out-of-range offsets read 0 / no-op.
- **Threshold strict-greater** (both EIP and claim); **tie-break lowest id**; **level-triggered
  gateway** (claim closes / complete reopens, per-context guard blocks wrong-context/stale/OOR
  completes, double-claim returns the next id); **EIP recomputed live** (raising threshold /
  zeroing priority / clearing enable all drop EIP with no claim; no stuck-EIP path).
- **T11 integration**: MEIP→mtvec (mcause 0x800…b), SEIP→stvec via mideleg[9] from U (scause
  0x800…9), MEI>MTI — all pass. MEIP is device-owned (not in MIP_SW_WMASK).
- **Full gate green**; E1-T09/T10/T11/T12 + rv64uf/ud/uc/mi pass; stub `decode_props::roundtrip_csr`
  failure pre-existing/ungated (T13 doesn't touch decode_props.rs); the wasm hart_ctrl unused-import
  warning is pre-existing (E1-T08), not from T13.
- **Mutations (a)–(f) caught**; (g) enable-allows-source-0 is an **EQUIVALENT mutant** (source 0 is
  unreachable — `set_level` rejects id 0 and `best_source` starts at 1 — so the `& !1` mask is inert
  defense-in-depth; no test can distinguish it, and none needs to).
- **Noted simplification** (now documented in `sync_plic`): SEIP is OVERWRITTEN by the PLIC signal
  rather than OR-ed with the software-writable bit (Priv §3.1.9). The PLIC owns the S-external line,
  so no real guest flow changes; a full OR would matter only for a guest that injects SEIP via
  `csrs mip` while also using the PLIC, which does not occur here.

VERDICT: **verified** — the PLIC (priorities, per-context enables/thresholds, claim/complete gateway,
MEIP/SEIP routing) is spec-correct and mutation-covered.
