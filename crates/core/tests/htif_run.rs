//! E0-T11 suite: ECALL/EBREAK traps, HTIF exit convention, and the Machine run loop.

use wasm_vm_core::bus::Bus;
use wasm_vm_core::bus::mmap::DRAM_BASE;
use wasm_vm_core::hart::Exception;
use wasm_vm_core::{Machine, RunOutcome};

const CODE: u64 = DRAM_BASE;
const TOHOST: u64 = DRAM_BASE + 0x1000;

fn i_type(imm: i32, rs1: u8, f3: u32, rd: u8, op: u32) -> u32 {
    (((imm as u32) & 0xFFF) << 20) | ((rs1 as u32) << 15) | (f3 << 12) | ((rd as u32) << 7) | op
}
fn s_type(imm: i32, rs2: u8, rs1: u8, f3: u32) -> u32 {
    let iu = (imm as u32) & 0xFFF;
    ((iu >> 5) << 25)
        | ((rs2 as u32) << 20)
        | ((rs1 as u32) << 15)
        | (f3 << 12)
        | ((iu & 0x1F) << 7)
        | 0b0100011
}
fn addi(rd: u8, rs1: u8, imm: i32) -> u32 {
    i_type(imm, rs1, 0b000, rd, 0b0010011)
}
/// sd rs2, imm(rs1)
fn sd(rs2: u8, rs1: u8, imm: i32) -> u32 {
    s_type(imm, rs2, rs1, 0b011)
}

/// Machine with the exit blob planted at CODE: set t0 (x5) = `word_in_t0`, then store
/// it (width via `store`) to `tohost` addressed by x6. HTIF armed at TOHOST.
fn machine_with_blob(store: u32, t0_setup: &[u32]) -> Machine {
    let mut m = Machine::new(64 * 1024);
    // x6 = TOHOST seeded directly: TOHOST has bit 31 set, so building it with LUI
    // would sign-extend to 0xFFFFFFFF_80001000 (RV64 LUI rule) — a real crt0 uses
    // lui+addiw+shifts; the test just needs the pointer, so seed the register.
    let mut cur = CODE;
    let put = |m: &mut Machine, w: u32, at: &mut u64| {
        m.bus_mut().store32(*at, w).unwrap();
        *at += 4;
    };
    for &w in t0_setup {
        put(&mut m, w, &mut cur);
    }
    put(&mut m, store, &mut cur);
    put(&mut m, 0x0000_006F, &mut cur); // jal x0, 0 — deterministic non-exit tail
    m.hart_mut().regs.pc = CODE;
    m.hart_mut().regs.write(6, TOHOST);
    m.set_htif(TOHOST);
    m
}

// ── HTIF exit ───────────────────────────────────────────────────────────────

#[test]
fn exit_0_via_sd_of_one_acceptance() {
    // li t0, 1 ; sd t0, 0(x6)  → tohost = 1 = (0<<1)|1 → Exited(0)
    let m_setup = [addi(5, 0, 1)];
    let mut m = machine_with_blob(sd(5, 6, 0), &m_setup);
    assert_eq!(m.run(1000), RunOutcome::Exited(0));
}

#[test]
fn exit_42_acceptance() {
    // tohost = (42 << 1) | 1 = 85. Build 85 in t0 then sd.
    let mut m = machine_with_blob(sd(5, 6, 0), &[addi(5, 0, 85)]);
    assert_eq!(m.run(1000), RunOutcome::Exited(42));
}

#[test]
fn sw_of_odd_value_exits_sd_of_even_logs_once_acceptance() {
    // 32-bit sw of an odd value into the low word triggers exit (full-word read).
    let sw = s_type(0, 5, 6, 0b010);
    let mut m = machine_with_blob(sw, &[addi(5, 0, 1)]);
    assert_eq!(m.run(1000), RunOutcome::Exited(0));

    // sd of an EVEN non-zero value: no exit, logged once, run hits MaxInstrs.
    let mut m = machine_with_blob(sd(5, 6, 0), &[addi(5, 0, 8)]); // 8 is even
    assert_eq!(m.run(200), RunOutcome::MaxInstrs);
    assert_eq!(
        m.htif_command_count(),
        1,
        "even value must be logged exactly once"
    );
}

#[test]
fn store_to_tohost_plus_4_only_does_not_exit() {
    // Writing only tohost+4 (the HIGH word) leaves bit 0 (low word) clear → no exit.
    // t0 = 1, sd t0, 4(x6): lands at TOHOST+4..+12; but that straddles... use sw at +4.
    let sw_hi = s_type(4, 5, 6, 0b010); // sw t0, 4(x6) → writes [TOHOST+4, +8)
    let mut m = machine_with_blob(sw_hi, &[addi(5, 0, 1)]);
    // The doubleword's low word stays 0 → bit 0 clear → non-zero command, not exit.
    let out = m.run(200);
    assert_eq!(
        out,
        RunOutcome::MaxInstrs,
        "only high word written: must not exit"
    );
}

// ── ECALL / EBREAK ──────────────────────────────────────────────────────────

