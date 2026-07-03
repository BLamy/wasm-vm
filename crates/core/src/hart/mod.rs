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

pub mod fregs;
pub mod regs;

use crate::bus::{Bus, BusFault};
use crate::decode::{Instr, decode};
use crate::softfloat::{F32, SoftFloat};
use regs::XRegs;

/// Every F/D instruction requires `mstatus.FS != Off` (E1-T06); this identifies them so the
/// check happens once, before any architectural state is read.
const fn is_fp(i: &Instr) -> bool {
    use Instr::*;
    matches!(
        i,
        Flw { .. }
            | Fsw { .. }
            | FpArithS { .. }
            | FsqrtS { .. }
            | FpFusedS { .. }
            | FsgnjS { .. }
            | FminmaxS { .. }
            | FpCmpS { .. }
            | FclassS { .. }
            | FmvXW { .. }
            | FmvWX { .. }
            | FcvtToIntS { .. }
            | FcvtFromIntS { .. }
    )
}

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
    /// LR/SC reservation (A extension, E1-T04): `Some((addr, width_bytes))` after a
    /// load-reserved, consumed/cleared by SC. Also invalidated by an overlapping store,
    /// and by MRET/WFI (our documented conservative policy — see the execute arms).
    pub resv: Option<(u64, u8)>,
    /// Floating-point register file (F/D extensions, E1-T06): FLEN=64 with NaN-boxing.
    pub fregs: fregs::FRegs,
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
            resv: None,
            fregs: fregs::FRegs::default(),
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

/// AMO read-modify-write on the 32-bit (W) value: MIN/MAX are 32-bit comparisons
/// (signed for MIN/MAX, unsigned for MINU/MAXU), NOT 64-bit (A-extension spec).
#[inline(always)]
const fn amo_w(op: crate::decode::AmoOp, old: u32, rhs: u32) -> u32 {
    use crate::decode::AmoOp::*;
    match op {
        Swap => rhs,
        Add => old.wrapping_add(rhs),
        Xor => old ^ rhs,
        And => old & rhs,
        Or => old | rhs,
        Min => {
            if (old as i32) < (rhs as i32) {
                old
            } else {
                rhs
            }
        }
        Max => {
            if (old as i32) > (rhs as i32) {
                old
            } else {
                rhs
            }
        }
        Minu => {
            if old < rhs {
                old
            } else {
                rhs
            }
        }
        Maxu => {
            if old > rhs {
                old
            } else {
                rhs
            }
        }
    }
}

/// AMO read-modify-write on the 64-bit (D) value.
#[inline(always)]
const fn amo_d(op: crate::decode::AmoOp, old: u64, rhs: u64) -> u64 {
    use crate::decode::AmoOp::*;
    match op {
        Swap => rhs,
        Add => old.wrapping_add(rhs),
        Xor => old ^ rhs,
        And => old & rhs,
        Or => old | rhs,
        Min => {
            if (old as i64) < (rhs as i64) {
                old
            } else {
                rhs
            }
        }
        Max => {
            if (old as i64) > (rhs as i64) {
                old
            } else {
                rhs
            }
        }
        Minu => {
            if old < rhs {
                old
            } else {
                rhs
            }
        }
        Maxu => {
            if old > rhs {
                old
            } else {
                rhs
            }
        }
    }
}

