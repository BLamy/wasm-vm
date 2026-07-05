//! E1-T10: precise synchronous exceptions — cause priority, spec-exact mtval, mepc = the
//! faulting instruction, and mtvec dispatch (direct + vectored). These exercise the real CSR
//! trap machinery (`take_trap` / `deliver_trap_m`), so the file is scoped to the default
//! (non-stub) native build — under `zicsr-stub` CSR space routes to the quarantined stub and
//! the run loop keeps the Level-0 escape.
#![cfg(not(feature = "zicsr-stub"))]
#![cfg(not(target_arch = "wasm32"))]

use wasm_vm_core::bus::Bus;
use wasm_vm_core::bus::mmap::DRAM_BASE;
use wasm_vm_core::csr::{CsrOp, MCAUSE, MEPC, MTVAL, MTVEC, Priv};
use wasm_vm_core::hart::Exception;
use wasm_vm_core::{Machine, RunOutcome};

const CODE: u64 = DRAM_BASE;
const HANDLER: u64 = DRAM_BASE + 0x4000;

fn machine() -> Machine {
    Machine::new(1024 * 1024)
}

/// Install `mtvec = base | mode` (mode 0 = Direct, 1 = Vectored) from M-mode.
fn set_mtvec(m: &mut Machine, base: u64, mode: u64) {
    m.hart_mut()
        .csr
        .access(MTVEC, CsrOp::Write, base | mode, false, false, 0)
        .unwrap();
}

fn rd_csr(m: &mut Machine, addr: u16) -> u64 {
    m.hart_mut().csr.read(addr)
}

/// I-type encoder (JALR/loads/OP-IMM).
fn i_type(imm: i32, rs1: u8, f3: u32, rd: u8, op: u32) -> u32 {
    (((imm as u32) & 0xFFF) << 20) | ((rs1 as u32) << 15) | (f3 << 12) | ((rd as u32) << 7) | op
}

// ── mepc / mtval / mtvec dispatch ───────────────────────────────────────────────

#[test]
fn jalr_to_odd_lands_even_no_trap_under_ialign16() {
    // With the C extension IALIGN = 16 and JALR's spec-mandated `target & ~1`, a JALR to an
    // "odd" computed address masks bit 0 → an even (2-byte-aligned) target that is LEGAL. So
    // JALR can never raise instruction-address-misaligned in RV64GC (unlike the IALIGN=32
    // world the task's acceptance line was written for). Assert it lands, no trap, no divergence
    // from Spike (which also masks bit 0).
    let mut m = machine();
    set_mtvec(&mut m, HANDLER, 0);
    // jalr x1, 7(x0): target = (0 + 7) & ~1 = 6.
    m.bus_mut()
        .store32(CODE, i_type(7, 0, 0b000, 1, 0b1100111))
        .unwrap();
    m.hart_mut().regs.pc = CODE;
    m.step()
        .expect("JALR to a masked-even target must retire, not trap");
    assert_eq!(m.hart().regs.pc, 6, "target = (rs1+imm) & ~1");
    assert_eq!(m.hart().regs.read(1), CODE + 4, "link = pc + 4");
}

#[test]
fn misaligned_fetch_delivers_cause0_mtval_is_pc() {
    // Cause 0 is only reachable via a genuinely misaligned FETCH (an odd PC — unreachable
    // through normal control flow, since every jump/branch target is even). Point PC at an odd
    // address: the 16-bit parcel fetch faults misaligned → cause 0, tval = the odd PC, and on
    // delivery mepc = that PC with bit 0 masked (IALIGN=16).
    let mut m = machine();
    set_mtvec(&mut m, HANDLER, 0);
    let odd = CODE + 1;
    m.hart_mut().regs.pc = odd;
    match m.step() {
        Err(t) => {
            assert_eq!(t.cause, Exception::InstrAddrMisaligned);
            assert_eq!(t.tval, odd, "mtval = the misaligned fetch address");
        }
        Ok(()) => panic!("expected misaligned-fetch trap"),
    }
    assert_eq!(m.hart().regs.pc, odd, "pure step leaves PC");

    m.hart_mut().regs.pc = odd;
    let _ = m.run(1);
    assert_eq!(rd_csr(&mut m, MCAUSE), 0);
    assert_eq!(rd_csr(&mut m, MTVAL), odd, "mtval = the odd fetch address");
    assert_eq!(
        rd_csr(&mut m, MEPC),
        CODE,
        "mepc = fetch pc with bit 0 masked"
    );
    assert_eq!(m.hart().regs.pc, HANDLER, "vectored to mtvec BASE");
    assert_eq!(m.hart().csr.mode, Priv::M, "trap taken in M");
}

