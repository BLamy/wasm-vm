//! wasm-vm-core: the emulator itself.
//!
//! This crate is `no_std`-friendly (build with `--no-default-features`) and must stay
//! free of every browser- and JS-facing dependency. Anything that talks to the web
//! belongs in `wasm-vm-wasm`; anything that talks to a host OS belongs in `wasm-vm-cli`
//! or behind the `std` feature here.

#![cfg_attr(not(feature = "std"), no_std)]

extern crate alloc;

pub mod bus;
pub mod mmio;
pub mod ram;

use alloc::vec;
use alloc::vec::Vec;

/// The crate version, sourced from `Cargo.toml`.
pub fn version() -> &'static str {
    env!("CARGO_PKG_VERSION")
}

/// Placeholder machine: owns guest RAM and nothing else yet.
///
/// E0-T03 replaces the bare `Vec` with the physical-memory model and bus trait;
/// E0-T05/T06/T07 grow this into a hart. The shape that matters now is that the
/// machine is constructible from a RAM size alone, with no host- or web-specific
/// types anywhere in its API.
pub struct Machine {
    ram: Vec<u8>,
}

impl Machine {
    /// Create a machine with `ram_bytes` of zeroed guest RAM.
    pub fn new(ram_bytes: usize) -> Self {
        Self {
            ram: vec![0; ram_bytes],
        }
    }

    /// Size of guest RAM in bytes.
    pub fn ram_len(&self) -> usize {
        self.ram.len()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn version_matches_manifest() {
        // Golden value, not env!("CARGO_PKG_VERSION") — comparing version() against the
        // same macro it returns is a tautology that can never fail (verifier finding,
        // 2026-07-02). Bump this literal when the workspace version bumps.
        assert_eq!(version(), "0.0.1");
    }

    #[test]
    fn machine_allocates_requested_ram() {
        let m = Machine::new(4096);
        assert_eq!(m.ram_len(), 4096);
    }

    #[test]
    fn machine_tolerates_zero_ram() {
        let m = Machine::new(0);
        assert_eq!(m.ram_len(), 0);
    }
}
