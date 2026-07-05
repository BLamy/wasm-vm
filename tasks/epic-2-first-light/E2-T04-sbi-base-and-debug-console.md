---
id: E2-T04
epic: 2
title: SBI Base extension + DBCN debug console + legacy console putchar/getchar
priority: 204
status: verified
depends_on: [E2-T03]
estimate: M
capstone: false
---

## Goal
A spec-compliant SBI v2.0 Base extension plus the Debug Console (DBCN) and legacy console
extensions, giving the kernel its first working output channel (`earlycon=sbi`) before any
UART exists — the single most valuable debugging tool of this epic.

## Context
SBI calling convention: `ecall` from S-mode with EID in `a7`, FID in `a6`; returns error in
`a0`, value in `a1`; `a0..a5` carry arguments. Errors: `SBI_SUCCESS`=0,
`SBI_ERR_NOT_SUPPORTED`=-2, `SBI_ERR_INVALID_PARAM`=-3, `SBI_ERR_INVALID_ADDRESS`=-5.
Base (EID 0x10): `get_spec_version` (FID 0; encoding: bits 24–30 major, 0–23 minor — return
2.0), `get_impl_id` (pick and register a value; document it), `get_impl_version`,
`probe_extension` (FID 3; returns 0 in `value` for absent extensions, nonzero for present —
*not* an error), `get_mvendorid`/`get_marchid`/`get_mimpid`. DBCN (EID 0x4442434E):
`console_write` (FID 0: num_bytes, base_addr_lo, base_addr_hi — physical addresses, must be
validated against the bus), `console_read` (FID 1), `console_write_byte` (FID 2). Legacy:
EID 0x01 `console_putchar`, EID 0x02 `console_getchar` (returns -1 in `a0` when no byte;
legacy calls clobber only `a0`). Keep `CONFIG_RISCV_SBI_V01` compat in mind: Linux earlycon
`sbi` uses DBCN when probed, else legacy. Console byte sink/source goes through the same
host-console trait Epic 0 built, not directly to stdout.

## Deliverables
- `crates/core/src/sbi/{base,dbcn,legacy}.rs` wired into the E2-T03 dispatch skeleton.
- Unit tests: register-level `ecall` tests for every FID, including error paths.
- A bare-metal guest test binary that prints via DBCN and legacy paths and echoes input.

## Acceptance criteria
- [ ] `probe_extension` on Base/TIME/IPI/RFENCE/HSM/DBCN returns per plan; unknown EIDs
      (e.g., 0x0A PMU) return value 0 with SBI_SUCCESS.
- [ ] `spec_version` decodes to major 2, minor 0; reserved bit 31 is zero.
- [ ] DBCN `console_write` with a base address outside DRAM returns
      `SBI_ERR_INVALID_PARAM`/`INVALID_ADDRESS` without panicking; partial-write semantics
      (bytes written returned in `a1`) implemented.
- [ ] Linux kernel with `earlycon=sbi` produces early boot output on our emulator (may be
      verified as part of E2-T14/T15 bring-up; a bare-metal test suffices here).
- [ ] All tests green on native and `wasm32`.

## Adversarial verification
Fuzz the dispatcher: random EID/FID/arg values for 10^6 calls from a bare-metal S-mode
stub — any panic, hang, or state corruption refutes. DBCN attacks: num_bytes=0;
base+len wrapping past 2^64; buffer straddling end of DRAM; buffer pointing at MMIO — each
must return an SBI error, never fault the host. Legacy `console_getchar` with empty input
must return -1, not block. Diff behavior against OpenSBI running under
`qemu-system-riscv64 -machine virt` with the same probing stub: any divergence in error
codes or probe results that Linux could observe is a refutation.

## Verification log

### 2026-07-05 — worker — implemented

**What landed.** `crates/core/src/sbi/{mod,base,dbcn,legacy}.rs` wired into the E2-T03
dispatch: **Base** (spec_version 2.0 with bit 31 zero; impl id 0x574D "WM" documented
unregistered; impl version 0x100; probe_extension answering from the single-source
`sbi::probe()` — Base/DBCN/legacy=1, TIME/IPI/RFENCE/HSM/SRST=0 until T05/T06, PMU 0x0A=0
with SBI_SUCCESS; mvendorid/marchid/mimpid=0 matching the machine CSRs). **DBCN**
(console_write with full guest-DRAM range validation — wrap-past-2^64, straddle-end, MMIO,
below-DRAM, nonzero base_hi all → INVALID_PARAM without touching a byte; partial-count in
a1; console_read non-blocking draining the host input queue, rejected reads leave the queue
intact; console_write_byte). **Legacy** 0x01/0x02 (putchar → 0; getchar → byte or -1 in a0,
NEVER blocks; run loop writes ONLY a0 for EID<0x10 — `sbi::is_legacy`). Machine plumbing:
`sbi_set_console(Box<dyn ConsoleSink>)` (same trait as the UART stub) + `sbi_push_input`.

**Evidence:**
- Register-level unit tests for every FID incl. error paths (base 3, dbcn 3, legacy 2,
  mod 3 = 11 suites-worth in --lib sbi).
- **Charter fuzz: 10^6** deterministic-random EID/FID/arg dispatcher calls — no panic/hang,
  every error in the spec range (`dispatcher_fuzz_1e6`).
- **Bare-metal S-mode guest** (`tests/sbi_console.rs`, real ecalls through the run loop):
  prints "dbcn:" via DBCN console_write (buffer in guest DRAM), 'A' via write_byte, 'B' via
  legacy putchar, then ECHOES host-queued input 'C' read by legacy getchar → console
  captures exactly "dbcn:ABC". Second guest proves legacy clobbers ONLY a0 (a1 sentinel
  0x777 survives). Found+fixed en route: RV64 `lui` sign-extension in the hand-assembled
  payload (not a core bug — zext via slli/srli in the payload).
- earlycon=sbi kernel check: deferred to E2-T14/T15 per the acceptance note ("a bare-metal
  test suffices here").
- Gates: fmt clean; clippy --workspace --all-targets (both with and WITHOUT --all-features)
  clean; wasm32 mirror (base probe / dbcn validation / legacy semantics) 3/3.

### 2026-07-05 — verifier (cold critic) — CONFIRMED

Six angles executed, none refuted. (1) Spec sources fetched: DBCN chapter's own error table
says INVALID_PARAM for bad buffers (matches; current OpenSBI master agrees); probe/spec_version/
partial-write/getchar -1 all match the ratified text. (2) Critic's own biased fuzz: 200,000
REAL S-mode ecalls through the run loop (EIDs biased to implemented exts × adversarial args,
sink attached, input queued) with per-call invariants incl. a byte-exact console-length check —
zero violations. (3) OpenSBI differential: hand-assembled probing stub run against BOTH real
OpenSBI v1.3 (booted on this emulator) and the built-in SBI — matching on probe(DBCN)=1,
probe(PMU)=0+SUCCESS, unknown-FID=-2; divergences adjudicated: spec 2.0-vs-1.0 (version skew,
the call's purpose), DBCN MMIO/wrap acceptance (OpenSBI v1.3 root-domain catch-all ACCEPTS
hostile buffers — read our UART regs! — current OpenSBI master rejects like we do; task
charter mandates rejection), legacy getchar (UART-stub artifact, ours matches Linux's v0.1
convention). (4) a1-clobber + validation-precedes-emission audited in code AND fuzz. (5) All
gates green (full core suite zero FAILED, fmt, clippy ±all-features, wasm 3/3). (6) probe()
confirmed single-source, plan pinned by test, earlycon deferral honest.
