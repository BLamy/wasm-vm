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
//! - Control flow (JAL/JALR/branches): executed (E0-T09). §2.5 semantics: the
//!   misaligned-target trap (cause 0, tval = target) is raised by the TAKEN
//!   jump/branch itself with no link write; a not-taken branch with a misaligned
//!   target retires normally. IALIGN=32 until the C extension (E1-T08).
//! - ECALL/EBREAK: executed (E0-T11) as precise traps (cause 11 / cause 3). The
//!   complete RV64I execution set now retires or traps — no placeholder arms remain.

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
#[derive(PartialEq, Eq)]
pub struct Hart {
    pub regs: XRegs,
    /// Reset-relevant control/status registers (E1-T01): misa, mstatus, mcause, mhartid,
    /// privilege mode. The single source of architectural reset state.
    pub csr: crate::csr::Csrs,
    /// QUARANTINED CSR scaffolding for the riscv-tests p-env (E0-T19). Present only under
    /// `feature = "zicsr-stub"`; Epic 1 replaces it with the real CSR file above.
    #[cfg(feature = "zicsr-stub")]
    pub csrs: crate::zicsr_stub::CsrFile,
}

impl Default for Hart {
    /// Every constructor funnels through [`Self::reset`] so there is ONE authoritative
    /// initial state (E1-T01). Default resets to the `virt`/Spike vector `DRAM_BASE`.
    fn default() -> Self {
        let mut h = Hart {
            regs: XRegs::default(),
            csr: crate::csr::Csrs::at_reset(),
            #[cfg(feature = "zicsr-stub")]
            csrs: crate::zicsr_stub::CsrFile::default(),
        };
        h.reset(crate::bus::mmap::DRAM_BASE);
        h
    }
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

/// Resolve a conditional branch (§2.5): taken → transfer to `pc + imm`, trapping
/// cause 0 with tval = target when the target is not IALIGN-aligned; not taken →
/// fall through. Returns the retire tuple (no link register for branches).
#[inline(always)]
const fn branch(taken: bool, pc: u64, imm: i64) -> Result<(u8, u64, u64), Trap> {
    if taken {
        let target = pc.wrapping_add(imm as u64);
        if target & 3 != 0 {
            return Err(Trap {
                cause: Exception::InstrAddrMisaligned,
                tval: target,
            });
        }
        Ok((0, 0, target))
    } else {
        Ok((0, 0, pc.wrapping_add(4)))
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
    /// A hart in the spec reset state, PC at the `virt`/Spike vector `DRAM_BASE`.
    pub fn new() -> Self {
        Self::default()
    }

    /// Return the hart to the privileged-spec §3.4 reset state with `pc = reset_vector`:
    /// all integer registers 0, M-mode, `mstatus = 0` (MIE=0, MPRV=0), `mcause = 0`, and
    /// the hardwired `misa`/`mhartid`. THE single authority for initial state — every
    /// constructor, harness, and (future) power-on-reset funnels through here, so two
    /// resets from any prior state are bit-identical.
    pub fn reset(&mut self, reset_vector: u64) {
        self.regs = XRegs::default();
        self.regs.pc = reset_vector;
        self.csr = crate::csr::Csrs::at_reset();
        #[cfg(feature = "zicsr-stub")]
        {
            self.csrs = crate::zicsr_stub::CsrFile::default();
        }
    }

    /// Fetch at PC, decode, execute one instruction. On `Ok`, the instruction
    /// retired and PC advanced. On `Err(trap)`, PC and all registers are exactly
    /// as they were before the call (trap purity — asserted by tests).
    ///
    /// Non-generic and unchanged for all callers: it is exactly [`step_traced`] with
    /// the zero-cost [`NullSink`], which the optimizer erases the hook from.
    #[inline]
    pub fn step(&mut self, bus: &mut impl Bus) -> Result<(), Trap> {
        self.step_traced(bus, &mut crate::trace::NullSink)
    }

    /// Like [`step`], plus a [`TraceSink`] hook fired AFTER a successful retirement
    /// (never on a trapping step — a faulting instruction produces no retire record).
    /// With `sink = &mut NullSink` this monomorphizes to exactly the old `step`.
    ///
    /// [`step`]: Self::step
    /// [`TraceSink`]: crate::trace::TraceSink
    #[inline]
    pub fn step_traced<T: crate::trace::TraceSink>(
        &mut self,
        bus: &mut impl Bus,
        sink: &mut T,
    ) -> Result<(), Trap> {
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
        let instr = match decode(insn) {
            Ok(instr) => instr,
            Err(_) => {
                // The base decoder rejects CSR/xRET encodings. With the quarantined
                // zicsr-stub feature on, try to execute them there (they retire and are
                // traced — never silently skipped). Otherwise it is an illegal insn.
                #[cfg(feature = "zicsr-stub")]
                if let Some((rd, value)) =
                    crate::zicsr_stub::execute(&mut self.regs, &mut self.csrs, insn)
                {
                    sink.retire(&crate::trace::TraceRecord {
                        pc,
                        insn,
                        rd: (rd != 0).then_some((rd, value)),
                        mem: None,
                    });
                    return Ok(());
                }
                return Err(Trap {
                    cause: Exception::IllegalInstruction,
                    tval: insn as u64,
                });
            }
        };
        let (rd, value, mem) = self.execute(bus, instr)?;
        // Retirement hook — reached only when execute() returns Ok, so no record is
        // emitted for a faulting instruction (trap-purity contract). Built and passed
        // generically; with NullSink the optimizer erases all of this (E0-T15 proof).
        sink.retire(&crate::trace::TraceRecord {
            pc,
            insn,
            // x0 / no-write instructions omit the register field.
            rd: (rd != 0).then_some((rd, value)),
            mem,
        });
        Ok(())
    }

    /// Execute a decoded instruction. Returns the retire info `(rd, value, mem)` for the
    /// trace record — `(rd, value)` is what was written to the register file (rd == 0
    /// meaning no architectural write) and `mem` the memory op if any. Every arm either
    /// fully retires (writeback + PC advance) or returns a trap having touched nothing.
    fn execute(
        &mut self,
        bus: &mut impl Bus,
        instr: Instr,
    ) -> Result<(u8, u64, Option<crate::trace::MemOp>), Trap> {
        use crate::trace::MemOp;
        use Instr::*;
        let r = &mut self.regs;
        // Memory op captured by the load/store arms; None for everything else.
        let mut mem: Option<MemOp> = None;
        let pc = r.pc;
        let pc4 = pc.wrapping_add(4);
        // Per-op result and successor PC; applied at the single retirement point
        // below (x0-discard and PC update live in one place).
        let (rd, value, next_pc): (u8, u64, u64) = match instr {
            Lui { rd, imm } => (rd, imm as u64, pc4),
            Auipc { rd, imm } => (rd, pc.wrapping_add(imm as u64), pc4),

            Addi { rd, rs1, imm } => (rd, r.read(rs1).wrapping_add(imm as u64), pc4),
            Slti { rd, rs1, imm } => (rd, ((r.read(rs1) as i64) < imm) as u64, pc4),
            Sltiu { rd, rs1, imm } => (rd, (r.read(rs1) < imm as u64) as u64, pc4),
            Xori { rd, rs1, imm } => (rd, r.read(rs1) ^ imm as u64, pc4),
            Ori { rd, rs1, imm } => (rd, r.read(rs1) | imm as u64, pc4),
            Andi { rd, rs1, imm } => (rd, r.read(rs1) & imm as u64, pc4),
            Slli { rd, rs1, shamt } => (rd, r.read(rs1) << shamt, pc4),
            Srli { rd, rs1, shamt } => (rd, r.read(rs1) >> shamt, pc4),
            Srai { rd, rs1, shamt } => (rd, ((r.read(rs1) as i64) >> shamt) as u64, pc4),

            Addiw { rd, rs1, imm } => {
                (rd, sext32(r.read(rs1).wrapping_add(imm as u64) as u32), pc4)
            }
            Slliw { rd, rs1, shamt } => (rd, sext32((r.read(rs1) as u32) << shamt), pc4),
            Srliw { rd, rs1, shamt } => (rd, sext32((r.read(rs1) as u32) >> shamt), pc4),
            Sraiw { rd, rs1, shamt } => (
                rd,
                sext32((((r.read(rs1) as u32) as i32) >> shamt) as u32),
                pc4,
            ),

            Add { rd, rs1, rs2 } => (rd, r.read(rs1).wrapping_add(r.read(rs2)), pc4),
            Sub { rd, rs1, rs2 } => (rd, r.read(rs1).wrapping_sub(r.read(rs2)), pc4),
            // Register shifts: RV64 uses rs2[5:0]; the *W forms use rs2[4:0] (Ch. 5).
            Sll { rd, rs1, rs2 } => (rd, r.read(rs1) << (r.read(rs2) & 0x3F), pc4),
            Slt { rd, rs1, rs2 } => (
                rd,
                ((r.read(rs1) as i64) < (r.read(rs2) as i64)) as u64,
                pc4,
            ),
            Sltu { rd, rs1, rs2 } => (rd, (r.read(rs1) < r.read(rs2)) as u64, pc4),
            Xor { rd, rs1, rs2 } => (rd, r.read(rs1) ^ r.read(rs2), pc4),
            Srl { rd, rs1, rs2 } => (rd, r.read(rs1) >> (r.read(rs2) & 0x3F), pc4),
            Sra { rd, rs1, rs2 } => (
                rd,
                ((r.read(rs1) as i64) >> (r.read(rs2) & 0x3F)) as u64,
                pc4,
            ),
            Or { rd, rs1, rs2 } => (rd, r.read(rs1) | r.read(rs2), pc4),
            And { rd, rs1, rs2 } => (rd, r.read(rs1) & r.read(rs2), pc4),

            Addw { rd, rs1, rs2 } => (
                rd,
                sext32((r.read(rs1) as u32).wrapping_add(r.read(rs2) as u32)),
                pc4,
            ),
            Subw { rd, rs1, rs2 } => (
                rd,
                sext32((r.read(rs1) as u32).wrapping_sub(r.read(rs2) as u32)),
                pc4,
            ),
            Sllw { rd, rs1, rs2 } => (
                rd,
                sext32((r.read(rs1) as u32) << (r.read(rs2) & 0x1F)),
                pc4,
            ),
            Srlw { rd, rs1, rs2 } => (
                rd,
                sext32((r.read(rs1) as u32) >> (r.read(rs2) & 0x1F)),
                pc4,
            ),
            Sraw { rd, rs1, rs2 } => (
                rd,
                sext32((((r.read(rs1) as u32) as i32) >> (r.read(rs2) & 0x1F)) as u32),
                pc4,
            ),

            // FENCE retires as a no-op: single in-order hart, no reordering agents
            // at Level 0. Write to x0 so it flows through the common retire path.
            Fence { .. } => (0, 0, pc4),

            // Loads (E0-T08): effective address = rs1 + sext(imm), wrapping.
            // A bus fault maps to cause 4/5 with tval = the effective address; the
            // `?` returns BEFORE writeback, so rd (even when rd == rs1) and PC are
            // untouched on fault. LB/LH/LW sign-extend; LBU/LHU/LWU zero-extend.
            Lb { rd, rs1, imm } => {
                let a = ea(r.read(rs1), imm);
                mem = Some(MemOp {
                    addr: a,
                    len: 1,
                    is_store: false,
                    value: 0,
                });
                (
                    rd,
                    bus.load8(a).map_err(|f| load_fault(f, a))? as i8 as i64 as u64,
                    pc4,
                )
            }
            Lh { rd, rs1, imm } => {
                let a = ea(r.read(rs1), imm);
                mem = Some(MemOp {
                    addr: a,
                    len: 2,
                    is_store: false,
                    value: 0,
                });
                (
                    rd,
                    bus.load16(a).map_err(|f| load_fault(f, a))? as i16 as i64 as u64,
                    pc4,
                )
            }
            Lw { rd, rs1, imm } => {
                let a = ea(r.read(rs1), imm);
                mem = Some(MemOp {
                    addr: a,
                    len: 4,
                    is_store: false,
                    value: 0,
                });
                (
                    rd,
                    bus.load32(a).map_err(|f| load_fault(f, a))? as i32 as i64 as u64,
                    pc4,
                )
            }
            Ld { rd, rs1, imm } => {
                let a = ea(r.read(rs1), imm);
                mem = Some(MemOp {
                    addr: a,
                    len: 8,
                    is_store: false,
                    value: 0,
                });
                (rd, bus.load64(a).map_err(|f| load_fault(f, a))?, pc4)
            }
            Lbu { rd, rs1, imm } => {
                let a = ea(r.read(rs1), imm);
                mem = Some(MemOp {
                    addr: a,
                    len: 1,
                    is_store: false,
                    value: 0,
                });
                (
                    rd,
                    u64::from(bus.load8(a).map_err(|f| load_fault(f, a))?),
                    pc4,
                )
            }
            Lhu { rd, rs1, imm } => {
                let a = ea(r.read(rs1), imm);
                mem = Some(MemOp {
                    addr: a,
                    len: 2,
                    is_store: false,
                    value: 0,
                });
                (
                    rd,
                    u64::from(bus.load16(a).map_err(|f| load_fault(f, a))?),
                    pc4,
                )
            }
            Lwu { rd, rs1, imm } => {
                let a = ea(r.read(rs1), imm);
                mem = Some(MemOp {
                    addr: a,
                    len: 4,
                    is_store: false,
                    value: 0,
                });
                (
                    rd,
                    u64::from(bus.load32(a).map_err(|f| load_fault(f, a))?),
                    pc4,
                )
            }

            // Stores (E0-T08): cause 6/7 with tval = effective address. A faulting
            // bus store writes nothing (E0-T03), so purity holds; on success the
            // bus write IS the side effect and retirement is a no-op write to x0.
            Sb { rs1, rs2, imm } => {
                let a = ea(r.read(rs1), imm);
                mem = Some(MemOp {
                    addr: a,
                    len: 1,
                    is_store: true,
                    value: r.read(rs2),
                });
                bus.store8(a, r.read(rs2) as u8)
                    .map_err(|f| store_fault(f, a))?;
                (0, 0, pc4)
            }
            Sh { rs1, rs2, imm } => {
                let a = ea(r.read(rs1), imm);
                mem = Some(MemOp {
                    addr: a,
                    len: 2,
                    is_store: true,
                    value: r.read(rs2),
                });
                bus.store16(a, r.read(rs2) as u16)
                    .map_err(|f| store_fault(f, a))?;
                (0, 0, pc4)
            }
            Sw { rs1, rs2, imm } => {
                let a = ea(r.read(rs1), imm);
                mem = Some(MemOp {
                    addr: a,
                    len: 4,
                    is_store: true,
                    value: r.read(rs2),
                });
                bus.store32(a, r.read(rs2) as u32)
                    .map_err(|f| store_fault(f, a))?;
                (0, 0, pc4)
            }
            Sd { rs1, rs2, imm } => {
                let a = ea(r.read(rs1), imm);
                mem = Some(MemOp {
                    addr: a,
                    len: 8,
                    is_store: true,
                    value: r.read(rs2),
                });
                bus.store64(a, r.read(rs2)).map_err(|f| store_fault(f, a))?;
                (0, 0, pc4)
            }

            // Jumps (E0-T09, §2.5): target computed FIRST (so jalr rd==rs1 uses the
            // old rs1), link = pc+4 written only on success; a misaligned target
            // traps cause 0 with tval = target and writes nothing.
            Jal { rd, imm } => {
                let target = pc.wrapping_add(imm as u64);
                if target & 3 != 0 {
                    return Err(Trap {
                        cause: Exception::InstrAddrMisaligned,
                        tval: target,
                    });
                }
                (rd, pc4, target)
            }
            Jalr { rd, rs1, imm } => {
                let target = ea(r.read(rs1), imm) & !1; // spec: clear bit 0
                if target & 3 != 0 {
                    return Err(Trap {
                        cause: Exception::InstrAddrMisaligned,
                        tval: target,
                    });
                }
                (rd, pc4, target)
            }

            // Branches (E0-T09): only a TAKEN branch can trap on target misalignment;
            // not-taken retires normally regardless of the encoded target.
            Beq { rs1, rs2, imm } => branch(r.read(rs1) == r.read(rs2), pc, imm)?,
            Bne { rs1, rs2, imm } => branch(r.read(rs1) != r.read(rs2), pc, imm)?,
            Blt { rs1, rs2, imm } => branch((r.read(rs1) as i64) < (r.read(rs2) as i64), pc, imm)?,
            Bge { rs1, rs2, imm } => branch((r.read(rs1) as i64) >= (r.read(rs2) as i64), pc, imm)?,
            Bltu { rs1, rs2, imm } => branch(r.read(rs1) < r.read(rs2), pc, imm)?,
            Bgeu { rs1, rs2, imm } => branch(r.read(rs1) >= r.read(rs2), pc, imm)?,

            // ECALL / EBREAK (E0-T11): precise traps, PC left at the instruction's
            // own address, nothing else mutated. ECALL → cause 11 (env-call-from-M,
            // our only mode at Level 0), tval 0. EBREAK → cause 3 (breakpoint),
            // tval = pc. The host decides what happens next.
            Ecall => {
                return Err(Trap {
                    cause: Exception::EcallFromM,
                    tval: 0,
                });
            }
            Ebreak => {
                return Err(Trap {
                    cause: Exception::Breakpoint,
                    tval: pc,
                });
            }
        };
        // Single retirement point: x0-discard is enforced by XRegs::write.
        r.write(rd, value);
        r.pc = next_pc;
        Ok((rd, value, mem))
    }
}
