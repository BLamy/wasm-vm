#!/usr/bin/env python3
"""E5-T37a round-3 verifier — the two earlier verifiers' test files under the round-3 contract.

Reads evidence/e5-t37a/verifier/verifier_tests.rs and
evidence/e5-t37a/verifier-r2/verifier_r2_tests.rs and writes adapted copies to the directory
given as the first argument (r1.rs, r2.rs); with `--lint` after it the copies are also made
clippy- and rustfmt-clean for promotion (five lints in the round-2 file, no behaviour). The copies need
evidence/e5-t37a/verifier-r3/verifier_r3_tests.rs in the same module (`R3Vouch`, `r3_levels`).

What changes, and nothing else:

1. Both lockstep harnesses (`v_lockstep`, `r2_lockstep`) keep their own predicate and add the
   two conditions rounds 2 and 3 put into the contract: no enabled interrupt per the levels the
   boundary samples, the PLIC's included (`r3_levels`), and the subject's call can vouch for the
   devices (`R3Vouch`: it has sampled a block boundary at which no device had work, and nothing
   has accessed the fabric since). Round 2's own device term ("no fabric access since the last
   sampled boundary") is subsumed by that and removed with its bookkeeping.
2. `v37a_busy_lag_is_exactly_the_bound_once_and_waiting_passes_in_full` single-steps up to the
   ENTRY of the `wfi`'s block (`sd; ld; wfi`) instead of up to the `wfi` itself, so the long call
   that follows begins at a block boundary and its first `wfi` is reported — the property the
   test is about (the bound, granted once) is unchanged; the tick arithmetic covers the three
   retirements of that block.
3. The header comments say where the files live and what `_REFUTES` in a name means now.
"""
import sys

out = sys.argv[1]


def edit(src, pairs):
    for old, new in pairs:
        assert src.count(old) == 1, (old[:70], src.count(old))
        src = src.replace(old, new)
    return src


