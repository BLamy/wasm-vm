//! SBI SRST extension (EID 0x53525354 "SRST", spec v2.0 §10): system reset. Scoped into
//! E2-T06 by the E2-T03 critic (Linux 6.6 probes SRST at init for reboot/poweroff).
//!
//! `system_reset(reset_type, reset_reason)`: **shutdown** ends the run — the run loop sees
//! [`super::SbiState::shutdown`] and returns `RunOutcome::Exited` (0 for NO_REASON, 1 for
//! SYSTEM_FAILURE, matching process-exit conventions). **Reboot** (cold/warm) answers
//! NOT_SUPPORTED until a host restart path exists (the DTB also exposes the syscon
//! `sifive_test` device for reboot once that device task lands).

use super::{SbiRet, SbiState};

const FID_SYSTEM_RESET: u64 = 0;

const TYPE_SHUTDOWN: u64 = 0;
const TYPE_COLD_REBOOT: u64 = 1;
const TYPE_WARM_REBOOT: u64 = 2;

const REASON_NONE: u64 = 0;
const REASON_SYSTEM_FAILURE: u64 = 1;

pub fn handle(state: &mut SbiState, fid: u64, args: &[u64; 6]) -> SbiRet {
    match fid {
        FID_SYSTEM_RESET => {
            let (rtype, reason) = (args[0], args[1]);
            // Spec (critic finding): INVALID_PARAM when EITHER reset_type or reset_reason
            // is reserved — validate the reason before deciding type support, matching
            // OpenSBI's ordering.
            if reason > REASON_SYSTEM_FAILURE {
                return SbiRet::invalid_param();
            }
            match rtype {
                TYPE_SHUTDOWN => {
                    state.shutdown = Some(if reason == REASON_NONE { 0 } else { 1 });
                    // The run loop exits before the guest executes another instruction;
                    // this value is never guest-visible (spec: no return on success).
                    SbiRet::ok(0)
                }
                TYPE_COLD_REBOOT | TYPE_WARM_REBOOT => {
                    // E2-T17: signal the run loop to re-boot (the host re-inits the machine).
                    // Like shutdown, system_reset does not return on success.
                    state.reboot = true;
                    SbiRet::ok(0)
                }
                _ => SbiRet::invalid_param(), // reserved/vendor type
            }
        }
        _ => SbiRet::not_supported(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::sbi::SBI_ERR_INVALID_PARAM;

    #[test]
    fn shutdown_reboot_and_error_paths() {
        let mut st = SbiState::default();
        handle(&mut st, 0, &[TYPE_SHUTDOWN, REASON_NONE, 0, 0, 0, 0]);
        assert_eq!(st.shutdown, Some(0));
        let mut st = SbiState::default();
        handle(
            &mut st,
            0,
            &[TYPE_SHUTDOWN, REASON_SYSTEM_FAILURE, 0, 0, 0, 0],
        );
        assert_eq!(st.shutdown, Some(1));
        // E2-T17: cold/warm reboot is now SUPPORTED — returns OK and flags a reboot request
        // (the run loop turns it into RunOutcome::Reset(Reboot)); it must NOT shut down.
        let mut st = SbiState::default();
        assert_eq!(
            handle(&mut st, 0, &[TYPE_COLD_REBOOT, 0, 0, 0, 0, 0]).error,
            0
        );
        assert!(st.reboot, "cold reboot flags a reboot request");
        assert_eq!(st.shutdown, None, "reboot must not shut down");
        // E2-T17 (critic A4): a reboot with a RESERVED reason validates the reason FIRST →
        // INVALID_PARAM, and must NOT flag a reboot.
        let mut st = SbiState::default();
        assert_eq!(
            handle(&mut st, 0, &[TYPE_COLD_REBOOT, 99, 0, 0, 0, 0]).error,
            SBI_ERR_INVALID_PARAM
        );
        assert!(!st.reboot, "reserved-reason reboot must not flag a reboot");
        let mut st = SbiState::default();
        assert_eq!(
            handle(&mut st, 0, &[TYPE_WARM_REBOOT, 0, 0, 0, 0, 0]).error,
            0
        );
        assert!(st.reboot, "warm reboot flags a reboot request");
        assert_eq!(
            handle(&mut st, 0, &[TYPE_SHUTDOWN, 99, 0, 0, 0, 0]).error,
            SBI_ERR_INVALID_PARAM
        );
        // Reboot with a RESERVED reason (critic round-1 finding): reason validates FIRST
        // -> INVALID_PARAM, not NOT_SUPPORTED.
        assert_eq!(
            handle(&mut st, 0, &[TYPE_COLD_REBOOT, 99, 0, 0, 0, 0]).error,
            SBI_ERR_INVALID_PARAM
        );
        assert_eq!(
            handle(&mut st, 0, &[0xF000_0000, 0, 0, 0, 0, 0]).error,
            SBI_ERR_INVALID_PARAM
        );
        assert_eq!(handle(&mut st, 5, &[0; 6]), SbiRet::not_supported());
    }
}
