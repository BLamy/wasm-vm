//! E1-T16 end-to-end: the Sv39 walker wired through the real fetch/load/store path and trap
//! delivery. Builds page tables in RAM, runs in S-mode under Sv39, and checks that a mapped VA
//! executes/loads/stores and that a page fault is delivered with the exact {cause, stval, sepc}.
//! Real CSR file, default build only.
#![cfg(not(feature = "zicsr-stub"))]
#![cfg(not(target_arch = "wasm32"))]

use wasm_vm_core::Machine;
use wasm_vm_core::bus::Bus;
use wasm_vm_core::bus::mmap::DRAM_BASE;
use wasm_vm_core::csr::{CsrOp, MEDELEG, Priv, SATP, SCAUSE, SEPC, STVAL, STVEC};

const V: u64 = 1;
const R: u64 = 1 << 1;
const W: u64 = 1 << 2;
const X: u64 = 1 << 3;
const A: u64 = 1 << 6;
const D: u64 = 1 << 7;

fn pte(pa: u64, perms: u64) -> u64 {
    ((pa >> 12) << 10) | perms
}
fn set_csr(m: &mut Machine, a: u16, op: CsrOp, v: u64) {
    m.hart_mut().csr.access(a, op, v, false, false, 0).unwrap();
}
fn rd(m: &mut Machine, a: u16) -> u64 {
    m.hart_mut().csr.read(a)
}

/// A page-table builder with a bump allocator for table pages — distinct L1/L0 tables per subtree
/// (no aliasing bugs when VAs share a VPN field).
struct Pt {
    root: u64,
    next: u64,
}
impl Pt {
    fn new(root: u64) -> Self {
        Pt {
            root,
            next: root + 0x1000,
        }
    }
    fn map(&mut self, m: &mut Machine, va: u64, pa: u64, perms: u64) {
        let mut table = self.root;
        for level in (1..=2usize).rev() {
            let vpn = (va >> (12 + level * 9)) & 0x1FF;
            let e = m.bus_mut().load64(table + vpn * 8).unwrap();
            let next = if e & V != 0 {
                (e >> 10) << 12
            } else {
                let t = self.next;
                self.next += 0x1000;
                m.bus_mut().store64(table + vpn * 8, pte(t, V)).unwrap();
                t
            };
            table = next;
        }
        let vpn0 = (va >> 12) & 0x1FF;
        m.bus_mut()
            .store64(table + vpn0 * 8, pte(pa, perms))
            .unwrap();
    }
    fn satp(&self) -> u64 {
        (8u64 << 60) | (self.root >> 12)
    }
}

/// A machine rooted at Sv39 with PMP granted, page faults + ecall delegated to S (stvec).
fn paged_machine() -> (Machine, Pt) {
    let mut m = Machine::new(64 * 1024 * 1024);
    m.hart_mut().csr.pmp.allow_all();
    let pt = Pt::new(DRAM_BASE + 0x20_0000);
    set_csr(&mut m, SATP, CsrOp::Write, pt.satp());
    set_csr(
        &mut m,
        MEDELEG,
        CsrOp::Write,
        (1 << 12) | (1 << 13) | (1 << 15) | (1 << 8),
    );
    (m, pt)
}

#[test]
fn translated_fetch_and_load_and_store_execute() {
    let (mut m, mut pt) = paged_machine();
    const VCODE: u64 = 0x1000_0000;
    const VDATA: u64 = 0x2000_0000;
    let pcode = DRAM_BASE + 0x30_0000;
    let pdata = DRAM_BASE + 0x30_1000;
    pt.map(&mut m, VCODE, pcode, V | R | X | A);
    pt.map(&mut m, VDATA, pdata, V | R | W | A | D);
    // ld x5,0(x6); addi x5,x5,1; sd x5,0(x6) — x6 = VDATA, seeded 41.
    m.bus_mut().store64(pdata, 41).unwrap();
    m.hart_mut().regs.write(6, VDATA);
    let ld = (6u32 << 15) | (0b011 << 12) | (5 << 7) | 0x03;
    let addi = (1u32 << 20) | (5 << 15) | (5 << 7) | 0x13;
    let sd = (5u32 << 20) | (6 << 15) | (0b011 << 12) | 0x23;
    m.bus_mut().store32(pcode, ld).unwrap();
    m.bus_mut().store32(pcode + 4, addi).unwrap();
    m.bus_mut().store32(pcode + 8, sd).unwrap();
    m.hart_mut().csr.mode = Priv::S;
    m.hart_mut().regs.pc = VCODE;

    m.step().unwrap();
    assert_eq!(m.hart().regs.read(5), 41, "translated load");
    m.step().unwrap();
    m.step().unwrap();
    assert_eq!(m.bus_mut().load64(pdata).unwrap(), 42, "translated store");
    assert_eq!(m.hart().regs.pc, VCODE + 12, "pc advanced in virtual space");
}

