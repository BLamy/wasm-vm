//! E5.5-T03b: integer JIT regions remain eligible on either side of interpreted F/D regions.

use jit_runtime::WasmtimeExecutor;
use wasm_vm_core::bus::Bus;
use wasm_vm_core::bus::mmap::DRAM_BASE;
use wasm_vm_core::csr::{CsrOp, MEPC, MIE, MSTATUS, MTVEC};
use wasm_vm_core::dispatch::MAX_BLOCK_OPS;
use wasm_vm_core::hart::Exception;
use wasm_vm_core::{Machine, RunOutcome};

const OP_FP: u32 = 0b1010011;
// Ordinary misaligned RAM accesses are intentionally supported by the core's E1-T26 policy;
// these FP fault tests therefore use an unmapped, access-faulting address instead.
const FAULT_ADDR: u64 = 0x5000_0000;

fn enc_addi(rd: u32, rs1: u32, imm: i32) -> u32 {
    ((imm as u32) << 20) | (rs1 << 15) | (rd << 7) | 0b0010011
}

fn enc_bne(rs1: u32, rs2: u32, off: i32) -> u32 {
    let o = off as u32;
    ((o >> 12) & 1) << 31
        | ((o >> 5) & 0x3f) << 25
        | (rs2 << 20)
        | (rs1 << 15)
        | (0b001 << 12)
        | ((o >> 1) & 0xf) << 8
        | ((o >> 11) & 1) << 7
        | 0b1100011
}

fn enc_sw(rs2: u32, rs1: u32, imm: i32) -> u32 {
    let o = imm as u32;
    ((o >> 5) & 0x7f) << 25
        | (rs2 << 20)
        | (rs1 << 15)
        | (0b010 << 12)
        | (o & 0x1f) << 7
        | 0b0100011
}

fn enc_fp(funct7: u32, rm: u32, rd: u32, rs1: u32, rs2: u32) -> u32 {
    (funct7 << 25) | (rs2 << 20) | (rs1 << 15) | (rm << 12) | (rd << 7) | OP_FP
}

fn enc_fld(rd: u32, rs1: u32, imm: i32) -> u32 {
    ((imm as u32) << 20) | (rs1 << 15) | (0b011 << 12) | (rd << 7) | 0b0000111
}

fn enc_fsd(rs2: u32, rs1: u32, imm: i32) -> u32 {
    let o = imm as u32;
    ((o >> 5) & 0x7f) << 25
        | (rs2 << 20)
        | (rs1 << 15)
        | (0b011 << 12)
        | (o & 0x1f) << 7
        | 0b0100111
}

fn emit16(m: &mut Machine, offset: u64, parcel: u16) {
    m.bus_mut()
        .store16(DRAM_BASE + offset, parcel)
        .expect("instruction parcel fits in RAM");
}

fn emit32(m: &mut Machine, offset: u64, word: u32) {
    emit16(m, offset, word as u16);
    emit16(m, offset + 2, (word >> 16) as u16);
}

fn mixed_program(m: &mut Machine) {
    // 0: c.nop
    // 2: addi x1,x1,1       integer prefix
    // 6: addi x2,x2,2       integer prefix
    // 10: fadd.s f3,f1,f2   interpreted FP (also exercises NaN-boxing)
    // 14: fadd.d f6,f4,f5   interpreted FP
    // 18: fdiv.s f10,f9,f8  interpreted FP (1/3 raises NX)
    // 22: c.nop
    // 24: addi x3,x3,3      integer continuation
    // 28: addi x4,x4,4      integer continuation
    // 32: sw x3,0(x6)       integer continuation + memory
    // 36: bne x1,x5,-36     architectural terminator back to 0
    // 40: jal x0,0          bounded-run tail
    emit16(m, 0, 0x0001); // C.NOP
    emit32(m, 2, enc_addi(1, 1, 1));
    emit32(m, 6, enc_addi(2, 2, 2));
    emit32(m, 10, enc_fp(0b0000000, 0, 3, 1, 2)); // FADD.S
    emit32(m, 14, enc_fp(0b0000001, 0, 6, 4, 5)); // FADD.D
    emit32(m, 18, enc_fp(0b0001100, 0, 10, 9, 8)); // FDIV.S
    emit16(m, 22, 0x0001); // C.NOP
    emit32(m, 24, enc_addi(3, 3, 3));
    emit32(m, 28, enc_addi(4, 4, 4));
    emit32(m, 32, enc_sw(3, 6, 0));
    emit32(m, 36, enc_bne(1, 5, -36));
    emit32(m, 40, 0x0000_006f); // JAL x0,0

    let h = m.hart_mut();
    h.regs.pc = DRAM_BASE;
    h.regs.write(5, 40); // loop count
    h.regs.write(6, DRAM_BASE + 0x2000);
    h.fregs.write_raw(1, 0x3ff0_0000_0000_0000); // deliberately unboxed f32 operand
    h.fregs.write_f32(2, 0x3f80_0000); // 1.0f32
    h.fregs.write_raw(4, 0x3ff8_0000_0000_0000); // 1.5f64
    h.fregs.write_raw(5, 0x4002_0000_0000_0000); // 2.25f64
    h.fregs.write_f32(8, 0x4040_0000); // 3.0f32
    h.fregs.write_f32(9, 0x3f80_0000); // 1.0f32
    h.csr.mstatus |= 1 << 13; // FS = Initial
}

