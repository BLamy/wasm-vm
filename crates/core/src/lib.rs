//! wasm-vm-core: the emulator itself.
//!
//! This crate is `no_std`-friendly (build with `--no-default-features`) and must stay
//! free of every browser- and JS-facing dependency. Anything that talks to the web
//! belongs in `wasm-vm-wasm`; anything that talks to a host OS belongs in `wasm-vm-cli`
//! or behind the `std` feature here.

#![cfg_attr(not(feature = "std"), no_std)]

extern crate alloc;

pub mod bus;
pub mod decode;
pub mod hart;
pub mod htif;
pub mod loader;
pub mod mmio;
pub mod ram;

use hart::{Hart, Trap};
use htif::{Htif, HtifStatus};
use loader::ElfError;
use mmio::SystemBus;
use ram::Ram;

/// The crate version, sourced from `Cargo.toml`.
pub fn version() -> &'static str {
    env!("CARGO_PKG_VERSION")
}

/// How a [`Machine::run`] loop ended. Exhaustively matched by the CLI and wasm
/// layers — no `_ =>` swallowing (the whole point of the enum).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RunOutcome {
    /// The guest requested exit via the HTIF `tohost` convention.
    Exited(u64),
    /// A trap escaped the run loop (no CSR trap delivery at Level 0).
    Trapped(Trap),
    /// The instruction budget was exhausted without exit or trap.
    MaxInstrs,
}

/// A full Level-0 machine: one hart on a system bus, plus optional HTIF exit
/// watching. Grown from the E0-T01 placeholder — the `new`/`ram_len` surface is
/// preserved (E0-T01's verified tests and the wasm wrapper depend on it).
pub struct Machine {
    hart: Hart,
    bus: SystemBus,
    htif: Option<Htif>,
    /// Last observed `tohost` value — the watch fires only on CHANGE, giving
    /// exactly-once semantics for command writes ("logged once", E0-T11).
    last_tohost: u64,
    /// Count of unsupported (LSB-clear, non-zero) command writes seen.
    htif_commands: u64,
}

impl Machine {
    /// Create a machine with `ram_bytes` of zeroed guest RAM at `DRAM_BASE`, an
    /// empty hart (PC 0), and no HTIF watch. Infallible for the sizes E0-T01
    /// exercises (0 and small); `Ram::new` only errs on allocation failure.
    pub fn new(ram_bytes: usize) -> Self {
        Self {
            hart: Hart::new(),
            bus: SystemBus::new(Ram::new(ram_bytes).expect("guest RAM allocation failed")),
            htif: None,
            last_tohost: 0,
            htif_commands: 0,
        }
    }

    /// Size of guest RAM in bytes.
    pub fn ram_len(&self) -> usize {
        self.bus.ram().len()
    }

    /// Load an ELF image: copy segments into RAM, set the PC to `e_entry`, and
    /// arm the HTIF watch on `tohost` if the symbol is present. A missing `tohost`
    /// leaves HTIF unarmed → the guest can only end via trap or `MaxInstrs`.
    pub fn load_elf(&mut self, bytes: &[u8]) -> Result<(), ElfError> {
        let img = loader::load_elf(bytes, self.bus.ram_mut())?;
        self.hart.regs.pc = img.entry;
        self.htif = img.tohost.map(Htif::new);
        self.last_tohost = self
            .htif
            .map_or(0, |h| h.check(&mut self.bus).raw_or_zero());
        Ok(())
    }

    /// Borrow the hart / bus for test rigs and the CLI (seeding instructions,
    /// inspecting the register file).
    pub fn hart_mut(&mut self) -> &mut Hart {
        &mut self.hart
    }
    pub fn bus_mut(&mut self) -> &mut SystemBus {
        &mut self.bus
    }
    pub fn hart(&self) -> &Hart {
        &self.hart
    }

    /// Arm the HTIF watch directly (for blobs assembled in-memory without an ELF).
    pub fn set_htif(&mut self, tohost_addr: u64) {
        self.htif = Some(Htif::new(tohost_addr));
        self.last_tohost = self
            .htif
            .map_or(0, |h| h.check(&mut self.bus).raw_or_zero());
    }

    /// Count of unsupported HTIF command writes observed so far ("logged once"
    /// each: the change-detection watch never re-counts a value that sits).
    pub fn htif_command_count(&self) -> u64 {
        self.htif_commands
    }

    /// Step up to `max_instrs` instructions, consulting HTIF after each. Returns
    /// on the first guest exit, the first escaping trap, or after exactly
    /// `max_instrs` retirements — whichever comes first.
    pub fn run(&mut self, max_instrs: u64) -> RunOutcome {
        for _ in 0..max_instrs {
            if let Err(trap) = self.hart.step(&mut self.bus) {
                return RunOutcome::Trapped(trap);
            }
            // Consult HTIF only when it is armed and the word CHANGED — this is
            // what makes command writes "logged once" rather than re-counted.
            if let Some(htif) = self.htif {
                let raw = htif.check(&mut self.bus).raw_or_zero();
                if raw != self.last_tohost {
                    self.last_tohost = raw;
                    match HtifStatus::decode(raw) {
                        HtifStatus::Exit(e) => return RunOutcome::Exited(e.code),
                        HtifStatus::Command(_) => self.htif_commands += 1,
                        HtifStatus::Idle => {}
                    }
                }
            }
        }
        RunOutcome::MaxInstrs
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
