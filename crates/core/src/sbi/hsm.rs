//! SBI HSM extension (EID 0x48534D "HSM", spec v2.0 §9): hart lifecycle. Single-hart
//! topology, SMP-shaped: hart 0 is permanently STARTED; every other hartid is
//! INVALID_PARAM — so Linux's per-cpu-node probing stays quiet with one cpu node, and
//! Epic 6 replaces the constant topology with a real state machine, not the call surface.

use super::{SBI_ERR_ALREADY_AVAILABLE, SBI_ERR_FAILED, SbiRet};
use crate::platform::virt::NUM_HARTS;

const FID_HART_START: u64 = 0;
const FID_HART_STOP: u64 = 1;
const FID_HART_GET_STATUS: u64 = 2;
const FID_HART_SUSPEND: u64 = 3;

/// HSM state values (§9).
pub const STATE_STARTED: i64 = 0;

/// Retentive suspend type (§9.4); non-retentive types have bit 31 set.
const SUSPEND_RETENTIVE_DEFAULT: u64 = 0;

pub fn handle(fid: u64, args: &[u64; 6]) -> SbiRet {
    let hartid = args[0];
    match fid {
        FID_HART_START => {
            if hartid == 0 {
                // Hart 0 is running this very call.
                SbiRet {
                    error: SBI_ERR_ALREADY_AVAILABLE,
                    value: 0,
                }
            } else {
                SbiRet::invalid_param() // no such hart in the topology
            }
        }
        // Stopping the only hart would halt the machine with no way back; the spec's
        // hart_stop "returns only on failure" — this is that failure.
        FID_HART_STOP => SbiRet {
            error: SBI_ERR_FAILED,
            value: 0,
        },
        FID_HART_GET_STATUS => {
            if hartid < NUM_HARTS as u64 {
                SbiRet::ok(STATE_STARTED)
            } else {
                SbiRet::invalid_param()
            }
        }
        FID_HART_SUSPEND => {
            let suspend_type = args[0]; // (a0 is the suspend type for FID 3)
            match suspend_type {
                // Retentive default: resumes on interrupt; WFI is a legal no-op hint on
                // this machine, so an immediate spec-compliant return IS the resume.
                SUSPEND_RETENTIVE_DEFAULT => SbiRet::ok(0),
                // Non-retentive default: needs a resume-address path we don't have.
                0x8000_0000 => SbiRet::not_supported(),
                // Reserved bands (0x1..=0x7FFFFFFF retentive, 0x80000001..=0x8FFFFFFF
                // non-retentive): spec + OpenSBI say INVALID_PARAM (critic finding).
                0x1..=0x7FFF_FFFF | 0x8000_0001..=0x8FFF_FFFF => SbiRet::invalid_param(),
                // Platform-specific bands: unimplemented here.
                _ => SbiRet::not_supported(),
            }
        }
        _ => SbiRet::not_supported(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::sbi::{SBI_ERR_INVALID_PARAM, SBI_ERR_NOT_SUPPORTED, SBI_SUCCESS};

    /// Every error path the task names: bad hartid, bad suspend type, plus the happy rows.
    #[test]
    fn lifecycle_answers_single_hart() {
        // get_status: hart 0 STARTED; hart 1 invalid.
        let r = handle(FID_HART_GET_STATUS, &[0, 0, 0, 0, 0, 0]);
        assert_eq!((r.error, r.value), (SBI_SUCCESS, STATE_STARTED));
        assert_eq!(
            handle(FID_HART_GET_STATUS, &[1, 0, 0, 0, 0, 0]).error,
            SBI_ERR_INVALID_PARAM
        );
        // start: hart 0 already running; hart 7 nonexistent.
        assert_eq!(
            handle(FID_HART_START, &[0, 0, 0, 0, 0, 0]).error,
            SBI_ERR_ALREADY_AVAILABLE
        );
        assert_eq!(
            handle(FID_HART_START, &[7, 0, 0, 0, 0, 0]).error,
            SBI_ERR_INVALID_PARAM
        );
        // stop: failure by definition on the only hart.
        assert_eq!(handle(FID_HART_STOP, &[0; 6]).error, SBI_ERR_FAILED);
        // suspend: retentive default OK; non-retentive NOT_SUPPORTED; reserved invalid.
        assert_eq!(
            handle(FID_HART_SUSPEND, &[0, 0, 0, 0, 0, 0]).error,
            SBI_SUCCESS
        );
        assert_eq!(
            handle(FID_HART_SUSPEND, &[0x8000_0000, 0, 0, 0, 0, 0]).error,
            SBI_ERR_NOT_SUPPORTED
        );
        assert_eq!(
            handle(FID_HART_SUSPEND, &[0x1234, 0, 0, 0, 0, 0]).error,
            SBI_ERR_INVALID_PARAM
        );
        // Reserved NON-RETENTIVE band (critic round-1 finding): INVALID_PARAM, not -2.
        assert_eq!(
            handle(FID_HART_SUSPEND, &[0x8000_0001, 0, 0, 0, 0, 0]).error,
            SBI_ERR_INVALID_PARAM
        );
        // Platform-specific band: unimplemented -> NOT_SUPPORTED (matches OpenSBI).
        assert_eq!(
            handle(FID_HART_SUSPEND, &[0xDEAD_BEEF, 0, 0, 0, 0, 0]).error,
            SBI_ERR_NOT_SUPPORTED
        );
        assert_eq!(handle(9, &[0; 6]), SbiRet::not_supported());
    }
}