fn compressed_fp_program(m: &mut Machine) {
    // 0: addi x1,x1,1       integer prefix
    // 4: c.fld f8,0(x8)     interpreted FP
    // 6: c.fsd f8,0(x8)     interpreted FP
    // 8: addi x2,x2,1       integer continuation
    // 12: bne x1,x5,-12     architectural terminator back to 0
    // 16: jal x0,0
    emit32(m, 0, enc_addi(1, 1, 1));
    emit16(m, 4, 0x2000); // C.FLD f8, 0(x8)
    emit16(m, 6, 0xa000); // C.FSD f8, 0(x8)
    emit32(m, 8, enc_addi(2, 2, 1));
    emit32(m, 12, enc_bne(1, 5, -12));
    emit32(m, 16, 0x0000_006f);
    m.bus_mut()
        .store64(DRAM_BASE + 0x2000, 0x400c_0000_0000_0000)
        .expect("FP data fits in RAM");

    let h = m.hart_mut();
    h.regs.pc = DRAM_BASE;
    h.regs.write(5, 40);
    h.regs.write(8, DRAM_BASE + 0x2000);
    h.csr.mstatus |= 1 << 13; // FS = Initial
}

fn mid_region_program(m: &mut Machine) {
    // Entry is deliberately at +4, in the middle of the surrounding integer stream.
    // 0: addi x1,x1,99      not executed
    // 4: addi x2,x2,1       integer region entered in the middle
    // 8: addi x3,x3,1       same integer region
    // 12: fadd.s f6,f1,f2   interpreted FP
    // 16: addi x4,x4,1      integer continuation
    // 20: bne x2,x5,-16     architectural terminator back to +4
    // 24: jal x0,0
    emit32(m, 0, enc_addi(1, 1, 99));
    emit32(m, 4, enc_addi(2, 2, 1));
    emit32(m, 8, enc_addi(3, 3, 1));
    emit32(m, 12, enc_fp(0, 0, 6, 1, 2)); // FADD.S
    emit32(m, 16, enc_addi(4, 4, 1));
    emit32(m, 20, enc_bne(2, 5, -16));
    emit32(m, 24, 0x0000_006f);

    let h = m.hart_mut();
    h.regs.pc = DRAM_BASE + 4;
    h.regs.write(5, 40);
    h.fregs.write_f32(1, 0x3f80_0000);
    h.fregs.write_f32(2, 0x4000_0000);
    h.csr.mstatus |= 1 << 13; // FS = Initial
}

fn alternating_regions_program(m: &mut Machine) {
    // 0: c.nop
    // 2: addi x1,x1,1       integer region A
    // 6: fadd.s f3,f1,f2   FP region A
    // 10: addi x2,x2,1      integer region B
    // 14: fadd.d f6,f4,f5   FP region B
    // 18: addi x3,x3,1      integer region C
    // 22: bne x1,x5,-22     terminator back to 0
    // 26: jal x0,0
    emit16(m, 0, 0x0001);
    emit32(m, 2, enc_addi(1, 1, 1));
    emit32(m, 6, enc_fp(0, 0, 3, 1, 2)); // FADD.S
    emit32(m, 10, enc_addi(2, 2, 1));
    emit32(m, 14, enc_fp(1, 0, 6, 4, 5)); // FADD.D
    emit32(m, 18, enc_addi(3, 3, 1));
    emit32(m, 22, enc_bne(1, 5, -22));
    emit32(m, 26, 0x0000_006f);

    let h = m.hart_mut();
    h.regs.pc = DRAM_BASE;
    h.regs.write(5, 50);
    h.fregs.write_f32(1, 0x3f80_0000);
    h.fregs.write_f32(2, 0x4000_0000);
    h.fregs.write_raw(4, 0x3ff0_0000_0000_0000);
    h.fregs.write_raw(5, 0x4000_0000_0000_0000);
    h.csr.mstatus |= 1 << 13; // FS = Initial
}