r1 = open("evidence/e5-t37a/verifier/verifier_tests.rs").read()
r1 = edit(r1, [
    (
        """// ─────────────────────────────────────────────────────────────────────────────────────────────
// E5-T37a VERIFIER tests (fresh critic session, 2026-11-26). Not the worker's: own guests, own
// host clocks, own parameters. Every test name starts `v37a_`.
//
// To build: append `include!("../../../evidence/e5-t37a/verifier/verifier_tests.rs");` to
// `crates/core/src/turbo_equivalence_tests.rs` (it uses that module's assembler and helpers),
// then `cargo test -p wasm-vm-core --lib v37a_`.
//
// Tests whose name ends `_REFUTES` assert what the task's claim needs and FAIL at head
// e4599fe73; each prints the observed numbers. The others pass at that head.
// ─────────────────────────────────────────────────────────────────────────────────────────────
""",
        """// ─────────────────────────────────────────────────────────────────────────────────────────────
// E5-T37a ROUND 1 VERIFIER tests (a fresh critic session; not the worker's): own guests, own
// host clocks, own parameters. Every test name starts `v37a_`. Promoted by the round-3 verifier
// from evidence/e5-t37a/verifier/verifier_tests.rs; this file is `include!`d by
// `turbo_equivalence_tests.rs` (it uses that module's assembler and helpers), followed by the
// round-2 and round-3 verifiers' files.
//
// A name ending `_REFUTES` marks a test that refuted the round-1 submission (it failed at head
// e4599fe73). They pass since round 2 and stay as regressions.
//
// Two things differ from the evidence copy, both because round 3 narrowed the contract to "a
// reported wait is always true; a true wait is not always reported" (see
// evidence/e5-t37a/verifier-r3/adapt-earlier-verifier-files.py): the lockstep predicate also
// requires the levels the boundary samples to be clear and the subject's call to vouch for the
// devices, and the busy-lag test starts its long call at a block boundary.
// ─────────────────────────────────────────────────────────────────────────────────────────────
""",
    ),
    (
        """/// * a call that reports a wait ended exactly on a `wfi` that `v_wfi_waits` (no early return
///   for anything else), within its budget, and the control did not pass an earlier waiting
///   `wfi` on the way (no missed return);
""",
        """/// * a call that reports a wait ended exactly on a `wfi` that `v_wfi_waits` (no early return
///   for anything else), within its budget, and the control did not pass an earlier waiting
///   `wfi` on the way (no missed return). Round 3: a waiting `wfi` has to be reported only if,
///   in addition, no enabled interrupt is pending per the levels the boundary samples
///   (`r3_levels`) and the subject's call can vouch for the devices (`R3Vouch`);
""",
    ),
    (
        """            let mut slots = 0u64;
            let mut last_waits = false;
            loop {
                let done = match wait {
                    Some(_) => control.irq_stats().retired >= target,
                    None => slots == budget || oc != RunOutcome::MaxInstrs,
                };
                if done {
                    break;
                }
                assert!(
                    !last_waits,
                    "{at} call {call}: MISSED RETURN — the control retired a waiting wfi at \\
                     retired={} and the subject ran on to {target}",
                    control.irq_stats().retired
                );
                let (wfis, mtime, accum) = (
                    control.irq_stats().wfi,
                    v_mtime(&control),
                    control.tick_accum,
                );
                oc = control.run_traced(1, &mut tc);
                slots += 1;
                tally.control_steps += 1;
                last_waits = control.irq_stats().wfi != wfis && {
                    let tick = u64::from(accum + 1 >= control.clock_div);
                    v_wfi_waits(&control, mtime + tick)
                };
            }
""",
        """            let mut slots = 0u64;
            let mut last_waits = false;
            let mut vouch = R3Vouch::default();
            loop {
                let done = match wait {
                    Some(_) => control.irq_stats().retired >= target,
                    None => slots == budget || oc != RunOutcome::MaxInstrs,
                };
                if done {
                    break;
                }
                assert!(
                    !last_waits,
                    "{at} call {call}: MISSED RETURN — the control retired a waiting wfi at \\
                     retired={} and the subject ran on to {target}",
                    control.irq_stats().retired
                );
                vouch.before_slot(&control, false);
                let (wfis, mtime, accum) = (
                    control.irq_stats().wfi,
                    v_mtime(&control),
                    control.tick_accum,
                );
                oc = control.run_traced(1, &mut tc);
                slots += 1;
                tally.control_steps += 1;
                vouch.after_slot(&control);
                last_waits = control.irq_stats().wfi != wfis && {
                    let tick = u64::from(accum + 1 >= control.clock_div);
                    v_wfi_waits(&control, mtime + tick)
                        && r3_levels(&control) & control.hart.csr.mie_bits() == 0
                        && vouch.vouches(&control)
                };
            }
""",
    ),
    (
        """        while crate::bus::Bus::load32(&mut m.bus, m.hart.regs.pc).unwrap() != WFI {
            assert_eq!(m.run(1), RunOutcome::MaxInstrs);
        }
        assert!(m.irq_stats().retired > 5_000 && m.irq_stats().wfi == 0);
        assert_eq!(host.reads.get(), 1, "{l:?}: never consulted while busy");
        host.advance(7_300_000_000);
        let (before, accum) = (v_mtime(&m), m.tick_accum);
        assert_eq!(m.run(1_000_000), RunOutcome::MaxInstrs);
        assert_eq!(m.irq_stats().wfi, 1);
        let at_wfi = before + u64::from(accum + 1 >= 3);
""",
        """        // Round 3: up to the ENTRY of the wfi's block (`sd; ld; wfi`), so that the long call
        // below begins at a block boundary and can report its first wfi.
        while crate::bus::Bus::load32(&mut m.bus, m.hart.regs.pc + 8).unwrap() != WFI {
            assert_eq!(m.run(1), RunOutcome::MaxInstrs);
        }
        assert!(resume_point(&m).is_none(), "{l:?}: at a block boundary");
        assert!(m.irq_stats().retired > 5_000 && m.irq_stats().wfi == 0);
        assert_eq!(host.reads.get(), 1, "{l:?}: never consulted while busy");
        host.advance(7_300_000_000);
        let (before, accum) = (v_mtime(&m), m.tick_accum);
        assert_eq!(m.run(1_000_000), RunOutcome::MaxInstrs);
        assert_eq!(m.irq_stats().wfi, 1);
        let at_wfi = before + (accum + 3) / 3;
""",
    ),
])
open(f"{out}/r1.rs", "w").write(r1)

