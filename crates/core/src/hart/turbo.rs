//! Inline execution of the hot instruction classes for the machine's turbo run loop
//! (`Machine::run_turbo`).
//!
//! [`Hart::turbo_step`] executes one decoded load, store, branch or jump when — and only when —
//! the ordinary executor ([`Hart::execute`]) would complete it without leaving the hart: an
//! aligned data access served by a live fast-TLB entry (so the page is all RAM, PMP-permitted and
//! already translated), or a control transfer to an aligned target. For those it performs exactly
//! the architectural effects `execute` performs, in the same order, including the retirement
//! capture calls and the fast-TLB hit statistic. Anything else returns [`TurboStep::Slow`] having
//! touched nothing, and the caller runs the op through `execute` itself, so every fault, MMIO
//! access, misaligned access, page walk and trigger keeps its single implementation.

use super::{Hart, RetirementCapture, STORE_CTX_MASK, data_ctx, ea, overlaps};
use crate::decode::Instr;
use crate::mmio::SystemBus;
use crate::tlb::{FAST_LOAD, FAST_STORE};

/// The CSR inputs of a data access that are constant while the turbo loop runs inline ops: none
/// of them can change without a CSR instruction, a trap or an xRET, all of which leave the loop.
#[derive(Clone, Copy)]
pub(crate) struct TurboCtx {
    load_ctx: u64,
    store_ctx: u64,
    pmp_rev: u64,
}

/// Outcome of [`Hart::turbo_step`].
pub(crate) enum TurboStep<O> {
    /// Retired inline; registers and the PC are updated.
    Retired(O),
    /// Retired inline after storing to RAM at this physical address (the access lies in one page).
    Stored(O, u64),
    /// Not executed and nothing touched: run it through [`Hart::execute`].
    Slow,
}

impl Hart {
    /// The data-access context for inline execution, or `None` while a debug trigger is armed
    /// (triggers bypass the fast TLB, so nothing could run inline).
    #[inline(always)]
    pub(crate) fn turbo_ctx(&self) -> Option<TurboCtx> {
        if !self.csr.triggers_idle() {
            return None;
        }
        let (_, ctx) = data_ctx(&self.csr);
        Some(TurboCtx {
            load_ctx: ctx,
            store_ctx: ctx & STORE_CTX_MASK,
            pmp_rev: self.csr.pmp.revision(),
        })
    }

    /// Physical address of an aligned `len`-byte access of `kind` at `va` on a live fast-TLB hit.
    /// The same probe, with the same hit accounting, as the ordinary load/store fast path.
    #[inline(always)]
    fn turbo_probe(
        &mut self,
        kind: usize,
        va: u64,
        len: u64,
        ctx: u64,
        pmp_rev: u64,
    ) -> Option<u64> {
        if va & (len - 1) != 0 {
            return None;
        }
        let pa = self.tlb.fast_lookup(kind, va, ctx, pmp_rev)?;
        debug_assert_eq!(
            self.csr.satp(),
            self.tlb.fast_satp(),
            "satp changed without Tlb::fast_flush (a stale fast entry just hit)"
        );
        Some(pa)
    }

