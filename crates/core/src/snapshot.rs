//! E0-T17: deterministic machine-state snapshot and digest.
//!
//! Cross-build determinism is Epic 0's core promise; this is its cheapest measuring
//! instrument. A [`Snapshot`] captures the *architectural* state — PC, all 32 integer
//! registers, and a SHA-256 over the entire guest RAM byte array in address order — so
//! any two runs (native vs. wasm, trace-on vs. trace-off, before vs. after a refactor)
//! collapse to one `==`.
//!
//! Why SHA-256 (via `sha2`, `default-features = false`) rather than a fast
//! non-cryptographic hash: this is an *assertion helper*, so cross-platform bit-stability
//! and zero collision arguments matter far more than speed. The digest input is exactly
//! the RAM bytes ([`crate::ram::Ram::as_bytes`]) — device and hart state are struct
//! fields, not digest input, which keeps the digest a pure function of memory.
//!
//! Cost is O(RAM): digesting the full 128 MiB default RAM measures ~0.55 s in a release
//! build on the dev machine (informational — this is an assertion helper for tests and
//! `--dump-state`, not a hot path; there is no threshold).

use sha2::{Digest, Sha256};

use crate::Machine;

/// A comparable snapshot of architectural machine state.
///
/// `PartialEq`/`Eq` compare every field; two snapshots are equal iff PC, all registers,
/// and every RAM byte agree. `Debug` prints the digest as fixed-width hex bytes.
#[derive(Clone, PartialEq, Eq)]
pub struct Snapshot {
    /// Program counter.
    pub pc: u64,
    /// The 32 integer registers, `x0..=x31`. `xregs[0]` is always 0 (hardwired zero).
    pub xregs: [u64; 32],
    /// SHA-256 of all guest RAM in address order.
    pub mem_digest: [u8; 32],
}

impl Snapshot {
    /// The memory digest as a 64-character lowercase hex string.
    ///
    /// Always available: the crate links `alloc` unconditionally, so this needs neither
    /// `std` nor a feature gate. Byte-for-byte comparable against system
    /// `shasum -a 256` of a RAM dump (the verifier's independent-recomputation attack).
    pub fn hex_digest(&self) -> alloc::string::String {
        use core::fmt::Write as _;
        let mut s = alloc::string::String::with_capacity(64);
        for b in self.mem_digest {
            // `write!` to a String is infallible.
            let _ = write!(s, "{b:02x}");
        }
        s
    }

    /// The final line the CLI `--dump-state` flag prints after the E0-T05 register dump:
    /// `state sha256=<64 hex>`. Frozen here so the flag (wired in E0-T18) and any golden
    /// test share one contract; independently checkable against `shasum -a 256` of a RAM
    /// dump.
    pub fn state_sha256_line(&self) -> alloc::string::String {
        alloc::format!("state sha256={}", self.hex_digest())
    }
}

impl core::fmt::Debug for Snapshot {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        f.debug_struct("Snapshot")
            .field("pc", &format_args!("{:#018x}", self.pc))
            .field("xregs", &self.xregs)
            .field("mem_digest", &format_args!("{}", self.hex_digest()))
            .finish()
    }
}

impl Machine {
    /// Capture the current architectural state. Pure: takes `&self`, mutates nothing —
    /// snapshotting must never perturb a run (the observer property the digest exists to
    /// prove). O(RAM) in the digest; see the task doc for 128 MiB timing.
    pub fn snapshot(&self) -> Snapshot {
        let mut xregs = [0u64; 32];
        for (i, x) in xregs.iter_mut().enumerate() {
            // read(0) is architecturally 0; this includes x0 for a complete, indexable
            // register image without special-casing.
            *x = self.hart.regs.read(i as u8);
        }
        let mut hasher = Sha256::new();
        hasher.update(self.bus.ram().as_bytes());
        Snapshot {
            pc: self.hart.regs.pc,
            xregs,
            mem_digest: hasher.finalize().into(),
        }
    }
}
