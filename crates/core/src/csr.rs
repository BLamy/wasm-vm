//! Control and status registers (E1-T01 reset state + E1-T02 Zicsr subsystem).
//!
//! One table-driven CSR file every later task (mstatus fields, satp, counters, PMP) plugs
//! into instead of open-coding CSR behavior. It implements the Zicsr mechanics —
//! CSRRW/CSRRS/CSRRC and immediate forms with spec-exact **side-effect suppression**,
//! per-address **privilege** and **read-only** checks derived from the CSR encoding
//! (Privileged §2.1: `addr[11:10]==0b11` ⇒ read-only, `addr[9:8]` ⇒ min privilege), and
//! per-CSR **WARL** legalization.
//!
//! This is the real CSR state that supersedes E0-T19's quarantined `zicsr_stub`; the
//! decoder wires CSR instructions to it only when that feature is OFF, so the rv64ui-p
//! p-env path is unchanged until a later task migrates it.

use alloc::vec::Vec;

use crate::hart::{Exception, Trap};

/// `misa` for this implementation: MXL=2 (RV64), extensions **I M A F D C S U**. WARL and
/// hardwired — writes legalize to this, reads always return it (§3.1.1). Bits: A(0) C(2)
/// D(3) F(5) I(8) M(12) S(18) U(20), MXL=2 in bits 63:62.
pub const MISA_RV64GC_SU: u64 = 0x8000_0000_0014_112D;

// ── CSR addresses used here ───────────────────────────────────────────────────
/// Floating-point CSRs (E1-T06). User read/write (`addr[9:8]=00`, `addr[11:10]=00`).
/// `fcsr` aliases the pair: `fcsr[4:0] = fflags`, `fcsr[7:5] = frm`.
pub const FFLAGS: u16 = 0x001;
pub const FRM: u16 = 0x002;
pub const FCSR: u16 = 0x003;
pub const MSTATUS: u16 = 0x300;
pub const MISA: u16 = 0x301;
pub const MEDELEG: u16 = 0x302;
pub const MIDELEG: u16 = 0x303;
pub const MIE: u16 = 0x304;
pub const MTVEC: u16 = 0x305;
pub const MSCRATCH: u16 = 0x340;
pub const MEPC: u16 = 0x341;
pub const MCAUSE: u16 = 0x342;
pub const MTVAL: u16 = 0x343;
pub const MIP: u16 = 0x344;
pub const SATP: u16 = 0x180;
/// Supervisor trap vector (WARL-stored here; full S-mode semantics arrive with the MMU).
pub const STVEC: u16 = 0x105;
/// `mnstatus` (Smrnmi) — the riscv-tests p-env writes it during machine-mode init. Stored
/// WARL; its NMI semantics are out of scope until an interrupt task.
pub const MNSTATUS: u16 = 0x744;
pub const PMPCFG0: u16 = 0x3A0;
pub const PMPADDR0: u16 = 0x3B0;
pub const MVENDORID: u16 = 0xF11;
pub const MARCHID: u16 = 0xF12;
pub const MIMPID: u16 = 0xF13;
pub const MHARTID: u16 = 0xF14;
/// Test-only probe CSR with an observable read/write hook (side-effect suppression tests).
pub const PROBE: u16 = 0x7C0; // custom M-mode read/write space

/// Privilege mode (§1.2). The hart resets into machine mode.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Default)]
#[repr(u8)]
pub enum Priv {
    U = 0,
    S = 1,
    /// The reset privilege mode.
    #[default]
    M = 3,
}

/// The Zicsr operation, once the source operand is resolved to a value.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CsrOp {
    /// CSRRW/CSRRWI — replace.
    Write,
    /// CSRRS/CSRRSI — set bits.
    Set,
    /// CSRRC/CSRRCI — clear bits.
    Clear,
}

/// The reset-defined + Zicsr CSR file. Hardwired identification/`misa` are accessors; the
/// writable M/S CSRs live in a flat WARL map (`mstatus`/`mcause` kept as fields for the
/// E1-T01 reset assertions). `PROBE` carries read/write counters so suppression is testable.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Csrs {
    pub mode: Priv,
    /// Machine status; MIE(3)=0, MPRV(17)=0 at reset (whole register resets to 0).
    pub mstatus: u64,
    /// Machine trap cause; resets to 0.
    pub mcause: u64,
    /// Floating-point accrued exception flags `fflags` (5 bits: NV/DZ/OF/UF/NX). Sticky —
    /// set by FP ops, cleared only by an explicit CSR write (E1-T06).
    pub fflags: u8,
    /// Floating-point dynamic rounding mode `frm` (3 bits).
    pub frm: u8,
    /// Flat WARL storage for the other writable CSRs (mepc, mtvec, mie, satp, …).
    warl: Vec<(u16, u64)>,
    /// Observable hooks for the test PROBE CSR.
    pub probe_reads: u64,
    pub probe_value: u64,
}

