//! Adversarial verifier's OWN attack suite for E0-T11 (fresh session, refute goal).

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
fn sd(rs2: u8, rs1: u8, imm: i32) -> u32 {
    s_type(imm, rs2, rs1, 0b011)
}
#[allow(dead_code)] // kept from the verifier's helper set for completeness
fn sw(rs2: u8, rs1: u8, imm: i32) -> u32 {
    s_type(imm, rs2, rs1, 0b010)
}
fn sb(rs2: u8, rs1: u8, imm: i32) -> u32 {
    s_type(imm, rs2, rs1, 0b000)
}
fn jal_self() -> u32 {
    0x0000_006F
}

/// Plant a program at CODE, seed x6=TOHOST, arm HTIF, PC=CODE.
fn plant(words: &[u32]) -> Machine {
    let mut m = Machine::new(64 * 1024);
    let mut at = CODE;
    for &w in words {
        m.bus_mut().store32(at, w).unwrap();
        at += 4;
    }
    m.hart_mut().regs.pc = CODE;
    m.hart_mut().regs.write(6, TOHOST);
    m.set_htif(TOHOST);
    m
}

// ── ANGLE 1: exit-code decode spread, incl. writing tohost directly ──────────
#[test]
fn exit_code_decode_spread_direct_writes() {
    // Write (code<<1)|1 directly into tohost and step a no-exit filler once so run
    // observes the change. Verify RunOutcome::Exited(code) for a spread.
    for &code in &[0u64, 42, 255, 1000, 0x7FFF_FFFF, 0xDEAD_BEEF, (1u64 << 62)] {
        let mut m = plant(&[jal_self()]);
        let tohost_val = (code << 1) | 1;
        m.bus_mut().store64(TOHOST, tohost_val).unwrap();
        // set_htif already snapshotted last_tohost=0; run sees the change on step 1.
        assert_eq!(
            m.run(5),
            RunOutcome::Exited(code),
            "code {code:#x} tohost {tohost_val:#x}"
        );
    }
}

// ── ANGLE 2: watch mechanism corner cases ────────────────────────────────────
#[test]
fn sb_odd_low_byte_exits() {
    // sb 1 -> tohost low byte => full word bit0 set => Exited(0)
    let m0 = &[addi(5, 0, 1), sb(5, 6, 0), jal_self()];
    let mut m = plant(m0);
    assert_eq!(m.run(50), RunOutcome::Exited(0));
}

#[test]
fn sb_high_byte_only_no_exit() {
    // sb 1 -> tohost+7 => word = 1<<56 (even) => command, no exit
    let mut m = plant(&[addi(5, 0, 1), sb(5, 6, 7), jal_self()]);
    assert_eq!(m.run(50), RunOutcome::MaxInstrs);
    assert_eq!(m.htif_command_count(), 1);
}

#[test]
fn even_then_same_even_counts_once() {
    // sd 8; sd 8 again (same) -> change-detection => count 1
    let mut m = plant(&[addi(5, 0, 8), sd(5, 6, 0), sd(5, 6, 0), jal_self()]);
    assert_eq!(m.run(50), RunOutcome::MaxInstrs);
    assert_eq!(
        m.htif_command_count(),
        1,
        "same even re-write must NOT re-count"
    );
}

#[test]
fn even_then_different_even_counts_twice() {
    // sd 8; sd 10 -> two distinct command values => count 2
    let mut m = plant(&[
        addi(5, 0, 8),
        sd(5, 6, 0),
        addi(5, 0, 10),
        sd(5, 6, 0),
        jal_self(),
    ]);
    assert_eq!(m.run(50), RunOutcome::MaxInstrs);
    assert_eq!(m.htif_command_count(), 2, "distinct even writes each count");
}

#[test]
fn command_then_exit_still_exits() {
    // sd 8 (command, count 1); sd 1 (exit 0). Exit wins; command counted before.
    let mut m = plant(&[
        addi(5, 0, 8),
        sd(5, 6, 0),
        addi(5, 0, 1),
        sd(5, 6, 0),
        jal_self(),
    ]);
    assert_eq!(m.run(50), RunOutcome::Exited(0));
    assert_eq!(m.htif_command_count(), 1);
}

#[test]
fn even_then_reset_to_zero_then_same_even_recounts() {
    // sd 8 (count1); sd 0 (Idle, back to zero); sd 8 again (changed from 0) => count2
    let mut m = plant(&[
        addi(5, 0, 8),
        sd(5, 6, 0),
        addi(7, 0, 0),
        sd(7, 6, 0), // write 0
        addi(5, 0, 8),
        sd(5, 6, 0),
        jal_self(),
    ]);
    assert_eq!(m.run(50), RunOutcome::MaxInstrs);
    assert_eq!(m.htif_command_count(), 2);
}

