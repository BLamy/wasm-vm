//! SBI TIME extension (EID 0x54494D45 "TIME", spec v2.0 §6) — `sbi_set_timer`, the kernel's
//! clockevent source.
//!
//! Semantics (§6.1): `set_timer(stime_value)` programs the NEXT S-timer event in `mtime`
//! units and clears any pending S-timer interrupt. Delivery is a LEVEL the run loop derives
//! every instruction boundary: `STIP = (mtime >= stimecmp)` — so
//! - a deadline already in the past fires at the very next boundary (never waits for wrap),
//! - `u64::MAX` is the idiomatic "cancel" and never fires,
//! - back-to-back calls REPLACE the deadline (one comparator, no queue),
//! - the "clear pending STIP" spec clause is automatic: a future deadline makes the level
//!   false at the next boundary, before the guest can execute another instruction.
//!
//! Units: `stime_value` compares against the CLINT `mtime`, which the DTB advertises at
//! [`crate::platform::virt::TIMEBASE_FREQ_HZ`] — one constant, one source (E2-T02).

use super::{SbiRet, SbiState};

const FID_SET_TIMER: u64 = 0;

pub fn handle(state: &mut SbiState, fid: u64, args: &[u64; 6]) -> SbiRet {
    match fid {
        FID_SET_TIMER => {
            state.stimecmp = args[0];
            SbiRet::ok(0)
        }
        _ => SbiRet::not_supported(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::sbi::SBI_SUCCESS;

    /// Replace-not-queue + cancel semantics at the state level.
    #[test]
    fn set_timer_replaces_and_cancels() {
        let mut st = SbiState::default();
        assert_eq!(st.stimecmp, u64::MAX, "reset = never fire");
        assert_eq!(
            handle(&mut st, 0, &[1000, 0, 0, 0, 0, 0]).error,
            SBI_SUCCESS
        );
        assert_eq!(st.stimecmp, 1000);
        // Back-to-back call REPLACES (no queue).
        handle(&mut st, 0, &[5, 0, 0, 0, 0, 0]);
        assert_eq!(st.stimecmp, 5);
        // u64::MAX = cancel.
        handle(&mut st, 0, &[u64::MAX, 0, 0, 0, 0, 0]);
        assert_eq!(st.stimecmp, u64::MAX);
        // Unknown FID.
        assert_eq!(handle(&mut st, 3, &[0; 6]), SbiRet::not_supported());
    }
}