#[test]
fn ecall_traps_cause_11_ebreak_cause_3_acceptance() {
    let mut m = Machine::new(64 * 1024);
    m.bus_mut().store32(CODE, 0x0000_0073).unwrap(); // ecall
    m.hart_mut().regs.pc = CODE;
    let out = m.run(10);
    match out {
        RunOutcome::Trapped(t) => {
            assert_eq!(t.cause, Exception::EcallFromM);
            assert_eq!(t.tval, 0);
        }
        other => panic!("expected ECALL trap, got {other:?}"),
    }
    assert_eq!(m.hart().regs.pc, CODE, "PC left at the ECALL");

    let mut m = Machine::new(64 * 1024);
    m.bus_mut().store32(CODE, 0x0010_0073).unwrap(); // ebreak
    m.hart_mut().regs.pc = CODE;
    match m.run(10) {
        RunOutcome::Trapped(t) => {
            assert_eq!(t.cause, Exception::Breakpoint);
            assert_eq!(t.tval, CODE, "EBREAK tval = pc");
        }
        other => panic!("expected EBREAK trap, got {other:?}"),
    }
}

#[test]
fn ebreak_purity_full_dump_and_ram_identical() {
    let mut m = Machine::new(64 * 1024);
    for i in 0..64u64 {
        m.bus_mut()
            .store8(DRAM_BASE + 0x800 + i, (i as u8) ^ 0x5A)
            .unwrap();
    }
    m.bus_mut().store32(CODE, 0x0010_0073).unwrap();
    m.hart_mut().regs.pc = CODE;
    for n in 1..32u8 {
        m.hart_mut()
            .regs
            .write(n, 0xB0DE_0000_0000_0000 | u64::from(n));
    }
    let regs_before = format!("{}", m.hart().regs);
    let mut ram_before = vec![0u8; 4096];
    m.bus_mut()
        .ram()
        .read_slice(DRAM_BASE + 0x800, &mut ram_before[..64])
        .unwrap();

    let _ = m.run(1);

    assert_eq!(
        format!("{}", m.hart().regs),
        regs_before,
        "EBREAK mutated registers"
    );
    let mut ram_after = vec![0u8; 4096];
    m.bus_mut()
        .ram()
        .read_slice(DRAM_BASE + 0x800, &mut ram_after[..64])
        .unwrap();
    assert_eq!(ram_before, ram_after, "EBREAK mutated RAM");
}

// ── run-loop accounting ─────────────────────────────────────────────────────

#[test]
fn max_instrs_off_by_one_exact_count() {
    // A pure self-loop never exits; run(N) must stop at exactly N retirements.
    let mut m = Machine::new(64 * 1024);
    m.bus_mut().store32(CODE, 0x0000_006F).unwrap(); // jal x0, 0 (infinite loop)
    m.hart_mut().regs.pc = CODE;
    assert_eq!(m.run(0), RunOutcome::MaxInstrs, "budget 0 runs nothing");
    assert_eq!(m.hart().regs.pc, CODE);
    assert_eq!(m.run(1000), RunOutcome::MaxInstrs);
}

#[test]
fn no_tohost_symbol_runs_to_max_instrs_not_crash() {
    // No HTIF armed: an infinite loop just exhausts the budget.
    let mut m = Machine::new(64 * 1024);
    m.bus_mut().store32(CODE, 0x0000_006F).unwrap();
    m.hart_mut().regs.pc = CODE;
    assert_eq!(m.run(500), RunOutcome::MaxInstrs);
}

#[test]
fn loads_elf_fixture_and_arms_htif() {
    // The E0-T10 fixture has tohost/fromhost symbols; loading arms HTIF.
    const ELF: &[u8] = include_bytes!("fixtures/minimal.elf");
    let mut m = Machine::new(64 * 1024);
    m.load_elf(ELF).unwrap();
    assert_eq!(m.hart().regs.pc, 0x8000_0000, "PC set to e_entry");
    // The fixture loops forever (jal 1b) with tohost=0 → MaxInstrs, no exit, no panic.
    assert_eq!(m.run(100), RunOutcome::MaxInstrs);
}

#[test]
fn exit_at_index_0_under_run_1_is_observed() {
    // Residual pin (E0-T11 re-verification, mutant N2): a single store that exits
    // and IS instruction 0 must be seen under run(1). Guards against a mutant that
    // skips the HTIF check on the first loop iteration.
    let sd_to_tohost = s_type(0, 5, 6, 0b011); // sd x5, 0(x6)
    let mut m = Machine::new(64 * 1024);
    m.bus_mut().store32(CODE, sd_to_tohost).unwrap();
    m.hart_mut().regs.pc = CODE;
    m.hart_mut().regs.write(5, 1); // (0 << 1) | 1 → exit 0
    m.hart_mut().regs.write(6, TOHOST);
    m.set_htif(TOHOST);
    assert_eq!(
        m.run(1),
        RunOutcome::Exited(0),
        "exit on the first (index-0) instruction"
    );
}
