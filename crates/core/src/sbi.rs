//! SBI dispatch skeleton (E2-T03): the emulator-as-firmware entry point for `ecall` from
//! S-mode, per the **RISC-V SBI specification v2.0**.
//!
//! Per ADR 0002 (`docs/adr/0002-sbi-firmware.md`) the emulator IS the M-mode firmware: the
//! kernel runs in S-mode and its `ecall`s are handled here in Rust, never by guest M-mode
//! code. This module is the DISPATCH shape only — no extension is implemented yet. Epic 2
//! fills in: Base (E2-T04), DBCN + legacy console (E2-T04), TIME (E2-T05), IPI/RFENCE/HSM
//! (E2-T06). Every EID (known-but-unimplemented or unknown) returns
//! [`SBI_ERR_NOT_SUPPORTED`] — the spec-mandated probe answer — rather than trapping or
//! panicking, so a kernel probing extensions degrades gracefully.

/// SBI calling convention: `a7`=EID, `a6`=FID, args in `a0..a5`; returns
/// (`a0`=error, `a1`=value).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct SbiRet {
    pub error: i64,
    pub value: i64,
}

impl SbiRet {
    pub const fn not_supported() -> Self {
        Self {
            error: SBI_ERR_NOT_SUPPORTED,
            value: 0,
        }
    }
}

// Standard SBI error codes (spec v2.0 §Binary Encoding).
pub const SBI_SUCCESS: i64 = 0;
pub const SBI_ERR_FAILED: i64 = -1;
pub const SBI_ERR_NOT_SUPPORTED: i64 = -2;
pub const SBI_ERR_INVALID_PARAM: i64 = -3;
pub const SBI_ERR_DENIED: i64 = -4;
pub const SBI_ERR_INVALID_ADDRESS: i64 = -5;
pub const SBI_ERR_ALREADY_AVAILABLE: i64 = -6;

// Extension IDs Epic 2 will implement (ADR 0002 / acceptance list).
/// Base extension (probe, spec/impl version) — E2-T04.
pub const EID_BASE: u64 = 0x10;
/// Debug Console extension ("DBCN") — E2-T04.
pub const EID_DBCN: u64 = 0x4442434E;
/// Timer extension ("TIME") — E2-T05.
pub const EID_TIME: u64 = 0x54494D45;
/// Inter-processor interrupts ("sPI") — E2-T06.
pub const EID_IPI: u64 = 0x0073_5049;
/// Remote fences ("RFNC") — E2-T06.
pub const EID_RFENCE: u64 = 0x5246_4E43;
/// Hart state management ("HSM") — E2-T06.
pub const EID_HSM: u64 = 0x0048_534D;
/// Legacy console putchar (v0.1) — E2-T04.
pub const EID_LEGACY_PUTCHAR: u64 = 0x01;
/// Legacy console getchar (v0.1) — E2-T04.
pub const EID_LEGACY_GETCHAR: u64 = 0x02;

/// One SBI call: `eid` from `a7`, `fid` from `a6`, `args` from `a0..a5`.
///
/// Skeleton behavior (E2-T03): EVERY call answers `SBI_ERR_NOT_SUPPORTED`. The match arms
/// pre-carve the dispatch shape the extension tasks fill in, so adding an extension is a
/// local edit here, not a run-loop change.
pub fn dispatch(eid: u64, fid: u64, args: &[u64; 6]) -> SbiRet {
    let _ = (fid, args);
    match eid {
        // Implemented extensions land in these arms (E2-T04..T06).
        EID_BASE | EID_DBCN | EID_TIME | EID_IPI | EID_RFENCE | EID_HSM => SbiRet::not_supported(),
        EID_LEGACY_PUTCHAR | EID_LEGACY_GETCHAR => SbiRet::not_supported(),
        // Unknown EID: the spec's probe answer, never a trap or panic.
        _ => SbiRet::not_supported(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Acceptance: unknown EID → NOT_SUPPORTED (-2); never panics.
    #[test]
    fn unknown_eid_is_not_supported() {
        for eid in [0u64, 0xDEAD_BEEF, u64::MAX, EID_BASE, EID_DBCN, EID_HSM] {
            let ret = dispatch(eid, 7, &[1, 2, 3, 4, 5, 6]);
            assert_eq!(ret.error, SBI_ERR_NOT_SUPPORTED, "eid {eid:#x}");
            assert_eq!(ret.value, 0);
        }
    }
}
