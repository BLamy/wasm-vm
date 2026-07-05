//! QUARANTINED Zicsr/privilege scaffolding (E0-T19) — behind `feature = "zicsr-stub"`.
//!
//! DELETE IN EPIC 1. This is throwaway support so the official riscv-tests **rv64ui-p**
//! binaries can run: their `riscv-test-env/p` startup touches machine-mode CSRs
//! (`mhartid`, `mstatus`, `mtvec`, `medeleg`, `mideleg`, `satp`, `pmpaddr0`, `pmpcfg0`,
//! `mepc`) and drops into the test via `MRET`. Level 0 has no privilege architecture, so
//! this module fakes exactly enough: CSRRW/S/C (+ immediate forms) over a flat u64 CSR
//! map (`mhartid` hardwired 0), and `MRET` as `pc ← mepc`. It is compiled out of default
//! builds and out of the E0-T20 differential-trace configuration — Epic 1 replaces it
//! with the real CSR file and trap delivery.
//!
//! It hooks in at the ONE point the base decoder rejects CSR/xRET encodings
//! (`Err(IllegalInstr)`), so with the feature off nothing here exists and no behavior
//! changes. Executed CSR instructions still retire and appear in the trace (they are NOT
//! silently skipped — that would desync a future differential trace).

use alloc::vec::Vec;

use crate::hart::regs::XRegs;

const SYSTEM: u32 = 0b111_0011;
const MHARTID: u16 = 0xF14;
const MEPC: u16 = 0x341;
const MRET: u32 = 0x3020_0073;
const WFI: u32 = 0x1050_0073;

/// A flat, non-architectural CSR map. `mhartid` reads 0 and ignores writes; everything
/// else is plain read/write storage — enough for the p-env's setup-then-`mret` dance.
#[derive(Default, Clone)]
pub struct CsrFile {
    entries: Vec<(u16, u64)>,
}

impl CsrFile {
    fn get(&self, csr: u16) -> u64 {
        if csr == MHARTID {
            return 0; // single hart, id 0 — the p-env gates other harts into a wait loop
        }
        self.entries
            .iter()
            .find(|(c, _)| *c == csr)
            .map_or(0, |(_, v)| *v)
    }

    fn set(&mut self, csr: u16, v: u64) {
        if csr == MHARTID {
            return; // read-only
        }
        match self.entries.iter_mut().find(|(c, _)| *c == csr) {
            Some(e) => e.1 = v,
            None => self.entries.push((csr, v)),
        }
    }
}

/// Try to execute `insn` as a CSR op or `MRET`/`WFI`. Returns `Some((rd, value))` — the
/// register written and the value for the trace record, PC already advanced — when it
/// handled the instruction, or `None` to let the caller raise IllegalInstruction. On a
/// CSR op `rd` receives the OLD CSR value (RISC-V atomic read-then-write semantics).
pub fn execute(regs: &mut XRegs, csrs: &mut CsrFile, insn: u32) -> Option<(u8, u64)> {
    if insn & 0x7f != SYSTEM {
        return None;
    }
    let funct3 = (insn >> 12) & 0b111;
    if funct3 == 0 {
        // Non-CSR SYSTEM: only MRET and WFI are handled here (ECALL/EBREAK already
        // decode). MRET returns to mepc; WFI is a no-op wait.
        return match insn {
            MRET => {
                regs.pc = csrs.get(MEPC);
                Some((0, 0))
            }
            WFI => {
                regs.pc = regs.pc.wrapping_add(4);
                Some((0, 0))
            }
            _ => None,
        };
    }

    let csr = ((insn >> 20) & 0xFFF) as u16;
    let rs1_field = ((insn >> 15) & 0x1F) as u8;
    let rd = ((insn >> 7) & 0x1F) as u8;
    // Immediate forms (funct3 bit 2 set) use the rs1 field as a 5-bit zero-extended imm.
    let src = if funct3 & 0b100 != 0 {
        u64::from(rs1_field)
    } else {
        regs.read(rs1_field)
    };
    let old = csrs.get(csr);
    let new = match funct3 & 0b011 {
        0b01 => src,        // CSRRW/CSRRWI: write
        0b10 => old | src,  // CSRRS/CSRRSI: set bits
        0b11 => old & !src, // CSRRC/CSRRCI: clear bits
        _ => return None,   // unreachable (funct3 != 0 here)
    };
    // RISC-V: for set/clear a zero source (or x0 base) performs NO write, so a read-only
    // CSR is not disturbed. CSRRW always writes.
    let writes = (funct3 & 0b011) == 0b01 || rs1_field != 0;
    if writes {
        csrs.set(csr, new);
    }
    regs.pc = regs.pc.wrapping_add(4);
    Some((rd, old))
}
