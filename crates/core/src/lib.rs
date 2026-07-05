//! wasm-vm-core: the emulator itself.
//!
//! This crate is `no_std`-friendly (build with `--no-default-features`) and must stay
//! free of every browser- and JS-facing dependency. Anything that talks to the web
//! belongs in `wasm-vm-wasm`; anything that talks to a host OS belongs in `wasm-vm-cli`
//! or behind the `std` feature here.
//!
//! # Feature matrix
//!
//! | Features     | `std` | Tracing | Notes                                         |
//! |--------------|-------|---------|-----------------------------------------------|
//! | *(none)*     | no    | off     | leanest `no_std` build (embed / wasm)         |
//! | `std`        | yes   | off     | default; host integration                     |
//! | `trace`      | no    | on      | `no_std` + instruction-trace hooks (E0-T16)   |
//! | `std,trace`  | yes   | on      | full host + tracing                           |
//!
//! Diagnostics route through the [`log`] facade (never `println!`), so hosts choose the
//! backend (`env_logger` in the CLI, `console_log` in wasm). **Tracing is zero-cost when
//! off**: it is a generic [`trace::TraceSink`] type parameter whose [`trace::NullSink`]
//! has empty `#[inline(always)]` methods, so a release build erases the hook entirely
//! (proven by `tools/check-zero-cost.sh`). Only genuine data-cost machinery is gated by
//! `#[cfg(feature = "trace")]`.

#![cfg_attr(not(feature = "std"), no_std)]

extern crate alloc;

pub mod bus;
pub mod decode;
pub mod dev;
pub mod hart;
pub mod htif;
pub mod loader;
pub mod mmio;
pub mod ram;
pub mod snapshot;
pub mod trace;
#[cfg(feature = "zicsr-stub")]
pub mod zicsr_stub;

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
    /// empty hart (PC 0), and no HTIF watch. Panics only on allocation failure — use
    /// [`Self::try_new`] when the size comes from untrusted input (e.g. the wasm wrapper).
    pub fn new(ram_bytes: usize) -> Self {
        Self::try_new(ram_bytes).expect("guest RAM allocation failed")
    }

    /// Fallible constructor: returns [`ram::OutOfMemory`] instead of panicking when the
    /// allocation is refused, so a hostile RAM size becomes a caught error rather than a
    /// process abort. `Ram::new` allocates through `try_reserve_exact`.
    pub fn try_new(ram_bytes: usize) -> Result<Self, ram::OutOfMemory> {
        Ok(Self {
            hart: Hart::new(),
            bus: SystemBus::new(Ram::new(ram_bytes)?),
            htif: None,
            last_tohost: 0,
            htif_commands: 0,
        })
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

    /// Step one instruction with a [`trace::TraceSink`] hook (E0-T16). Does NOT consult
    /// HTIF — the caller drives termination (e.g. via [`Self::htif_exit`]); use this to
    /// trace a run instruction-by-instruction. `step_traced(&mut NullSink)` is exactly
    /// [`Self::run`]'s per-step behavior.
    pub fn step_traced<T: trace::TraceSink>(&mut self, sink: &mut T) -> Result<(), hart::Trap> {
        self.hart.step_traced(&mut self.bus, sink)
    }

    /// If HTIF is armed and `tohost` currently requests exit, the exit code; else `None`.
    /// A read-only peek for trace loops (does not affect the "logged once" command watch).
    pub fn htif_exit(&mut self) -> Option<u64> {
        let htif = self.htif?;
        match htif.check(&mut self.bus) {
            HtifStatus::Exit(e) => Some(e.code),
            _ => None,
        }
    }

    /// Step up to `max_instrs` instructions, consulting HTIF after each. Returns
    /// on the first guest exit, the first escaping trap, or after exactly
    /// `max_instrs` retirements — whichever comes first.
    ///
    /// Zero-cost: delegates to [`Self::run_traced`] with a [`trace::NullSink`], whose
    /// empty `#[inline(always)]` `retire` erases the hook entirely (same monomorphization
    /// the E0-T16 zero-cost proof covers), so this is identical to a hand-written
    /// `hart.step` loop.
    pub fn run(&mut self, max_instrs: u64) -> RunOutcome {
        self.run_traced(max_instrs, &mut trace::NullSink)
    }

    /// Like [`Self::run`], but feeds every retired instruction to `sink` (E0-T18's
    /// `--trace`). Termination and the "logged once" HTIF command watch are identical to
    /// `run` — the ONE place the run-loop / HTIF state machine lives, so a traced run and
    /// an untraced run can never diverge in when they stop.
    pub fn run_traced<T: trace::TraceSink>(&mut self, max_instrs: u64, sink: &mut T) -> RunOutcome {
        for _ in 0..max_instrs {
            if let Err(trap) = self.hart.step_traced(&mut self.bus, sink) {
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
                        HtifStatus::Command(v) => {
                            log::debug!("HTIF command ignored: tohost={v:#018x}");
                            self.htif_commands += 1;
                        }
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
