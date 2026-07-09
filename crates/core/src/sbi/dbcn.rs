//! SBI Debug Console extension (EID 0x4442434E "DBCN", spec v2.0 §12) — the kernel's
//! `earlycon=sbi` channel: works before any UART driver exists.
//!
//! Buffers are GUEST PHYSICAL addresses. Every call validates the whole `[base, base+len)`
//! range against guest DRAM before touching a byte: out-of-DRAM (MMIO, unmapped, straddling
//! the end, or wrapping 2^64) returns [`SBI_ERR_INVALID_PARAM`] — the host never faults.

use super::{SbiRet, SbiState};
use crate::bus::Bus;
use crate::mmio::SystemBus;
use crate::platform::virt::DRAM_BASE;

const FID_CONSOLE_WRITE: u64 = 0;
const FID_CONSOLE_READ: u64 = 1;
const FID_CONSOLE_WRITE_BYTE: u64 = 2;

/// Validate `[base, base+len)` lies entirely inside guest DRAM (overflow-safe).
fn dram_range_ok(bus: &SystemBus, base: u64, len: u64) -> bool {
    let dram_end = DRAM_BASE + bus.ram().len() as u64; // ram len ≪ 2^63: cannot overflow
    match base.checked_add(len) {
        Some(end) => base >= DRAM_BASE && end <= dram_end,
        None => false, // wraps past 2^64
    }
}

