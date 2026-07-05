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
pub mod csr;
pub mod decode;
pub mod decode_c;
pub mod dev;
pub mod fdt;
pub mod hart;
pub mod htif;
pub mod loader;
pub mod mmio;
pub mod mmu;
pub mod platform;
pub mod pmp;
pub mod ram;
pub mod sbi;
pub mod snapshot;
pub mod softfloat;
pub mod tlb;
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
    /// CLINT shared state (E1-T12), present when [`Self::enable_clint`] attached the device.
    /// The run loop advances `mtime` from the retire count and samples MTIP/MSIP into `mip`.
    clint: Option<alloc::rc::Rc<core::cell::RefCell<dev::clint::ClintState>>>,
    /// `mtime` advances one tick per `clock_div` retired instructions (deterministic clock).
    clock_div: u64,
    /// Sub-divider remainder: retirements not yet worth a whole `mtime` tick.
    tick_accum: u64,
    /// PLIC shared state (E1-T13), present when [`Self::enable_plic`] attached the device. The
    /// run loop samples the per-context EIP levels into `mip.MEIP`/`mip.SEIP`.
    plic: Option<alloc::rc::Rc<core::cell::RefCell<dev::plic::PlicState>>>,
    /// E2-T03 (ADR 0002): when set, the emulator IS the M-mode firmware — `ecall` from S-mode
    /// is answered by [`sbi::dispatch`] in Rust instead of being delivered to a guest M-mode
    /// handler. Off by default (bare-metal tests and RISCOF keep architectural delivery).
    /// (Only read on the real-CSR path; the quarantined zicsr-stub build has no S-mode.)
    #[cfg_attr(feature = "zicsr-stub", allow(dead_code))]
    builtin_sbi: bool,
    /// SBI console state (E2-T04): host output sink + input queue for DBCN/legacy console.
    #[cfg_attr(feature = "zicsr-stub", allow(dead_code))]
    sbi_state: sbi::SbiState,
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
            clint: None,
            clock_div: 1,
            tick_accum: 0,
            plic: None,
            builtin_sbi: false,
            sbi_state: sbi::SbiState::default(),
        })
    }

    /// Attach a CLINT (E1-T12) at [`bus::mmap::CLINT_BASE`] and drive its `mtime` from the
    /// retired-instruction count: one tick per `clock_div` retirements (a deterministic clock
    /// — native and wasm agree). `clock_div` is clamped to at least 1. The run loop then
    /// samples MTIP (`mtime >= mtimecmp`) and MSIP into `mip` at every instruction boundary.
    /// Returns the shared state handle so tests/hosts can inspect or drive the registers.
    pub fn enable_clint(
        &mut self,
        clock_div: u64,
    ) -> alloc::rc::Rc<core::cell::RefCell<dev::clint::ClintState>> {
        let (device, state) = dev::clint::Clint::new();
        self.bus
            .attach(
                bus::mmap::CLINT_BASE,
                dev::clint::CLINT_LEN,
                alloc::boxed::Box::new(device),
            )
            .expect("CLINT window overlaps RAM or another device");
        self.clock_div = clock_div.max(1);
        self.tick_accum = 0;
        self.clint = Some(alloc::rc::Rc::clone(&state));
        state
    }

    /// Attach a PLIC (E1-T13) at [`bus::mmap::PLIC_BASE`] and drive `mip.MEIP` (hart-0 M context
    /// 0) / `mip.SEIP` (hart-0 S context 1) from its external-interrupt levels each instruction
    /// boundary. Returns the shared state handle so tests/devices can program registers and
    /// obtain [`dev::plic::IrqLine`]s.
    pub fn enable_plic(&mut self) -> alloc::rc::Rc<core::cell::RefCell<dev::plic::PlicState>> {
        let (device, state) = dev::plic::Plic::new();
        self.bus
            .attach(
                bus::mmap::PLIC_BASE,
                dev::plic::PLIC_LEN,
                alloc::boxed::Box::new(device),
            )
            .expect("PLIC window overlaps RAM or another device");
        self.plic = Some(alloc::rc::Rc::clone(&state));
        state
    }

    /// Size of guest RAM in bytes.
    pub fn ram_len(&self) -> usize {
        self.bus.ram().len()
    }

    /// E2-T03 (ADR 0002): route `ecall`-from-S to the built-in Rust SBI ([`sbi::dispatch`])
    /// instead of delivering it as an architectural trap. Enable together with
    /// [`Self::boot_supervisor`] for the emulator-as-firmware boot path.
    #[cfg(not(feature = "zicsr-stub"))]
    pub fn enable_builtin_sbi(&mut self) {
        self.builtin_sbi = true;
    }

    /// E2-T04: where SBI console output (DBCN + legacy putchar) goes — the same
    /// [`dev::console::ConsoleSink`] trait the UART stub uses, so hosts wire both channels
    /// to one terminal. Without a sink, SBI console output is dropped (machine still runs).
    #[cfg(not(feature = "zicsr-stub"))]
    pub fn sbi_set_console(&mut self, sink: alloc::boxed::Box<dyn dev::console::ConsoleSink>) {
        self.sbi_state.console_out = Some(sink);
    }

    /// E2-T04: queue host input bytes for SBI console reads (DBCN `console_read` / legacy
    /// `getchar`). Non-blocking semantics are the callee's: an empty queue reads 0 / -1.
    #[cfg(not(feature = "zicsr-stub"))]
    pub fn sbi_push_input(&mut self, bytes: &[u8]) {
        self.sbi_state.console_in.extend(bytes.iter().copied());
    }

    /// E2-T03 boot contract (ADR 0002): enter a supervisor payload the way OpenSBI `fw_jump`
    /// would hand off to a kernel. Sets, precisely:
    /// - privilege = **S-mode**, `pc = platform::virt::KERNEL_BASE` (0x8020_0000);
    /// - `a0 = hartid`, `a1 = dtb_addr` (the standard Linux/SBI convention);
    /// - `mideleg = 0x222` (SSI/STI/SEI to S), `medeleg = 0xB109` (misaligned-fetch,
    ///   breakpoint, ecall-from-U, and the three page-faults to S — OpenSBI's own set);
    /// - `satp = 0` (Bare; the kernel builds its own tables), `sstatus.SIE = 0`
    ///   (interrupts masked until the kernel opts in) — both reset defaults, restated here
    ///   as part of the contract;
    /// - PMP entry 0 opened R/W/X over all of memory (S-mode needs an explicit grant).
    #[cfg(not(feature = "zicsr-stub"))]
    pub fn boot_supervisor(&mut self, hartid: u64, dtb_addr: u64) {
        use crate::csr::{CsrOp, MEDELEG, MIDELEG, Priv};
        self.hart.csr.pmp.allow_all();
        // Legalized writes from M (the mode we're in pre-handoff).
        self.hart.csr.mode = Priv::M;
        self.hart
            .csr
            .access(MIDELEG, CsrOp::Write, 0x222, false, false, 0)
            .expect("mideleg write from M cannot fail");
        self.hart
            .csr
            .access(MEDELEG, CsrOp::Write, 0xB109, false, false, 0)
            .expect("medeleg write from M cannot fail");
        self.hart.csr.mode = Priv::S;
        self.hart.regs.pc = platform::virt::KERNEL_BASE;
        self.hart.regs.write(10, hartid); // a0
        self.hart.regs.write(11, dtb_addr); // a1
    }

    /// Load an ELF image: copy segments into RAM, set the PC to `e_entry`, and
    /// arm the HTIF watch on `tohost` if the symbol is present. A missing `tohost`
    /// leaves HTIF unarmed → the guest can only end via trap or `MaxInstrs`. Returns the
    /// [`loader::LoadedImage`] (entry + HTIF + RISCOF signature symbols) — existing callers
    /// that ignore it are unaffected.
    pub fn load_elf(&mut self, bytes: &[u8]) -> Result<loader::LoadedImage, ElfError> {
        let img = loader::load_elf(bytes, self.bus.ram_mut())?;
        self.hart.regs.pc = img.entry;
        self.htif = img.tohost.map(Htif::new);
        self.last_tohost = self
            .htif
            .map_or(0, |h| h.check(&mut self.bus).raw_or_zero());
        Ok(img)
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

    /// RISCOF signature dump (E1-T20): the memory region `[begin, end)` formatted as the
    /// arch-test signature — one `granularity`-byte little-endian value per line, lowercase
    /// hex, zero-padded to `2*granularity` digits. Only `granularity == 4` (the RISCOF default)
    /// is supported. Reads through the bus (so it goes through the same physical map the guest
    /// wrote); a byte outside RAM reads 0. `end` is rounded up to the next word.
    pub fn signature(
        &mut self,
        begin: u64,
        end: u64,
        granularity: u32,
    ) -> Result<alloc::string::String, alloc::string::String> {
        use crate::bus::Bus;
        use core::fmt::Write as _;
        // `String`/`format!` come from `alloc`, not the prelude, under the `no_std` (wasm)
        // build — fully-qualify so this compiles in BOTH configs (E1-T24 gate caught a
        // latent no_std break here: the E1-T20 signature dump used the bare prelude names,
        // which silently broke `make wasm` until the Level-1 gate exercised the wasm leg).
        if granularity != 4 {
            return Err(alloc::format!(
                "unsupported --signature-granularity {granularity} (only 4)"
            ));
        }
        let mut out = alloc::string::String::new();
        let mut a = begin & !3; // word-align the start
        while a < end {
            let w = self.bus.load32(a).unwrap_or(0);
            let _ = writeln!(out, "{w:08x}");
            a += 4;
        }
        Ok(out)
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

    /// One PURE step (E1-T10): fetch-decode-execute a single instruction WITHOUT trap
    /// delivery. On `Err(trap)` the PC and all architectural state are exactly as before —
    /// the faulting instruction's raw `Trap` is surfaced, not vectored through mtvec. The
    /// run loop layers delivery on top; this is the primitive tests use to inspect a raw
    /// trap or prove execute-purity.
    pub fn step(&mut self) -> Result<(), hart::Trap> {
        self.hart.step_traced(&mut self.bus, &mut trace::NullSink)
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

    /// E1-T12: mirror the CLINT interrupt LEVELS into `mip`. MTIP (bit 7) tracks
    /// `mtime >= mtimecmp` and MSIP (bit 3) tracks `msip` — device-owned bits software cannot
    /// set. A no-op when no CLINT is attached.
    #[cfg(not(feature = "zicsr-stub"))]
    fn sync_clint(&mut self) {
        if let Some(clint) = &self.clint {
            let s = *clint.borrow();
            self.hart.csr.set_mip_bit(7, s.mtip()); // MTIP
            self.hart.csr.set_mip_bit(3, s.msip); // MSIP
            // E1-T14: the unprivileged `time` counter is a window onto the CLINT mtime — refresh
            // its shadow each instruction boundary so `rdtime` tracks the deterministic clock.
            self.hart.csr.set_time(s.mtime);
        }
    }

    /// E1-T13: mirror the PLIC external-interrupt levels into `mip`: MEIP (bit 11) from the
    /// M-mode context (0), SEIP (bit 9) from the S-mode context (1) — device-owned bits. A no-op
    /// when no PLIC is attached.
    ///
    /// SIMPLIFICATION: strictly, `mip.SEIP` is `software_SEIP | controller_SEIP` (Priv §3.1.9) —
    /// SEIP is writable by M-mode (E1-T11 keeps bit 9 in `MIP_SW_WMASK`) AND driven by the
    /// interrupt controller. Here the PLIC OWNS the S-external line, so we OVERWRITE SEIP with the
    /// controller signal rather than OR-ing it with a software-injected bit. Every PLIC-driven
    /// guest (OpenSBI/Linux) drives SEIP through the controller, so this changes no real flow; a
    /// full OR would matter only for a guest that injects SEIP via `csrs mip` while also using the
    /// PLIC, which does not occur in this system. (MEIP is not software-writable, so it has no such
    /// interaction.)
    #[cfg(not(feature = "zicsr-stub"))]
    fn sync_plic(&mut self) {
        if let Some(plic) = &self.plic {
            let s = plic.borrow();
            let meip = s.eip(0);
            let seip = s.eip(1);
            drop(s);
            self.hart.csr.set_mip_bit(11, meip); // MEIP ← M context
            self.hart.csr.set_mip_bit(9, seip); // SEIP ← S context (see SIMPLIFICATION above)
        }
    }

    /// E1-T12: advance `mtime` by one tick per `clock_div` retired instructions — the
    /// deterministic clock source (native and wasm retire identically, so a timer interrupt
    /// lands at the same retire index). A no-op when no CLINT is attached.
    #[cfg(not(feature = "zicsr-stub"))]
    fn advance_clock(&mut self) {
        if let Some(clint) = &self.clint {
            self.tick_accum += 1;
            if self.tick_accum >= self.clock_div {
                let ticks = self.tick_accum / self.clock_div;
                self.tick_accum %= self.clock_div;
                let mut s = clint.borrow_mut();
                s.mtime = s.mtime.wrapping_add(ticks);
            }
        }
    }

    /// Like [`Self::run`], but feeds every retired instruction to `sink` (E0-T18's
    /// `--trace`). Termination and the "logged once" HTIF command watch are identical to
    /// `run` — the ONE place the run-loop / HTIF state machine lives, so a traced run and
    /// an untraced run can never diverge in when they stop.
    pub fn run_traced<T: trace::TraceSink>(&mut self, max_instrs: u64, sink: &mut T) -> RunOutcome {
        for _ in 0..max_instrs {
            // E1-T12: refresh the CLINT-driven interrupt LEVELS (MTIP = mtime >= mtimecmp, MSIP
            // = msip) into `mip` before sampling — a continuously re-evaluated level, so a
            // just-crossed timer fires and a raised `mtimecmp` clears MTIP with no CSR access.
            #[cfg(not(feature = "zicsr-stub"))]
            {
                self.sync_clint();
                // E1-T13: refresh the PLIC-driven MEIP/SEIP levels too, before sampling.
                self.sync_plic();
            }
            // E1-T11: sample interrupts at the instruction boundary (precise). Deliver the
            // highest-priority pending&enabled interrupt through mtvec/stvec BEFORE fetching the
            // next instruction — sepc/mepc then points at the resume address (the interrupted
            // instruction fully retired or never ran). Taking the trap clears xIE, so a pending
            // line does not re-fire while its handler runs. (No real CSR file under zicsr-stub.)
            #[cfg(not(feature = "zicsr-stub"))]
            if let Some((cause, to_s)) = self.hart.csr.next_interrupt() {
                let epc = self.hart.regs.pc;
                self.hart.take_interrupt(cause, to_s, epc);
                continue;
            }
            let step_result = self.hart.step_traced(&mut self.bus, sink);
            // E1-T12: an instruction retired iff the step succeeded — advance the deterministic
            // retire-count clock ONLY then (a delivered trap or a taken interrupt retires nothing).
            #[cfg(not(feature = "zicsr-stub"))]
            if step_result.is_ok() {
                self.advance_clock();
            }
            if let Err(trap) = step_result {
                // E2-T03 (ADR 0002): with the built-in SBI enabled, `ecall` from S-mode is a
                // FIRMWARE CALL, not an architectural trap — answer it in Rust and resume at
                // the next instruction (ecall is always a 4-byte encoding). a7=EID, a6=FID,
                // a0..a5=args; returns a0=error, a1=value. Everything else still traps below.
                #[cfg(not(feature = "zicsr-stub"))]
                if self.builtin_sbi && trap.cause == hart::Exception::EcallFromS {
                    let eid = self.hart.regs.read(17); // a7
                    let fid = self.hart.regs.read(16); // a6
                    let args = [
                        self.hart.regs.read(10),
                        self.hart.regs.read(11),
                        self.hart.regs.read(12),
                        self.hart.regs.read(13),
                        self.hart.regs.read(14),
                        self.hart.regs.read(15),
                    ];
                    let ret = sbi::handle(&mut self.sbi_state, &mut self.bus, eid, fid, &args);
                    self.hart.regs.write(10, ret.error as u64); // a0
                    // Legacy extensions (EID < 0x10) clobber ONLY a0 (SBI v0.1 convention).
                    if !sbi::is_legacy(eid) {
                        self.hart.regs.write(11, ret.value as u64); // a1
                    }
                    self.hart.regs.pc = self.hart.regs.pc.wrapping_add(4);
                    continue;
                }
                // E1-T10: DELIVER the trap through the CSR machinery (mepc/mcause/mtval +
                // mtvec vector) and keep running — a guest with a handler installed resumes
                // at mtvec. `step`/`execute` stay pure (they returned Err having touched
                // nothing), so `take_trap` writes the ONLY architectural effect.
                //
                // HOST CONVENTION: if NO handler is installed (mtvec BASE == 0, its reset
                // value), the trap is UNHANDLED — vectoring to address 0 would just re-trap
                // forever. Surface it to the host as `Trapped` instead, so the native runner
                // can report the cause and a bare ECALL/EBREAK is observable. Every real guest
                // (OpenSBI, the riscv-tests p-env, Linux) sets mtvec before it can trap, so
                // this only affects handler-less host-level programs and never changes the
                // architectural delivery those guests see. Under the quarantined zicsr-stub
                // there is no real CSR file, so it always escapes (the rv64ui/um/ua harnesses
                // read a7/a0 from the ECALL). Delegation to S-mode arrives in E1-T11.
                #[cfg(not(feature = "zicsr-stub"))]
                {
                    // "No handler installed" is judged against the tvec the trap will actually
                    // use: a medeleg-delegated exception taken below M vectors through stvec, so
                    // check THAT base — otherwise a guest with only stvec set (mtvec==0) would
                    // wrongly escape (E1-T11).
                    let to_s = self.hart.csr.delegates_to_s(trap.cause as u64, false);
                    let handler = if to_s {
                        self.hart.csr.stvec_base()
                    } else {
                        self.hart.csr.mtvec_base()
                    };
                    if handler == 0 {
                        return RunOutcome::Trapped(trap);
                    }
                    let epc = self.hart.regs.pc;
                    self.hart.take_trap(trap, epc);
                }
                #[cfg(feature = "zicsr-stub")]
                {
                    return RunOutcome::Trapped(trap);
                }
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