#[test]
fn load_page_fault_delivers_to_stvec_with_cause_stval_sepc() {
    let (mut m, mut pt) = paged_machine();
    const VCODE: u64 = 0x1000_0000;
    const HANDLER: u64 = 0x1000_0800;
    let pcode = DRAM_BASE + 0x30_0000;
    pt.map(&mut m, VCODE, pcode, V | R | X | A);
    set_csr(&mut m, STVEC, CsrOp::Write, HANDLER);
    const BADVA: u64 = 0x5555_5000;
    m.hart_mut().regs.write(6, BADVA);
    let ld = (6u32 << 15) | (0b011 << 12) | (5 << 7) | 0x03;
    m.bus_mut().store32(pcode, ld).unwrap();
    m.hart_mut().csr.mode = Priv::S;
    m.hart_mut().regs.pc = VCODE;
    let _ = m.run(1);
    assert_eq!(rd(&mut m, SCAUSE), 13, "load page fault");
    assert_eq!(rd(&mut m, STVAL), BADVA, "stval = the faulting VA");
    assert_eq!(rd(&mut m, SEPC), VCODE, "sepc = the faulting instruction");
    assert_eq!(m.hart().regs.pc, HANDLER, "vectored to stvec");
    assert_eq!(m.hart().csr.mode, Priv::S, "handled in S (delegated)");
}

#[test]
fn store_page_fault_when_d_clear_then_succeeds() {
    // Svade: a store to a W=1,D=0 page faults (cause 15); after software sets D, it succeeds.
    let (mut m, mut pt) = paged_machine();
    const VCODE: u64 = 0x1000_0000;
    const VDATA: u64 = 0x2000_0000;
    const HANDLER: u64 = 0x1000_0800;
    let pcode = DRAM_BASE + 0x30_0000;
    let pdata = DRAM_BASE + 0x30_1000;
    pt.map(&mut m, VCODE, pcode, V | R | X | A);
    pt.map(&mut m, VDATA, pdata, V | R | W | A); // D=0
    set_csr(&mut m, STVEC, CsrOp::Write, HANDLER);
    m.hart_mut().regs.write(6, VDATA);
    m.hart_mut().regs.write(5, 99);
    let sd = (5u32 << 20) | (6 << 15) | (0b011 << 12) | 0x23;
    m.bus_mut().store32(pcode, sd).unwrap();
    m.hart_mut().csr.mode = Priv::S;
    m.hart_mut().regs.pc = VCODE;
    let _ = m.run(1);
    assert_eq!(rd(&mut m, SCAUSE), 15, "store page fault (D=0, Svade)");
    assert_eq!(rd(&mut m, STVAL), VDATA);
    // Software sets D and re-runs the store: it succeeds.
    pt.map(&mut m, VDATA, pdata, V | R | W | A | D);
    m.hart_mut().csr.mode = Priv::S;
    m.hart_mut().regs.pc = VCODE;
    m.step().unwrap();
    assert_eq!(
        m.bus_mut().load64(pdata).unwrap(),
        99,
        "store succeeded after D set"
    );
}

#[test]
fn straddling_fetch_faults_on_the_second_parcel() {
    // A 32-bit instruction split across a page boundary with the second page unmapped: the fault
    // is an instruction page fault whose stval is the SECOND page's VA; sepc = the instr start.
    let (mut m, mut pt) = paged_machine();
    const HANDLER: u64 = 0x9000_0000;
    let vpage = 0x1000_0000u64;
    let ppage = DRAM_BASE + 0x30_0000;
    pt.map(&mut m, vpage, ppage, V | R | X | A);
    pt.map(&mut m, HANDLER, DRAM_BASE + 0x30_5000, V | R | X | A);
    set_csr(&mut m, STVEC, CsrOp::Write, HANDLER);
    let instr_va = vpage + 0xFFE; // last 2 bytes → second parcel in the next (unmapped) page
    m.bus_mut().store16(ppage + 0xFFE, 0x00b3).unwrap(); // low parcel, parcel[1:0]=11 → 32-bit
    m.hart_mut().csr.mode = Priv::S;
    m.hart_mut().regs.pc = instr_va;
    let _ = m.run(1);
    assert_eq!(rd(&mut m, SCAUSE), 12, "instruction page fault");
    assert_eq!(
        rd(&mut m, STVAL),
        vpage + 0x1000,
        "stval = the second page's VA"
    );
    assert_eq!(
        rd(&mut m, SEPC),
        instr_va,
        "sepc = the instruction start, not the 2nd parcel"
    );
}
