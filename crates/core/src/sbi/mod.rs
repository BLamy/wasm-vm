//! SBI v2.0 implementation (E2-T03 skeleton → E2-T04 Base/DBCN/legacy).
//!
//! Per ADR 0002 the emulator IS the M-mode firmware: `ecall` from S-mode lands in
//! [`handle`], implemented in Rust. Calling convention: `a7`=EID, `a6`=FID, args `a0..a5`;
//! returns `a0`=error, `a1`=value — EXCEPT legacy extensions (EID < 0x10), which clobber
//! **only `a0`** (the run loop consults [`is_legacy`]).
//!
//! Implemented (E2-T04): **Base** (0x10 — spec/impl version, probe, machine ids),
//! **DBCN** (0x4442434E — console write/read/write_byte against guest DRAM), **legacy
//! console** (0x01 putchar / 0x02 getchar). TIME/IPI/RFENCE/HSM/SRST answer
//! `SBI_ERR_NOT_SUPPORTED` until E2-T05/T06 land; [`probe`] is the single source of the
//! implemented-set (Base `probe_extension` and the dispatcher both consult it).

pub mod base;
pub mod dbcn;
pub mod hsm;
pub mod ipi;
pub mod legacy;
pub mod rfence;
pub mod srst;
pub mod time;

use alloc::boxed::Box;
use alloc::collections::VecDeque;

use crate::dev::console::ConsoleSink;
use crate::hart::Hart;
use crate::mmio::SystemBus;
use crate::platform::virt::NUM_HARTS;

/// SBI return pair: `a0`=error, `a1`=value.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct SbiRet {
    pub error: i64,
    pub value: i64,
}