fn page_edge_program(m: &mut Machine) -> u64 {
    let edge = DRAM_BASE + 0x0ff8;
    // The FP instruction occupies the final four bytes of the page. Its integer neighbors must
    // be separate cache entries both because of the FP boundary and because of the page edge.
    emit32(m, 0x0ff8, enc_addi(1, 1, 1));
    emit32(m, 0x0ffc, enc_fp(0, 0, 3, 1, 2)); // FADD.S at the page edge
    emit32(m, 0x1000, enc_addi(2, 2, 1));
    emit32(m, 0x1004, enc_bne(1, 5, -12));
    emit32(m, 0x1008, 0x0000_006f);

    let h = m.hart_mut();
    h.regs.pc = edge;
    h.regs.write(5, 40);
    h.fregs.write_f32(1, 0x3f80_0000);
    h.fregs.write_f32(2, 0x4000_0000);
    h.csr.mstatus |= 1 << 13; // FS = Initial
    edge
}

#[derive(Debug, PartialEq, Eq)]
struct Snapshot {
    x: [u64; 32],
    f: [u64; 32],
    fcsr: u16,
    pc: u64,
    memory: u32,
    retired: u64,
}

fn snapshot(m: &mut Machine) -> Snapshot {
    let h = m.hart();
    let mut x = [0; 32];
    let mut f = [0; 32];
    for i in 0..32u8 {
        x[i as usize] = h.regs.read(i);
        f[i as usize] = h.fregs.read_raw(i);
    }
    Snapshot {
        x,
        f,
        fcsr: ((u16::from(h.csr.frm)) << 5) | u16::from(h.csr.fflags),
        pc: h.regs.pc,
        memory: m
            .bus_mut()
            .load32(DRAM_BASE + 0x2000)
            .expect("result data fits in RAM"),
        retired: m.irq_stats().retired,
    }
}

fn configure_jit(m: &mut Machine) {
    m.set_executor(Box::new(WasmtimeExecutor::new()));
    m.set_block_cache(true);
    m.set_interrupt_batching(true);
    m.set_hotness_threshold(1);
    m.set_jit(true);
}

fn set_csr(m: &mut Machine, addr: u16, op: CsrOp, value: u64) {
    m.hart_mut()
        .csr
        .access(addr, op, value, false, false, 0)
        .expect("test CSR write is legal");
}

#[test]
fn mixed_f_d_c_regions_match_and_execute_integer_jit() {
    let mut interp = Machine::new(8 * 1024 * 1024);
    mixed_program(&mut interp);
    assert_eq!(interp.run(500), RunOutcome::MaxInstrs);
    let want = snapshot(&mut interp);

    let mut jit = Machine::new(8 * 1024 * 1024);
    mixed_program(&mut jit);
    configure_jit(&mut jit);
    assert_eq!(jit.run(500), RunOutcome::MaxInstrs);
    let got = snapshot(&mut jit);
    let exec = jit.take_executor().expect("JIT executor installed");

    assert_eq!(got, want, "mixed F/D/C JIT run diverged from interpreter");
    assert_eq!(
        got.f[3], 0xffff_ffff_7fc0_0000,
        "f32 result must be NaN-boxed"
    );
    assert_ne!(got.fcsr & 0x01, 0, "FDIV.S must preserve NX in fcsr");
    assert!(
        exec.compiled_count() >= 2,
        "both integer regions must compile"
    );
    assert!(
        exec.is_compiled(DRAM_BASE),
        "integer prefix must be JIT-eligible"
    );
    assert!(
        exec.is_compiled(DRAM_BASE + 22),
        "integer continuation must be JIT-eligible"
    );
    assert!(
        !exec.is_compiled(DRAM_BASE + 10),
        "FP region must remain interpreter-only"
    );
    assert!(
        exec.retired_via_jit() > 0,
        "mixed loop must retire integer instructions through the JIT"
    );
}

#[test]
fn compressed_fp_load_store_keeps_both_integer_handoffs_jitted() {
    let mut interp = Machine::new(8 * 1024 * 1024);
    compressed_fp_program(&mut interp);
    assert_eq!(interp.run(240), RunOutcome::MaxInstrs);
    let want = snapshot(&mut interp);

    let mut jit = Machine::new(8 * 1024 * 1024);
    compressed_fp_program(&mut jit);
    configure_jit(&mut jit);
    assert_eq!(jit.run(240), RunOutcome::MaxInstrs);
    let got = snapshot(&mut jit);
    let exec = jit.take_executor().expect("JIT executor installed");

    assert_eq!(got, want, "compressed FP load/store changed machine state");
    assert_eq!(got.f[8], 0x400c_0000_0000_0000);
    assert!(exec.is_compiled(DRAM_BASE), "integer prefix must compile");
    assert!(
        exec.is_compiled(DRAM_BASE + 8),
        "integer continuation must compile"
    );
    assert!(
        !exec.is_compiled(DRAM_BASE + 4),
        "compressed FP load/store region must remain interpreter-only"
    );
    assert!(
        exec.retired_via_jit() > 0,
        "compressed FP handoffs must actually retire through the JIT"
    );
}

