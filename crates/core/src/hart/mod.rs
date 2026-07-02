//! The hart (hardware thread): architectural CPU state and the fetch-decode-execute
//! step loop (E0-T07).
//!
//! Trap model at Level 0: a trap *returns* from [`Hart::step`] with the PC still
//! pointing at the faulting instruction and no other architectural state modified —
//! the host decides what happens next. Cause codes mirror the privileged spec's
//! `mcause` numbering (Privileged ISA 20211203, Table 3.6) so Level 1 can graft
//! CSR-based trap delivery without renumbering.
//!
//! Scope ledger (each arm is replaced by its owning task):
//! - Computational ops (LUI/AUIPC/OP-IMM/OP-IMM-32/OP/OP-32): executed (E0-T07).
//! - Loads/stores (LB..LWU, SB..SD): executed (E0-T08). Misaligned-data POLICY: the
//!   bus requires natural alignment (E0-T03), so misaligned data accesses trap with
//!   causes 4/6 — matching Spike's default (no `--misaligned`); qemu-riscv64
//!   silently emulates them, a documented differential asymmetry for E0-T20.
//! - FENCE: retires as a no-op — architecturally correct for a single in-order hart
//!   with no devices reordering memory; revisited when it matters (E4 JIT, E6 SMP).
//! - Control flow (JAL/JALR/branches): E0-T09. ECALL/EBREAK: E0-T11. Until then
//!   those decode fine but raise `IllegalInstruction` as an explicit placeholder
//!   (documented, tested as such).

pub mod regs;

use crate::bus::{Bus, BusFault};
use crate::decode::{Instr, decode};
use regs::XRegs;

/// Exception causes, numbered exactly as `mcause` (Privileged ISA Table 3.6).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[repr(u64)]
pub enum Exception {
    InstrAddrMisaligned = 0,
    InstrAccessFault = 1,
    IllegalInstruction = 2,
    Breakpoint = 3,
    LoadAddrMisaligned = 4,
    LoadAccessFault = 5,
    StoreAddrMisaligned = 6,
    StoreAccessFault = 7,
    EcallFromU = 8,
    EcallFromM = 11,
}

/// A trap: why, plus the `mtval`-equivalent payload (faulting address or raw
/// instruction word, per cause).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Trap {
    pub cause: Exception,
    pub tval: u64,
}

/// One RV64 hart. The PC lives inside [`XRegs`] (single authority, E0-T05);
/// `regs.pc` is the architectural PC.
#[derive(Default)]
pub struct Hart {
    pub regs: XRegs,
}

impl core::fmt::Debug for Hart {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        // The stable dump format IS the debug representation (one authority).
        core::fmt::Display::fmt(&self.regs, f)
    }
}

/// Sign-extend the low 32 bits — the RV64 `*W` retirement rule (Unprivileged ISA
/// Ch. 5: *W ops compute on 32 bits and sign-extend the 32-bit result).
#[inline(always)]
const fn sext32(x: u32) -> u64 {
    x as i32 as i64 as u64
}

/// The one effective-address formula for every memory op (§2.6): base plus
/// sign-extended immediate in wrapping two's-complement u64 arithmetic.
#[inline(always)]
const fn ea(base: u64, imm: i64) -> u64 {
    base.wrapping_add(imm as u64)
}

/// Map a bus fault on a LOAD to its architectural cause (4 misaligned / 5 access),
/// `tval` = the effective address (including wrapped addresses).
#[inline(always)]
const fn load_fault(f: BusFault, addr: u64) -> Trap {
    Trap {
        cause: match f {
            BusFault::Misaligned => Exception::LoadAddrMisaligned,
            BusFault::Access => Exception::LoadAccessFault,
        },
        tval: addr,
    }
}

/// Map a bus fault on a STORE to its architectural cause (6 misaligned / 7 access).
#[inline(always)]
const fn store_fault(f: BusFault, addr: u64) -> Trap {
    Trap {
        cause: match f {
            BusFault::Misaligned => Exception::StoreAddrMisaligned,
            BusFault::Access => Exception::StoreAccessFault,
        },
        tval: addr,
    }
}

impl Hart {
    pub fn new() -> Self {
        Self::default()
    }