// ── ANGLE 3: run-loop off-by-one via register increment ──────────────────────
#[test]
fn run_retires_exactly_n_instructions() {
    // 4000 back-to-back `addi x1,x1,1`; after run(N), x1 == N exactly.
    for &n in &[0u64, 1, 2, 1000] {
        let prog: Vec<u32> = (0..4000).map(|_| addi(1, 1, 1)).collect();
        let mut m = Machine::new(1024 * 1024);
        let mut at = CODE;
        for &w in &prog {
            m.bus_mut().store32(at, w).unwrap();
            at += 4;
        }
        m.hart_mut().regs.pc = CODE;
        assert_eq!(m.run(n), RunOutcome::MaxInstrs);
        assert_eq!(m.hart().regs.read(1), n, "run({n}) retired {n} addis");
    }
}

// ── ANGLE 4: ECALL/EBREAK purity with verifier's own sentinels ───────────────
#[test]
fn ecall_ebreak_purity_own_sentinels() {
    for (word, cause, expect_tval_pc) in [
        (0x0000_0073u32, Exception::EcallFromM, false),
        (0x0010_0073u32, Exception::Breakpoint, true),
    ] {
        let mut m = Machine::new(64 * 1024);
        m.bus_mut().store32(CODE, word).unwrap();
        // sentinel RAM
        for i in 0..256u64 {
            m.bus_mut()
                .store8(DRAM_BASE + 0x2000 + i, (i as u8).wrapping_mul(7) ^ 0x3C)
                .unwrap();
        }
        m.hart_mut().regs.pc = CODE;
        for n in 1..32u8 {
            m.hart_mut()
                .regs
                .write(n, 0xCAFE_0000_0000_0000 | (u64::from(n) * 0x101));
        }
        let regs_before = format!("{}", m.hart().regs);
        let mut ram_before = vec![0u8; 256];
        m.bus_mut()
            .ram()
            .read_slice(DRAM_BASE + 0x2000, &mut ram_before)
            .unwrap();

        // Pure `step` (no delivery): the faulting instruction is inert — the raw trap is
        // surfaced and PC/GPRs/RAM are byte-identical. (Delivery, which moves PC and pushes
        // mstatus, is the run loop's job and is tested via the CSR state in htif_run.rs.)
        match m.step() {
            Err(t) => {
                assert_eq!(t.cause, cause);
                assert_eq!(t.tval, if expect_tval_pc { CODE } else { 0 });
            }
            Ok(()) => panic!("expected trap"),
        }
        assert_eq!(format!("{}", m.hart().regs), regs_before, "regs mutated");
        assert_eq!(m.hart().regs.pc, CODE, "PC moved");
        let mut ram_after = vec![0u8; 256];
        m.bus_mut()
            .ram()
            .read_slice(DRAM_BASE + 0x2000, &mut ram_after)
            .unwrap();
        assert_eq!(ram_before, ram_after, "RAM mutated by trap");
    }
}

// ── ANGLE 5: tohost pointing OUTSIDE ram => graceful, never exits ─────────────
#[test]
fn tohost_outside_ram_never_exits_no_panic() {
    let mut m = plant(&[jal_self()]); // valid TOHOST, but re-arm to bogus
    m.set_htif(0xFFFF_FFFF_0000_0000); // way outside 64KiB RAM
    // even if guest wrote the exit pattern somewhere, HTIF load faults => Idle
    assert_eq!(m.run(200), RunOutcome::MaxInstrs);
}

#[test]
fn exit_on_final_budgeted_instruction_is_observed() {
    // 2-instruction blob: addi x5,x0,1 ; sd x5,0(x6). The store (exit) is the
    // EXACTLY-last instruction under run(2). A correct step-then-check loop must
    // return Exited(0); a check-then-step loop misses it and returns MaxInstrs.
    let mut m = plant(&[addi(5, 0, 1), sd(5, 6, 0)]);
    assert_eq!(
        m.run(2),
        RunOutcome::Exited(0),
        "exit on last budgeted instr"
    );
}

#[test]
fn stripped_elf_loads_htif_unarmed_maxinstrs_no_panic() {
    // Symbol table stripped (llvm-strip --strip-all): no `tohost` symbol => HTIF
    // stays unarmed => the guest can only end via trap or MaxInstrs, never a panic.
    const ELF: &[u8] = include_bytes!("fixtures/stripped.elf");
    let mut m = Machine::new(64 * 1024);
    m.load_elf(ELF)
        .expect("stripped ELF still loads (segments valid)");
    // HTIF unarmed: even a self-looping guest just exhausts budget, no exit.
    assert_eq!(m.run(500), RunOutcome::MaxInstrs);
    // command count stays 0 (no watch armed).
    assert_eq!(m.htif_command_count(), 0);
}