#[test]
fn alternating_fp_integer_regions_keep_each_integer_region_jitted() {
    let mut interp = Machine::new(8 * 1024 * 1024);
    alternating_regions_program(&mut interp);
    assert_eq!(interp.run(350), RunOutcome::MaxInstrs);
    let want = snapshot(&mut interp);

    let mut jit = Machine::new(8 * 1024 * 1024);
    alternating_regions_program(&mut jit);
    configure_jit(&mut jit);
    assert_eq!(jit.run(350), RunOutcome::MaxInstrs);
    let got = snapshot(&mut jit);
    let exec = jit.take_executor().expect("JIT executor installed");

    assert_eq!(got, want, "alternating FP/integer regions diverged");
    for (offset, label) in [(0, "integer A"), (10, "integer B"), (18, "integer C")] {
        assert!(
            exec.is_compiled(DRAM_BASE + offset),
            "{label} must be compiled"
        );
    }
    for (offset, label) in [(6, "FP A"), (14, "FP B")] {
        assert!(
            !exec.is_compiled(DRAM_BASE + offset),
            "{label} must remain interpreter-only"
        );
    }
    assert!(
        exec.retired_via_jit() > 0,
        "alternating handoffs must actually retire through the JIT"
    );
}

#[test]
fn entry_mid_integer_region_still_hands_off_to_jit() {
    let mut interp = Machine::new(8 * 1024 * 1024);
    mid_region_program(&mut interp);
    assert_eq!(interp.run(240), RunOutcome::MaxInstrs);
    let want = snapshot(&mut interp);

    let mut jit = Machine::new(8 * 1024 * 1024);
    mid_region_program(&mut jit);
    configure_jit(&mut jit);
    assert_eq!(jit.run(240), RunOutcome::MaxInstrs);
    let got = snapshot(&mut jit);
    let exec = jit.take_executor().expect("JIT executor installed");

    assert_eq!(got, want, "mid-region entry diverged from interpreter");
    assert_eq!(got.x[1], 0, "instruction before the entry must not execute");
    assert!(exec.is_compiled(DRAM_BASE + 4));
    assert!(exec.is_compiled(DRAM_BASE + 16));
    assert!(!exec.is_compiled(DRAM_BASE + 12));
    assert!(
        exec.retired_via_jit() > 0,
        "mid-region handoff must actually retire through the JIT"
    );
}

#[test]
fn page_edge_fp_region_preserves_integer_jit_handoffs() {
    let mut interp = Machine::new(8 * 1024 * 1024);
    let edge = page_edge_program(&mut interp);
    assert_eq!(interp.run(220), RunOutcome::MaxInstrs);
    let want = snapshot(&mut interp);

    let mut jit = Machine::new(8 * 1024 * 1024);
    page_edge_program(&mut jit);
    configure_jit(&mut jit);
    assert_eq!(jit.run(220), RunOutcome::MaxInstrs);
    let got = snapshot(&mut jit);
    let exec = jit.take_executor().expect("JIT executor installed");

    assert_eq!(got, want, "page-edge mixed region diverged");
    assert!(
        exec.is_compiled(edge),
        "page-edge integer prefix must compile"
    );
    assert!(
        exec.is_compiled(edge + 8),
        "page-one integer continuation must compile"
    );
    assert!(!exec.is_compiled(edge + 4), "page-edge FP must not compile");
    assert!(
        exec.retired_via_jit() > 0,
        "page-edge handoff must actually retire through the JIT"
    );
}