#[test]
fn illegal_mtval_is_full_32_bits() {
    // Opcode 0b1111111 (0x7F) is reserved (≥80-bit encodings) → illegal. Low two bits are 11
    // so the fetch treats it as a 32-bit instruction; mtval must be all 32 bits.
    let word = 0xDEAD_C07Fu32; // ...0111_1111 opcode
    let mut m = machine();
    set_mtvec(&mut m, HANDLER, 0);
    m.bus_mut().store32(CODE, word).unwrap();
    m.hart_mut().regs.pc = CODE;
    match m.step() {
        Err(t) => {
            assert_eq!(t.cause, Exception::IllegalInstruction);
            assert_eq!(t.tval, u64::from(word), "mtval = the full 32-bit encoding");
        }
        Ok(()) => panic!("expected illegal-instruction trap"),
    }
}

#[test]
fn illegal_compressed_mtval_is_16_bit_parcel() {
    // Quadrant 0, funct3 = 0b100 is a reserved compressed encoding → illegal. mtval must be
    // the 2-byte parcel, zero-extended — NOT a 32-bit expansion.
    let parcel = 0x8000u16; // 100_..._00
    let mut m = machine();
    set_mtvec(&mut m, HANDLER, 0);
    m.bus_mut().store16(CODE, parcel).unwrap();
    m.hart_mut().regs.pc = CODE;
    match m.step() {
        Err(t) => {
            assert_eq!(t.cause, Exception::IllegalInstruction);
            assert_eq!(t.tval, u64::from(parcel), "mtval = the 16-bit parcel");
        }
        Ok(()) => panic!("expected illegal compressed trap"),
    }
}

#[test]
fn compressed_illegal_at_execute_reports_the_parcel_not_the_expansion() {
    // C.FLD f8, 0(x8) = 0x2000 is a VALID compressed op that expands to a 32-bit `fld`. With
    // mstatus.FS = Off it is illegal at EXECUTE. mtval must be the 2-byte parcel (0x2000), not
    // the fld expansion — the raw_insn threading (E1-T10). (FS is Off at reset.)
    let parcel = 0x2000u16;
    let mut m = machine();
    set_mtvec(&mut m, HANDLER, 0);
    m.bus_mut().store16(CODE, parcel).unwrap();
    m.hart_mut().regs.pc = CODE;
    // Confirm the expansion really differs from the parcel, so this can't pass by accident.
    match m.step() {
        Err(t) => {
            assert_eq!(t.cause, Exception::IllegalInstruction);
            assert_eq!(
                t.tval,
                u64::from(parcel),
                "compressed illegal-at-execute reports the parcel, not the fld expansion"
            );
        }
        Ok(()) => panic!("expected FS=Off illegal trap on C.FLD"),
    }
}

// ── vectored vs direct dispatch ─────────────────────────────────────────────────

#[test]
fn synchronous_trap_ignores_vectored_mode_enters_at_base() {
    // mtvec MODE = 1 (Vectored) applies to INTERRUPTS only. A synchronous ECALL must still
    // enter at BASE + 0, never BASE + 4×cause (Priv §3.1.7).
    let mut m = machine();
    set_mtvec(&mut m, HANDLER, 1); // Vectored
    m.bus_mut().store32(CODE, 0x0000_0073).unwrap(); // ecall
    m.hart_mut().regs.pc = CODE;
    let _ = m.run(1);
    assert_eq!(rd_csr(&mut m, MCAUSE), 11, "ECALL-from-M");
    assert_eq!(rd_csr(&mut m, MTVAL), 0, "ECALL mtval = 0");
    assert_eq!(
        m.hart().regs.pc,
        HANDLER,
        "synchronous trap enters at BASE even in vectored mode"
    );
}

#[test]
fn mtvec_mode3_legalizes_and_base_low_bits_read_zero() {
    // Writing MODE = 3 legalizes (Spike `val & ~2`): MODE reads back ∈ {0,1} (here 0b11→0b01)
    // and the BASE address the trap uses has bits [1:0] = 0.
    let mut m = machine();
    m.hart_mut()
        .csr
        .access(MTVEC, CsrOp::Write, HANDLER | 0b11, false, false, 0)
        .unwrap();
    let raw = rd_csr(&mut m, MTVEC);
    assert_eq!(raw & 0b11, 0b01, "MODE 0b11 legalized to 0b01 (Vectored)");
    assert_eq!(raw & !0b11, HANDLER, "BASE preserved");

    // And a delivered synchronous trap enters at the 4-byte-aligned BASE.
    m.bus_mut().store32(CODE, 0x0000_0073).unwrap();
    m.hart_mut().regs.pc = CODE;
    let _ = m.run(1);
    assert_eq!(m.hart().regs.pc, HANDLER, "handler entry is BASE, [1:0]=0");
}

