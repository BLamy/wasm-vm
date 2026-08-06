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

pub mod block;
pub mod bus;
pub mod csr;
pub mod decode;
pub mod decode_c;
pub mod dev;
pub mod diag;
pub mod dispatch;
pub mod fdt;
pub mod hart;
pub mod htif;
pub mod jit;
pub mod loader;
pub mod mmio;
pub mod mmu;
pub mod platform;
pub mod pmp;
pub mod prof;
pub mod ram;
pub mod resume;
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
    /// E2-T17: the guest asked the platform to power off or reboot — via the syscon test
    /// finisher (`sifive,test0`, MMIO at `TEST_BASE`) or SBI SRST reboot. Carries the reason
    /// so the host can exit cleanly (poweroff/fail) or re-boot (reboot). NO `process::exit`
    /// happens in the core — the value is surfaced so the CLI and the wasm boundary decide.
    Reset(ExitReason),
}

/// E2-T17: why the guest reset the platform — the typed outcome of a syscon finisher write
/// (or SBI SRST reboot), propagated out of the run loop to the host.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ExitReason {
    /// Clean power off (finisher `0x5555`) — the host should exit 0.
    PowerOff,
    /// Restart (finisher `0x7777` / SBI SRST reboot) — the CLI re-boots a fresh machine.
    Reboot,
    /// Guest-signalled failure (finisher `0x3333`, code in the upper 16 bits) — exit `code`.
    Fail(u16),
}

/// E2-T21: why laying out a Linux boot triple failed. Returned by [`Machine::place_and_boot`]
/// so every host (CLI, wasm) reports the same specific cause instead of re-deriving placement.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BootError {
    /// The `--ram-mib` size produced an invalid platform map.
    PlatformInvalid,
    /// The kernel's runtime footprint (`.bss` included) does not fit above `KERNEL_BASE`.
    KernelTooBig,
    /// `kernel_end` is so large that 2 MiB-aligning the initrd above it would wrap.
    KernelEndOverflow,
    /// The initrd does not fit in the gap between the kernel and the DTB.
    InitrdNoFit,
    /// The DTB does not fit near the top of RAM.
    DtbNoFit,
    /// A blob write (initrd/DTB) hit a bus fault.
    Load(bus::BusFault),
}

/// E2-T21: where the boot triple landed in DRAM (for host-side diagnostics/logging).
#[derive(Debug, Clone, Copy)]
pub struct BootLayout {
    pub kernel_end: u64,
    pub initrd: Option<fdt::Initrd>,
    pub dtb_addr: u64,
    pub dtb_len: usize,
}

/// A full Level-0 machine: one hart on a system bus, plus optional HTIF exit
/// watching. Grown from the E0-T01 placeholder — the `new`/`ram_len` surface is
/// preserved (E0-T01's verified tests and the wasm wrapper depend on it).
/// E4-T01: the base PC-sampling stride — a prime near 1024 so ~1 retire in ~1024 is sampled. The
/// actual stride is this plus a small per-sample jitter (see `prof_next_stride`); a prime base plus
/// jitter means no power-of-two or round loop period can systematically dodge every sample.
const PROF_STRIDE_BASE: u32 = 1021;
/// E4-T01: jitter span added to [`PROF_STRIDE_BASE`] each sample (stride ∈ 1021..=1148). Only the
/// (real-CSR) sampler reads it; the quarantined zicsr-stub build compiles the sampler out.
#[cfg_attr(feature = "zicsr-stub", allow(dead_code))]
const PROF_STRIDE_JITTER: u32 = 128;

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
    /// E2-T07: the ns16550a UART + its PLIC IRQ-10 line, when [`Self::enable_uart16550`]
    /// attached it. The run loop ticks the char-timeout clock and mirrors the level.
    uart: Option<(
        alloc::rc::Rc<core::cell::RefCell<dev::uart16550::Uart16550>>,
        dev::plic::IrqLine,
    )>,
    /// E2-T16: the goldfish RTC + its PLIC IRQ-11 line, when [`Self::enable_rtc`] attached it.
    /// The run loop polls the alarm and mirrors its interrupt level into the PLIC.
    rtc: Option<(
        alloc::rc::Rc<core::cell::RefCell<dev::rtc::GoldfishRtc>>,
        dev::plic::IrqLine,
    )>,
    /// E2-T20: always-on interrupt/trap counters + the sliding-window storm detector and WFI
    /// watchdog. Plain increments; the detector runs only on the quantum boundary.
    irqstats: diag::irqstats::IrqStats,
    /// E2-T20: storm detection armed (default on). When on, the run loop checks the detector
    /// each quantum and prints a diagnosis to the log on a fire.
    storm_detect: bool,
    /// E4-T01: the always-compiled hot-PC / per-subsystem profiler ([`prof::ProfStats`]). Sampling
    /// is RUNTIME-gated by [`Self::set_profiling`] (default OFF) — the same always-on-struct +
    /// runtime-flag shape as `storm_detect`, so a normal (unprofiled) run pays only a single
    /// not-taken branch per retire.
    prof: prof::ProfStats,
    /// E4-T01: profiler armed. Off by default; the native `--profile` path and the wasm `getProfile`
    /// surface arm it.
    #[cfg_attr(feature = "zicsr-stub", allow(dead_code))]
    profiling: bool,
    /// E4-T01: retires remaining until the next PC sample. Counts down; on zero we sample and reload
    /// it with a fresh jittered stride so no fixed loop period can hide in a sampling blind spot.
    #[cfg_attr(feature = "zicsr-stub", allow(dead_code))]
    prof_countdown: u32,
    /// E4-T01: LCG state feeding the per-sample stride jitter. Deterministic (no wall clock) so a
    /// native and a wasm run sample the identical instruction stream.
    #[cfg_attr(feature = "zicsr-stub", allow(dead_code))]
    prof_lcg: u32,
    /// E4-T01 phase 3: the injected monotonic host timer (outer crates provide the impl; core stays
    /// `no_std`). Set by [`Self::set_host_timer`], which also arms profiling and hands the same `Rc`
    /// to the bus so the cold device/walk paths can time themselves. `run_traced` reads it ONCE at
    /// entry and ONCE at exit to measure the total profiled wall-span (CPU time is that total minus
    /// the cold device+walk time — the hot loop reads no clock).
    #[cfg_attr(feature = "zicsr-stub", allow(dead_code))]
    host_timer: Option<alloc::rc::Rc<dyn prof::HostTimer>>,
    /// E4-T01 phase 3: total profiled host nanoseconds measured across `run_traced` calls (the once-
    /// per-run entry→exit delta, accumulated). Fed to [`Self::prof_report`] as the span CPU-interp
    /// time is derived from by subtraction. Zero when no timer is injected.
    #[cfg_attr(feature = "zicsr-stub", allow(dead_code))]
    prof_total_ns: u64,
    /// E2-T17: the syscon test finisher's shared reset latch, when [`Self::enable_syscon`]
    /// attached it. The run loop drains it and returns [`RunOutcome::Reset`]. (Only read on
    /// the real-CSR path; the quarantined zicsr-stub build compiles the drain + `enable_syscon`
    /// out, so the field is inert there.)
    #[cfg_attr(feature = "zicsr-stub", allow(dead_code))]
    syscon: Option<dev::syscon::ResetCell>,
    /// E2-T08: the eight virtio-mmio slots + their PLIC lines (IRQ 1..=8), when
    /// [`Self::enable_virtio_slots`] attached them. The run loop mirrors each slot's
    /// InterruptStatus level.
    virtio: alloc::vec::Vec<(
        alloc::rc::Rc<core::cell::RefCell<dev::virtio::mmio::VirtioMmio>>,
        dev::plic::IrqLine,
    )>,
    /// E2-T11: virtio-blk service state (shared backend state + the persistent ring view),
    /// when [`Self::enable_virtio_blk`] plugged a backend into slot 0. Serviced at every
    /// instruction boundary the guest has kicked.
    blk: Option<(
        alloc::rc::Rc<core::cell::RefCell<dev::virtio::blk::BlkState>>,
        Option<dev::virtio::queue::Virtqueue>,
    )>,
    /// E4-T03: ADDITIONAL virtio-blk devices attached via [`Self::enable_virtio_blk_at`] (the bench
    /// harness's read-only overlay as `/dev/vdb`). Each entry is `(shared state, lazily-built ring
    /// view, virtio slot index)`; serviced at the same instruction boundary as the primary `blk` so
    /// the guest's reads complete — without which the guest hangs the moment it first reads the drive.
    /// These carry no writes/flush, so — unlike the primary `blk` — they are intentionally NOT drained
    /// by `quiesce` or serialized by the snapshot (a read-only drive has nothing to lose on restart).
    #[allow(clippy::type_complexity)]
    extra_blk: alloc::vec::Vec<(
        alloc::rc::Rc<core::cell::RefCell<dev::virtio::blk::BlkState>>,
        Option<dev::virtio::queue::Virtqueue>,
        usize,
    )>,
    /// E3-T13: virtio-net service state (shared backend state + the persistent receiveq /
    /// transmitq ring views), when [`Self::enable_virtio_net`] plugged a backend into slot 1.
    /// Serviced at every boundary the guest has kicked OR the backend has an rx frame ready.
    #[allow(clippy::type_complexity)]
    net: Option<(
        alloc::rc::Rc<core::cell::RefCell<dev::virtio::net::NetState>>,
        Option<dev::virtio::queue::Virtqueue>,
        Option<dev::virtio::queue::Virtqueue>,
    )>,
    /// virtio-rng service state (shared source state + the persistent requestq ring view), when
    /// [`Self::enable_virtio_rng`] plugged an entropy source into slot 2. Serviced at every
    /// boundary the guest has kicked. Seeds the guest CRNG so early TLS handshakes don't stall.
    #[allow(clippy::type_complexity)]
    rng: Option<(
        alloc::rc::Rc<core::cell::RefCell<dev::virtio::rng::RngState>>,
        Option<dev::virtio::queue::Virtqueue>,
    )>,
    /// E3-T12c3: the snapshot coherence binding — the base disk image this machine is running against
    /// (`base_image_hash`), the emulator build (`core_hash`), and the monotonic overlay-commit
    /// generation. `save_resume` stamps all three into the blob header; `load_resume` validates them
    /// FIRST (before any component is restored) so a snapshot is never resumed onto a diverged disk.
    /// Defaults are all-zero / generation 0 — the RAM-only determinism harness round-trips against
    /// itself; a disk-backed host sets the real base hash and advances the generation on each commit.
    coherence: SnapshotCoherence,
    /// E4-T05 Phase A: the predecoded block cache. A/B TOGGLE — `block_cache_enabled` (runtime,
    /// default OFF unless the `predecode` feature flips it) selects the cached vs the legacy
    /// decode path IN ONE BINARY, so the differential harness can prove cache-ON produces
    /// BYTE-IDENTICAL retire traces to cache-OFF. The cache memoizes decode ONLY: execution
    /// still feeds each micro-op through the SAME `execute()` and the run loop still re-syncs
    /// devices + samples interrupts PER RETIRE (interrupt batching is Phase C, untouched here).
    block_cache_enabled: bool,
    /// The physically-keyed decoded-block store (Phase A: conservatively flushed on `fence.i`
    /// and on any guest store — correct but slow; Phase B adds the page-level has-code bitmap).
    block_cache: dispatch::BlockCache,
    /// Cursor into the block currently being replayed: `(entry phys key, next op index,
    /// expected next VA)`. A branch/jump/interrupt/trap moves the PC off `next VA`, invalidating
    /// the cursor so the next step re-keys by physical PC (handling branches into mid-block).
    block_cursor: Option<(u64, usize, u64)>,
    /// E4-T08: hotness counters + translation-candidate discovery. The block cache learns to
    /// NOMINATE JIT candidates: each block entry bumps a saturating counter, and crossing the
    /// design-doc threshold enqueues a `TranslationRequest` (dedup'd, requeued after any
    /// invalidation via a generation bump). Discovery is OBSERVATION-ONLY — it never changes the
    /// executed sequence, so `predecode_diff` byte-identity is preserved — and nothing consumes
    /// the queue yet (the translator is E4-T09/T10).
    discovery: dispatch::BlockDiscovery,
    /// E4-T05 Phase C: interrupt/device-sync BATCHING. A DISTINCT toggle from
    /// `block_cache_enabled` (batching requires the cache, but the cache runs WITHOUT batching as
    /// the byte-identical Phase-A/B mode the `predecode_diff` gate proves). When on, the device
    /// fabric re-sync (`sync_clint`/UART/RTC/virtio/`sync_plic`/`sync_sbi_timer`/DMA-drain) and the
    /// `next_interrupt` sampling are moved from PER-RETIRE to the BLOCK BOUNDARY — sampled once per
    /// `DecodedBlock` (≤128 ops) instead of once per instruction. The retire-count clock
    /// (`advance_clock`), `irqstats.on_retire`, the profiler hook, and per-op trap/ecall/WFI
    /// handling stay per-retire, so `mtime` still crosses `mtimecmp` at the identical retire index;
    /// only the SAMPLING of the resulting interrupt defers ≤128 retires (architecturally legal —
    /// interrupts need only be taken in a timely manner). NOT byte-identical to legacy by design.
    interrupt_batching: bool,
    /// E4-T10: the compiled-block (T2) executor, when a native/browser JIT runtime is installed via
    /// [`Self::set_executor`]. Core stays `no_std` and holds no engine — the run loop drives this
    /// trait object: at a block boundary, if `jit_enabled` and the block is compiled, it executes
    /// via the executor INSTEAD of interpreting; a miss (uncompiled / faulted-out) falls back to the
    /// interpreter. `None` on every build until a runtime is installed.
    executor: Option<jit::BoxedExecutor>,
    /// E4-T10: the JIT on/off runtime flag. Effective only with the block cache on and an executor
    /// installed (see [`Self::jit_active`]). Off by default so every existing path is unchanged.
    jit_enabled: bool,
}