#[test]
fn fp_fault_after_compiled_integer_prefix_keeps_precise_pc() {
    let base = DRAM_BASE;
    let load = |m: &mut Machine| {
        emit32(m, 0, enc_addi(1, 1, 1));
        emit32(m, 4, enc_bne(1, 5, -4));
        emit32(m, 8, enc_fp(0, 0, 3, 1, 1)); // FS=Off: precise fault
        emit32(m, 12, 0x0000_006f);
        m.hart_mut().regs.pc = base;
        m.hart_mut().regs.write(5, 100);
    };

    let mut interp = Machine::new(8 * 1024 * 1024);
    load(&mut interp);
    let interp_trap = match interp.run(205) {
        RunOutcome::Trapped(trap) => trap,
        other => panic!("interpreter expected FP trap, got {other:?}"),
    };

    let mut jit = Machine::new(8 * 1024 * 1024);
    load(&mut jit);
    configure_jit(&mut jit);
    let jit_trap = match jit.run(205) {
        RunOutcome::Trapped(trap) => trap,
        other => panic!("JIT expected FP trap, got {other:?}"),
    };
    let exec = jit.take_executor().expect("JIT executor installed");

    assert_eq!(interp_trap.cause, Exception::IllegalInstruction);
    assert_eq!(jit_trap.cause, interp_trap.cause);
    assert_eq!(jit_trap.tval, interp_trap.tval);
    assert_eq!(interp.hart().regs.pc, base + 8);
    assert_eq!(jit.hart().regs.pc, base + 8);
    assert_eq!(interp.hart().regs.read(1), 100);
    assert_eq!(jit.hart().regs.read(1), 100);
    assert_eq!(interp.irq_stats().retired, 200);
    assert_eq!(jit.irq_stats().retired, 200);
    assert!(exec.is_compiled(base));
    assert!(!exec.is_compiled(base + 8));
    assert!(
        exec.retired_via_jit() > 0,
        "the integer prefix must actually retire through the JIT before the FP fault"
    );
}

#[test]
fn mixed_smc_recompiles_integer_continuation_after_fp_handoff() {
    let run_reference = || {
        let mut m = Machine::new(8 * 1024 * 1024);
        mixed_program(&mut m);
        assert_eq!(m.run(500), RunOutcome::MaxInstrs);
        m.bus_mut()
            .store32(DRAM_BASE + 24, enc_addi(3, 3, 7))
            .unwrap();
        m.hart_mut().regs.pc = DRAM_BASE + 40;
        assert_eq!(m.run(2), RunOutcome::MaxInstrs); // match the JIT's code-write drain
        let h = m.hart_mut();
        h.regs.write(1, 0);
        h.regs.write(2, 0);
        h.regs.write(3, 0);
        h.regs.write(4, 0);
        h.regs.write(5, 20);
        h.regs.pc = DRAM_BASE;
        assert_eq!(m.run(250), RunOutcome::MaxInstrs);
        snapshot(&mut m)
    };

    let want = run_reference();
    let mut jit = Machine::new(8 * 1024 * 1024);
    mixed_program(&mut jit);
    configure_jit(&mut jit);
    assert_eq!(jit.run(500), RunOutcome::MaxInstrs);
    let jit_before = jit.executor().unwrap().retired_via_jit();
    assert!(
        jit_before > 0,
        "initial mixed run must retire through the JIT"
    );
    jit.bus_mut()
        .store32(DRAM_BASE + 24, enc_addi(3, 3, 7))
        .unwrap();
    jit.hart_mut().regs.pc = DRAM_BASE + 40;
    assert_eq!(jit.run(2), RunOutcome::MaxInstrs); // drain the code-write log
    assert!(!jit.executor().unwrap().is_compiled(DRAM_BASE + 22));

    let h = jit.hart_mut();
    h.regs.write(1, 0);
    h.regs.write(2, 0);
    h.regs.write(3, 0);
    h.regs.write(4, 0);
    h.regs.write(5, 20);
    h.regs.pc = DRAM_BASE;
    assert_eq!(jit.run(250), RunOutcome::MaxInstrs);
    let got = snapshot(&mut jit);
    let exec = jit.take_executor().expect("JIT executor installed");

    assert_eq!(got, want, "SMC mixed-region run diverged from interpreter");
    assert!(exec.is_compiled(DRAM_BASE + 22));
    assert!(
        exec.retired_via_jit() > jit_before,
        "recompiled continuation must actually retire through the JIT"
    );
}

#[test]
fn tiny_cache_mixed_regions_are_deterministic_and_jitted() {
    let run = || {
        let mut m = Machine::new(8 * 1024 * 1024);
        mixed_program(&mut m);
        configure_jit(&mut m);
        m.set_block_cache_capacity(1);
        assert_eq!(m.run(500), RunOutcome::MaxInstrs);
        let state = snapshot(&mut m);
        let exec = m.take_executor().expect("JIT executor installed");
        (
            state,
            exec.compiled_count(),
            exec.executed_blocks(),
            exec.retired_via_jit(),
        )
    };

    let first = run();
    let second = run();
    assert_eq!(first, second, "tiny-cache mixed run must be deterministic");
    assert!(first.1 > 0, "tiny-cache run must compile integer regions");
    assert!(first.2 > 0, "tiny-cache run must execute compiled regions");
    assert!(first.3 > 0, "tiny-cache run must retire through the JIT");
}