    /// Execute `instr` inline if it is a load, store, branch or jump that needs nothing beyond the
    /// hart and RAM (see the module docs). `insn_len` is the guest instruction length.
    #[inline(always)]
    pub(crate) fn turbo_step<C: RetirementCapture>(
        &mut self,
        bus: &mut SystemBus,
        ctx: &TurboCtx,
        instr: Instr,
        insn_len: u64,
        capture: &mut C,
    ) -> TurboStep<C::Output> {
        use Instr::*;
        let pc = self.regs.pc;
        let pc_next = pc.wrapping_add(insn_len);

        macro_rules! load {
            ($rd:expr, $rs1:expr, $imm:expr, $w:literal, $bytes:ident => $value:expr) => {{
                let a = ea(self.regs.read($rs1), $imm);
                let Some(pa) = self.turbo_probe(FAST_LOAD, a, $w, ctx.load_ctx, ctx.pmp_rev) else {
                    return TurboStep::Slow;
                };
                let Some($bytes) = bus.turbo_load::<$w>(pa) else {
                    debug_assert!(false, "a fast-TLB entry covered a non-RAM page");
                    return TurboStep::Slow;
                };
                capture.load(a, $w);
                let value: u64 = $value;
                self.regs.write($rd, value);
                self.regs.pc = pc_next;
                TurboStep::Retired(capture.finish($rd, value))
            }};
        }
        macro_rules! store {
            ($rs1:expr, $rs2:expr, $imm:expr, $w:literal, $ty:ty) => {{
                let a = ea(self.regs.read($rs1), $imm);
                let v = self.regs.read($rs2);
                let Some(pa) = self.turbo_probe(FAST_STORE, a, $w, ctx.store_ctx, ctx.pmp_rev)
                else {
                    return TurboStep::Slow;
                };
                if !bus.turbo_store::<$w>(pa, (v as $ty).to_le_bytes()) {
                    debug_assert!(false, "a fast-TLB entry covered a non-RAM page");
                    return TurboStep::Slow;
                }
                capture.store(a, $w, v);
                // A successful store that overlaps the LR/SC reservation granule clears it.
                if let Some((ra, rw)) = self.resv
                    && overlaps(a, $w, ra, u64::from(rw))
                {
                    self.resv = None;
                }
                self.regs.pc = pc_next;
                TurboStep::Stored(capture.finish(0, 0), pa)
            }};
        }
        macro_rules! branch {
            ($rs1:expr, $rs2:expr, $imm:expr, |$a:ident, $b:ident| $taken:expr) => {{
                let $a = self.regs.read($rs1);
                let $b = self.regs.read($rs2);
                let next = if $taken {
                    let target = pc.wrapping_add($imm as u64);
                    if target & 1 != 0 {
                        return TurboStep::Slow;
                    }
                    target
                } else {
                    pc_next
                };
                self.regs.pc = next;
                TurboStep::Retired(capture.finish(0, 0))
            }};
        }

        match instr {
            Ld { rd, rs1, imm } => load!(rd, rs1, imm, 8, b => u64::from_le_bytes(b)),
            Lw { rd, rs1, imm } => load!(rd, rs1, imm, 4, b => i32::from_le_bytes(b) as i64 as u64),
            Lwu { rd, rs1, imm } => load!(rd, rs1, imm, 4, b => u64::from(u32::from_le_bytes(b))),
            Lh { rd, rs1, imm } => load!(rd, rs1, imm, 2, b => i16::from_le_bytes(b) as i64 as u64),
            Lhu { rd, rs1, imm } => load!(rd, rs1, imm, 2, b => u64::from(u16::from_le_bytes(b))),
            Lb { rd, rs1, imm } => load!(rd, rs1, imm, 1, b => b[0] as i8 as i64 as u64),
            Lbu { rd, rs1, imm } => load!(rd, rs1, imm, 1, b => u64::from(b[0])),

            Sd { rs1, rs2, imm } => store!(rs1, rs2, imm, 8, u64),
            Sw { rs1, rs2, imm } => store!(rs1, rs2, imm, 4, u32),
            Sh { rs1, rs2, imm } => store!(rs1, rs2, imm, 2, u16),
            Sb { rs1, rs2, imm } => store!(rs1, rs2, imm, 1, u8),

            Beq { rs1, rs2, imm } => branch!(rs1, rs2, imm, |a, b| a == b),
            Bne { rs1, rs2, imm } => branch!(rs1, rs2, imm, |a, b| a != b),
            Blt { rs1, rs2, imm } => branch!(rs1, rs2, imm, |a, b| (a as i64) < (b as i64)),
            Bge { rs1, rs2, imm } => branch!(rs1, rs2, imm, |a, b| (a as i64) >= (b as i64)),
            Bltu { rs1, rs2, imm } => branch!(rs1, rs2, imm, |a, b| a < b),
            Bgeu { rs1, rs2, imm } => branch!(rs1, rs2, imm, |a, b| a >= b),

            Jal { rd, imm } => {
                let target = pc.wrapping_add(imm as u64);
                if target & 1 != 0 {
                    return TurboStep::Slow;
                }
                self.regs.write(rd, pc_next);
                self.regs.pc = target;
                TurboStep::Retired(capture.finish(rd, pc_next))
            }
            Jalr { rd, rs1, imm } => {
                // Target first, so `jalr rd, rd` jumps through the old value.
                let target = ea(self.regs.read(rs1), imm) & !1;
                self.regs.write(rd, pc_next);
                self.regs.pc = target;
                TurboStep::Retired(capture.finish(rd, pc_next))
            }
            _ => TurboStep::Slow,
        }
    }
}
