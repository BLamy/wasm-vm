//! Instruction-trace hooks (E0-T15 scaffold; E0-T16 fills in real records).
//!
//! ZERO-COST DESIGN: tracing is delivered through a generic [`TraceSink`] type
//! parameter, not a runtime `if tracing` branch. The default [`NullSink`] has empty
//! `#[inline(always)]` methods, so a release build of the null-sink `step` path
//! monomorphizes the hook away entirely — trace-off is *zero cost*, not merely cheap.
//! Anything with a genuine data cost (allocating records) lives behind
//! `#[cfg(feature = "trace")]`.

/// A consumer of per-instruction retirement events. The hart calls [`on_retire`]
/// AFTER an instruction fully retires (never on a trapping step — a faulting
/// instruction produces no retire record, matching the trap-purity contract).
///
/// [`on_retire`]: TraceSink::on_retire
pub trait TraceSink {
    /// `pc` is the retired instruction's own address; `insn` its raw 32-bit word.
    fn on_retire(&mut self, pc: u64, insn: u32);
}

/// The zero-cost default sink: every method is empty and force-inlined, so the
/// optimizer erases the hook from the null-sink hot path.
pub struct NullSink;

impl TraceSink for NullSink {
    #[inline(always)]
    fn on_retire(&mut self, _pc: u64, _insn: u32) {}
}
