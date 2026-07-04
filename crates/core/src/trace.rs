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

/// A rolling FNV-1a-64 fold over retire records — the E1-T22 native-vs-WASM determinism
/// fingerprint. ALWAYS compiled and allocation-free (no `Vec`, unlike [`VecSink`]), so it hashes a
/// multi-million-instruction run in constant memory where the text sink cannot. The fold uses only
/// wrapping integer arithmetic — no host float, no `usize`, no container iteration — so the hash is
/// bit-identical on native and wasm32 by construction.
///
/// Hash input is EXACTLY the guest-visible retirement effects — `{pc, insn, rd index+value, mem
/// {addr,len,is_store,value}}` — plus the retire count. `rd == None` and `mem == None` fold a
/// distinct sentinel so "wrote x5=0" and "wrote nothing" (and "loaded addr" vs "no mem") never
/// collide. What is deliberately NOT hashed and why: f-registers/fcsr are covered because every FP
/// result reaches an x-register (FMV/FCVT/FCLASS/FLE) or memory (FSD) or fflags (a CSR write that
/// retires as an `rd` value) — a divergent FP bit that never becomes guest-visible is not an
/// architectural divergence; CSR state is covered via the final [`crate::snapshot::Snapshot`] the
/// determinism harness compares ALONGSIDE this hash (the two together are the full fingerprint).
pub struct HashSink {
    state: u64,
    retired: u64,
}

impl Default for HashSink {
    fn default() -> Self {
        Self::new()
    }
}

impl HashSink {
    /// FNV-1a-64 offset basis.
    pub const fn new() -> Self {
        HashSink {
            state: 0xcbf2_9ce4_8422_2325,
            retired: 0,
        }
    }
    #[inline(always)]
    fn fold(&mut self, x: u64) {
        self.state ^= x;
        self.state = self.state.wrapping_mul(0x0000_0100_0000_01b3); // FNV prime
    }
    /// The rolling hash of every retirement so far.
    pub const fn hash(&self) -> u64 {
        self.state
    }
    /// Number of instructions folded in.
    pub const fn retired(&self) -> u64 {
        self.retired
    }
}

impl TraceSink for HashSink {
    #[inline]
    fn retire(&mut self, r: &TraceRecord) {
        self.fold(r.pc);
        self.fold(u64::from(r.insn));
        match r.rd {
            // Tag the rd index high so x0 vs "no write" and different regs never collide.
            Some((i, v)) => {
                self.fold(0x0100_0000_0000_0000 | u64::from(i));
                self.fold(v);
            }
            None => self.fold(0x0200_0000_0000_0000),
        }
        match r.mem {
            Some(m) => {
                self.fold(m.addr);
                self.fold((u64::from(m.len) << 1) | u64::from(m.is_store));
                self.fold(m.value);
            }
            None => self.fold(0x0400_0000_0000_0000),
        }
        self.retired = self.retired.wrapping_add(1);
    }
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