impl SbiRet {
    pub const fn ok(value: i64) -> Self {
        Self {
            error: SBI_SUCCESS,
            value,
        }
    }
    pub const fn not_supported() -> Self {
        Self {
            error: SBI_ERR_NOT_SUPPORTED,
            value: 0,
        }
    }
    pub const fn invalid_param() -> Self {
        Self {
            error: SBI_ERR_INVALID_PARAM,
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

// Extension IDs (ADR 0002 table).
pub const EID_BASE: u64 = 0x10;
pub const EID_DBCN: u64 = 0x4442434E;
pub const EID_TIME: u64 = 0x54494D45;
pub const EID_IPI: u64 = 0x0073_5049;
pub const EID_RFENCE: u64 = 0x5246_4E43;
pub const EID_HSM: u64 = 0x0048_534D;
pub const EID_SRST: u64 = 0x5352_5354;
pub const EID_LEGACY_PUTCHAR: u64 = 0x01;
pub const EID_LEGACY_GETCHAR: u64 = 0x02;

/// Legacy extensions (EID 0x00..=0x0F) return ONLY `a0` — the run loop must not write `a1`.
pub const fn is_legacy(eid: u64) -> bool {
    eid < 0x10
}

/// Probe answer for `eid`: nonzero iff the extension is CALLABLE now (the single source of
/// truth — Base `probe_extension` returns exactly this). The full Epic-2 set (ADR 0002
/// table) is now implemented: Base, DBCN, TIME, IPI, RFENCE, HSM, SRST, legacy console.
pub fn probe(eid: u64) -> u64 {
    match eid {
        EID_BASE | EID_DBCN | EID_TIME | EID_IPI | EID_RFENCE | EID_HSM | EID_SRST => 1,
        EID_LEGACY_PUTCHAR | EID_LEGACY_GETCHAR => 1,
        _ => 0,
    }
}

/// Mutable firmware-side console state the SBI console extensions drive.
///
/// Output goes to an optional host sink (the same [`ConsoleSink`] trait the E0 UART stub
/// uses — the host wires both to the same terminal); input is a byte queue the host pushes
/// into ([`crate::Machine::sbi_push_input`]). No sink ⇒ output bytes are dropped, reads see
/// an empty queue — a console-less machine still boots.
pub struct SbiState {
    pub(crate) console_out: Option<Box<dyn ConsoleSink>>,
    pub(crate) console_in: VecDeque<u8>,
    /// E2-T05 TIME: the programmed S-timer deadline in `mtime` units. The run loop derives
    /// `mip.STIP = (mtime >= stimecmp)` each boundary. `u64::MAX` = no timer ("cancel").
    pub(crate) stimecmp: u64,
    /// E2-T06 SRST: a requested shutdown (`Some(exit_code)`) — the run loop returns
    /// `RunOutcome::Exited(code)` before the guest executes another instruction.
    pub(crate) shutdown: Option<u64>,
}

impl Default for SbiState {
    fn default() -> Self {
        Self {
            console_out: None,
            console_in: VecDeque::new(),
            stimecmp: u64::MAX, // reset: no timer programmed — never fires
            shutdown: None,
        }
    }
}

impl SbiState {
    pub(crate) fn put_byte(&mut self, b: u8) {
        if let Some(sink) = self.console_out.as_mut() {
            sink.put_byte(b);
        }
    }
}

/// Decode the SBI `(hart_mask, hart_mask_base)` addressing (§Binary Encoding) against the
/// current topology: `base == u64::MAX` means "all harts"; a base beyond the topology or a
/// mask bit naming a nonexistent hart is INVALID_PARAM. Returns the ABSOLUTE hart bitmap
/// (bit i = hartid i) — single-hart today, unchanged shape for Epic 6 SMP.
pub(crate) fn decode_hart_mask(mask: u64, base: u64) -> Result<u64, SbiRet> {
    let n = NUM_HARTS as u64;
    if base == u64::MAX {
        return Ok((1 << n) - 1); // all harts
    }
    if base >= n || (mask >> (n - base)) != 0 {
        return Err(SbiRet::invalid_param());
    }
    Ok(mask << base)
}

/// One SBI call. `eid`/`fid` from `a7`/`a6`, `args` from `a0..a5`; needs the bus (DBCN reads
/// and writes guest DRAM), the hart (IPI raises SSIP, RFENCE flushes the TLB), and the
/// firmware console state.
pub fn handle(
    state: &mut SbiState,
    bus: &mut SystemBus,
    hart: &mut Hart,
    eid: u64,
    fid: u64,
    args: &[u64; 6],
) -> SbiRet {
    match eid {
        EID_BASE => base::handle(fid, args),
        EID_DBCN => dbcn::handle(state, bus, fid, args),
        EID_TIME => time::handle(state, fid, args),
        EID_IPI => ipi::handle(hart, fid, args),
        EID_RFENCE => rfence::handle(hart, fid, args),
        EID_HSM => hsm::handle(fid, args),
        EID_SRST => srst::handle(state, fid, args),
        EID_LEGACY_PUTCHAR | EID_LEGACY_GETCHAR => legacy::handle(state, eid, args),
        // Unknown EID: the spec probe answer, never a trap or panic.
        _ => SbiRet::not_supported(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::mmio::SystemBus;
    use crate::ram::Ram;

    fn bus() -> SystemBus {
        SystemBus::new(Ram::new(64 * 1024).unwrap())
    }

    /// Unknown EIDs → NOT_SUPPORTED (-2); never panics.
    #[test]
    fn unknown_and_pending_eids_not_supported() {
        let mut st = SbiState::default();
        let mut b = bus();
        let mut h = crate::hart::Hart::new();
        for eid in [0u64, 0x0A, 0xDEAD, u64::MAX] {
            let ret = handle(&mut st, &mut b, &mut h, eid, 0, &[0; 6]);
            assert_eq!(ret.error, SBI_ERR_NOT_SUPPORTED, "eid {eid:#x}");
            assert_eq!(ret.value, 0);
        }
    }

    /// The probe set: implemented ⇒ 1, pending/unknown ⇒ 0.
    #[test]
    fn probe_set_matches_plan() {
        for (eid, want) in [
            (EID_BASE, 1),
            (EID_DBCN, 1),
            (EID_LEGACY_PUTCHAR, 1),
            (EID_LEGACY_GETCHAR, 1),
            (EID_TIME, 1), // E2-T05
            (EID_IPI, 1),  // E2-T06
            (EID_RFENCE, 1),
            (EID_HSM, 1),
            (EID_SRST, 1),
            (0x0A, 0), // PMU — acceptance names it explicitly
        ] {
            assert_eq!(probe(eid), want, "probe({eid:#x})");
        }
    }

    /// Dispatcher fuzz (charter): 10^6 deterministic-random EID/FID/arg calls — no panic,
    /// no hang; every return is a valid SbiRet with a spec error code.
    #[test]
    fn dispatcher_fuzz_1e6() {
        let mut st = SbiState::default();
        let mut b = bus();
        let mut h = crate::hart::Hart::new();
        let mut x = 0x243F_6A88_85A3_08D3u64; // deterministic LCG/xorshift seed
        let mut next = move || {
            x ^= x << 13;
            x ^= x >> 7;
            x ^= x << 17;
            x
        };
        for _ in 0..1_000_000 {
            let eid = next();
            let fid = next() & 0xF;
            let args = [next(), next(), next(), next(), next(), next()];
            let ret = handle(&mut st, &mut b, &mut h, eid, fid, &args);
            assert!(
                (-9..=0).contains(&ret.error),
                "non-spec error {} for eid {eid:#x}",
                ret.error
            );
        }
    }
}