r2 = open("evidence/e5-t37a/verifier-r2/verifier_r2_tests.rs").read()
r2 = edit(r2, [
    (
        """// ─────────────────────────────────────────────────────────────────────────────────────────────
// E5-T37a ROUND 2 VERIFIER tests (fresh critic session; not the worker, not the round-1
// verifier). Own guests, own host clocks, own parameters. Every test name starts `r2_`.
//
// To build: append BOTH lines to `crates/core/src/turbo_equivalence_tests.rs` (this file uses
// that module's assembler and the round-1 verifier's clock / loop-flavour helpers):
//
//   include!("../../../evidence/e5-t37a/verifier/verifier_tests.rs");
//   include!("../../../evidence/e5-t37a/verifier-r2/verifier_r2_tests.rs");
//
// then `cargo test -p wasm-vm-core --lib r2_ -- --nocapture --test-threads=1`.
//
// Tests whose name ends `_REFUTES` assert what the round-2 claim needs and FAIL at head
// d8db32db8 (crates == 215cbd1f9); each prints the observed numbers first. The others pass.
// ─────────────────────────────────────────────────────────────────────────────────────────────
""",
        """// ─────────────────────────────────────────────────────────────────────────────────────────────
// E5-T37a ROUND 2 VERIFIER tests (a fresh critic session; not the worker, not the round-1
// verifier). Own guests, own host clocks, own parameters. Every test name starts `r2_`.
// Promoted by the round-3 verifier from evidence/e5-t37a/verifier-r2/verifier_r2_tests.rs;
// `include!`d by `turbo_equivalence_tests.rs` after the round-1 verifier's file (whose clock and
// loop-flavour helpers it uses) and before the round-3 verifier's.
//
// A name ending `_REFUTES` marks a test that refuted the round-2 submission (it failed at head
// d8db32db8). They pass since round 3 and stay as regressions.
//
// One thing differs from the evidence copy (see
// evidence/e5-t37a/verifier-r3/adapt-earlier-verifier-files.py): the lockstep predicate. Round 3
// reports a wait only when the run call can vouch for the devices, so the harness's own device
// term ("no fabric access since the last sampled boundary") is replaced by `R3Vouch`, and the
// PLIC's levels are counted (`r3_levels`), as this file's author said they would have to be.
// ─────────────────────────────────────────────────────────────────────────────────────────────
""",
    ),
    (
        """/// The round-2 contract's "has to wait", from architectural state of a yield-off control and
/// one number the harness tracks itself — never from the implementation's own bookkeeping
/// (`idle_wait_deadline`, `idle_boundary_epoch`):
///
/// * no enabled interrupt pending in `mip` as last sampled;
/// * none per the levels the next boundary samples: `msip`, `mtime >= mtimecmp`, and with the
///   built-in SBI `mtime >= stimecmp`, each gated by its `mie` bit;
/// * no fabric device access since the last sampled boundary: `epoch_at_boundary` is the
///   pre-existing fabric access counter as the HARNESS read it the last time the control
///   stood at a block boundary;
/// * the nearest timer deadline that was ahead when the `wfi` retired is still ahead.
fn r2_wfi_waits(m: &Machine, mtime_at_wfi: u64, epoch_at_boundary: u64) -> bool {
""",
        """/// The round-2 contract's "has to wait", from architectural state of a yield-off control —
/// never from the implementation's own bookkeeping:
///
/// * no enabled interrupt pending in `mip` as last sampled;
/// * none per the levels the next boundary samples: `msip`, `mtime >= mtimecmp`, and with the
///   built-in SBI `mtime >= stimecmp`, each gated by its `mie` bit;
/// * the nearest timer deadline that was ahead when the `wfi` retired is still ahead.
///
/// (The device term lives in the harness since round 3: `R3Vouch`.)
fn r2_wfi_waits(m: &Machine, mtime_at_wfi: u64) -> bool {
""",
    ),
    (
        """    if m.fabric_epoch.get() != epoch_at_boundary {
        return false;
    }
    let mut nearest: Option<u64> = None;
""",
        """    let mut nearest: Option<u64> = None;
""",
    ),
    (
        """/// The round-1 verifier's lockstep (`v_lockstep`), with `r2_wfi_waits`, the harness-tracked
/// fabric epoch, and the two machines' host-clock reading counts compared after every call.
""",
        """/// The round-1 verifier's lockstep (`v_lockstep`), with `r2_wfi_waits`, the round-3 device
/// and PLIC terms (`R3Vouch`, `r3_levels`), and the two machines' host-clock reading counts
/// compared after every call.
""",
    ),
    (
        """        let mut call = 0usize;
        let mut epoch_at_boundary = control.fabric_epoch.get();
        tally.configs += 1;
""",
        """        let mut call = 0usize;
        tally.configs += 1;
""",
    ),
    (
        """            let mut last_waits = false;
            loop {
                let done = match wait {
                    Some(_) => control.irq_stats().retired >= target,
                    None => slots == budget || oc != RunOutcome::MaxInstrs,
                };
                if done {
                    break;
                }
                assert!(
                    !last_waits,
                    "{at} call {call}: MISSED RETURN — the control retired a waiting wfi at \\
                     retired={} and the subject ran on to {target}",
                    control.irq_stats().retired
                );
                if resume_point(&control).is_none() {
                    // The control's next loop iteration samples this boundary.
                    epoch_at_boundary = control.fabric_epoch.get();
                }
                let (wfis, mtime, accum) = (
                    control.irq_stats().wfi,
                    v_mtime(&control),
                    control.tick_accum,
                );
                oc = control.run_traced(1, &mut tc);
                slots += 1;
                tally.control_steps += 1;
                last_waits = control.irq_stats().wfi != wfis && {
                    let tick = u64::from(accum + 1 >= control.clock_div);
                    r2_wfi_waits(&control, mtime + tick, epoch_at_boundary)
                };
            }
""",
        """            let mut last_waits = false;
            let mut vouch = R3Vouch::default();
            loop {
                let done = match wait {
                    Some(_) => control.irq_stats().retired >= target,
                    None => slots == budget || oc != RunOutcome::MaxInstrs,
                };
                if done {
                    break;
                }
                assert!(
                    !last_waits,
                    "{at} call {call}: MISSED RETURN — the control retired a waiting wfi at \\
                     retired={} and the subject ran on to {target}",
                    control.irq_stats().retired
                );
                vouch.before_slot(&control, false);
                let (wfis, mtime, accum) = (
                    control.irq_stats().wfi,
                    v_mtime(&control),
                    control.tick_accum,
                );
                oc = control.run_traced(1, &mut tc);
                slots += 1;
                tally.control_steps += 1;
                vouch.after_slot(&control);
                last_waits = control.irq_stats().wfi != wfis && {
                    let tick = u64::from(accum + 1 >= control.clock_div);
                    r2_wfi_waits(&control, mtime + tick)
                        && r3_levels(&control) & control.hart.csr.mie_bits() == 0
                        && vouch.vouches(&control)
                };
            }
""",
    ),
])
if "--lint" in sys.argv:
    # For promotion: what `cargo clippy -p wasm-vm-core --all-targets -- -D warnings` objects to in
    # the round-2 file (five lints, no behaviour), then rustfmt on both.
    r2 = edit(r2, [
        ("    assert_eq!(c.irq_stats().wfi > 1, true);", "    assert!(c.irq_stats().wfi > 1);"),
        ("let worked = next() % 2 == 0;", "let worked = next().is_multiple_of(2);"),
        ("if next() % 97 == 0 {", "if next().is_multiple_of(97) {"),
        ("let got = if next() % 5 == 0 {", "let got = if next().is_multiple_of(5) {"),
        ("let worked = !never_works && next() % 3 == 0;",
         "let worked = !never_works && next().is_multiple_of(3);"),
    ])
open(f"{out}/r2.rs", "w").write(r2)
if "--lint" in sys.argv:
    import subprocess
    subprocess.run(["rustfmt", "--edition", "2024", f"{out}/r1.rs", f"{out}/r2.rs"], check=True)
print("wrote", f"{out}/r1.rs", f"{out}/r2.rs")
