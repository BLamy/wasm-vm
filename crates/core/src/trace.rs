//! Instruction-level trace records (E0-T16), built on the E0-T15 zero-cost hook.
//!
//! Every retired instruction can emit a structured [`TraceRecord`] into a pluggable
//! [`TraceSink`], with a frozen canonical text serialization ([`fmt_canonical`])
//! designed to diff byte-for-byte against a normalized Spike `--log-commits` log — and
//! to be identical from native and wasm builds. The format grammar and its x0 / fault /
//! width rules are specified in `docs/trace-format.md`; changing it invalidates golden
//! files, so it is versioned there.
//!
//! ZERO-COST: [`TraceSink`], [`TraceRecord`], [`MemOp`], and [`NullSink`] are always
//! available (the hart's hot loop uses `NullSink` unconditionally). The record is built
//! and handed to `sink.retire(...)` generically; with `NullSink`'s empty
//! `#[inline(always)]` method the whole thing monomorphizes away — proven by
//! `tools/check-zero-cost.sh`. The `trace` feature adds the DATA-cost machinery
//! ([`VecSink`] storage, [`WriteSink`] streaming); the core hook itself is free.

/// One memory access performed by a retired instruction. `value` is meaningful for
/// stores only (the bytes actually written, masked to `len`); loads log just the
/// address per the canonical grammar.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct MemOp {
    pub addr: u64,
    /// Access width in bytes: 1, 2, 4, or 8.
    pub len: u8,
    pub is_store: bool,
    /// Stored value (masked to `len` bytes); ignored for loads.
    pub value: u64,
}

/// What a single retired instruction did. A faulting instruction does not retire and
/// produces no record. `rd` is `None` when the instruction writes no register or writes
/// `x0` (the canonical line omits the register field in both cases).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct TraceRecord {
    pub pc: u64,
    pub insn: u32,
    pub rd: Option<(u8, u64)>,
    pub mem: Option<MemOp>,
}

/// A consumer of retirement records. The hart calls [`retire`] AFTER an instruction
/// fully retires (never on a trapping step).
///
/// [`retire`]: TraceSink::retire
pub trait TraceSink {
    fn retire(&mut self, record: &TraceRecord);
}

/// The zero-cost default: an empty force-inlined sink the optimizer erases.
pub struct NullSink;

impl TraceSink for NullSink {
    #[inline(always)]
    fn retire(&mut self, _record: &TraceRecord) {}
}

/// Canonical line serialization of a record — a [`core::fmt::Display`] wrapper, so it is
/// `no_std` and allocation-free (write straight into any formatter). One retired
/// instruction per line; the caller adds the `\n`.
///
/// Grammar (frozen; see `docs/trace-format.md`):
/// ```text
/// core 0: 0x{pc:016x} (0x{insn:08x})[ x{rd} 0x{val:016x}][ mem 0x{addr:016x}[ 0x{sval:0(2*len)x}]]
/// ```
/// The store-value field is `2*len` hex digits of the masked written bytes; loads omit
/// it. `x0`/no-write omit the register field.
pub fn fmt_canonical(record: &TraceRecord) -> Canonical<'_> {
    Canonical(record)
}

/// Display wrapper returned by [`fmt_canonical`].
pub struct Canonical<'a>(pub &'a TraceRecord);

impl core::fmt::Display for Canonical<'_> {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        let r = self.0;
        write!(f, "core 0: {:#018x} ({:#010x})", r.pc, r.insn)?;
        if let Some((rd, val)) = r.rd {
            write!(f, " x{rd} {val:#018x}")?;
        }
        if let Some(m) = r.mem {
            write!(f, " mem {:#018x}", m.addr)?;
            if m.is_store {
                let width = 2 * m.len as usize;
                let masked = if m.len >= 8 {
                    m.value
                } else {
                    m.value & ((1u64 << (8 * m.len)) - 1)
                };
                write!(f, " 0x{masked:0width$x}")?;
            }
        }
        Ok(())
    }
}

/// A sink that stores every record — the workhorse for tests and the differential
/// harness (E0-T20). Behind `feature = "trace"` (its `Vec` growth is the data cost the
/// feature gates). Memory cost: `size_of::<TraceRecord>()` (~40 B) per retired
/// instruction; a 1M-instruction run holds ~40 MB.
#[cfg(feature = "trace")]
#[derive(Default)]
pub struct VecSink {
    pub records: alloc::vec::Vec<TraceRecord>,
}

#[cfg(feature = "trace")]
impl VecSink {
    pub fn new() -> Self {
        Self::default()
    }

    /// Render the whole capture as canonical `\n`-terminated lines.
    pub fn canonical(&self) -> alloc::string::String {
        use core::fmt::Write as _;
        let mut s = alloc::string::String::new();
        for r in &self.records {
            let _ = writeln!(s, "{}", fmt_canonical(r));
        }
        s
    }
}

#[cfg(feature = "trace")]
impl TraceSink for VecSink {
    fn retire(&mut self, record: &TraceRecord) {
        self.records.push(*record);
    }
}

/// Streams canonical lines to any [`std::io::Write`] (the CLI's `--trace` output).
/// std + `trace` only.
#[cfg(all(feature = "trace", feature = "std"))]
pub struct WriteSink<W: std::io::Write> {
    pub out: W,
}

#[cfg(all(feature = "trace", feature = "std"))]
impl<W: std::io::Write> TraceSink for WriteSink<W> {
    fn retire(&mut self, record: &TraceRecord) {
        let _ = writeln!(self.out, "{}", fmt_canonical(record));
    }
}