/// E3-T12c3: the identity a snapshot is bound to. A restore is refused unless the target machine's
/// build (`core_hash`), base disk image (`base_image_hash`), and overlay-commit `generation` all
/// match the blob — otherwise a resumed CPU/RAM would land on an overlay its page cache disagrees
/// with (silent corruption). The generation is monotonic: it only ever advances (as the overlay
/// commits), so a snapshot taken before a commit can never be restored after one.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct SnapshotCoherence {
    pub core_hash: [u8; 32],
    pub base_image_hash: [u8; 32],
    pub generation: u64,
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
        let mut m = Self {
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
            uart: None,
            rtc: None,
            irqstats: diag::irqstats::IrqStats::new(),
            storm_detect: true,
            prof: prof::ProfStats::new(),
            profiling: false,
            prof_countdown: PROF_STRIDE_BASE,
            prof_lcg: 0x1234_5678,
            host_timer: None,
            prof_total_ns: 0,
            syscon: None,
            virtio: alloc::vec::Vec::new(),
            blk: None,
            extra_blk: alloc::vec::Vec::new(),
            net: None,
            rng: None,
            coherence: SnapshotCoherence::default(),
            // E4-T05: default the toggle to the `predecode` feature (OFF in the normal build);
            // the differential harness flips it at runtime via `set_block_cache`.
            block_cache_enabled: cfg!(feature = "predecode"),
            block_cache: dispatch::BlockCache::with_capacity(1 << 12),
            discovery: dispatch::BlockDiscovery::new(),
            block_cursor: None,
            // E4-T05 Phase C: batching is OFF by default even under `predecode` (the cache stays
            // byte-identical); it is opted in explicitly via `set_interrupt_batching`.
            interrupt_batching: false,
            executor: None,
            jit_enabled: false,
        };
        // E4-T05 Phase B: arm the bus's physical-frame write log iff the cache is on, so guest
        // stores AND device/DMA writes feed page-granular invalidation.
        m.bus.arm_code_write_tracking(m.block_cache_enabled);
        Ok(m)
    }

    /// E4-T05: the A/B toggle — turn the predecoded block cache on/off at runtime. Flushing on
    /// every transition guarantees the two paths never share a stale block, so a differential
    /// run can flip mid-stream and still be byte-identical.
    pub fn set_block_cache(&mut self, on: bool) {
        self.block_cache_enabled = on;
        self.block_cache.flush();
        self.block_cursor = None;
        // E4-T08: a cache toggle wholesale-flushes blocks; reset the discovery state to match.
        self.discovery.reset();
        // E4-T10: a wholesale flush drops every compiled block too — they mirror the cache.
        if let Some(e) = self.executor.as_mut() {
            e.invalidate_all();
        }
        // E4-T05 Phase B: keep the bus write log armed in lockstep with the cache.
        self.bus.arm_code_write_tracking(on);
    }

    /// E4-T05: whether the predecoded block cache is currently active.
    pub fn block_cache_enabled(&self) -> bool {
        self.block_cache_enabled
    }

    /// E4-T05 Phase C: turn interrupt/device-sync BATCHING on/off. Distinct from
    /// [`Self::set_block_cache`] — batching requires the cache (it is a no-op without it), but the
    /// cache runs independently WITHOUT batching as the byte-identical mode. Flushing the cursor on
    /// a transition keeps boundary bookkeeping consistent.
    pub fn set_interrupt_batching(&mut self, on: bool) {
        self.interrupt_batching = on;
        self.block_cursor = None;
    }

    /// E4-T05 Phase C: whether interrupt/device-sync batching is active (and effective — it
    /// requires the block cache to be on).
    pub fn interrupt_batching(&self) -> bool {
        self.interrupt_batching && self.block_cache_enabled
    }

    /// E4-T05: resize the block cache (rounded up to a power of two). `capacity == 1` is the
    /// adversarial pathological-eviction mode — a 1-entry cache that must STILL be byte-identical.
    pub fn set_block_cache_capacity(&mut self, capacity: usize) {
        self.block_cache = dispatch::BlockCache::with_capacity(capacity);
        self.block_cursor = None;
        // E4-T08: a fresh cache has no blocks; reset discovery so stale counts/requests are dropped.
        self.discovery.reset();
        // E4-T10: fresh cache ⇒ every compiled block is stale; drop them all.
        if let Some(e) = self.executor.as_mut() {
            e.invalidate_all();
        }
        // Fresh cache ⇒ no cached code ⇒ any pending write frames are moot.
        self.bus.code_write_log_mut().clear();
    }

    /// E4-T08: set the hotness promotion threshold (the tunable `N`; default
    /// [`dispatch::HOT_THRESHOLD`] = 64). E4-T08 owns sweeping this against the ledger; tests use a
    /// low value to nominate with short guests. Persists across a cache toggle.
    pub fn set_hotness_threshold(&mut self, threshold: u32) {
        self.discovery.set_threshold(threshold);
    }

    /// E4-T08: a snapshot of the block-discovery counters — blocks nominated, deduped,
    /// dropped-stale, queue depth + high-water mark, and the live generation. Exposed for the
    /// profiling report and for tests; also folded into [`Self::prof_report`].
    pub fn discovery_stats(&self) -> dispatch::DiscoveryStats {
        let mut s = self.discovery.stats();
        // E4-T16: fold in the block-cache invalidation-event counters so a test can assert on
        // whole-cache flushes and page-discarded blocks without assembling a full prof report.
        let (cache_flushes, blocks_discarded) = self.block_cache.invalidation_stats();
        s.cache_flushes = cache_flushes;
        s.blocks_discarded = blocks_discarded;
        s
    }

    /// E4-T08: drain the pending translation-candidate FIFO (a trivial consumer; the real compile
    /// queue is E4-T21). Each request carries its coherence generation — validate with
    /// [`Self::discovery_install_check`] before acting on it.
    pub fn take_translation_requests(&mut self) -> alloc::vec::Vec<dispatch::TranslationRequest> {
        self.discovery.take_requests()
    }

    /// E4-T08: validate a translation request at (mock) install time against live guest memory —
    /// returns `true` only if its generation is current AND its snapshotted bytes still match. The
    /// choke point behind the "never install stale bytes" guarantee.
    pub fn discovery_install_check(
        &mut self,
        req: &dispatch::TranslationRequest,
        live_bytes: &[u8],
    ) -> bool {
        self.discovery.install_check(req, live_bytes)
    }

    /// E4-T10: install a compiled-block executor (a native/browser JIT runtime). The run loop
    /// drives it once the JIT is enabled and the block cache is on. Installing a fresh executor
    /// (or replacing one) drops any previously compiled state by construction.
    pub fn set_executor(&mut self, executor: jit::BoxedExecutor) {
        self.executor = Some(executor);
    }

    /// E4-T10: reclaim the installed executor (e.g. to read its stats after a run). Leaves the
    /// machine with no executor, so the JIT is inert until one is set again.
    pub fn take_executor(&mut self) -> Option<jit::BoxedExecutor> {
        self.executor.take()
    }

    /// E4-T10: borrow the installed executor (stats: compiled/executed/retired counts).
    pub fn executor(&self) -> Option<&dyn jit::CompiledBlockExecutor> {
        self.executor.as_deref()
    }

    /// E4-T10: the JIT on/off runtime flag. Enabling it also turns on the block cache (the JIT
    /// consumes the cache's block discovery). Disabling drops all compiled state to guarantee the
    /// interpreter and JIT paths never share a stale block.
    pub fn set_jit(&mut self, on: bool) {
        self.jit_enabled = on;
        if on {
            self.set_block_cache(true);
        } else if let Some(e) = self.executor.as_mut() {
            e.invalidate_all();
        }
    }

    /// E4-T10: is the JIT effectively active — enabled, an executor installed, and the block cache
    /// on (the discovery front end the JIT feeds off)?
    pub fn jit_active(&self) -> bool {
        self.jit_enabled && self.block_cache_enabled && self.executor.is_some()
    }

    /// E3-T12c3: bind this machine to a base disk image + emulator build for snapshot coherence.
    /// `save_resume` stamps these into the header and `load_resume` refuses a snapshot whose header
    /// disagrees — a resume onto a different image or a stale build is rejected before any mutation.
    pub fn set_snapshot_identity(&mut self, core_hash: [u8; 32], base_image_hash: [u8; 32]) {
        self.coherence.core_hash = core_hash;
        self.coherence.base_image_hash = base_image_hash;
    }

    /// E3-T12c3: the current overlay-commit generation the next `save_resume` will bind.
    pub fn overlay_generation(&self) -> u64 {
        self.coherence.generation
    }

    /// E3-T12c3: advance the monotonic overlay-commit generation. The persist pump calls this each
    /// time a durable overlay transaction commits, so a snapshot taken before the commit binds an
    /// older generation and is refused if restored afterward (no stale-overlay resume). Saturating:
    /// the counter never wraps back onto a value an outstanding snapshot could match.
    pub fn advance_overlay_generation(&mut self) -> u64 {
        self.coherence.generation = self.coherence.generation.saturating_add(1);
        self.coherence.generation
    }

    /// E3-T12c3: the full coherence binding (build + base image + generation) this machine stamps.
    pub fn snapshot_coherence(&self) -> &SnapshotCoherence {
        &self.coherence
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

    /// E2-T07: attach the ns16550a UART at [`platform::virt::UART0_BASE`], wired to PLIC
    /// IRQ 10. Requires [`Self::enable_plic`] first. The run loop ticks the UART's
    /// deterministic char-timeout clock and mirrors its level into the PLIC every
    /// instruction boundary. Returns the shared handle (host input via
    /// `borrow_mut().push_input`, output via `take_output`).
    pub fn enable_uart16550(
        &mut self,
    ) -> alloc::rc::Rc<core::cell::RefCell<dev::uart16550::Uart16550>> {
        let plic = self
            .plic
            .as_ref()
            .expect("enable_plic before enable_uart16550");
        let line = dev::plic::Plic::irq_line(plic, platform::virt::UART0_IRQ as usize);
        let cell = alloc::rc::Rc::new(core::cell::RefCell::new(dev::uart16550::Uart16550::new()));
        self.bus
            .attach(
                bus::mmap::UART0_BASE,
                bus::mmap::UART0_LEN,
                alloc::boxed::Box::new(dev::uart16550::SharedUart(alloc::rc::Rc::clone(&cell))),
            )
            .expect("UART window overlaps RAM or another device");
        self.uart = Some((alloc::rc::Rc::clone(&cell), line));
        cell
    }

    /// E2-T08: attach the eight virtio-mmio slots (spec 1.2 §4.2.2, Version=2) at
    /// [`platform::virt::VIRTIO_BASE`]`+ i*stride`, each wired to PLIC IRQ `1+i`. Slot 0
    /// gets `slot0` as its backend (E2-T11 plugs the real blk device in); slots 1..=7 are
    /// EMPTY (`DeviceID` 0 — the kernel skips them silently). Requires
    /// [`Self::enable_plic`] first. Returns the slot handles (tests/backends raise
    /// used/config interrupts and inspect queue state through them).
    pub fn enable_virtio_slots(
        &mut self,
        slot0: Option<alloc::boxed::Box<dyn dev::virtio::VirtioDevice>>,
    ) -> alloc::vec::Vec<alloc::rc::Rc<core::cell::RefCell<dev::virtio::mmio::VirtioMmio>>> {
        use dev::virtio::mmio::VirtioMmio;
        let plic = self
            .plic
            .as_ref()
            .expect("enable_plic before enable_virtio_slots");
        let mut handles = alloc::vec::Vec::new();
        let mut slot0 = slot0;
        for i in 0..platform::virt::VIRTIO_COUNT {
            let slot = match (i, slot0.take()) {
                (0, Some(d)) => VirtioMmio::new(d),
                _ => VirtioMmio::empty(),
            };
            let cell = alloc::rc::Rc::new(core::cell::RefCell::new(slot));
            let line = dev::plic::Plic::irq_line(plic, platform::Platform::virtio_irq(i) as usize);
            self.bus
                .attach(
                    platform::Platform::virtio_base(i),
                    platform::virt::VIRTIO_LEN,
                    alloc::boxed::Box::new(dev::virtio::mmio::SharedVirtioMmio(
                        alloc::rc::Rc::clone(&cell),
                    )),
                )
                .expect("virtio window overlaps RAM or another device");
            self.virtio.push((alloc::rc::Rc::clone(&cell), line));
            handles.push(cell);
        }
        handles
    }

    /// E2-T11: attach a virtio-blk device (DeviceID 2) backed by `backend` in slot 0 and
    /// the seven empty slots alongside (calls [`Self::enable_virtio_slots`] internally).
    /// Returns (slot-0 handle, shared blk state — inspect `flush_count`, swap inputs).
    #[allow(clippy::type_complexity)]
    pub fn enable_virtio_blk(
        &mut self,
        backend: alloc::boxed::Box<dyn block::BlockBackend>,
    ) -> (
        alloc::rc::Rc<core::cell::RefCell<dev::virtio::mmio::VirtioMmio>>,
        alloc::rc::Rc<core::cell::RefCell<dev::virtio::blk::BlkState>>,
    ) {
        let (devhalf, state) = dev::virtio::blk::new(backend);
        let slots = self.enable_virtio_slots(Some(alloc::boxed::Box::new(devhalf)));
        self.blk = Some((alloc::rc::Rc::clone(&state), None));
        (alloc::rc::Rc::clone(&slots[0]), state)
    }

    /// E4-T03: attach an ADDITIONAL virtio-blk device (DeviceID 2) backed by `backend` into an
    /// already-existing EMPTY slot (`enable_virtio_blk`/`enable_virtio_slots` first). The benchmark
    /// harness attaches its read-only overlay as a second drive (slot 1) so the guest sees `/dev/vdb`
    /// alongside the root `/dev/vda`, without disturbing the single-drive path. Returns the shared
    /// blk state. Panics if `slot` is out of range or already occupied (a wiring bug).
    pub fn enable_virtio_blk_at(
        &mut self,
        slot: usize,
        backend: alloc::boxed::Box<dyn block::BlockBackend>,
    ) -> alloc::rc::Rc<core::cell::RefCell<dev::virtio::blk::BlkState>> {
        assert!(
            slot < self.virtio.len(),
            "enable_virtio_slots/enable_virtio_blk before enable_virtio_blk_at"
        );
        let (devhalf, state) = dev::virtio::blk::new(backend);
        assert!(
            self.virtio[slot]
                .0
                .borrow_mut()
                .install_device(alloc::boxed::Box::new(devhalf))
                .is_ok(),
            "virtio slot {slot} already has a device"
        );
        // Register it for run-loop servicing (the ring view builds lazily on the guest's first kick,
        // like the primary blk). Omitting this is exactly the hang: the device probes but its reads
        // never complete.
        self.extra_blk
            .push((alloc::rc::Rc::clone(&state), None, slot));
        state
    }

    /// E3-T13: attach a virtio-net device (DeviceID 1) backed by `backend` in slot 1. The
    /// eight slots must already exist ([`Self::enable_virtio_blk`] or
    /// [`Self::enable_virtio_slots`] first) — net installs into the empty slot 1 (the DTB
    /// already advertises all eight windows, so the kernel probes it with no DTB change).
    /// Returns (slot-1 handle, shared net state — inspect `rx_dropped`/`tx_count`, drive the
    /// backend).
    #[allow(clippy::type_complexity)]
    pub fn enable_virtio_net(
        &mut self,
        backend: alloc::boxed::Box<dyn dev::virtio::net::NetBackend>,
    ) -> (
        alloc::rc::Rc<core::cell::RefCell<dev::virtio::mmio::VirtioMmio>>,
        alloc::rc::Rc<core::cell::RefCell<dev::virtio::net::NetState>>,
    ) {
        assert!(
            self.virtio.len() > 1,
            "enable_virtio_slots/enable_virtio_blk before enable_virtio_net"
        );
        let (devhalf, state) = dev::virtio::net::new(backend);
        assert!(
            self.virtio[1]
                .0
                .borrow_mut()
                .install_device(alloc::boxed::Box::new(devhalf))
                .is_ok(),
            "virtio slot 1 already has a device"
        );
        self.net = Some((alloc::rc::Rc::clone(&state), None, None));
        (alloc::rc::Rc::clone(&self.virtio[1].0), state)
    }

    /// Attach a virtio-rng device (DeviceID 4) backed by `source` in slot 2. The eight slots must
    /// already exist ([`Self::enable_virtio_slots`]/`enable_virtio_blk` first) — rng installs into
    /// the empty slot 2 (the DTB already advertises all eight windows, so the kernel's
    /// `virtio-rng`/`rng-core` probe binds it with no DTB change). The kernel feeds the delivered
    /// bytes into its CRNG, so guest `getrandom(2)`/`/dev/urandom` seed promptly and early TLS
    /// handshakes stop stalling on entropy. Returns (slot-2 handle, shared rng state).
    #[allow(clippy::type_complexity)]
    pub fn enable_virtio_rng(
        &mut self,
        source: alloc::boxed::Box<dyn dev::virtio::rng::EntropySource>,
    ) -> (
        alloc::rc::Rc<core::cell::RefCell<dev::virtio::mmio::VirtioMmio>>,
        alloc::rc::Rc<core::cell::RefCell<dev::virtio::rng::RngState>>,
    ) {
        assert!(
            self.virtio.len() > 2,
            "enable_virtio_slots/enable_virtio_blk before enable_virtio_rng"
        );
        let (devhalf, state) = dev::virtio::rng::new(source);
        assert!(
            self.virtio[2]
                .0
                .borrow_mut()
                .install_device(alloc::boxed::Box::new(devhalf))
                .is_ok(),
            "virtio slot 2 already has a device"
        );
        self.rng = Some((alloc::rc::Rc::clone(&state), None));
        (alloc::rc::Rc::clone(&self.virtio[2].0), state)
    }

    /// E2-T16: attach the goldfish RTC at [`platform::virt::RTC_BASE`], wired to PLIC IRQ 11,
    /// with `clock` as its wall-clock source (`SystemTime` in the CLI, `Date.now()` in wasm, a
    /// mock in tests). Matches the `google,goldfish-rtc` node the DTB advertises — without it
    /// the kernel's `rtc-goldfish` probe takes a load access fault on the unbacked window. The
    /// guest reads real time (`clock.now_ns()` + any `date -s` offset) and can arm alarms; the
    /// run loop polls the alarm each boundary and mirrors its level into the PLIC. Requires
    /// [`Self::enable_plic`] first. Returns the shared handle (tests drive it directly).
    pub fn enable_rtc(
        &mut self,
        clock: alloc::boxed::Box<dyn dev::rtc::WallClock>,
    ) -> alloc::rc::Rc<core::cell::RefCell<dev::rtc::GoldfishRtc>> {
        let plic = self.plic.as_ref().expect("enable_plic before enable_rtc");
        let line = dev::plic::Plic::irq_line(plic, platform::virt::RTC_IRQ as usize);
        let cell = alloc::rc::Rc::new(core::cell::RefCell::new(dev::rtc::GoldfishRtc::new(clock)));
        self.bus
            .attach(
                platform::virt::RTC_BASE,
                platform::virt::RTC_LEN,
                alloc::boxed::Box::new(dev::rtc::SharedRtc(alloc::rc::Rc::clone(&cell))),
            )
            .expect("RTC window overlaps RAM or another device");
        self.rtc = Some((alloc::rc::Rc::clone(&cell), line));
        cell
    }

    /// E2-T20: the interrupt/trap counters + storm/WFI diagnostics ([`diag::irqstats::IrqStats`]).
    /// Read after a run for `--stats`, or exposed through the wasm boundary.
    pub fn irq_stats(&self) -> &diag::irqstats::IrqStats {
        &self.irqstats
    }

    /// E2-T20: turn the always-on storm/WFI detectors on or off (default on). Off makes the
    /// per-trap `storm_check` a single early-return branch.
    pub fn set_storm_detect(&mut self, on: bool) {
        self.storm_detect = on;
    }

    /// E4-T01: arm/disarm the hot-PC + subsystem profiler (default off). Arming resets the sampling
    /// countdown so the first sample lands a full stride into the profiled span. When off, the run
    /// loop's sampling is a single not-taken branch per retire.
    pub fn set_profiling(&mut self, on: bool) {
        self.profiling = on;
        if on {
            self.prof_countdown = PROF_STRIDE_BASE;
        }
    }

    /// E4-T01 phase 3: inject the monotonic host timer AND arm profiling. The same `Rc` is handed to
    /// the bus so the cold device-dispatch and page-walk paths can bracket themselves; `run_traced`
    /// reads it once per run at entry/exit for the total wall-span. Outer crates provide the impl
    /// (native `Instant`, wasm `performance.now()`); tests use [`prof::FixedTimer`].
    pub fn set_host_timer(&mut self, timer: alloc::rc::Rc<dyn prof::HostTimer>) {
        self.host_timer = Some(alloc::rc::Rc::clone(&timer));
        self.bus.set_host_timer(timer);
        self.set_profiling(true);
    }

    /// E4-T01 phase 3: total profiled host nanoseconds measured by `run_traced` (entry→exit,
    /// accumulated across runs). Feed this to [`Self::prof_report`] as `total_ns` for the
    /// CPU-by-subtraction accounting. Zero when no [`Self::set_host_timer`] was injected.
    pub fn prof_total_ns(&self) -> u64 {
        self.prof_total_ns
    }

    /// E4-T01: the accumulated profile as a ranked [`prof::ProfReport`]. `total_ns` is the profiled
    /// wall span (pass [`Self::prof_total_ns`] for the timer-measured span, or 0 when only the
    /// hot-PC histogram is wanted). CPU-interp time is derived as `total_ns −` the cold device+walk
    /// time folded in from the bus; `top_k` bounds the hot-region list. Non-mutating and idempotent.
    pub fn prof_report(&self, total_ns: u64, top_k: usize) -> prof::ProfReport {
        let ta = self.bus.time_accum();
        let mut report = self
            .prof
            .report_with_time(total_ns, top_k, &ta.ns, ta.walk_count);
        // E4-T08: surface the block-discovery counters through the profiling report.
        report.discovery = self.discovery.stats();
        // E4-T16: fold in the block-cache invalidation-event counters (whole-cache flushes +
        // blocks discarded by page-granular SMC/DMA invalidation). `blocks_discarded` staying flat
        // across an SFENCE.VMA storm is the "phys-keying means SFENCE.VMA does not kill blocks" proof.
        let (cache_flushes, blocks_discarded) = self.block_cache.invalidation_stats();
        report.discovery.cache_flushes = cache_flushes;
        report.discovery.blocks_discarded = blocks_discarded;
        report
    }

    /// E4-T01: the next PC-sampling stride — [`PROF_STRIDE_BASE`] plus a deterministic LCG jitter in
    /// `0..PROF_STRIDE_JITTER`. The jitter is what stops a loop whose length divides the base stride
    /// from being sampled always-at-the-same-instruction (or never); the LCG carries no wall clock so
    /// native and wasm sample identically.
    #[cfg(not(feature = "zicsr-stub"))]
    #[inline]
    fn prof_next_stride(&mut self) -> u32 {
        self.prof_lcg = self.prof_lcg.wrapping_mul(1664525).wrapping_add(1013904223);
        PROF_STRIDE_BASE + (self.prof_lcg >> 24) % PROF_STRIDE_JITTER
    }

    /// E2-T20 `--stats`: the counter dump, with the latest PLIC claim counts synced in first
    /// (they otherwise only refresh when the storm detector runs).
    pub fn stats_dump(&mut self) -> alloc::string::String {
        if let Some(plic) = &self.plic {
            self.irqstats.claims = *plic.borrow().claim_counts();
        }
        self.irqstats.dump()
    }

    /// E2-T19 `--blk-log`: start recording virtio-blk requests (a no-op if no blk device is
    /// attached). The host drains them with [`Self::drain_blk_log`].
    pub fn enable_blk_log(&mut self) {
        if let Some((state, _)) = &self.blk {
            state.borrow_mut().enable_log();
        }
    }

    /// E2-T19: take the virtio-blk request log recorded since the last drain (empty if
    /// logging is off or no blk device is attached).
    pub fn drain_blk_log(&mut self) -> alloc::vec::Vec<dev::virtio::blk::BlkReq> {
        self.blk
            .as_ref()
            .map(|(s, _)| s.borrow_mut().take_log())
            .unwrap_or_default()
    }

    /// E3-T02: the chunks that parked virtio-blk reads are waiting on — what a lazy-fetch layer must
    /// load next. Empty unless a `WouldBlock`-returning backend has parked reads. After the layer
    /// populates these chunks, the next run-loop boundary re-services the parked reads and completes them.
    /// E3-T08: whether a guest FLUSH is parked awaiting the durable commit barrier — the
    /// persist pump should drain IMMEDIATELY (the guest's `sync` is blocked on it).
    pub fn blk_flush_waiting(&self) -> bool {
        self.blk
            .as_ref()
            .is_some_and(|(s, _)| s.borrow().flush_waiting())
    }

    /// E3-T10: whether a persistent virtio-blk WRITE is parked before used-ring acknowledgement,
    /// awaiting the host durable transaction. The wasm driver must prioritize `persistPending`
    /// while this is true; quota failure then resolves the same request with IOERR.
    pub fn blk_write_waiting(&self) -> bool {
        self.blk
            .as_ref()
            .is_some_and(|(s, _)| s.borrow().write_waiting())
    }

    pub fn pending_blk_chunks(&self) -> alloc::vec::Vec<usize> {
        self.blk
            .as_ref()
            .map(|(s, _)| s.borrow().pending_chunks())
            .unwrap_or_default()
    }

    /// E2-T17: attach the syscon test finisher (`sifive,test0`) at
    /// [`platform::virt::TEST_BASE`], matching the DTB's `test@…` node + its
    /// `syscon-poweroff`/`syscon-reboot` children. A recognized write (`0x5555` poweroff,
    /// `0x7777` reboot, `0x3333|code<<16` fail) ends the run with [`RunOutcome::Reset`]. No
    /// PLIC line — the finisher carries no interrupt.
    ///
    /// Gated `not(zicsr-stub)` to match the run loop's reset drain (critic A1): under the
    /// quarantined stub the drain is compiled out, so attaching the device would latch a reset
    /// that never ends the run — a silent hang. Making this a compile error there removes the
    /// footgun entirely.
    #[cfg(not(feature = "zicsr-stub"))]
    pub fn enable_syscon(&mut self) {
        let (device, cell) = dev::syscon::SysconFinisher::new();
        self.bus
            .attach(
                platform::virt::TEST_BASE,
                platform::virt::TEST_LEN,
                alloc::boxed::Box::new(device),
            )
            .expect("syscon window overlaps RAM or another device");
        self.syscon = Some(cell);
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
    /// - `mideleg = 0x222` (SSI/STI/SEI to S), `medeleg = 0xB1FF` (OpenSBI's full set: causes
    ///   0..=8 incl. illegal-instruction and load/store access faults, + I/L/S page faults to
    ///   S — wide by necessity, since with no guest M-mode firmware `mtvec` stays 0 and any
    ///   non-delegated trap would abort the whole machine instead of reaching the kernel);
    /// - `satp = 0` (Bare; the kernel builds its own tables), `sstatus.SIE = 0`
    ///   (interrupts masked until the kernel opts in) — both reset defaults, restated here
    ///   as part of the contract;
    /// - PMP entry 0 opened R/W/X over all of memory (S-mode needs an explicit grant).
    #[cfg(not(feature = "zicsr-stub"))]
    pub fn boot_supervisor(&mut self, hartid: u64, dtb_addr: u64) {
        use crate::csr::{CsrOp, MCOUNTEREN, MEDELEG, MIDELEG, Priv};
        self.hart.csr.pmp.allow_all();
        // Legalized writes from M (the mode we're in pre-handoff).
        self.hart.csr.mode = Priv::M;
        self.hart
            .csr
            .access(MIDELEG, CsrOp::Write, 0x222, false, false, 0)
            .expect("mideleg write from M cannot fail");
        // medeleg = 0xB1FF — OpenSBI's full delegation set: causes 0..=8 (misaligned-fetch,
        // fetch-access, ILLEGAL-INSTRUCTION, breakpoint, misaligned/access load & store,
        // ecall-from-U) plus the three page-faults (12/13/15). This MUST be the wide set, not
        // a minimal one: there is no guest M-mode firmware here (SBI is Rust) and Linux runs
        // in S-mode, so it only ever programs `stvec` — `mtvec` stays 0 forever. Any cause we
        // DON'T delegate therefore traps to M-mode, finds no handler (mtvec==0), and aborts
        // the whole machine (RunOutcome::Trapped) instead of reaching the kernel. With the
        // wide set, a userspace illegal instruction becomes SIGILL and a bad access becomes
        // SIGSEGV/SIGBUS in just that process — exactly as on real hardware + OpenSBI.
        self.hart
            .csr
            .access(MEDELEG, CsrOp::Write, 0xB1FF, false, false, 0)
            .expect("medeleg write from M cannot fail");
        // E2-T05: grant S-mode the CY/TM/IR counters (mcounteren = 0x7) — the kernel's
        // sched_clock reads `time` via rdtime, which traps without this (OpenSBI grants the
        // same). E1-T30: scounteren is granted too (just below) so U-mode rdtime works.
        self.hart
            .csr
            .access(MCOUNTEREN, CsrOp::Write, 0x7, false, false, 0)
            .expect("mcounteren write from M cannot fail");
        // E1-T30: also grant U-mode CY/TM/IR via scounteren (=0x7) so userspace `rdtime` works.
        // Stock glibc riscv64 binaries (e.g. Docker Hub busybox:latest) execute a raw userspace
        // `rdtime` (CSR `time`=0xC01) — captured SIGILL: epc in libc, insn=0xc01027f3. Our gate is
        // spec-correct (U-mode counter reads need mcounteren.TM AND scounteren.TM, §3.1.10/§4.1.5),
        // but this kernel leaves scounteren=0 and neither emulates the read nor uses only the vDSO,
        // so the read traps IllegalInstruction → the kernel delivers SIGILL and glibc dies. Granting
        // scounteren at reset mirrors firmware/platforms that expose userspace counters (the same
        // rationale as mcounteren above); the kernel remains free to restrict it by writing the CSR.
        // Verified: with this, busybox:latest glibc runs to a normal exit (was SIGILL); musl (Alpine)
        // is unaffected (it never executes userspace rdtime). See E1-T30 verification log.
        self.hart
            .csr
            .access(crate::csr::SCOUNTEREN, CsrOp::Write, 0x7, false, false, 0)
            .expect("scounteren write from M cannot fail");
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

    /// E2-T15: load a flat kernel `Image` (the Linux/RISC-V boot format — a raw binary, NOT
    /// an ELF) at [`platform::virt::KERNEL_BASE`] and return `kernel_end` — one past the last
    /// byte the RUNNING kernel occupies, which is what the initrd/DTB must be placed above.
    ///
    /// Crucially this is NOT `KERNEL_BASE + file_len`: the Image file omits `.bss`/init, but
    /// the kernel reserves that memory at runtime. The RISC-V Image header (arch/riscv/kernel/
    /// head.S) carries `image_size` at byte offset 16 (LE u64), the total memory footprint;
    /// when the `RISCV\0\0\0`→`RSC\x05` magic at offset 0x38 is present and `image_size`
    /// exceeds the file, we honour it. Placing the initrd at `KERNEL_BASE + file_len` instead
    /// lands it inside `.bss` → the kernel logs "overlaps in-use memory region — disabling
    /// initrd" and boots without a rootfs. Fails `Access` if the image — or its full runtime
    /// footprint (`.bss` and all) — does not fit above `KERNEL_BASE` in RAM.
    pub fn load_kernel_image(&mut self, bytes: &[u8]) -> Result<u64, bus::BusFault> {
        let footprint = kernel_image_footprint(bytes);
        // Sweep-critic (E2-T15, MEDIUM): a hostile `image_size` near u64::MAX wrapped this add
        // in release mode — kernel_end landed BELOW KERNEL_BASE, passed the RAM-ceiling check,
        // and the initrd was silently placed on top of the kernel. checked_add → typed refusal.
        let kernel_end = platform::virt::KERNEL_BASE
            .checked_add(footprint)
            .ok_or(bus::BusFault::Access)?;
        // The RUNTIME footprint (not just the file) must fit: the no-initrd boot path has no
        // later placement check to catch a `.bss` that overflows top-of-RAM, so guard here so
        // the doc's "fails Access if it doesn't fit" is actually true.
        let ram_top = self.bus.ram().base() + self.bus.ram().len() as u64;
        if kernel_end > ram_top {
            return Err(bus::BusFault::Access);
        }
        self.bus
            .ram_mut()
            .write_slice(platform::virt::KERNEL_BASE, bytes)?;
        Ok(kernel_end)
    }

    /// E2-T15: place a blob (initrd, DTB) at an absolute guest-physical address in RAM.
    /// A thin wrapper over the RAM loader escape hatch used by the boot assembler.
    pub fn load_blob(&mut self, addr: u64, bytes: &[u8]) -> Result<(), bus::BusFault> {
        self.bus.ram_mut().write_slice(addr, bytes)
    }

    /// E2-T21: lay out the Linux boot triple in DRAM and enter it — the SHARED assembly both
    /// the native CLI and the wasm boundary call, so the (subtle, drift-prone) placement lives
    /// in exactly one place. Loads the kernel `Image` at `KERNEL_BASE`, places the initrd on
    /// the 2 MiB PMD boundary above the kernel's runtime footprint (clearing the memblock
    /// reservation — see [`Self::load_kernel_image`]), builds + places the DTB near the top of
    /// RAM (probing its length with a placeholder initrd so its address is stable), writes both
    /// blobs, and calls [`Self::boot_supervisor`] with `a1 = dtb_addr`. Device wiring
    /// (clint/plic/uart/rtc/virtio/syscon/SBI) is the CALLER's job — do it before this. Returns
    /// the [`BootLayout`] for logging.
    #[cfg(not(feature = "zicsr-stub"))]
    pub fn place_and_boot(
        &mut self,
        kernel: &[u8],
        initrd: Option<&[u8]>,
        bootargs: &str,
    ) -> Result<BootLayout, BootError> {
        let plat = platform::Platform::try_new(self.ram_len() as u64)
            .map_err(|_| BootError::PlatformInvalid)?;
        let kernel_end = self
            .load_kernel_image(kernel)
            .map_err(|_| BootError::KernelTooBig)?;
        const PMD_SIZE: u64 = 2 * 1024 * 1024;
        let initrd_floor = kernel_end
            .checked_add(PMD_SIZE - 1)
            .map(|v| v & !(PMD_SIZE - 1))
            .ok_or(BootError::KernelEndOverflow)?;

        let (dtb, dtb_addr, placed) = match initrd {
            Some(bytes) => {
                // Probe the DTB length with placeholder initrd props (same props → identical
                // length), place the DTB, then the initrd below it, then rebuild with real vals.
                let probe =
                    fdt::build_virt_dtb(&plat, bootargs, Some(fdt::Initrd { start: 0, end: 0 }));
                let dtb_addr =
                    fdt::dtb_placement(&plat, probe.len() as u64).ok_or(BootError::DtbNoFit)?;
                let place = fdt::initrd_placement(initrd_floor, dtb_addr, bytes.len() as u64)
                    .ok_or(BootError::InitrdNoFit)?;
                let dtb = fdt::build_virt_dtb(&plat, bootargs, Some(place));
                debug_assert_eq!(
                    dtb.len(),
                    probe.len(),
                    "DTB length changed with real initrd"
                );
                (dtb, dtb_addr, Some(place))
            }
            None => {
                let dtb = fdt::build_virt_dtb(&plat, bootargs, None);
                let dtb_addr =
                    fdt::dtb_placement(&plat, dtb.len() as u64).ok_or(BootError::DtbNoFit)?;
                (dtb, dtb_addr, None)
            }
        };

        if let (Some(place), Some(bytes)) = (placed, initrd) {
            self.load_blob(place.start, bytes)
                .map_err(BootError::Load)?;
        }
        self.load_blob(dtb_addr, &dtb).map_err(BootError::Load)?;
        self.boot_supervisor(0, dtb_addr);
        Ok(BootLayout {
            kernel_end,
            initrd: placed,
            dtb_addr,
            dtb_len: dtb.len(),
        })
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

    /// E3-T12c2: the maximum number of service passes [`Self::quiesce`] spends draining the virtio-blk
    /// in-flight set before it refuses the snapshot. A hard upper bound so a chain parked on a
    /// never-arriving event yields a *bounded* refusal, never an unbounded wait. Each pass re-executes
    /// every parked chain once; a resolvable event (a resident chunk, a now-durable flush/write) drains
    /// on the pass after it resolves, so a few passes suffice for genuinely drainable state.
    pub const QUIESCE_MAX_PASSES: u32 = 16;

    /// E3-T12c2: drive the virtio-blk in-flight (parked) set to empty within a bounded number of
    /// service passes, or refuse with the residual reason. Guarantees a coherent snapshot boundary:
    /// on `Ok(())` no descriptor chain is half-processed (nothing parked); on
    /// [`crate::resume::SnapshotError::NotQuiesced`] the caller must NOT serialize — the state is torn
    /// and a snapshot would double-complete or lose the parked request on restore.
    ///
    /// Each pass re-services the device (which re-executes parked chains; a chain whose event has
    /// resolved completes and drops out, one still waiting is re-parked). The loop terminates as soon
    /// as the set is empty, or after [`Self::QUIESCE_MAX_PASSES`] — never waits unboundedly on an event
    /// that will not arrive (a base-chunk fetch with no fetch layer, a durability barrier that never
    /// clears). No blk device ⇒ trivially quiesced.
    pub fn quiesce(&mut self) -> Result<(), crate::resume::SnapshotError> {
        // No block device (or the ring was never brought up) means there is nothing to drain.
        if self.blk.is_none() {
            return Ok(());
        }
        for _ in 0..Self::QUIESCE_MAX_PASSES {
            // Already empty — quiesced. Checked BEFORE servicing so an already-coherent machine is
            // never mutated (no spurious used-ring push or IRQ) by the quiesce itself.
            if self
                .blk
                .as_ref()
                .is_some_and(|(state, _)| state.borrow().residual().is_none())
            {
                return Ok(());
            }
            // One drain pass. `service` proceeds even without a fresh kick when the parked set is
            // non-empty (E3-T02), re-executing each parked chain; a resolved event completes it.
            if let Some((state, vq)) = &mut self.blk {
                let slot = alloc::rc::Rc::clone(&self.virtio[0].0);
                dev::virtio::blk::service(&slot, vq, state, &mut self.bus);
            }
        }
        // Budget exhausted with chains still parked → typed refusal carrying the residual.
        match self
            .blk
            .as_ref()
            .and_then(|(state, _)| state.borrow().residual())
        {
            Some((reason, in_flight)) => {
                Err(crate::resume::SnapshotError::NotQuiesced { reason, in_flight })
            }
            None => Ok(()),
        }
    }

    /// E3-T12b: serialize the machine's resumable state (CPU + RAM + CLINT when present) into one
    /// versioned resume blob.
    ///
    /// E3-T12c3: the header binds this machine's coherence identity — `core_hash` (build),
    /// `base_image_hash` (base disk), and the current overlay-commit `generation` — so
    /// [`Self::load_resume`] can refuse a stale or foreign restore. The RAM-only determinism harness
    /// leaves the defaults (all-zero / generation 0) and round-trips against an identically-bound
    /// machine; a disk-backed host calls [`Self::set_snapshot_identity`] and advances the generation.
    ///
    /// E3-T12c2: quiesces the virtio-blk in-flight set FIRST and refuses (typed
    /// [`crate::resume::SnapshotError::NotQuiesced`], no blob emitted) rather than serialize a torn
    /// boundary — a parked descriptor chain must never be captured half-processed.
    pub fn save_resume(&mut self) -> Result<alloc::vec::Vec<u8>, crate::resume::SnapshotError> {
        self.quiesce()?;
        use crate::resume::{ComponentSnapshot, SnapshotWriter, section};
        let mut w = SnapshotWriter::new(
            &self.coherence.core_hash,
            &self.coherence.base_image_hash,
            self.coherence.generation,
        );
        w.section(section::CPU, &self.hart.to_snapshot());
        w.section(section::RAM, &self.bus.ram().to_snapshot());
        if let Some(clint) = &self.clint {
            w.section(section::CLINT, &clint.borrow().to_snapshot());
        }
        // E3-T12c4: the interrupt controller + console + RTC device state. Without these a resumed
        // guest lands with a live driver (its register writes are in the restored RAM) but a
        // freshly-reset device — the UART's RX-interrupt-enable is lost and the console wedges, the
        // PLIC's enables/priorities are gone and external IRQs never route. Restoring them makes the
        // resumed machine's devices agree with the guest's driver state.
        if let Some(plic) = &self.plic {
            w.section(section::PLIC, &plic.borrow().to_snapshot());
        }
        if let Some((uart, _)) = &self.uart {
            w.section(section::UART, &uart.borrow().to_snapshot());
        }
        if let Some((rtc, _)) = &self.rtc {
            w.section(section::RTC, &rtc.borrow().to_snapshot());
        }
        // E3-T12c1: virtio-blk transport lifecycle + device ring position + FLUSH-forward count. The
        // disk bytes are the overlay (bound by generation, E3-T12c3), not serialized here; the parked
        // in-flight set is drained/refused by the quiesce (E3-T12c2) so it is empty at this boundary.
        if let (Some((state, vq)), Some((slot, _))) = (&self.blk, self.virtio.first()) {
            let mut v = alloc::vec::Vec::new();
            slot.borrow().snapshot_transport(&mut v);
            match vq {
                Some(q) => {
                    v.push(1);
                    let (la, ui) = q.ring_indices();
                    v.extend_from_slice(&la.to_le_bytes());
                    v.extend_from_slice(&ui.to_le_bytes());
                }
                None => {
                    v.push(0);
                    v.extend_from_slice(&[0u8; 4]);
                }
            }
            v.extend_from_slice(&state.borrow().flush_count.to_le_bytes());
            w.section(section::VIRTIO_BLK, &v);
        }
        // E3-T12c1: virtio-net transport + BOTH ring positions (receiveq/transmitq) + counters. The
        // backend's live connections cannot resume (peers/TCP state are gone — the guest sees drops,
        // E3-T25); but the transport + ring state must match the guest's driver so it isn't wedged.
        if let (Some((state, rx_vq, tx_vq)), Some((slot, _))) = (&self.net, self.virtio.get(1)) {
            let mut v = alloc::vec::Vec::new();
            slot.borrow().snapshot_transport(&mut v);
            for q in [rx_vq, tx_vq] {
                match q {
                    Some(vq) => {
                        v.push(1);
                        let (la, ui) = vq.ring_indices();
                        v.extend_from_slice(&la.to_le_bytes());
                        v.extend_from_slice(&ui.to_le_bytes());
                    }
                    None => {
                        v.push(0);
                        v.extend_from_slice(&[0u8; 4]);
                    }
                }
            }
            let st = state.borrow();
            v.extend_from_slice(&st.rx_dropped.to_le_bytes());
            v.extend_from_slice(&st.tx_count.to_le_bytes());
            v.extend_from_slice(&st.rx_count.to_le_bytes());
            w.section(section::VIRTIO_NET, &v);
        }
        // Deterministic-clock phase (E3-T12b): the sub-`clock_div` remainder + `clock_div` itself, so
        // the next `mtime` tick lands at the identical retirement after resume (instruction-exact
        // timer placement). Machine-level state, so it has its own section.
        let mut clock = alloc::vec::Vec::with_capacity(24);
        clock.extend_from_slice(&self.tick_accum.to_le_bytes());
        clock.extend_from_slice(&self.clock_div.to_le_bytes());
        // The built-in-SBI S-timer deadline (`stimecmp`) drives mip.STIP = (mtime >= stimecmp) each
        // boundary; without it a timer-armed guest resumes with the S-timer cancelled and the
        // interrupt lands at a different instruction (E3-T12b timer-placement).
        clock.extend_from_slice(&self.sbi_state.stimecmp.to_le_bytes());
        w.section(section::CLOCK, &clock);
        Ok(w.finish())
    }

    /// E3-T12b: restore the machine from a [`Self::save_resume`] blob — CPU, RAM, and CLINT. Each
    /// component's `restore` is all-or-nothing (a malformed section is a typed error that leaves that
    /// component untouched); an unknown/unsupported/garbage section is refused, never skipped.
    ///
    /// E3-T12c3: the coherence guard runs FIRST — the header's `core_hash` / `base_image_hash` /
    /// `overlay_generation` are validated against this machine's binding BEFORE any component is
    /// restored. A changed base image or a bumped overlay generation is a typed refusal
    /// ([`crate::resume::SnapshotError::BaseImageMismatch`] /
    /// [`crate::resume::SnapshotError::OverlayGenerationMismatch`]) with the target machine left
    /// byte-identical to its pre-restore state — a resumed CPU/RAM never lands on a diverged disk.
    pub fn load_resume(&mut self, blob: &[u8]) -> Result<(), crate::resume::SnapshotError> {
        use crate::resume::{ComponentSnapshot, SectionReader, section};
        let (hdr, reader) = SectionReader::new(blob)?;
        // Coherence guard BEFORE any mutation: refuse a foreign/stale snapshot up front so a failed
        // restore never half-applies a component onto a diverged disk (all-or-nothing at the machine
        // level). The iterator below has not touched machine state yet.
        hdr.validate_for(
            &self.coherence.core_hash,
            &self.coherence.base_image_hash,
            self.coherence.generation,
        )?;
        for sec in reader {
            let sec = sec?;
            match sec.tag {
                section::CPU => self.hart.restore(sec.payload)?,
                section::RAM => self.bus.ram_mut().restore(sec.payload)?,
                section::CLINT => {
                    if let Some(clint) = &self.clint {
                        clint.borrow_mut().restore(sec.payload)?;
                    }
                }
                // E3-T12c4: interrupt controller / console / RTC device state — restore so the
                // resumed devices match the guest driver (RX IRQ enable, PLIC enables, RTC alarm).
                section::PLIC => {
                    if let Some(plic) = &self.plic {
                        plic.borrow_mut().restore(sec.payload)?;
                    }
                }
                section::UART => {
                    if let Some((uart, _)) = &self.uart {
                        uart.borrow_mut().restore(sec.payload)?;
                    }
                }
                section::RTC => {
                    if let Some((rtc, _)) = &self.rtc {
                        rtc.borrow_mut().restore(sec.payload)?;
                    }
                }
                section::CLOCK => {
                    let mut r = crate::resume::Reader::new(sec.payload, section::CLOCK);
                    let tick_accum = r.u64()?;
                    let clock_div = r.u64()?;
                    let stimecmp = r.u64()?;
                    r.finish()?;
                    self.tick_accum = tick_accum;
                    self.clock_div = clock_div;
                    self.sbi_state.stimecmp = stimecmp;
                }
                section::VIRTIO_BLK => {
                    let slot = self
                        .virtio
                        .first()
                        .map(|(s, _)| alloc::rc::Rc::clone(s))
                        .ok_or(crate::resume::SnapshotError::BadComponentState {
                            tag: section::VIRTIO_BLK,
                        })?;
                    let mut r = crate::resume::Reader::new(sec.payload, section::VIRTIO_BLK);
                    slot.borrow_mut().restore_transport(&mut r)?;
                    let has_vq = r.bool()?;
                    let la = r.u16()?;
                    let ui = r.u16()?;
                    let flush = r.u64()?;
                    r.finish()?;
                    // Rebuild the ring view from the restored transport config, then set the ring
                    // position; only if the driver had a ready queue and a live view at save time.
                    let qs = *slot.borrow().queue(0);
                    if let Some((state, vq)) = &mut self.blk {
                        *vq = if has_vq && qs.ready {
                            dev::virtio::queue::Virtqueue::new(&qs, 256)
                                .ok()
                                .map(|mut q| {
                                    q.set_ring_indices(la, ui);
                                    q
                                })
                        } else {
                            None
                        };
                        state.borrow_mut().flush_count = flush;
                    }
                }
                section::VIRTIO_NET => {
                    let slot = self
                        .virtio
                        .get(1)
                        .map(|(s, _)| alloc::rc::Rc::clone(s))
                        .ok_or(crate::resume::SnapshotError::BadComponentState {
                            tag: section::VIRTIO_NET,
                        })?;
                    let mut r = crate::resume::Reader::new(sec.payload, section::VIRTIO_NET);
                    slot.borrow_mut().restore_transport(&mut r)?;
                    let rx_has = r.bool()?;
                    let rx_la = r.u16()?;
                    let rx_ui = r.u16()?;
                    let tx_has = r.bool()?;
                    let tx_la = r.u16()?;
                    let tx_ui = r.u16()?;
                    let rx_dropped = r.u64()?;
                    let tx_count = r.u64()?;
                    let rx_count = r.u64()?;
                    r.finish()?;
                    let qs0 = *slot.borrow().queue(0);
                    let qs1 = *slot.borrow().queue(1);
                    if let Some((state, rx_vq, tx_vq)) = &mut self.net {
                        *rx_vq = if rx_has && qs0.ready {
                            dev::virtio::queue::Virtqueue::new(&qs0, 256)
                                .ok()
                                .map(|mut q| {
                                    q.set_ring_indices(rx_la, rx_ui);
                                    q
                                })
                        } else {
                            None
                        };
                        *tx_vq = if tx_has && qs1.ready {
                            dev::virtio::queue::Virtqueue::new(&qs1, 256)
                                .ok()
                                .map(|mut q| {
                                    q.set_ring_indices(tx_la, tx_ui);
                                    q
                                })
                        } else {
                            None
                        };
                        let mut st = state.borrow_mut();
                        st.rx_dropped = rx_dropped;
                        st.tx_count = tx_count;
                        st.rx_count = rx_count;
                    }
                }
                other => {
                    return Err(crate::resume::SnapshotError::UnsupportedSection { tag: other });
                }
            }
        }
        // E4-T05: a restore swaps CPU + RAM wholesale, so any predecoded block (keyed by the
        // pre-restore physical layout) is now stale — flush the cache and drop the cursor.
        self.block_cache.flush();
        self.block_cursor = None;
        // E4-T08: the restored physical layout invalidates every nominated block — reset discovery.
        self.discovery.reset();
        // E4-T10: recompile from cold on the restored image — every compiled block is stale.
        if let Some(e) = self.executor.as_mut() {
            e.invalidate_all();
        }
        Ok(())
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

    /// E2-T05: derive `mip.STIP` from the built-in-SBI timer deadline — a LEVEL, exactly
    /// like MTIP: `STIP = (mtime >= stimecmp)`. Re-evaluated every boundary, so a
    /// `set_timer` in the past fires at the NEXT boundary, a future deadline CLEARS a
    /// pending STIP before the guest runs another instruction (the spec's "clears the
    /// pending timer interrupt" clause), and `u64::MAX` never fires. A no-op unless the
    /// built-in SBI is enabled and a CLINT provides `mtime`.
    #[cfg(not(feature = "zicsr-stub"))]
    fn sync_sbi_timer(&mut self) {
        if self.builtin_sbi
            && let Some(clint) = &self.clint
        {
            let mtime = clint.borrow().mtime;
            self.hart
                .csr
                .set_mip_bit(5, mtime >= self.sbi_state.stimecmp); // STIP
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

    /// E2-T23b: deterministic idle fast-forward ("tickless idle"). Called right after a `WFI`
    /// retires with no interrupt pending (the boundary's `next_interrupt()` returned `None`).
    /// Without this, an idle/sleeping guest spins `WFI`, and because `mtime` is the retire-count
    /// clock it advances only one tick per `clock_div` WFI retirements — so a guest `sleep`
    /// burns `deadline_ticks * clock_div` instructions of pure spin (≈20× real time in the slow
    /// browser interpreter). Instead, jump `mtime` straight to the nearest armed timer deadline
    /// (machine `mtimecmp` or the SBI S-timer `stimecmp`), so the timer fires on the very next
    /// boundary and the guest wakes immediately in wall-clock terms.
    ///
    /// This preserves determinism: the jump is a pure function of machine state
    /// (`mtime`, `mtimecmp`, `stimecmp`) with no host clock, so native and wasm fast-forward by
    /// the identical amount and the timer still lands at the same retire index on both. Only the
    /// *number of idle spin retirements* shrinks; the guest-visible `mtime` reaches the same
    /// deadline it would have, just without the spin. When no timer is armed (a genuine deadlock,
    /// caught by [`Self::wfi_watchdog_check`]) there is no deadline to jump to and this is a no-op.
    #[cfg(not(feature = "zicsr-stub"))]
    fn wfi_fast_forward(&mut self) {
        let Some(clint) = &self.clint else { return };
        // Sweep-critic (E2-T23b LOW): a pending+enabled interrupt (mip & mie != 0) satisfies
        // the WFI wake condition RIGHT NOW (per the ISA, even with global xIE=0) — no time
        // needs to pass, so jumping mtime to a timer deadline would be a semantic time
        // distortion. Skip the jump; the WFI retires as a nop and execution proceeds.
        if self.hart.csr.mip_and_mie_nonzero() {
            return;
        }
        // Nearest armed FUTURE deadline. A deadline already <= mtime is "due" — its interrupt is
        // pending and WFI wakes next boundary anyway, so there is nothing to skip. `u64::MAX` is
        // the "cancelled" sentinel for both compares.
        let mut deadline: Option<u64> = None;
        let mtime = {
            let c = clint.borrow();
            if c.mtimecmp != u64::MAX && c.mtimecmp > c.mtime {
                deadline = Some(c.mtimecmp);
            }
            c.mtime
        };
        let stimecmp = self.sbi_state.stimecmp;
        if stimecmp != u64::MAX && stimecmp > mtime {
            deadline = Some(deadline.map_or(stimecmp, |d| d.min(stimecmp)));
        }
        if let Some(d) = deadline {
            // Jump the machine clock to the deadline; next boundary re-evaluates MTIP/STIP as a
            // level (mtime >= cmp) and delivers the timer. tick_accum (sub-tick remainder from
            // retirements) is left untouched — whole-tick jumps are independent of the divider.
            clint.borrow_mut().mtime = d;
        }
    }

    /// Whether a network backend is waiting on an event that only the host can deliver between
    /// execution chunks. Fast-forwarding WFI to a guest timer deadline in this state can make a
    /// socket timeout fire before the browser gets a chance to run its WebSocket callback.
    #[cfg(not(feature = "zicsr-stub"))]
    fn external_net_io_pending(&self) -> bool {
        self.net
            .as_ref()
            .is_some_and(|(state, _, _)| state.borrow().backend.external_io_pending())
    }

    /// E2-T20: run the sliding-window interrupt-storm detector. Called only when a trap lands
    /// (event-driven, so zero cost while quiet — a trap during normal operation is rare, and
    /// during a storm the detector is exactly what we want running). Syncs the PLIC claim
    /// counters in, then checks for `>5000 traps / 10^6 retired` sustained over 3 windows.
    #[cfg(not(feature = "zicsr-stub"))]
    fn storm_check(&mut self) {
        if !self.storm_detect {
            return;
        }
        // Called only when a trap lands (interrupt or exception), so this runs a few thousand
        // times over a whole boot — cheap to sync the 32-entry PLIC claim vector so the storm's
        // per-window "hot line" naming is current (critic #2). check_storm itself is a rate
        // compare that does real work only when a 10^6-retired window closes.
        if let Some(plic) = &self.plic {
            self.irqstats.claims = *plic.borrow().claim_counts();
        }
        if let Some(r) = self.irqstats.check_storm(1_000_000, 5_000, 3) {
            let hot = match r.hot_irq {
                Some((id, n)) => alloc::format!("hottest PLIC irq {id} ({n} claims this window)"),
                None => alloc::string::String::from("no external PLIC irq is hot"),
            };
            log::warn!(
                "E2-T20 INTERRUPT STORM: {} traps in {} retired instrs — {hot}\n{}",
                r.window_traps,
                r.window_retired,
                self.irqstats.dump(),
            );
        }
    }

    /// E2-T20: the WFI-deadlock watchdog. Called right after a `WFI` retires; if no wakeup can
    /// ever arrive (nothing pending+enabled in `mip`&`mie`, no armed timer deadline), the guest
    /// will idle forever — report it once instead of spinning silently.
    #[cfg(not(feature = "zicsr-stub"))]
    fn wfi_watchdog_check(&mut self) {
        if !self.storm_detect {
            return;
        }
        let armed = self.any_wakeup_armed();
        if let Some(msg) = self.irqstats.wfi_watchdog(true, armed) {
            log::warn!("E2-T20 {msg}\n{}", self.irqstats.dump());
        }
    }

    /// E2-T20: could any interrupt ever wake a WFI? True if something is already pending AND
    /// enabled (`mip & mie != 0` — this already reflects a PLIC line held high, which
    /// `sync_plic` mirrors into `mip.SEIP`), OR a timer deadline is armed in the future (CLINT
    /// `mtimecmp` or the SBI S-timer `stimecmp` below `u64::MAX`) — a future deadline is not in
    /// `mip` yet but WILL fire, so it counts as an armed wakeup.
    #[cfg(not(feature = "zicsr-stub"))]
    fn any_wakeup_armed(&self) -> bool {
        if self.hart.csr.mip_and_mie_nonzero() {
            return true;
        }
        // Sweep-critic (E2-T20 BUG 2): a wakeup source only counts if it is DELIVERABLE — an
        // armed mtimecmp with MTIE=0 (or msip with MSIE=0) can never end the WFI loop under
        // our semantics, which is exactly the deadlock the watchdog exists to report. Gate
        // each CLINT source on its mie enable bit (stimecmp rides the S-timer → STIE, bit 5).
        let mie = self.hart.csr.mie_bits();
        if self.sbi_state.stimecmp != u64::MAX && mie & (1 << 5) != 0 {
            return true;
        }
        if let Some(clint) = &self.clint {
            let c = clint.borrow();
            return (c.mtimecmp != u64::MAX && mie & (1 << 7) != 0)
                || (c.msip && mie & (1 << 3) != 0);
        }
        false
    }

    /// Like [`Self::run`], but feeds every retired instruction to `sink` (E0-T18's
    /// `--trace`). Termination and the "logged once" HTIF command watch are identical to
    /// `run` — the ONE place the run-loop / HTIF state machine lives, so a traced run and
    /// an untraced run can never diverge in when they stop.
    /// Run up to `max_instrs`, timing the total profiled wall-span ONCE at entry and ONCE at exit
    /// (E4-T01 phase 3) — never inside the loop. When profiling is armed with a host timer, the
    /// entry→exit delta accumulates into `prof_total_ns`, the span CPU-interp time is later derived
    /// from by subtraction. The `_inner` body holds the actual loop and is untouched by profiling.
    pub fn run_traced<T: trace::TraceSink>(&mut self, max_instrs: u64, sink: &mut T) -> RunOutcome {
        // One timer read at entry (cold, once per run) — only when profiling armed with a timer.
        let t0 = if self.profiling {
            self.host_timer.as_ref().map(|t| t.now_ns())
        } else {
            None
        };
        let outcome = self.run_traced_inner(max_instrs, sink);
        // One timer read at exit; accumulate the total profiled span. The device+walk time timed on
        // the cold paths is a SUBSET of this span, so `total − (device + walk)` is the interpreter's.
        if let (Some(t0), Some(t)) = (t0, self.host_timer.as_ref()) {
            self.prof_total_ns = self
                .prof_total_ns
                .saturating_add(t.now_ns().saturating_sub(t0));
        }
        outcome
    }

    /// E4-T05 Phase A: execute EXACTLY ONE instruction using the predecoded block cache,
    /// returning the SAME `Result<(), Trap>` contract as [`Hart::step_traced`]. It replays a
    /// memoized micro-op instead of re-fetching/decoding, but performs the identical
    /// architectural sequence — counter arm, execute-trigger check, `execute`, `retire_tick`,
    /// retire hook — so the retire trace is byte-identical to the legacy path. Only decode is
    /// memoized. Called once per outer-loop iteration, so the loop's per-op device sync +
    /// interrupt sampling stay per-retire (interrupt batching is Phase C).
    #[cfg(not(feature = "zicsr-stub"))]
    fn step_cached<T: trace::TraceSink>(&mut self, sink: &mut T) -> Result<(), Trap> {
        // Same ordering as `step_traced`: arm counters, then the execute-address trigger check,
        // BEFORE obtaining the instruction.
        self.hart.csr.arm_counters();
        let pc = self.hart.regs.pc;
        if !self.hart.csr.triggers_idle()
            && self
                .hart
                .csr
                .trigger_fires(pc, crate::csr::TrigKind::Execute)
        {
            return Err(Trap {
                cause: hart::Exception::Breakpoint,
                tval: pc,
            });
        }
        // Fetch the micro-op: a cursor hit replays a cached op with NO re-translation (safe —
        // a block never leaves its physical page, so the entry translation covers every op); a
        // miss (re)builds the block at pc's physical address, reproducing any fetch/decode trap.
        let op = self.next_micro_op(pc)?;
        let (rd, value, mem) = self.hart.execute(
            &mut self.bus,
            op.instr,
            u64::from(op.len),
            u64::from(op.raw),
        )?;
        self.hart.csr.retire_tick();
        sink.retire(&trace::TraceRecord {
            pc,
            insn: op.raw,
            rd: (rd != 0).then_some((rd, value)),
            mem,
        });
        // E4-T05 Phase B invalidation:
        //  - `fence.i` orders a prior code write against this fetch stream → whole-cache flush
        //    (O(1) generation bump); conservative and cheap for a rare op.
        //  - a store (this op's `mem.is_store`, incl. SC/AMO) reached RAM via the bus, which
        //    recorded its physical frame(s). Drain that log through PAGE-GRANULAR invalidation:
        //    only a store into a frame that actually holds cached code drops blocks (and the
        //    cursor). Ordinary data stores are set-misses → the cache is RETAINED (the Phase-B
        //    win over Phase A's flush-everything).
        if matches!(op.instr, crate::decode::Instr::FenceI) {
            self.block_cache.flush();
            self.block_cursor = None;
            // E4-T08: fence.i orders a prior code write against the fetch stream — any block may
            // now decode differently. Bump the discovery generation so pending requests go stale
            // and hot blocks re-nominate from scratch.
            self.discovery.on_invalidate();
            // E4-T10: fence.i is a whole-cache flush — every compiled block is dropped too.
            if let Some(e) = self.executor.as_mut() {
                e.invalidate_all();
            }
        } else {
            self.drain_code_writes();
        }
        Ok(())
    }

    /// E4-T05 Phase B: drain the bus's physical-frame write log (guest stores AND device/DMA
    /// writes — both reach RAM through the same physical `store*`) into the block cache's
    /// page-granular invalidation. If any drained frame held cached code, the in-flight block
    /// cursor may point into a just-dropped block, so it is reset (conservative-safe — a
    /// spurious reset only costs a rebuild). Cheap when the log is empty (the common case).
    #[cfg(not(feature = "zicsr-stub"))]
    fn drain_code_writes(&mut self) {
        if !self.block_cache_enabled {
            return;
        }
        // Disjoint borrows: drain the bus log while page-invalidating the cache.
        let Self {
            bus,
            block_cache,
            block_cursor,
            discovery,
            executor,
            ..
        } = self;
        let log = bus.code_write_log_mut();
        if log.is_empty() {
            return;
        }
        let mut flushed = false;
        for &frame in log.iter() {
            if block_cache.flush_page(frame) {
                flushed = true;
                // E4-T10: the SMC / DMA-into-code store dropped this frame's cached blocks — drop
                // the matching compiled blocks so the executor recompiles from the new bytes.
                if let Some(e) = executor.as_mut() {
                    e.invalidate_page(frame);
                }
            }
        }
        log.clear();
        if flushed {
            *block_cursor = None;
            // E4-T08: a store landed on a code page (SMC / DMA-into-code) and dropped ≥1 cached
            // block. Bump the discovery generation so any pending request for the overwritten bytes
            // is dropped at install time and the re-decoded block re-nominates fresh.
            discovery.on_invalidate();
        }
    }

    /// E4-T05: return the [`MicroOp`](dispatch::MicroOp) to execute at virtual address `pc`,
    /// serving it from the block cache. A valid cursor (same expected VA, block still live)
    /// replays the next cached op with no translation; otherwise the block at `pc` is (re)built
    /// by walking [`Hart::decode_at`] to the first terminator / page boundary / 128-op cap. On a
    /// fetch/decode fault the precise trap is returned (identical to the legacy path).
    #[cfg(not(feature = "zicsr-stub"))]
    fn next_micro_op(&mut self, pc: u64) -> Result<dispatch::MicroOp, Trap> {
        // Fast path: continue the block we are mid-replay of.
        if let Some((key, idx, next_va)) = self.block_cursor
            && next_va == pc
            && let Some(op) = self
                .block_cache
                .get(key)
                .and_then(|b| b.ops.get(idx).copied())
        {
            self.block_cursor = Some((key, idx + 1, pc.wrapping_add(u64::from(op.len))));
            return Ok(op);
        }
        self.block_cursor = None;

        // Decode the entry op FIRST (this is the translation the legacy path would do — it fills
        // the TLB identically), then key by physical PC (now a guaranteed TLB hit, no state change).
        let first = self.hart.decode_at(&mut self.bus, pc)?;
        let phys = self.hart.fetch_phys(&mut self.bus, pc)?;

        // An entry op that straddles a physical page cannot live in a page-bounded block; run it
        // uncached (byte-identical — `decode_at` already did the split fetch). Cursor stays None.
        let page_off = pc & (dispatch::PAGE - 1);
        if page_off + u64::from(first.len) > dispatch::PAGE {
            return Ok(first);
        }

        // Walk contiguous ops within this physical page to the first terminator / page edge / cap.
        let mut ops = alloc::vec::Vec::with_capacity(8);
        let mut total_len = u64::from(first.len);
        ops.push(first);
        let page_base = pc & !(dispatch::PAGE - 1);
        if !dispatch::is_terminator(&first.instr) {
            let mut va = pc.wrapping_add(u64::from(first.len));
            while ops.len() < dispatch::MAX_BLOCK_OPS {
                // Stop if the next op would begin in a different physical page.
                if (va & !(dispatch::PAGE - 1)) != page_base {
                    break;
                }
                let op = match self.hart.decode_at(&mut self.bus, va) {
                    Ok(op) => op,
                    // A fetch/decode fault ahead ends the block here; it is reproduced precisely
                    // when execution reaches that VA and rebuilds a fresh (trapping) block there.
                    Err(_) => break,
                };
                // An op straddling the page boundary belongs to the next block, not this one.
                if (va & (dispatch::PAGE - 1)) + u64::from(op.len) > dispatch::PAGE {
                    break;
                }
                debug_assert_eq!(
                    va & !(dispatch::PAGE - 1),
                    page_base,
                    "block op must not leave the entry physical page"
                );
                total_len += u64::from(op.len);
                let is_term = dispatch::is_terminator(&op.instr);
                ops.push(op);
                if is_term {
                    break;
                }
                va = va.wrapping_add(u64::from(op.len));
            }
        }

        // E4-T08: this is a block ENTRY (a cursor miss re-keyed and rebuilt the block at `phys`).
        // Bump the hotness counter and, on crossing the threshold, nominate a TranslationRequest.
        // Observation-only: it reads the walked ops and mutates only the discovery side-structure,
        // never the executed sequence — so the retire trace is byte-identical (`predecode_diff`).
        self.discovery.on_block_entry(phys, &ops);
        self.block_cache
            .insert(dispatch::DecodedBlock::new(phys, ops, total_len));
        // Entry op (index 0) is consumed now; the cursor resumes at index 1.
        self.block_cursor = Some((phys, 1, pc.wrapping_add(u64::from(first.len))));
        Ok(first)
    }

    /// E4-T05 Phase C: is the hart about to execute the ENTRY of a (fresh) basic block, i.e. a
    /// block boundary where interrupts/devices must be re-sampled under batching? True unless the
    /// next step is a live continuation of the block currently being replayed — mirroring exactly
    /// the fast-path hit test in [`Self::next_micro_op`] (same VA, block still cached, op present).
    /// A branch/jump/trap/ecall/WFI (all block terminators) moves the PC off the cursor's expected
    /// VA, so the following step is a boundary and re-syncs — matching the legacy per-op behavior at
    /// every point interrupt-enable state could have changed. Because the answer depends only on the
    /// block structure (terminators / 128-op cap / page edges), never on cache capacity (a block is
    /// never evicted mid-replay by its own straight-line execution), the boundaries — and thus the
    /// interrupt-sampling points — are deterministic across cache sizes.
    #[cfg(not(feature = "zicsr-stub"))]
    fn at_block_boundary(&self) -> bool {
        let pc = self.hart.regs.pc;
        match self.block_cursor {
            Some((key, idx, next_va)) if next_va == pc => self
                .block_cache
                .get(key)
                .and_then(|b| b.ops.get(idx))
                .is_none(),
            _ => true,
        }
    }

    /// E4-T10: drain the block-discovery FIFO and install compiled blocks. For each nominated
    /// request, the snapshotted bytes are re-validated against LIVE guest memory (the E4-T08
    /// `install_check` — guards SMC/stale between nomination and install); on success the (still
    /// physically-keyed) decoded block is handed to the executor, which translates + compiles +
    /// registers it. Called at block boundaries; cheap when the queue is empty (the common case).
    #[cfg(not(feature = "zicsr-stub"))]
    fn pump_jit_translations(&mut self) {
        use crate::bus::Bus;
        if self.executor.is_none() {
            return;
        }
        let reqs = self.discovery.take_requests();
        if reqs.is_empty() {
            return;
        }
        let mut exec = self.executor.take().expect("executor present");
        for req in &reqs {
            // Re-read the live physical bytes for the block and validate: a store/`fence.i` between
            // nomination and now would fail this and the request is dropped (never compile stale code).
            let n = req.code_bytes.len();
            let mut live = alloc::vec::Vec::with_capacity(n);
            let mut ok = true;
            for i in 0..n {
                match self.bus.load8(req.phys_pc.wrapping_add(i as u64)) {
                    Ok(b) => live.push(b),
                    Err(_) => {
                        ok = false;
                        break;
                    }
                }
            }
            if !ok || !self.discovery.install_check(req, &live) {
                continue;
            }
            // The predecoded block is still cached (physical keying); hand a clone to the executor.
            if let Some(block) = self.block_cache.get(req.phys_pc) {
                let block = block.clone();
                exec.install(&block);
            }
        }
        self.executor = Some(exec);
    }

    /// E4-T10: try to execute the compiled block at the current PC via the JIT. Returns:
    /// * `None` — the JIT did NOT run this block (not enabled at a boundary, not compiled, or it
    ///   faulted out mid-block leaving hart state untouched); the caller interprets instead.
    /// * `Some(Ok(()))` — a compiled block ran to a `FALLTHROUGH`/`BRANCH_TAKEN` exit: registers,
    ///   PC, and the retire clock are already committed (the clock advanced once per guest op the
    ///   block retired, preserving `mtime`-at-retire determinism); the caller skips the interpreter.
    /// * `Some(Err(trap))` — the block's terminator (`ecall`/`ebreak`) traps: the body ops' retires
    ///   are committed, PC is left at the faulting instruction, and the runtime-derived (mode-correct)
    ///   trap is returned for the loop's normal trap-delivery path, with NO intervening boundary poll
    ///   (so interrupt timing matches the interpreter exactly).
    ///
    /// The device/interrupt sample already happened at this boundary (in the loop, before this call),
    /// and `mtime` advances per retired op below, so the E4-T05 interrupt-batching semantics are
    /// preserved: a compiled block is exactly one `DecodedBlock` (≤128 ops), sampled at its entry.
    #[cfg(not(feature = "zicsr-stub"))]
    fn try_jit_block(&mut self) -> Option<Result<(), Trap>> {
        let pc = self.hart.regs.pc;
        // Physical key. `fetch_phys` is a warm TLB lookup at a boundary (the interpreter would do
        // the same fetch); a fetch fault means "not a JIT block" — interpret so the fault is precise.
        let phys = self.hart.fetch_phys(&mut self.bus, pc).ok()?;
        if !self.executor.as_ref()?.is_compiled(phys) {
            return None;
        }
        // Op count + terminator + per-op byte lengths, read from the still-cached decoded block
        // (physical keying). The lengths let a PRECISE mem-fault side-exit (below) compute how many
        // instructions retired before the faulting one, so the retire clock advances by exactly that.
        let (nops, terminator, op_lens, block_phys) = {
            let b = self.block_cache.get(phys)?;
            (
                b.ops.len(),
                b.ops.last().map(|o| o.instr),
                b.ops
                    .iter()
                    .map(|o| o.len as u64)
                    .collect::<alloc::vec::Vec<u64>>(),
                b.phys_start,
            )
        };
        // Take the executor out so it can borrow hart + bus for the duration of the call.
        let mut exec = self.executor.take().expect("compiled ⇒ executor present");
        let exit = exec.execute(phys, &mut self.hart, &mut self.bus);
        self.executor = Some(exec);
        let exit = exit?; // None ⇒ faulted out; hart untouched ⇒ fall back to the interpreter.

        // PC is about to jump to a block entry; the block cursor no longer describes it.
        self.block_cursor = None;
        match exit.code {
            jit::ExitCode::Fallthrough | jit::ExitCode::BranchTaken => {
                self.hart.regs.pc = exit.next_pc;
                // Every guest op in the block retired: advance the retire clock once per op so
                // `mtime` (retire-derived) lands identically to the interpreter, and feed the
                // storm/progress denominator identically.
                for _ in 0..nops {
                    self.advance_clock();
                    self.irqstats.on_retire();
                }
                // A JIT block ending in `fence.i` must still order the fetch stream: perform the
                // same whole-cache + compiled invalidation the interpreter's `step_cached` does.
                if matches!(terminator, Some(crate::decode::Instr::FenceI)) {
                    self.block_cache.flush();
                    self.discovery.on_invalidate();
                    if let Some(e) = self.executor.as_mut() {
                        e.invalidate_all();
                    }
                } else {
                    // A JIT store may have landed on a code page (SMC/DMA-into-code) — drain the
                    // bus write log through page-granular invalidation, exactly like the interpreter.
                    self.drain_code_writes();
                }
                Some(Ok(()))
            }
            jit::ExitCode::Trap => {
                // E4-T12: a PRECISE mid-block memory fault carries the interpreter-produced `Trap`
                // (cause + `mtval`) directly. `exit.next_pc` is the faulting instruction's PC; the
                // executor already synced the precise register file (as of the instruction before
                // it) back into `hart.regs`. Advance the retire clock by exactly the number of ops
                // that retired before the faulting one (found by walking the block's op lengths to
                // the faulting PC), leave PC at the faulting instruction, and hand the trap to the
                // loop's normal `take_trap` delivery — so mcause/mtval/mepc come from the ONE
                // trusted implementation and no already-committed side-effect is re-executed.
                if let Some(trap) = exit.trap {
                    let faulting_pc = exit.next_pc;
                    let mut retired = 0u64;
                    let mut p = block_phys;
                    for len in &op_lens {
                        if p == faulting_pc {
                            break;
                        }
                        p = p.wrapping_add(*len);
                        retired += 1;
                    }
                    for _ in 0..retired {
                        self.advance_clock();
                        self.irqstats.on_retire();
                    }
                    self.hart.regs.pc = faulting_pc;
                    // A store before the fault may have hit a code page (SMC/DMA-into-code); drain
                    // the bus write log through page-granular invalidation, exactly as the
                    // interpreter would after that store retired.
                    self.drain_code_writes();
                    return Some(Err(trap));
                }
                // Otherwise: the trapping terminator (`ecall`/`ebreak`) retires NOTHING; only the
                // `nops-1` body ops did. Advance the clock for those.
                let retired = nops.saturating_sub(1);
                for _ in 0..retired {
                    self.advance_clock();
                    self.irqstats.on_retire();
                }
                // Leave PC at the faulting instruction and derive the trap from the CURRENT
                // privilege mode (the block cannot know it) so the cause matches the interpreter.
                self.hart.regs.pc = exit.next_pc;
                let trap = match terminator {
                    Some(crate::decode::Instr::Ecall) => Trap {
                        cause: match self.hart.csr.mode {
                            crate::csr::Priv::U => hart::Exception::EcallFromU,
                            crate::csr::Priv::S => hart::Exception::EcallFromS,
                            crate::csr::Priv::M => hart::Exception::EcallFromM,
                        },
                        tval: 0,
                    },
                    _ => Trap {
                        // `ebreak` (the only other trapping terminator the translator emits):
                        // Breakpoint with tval = the faulting PC (matches the interpreter).
                        cause: hart::Exception::Breakpoint,
                        tval: exit.next_pc,
                    },
                };
                Some(Err(trap))
            }
            jit::ExitCode::Reserved(_) => {
                // The E4-T09 translator never emits these; on a clean return the executor already
                // committed registers, so re-interpreting would double-execute. Commit PC and treat
                // as a benign fall-through (defensive — unreachable for the current translator).
                self.hart.regs.pc = exit.next_pc;
                for _ in 0..nops {
                    self.advance_clock();
                    self.irqstats.on_retire();
                }
                Some(Ok(()))
            }
        }
    }

    fn run_traced_inner<T: trace::TraceSink>(
        &mut self,
        max_instrs: u64,
        sink: &mut T,
    ) -> RunOutcome {
        for _ in 0..max_instrs {
            // E2-T17: a syscon finisher write (poweroff/reboot/fail) during the previous
            // instruction ends the run before the next one executes.
            #[cfg(not(feature = "zicsr-stub"))]
            if let Some(reason) = self.syscon.as_ref().and_then(|c| *c.borrow()) {
                return RunOutcome::Reset(reason);
            }
            // E4-T05 Phase C: when interrupt batching is on, the device-fabric re-sync + the
            // `next_interrupt` sampling below run ONLY at a block boundary (once per DecodedBlock,
            // ≤128 ops), not per instruction. Mid-block they are skipped: no CSR/xret/wfi/fence can
            // change interrupt-enable state mid-block (all are terminators), and no device state
            // changes mid-block (device service is itself batched here), so the only new mid-block
            // interrupt source is `mtime` crossing `mtimecmp` — and `mtime` still advances
            // per-retire (`advance_clock`), so that interrupt becomes pending at the identical
            // retire index and is merely SAMPLED at the next boundary (≤128 retires later). With
            // batching OFF (incl. cache-on/batching-off, the byte-identical mode) this is `true`
            // every iteration, so the legacy per-op behavior is bit-for-bit preserved.
            #[cfg(not(feature = "zicsr-stub"))]
            let sample_boundary = !self.interrupt_batching() || self.at_block_boundary();
            // E1-T12: refresh the CLINT-driven interrupt LEVELS (MTIP = mtime >= mtimecmp, MSIP
            // = msip) into `mip` before sampling — a continuously re-evaluated level, so a
            // just-crossed timer fires and a raised `mtimecmp` clears MTIP with no CSR access.
            #[cfg(not(feature = "zicsr-stub"))]
            if sample_boundary {
                self.sync_clint();
                // E2-T07: tick the UART char-timeout clock and mirror its level into the
                // PLIC BEFORE sync_plic samples EIP, so a UART edge lands this boundary.
                if let Some((uart, line)) = &self.uart {
                    let mut u = uart.borrow_mut();
                    u.tick();
                    line.set(u.irq_level());
                }
                // E2-T16: poll the RTC alarm and mirror its interrupt level into the PLIC,
                // BEFORE sync_plic samples EIP, so a just-reached alarm fires this boundary.
                if let Some((rtc, line)) = &self.rtc {
                    line.set(rtc.borrow_mut().poll());
                }
                // E2-T11: service pending virtio-blk kicks BEFORE mirroring levels, so a
                // completed request's used-ring interrupt lands this same boundary.
                if let Some((state, vq)) = &mut self.blk {
                    let slot = alloc::rc::Rc::clone(&self.virtio[0].0);
                    dev::virtio::blk::service(&slot, vq, state, &mut self.bus);
                }
                // E4-T03: service each ADDITIONAL (read-only) blk device on the same boundary, so a
                // guest read of `/dev/vdb…` completes promptly. Index-based to keep the `extra_blk`
                // borrow disjoint from `self.virtio` / `self.bus`.
                for i in 0..self.extra_blk.len() {
                    let slot = alloc::rc::Rc::clone(&self.virtio[self.extra_blk[i].2].0);
                    let (state, vq, _) = &mut self.extra_blk[i];
                    dev::virtio::blk::service(&slot, vq, state, &mut self.bus);
                }
                // E3-T13: service virtio-net kicks (and async backend rx frames) the same
                // boundary, so tx completions + delivered echoes interrupt promptly.
                if let Some((state, rx_vq, tx_vq)) = &mut self.net {
                    let slot = alloc::rc::Rc::clone(&self.virtio[1].0);
                    dev::virtio::net::service(&slot, rx_vq, tx_vq, state, &mut self.bus);
                }
                // virtio-rng: fill guest entropy requests the same boundary the driver kicked, so
                // the CRNG seeds without waiting on the run loop.
                if let Some((state, vq)) = &mut self.rng {
                    let slot = alloc::rc::Rc::clone(&self.virtio[2].0);
                    dev::virtio::rng::service(&slot, vq, state, &mut self.bus);
                }
                // E2-T08: mirror each virtio slot's InterruptStatus level into the PLIC.
                for (slot, line) in &self.virtio {
                    line.set(slot.borrow().irq_level());
                }
                // E1-T13: refresh the PLIC-driven MEIP/SEIP levels too, before sampling.
                self.sync_plic();
                // E2-T05: refresh the built-in-SBI S-timer level (STIP) before sampling.
                self.sync_sbi_timer();
                // E4-T05 Phase B: the device services above may have DMA'd into guest RAM (a
                // virtio-blk read completion writing sector bytes, virtio-net rx, virtio-rng,
                // a used-ring publish). Those writes went through the bus and were logged by
                // physical frame; drain them through page-granular invalidation so a guest that
                // DMAs code then jumps to it can never execute a stale cached block. (Phase C
                // does NOT touch this — the device sync above is still per-retire.)
                self.drain_code_writes();
                // E4-T10: at a block boundary, install any newly-nominated hot blocks into the
                // executor (validated against live memory). Cheap when the queue is empty.
                if self.jit_enabled {
                    self.pump_jit_translations();
                }
            }
            // E1-T11: sample interrupts at the instruction boundary (precise). Deliver the
            // highest-priority pending&enabled interrupt through mtvec/stvec BEFORE fetching the
            // next instruction — sepc/mepc then points at the resume address (the interrupted
            // instruction fully retired or never ran). Taking the trap clears xIE, so a pending
            // line does not re-fire while its handler runs. (No real CSR file under zicsr-stub.)
            // E4-T05 Phase C: sample interrupts only at a block boundary when batching (see above);
            // `sample_boundary` is always `true` when batching is off, so this is unchanged there.
            #[cfg(not(feature = "zicsr-stub"))]
            if sample_boundary && let Some((cause, to_s)) = self.hart.csr.next_interrupt() {
                let epc = self.hart.regs.pc;
                self.hart.take_interrupt(cause, to_s, epc);
                self.irqstats.on_interrupt(cause); // E2-T20 storm counter
                self.storm_check(); // CRITIC #1: an INTERRUPT storm must be detected too
                continue;
            }
            // E4-T01: capture the PC of the instruction ABOUT to execute — after `step_traced` it has
            // already advanced to the successor, so the retired instruction's address must be read
            // here. A single register-resident field read; the sampling decision itself is gated below.
            #[cfg_attr(feature = "zicsr-stub", allow(unused_variables))]
            let prof_pc = self.hart.regs.pc;
            // E4-T05: when the block cache is enabled, decode is served from the memoized block
            // (via `step_cached`); everything ELSE in this loop body — the per-op device sync,
            // `next_interrupt`, `advance_clock`, `on_retire`, and the profiler hook — is UNCHANGED
            // and still runs PER RETIRE. So the ONLY cache-on vs cache-off difference is memoized
            // decode; the retire trace must be byte-identical. (Batching those is Phase C.)
            // E4-T10: at a block boundary, if the JIT is active and this block is compiled, run it
            // via the executor INSTEAD of interpreting. `try_jit_block` commits the retire clock for
            // the block's ops itself (so the per-op accounting below is skipped for a JIT run).
            #[cfg(not(feature = "zicsr-stub"))]
            let jit_attempt = if self.jit_active() && sample_boundary {
                self.try_jit_block()
            } else {
                None
            };
            #[cfg(not(feature = "zicsr-stub"))]
            let ran_via_jit = jit_attempt.is_some();
            #[cfg(not(feature = "zicsr-stub"))]
            let step_result = match jit_attempt {
                Some(r) => r,
                None if self.block_cache_enabled => self.step_cached(sink),
                None => self.hart.step_traced(&mut self.bus, sink),
            };
            #[cfg(feature = "zicsr-stub")]
            let step_result = self.hart.step_traced(&mut self.bus, sink);
            // E1-T12: an instruction retired iff the step succeeded — advance the deterministic
            // retire-count clock ONLY then (a delivered trap or a taken interrupt retires nothing).
            // A JIT run already advanced the clock per retired op inside `try_jit_block`, so this
            // per-op accounting runs only for an interpreted step.
            #[cfg(not(feature = "zicsr-stub"))]
            if !ran_via_jit && step_result.is_ok() {
                self.advance_clock();
                self.irqstats.on_retire(); // E2-T20 progress denominator
                // E4-T01: hot-PC sampling — only when armed, and only 1-in-~1024 retires (a jittered
                // stride) so the histogram write is off the per-instruction hot path. We record the
                // guest VIRTUAL PC: it is what `System.map` symbolizes and the guest-virtual address
                // space a future JIT keys blocks on, so on-sample physical translation buys nothing.
                if self.profiling {
                    self.prof_countdown = self.prof_countdown.saturating_sub(1);
                    if self.prof_countdown == 0 {
                        self.prof.record_pc(prof_pc);
                        self.prof_countdown = self.prof_next_stride();
                    }
                }
                if self.hart.last_was_wfi {
                    self.irqstats.on_wfi();
                    self.hart.last_was_wfi = false;
                    self.wfi_watchdog_check(); // deadlock watchdog (WFI + no wakeup armed)
                    // E2-T23b: no interrupt was pending this boundary (next_interrupt returned
                    // None above), so this WFI is a real idle wait. Skip the idle spin by jumping
                    // mtime to the nearest armed timer deadline — deterministic, so native and
                    // wasm agree. Turns a ~20× `sleep` into near-real-time. No-op if no timer armed.
                    if !self.external_net_io_pending() {
                        self.wfi_fast_forward();
                    }
                }
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
                    let ret = sbi::handle(
                        &mut self.sbi_state,
                        &mut self.bus,
                        &mut self.hart,
                        eid,
                        fid,
                        &args,
                    );
                    // E2-T06 SRST: a requested shutdown ends the run NOW — the guest never
                    // executes another instruction (spec: system_reset does not return).
                    if let Some(code) = self.sbi_state.shutdown {
                        return RunOutcome::Exited(code);
                    }
                    // E2-T17 SRST: a requested reboot ends the run so the host re-boots.
                    if self.sbi_state.reboot {
                        return RunOutcome::Reset(ExitReason::Reboot);
                    }
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
                    self.irqstats.on_exception(trap.cause as u64); // E2-T20 storm counter
                    self.storm_check(); // livelock/storm: a trap just landed — cheap to check
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
        // E2-T17 (critic A2): a finisher write on the VERY LAST budgeted instruction latches
        // the reset cell but the top-of-loop drain never runs again. Drain it once more here
        // so a poweroff/reboot on the final instruction isn't misreported as MaxInstrs.
        #[cfg(not(feature = "zicsr-stub"))]
        if let Some(reason) = self.syscon.as_ref().and_then(|c| *c.borrow()) {
            return RunOutcome::Reset(reason);
        }
        RunOutcome::MaxInstrs
    }
}

/// The memory footprint (bytes from `KERNEL_BASE`) of a RISC-V Linux `Image`. Returns
/// `image_size` from the Image header when the header is valid and larger than the file;
/// otherwise the raw file length (a kernel without the header, or a truncated/foreign blob,
/// still loads and the caller gets a safe lower bound).
///
/// Header layout (arch/riscv/kernel/head.S `_start`): `code0`(4) `code1`(4) `text_offset`(8)
/// `image_size`(8) `flags`(8) `version`(4) `res1`(4) `res2`(8) `magic`(8, deprecated
/// `"RISCV\0\0\0"` at 0x30) then the 4-byte `magic2 = "RSC\x05"` at offset **0x38**. We key
/// off `magic2`, which is stable across the header revisions that carry `image_size`.
///
/// Limitation: a pre-4.6 kernel (or one built without CONFIG) can leave `image_size == 0`
/// ("unbounded"); we then fall back to `file_len`, which under-reports the `.bss` footprint
/// and could mis-place the initrd. Every kernel we ship (6.6.63) sets it, and the boot glue's
/// RAM ceiling still prevents an overflow — but an image_size-0 kernel is unsupported here.
fn kernel_image_footprint(bytes: &[u8]) -> u64 {
    let file_len = bytes.len() as u64;
    if bytes.len() >= 0x3c && &bytes[0x38..0x3c] == b"RSC\x05" {
        let image_size = u64::from_le_bytes(bytes[16..24].try_into().unwrap());
        if image_size > file_len {
            return image_size;
        }
    }
    file_len
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn kernel_footprint_honours_image_size() {
        // A minimal header: image_size at offset 16, RSC\x05 magic at 0x3c.
        let mut img = alloc::vec![0u8; 0x3c];
        img[16..24].copy_from_slice(&0x0011_4d00u64.to_le_bytes());
        img[0x38..0x3c].copy_from_slice(b"RSC\x05");
        assert_eq!(kernel_image_footprint(&img), 0x0011_4d00);
    }

    #[test]
    fn kernel_footprint_falls_back_to_file_len() {
        // No magic → use the file length (never place initrd below the raw image).
        let img = alloc::vec![0u8; 0x200];
        assert_eq!(kernel_image_footprint(&img), 0x200);
        // Magic present but image_size smaller than the file → still the file length.
        let mut small = alloc::vec![0u8; 0x400];
        small[16..24].copy_from_slice(&0x100u64.to_le_bytes());
        small[0x38..0x3c].copy_from_slice(b"RSC\x05");
        assert_eq!(kernel_image_footprint(&small), 0x400);
    }

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
