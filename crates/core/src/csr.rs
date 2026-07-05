//! Control and status registers — the reset-relevant subset (E1-T01). Full CSR
//! read/write semantics arrive in later Epic 1 tasks; here we define the *architectural
//! reset state* the privileged spec (§3.4) mandates, so every harness, the wasm entry
//! point, and future snapshot/restore go through one authority ([`crate::hart::Hart::reset`]).
//!
//! This is the real CSR state that replaces E0-T19's quarantined `zicsr_stub` — that stub
//! stays feature-gated for the riscv-tests p-env until the full CSR file lands.

/// `misa` for this implementation: MXL=2 (RV64) with extensions **I M A F D C S U** set.
/// WARL and hardwired — writes are ignored, reads always return this. (§3.1.1.)
/// Bits: A(0) C(2) D(3) F(5) I(8) M(12) S(18) U(20), MXL=2 in bits 63:62.
pub const MISA_RV64GC_SU: u64 = 0x8000_0000_0014_112D;

/// Privilege mode (§1.2). The hart resets into machine mode.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
#[repr(u8)]
pub enum Priv {
    U = 0,
    S = 1,
    /// The reset privilege mode.
    #[default]
    M = 3,
}

/// The reset-defined CSR state. The read-only identification/`misa` registers are exposed
/// as accessors (hardwired), the mutable ones (`mstatus`, `mcause`) as fields cleared at
/// reset. Deriving `PartialEq` lets the reset-determinism test compare whole harts.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Csrs {
    /// Current privilege mode.
    pub mode: Priv,
    /// Machine status. At reset MIE (bit 3) = 0 and MPRV (bit 17) = 0; the whole register
    /// resets to 0 (little-endian: MBE/SBE/UBE = 0).
    pub mstatus: u64,
    /// Machine trap cause. Resets to 0.
    pub mcause: u64,
}

impl Csrs {
    /// The spec reset state (§3.4): M-mode, `mstatus = 0`, `mcause = 0`.
    pub const fn at_reset() -> Self {
        Self {
            mode: Priv::M,
            mstatus: 0,
            mcause: 0,
        }
    }

    /// `misa` — hardwired WARL (see [`MISA_RV64GC_SU`]).
    pub const fn misa(&self) -> u64 {
        MISA_RV64GC_SU
    }
    /// `mhartid` — single hart, read-only 0.
    pub const fn mhartid(&self) -> u64 {
        0
    }
    /// `mvendorid` — 0 is legal (non-commercial). Read-only.
    pub const fn mvendorid(&self) -> u64 {
        0
    }
    /// `marchid` — 0 (unassigned). Read-only.
    pub const fn marchid(&self) -> u64 {
        0
    }
    /// `mimpid` — 0 (no implementation id). Read-only.
    pub const fn mimpid(&self) -> u64 {
        0
    }

    /// `mstatus.MIE` (bit 3).
    pub const fn mie(&self) -> bool {
        self.mstatus & (1 << 3) != 0
    }
    /// `mstatus.MPRV` (bit 17).
    pub const fn mprv(&self) -> bool {
        self.mstatus & (1 << 17) != 0
    }
}

impl Default for Csrs {
    fn default() -> Self {
        Self::at_reset()
    }
}