/// Static metadata for an implemented CSR, derived per address.
struct Meta {
    min_priv: Priv,
    read_only: bool,
    /// WARL legalization mask applied to writes (`!0` = fully writable, `0` = hardwired).
    warl_mask: u64,
}

impl Csrs {
    /// The spec reset state (§3.4): M-mode, `mstatus = 0`, `mcause = 0`, empty WARL store.
    pub fn at_reset() -> Self {
        Self {
            mode: Priv::M,
            mstatus: 0,
            mcause: 0,
            fflags: 0,
            frm: 0,
            warl: Vec::new(),
            probe_reads: 0,
            probe_value: 0,
        }
    }

    // ── hardwired identification (read-only) ────────────────────────────────
    pub const fn misa(&self) -> u64 {
        MISA_RV64GC_SU
    }
    pub const fn mhartid(&self) -> u64 {
        0
    }
    pub const fn mvendorid(&self) -> u64 {
        0
    }
    pub const fn marchid(&self) -> u64 {
        0
    }
    pub const fn mimpid(&self) -> u64 {
        0
    }
    pub const fn mie(&self) -> bool {
        self.mstatus & (1 << 3) != 0
    }
    pub const fn mprv(&self) -> bool {
        self.mstatus & (1 << 17) != 0
    }

    // ── mstatus.FS floating-point state (bits 14:13), SD = bit 63 ────────────
    /// The FS field: 0=Off, 1=Initial, 2=Clean, 3=Dirty.
    pub const fn fs(&self) -> u8 {
        ((self.mstatus >> 13) & 0b11) as u8
    }
    /// True when FP is disabled (FS=Off) — every FP instruction and fcsr access traps.
    pub const fn fp_off(&self) -> bool {
        self.fs() == 0
    }
    /// Mark the FP state Dirty (FS=3) and set the SD summary bit (63). Called by every
    /// executed FP instruction and by any fflags/frm/fcsr write.
    pub fn mark_fp_dirty(&mut self) {
        self.mstatus = (self.mstatus & !(0b11 << 13)) | (0b11 << 13) | (1 << 63);
    }
    /// Accumulate FP exception flags into the sticky `fflags` (the flags are OR-accrued and
    /// only cleared by an explicit CSR write).
    pub fn accrue_fflags(&mut self, f: u8) {
        self.fflags |= f & 0x1F;
    }
    /// Resolve an instruction `rm` field against the dynamic `frm` (`rm=7` = DYN). Returns
    /// `None` for a reserved mode (static 5/6, or DYN with a reserved `frm`) → illegal.
    pub const fn resolve_rm(&self, rm: u8) -> Option<crate::softfloat::RoundMode> {
        let eff = if rm == 0b111 { self.frm } else { rm };
        crate::softfloat::RoundMode::from_bits(eff)
    }

    /// Metadata for an implemented CSR address, or `None` if unimplemented (→ illegal).
    /// Privilege is `addr[9:8]`; read-only is `addr[11:10]==0b11`.
    fn meta(addr: u16) -> Option<Meta> {
        let min_priv = match (addr >> 8) & 0b11 {
            0b00 => Priv::U,
            0b01 => Priv::S,
            _ => Priv::M,
        };
        let read_only = (addr >> 10) & 0b11 == 0b11;
        let warl_mask = match addr {
            MISA => 0, // hardwired WARL: writes ignored (reads return MISA_RV64GC_SU)
            // FP CSRs: fflags is 5 bits, frm is 3 bits, fcsr is the 8-bit {frm,fflags} pair.
            FFLAGS => 0x1F,
            FRM => 0x07,
            FCSR => 0xFF,
            // mepc: bit 0 is masked (WARL) — IALIGN=16 with the C extension means only bit 0
            // is forced to zero, not bits [1:0] (E1-T08). A write clears it; reads see it.
            MEPC => !1,
            MSTATUS | MCAUSE | MEDELEG | MIDELEG | MIE | MTVEC | MSCRATCH | MTVAL | MIP | SATP
            | STVEC | MNSTATUS | PMPCFG0 | PMPADDR0 | PROBE => !0,
            MVENDORID | MARCHID | MIMPID | MHARTID => 0, // RO const 0
            // Read-only user counters cycle/time/instret and hpm (0xC00–0xC1F): reads
            // return 0, writes trap (read_only by encoding).
            0xC00..=0xC1F => 0,
            _ => return None, // unimplemented
        };
        Some(Meta {
            min_priv,
            read_only,
            warl_mask,
        })
    }