#[test]
fn fp_off_trap_preserves_integer_prefix_and_pc() {
    let mut interp = Machine::new(8 * 1024 * 1024);
    emit16(&mut interp, 0, 0x0001); // C.NOP
    emit32(&mut interp, 2, enc_addi(1, 0, 7));
    emit32(&mut interp, 6, enc_fp(0, 0, 3, 1, 1)); // FADD.S, FS=Off
    interp.hart_mut().regs.pc = DRAM_BASE;
    let interp_outcome = interp.run(8);
    let interp_trap = match interp_outcome {
        RunOutcome::Trapped(trap) => trap,
        other => panic!("interpreter expected FP-off trap, got {other:?}"),
    };

    let mut jit = Machine::new(8 * 1024 * 1024);
    emit16(&mut jit, 0, 0x0001);
    emit32(&mut jit, 2, enc_addi(1, 0, 7));
    emit32(&mut jit, 6, enc_fp(0, 0, 3, 1, 1));
    jit.hart_mut().regs.pc = DRAM_BASE;
    configure_jit(&mut jit);
    let jit_outcome = jit.run(8);
    let jit_trap = match jit_outcome {
        RunOutcome::Trapped(trap) => trap,
        other => panic!("JIT expected FP-off trap, got {other:?}"),
    };

    assert_eq!(interp_trap.cause, Exception::IllegalInstruction);
    assert_eq!(jit_trap.cause, interp_trap.cause);
    assert_eq!(jit_trap.tval, interp_trap.tval);
    assert_eq!(interp.hart().regs.pc, DRAM_BASE + 6);
    assert_eq!(jit.hart().regs.pc, DRAM_BASE + 6);
    assert_eq!(interp.hart().regs.read(1), 7);
    assert_eq!(jit.hart().regs.read(1), 7);
    assert_eq!(interp.irq_stats().retired, 2);
    assert_eq!(jit.irq_stats().retired, 2);
    assert_eq!(jit.hart().csr.fflags, 0);
}

#[test]
fn fp_load_access_fault_after_jitted_integer_prefix_is_precise() {
    let load = |m: &mut Machine| {
        emit32(m, 0, enc_addi(1, 1, 1));
        emit32(m, 4, enc_bne(1, 5, -4));
        emit32(m, 8, enc_fld(3, 6, 0)); // FP load access fault
        emit32(m, 12, 0x0000_006f);
        let h = m.hart_mut();
        h.regs.pc = DRAM_BASE;
        h.regs.write(5, 100);
        h.regs.write(6, FAULT_ADDR);
        h.csr.mstatus |= 1 << 13; // FS = Initial
    };

    let mut interp = Machine::new(8 * 1024 * 1024);
    load(&mut interp);
    let interp_trap = match interp.run(205) {
        RunOutcome::Trapped(trap) => trap,
        other => panic!("interpreter expected FP load trap, got {other:?}"),
    };
    let interp_state = snapshot(&mut interp);

    let mut jit = Machine::new(8 * 1024 * 1024);
    load(&mut jit);
    configure_jit(&mut jit);
    let jit_trap = match jit.run(205) {
        RunOutcome::Trapped(trap) => trap,
        other => panic!("JIT expected FP load trap, got {other:?}"),
    };
    let jit_state = snapshot(&mut jit);
    let exec = jit.take_executor().expect("JIT executor installed");

    assert_eq!(interp_trap.cause, Exception::LoadAccessFault);
    assert_eq!(interp_trap.tval, FAULT_ADDR);
    assert_eq!(jit_trap.cause, interp_trap.cause);
    assert_eq!(jit_trap.tval, interp_trap.tval);
    assert_eq!(jit_state, interp_state, "FP load fault state diverged");
    assert_eq!(jit_state.pc, DRAM_BASE + 8);
    assert_eq!(jit_state.retired, 200);
    assert!(exec.is_compiled(DRAM_BASE));
    assert!(!exec.is_compiled(DRAM_BASE + 8));
    assert!(
        exec.retired_via_jit() > 0,
        "the integer prefix must actually retire through JIT before the FP fault"
    );
}

