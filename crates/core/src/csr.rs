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
/// Supervisor CSRs (E1-T09). `sstatus`/`sie`/`sip` are masked *views* over
/// `mstatus`/`mie`/`mip` (single backing storage); the rest are WARL-stored.
pub const SSTATUS: u16 = 0x100;
pub const SIE: u16 = 0x104;
/// Supervisor trap vector (WARL-stored here; full S-mode semantics arrive with the MMU).
pub const STVEC: u16 = 0x105;
pub const SSCRATCH: u16 = 0x140;
pub const SEPC: u16 = 0x141;
pub const SCAUSE: u16 = 0x142;
pub const STVAL: u16 = 0x143;
pub const SIP: u16 = 0x144;
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

// ── mstatus field bits (Privileged §3.1.6, RV64) ───────────────────────────────
const M_SIE: u64 = 1 << 1;
const M_MIE: u64 = 1 << 3;
const M_SPIE: u64 = 1 << 5;
const M_MPIE: u64 = 1 << 7;
const M_SPP: u64 = 1 << 8;
const M_MPP: u64 = 0b11 << 11;
const M_FS: u64 = 0b11 << 13;
const M_MPRV: u64 = 1 << 17;
const M_SUM: u64 = 1 << 18;
const M_MXR: u64 = 1 << 19;
const M_TVM: u64 = 1 << 20;
const M_TW: u64 = 1 << 21;
const M_TSR: u64 = 1 << 22;
const M_UXL: u64 = 0b11 << 32;
const M_SXL: u64 = 0b11 << 34;
const M_SD: u64 = 1 << 63;

/// Software-writable `mstatus` bits (everything else is WPRI/read-only). `UXL`/`SXL` are
/// hardwired 0b10 and `SD` is read-only-computed, so they are excluded here and re-derived
/// in [`legalize_mstatus`].
const MSTATUS_WMASK: u64 = M_SIE
    | M_MIE
    | M_SPIE
    | M_MPIE
    | M_SPP
    | M_MPP
    | M_FS
    | M_MPRV
    | M_SUM
    | M_MXR
    | M_TVM
    | M_TW
    | M_TSR;

/// Bits visible when *reading* `sstatus` (§4.1.1): the S-subset of `mstatus` + read-only
/// UXL and SD.
const SSTATUS_RMASK: u64 = M_SIE | M_SPIE | M_SPP | M_FS | M_SUM | M_MXR | M_UXL | M_SD;
/// Bits a write *through* `sstatus` may change (never the M-level bits).
const SSTATUS_WMASK: u64 = M_SIE | M_SPIE | M_SPP | M_FS | M_SUM | M_MXR;
/// S-visible interrupt-enable/-pending bits (SSIE/STIE/SEIE at 1/5/9).
const SIE_SIP_SMASK: u64 = (1 << 1) | (1 << 5) | (1 << 9);
/// SSIP alone — the sole `sip` bit software may write through the S-view (Priv §4.1.3).
const SIP_SSIP: u64 = 1 << 1;

// ── mip/mie interrupt bit positions (Priv §3.1.9) ──────────────────────────────
const IP_SSI: u64 = 1 << 1; // supervisor software
const IP_MSI: u64 = 1 << 3; // machine software
const IP_STI: u64 = 1 << 5; // supervisor timer
const IP_MTI: u64 = 1 << 7; // machine timer
const IP_SEI: u64 = 1 << 9; // supervisor external
const IP_MEI: u64 = 1 << 11; // machine external
/// All six implemented interrupt-enable bits — `mie` is fully writable over these (WARL: the
/// reserved bits read 0).
const MIE_WMASK: u64 = IP_SSI | IP_MSI | IP_STI | IP_MTI | IP_SEI | IP_MEI;
/// `mip` bits SOFTWARE may write from M-mode: only the S-mode pending bits. MSIP/MTIP/MEIP are
/// read-only to software — the CLINT (T12) and PLIC (T13) drive them via [`Csrs::set_mip_bit`].
const MIP_SW_WMASK: u64 = IP_SSI | IP_STI | IP_SEI;
/// `mideleg` writable bits: only S-mode interrupts can be delegated (the M-interrupt bits are
/// read-only 0 — a machine interrupt always targets M).
const MIDELEG_WMASK: u64 = IP_SSI | IP_STI | IP_SEI;
/// `medeleg` writable bits: the implementable exception causes {0..=9, 12, 13, 15}. Cause 11
/// (ecall-from-M) is hardwired 0 — an M trap is never delegated downward — as are the reserved
/// causes 10/14. (Matches Spike's delegable set.)
const MEDELEG_WMASK: u64 = 0x3FF | (1 << 12) | (1 << 13) | (1 << 15);
/// Interrupt priority, highest first: MEI > MSI > MTI > SEI > SSI > STI (Priv §3.1.9).
const INT_PRIORITY: [u64; 6] = [11, 3, 7, 9, 1, 5];