    /// Raw read of an implemented CSR's current value (no privilege check). PROBE bumps its
    /// read counter — the observable hook for suppression tests.
    fn read_raw(&mut self, addr: u16) -> u64 {
        match addr {
            MISA => self.misa(),
            MHARTID => self.mhartid(),
            MVENDORID => self.mvendorid(),
            MARCHID => self.marchid(),
            MIMPID => self.mimpid(),
            MSTATUS => self.mstatus,
            MCAUSE => self.mcause,
            // FP CSR aliasing: fcsr = frm[7:5] | fflags[4:0].
            FFLAGS => u64::from(self.fflags),
            FRM => u64::from(self.frm),
            FCSR => u64::from((self.frm << 5) | (self.fflags & 0x1F)),
            PROBE => {
                self.probe_reads += 1;
                self.probe_value
            }
            0xC00..=0xC1F => 0,
            other => self
                .warl
                .iter()
                .find(|(a, _)| *a == other)
                .map_or(0, |(_, v)| *v),
        }
    }

    /// Raw write of a legalized value (no checks; caller applied the WARL mask).
    fn write_raw(&mut self, addr: u16, v: u64) {
        match addr {
            MSTATUS => self.mstatus = v,
            MCAUSE => self.mcause = v,
            // FP CSR writes (value already WARL-masked). Writing any of the three marks FP
            // state Dirty. fcsr splits into {frm, fflags}.
            FFLAGS => {
                self.fflags = (v as u8) & 0x1F;
                self.mark_fp_dirty();
            }
            FRM => {
                self.frm = (v as u8) & 0x07;
                self.mark_fp_dirty();
            }
            FCSR => {
                self.fflags = (v as u8) & 0x1F;
                self.frm = ((v >> 5) as u8) & 0x07;
                self.mark_fp_dirty();
            }
            PROBE => self.probe_value = v,
            MISA | MHARTID | MVENDORID | MARCHID | MIMPID => {} // hardwired
            0xC00..=0xC1F => {}
            other => match self.warl.iter_mut().find(|(a, _)| *a == other) {
                Some(e) => e.1 = v,
                None => self.warl.push((other, v)),
            },
        }
    }

    /// Execute one Zicsr access with full spec semantics. `src` is the resolved operand
    /// (rs1 value or zero-extended uimm); `src_is_zero` is true when the write must be
    /// suppressed for Set/Clear (rs1==x0 or uimm==0); `rd_is_zero` suppresses the read for
    /// Write. Returns the old value to place in `rd` (ignored when `rd_is_zero`), or a
    /// `Trap` for unimplemented / read-only / insufficient-privilege access.
    ///
    /// `illegal_tval` is the faulting instruction word, placed in the trap's `tval`.
    pub fn access(
        &mut self,
        addr: u16,
        op: CsrOp,
        src: u64,
        src_is_zero: bool,
        rd_is_zero: bool,
        illegal_tval: u64,
    ) -> Result<u64, Trap> {
        let illegal = || Trap {
            cause: Exception::IllegalInstruction,
            tval: illegal_tval,
        };

        let meta = Csrs::meta(addr).ok_or_else(illegal)?;
        if self.mode < meta.min_priv {
            return Err(illegal()); // access above current privilege
        }
        // With mstatus.FS=Off, the FP CSRs are inaccessible (E1-T06) — the access itself is
        // an illegal instruction, exactly like an FP compute op.
        if matches!(addr, FFLAGS | FRM | FCSR) && self.fp_off() {
            return Err(illegal());
        }
        // A write occurs for CSRRW always, and for CSRRS/CSRRC only when the source is
        // nonzero (rs1 != x0 / uimm != 0).
        let writes = matches!(op, CsrOp::Write) || !src_is_zero;
        if writes && meta.read_only {
            return Err(illegal()); // write to a read-only CSR
        }

        // Read side effect is suppressed for CSRRW with rd == x0.
        let old = if matches!(op, CsrOp::Write) && rd_is_zero {
            0
        } else {
            self.read_raw(addr)
        };

        if writes {
            // For Set/Clear we need the current value even if the read was suppressed above
            // (rd_is_zero only applies to Write). old already holds it for Set/Clear.
            let base = old;
            let new = match op {
                CsrOp::Write => src,
                CsrOp::Set => base | src,
                CsrOp::Clear => base & !src,
            };
            self.write_raw(addr, new & meta.warl_mask);
        }
        Ok(old)
    }
}

impl Default for Csrs {
    fn default() -> Self {
        Self::at_reset()
    }
}