#[test]
fn fp_store_access_fault_after_jitted_integer_prefix_is_precise() {
    let store = |m: &mut Machine| {
        emit32(m, 0, enc_addi(1, 1, 1));
        emit32(m, 4, enc_bne(1, 5, -4));
        emit32(m, 8, enc_fsd(3, 6, 0)); // FP store access fault
        emit32(m, 12, 0x0000_006f);
        let h = m.hart_mut();
        h.regs.pc = DRAM_BASE;
        h.regs.write(5, 100);
        h.regs.write(6, FAULT_ADDR);
        h.fregs.write_raw(3, 0x4008_0000_0000_0000);
        h.csr.mstatus |= 1 << 13; // FS = Initial
    };

    let mut interp = Machine::new(8 * 1024 * 1024);
    store(&mut interp);
    let interp_trap = match interp.run(205) {
        RunOutcome::Trapped(trap) => trap,
        other => panic!("interpreter expected FP store trap, got {other:?}"),
    };
    let interp_state = snapshot(&mut interp);

    let mut jit = Machine::new(8 * 1024 * 1024);
    store(&mut jit);
    configure_jit(&mut jit);
    let jit_trap = match jit.run(205) {
        RunOutcome::Trapped(trap) => trap,
        other => panic!("JIT expected FP store trap, got {other:?}"),
    };
    let jit_state = snapshot(&mut jit);
    let exec = jit.take_executor().expect("JIT executor installed");

    assert_eq!(interp_trap.cause, Exception::StoreAccessFault);
    assert_eq!(interp_trap.tval, FAULT_ADDR);
    assert_eq!(jit_trap.cause, interp_trap.cause);
    assert_eq!(jit_trap.tval, interp_trap.tval);
    assert_eq!(jit_state, interp_state, "FP store fault state diverged");
    assert_eq!(jit_state.pc, DRAM_BASE + 8);
    assert_eq!(jit_state.retired, 200);
    assert!(exec.is_compiled(DRAM_BASE));
    assert!(!exec.is_compiled(DRAM_BASE + 8));
    assert!(
        exec.retired_via_jit() > 0,
        "the integer prefix must actually retire through JIT before the FP store fault"
    );
}

fn dynamic_frm_program(m: &mut Machine, frm: u8) {
    // Two dynamic-rounding FP regions separated by integer regions. 1.0 + 2^-24 is a halfway
    // case: RDN/RNE round down while RUP/RMM round up. Seed NV so the inexact NX flag proves that
    // fflags stay sticky across every interpreter/JIT handoff.
    emit16(m, 0, 0x0001);
    emit32(m, 2, enc_addi(1, 1, 1));
    emit32(m, 6, enc_fp(0, 7, 3, 1, 2)); // FADD.S, rm=DYN
    emit32(m, 10, enc_addi(2, 2, 1));
    emit32(m, 14, enc_fp(0, 7, 4, 1, 2)); // FADD.S, rm=DYN
    emit32(m, 18, enc_addi(3, 3, 1));
    emit32(m, 22, enc_bne(1, 5, -22));
    emit32(m, 26, 0x0000_006f);

    let h = m.hart_mut();
    h.regs.pc = DRAM_BASE;
    h.regs.write(5, 40);
    h.fregs.write_f32(1, 0x3f80_0000); // 1.0
    h.fregs.write_f32(2, 0x3380_0000); // 2^-24, halfway at f32 precision
    h.csr.frm = frm;
    h.csr.fflags = 0x10; // sticky NV survives and FADD.S adds NX
    h.csr.mstatus |= 1 << 13; // FS = Initial
}

#[test]
fn dynamic_frm_all_rounding_modes_keep_sticky_flags_across_handoffs() {
    let mut results = Vec::new();
    for frm in 0..=4u8 {
        let mut interp = Machine::new(8 * 1024 * 1024);
        dynamic_frm_program(&mut interp, frm);
        assert_eq!(interp.run(300), RunOutcome::MaxInstrs);
        let want = snapshot(&mut interp);

        let mut jit = Machine::new(8 * 1024 * 1024);
        dynamic_frm_program(&mut jit, frm);
        configure_jit(&mut jit);
        assert_eq!(jit.run(300), RunOutcome::MaxInstrs);
        let got = snapshot(&mut jit);
        let exec = jit.take_executor().expect("JIT executor installed");

        assert_eq!(got, want, "frm={frm}: dynamic-rounding state diverged");
        assert_eq!(got.fcsr & 0x1f, 0x11, "frm={frm}: NV|NX must be sticky");
        assert!(exec.is_compiled(DRAM_BASE));
        assert!(exec.is_compiled(DRAM_BASE + 10));
        assert!(exec.is_compiled(DRAM_BASE + 18));
        assert!(!exec.is_compiled(DRAM_BASE + 6));
        assert!(!exec.is_compiled(DRAM_BASE + 14));
        assert!(
            exec.retired_via_jit() > 0,
            "frm={frm}: integer handoffs must actually retire through JIT"
        );
        results.push(got);
    }

    assert_ne!(
        results[2].f[3], results[3].f[3],
        "RDN and RUP must produce different results for the halfway case"
    );
}