/// Legalize a candidate `mstatus` value: keep only writable bits, force `MPP=0b10` (reserved)
/// to `U`, hardwire `UXL`/`SXL`=0b10 (RV64), and recompute the read-only `SD` from `FS`.
const fn legalize_mstatus(v: u64) -> u64 {
    let mut s = v & MSTATUS_WMASK;
    if s & M_MPP == (0b10 << 11) {
        s &= !M_MPP; // reserved MPP=0b10 → U (documented WARL choice)
    }
    s |= (M_UXL & (0b10 << 32)) | (M_SXL & (0b10 << 34)); // UXL = SXL = 2 (64-bit), hardwired
    if s & M_FS == M_FS {
        s |= M_SD; // SD = (FS == Dirty)  [| VS | XS, none yet]
    }
    s
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

    // ── privilege / mstatus state machine (E1-T09, Privileged §3.1.6, §3.3.2) ──
    pub const fn tsr(&self) -> bool {
        self.mstatus & M_TSR != 0
    }
    pub const fn tw(&self) -> bool {
        self.mstatus & M_TW != 0
    }
    pub const fn tvm(&self) -> bool {
        self.mstatus & M_TVM != 0
    }

    /// Trap delivery into M-mode's mstatus stack: `MPIE←MIE, MIE←0, MPP←prior`, mode←M.
    /// (mepc/mcause/mtval and the mtvec jump are wired in E1-T10.)
    pub fn trap_to_m(&mut self, prior: Priv) {
        let mie = (self.mstatus >> 3) & 1;
        let mut s = self.mstatus & !(M_MPIE | M_MIE | M_MPP);
        s |= mie << 7; // MPIE = MIE ; MIE = 0
        s |= (prior as u64) << 11; // MPP = prior mode
        self.mstatus = legalize_mstatus(s);
        self.mode = Priv::M;
    }

    /// Trap delivery into S-mode: `SPIE←SIE, SIE←0, SPP←(from S?1:0)`, mode←S.
    pub fn trap_to_s(&mut self, prior: Priv) {
        let sie = (self.mstatus >> 1) & 1;
        let mut s = self.mstatus & !(M_SPIE | M_SIE | M_SPP);
        s |= sie << 5; // SPIE = SIE ; SIE = 0
        if matches!(prior, Priv::S) {
            s |= M_SPP; // SPP = 1 from S, 0 from U
        }
        self.mstatus = legalize_mstatus(s);
        self.mode = Priv::S;
    }

    /// MRET: `MIE←MPIE, MPIE←1, mode←MPP, MPP←U`, and `MPRV←0` if the new mode ≠ M.
    pub fn mret(&mut self) {
        let mpie = (self.mstatus >> 7) & 1;
        let new_mode = match (self.mstatus >> 11) & 0b11 {
            3 => Priv::M,
            1 => Priv::S,
            _ => Priv::U,
        };
        let mut s = self.mstatus;
        s = (s & !M_MIE) | (mpie << 3); // MIE = MPIE
        s |= M_MPIE; // MPIE = 1
        s &= !M_MPP; // MPP = U (lowest supported)
        if !matches!(new_mode, Priv::M) {
            s &= !M_MPRV; // MPRV cleared when returning below M
        }
        self.mstatus = legalize_mstatus(s);
        self.mode = new_mode;
    }

    /// SRET: `SIE←SPIE, SPIE←1, mode←SPP, SPP←U`, and `MPRV←0` if the new mode ≠ M.
    pub fn sret(&mut self) {
        let spie = (self.mstatus >> 5) & 1;
        let new_mode = if self.mstatus & M_SPP != 0 {
            Priv::S
        } else {
            Priv::U
        };
        let mut s = self.mstatus;
        s = (s & !M_SIE) | (spie << 1); // SIE = SPIE
        s |= M_SPIE; // SPIE = 1
        s &= !M_SPP; // SPP = U
        if !matches!(new_mode, Priv::M) {
            s &= !M_MPRV;
        }
        self.mstatus = legalize_mstatus(s);
        self.mode = new_mode;
    }

    /// Deliver a synchronous exception into M-mode (E1-T10): record mepc/mcause/mtval and
    /// push the mstatus interrupt stack (`trap_to_m`). `cause` is the raw mcause value —
    /// bit 63 (Interrupt) is 0 for every synchronous exception. mepc keeps the faulting pc
    /// with only bit 0 forced to zero (IALIGN=16 with the C extension). Delegation to S-mode
    /// (medeleg) lands in E1-T11; until then every trap is taken in M. Returns nothing — the
    /// caller reads [`Self::mtvec_base`] for the handler entry PC.
    pub fn deliver_trap_m(&mut self, epc: u64, cause: u64, tval: u64) {
        let prior = self.mode;
        self.warl_set(MEPC, epc & !1);
        self.mcause = cause;
        self.warl_set(MTVAL, tval);
        self.trap_to_m(prior);
    }

    /// The mtvec BASE address (bits [63:2]); the low two bits are the MODE field, never part
    /// of the target address. Synchronous traps ALWAYS enter here regardless of MODE — the
    /// vectored offset (BASE + 4×cause) applies to interrupts only (Priv §3.1.7).
    pub fn mtvec_base(&self) -> u64 {
        self.warl_get(MTVEC) & !0b11
    }

    /// Deliver a trap into S-mode (E1-T11): record sepc/scause/stval and push the S half of the
    /// mstatus stack (`trap_to_s`). Used for exceptions delegated by `medeleg` and interrupts
    /// delegated by `mideleg`. `cause` is the raw scause value (Interrupt bit 63 set for an
    /// interrupt). sepc keeps the faulting/next pc with bit 0 masked.
    pub fn deliver_trap_s(&mut self, epc: u64, cause: u64, tval: u64) {
        let prior = self.mode;
        self.warl_set(SEPC, epc & !1);
        self.warl_set(SCAUSE, cause);
        self.warl_set(STVAL, tval);
        self.trap_to_s(prior);
    }

    /// The stvec BASE address (bits [63:2]); MODE lives in the low two bits.
    pub fn stvec_base(&self) -> u64 {
        self.warl_get(STVEC) & !0b11
    }

    /// The M-mode handler entry for a trap: BASE always, plus — for an INTERRUPT when mtvec
    /// MODE == 1 (Vectored) — the `BASE + 4×cause` offset. Synchronous traps ignore MODE.
    pub fn m_handler_entry(&self, cause_num: u64, is_interrupt: bool) -> u64 {
        let t = self.warl_get(MTVEC);
        let base = t & !0b11;
        if is_interrupt && (t & 0b11) == 1 {
            base.wrapping_add(4 * cause_num)
        } else {
            base
        }
    }
    /// The S-mode handler entry, mirroring [`Self::m_handler_entry`] for stvec.
    pub fn s_handler_entry(&self, cause_num: u64, is_interrupt: bool) -> u64 {
        let t = self.warl_get(STVEC);
        let base = t & !0b11;
        if is_interrupt && (t & 0b11) == 1 {
            base.wrapping_add(4 * cause_num)
        } else {
            base
        }
    }

    /// Should a trap with mcause number `cause_num` be delegated to S-mode given the current
    /// privilege (E1-T11)? Delegated ONLY when the deleg bit is set AND we are running below M
    /// (S or U) — a trap taken while executing in M always stays in M, never downward (§3.1.8).
    pub fn delegates_to_s(&self, cause_num: u64, is_interrupt: bool) -> bool {
        if matches!(self.mode, Priv::M) {
            return false;
        }
        let deleg = if is_interrupt {
            self.warl_get(MIDELEG)
        } else {
            self.warl_get(MEDELEG)
        };
        deleg & (1 << cause_num) != 0
    }

    /// The highest-priority interrupt to take right now, or `None` (E1-T11). Returns the mcause
    /// value (Interrupt bit 63 set) and whether it targets S-mode. Considers pending&enabled
    /// (`mip & mie`), delegation (`mideleg`), the current privilege, and the global-enable rules
    /// (mstatus.MIE for M-targeted, mstatus.SIE for S-targeted). Priority: MEI>MSI>MTI>SEI>SSI>STI.
    /// An interrupt targeting mode x is taken when: current mode < x, OR (current == x AND xIE).
    /// M-targeted interrupts are never taken while in M with MIE=0, and never below-target masks
    /// a higher privilege's interrupt; a higher-priority interrupt that cannot be taken in the
    /// current mode is skipped so a takeable lower one can fire.
    pub fn next_interrupt(&self) -> Option<(u64, bool)> {
        let pend = self.warl_get(MIP) & self.warl_get(MIE);
        if pend == 0 {
            return None;
        }
        let mideleg = self.warl_get(MIDELEG);
        let mie_glob = self.mstatus & M_MIE != 0;
        let sie_glob = self.mstatus & M_SIE != 0;
        for &i in &INT_PRIORITY {
            if pend & (1 << i) == 0 {
                continue;
            }
            let to_s = mideleg & (1 << i) != 0;
            let takeable = if to_s {
                // S-targeted: taken in U always; in S iff SIE; never while in M (M > S).
                match self.mode {
                    Priv::U => true,
                    Priv::S => sie_glob,
                    Priv::M => false,
                }
            } else {
                // M-targeted: taken in S/U always (can't be masked from below); in M iff MIE.
                match self.mode {
                    Priv::M => mie_glob,
                    _ => true,
                }
            };
            if takeable {
                return Some(((1u64 << 63) | i, to_s));
            }
        }
        None
    }

    /// Device-facing (CLINT/PLIC, and tests until those land): set or clear a `mip` PENDING bit
    /// DIRECTLY, bypassing the software read-only masking. MSIP/MTIP/MEIP are software-read-only
    /// but hardware-driven — this is the hardware path.
    pub fn set_mip_bit(&mut self, bit: u64, on: bool) {
        let mut v = self.warl_get(MIP);
        if on {
            v |= 1 << bit;
        } else {
            v &= !(1 << bit);
        }
        self.warl_set(MIP, v);
    }

    /// `sstatus` is a masked read view of `mstatus` (S-visible bits only).
    pub const fn sstatus_read(&self) -> u64 {
        self.mstatus & SSTATUS_RMASK
    }
    /// A write through `sstatus` touches only the S-visible writable bits of `mstatus`.
    pub fn sstatus_write(&mut self, v: u64) {
        let merged = (self.mstatus & !SSTATUS_WMASK) | (v & SSTATUS_WMASK);
        self.mstatus = legalize_mstatus(merged);
    }
    /// The S-interrupt bits (SSIE/STIE/SEIE) currently visible through `sie`/`sip` — those in
    /// the S-subset that are *delegated* to S-mode by `mideleg` (Priv §4.1.3).
    fn s_int_mask(&self) -> u64 {
        SIE_SIP_SMASK & self.warl_get(MIDELEG)
    }
    /// The `sip` bits that are software-*writable* through the S-view. Per Priv §4.1.3 only
    /// SSIP (bit 1) is writable via `sip`; STIP (bit 5) and SEIP (bit 9) are read-only in the
    /// `sip` view (they are driven by the timer / external controller and set through `mip`).
    /// So the sip *write* mask is SSIP-only, still gated on delegation. Reads, by contrast,
    /// expose every delegated S-pending bit — that path stays `s_int_mask()`. (`sie` differs:
    /// STIE/SEIE *are* writable there, so `sie` writes keep using `s_int_mask()`.)
    fn sip_write_mask(&self) -> u64 {
        SIP_SSIP & self.warl_get(MIDELEG)
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
            MEPC | SEPC => !1,
            // mtvec/stvec MODE (bits [1:0]) is WARL: only Direct(0) and Vectored(1) are
            // legal; a written MODE ≥ 2 legalizes by clearing bit 1 (matches Spike's
            // `val & ~2`), so MODE ∈ {0,1} always reads back and BASE stays 4-byte aligned
            // (its low two bits ARE the MODE field). Synchronous traps ignore MODE (E1-T10).
            MTVEC | STVEC => !0b10,
            // Interrupt WARL masks (E1-T11): mie is writable over the six implemented bits;
            // mideleg only over the S-interrupt bits; medeleg over the implementable exception
            // causes (ecall-from-M / reserved excluded). mip's software-write masking is a
            // read-modify-write done in write_raw (device bits are read-only there), so its
            // mask here stays !0.
            MIE => MIE_WMASK,
            MIDELEG => MIDELEG_WMASK,
            MEDELEG => MEDELEG_WMASK,
            MSTATUS | MCAUSE | MSCRATCH | MTVAL | MIP | SATP
            | MNSTATUS | PMPCFG0 | PMPADDR0 | PROBE
            // S-mode CSRs (E1-T09): sstatus/sie/sip are masked *views* handled in
            // read_raw/write_raw; the mask here is !0 (the view logic does the masking).
            | SSTATUS | SIE | SIP | SSCRATCH | SCAUSE | STVAL => !0,
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

    /// Unchecked raw read of a CSR (no privilege/side-effect logic) — for the hart's own use
    /// (reading mepc/sepc during MRET/SRET).
    pub fn read(&mut self, addr: u16) -> u64 {
        self.read_raw(addr)
    }

    /// Read the flat WARL store for `addr` (0 if never written).
    fn warl_get(&self, addr: u16) -> u64 {
        self.warl
            .iter()
            .find(|(a, _)| *a == addr)
            .map_or(0, |(_, v)| *v)
    }
    /// Write the flat WARL store for `addr`.
    fn warl_set(&mut self, addr: u16, v: u64) {
        match self.warl.iter_mut().find(|(a, _)| *a == addr) {
            Some(e) => e.1 = v,
            None => self.warl.push((addr, v)),
        }
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
            // S-mode views (E1-T09): sstatus/sie/sip expose the S-subset of mstatus/mie/mip.
            // Per Priv §4.1.3, an S-interrupt bit is visible/maskable via sie/sip ONLY when it
            // is delegated (mideleg bit set); undelegated bits are read-only zero.
            SSTATUS => self.sstatus_read(),
            SIE => self.warl_get(MIE) & self.s_int_mask(),
            SIP => self.warl_get(MIP) & self.s_int_mask(),
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
            MSTATUS => self.mstatus = legalize_mstatus(v),
            MCAUSE => self.mcause = v,
            // S-mode views (E1-T09): route through the masked mstatus/mie/mip. `sie` writes the
            // delegated S-interrupt-enable bits (SIE_SIP_SMASK & mideleg); `sip` writes ONLY the
            // delegated SSIP (STIP/SEIP are read-only in the sip view). Undelegated bits are
            // read-only zero and a write leaves mie/mip untouched.
            SSTATUS => self.sstatus_write(v),
            SIE => {
                let m = self.s_int_mask();
                let new = (self.warl_get(MIE) & !m) | (v & m);
                self.warl_set(MIE, new);
            }
            SIP => {
                let m = self.sip_write_mask();
                let new = (self.warl_get(MIP) & !m) | (v & m);
                self.warl_set(MIP, new);
            }
            // A raw `csrw mip` from M writes only the S-mode pending bits (SSIP/STIP/SEIP);
            // MSIP/MTIP/MEIP are read-only to software (device-driven via set_mip_bit). RMW so
            // the device-driven bits survive (E1-T11).
            MIP => {
                let new = (self.warl_get(MIP) & !MIP_SW_WMASK) | (v & MIP_SW_WMASK);
                self.warl_set(MIP, new);
            }
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