pub fn handle(state: &mut SbiState, bus: &mut SystemBus, fid: u64, args: &[u64; 6]) -> SbiRet {
    match fid {
        // console_write(num_bytes, base_lo, base_hi) → a1 = bytes written.
        FID_CONSOLE_WRITE => {
            let (num, base) = (args[0], args[1]);
            // base_addr_hi (args[2]) carries bits beyond XLEN — must be 0 on RV64.
            if args[2] != 0 || !dram_range_ok(bus, base, num) {
                return SbiRet::invalid_param();
            }
            for i in 0..num {
                // In-DRAM loads cannot fault after the range check.
                let b = bus.load8(base + i).expect("validated DRAM read");
                state.put_byte(b);
            }
            SbiRet::ok(num as i64)
        }
        // console_read(num_bytes, base_lo, base_hi) → a1 = bytes read (0 when queue empty:
        // non-blocking by spec — the kernel polls).
        FID_CONSOLE_READ => {
            let (num, base) = (args[0], args[1]);
            if args[2] != 0 || !dram_range_ok(bus, base, num) {
                return SbiRet::invalid_param();
            }
            let mut read = 0u64;
            while read < num {
                let Some(b) = state.console_in.pop_front() else {
                    break;
                };
                bus.store8(base + read, b).expect("validated DRAM write");
                read += 1;
            }
            SbiRet::ok(read as i64)
        }
        // console_write_byte(byte) — no buffer, cannot fail.
        FID_CONSOLE_WRITE_BYTE => {
            state.put_byte(args[0] as u8);
            SbiRet::ok(0)
        }
        _ => SbiRet::not_supported(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::dev::console::VecSink;
    use crate::platform::virt::UART0_BASE;
    use crate::ram::Ram;
    use crate::sbi::{SBI_ERR_INVALID_PARAM, SBI_SUCCESS};
    use alloc::boxed::Box;

    const RAM: usize = 64 * 1024;

    fn setup() -> (SbiState, SystemBus, VecSink) {
        let sink = VecSink::new();
        let reader = sink.clone();
        let state = SbiState {
            console_out: Some(Box::new(sink)),
            console_in: Default::default(),
        };
        (state, SystemBus::new(Ram::new(RAM).unwrap()), reader)
    }

    #[test]
    fn write_reads_guest_dram_and_reports_count() {
        let (mut st, mut bus, out) = setup();
        for (i, b) in b"hello sbi".iter().enumerate() {
            bus.store8(DRAM_BASE + 0x100 + i as u64, *b).unwrap();
        }
        let r = handle(
            &mut st,
            &mut bus,
            FID_CONSOLE_WRITE,
            &[9, DRAM_BASE + 0x100, 0, 0, 0, 0],
        );
        assert_eq!(
            (r.error, r.value),
            (SBI_SUCCESS, 9),
            "partial-write count in a1"
        );
        assert_eq!(out.captured(), b"hello sbi");
    }

    /// Charter attack matrix: num=0; wrap past 2^64; straddle end of DRAM; MMIO buffer;
    /// nonzero base_hi. Each → SBI error, never a host fault.
    #[test]
    fn write_attack_matrix() {
        let (mut st, mut bus, out) = setup();
        // num_bytes = 0: valid empty range → SUCCESS, 0 written.
        let r = handle(
            &mut st,
            &mut bus,
            FID_CONSOLE_WRITE,
            &[0, DRAM_BASE, 0, 0, 0, 0],
        );
        assert_eq!((r.error, r.value), (SBI_SUCCESS, 0));
        for (num, lo, hi) in [
            (u64::MAX, DRAM_BASE, 0),            // base+len wraps 2^64
            (16, DRAM_BASE + RAM as u64 - 8, 0), // straddles end of DRAM
            (4, UART0_BASE, 0),                  // MMIO, not DRAM
            (4, 0, 0),                           // below DRAM
            (4, DRAM_BASE, 1),                   // base_hi != 0 on RV64
        ] {
            let r = handle(
                &mut st,
                &mut bus,
                FID_CONSOLE_WRITE,
                &[num, lo, hi, 0, 0, 0],
            );
            assert_eq!(
                r.error, SBI_ERR_INVALID_PARAM,
                "num={num:#x} lo={lo:#x} hi={hi}"
            );
        }
        assert!(
            out.captured().is_empty(),
            "no byte leaked from rejected calls"
        );
    }

    #[test]
    fn read_drains_queue_nonblocking_and_write_byte() {
        let (mut st, mut bus, out) = setup();
        // Empty queue: 0 bytes read, SUCCESS — never blocks.
        let r = handle(
            &mut st,
            &mut bus,
            FID_CONSOLE_READ,
            &[8, DRAM_BASE, 0, 0, 0, 0],
        );
        assert_eq!((r.error, r.value), (SBI_SUCCESS, 0));
        // Queue "ab", ask for 8 → 2 read, bytes land in guest DRAM.
        st.console_in.extend(*b"ab");
        let r = handle(
            &mut st,
            &mut bus,
            FID_CONSOLE_READ,
            &[8, DRAM_BASE + 0x40, 0, 0, 0, 0],
        );
        assert_eq!((r.error, r.value), (SBI_SUCCESS, 2));
        assert_eq!(bus.load8(DRAM_BASE + 0x40).unwrap(), b'a');
        assert_eq!(bus.load8(DRAM_BASE + 0x41).unwrap(), b'b');
        // Rejected read buffer (MMIO) leaves the queue INTACT.
        st.console_in.extend(*b"xy");
        let r = handle(
            &mut st,
            &mut bus,
            FID_CONSOLE_READ,
            &[2, UART0_BASE, 0, 0, 0, 0],
        );
        assert_eq!(r.error, SBI_ERR_INVALID_PARAM);
        assert_eq!(st.console_in.len(), 2, "queue untouched on rejected read");
        // write_byte.
        let r = handle(
            &mut st,
            &mut bus,
            FID_CONSOLE_WRITE_BYTE,
            &[b'!' as u64, 0, 0, 0, 0, 0],
        );
        assert_eq!(r.error, SBI_SUCCESS);
        assert_eq!(out.captured().last(), Some(&b'!'));
        // Unknown FID.
        assert_eq!(
            handle(&mut st, &mut bus, 9, &[0; 6]),
            SbiRet::not_supported()
        );
    }
}