#[test]
fn pending_interrupt_at_fp_seam_is_deterministic_and_bounded() {
    const DEADLINES: [u64; 3] = [8, 20, 32];

    for deadline in DEADLINES {
        let first = run_fp_seam_interrupt(deadline);
        let second = run_fp_seam_interrupt(deadline);
        assert_eq!(
            first, second,
            "seam schedule must be deterministic at deadline {deadline}"
        );
    }
}

fn run_fp_seam_interrupt(deadline_after_warm: u64) -> (u64, u64, u64, u64) {
    const HANDLER: u64 = DRAM_BASE + 0x8000;
    const PREFIX_OPS: u64 = 40;
    const NOP: u32 = 0x0000_0013;
    const FP_SENTINEL: u64 = 0x0123_4567_89ab_cdef;

    let mut m = Machine::new(8 * 1024 * 1024);
    let clint = m.enable_clint(1);
    clint.borrow_mut().mtimecmp = u64::MAX;
    for i in 0..PREFIX_OPS {
        m.bus_mut().store32(DRAM_BASE + i * 4, NOP).unwrap();
    }
    emit32(&mut m, PREFIX_OPS * 4, enc_fp(0, 0, 3, 1, 2));
    emit32(&mut m, PREFIX_OPS * 4 + 4, 0x0000_006f);
    m.bus_mut().store32(HANDLER, NOP).unwrap();
    {
        let h = m.hart_mut();
        h.fregs.write_f32(1, 0x3f80_0000);
        h.fregs.write_f32(2, 0x4000_0000);
        h.csr.mstatus |= 1 << 13; // FS = Initial
        h.regs.pc = DRAM_BASE;
    }
    configure_jit(&mut m);

    // First install and execute the integer prefix with interrupts disabled. This makes the
    // second run's seam test require a real compiled integer retirement before the FP entry.
    assert_eq!(m.run(300), RunOutcome::MaxInstrs);
    m.hart_mut().regs.pc = DRAM_BASE;
    assert_eq!(m.run(200), RunOutcome::MaxInstrs);
    assert!(m.executor().unwrap().is_compiled(DRAM_BASE));
    let warm_jit_retired = m.executor().unwrap().retired_via_jit();
    assert!(
        warm_jit_retired > 0,
        "warm run must retire the prefix through JIT"
    );
    m.hart_mut().fregs.write_raw(3, FP_SENTINEL);

    let start_retired = m.irq_stats().retired;
    let start_mtime = m.clint_mtime();
    clint.borrow_mut().mtimecmp = start_mtime + deadline_after_warm;
    set_csr(&mut m, MTVEC, CsrOp::Write, HANDLER);
    set_csr(&mut m, MIE, CsrOp::Write, 1 << 7); // MTIE
    set_csr(&mut m, MSTATUS, CsrOp::Set, 1 << 3); // global MIE
    m.hart_mut().regs.pc = DRAM_BASE;

    let _ = m.run(PREFIX_OPS + 1);
    let fired = m.irq_stats().retired - start_retired;
    assert_eq!(m.hart().regs.pc, HANDLER);
    assert_eq!(m.irq_stats().int[7], 1, "timer interrupt must fire once");
    assert_eq!(
        m.hart_mut().csr.read(MEPC),
        DRAM_BASE + PREFIX_OPS * 4,
        "timer delivery must preserve the FP seam PC in mepc"
    );
    assert_eq!(
        m.hart().fregs.read_raw(3),
        FP_SENTINEL,
        "FP seam must not re-execute after the warm JIT run (fired at retired {fired})"
    );

    assert!(
        fired >= deadline_after_warm,
        "interrupt was delivered before timer expiry at retire {fired}"
    );
    assert!(
        fired <= PREFIX_OPS,
        "pending interrupt must be delivered at or before the FP seam (retired {fired})"
    );
    assert!(
        fired - deadline_after_warm <= MAX_BLOCK_OPS as u64,
        "FP-seam interrupt latency {} exceeds MAX_BLOCK_OPS",
        fired - deadline_after_warm
    );
    assert!(
        m.executor().unwrap().retired_via_jit() > warm_jit_retired,
        "seam run must actually retire the integer prefix through JIT"
    );

    (
        fired,
        m.irq_stats().int[7],
        m.hart_mut().csr.read(MEPC),
        m.hart().regs.pc,
    )
}