/// Do the store range `[addr, addr+len)` and the reservation `(ra, rw)` overlap? An
/// overlapping ordinary store invalidates the LR/SC reservation (A-extension spec).
#[inline(always)]
const fn overlaps(addr: u64, len: u64, ra: u64, rw: u64) -> bool {
    addr < ra.wrapping_add(rw) && ra < addr.wrapping_add(len)
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
        self.resv = None;
        self.fregs = fregs::FRegs::default();
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
        let (rd, value, mem) = self.execute(bus, instr, insn)?;
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
        insn: u32,
    ) -> Result<(u8, u64, Option<crate::trace::MemOp>), Trap> {
        use crate::trace::MemOp;
        use Instr::*;
        // F/D: every FP instruction requires mstatus.FS != Off (E1-T06). Checked before any
        // architectural read, so an FS=Off trap leaves fflags and the f-registers untouched.
        if is_fp(&instr) && self.csr.fp_off() {
            return Err(Trap {
                cause: Exception::IllegalInstruction,
                tval: insn as u64,
            });
        }
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

            // ── M extension (E1-T03) ────────────────────────────────────────
            // Products use wide intermediates; the div/rem edge cases are the spec's
            // trap-free definitions (Unprivileged ISA "M" chapter) — Rust's own
            // divide-by-zero and MIN/-1 overflow panics must never be reached, so every
            // divisor-zero and overflow case is branched out BEFORE the `/` or `%`.
            Mul { rd, rs1, rs2 } => (rd, r.read(rs1).wrapping_mul(r.read(rs2)), pc4),
            // MULH: high 64 of the signed×signed 128-bit product.
            Mulh { rd, rs1, rs2 } => {
                let p = (r.read(rs1) as i64 as i128) * (r.read(rs2) as i64 as i128);
                (rd, (p >> 64) as u64, pc4)
            }
            // MULHSU: high 64 of signed(rs1) × unsigned(rs2). The tricky one: rs1 is
            // sign-extended into i128 (may be negative); rs2 is ZERO-extended (u64→u128,
            // always in 0..2^64, so non-negative) then viewed as i128. Their exact
            // product fits in i128 (|i64|·u64 < 2^127); an arithmetic >>64 keeps the sign.
            Mulhsu { rd, rs1, rs2 } => {
                let p = (r.read(rs1) as i64 as i128) * (r.read(rs2) as u128 as i128);
                (rd, (p >> 64) as u64, pc4)
            }
            // MULHU: high 64 of the unsigned×unsigned 128-bit product.
            Mulhu { rd, rs1, rs2 } => {
                let p = (r.read(rs1) as u128) * (r.read(rs2) as u128);
                (rd, (p >> 64) as u64, pc4)
            }
            Div { rd, rs1, rs2 } => {
                let (a, b) = (r.read(rs1) as i64, r.read(rs2) as i64);
                let q = if b == 0 {
                    -1i64 // div by zero → all ones
                } else if a == i64::MIN && b == -1 {
                    i64::MIN // signed overflow → dividend
                } else {
                    a.wrapping_div(b)
                };
                (rd, q as u64, pc4)
            }
            // Unsigned div/rem: checked_* returns None ONLY on divisor zero (no unsigned
            // overflow case), giving the spec's all-ones / dividend results panic-free.
            Divu { rd, rs1, rs2 } => {
                let (a, b) = (r.read(rs1), r.read(rs2));
                (rd, a.checked_div(b).unwrap_or(u64::MAX), pc4)
            }
            Rem { rd, rs1, rs2 } => {
                let (a, b) = (r.read(rs1) as i64, r.read(rs2) as i64);
                let rem = if b == 0 {
                    a // rem by zero → dividend
                } else if a == i64::MIN && b == -1 {
                    0 // overflow → 0
                } else {
                    a.wrapping_rem(b)
                };
                (rd, rem as u64, pc4)
            }
            Remu { rd, rs1, rs2 } => {
                let (a, b) = (r.read(rs1), r.read(rs2));
                (rd, a.checked_rem(b).unwrap_or(a), pc4)
            }
            // W forms: operate on the low 32 bits (upper bits of the sources are
            // ignored per spec), then sign-extend the 32-bit result to 64.
            Mulw { rd, rs1, rs2 } => (
                rd,
                sext32((r.read(rs1) as u32).wrapping_mul(r.read(rs2) as u32)),
                pc4,
            ),
            Divw { rd, rs1, rs2 } => {
                let (a, b) = (r.read(rs1) as i32, r.read(rs2) as i32);
                let q = if b == 0 {
                    -1i32
                } else if a == i32::MIN && b == -1 {
                    i32::MIN
                } else {
                    a.wrapping_div(b)
                };
                (rd, sext32(q as u32), pc4)
            }
            // DIVUW: unsigned 32-bit divide, result STILL sign-extended from bit 31
            // (so a 0xFFFF_FFFF quotient reads back as 0xFFFF_FFFF_FFFF_FFFF).
            Divuw { rd, rs1, rs2 } => {
                let (a, b) = (r.read(rs1) as u32, r.read(rs2) as u32);
                (rd, sext32(a.checked_div(b).unwrap_or(u32::MAX)), pc4)
            }
            Remw { rd, rs1, rs2 } => {
                let (a, b) = (r.read(rs1) as i32, r.read(rs2) as i32);
                let rem = if b == 0 {
                    a
                } else if a == i32::MIN && b == -1 {
                    0
                } else {
                    a.wrapping_rem(b)
                };
                (rd, sext32(rem as u32), pc4)
            }
            Remuw { rd, rs1, rs2 } => {
                let (a, b) = (r.read(rs1) as u32, r.read(rs2) as u32);
                (rd, sext32(a.checked_rem(b).unwrap_or(a)), pc4)
            }

            // ── A extension (E1-T04) ────────────────────────────────────────
            // aq/rl are decoded but no-ops for a single in-order hart. LR/SC/AMO require
            // natural alignment: a misaligned LR faults cause 4 (load), a misaligned
            // SC/AMO faults cause 6 (store/AMO) — checked before any memory touch, so a
            // misalignment trap leaves memory and the reservation unchanged.
            LrW { rd, rs1, .. } => {
                let a = r.read(rs1);
                let v = bus.load32(a).map_err(|f| load_fault(f, a))?;
                self.resv = Some((a, 4));
                mem = Some(MemOp {
                    addr: a,
                    len: 4,
                    is_store: false,
                    value: 0,
                });
                (rd, sext32(v), pc4)
            }
            LrD { rd, rs1, .. } => {
                let a = r.read(rs1);
                let v = bus.load64(a).map_err(|f| load_fault(f, a))?;
                self.resv = Some((a, 8));
                mem = Some(MemOp {
                    addr: a,
                    len: 8,
                    is_store: false,
                    value: 0,
                });
                (rd, v, pc4)
            }
            // SC succeeds only against a valid reservation for the SAME address AND width
            // (a width mismatch, e.g. LR.W then SC.D, fails — never a wrong-width write).
            // Success writes memory and rd=0; failure writes nothing and rd=1. Either way
            // the reservation is consumed. Misalignment is checked first (reservation
            // preserved on that trap).
            ScW { rd, rs1, rs2, .. } => {
                let a = r.read(rs1);
                if !a.is_multiple_of(4) {
                    return Err(Trap {
                        cause: Exception::StoreAddrMisaligned,
                        tval: a,
                    });
                }
                let success = self.resv == Some((a, 4));
                self.resv = None;
                if success {
                    let val = r.read(rs2);
                    bus.store32(a, val as u32).map_err(|f| store_fault(f, a))?;
                    mem = Some(MemOp {
                        addr: a,
                        len: 4,
                        is_store: true,
                        value: val,
                    });
                    (rd, 0, pc4)
                } else {
                    (rd, 1, pc4)
                }
            }
            ScD { rd, rs1, rs2, .. } => {
                let a = r.read(rs1);
                if !a.is_multiple_of(8) {
                    return Err(Trap {
                        cause: Exception::StoreAddrMisaligned,
                        tval: a,
                    });
                }
                let success = self.resv == Some((a, 8));
                self.resv = None;
                if success {
                    let val = r.read(rs2);
                    bus.store64(a, val).map_err(|f| store_fault(f, a))?;
                    mem = Some(MemOp {
                        addr: a,
                        len: 8,
                        is_store: true,
                        value: val,
                    });
                    (rd, 0, pc4)
                } else {
                    (rd, 1, pc4)
                }
            }
            // AMO: atomic load → op → store (single-threaded, so a plain RMW). rd gets the
            // OLD value (sign-extended for W). AMO faults are store/AMO-class (cause 6/7).
            // Alignment is pre-checked, so the load/store legs only ever access-fault.
            AmoW {
                op, rd, rs1, rs2, ..
            } => {
                let a = r.read(rs1);
                if !a.is_multiple_of(4) {
                    return Err(Trap {
                        cause: Exception::StoreAddrMisaligned,
                        tval: a,
                    });
                }
                let old = bus.load32(a).map_err(|f| store_fault(f, a))?;
                let new = amo_w(op, old, r.read(rs2) as u32);
                bus.store32(a, new).map_err(|f| store_fault(f, a))?;
                mem = Some(MemOp {
                    addr: a,
                    len: 4,
                    is_store: true,
                    value: new as u64,
                });
                (rd, sext32(old), pc4)
            }
            AmoD {
                op, rd, rs1, rs2, ..
            } => {
                let a = r.read(rs1);
                if !a.is_multiple_of(8) {
                    return Err(Trap {
                        cause: Exception::StoreAddrMisaligned,
                        tval: a,
                    });
                }
                let old = bus.load64(a).map_err(|f| store_fault(f, a))?;
                let new = amo_d(op, old, r.read(rs2));
                bus.store64(a, new).map_err(|f| store_fault(f, a))?;
                mem = Some(MemOp {
                    addr: a,
                    len: 8,
                    is_store: true,
                    value: new,
                });
                (rd, old, pc4)
            }

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

            // ── Zicsr / Zifencei / xRET (E1-T02) ────────────────────────────
            // FENCE.I is a no-op for an in-order interpreter (no store buffer / i-cache).
            FenceI => (0, 0, pc4),
            // Wait-for-interrupt retires as a no-op (no interrupts at this level). Per our
            // conservative A-extension policy it drops any LR/SC reservation (E1-T04).
            Wfi => {
                self.resv = None;
                (0, 0, pc4)
            }
            // Return from trap: pc ← mepc. (Full mstatus.MPP/MPIE restore lands with trap
            // delivery; here we transfer control, which is what the p-env needs.)
            Mret => {
                let target = self.csr.access(
                    crate::csr::MEPC,
                    crate::csr::CsrOp::Set,
                    0,
                    true, // src==0 ⇒ read-only access, no write
                    false,
                    insn as u64,
                )?;
                // xRET drops any LR/SC reservation (E1-T04, conservative documented policy).
                self.resv = None;
                (0, 0, target)
            }
            // CSR read/modify/write with spec side-effect suppression, delegated to the
            // one CSR authority. `value` (the old CSR value) retires into rd; the CSR side
            // effect happened inside access().
            Csrrw { rd, rs1, csr } => {
                let src = r.read(rs1);
                let old = self.csr.access(
                    csr,
                    crate::csr::CsrOp::Write,
                    src,
                    false,
                    rd == 0,
                    insn as u64,
                )?;
                (rd, old, pc4)
            }
            Csrrs { rd, rs1, csr } => {
                let src = r.read(rs1);
                let old = self.csr.access(
                    csr,
                    crate::csr::CsrOp::Set,
                    src,
                    rs1 == 0,
                    rd == 0,
                    insn as u64,
                )?;
                (rd, old, pc4)
            }
            Csrrc { rd, rs1, csr } => {
                let src = r.read(rs1);
                let old = self.csr.access(
                    csr,
                    crate::csr::CsrOp::Clear,
                    src,
                    rs1 == 0,
                    rd == 0,
                    insn as u64,
                )?;
                (rd, old, pc4)
            }
            Csrrwi { rd, uimm, csr } => {
                let old = self.csr.access(
                    csr,
                    crate::csr::CsrOp::Write,
                    uimm as u64,
                    false,
                    rd == 0,
                    insn as u64,
                )?;
                (rd, old, pc4)
            }
            Csrrsi { rd, uimm, csr } => {
                let old = self.csr.access(
                    csr,
                    crate::csr::CsrOp::Set,
                    uimm as u64,
                    uimm == 0,
                    rd == 0,
                    insn as u64,
                )?;
                (rd, old, pc4)
            }
            Csrrci { rd, uimm, csr } => {
                let old = self.csr.access(
                    csr,
                    crate::csr::CsrOp::Clear,
                    uimm as u64,
                    uimm == 0,
                    rd == 0,
                    insn as u64,
                )?;
                (rd, old, pc4)
            }

            // ── F extension (E1-T06) ────────────────────────────────────────
            // FS!=Off already checked at the top. Ops that write FP state (an f-register or
            // fflags) mark FS Dirty; FSW/FMV.X.W/FCLASS.S do not (they write memory/x-regs
            // only). rm-carrying ops resolve the rounding mode and trap on a reserved value.
            Flw { rd, rs1, imm } => {
                let a = ea(r.read(rs1), imm);
                mem = Some(MemOp {
                    addr: a,
                    len: 4,
                    is_store: false,
                    value: 0,
                });
                let v = bus.load32(a).map_err(|f| load_fault(f, a))?;
                self.fregs.write_f32(rd, v);
                self.csr.mark_fp_dirty();
                (0, 0, pc4)
            }
            Fsw { rs1, rs2, imm } => {
                let a = ea(r.read(rs1), imm);
                let v = self.fregs.read_raw(rs2) as u32; // raw low 32 bits
                mem = Some(MemOp {
                    addr: a,
                    len: 4,
                    is_store: true,
                    value: u64::from(v),
                });
                bus.store32(a, v).map_err(|f| store_fault(f, a))?;
                (0, 0, pc4)
            }
            FpArithS {
                op,
                rd,
                rs1,
                rs2,
                rm,
            } => {
                let round = match self.csr.resolve_rm(rm) {
                    Some(x) => x,
                    None => {
                        return Err(Trap {
                            cause: Exception::IllegalInstruction,
                            tval: insn as u64,
                        });
                    }
                };
                let (a, b) = (self.fregs.read_f32(rs1), self.fregs.read_f32(rs2));
                use crate::decode::FpArithOp::*;
                let (res, flags) = match op {
                    Add => F32::add(a, b, round),
                    Sub => F32::sub(a, b, round),
                    Mul => F32::mul(a, b, round),
                    Div => F32::div(a, b, round),
                };
                self.fregs.write_f32(rd, res);
                self.csr.accrue_fflags(flags.0);
                self.csr.mark_fp_dirty();
                (0, 0, pc4)
            }
            FsqrtS { rd, rs1, rm } => {
                let round = match self.csr.resolve_rm(rm) {
                    Some(x) => x,
                    None => {
                        return Err(Trap {
                            cause: Exception::IllegalInstruction,
                            tval: insn as u64,
                        });
                    }
                };
                let (res, flags) = F32::sqrt(self.fregs.read_f32(rs1), round);
                self.fregs.write_f32(rd, res);
                self.csr.accrue_fflags(flags.0);
                self.csr.mark_fp_dirty();
                (0, 0, pc4)
            }
            FpFusedS {
                op,
                rd,
                rs1,
                rs2,
                rs3,
                rm,
            } => {
                let round = match self.csr.resolve_rm(rm) {
                    Some(x) => x,
                    None => {
                        return Err(Trap {
                            cause: Exception::IllegalInstruction,
                            tval: insn as u64,
                        });
                    }
                };
                let a = self.fregs.read_f32(rs1);
                let b = self.fregs.read_f32(rs2);
                let c = self.fregs.read_f32(rs3);
                use crate::decode::FpFusedOp::*;
                // Negate a operand by flipping its sign bit; the fused product/sum sign
                // follows. (a*b)±c with the four sign patterns.
                let neg = 0x8000_0000u32;
                let (aa, cc) = match op {
                    Madd => (a, c),
                    Msub => (a, c ^ neg),
                    Nmsub => (a ^ neg, c),
                    Nmadd => (a ^ neg, c ^ neg),
                };
                let (res, flags) = F32::fma(aa, b, cc, round);
                self.fregs.write_f32(rd, res);
                self.csr.accrue_fflags(flags.0);
                self.csr.mark_fp_dirty();
                (0, 0, pc4)
            }
            FsgnjS { op, rd, rs1, rs2 } => {
                let a = self.fregs.read_f32(rs1);
                let b = self.fregs.read_f32(rs2);
                use crate::decode::FpSgnjOp::*;
                let sign = match op {
                    J => b & 0x8000_0000,
                    Jn => !b & 0x8000_0000,
                    Jx => (a ^ b) & 0x8000_0000,
                };
                self.fregs.write_f32(rd, (a & 0x7FFF_FFFF) | sign);
                self.csr.mark_fp_dirty();
                (0, 0, pc4)
            }
            FminmaxS {
                is_max,
                rd,
                rs1,
                rs2,
            } => {
                let (res, flags) = crate::softfloat::f32_minmax(
                    self.fregs.read_f32(rs1),
                    self.fregs.read_f32(rs2),
                    is_max,
                );
                self.fregs.write_f32(rd, res);
                self.csr.accrue_fflags(flags.0);
                self.csr.mark_fp_dirty();
                (0, 0, pc4)
            }
            FpCmpS { op, rd, rs1, rs2 } => {
                let a = self.fregs.read_f32(rs1);
                let b = self.fregs.read_f32(rs2);
                use crate::decode::FpCmpOp::*;
                let (res, flags) = match op {
                    Eq => F32::eq(a, b),
                    Lt => F32::lt(a, b),
                    Le => F32::le(a, b),
                };
                self.csr.accrue_fflags(flags.0);
                self.csr.mark_fp_dirty();
                (rd, res as u64, pc4)
            }
            FclassS { rd, rs1 } => {
                let mask = crate::softfloat::fclass_f32(self.fregs.read_f32(rs1));
                (rd, mask, pc4)
            }
            FmvXW { rd, rs1 } => {
                // Raw low-32-bit move, sign-extended (no NaN-box canonicalization).
                (rd, sext32(self.fregs.read_raw(rs1) as u32), pc4)
            }
            FmvWX { rd, rs1 } => {
                self.fregs.write_f32(rd, r.read(rs1) as u32);
                self.csr.mark_fp_dirty();
                (0, 0, pc4)
            }
            FcvtToIntS { width, rd, rs1, rm } => {
                let round = match self.csr.resolve_rm(rm) {
                    Some(x) => x,
                    None => {
                        return Err(Trap {
                            cause: Exception::IllegalInstruction,
                            tval: insn as u64,
                        });
                    }
                };
                let (res, flags) =
                    crate::softfloat::f32_to_int(self.fregs.read_f32(rs1), width, round);
                self.csr.accrue_fflags(flags.0);
                self.csr.mark_fp_dirty();
                (rd, res, pc4)
            }
            FcvtFromIntS { width, rd, rs1, rm } => {
                let round = match self.csr.resolve_rm(rm) {
                    Some(x) => x,
                    None => {
                        return Err(Trap {
                            cause: Exception::IllegalInstruction,
                            tval: insn as u64,
                        });
                    }
                };
                let (res, flags) = crate::softfloat::f32_from_int(r.read(rs1), width, round);
                self.fregs.write_f32(rd, res);
                self.csr.accrue_fflags(flags.0);
                self.csr.mark_fp_dirty();
                (0, 0, pc4)
            }
        };
        // A-extension reservation invalidation (E1-T04): a *successful* store that
        // overlaps the reservation granule clears it. Centralized here so every store
        // path (ordinary SB..SD and the AMO writes) is covered once; runs only on Ok, so
        // a faulting store never invalidates. SC manages its own reservation inside its
        // arm (and its successful store also lands here, harmlessly re-clearing None).
        if let (Some(m), Some((ra, rw))) = (&mem, self.resv)
            && m.is_store
            && overlaps(m.addr, m.len as u64, ra, rw as u64)
        {
            self.resv = None;
        }
        // Single retirement point: x0-discard is enforced by XRegs::write.
        r.write(rd, value);
        r.pc = next_pc;
        Ok((rd, value, mem))
    }
}