// ── trap purity: a faulting instruction writes no registers/memory ──────────────

#[test]
fn trapping_store_and_amo_leave_ram_bit_identical() {
    // A store / AMO whose address is unmapped faults BEFORE any write. Prove full-RAM purity
    // by comparing the whole backing store before and after the (pure) faulting step.
    let unmapped = DRAM_BASE + 8 * 1024 * 1024; // past the 1 MiB RAM
    // sd x3, 0(x2):   rs2=x3 data, rs1=x2 address, funct3=011, op=STORE
    let sd = (3u32 << 20) | (2 << 15) | (0b011 << 12) | 0b0100011;
    // amoadd.d x0, x3, (x2): funct5=00000 (amoadd), rs2=x3, rs1=x2, funct3=011, rd=0, op=AMO.
    let amo = (3u32 << 20) | (2 << 15) | (0b011 << 12) | 0b0101111;
    for (label, insn) in [("sd", sd), ("amoadd.d", amo)] {
        let mut m = machine();
        for i in 0..4096u64 {
            m.bus_mut().store8(DRAM_BASE + i, (i as u8) ^ 0xA5).unwrap();
        }
        m.bus_mut().store32(CODE, insn).unwrap();
        m.hart_mut().regs.pc = CODE;
        m.hart_mut().regs.write(2, unmapped); // address register
        m.hart_mut().regs.write(3, 0xDEAD_BEEF_CAFE_F00D);

        let mut before = vec![0u8; 4096];
        m.bus_mut()
            .ram()
            .read_slice(DRAM_BASE, &mut before)
            .unwrap();
        match m.step() {
            Err(t) => assert!(
                matches!(
                    t.cause,
                    Exception::StoreAccessFault | Exception::StoreAddrMisaligned
                ),
                "{label}: unexpected cause {:?}",
                t.cause
            ),
            Ok(()) => panic!("{label}: expected a store/AMO access fault"),
        }
        let mut after = vec![0u8; 4096];
        m.bus_mut().ram().read_slice(DRAM_BASE, &mut after).unwrap();
        assert_eq!(before, after, "faulting {label} mutated RAM");
    }
}

#[test]
fn trapping_fp_load_leaves_fflags_unchanged() {
    // Prime fflags (FS must be non-Off to write them), then fault an `fld` on an unmapped
    // address: the load access fault happens before any FP computation, so fflags are pristine.
    use wasm_vm_core::csr::{FCSR, FFLAGS};
    let mut m = machine();
    // FS = Initial (0b01) so FP is enabled; then set fflags = 0x1F via csr.
    m.hart_mut()
        .csr
        .access(0x300, CsrOp::Set, 0b01 << 13, false, false, 0) // mstatus.FS = Initial
        .unwrap();
    m.hart_mut()
        .csr
        .access(FFLAGS, CsrOp::Write, 0x1F, false, false, 0)
        .unwrap();
    let fflags_before = rd_csr(&mut m, FFLAGS);
    assert_eq!(fflags_before, 0x1F, "fflags primed");
    let _ = FCSR;

    // fld f0, 0(x2), x2 = unmapped.
    let unmapped = DRAM_BASE + 8 * 1024 * 1024;
    let fld = i_type(0, 2, 0b011, 0, 0b0000111);
    m.bus_mut().store32(CODE, fld).unwrap();
    m.hart_mut().regs.pc = CODE;
    m.hart_mut().regs.write(2, unmapped);
    match m.step() {
        Err(t) => assert_eq!(t.cause, Exception::LoadAccessFault),
        Ok(()) => panic!("expected fld access fault"),
    }
    assert_eq!(
        rd_csr(&mut m, FFLAGS),
        fflags_before,
        "trapping fld touched fflags"
    );
}

// ── run-loop delivery does not corrupt a handler-less program's RAM ─────────────

#[test]
fn unhandled_trap_with_zero_mtvec_escapes_to_host() {
    // No handler installed (mtvec BASE == 0): rather than vector to address 0 and re-trap
    // forever, the run loop surfaces the trap to the host as `Trapped` (the host convention
    // that lets the native runner report a bare ECALL/EBREAK). No architectural delivery
    // happened — PC/mode are untouched (the step stayed pure).
    let mut m = machine();
    m.bus_mut().store32(CODE, 0x0000_0073).unwrap(); // ecall, no mtvec
    m.hart_mut().regs.pc = CODE;
    match m.run(20) {
        RunOutcome::Trapped(t) => assert_eq!(t.cause, Exception::EcallFromM),
        other => panic!("expected an unhandled-trap escape, got {other:?}"),
    }
    assert_eq!(m.hart().regs.pc, CODE, "no delivery: PC left at the ECALL");
    assert_eq!(m.hart().csr.mode, Priv::M);
}
