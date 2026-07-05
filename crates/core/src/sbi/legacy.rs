//! SBI v0.1 legacy console extensions (EID 0x01/0x02) — Linux's `earlycon=sbi` fallback
//! when DBCN isn't probed (e.g. kernels < 6.7, `CONFIG_RISCV_SBI_V01`).
//!
//! Legacy calls return ONLY `a0` (the run loop checks [`super::is_legacy`] and leaves `a1`
//! untouched). `console_putchar` returns 0; `console_getchar` returns the byte or -1 when
//! no input is pending — it NEVER blocks (the kernel polls).

use super::{EID_LEGACY_GETCHAR, EID_LEGACY_PUTCHAR, SbiRet, SbiState};

pub fn handle(state: &mut SbiState, eid: u64, args: &[u64; 6]) -> SbiRet {
    match eid {
        EID_LEGACY_PUTCHAR => {
            state.put_byte(args[0] as u8);
            SbiRet::ok(0)
        }
        // Legacy calls have no error/value split — a0 IS the result. SbiRet.error maps to
        // a0 in the run loop, so the byte (or -1 for "no input") is carried there.
        EID_LEGACY_GETCHAR => match state.console_in.pop_front() {
            Some(b) => SbiRet {
                error: b as i64,
                value: 0,
            },
            None => SbiRet {
                error: -1, // "no byte pending" — not an SBI error code
                value: 0,
            },
        },
        _ => SbiRet::not_supported(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::dev::console::VecSink;
    use alloc::boxed::Box;

    #[test]
    fn putchar_emits_and_returns_zero() {
        let sink = VecSink::new();
        let reader = sink.clone();
        let mut st = SbiState {
            console_out: Some(Box::new(sink)),
            ..Default::default()
        };
        let r = handle(&mut st, EID_LEGACY_PUTCHAR, &[b'Z' as u64, 0, 0, 0, 0, 0]);
        assert_eq!((r.error, r.value), (0, 0));
        assert_eq!(reader.captured(), b"Z");
    }

    /// Acceptance/charter: getchar with empty input returns -1 immediately — never blocks.
    #[test]
    fn getchar_empty_is_minus_one_nonblocking() {
        let mut st = SbiState::default();
        let r = handle(&mut st, EID_LEGACY_GETCHAR, &[0; 6]);
        assert_eq!(r.error, -1);
        st.console_in.push_back(b'q');
        let r = handle(&mut st, EID_LEGACY_GETCHAR, &[0; 6]);
        assert_eq!(r.error, b'q' as i64, "byte returned in a0");
        let r = handle(&mut st, EID_LEGACY_GETCHAR, &[0; 6]);
        assert_eq!(r.error, -1, "queue drained -> -1 again");
    }
}
