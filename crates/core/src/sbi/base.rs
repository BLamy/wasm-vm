//! SBI Base extension (EID 0x10, spec v2.0 §4) — the extension a kernel talks to first.

use super::{SbiRet, probe};

// FIDs (§4).
const FID_GET_SPEC_VERSION: u64 = 0;
const FID_GET_IMPL_ID: u64 = 1;
const FID_GET_IMPL_VERSION: u64 = 2;
const FID_PROBE_EXTENSION: u64 = 3;
const FID_GET_MVENDORID: u64 = 4;
const FID_GET_MARCHID: u64 = 5;
const FID_GET_MIMPID: u64 = 6;

/// Spec version we implement: bit 31 reserved (0), bits 30:24 major, 23:0 minor → 2.0.
pub const SPEC_VERSION: i64 = 2 << 24;

/// Our implementation ID. The registered id table (0=BBL, 1=OpenSBI, 2=Xvisor, 3=KVM,
/// 4=RustSBI, 5=Diosix, 6=Coffer, 7=Xen, 8=PolarFire HSS) has no entry for us; we use
/// `0x57 0x4D` ("WM", wasm-vm) in the unregistered space and document it here + ADR 0002.
pub const IMPL_ID: i64 = 0x574D;

/// Implementation version: 0.1.0 encoded major<<16 | minor<<8 | patch.
pub const IMPL_VERSION: i64 = 0x0000_0100;

/// mvendorid/marchid/mimpid mirror the machine's CSRs, which read 0 (unregistered
/// implementation — E1-T01 reset state). Returned as literals here because the values are
/// architectural constants of this machine, not runtime state.
const MVENDORID: i64 = 0;
const MARCHID: i64 = 0;
const MIMPID: i64 = 0;

pub fn handle(fid: u64, args: &[u64; 6]) -> SbiRet {
    match fid {
        FID_GET_SPEC_VERSION => SbiRet::ok(SPEC_VERSION),
        FID_GET_IMPL_ID => SbiRet::ok(IMPL_ID),
        FID_GET_IMPL_VERSION => SbiRet::ok(IMPL_VERSION),
        // probe_extension: value 0 for absent, nonzero for present — an ANSWER, not an
        // error (SBI_SUCCESS either way).
        FID_PROBE_EXTENSION => SbiRet::ok(probe(args[0]) as i64),
        FID_GET_MVENDORID => SbiRet::ok(MVENDORID),
        FID_GET_MARCHID => SbiRet::ok(MARCHID),
        FID_GET_MIMPID => SbiRet::ok(MIMPID),
        _ => SbiRet::not_supported(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::sbi::{EID_BASE, EID_DBCN, EID_HSM, EID_TIME, SBI_SUCCESS};

    /// Acceptance: spec_version decodes to major 2 minor 0, bit 31 zero.
    #[test]
    fn spec_version_is_2_0() {
        let v = handle(FID_GET_SPEC_VERSION, &[0; 6]);
        assert_eq!(v.error, SBI_SUCCESS);
        let raw = v.value as u64;
        assert_eq!(raw >> 31, 0, "bit 31 reserved");
        assert_eq!((raw >> 24) & 0x7F, 2, "major");
        assert_eq!(raw & 0x00FF_FFFF, 0, "minor");
    }

    /// Acceptance: probe answers per plan, PMU (0x0A) → value 0 with SBI_SUCCESS.
    #[test]
    fn probe_extension_per_plan() {
        for (eid, want) in [
            (EID_BASE, 1i64),
            (EID_DBCN, 1),
            (EID_TIME, 0),
            (EID_HSM, 0),
            (0x0A, 0),
            (0x4442_0000, 0),
        ] {
            let r = handle(FID_PROBE_EXTENSION, &[eid, 0, 0, 0, 0, 0]);
            assert_eq!(r.error, SBI_SUCCESS, "probe({eid:#x}) errors");
            assert_eq!(r.value, want, "probe({eid:#x}) value");
        }
    }

    #[test]
    fn ids_and_unknown_fid() {
        assert_eq!(handle(FID_GET_IMPL_ID, &[0; 6]).value, IMPL_ID);
        assert_eq!(handle(FID_GET_IMPL_VERSION, &[0; 6]).value, IMPL_VERSION);
        for fid in [FID_GET_MVENDORID, FID_GET_MARCHID, FID_GET_MIMPID] {
            let r = handle(fid, &[0; 6]);
            assert_eq!((r.error, r.value), (SBI_SUCCESS, 0));
        }
        assert_eq!(handle(7, &[0; 6]), SbiRet::not_supported());
        assert_eq!(handle(u64::MAX, &[0; 6]), SbiRet::not_supported());
    }
}