    /// Fetch at PC, decode, execute one instruction. On `Ok`, the instruction
    /// retired and PC advanced. On `Err(trap)`, PC and all registers are exactly
    /// as they were before the call (trap purity — asserted by tests).
    pub fn step(&mut self, bus: &mut impl Bus) -> Result<(), Trap> {
        let pc = self.regs.pc;
        let insn = match bus.load32(pc) {
            Ok(w) => w,
            Err(BusFault::Access) => {
                return Err(Trap {
                    cause: Exception::InstrAccessFault,
                    tval: pc,
                });
            }
            Err(BusFault::Misaligned) => {
                return Err(Trap {
                    cause: Exception::InstrAddrMisaligned,
                    tval: pc,
                });
            }
        };
        let Ok(instr) = decode(insn) else {
            return Err(Trap {
                cause: Exception::IllegalInstruction,
                tval: insn as u64,
            });
        };
        self.execute(bus, instr, insn)
    }

    /// Execute a decoded instruction. Every arm either fully retires (writeback +
    /// PC advance) or returns a trap having touched nothing.
    fn execute(&mut self, bus: &mut impl Bus, instr: Instr, raw: u32) -> Result<(), Trap> {
        use Instr::*;
        let r = &mut self.regs;
        let pc = r.pc;
        // Value computed per-op; written to rd at the single retirement point below
        // (keeps the x0-discard and PC-advance logic in one place).
        let (rd, value): (u8, u64) = match instr {
            Lui { rd, imm } => (rd, imm as u64),
            Auipc { rd, imm } => (rd, pc.wrapping_add(imm as u64)),

            Addi { rd, rs1, imm } => (rd, r.read(rs1).wrapping_add(imm as u64)),
            Slti { rd, rs1, imm } => (rd, ((r.read(rs1) as i64) < imm) as u64),
            Sltiu { rd, rs1, imm } => (rd, (r.read(rs1) < imm as u64) as u64),
            Xori { rd, rs1, imm } => (rd, r.read(rs1) ^ imm as u64),
            Ori { rd, rs1, imm } => (rd, r.read(rs1) | imm as u64),
            Andi { rd, rs1, imm } => (rd, r.read(rs1) & imm as u64),
            Slli { rd, rs1, shamt } => (rd, r.read(rs1) << shamt),
            Srli { rd, rs1, shamt } => (rd, r.read(rs1) >> shamt),
            Srai { rd, rs1, shamt } => (rd, ((r.read(rs1) as i64) >> shamt) as u64),

            Addiw { rd, rs1, imm } => (rd, sext32(r.read(rs1).wrapping_add(imm as u64) as u32)),
            Slliw { rd, rs1, shamt } => (rd, sext32((r.read(rs1) as u32) << shamt)),
            Srliw { rd, rs1, shamt } => (rd, sext32((r.read(rs1) as u32) >> shamt)),
            Sraiw { rd, rs1, shamt } => {
                (rd, sext32((((r.read(rs1) as u32) as i32) >> shamt) as u32))
            }

            Add { rd, rs1, rs2 } => (rd, r.read(rs1).wrapping_add(r.read(rs2))),
            Sub { rd, rs1, rs2 } => (rd, r.read(rs1).wrapping_sub(r.read(rs2))),
            // Register shifts: RV64 uses rs2[5:0]; the *W forms use rs2[4:0] (Ch. 5).
            Sll { rd, rs1, rs2 } => (rd, r.read(rs1) << (r.read(rs2) & 0x3F)),
            Slt { rd, rs1, rs2 } => (rd, ((r.read(rs1) as i64) < (r.read(rs2) as i64)) as u64),
            Sltu { rd, rs1, rs2 } => (rd, (r.read(rs1) < r.read(rs2)) as u64),
            Xor { rd, rs1, rs2 } => (rd, r.read(rs1) ^ r.read(rs2)),
            Srl { rd, rs1, rs2 } => (rd, r.read(rs1) >> (r.read(rs2) & 0x3F)),
            Sra { rd, rs1, rs2 } => (rd, ((r.read(rs1) as i64) >> (r.read(rs2) & 0x3F)) as u64),
            Or { rd, rs1, rs2 } => (rd, r.read(rs1) | r.read(rs2)),
            And { rd, rs1, rs2 } => (rd, r.read(rs1) & r.read(rs2)),

            Addw { rd, rs1, rs2 } => (
                rd,
                sext32((r.read(rs1) as u32).wrapping_add(r.read(rs2) as u32)),
            ),
            Subw { rd, rs1, rs2 } => (
                rd,
                sext32((r.read(rs1) as u32).wrapping_sub(r.read(rs2) as u32)),
            ),
            Sllw { rd, rs1, rs2 } => (rd, sext32((r.read(rs1) as u32) << (r.read(rs2) & 0x1F))),
            Srlw { rd, rs1, rs2 } => (rd, sext32((r.read(rs1) as u32) >> (r.read(rs2) & 0x1F))),
            Sraw { rd, rs1, rs2 } => (
                rd,
                sext32((((r.read(rs1) as u32) as i32) >> (r.read(rs2) & 0x1F)) as u32),
            ),

            // FENCE retires as a no-op: single in-order hart, no reordering agents
            // at Level 0. Write to x0 so it flows through the common retire path.
            Fence { .. } => (0, 0),

            // Loads (E0-T08): effective address = rs1 + sext(imm), wrapping.
            // A bus fault maps to cause 4/5 with tval = the effective address; the
            // `?` returns BEFORE writeback, so rd (even when rd == rs1) and PC are
            // untouched on fault. LB/LH/LW sign-extend; LBU/LHU/LWU zero-extend.
            Lb { rd, rs1, imm } => {
                let a = ea(r.read(rs1), imm);
                (
                    rd,
                    bus.load8(a).map_err(|f| load_fault(f, a))? as i8 as i64 as u64,
                )
            }
            Lh { rd, rs1, imm } => {
                let a = ea(r.read(rs1), imm);
                (
                    rd,
                    bus.load16(a).map_err(|f| load_fault(f, a))? as i16 as i64 as u64,
                )
            }
            Lw { rd, rs1, imm } => {
                let a = ea(r.read(rs1), imm);
                (
                    rd,
                    bus.load32(a).map_err(|f| load_fault(f, a))? as i32 as i64 as u64,
                )
            }
            Ld { rd, rs1, imm } => {
                let a = ea(r.read(rs1), imm);
                (rd, bus.load64(a).map_err(|f| load_fault(f, a))?)
            }
            Lbu { rd, rs1, imm } => {
                let a = ea(r.read(rs1), imm);
                (rd, u64::from(bus.load8(a).map_err(|f| load_fault(f, a))?))
            }
            Lhu { rd, rs1, imm } => {
                let a = ea(r.read(rs1), imm);
                (rd, u64::from(bus.load16(a).map_err(|f| load_fault(f, a))?))
            }
            Lwu { rd, rs1, imm } => {
                let a = ea(r.read(rs1), imm);
                (rd, u64::from(bus.load32(a).map_err(|f| load_fault(f, a))?))
            }

            // Stores (E0-T08): cause 6/7 with tval = effective address. A faulting
            // bus store writes nothing (E0-T03), so purity holds; on success the
            // bus write IS the side effect and retirement is a no-op write to x0.
            Sb { rs1, rs2, imm } => {
                let a = ea(r.read(rs1), imm);
                bus.store8(a, r.read(rs2) as u8)
                    .map_err(|f| store_fault(f, a))?;
                (0, 0)
            }
            Sh { rs1, rs2, imm } => {
                let a = ea(r.read(rs1), imm);
                bus.store16(a, r.read(rs2) as u16)
                    .map_err(|f| store_fault(f, a))?;
                (0, 0)
            }
            Sw { rs1, rs2, imm } => {
                let a = ea(r.read(rs1), imm);
                bus.store32(a, r.read(rs2) as u32)
                    .map_err(|f| store_fault(f, a))?;
                (0, 0)
            }
            Sd { rs1, rs2, imm } => {
                let a = ea(r.read(rs1), imm);
                bus.store64(a, r.read(rs2)).map_err(|f| store_fault(f, a))?;
                (0, 0)
            }

            // Owned by later tasks — explicit placeholders (see module doc). They
            // trap BEFORE any state is touched, preserving trap purity.
            Jal { .. }
            | Jalr { .. }
            | Beq { .. }
            | Bne { .. }
            | Blt { .. }
            | Bge { .. }
            | Bltu { .. }
            | Bgeu { .. }
            | Ecall
            | Ebreak => {
                return Err(Trap {
                    cause: Exception::IllegalInstruction,
                    tval: raw as u64,
                });
            }
        };
        // Single retirement point: x0-discard is enforced by XRegs::write.
        r.write(rd, value);
        r.pc = pc.wrapping_add(4);
        Ok(())
    }
}
