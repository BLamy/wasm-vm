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
        FID_SYSTEM_RESET => match (args[0], args[1]) {
            (TYPE_SHUTDOWN, reason @ (REASON_NONE | REASON_SYSTEM_FAILURE)) => {
                state.shutdown = Some(if reason == REASON_NONE { 0 } else { 1 });
                // The run loop exits before the guest executes another instruction; this
                // return value is never guest-visible (spec: does not return on success).
                SbiRet::ok(0)
            }
            (TYPE_COLD_REBOOT | TYPE_WARM_REBOOT, _) => SbiRet::not_supported(),
            (TYPE_SHUTDOWN, _) => SbiRet::invalid_param(), // reserved reason
            _ => SbiRet::invalid_param(),                  // reserved/vendor type
        },
        _ => SbiRet::not_supported(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::sbi::{SBI_ERR_INVALID_PARAM, SBI_ERR_NOT_SUPPORTED};

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
        let mut st = SbiState::default();
        assert_eq!(
            handle(&mut st, 0, &[TYPE_COLD_REBOOT, 0, 0, 0, 0, 0]).error,
            SBI_ERR_NOT_SUPPORTED
        );
        assert_eq!(st.shutdown, None, "reboot must not shut down");
        assert_eq!(
            handle(&mut st, 0, &[TYPE_SHUTDOWN, 99, 0, 0, 0, 0]).error,
            SBI_ERR_INVALID_PARAM
        );
        assert_eq!(
            handle(&mut st, 0, &[0xF000_0000, 0, 0, 0, 0, 0]).error,
            SBI_ERR_INVALID_PARAM
        );
        assert_eq!(handle(&mut st, 5, &[0; 6]), SbiRet::not_supported());
    }
}
