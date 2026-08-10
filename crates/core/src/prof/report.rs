//! The profiling REPORT: the assembled, host-facing view of a run's hot PCs and per-subsystem
//! time (E4-T01). Two serializations — a ranked text table ([`ProfReport::to_text`], styled after
//! [`crate::diag::irqstats::IrqStats::dump`]) and hand-rolled JSON ([`ProfReport::to_json`], no
//! `serde`, mirroring the CLI's existing `PROFILE_JSON` line).
//!
//! Phase 1 only DEFINES and unit-tests these types; wiring them onto the `Machine` run loop is a
//! later phase.

use alloc::format;
use alloc::string::String;
use alloc::vec::Vec;

/// The subsystems scoped timing is attributed to. Kept a small fixed enum (not a string map) so
/// the accumulator is a plain `[u64; N]` array — the same fixed-array / determinism discipline the
/// `irqstats` counters follow.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Subsystem {
    /// CPU instruction interpretation (the interpreter loop itself).
    CpuInterp,
    /// Page-table walks (Sv39/Sv48 address translation on a TLB miss).
    MmuWalk,
    /// CLINT (timer + software interrupt) device time.
    Clint,
    /// PLIC (external interrupt controller) device time.
    Plic,
    /// ns16550a UART device time.
    Uart,
    /// virtio-blk service time.
    VirtioBlk,
    /// virtio-net service time.
    VirtioNet,
    /// virtio-rng service time.
    VirtioRng,
    /// Goldfish RTC device time.
    Rtc,
    /// Syscon test-finisher time.
    Syscon,
    /// Anything not separately attributed.
    Other,
}

impl Subsystem {
    /// Every variant, in a stable order — the index into a `[u64; ALL.len()]` accumulator is a
    /// variant's position here, so this order is the on-wire order too (do not reshuffle).
    pub const ALL: [Subsystem; 11] = [
        Subsystem::CpuInterp,
        Subsystem::MmuWalk,
        Subsystem::Clint,
        Subsystem::Plic,
        Subsystem::Uart,
        Subsystem::VirtioBlk,
        Subsystem::VirtioNet,
        Subsystem::VirtioRng,
        Subsystem::Rtc,
        Subsystem::Syscon,
        Subsystem::Other,
    ];

    /// Map an MMIO window's base address (the canonical guest memory map, [`crate::platform::virt`])
    /// to the subsystem that owns it, so the cold device-dispatch timer (E4-T01 phase 3) attributes
    /// a device access's host-time to the right bucket. The virtio slots are keyed by slot index:
    /// slot 0 is virtio-blk, slot 1 virtio-net, slot 2 virtio-rng (the order the machine attaches
    /// backends); any further slot, or an address matching no known device, is [`Subsystem::Other`].
    pub fn for_device_base(base: u64) -> Subsystem {
        use crate::platform::virt;
        match base {
            virt::CLINT_BASE => Subsystem::Clint,
            virt::PLIC_BASE => Subsystem::Plic,
            virt::UART0_BASE => Subsystem::Uart,
            virt::RTC_BASE => Subsystem::Rtc,
            virt::TEST_BASE => Subsystem::Syscon,
            _ => {
                // virtio-mmio slot i lives at VIRTIO_BASE + i*VIRTIO_STRIDE.
                let slots =
                    virt::VIRTIO_BASE..virt::VIRTIO_BASE + virt::VIRTIO_COUNT * virt::VIRTIO_STRIDE;
                if slots.contains(&base)
                    && (base - virt::VIRTIO_BASE).is_multiple_of(virt::VIRTIO_STRIDE)
                {
                    match (base - virt::VIRTIO_BASE) / virt::VIRTIO_STRIDE {
                        0 => Subsystem::VirtioBlk,
                        1 => Subsystem::VirtioNet,
                        2 => Subsystem::VirtioRng,
                        _ => Subsystem::Other,
                    }
                } else {
                    Subsystem::Other
                }
            }
        }
    }

    /// Stable short name (used in both the text table and JSON keys).
    pub fn name(&self) -> &'static str {
        match self {
            Subsystem::CpuInterp => "cpu_interp",
            Subsystem::MmuWalk => "mmu_walk",
            Subsystem::Clint => "clint",
            Subsystem::Plic => "plic",
            Subsystem::Uart => "uart",
            Subsystem::VirtioBlk => "virtio_blk",
            Subsystem::VirtioNet => "virtio_net",
            Subsystem::VirtioRng => "virtio_rng",
            Subsystem::Rtc => "rtc",
            Subsystem::Syscon => "syscon",
            Subsystem::Other => "other",
        }
    }
}

/// One hot code region in the report: the region's base physical PC, its sample count, and its
/// share of all samples as a percentage.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct HotRegion {
    /// First byte of the 64-byte region (`region << REGION_SHIFT`).
    pub phys_pc: u64,
    /// Samples attributed to this region.
    pub samples: u32,
    /// `samples / sample_count * 100` — this region's share of the profile.
    pub pct: f64,
}

/// The assembled profile of a run: the ranked hot regions, per-subsystem nanoseconds, and the
/// bookkeeping totals (sampling denominator, page-walk count, histogram aliasing count).
#[derive(Debug, Clone, PartialEq)]
pub struct ProfReport {
    /// Hottest regions, already sorted descending by samples (see [`crate::prof::histogram`]).
    pub top_regions: Vec<HotRegion>,
    /// Wall nanoseconds attributed per subsystem (only non-empty ones are worth emitting, but all
    /// are carried so the order is stable).
    pub subsystem_ns: Vec<(Subsystem, u64)>,
    /// Total wall nanoseconds the run took (the profiled span), passed through by the caller.
    pub total_ns: u64,
    /// Total PC samples taken (the percentage denominator).
    pub sample_count: u64,
    /// Page-table walks performed over the run.
    pub walk_count: u64,
    /// Histogram aliasing count — non-zero ⇒ the hot list may be missing a region (see
    /// [`crate::prof::histogram::HotHistogram::collisions`]).
    pub collisions: u64,
    /// E4-T08: the block-discovery counters (blocks nominated / deduped / dropped-stale, queue
    /// depth + high-water mark). Filled by [`crate::Machine::prof_report`]; default/zero when a
    /// report is built directly off a [`super::ProfStats`] with no machine attached.
    pub discovery: crate::dispatch::DiscoveryStats,
    /// E4-T20: the JIT translation-cache accounting (usage vs budget, evictions, re-translation
    /// rate). `Some` only when [`crate::Machine::prof_report`] is called with an executor installed.
    pub jit_cache: Option<crate::jit::JitCacheStats>,
    /// E4-T21: JIT-attributable execution-thread pause instrumentation (compile-queue drains +
    /// executor submissions, and the headless per-submission work bound).
    pub jit_pause: crate::prof::JitPauseStats,
}

impl ProfReport {
    /// Human-readable ranked table, styled after [`crate::diag::irqstats::IrqStats::dump`]: a
    /// header line, the hot-region ranking (pc, samples, percent), then the non-zero per-subsystem
    /// times.
    pub fn to_text(&self) -> String {
        let mut s = String::new();
        s.push_str(&format!(
            "=== profile ===\ntotal_ns={}  samples={}  walks={}  collisions={}\n",
            self.total_ns, self.sample_count, self.walk_count, self.collisions
        ));
        s.push_str("hot regions (phys_pc: samples pct):\n");
        for (rank, r) in self.top_regions.iter().enumerate() {
            s.push_str(&format!(
                "  #{rank} {:#x}: {} {:.2}%\n",
                r.phys_pc, r.samples, r.pct
            ));
        }
        s.push_str("subsystem ns:");
        for (sub, ns) in &self.subsystem_ns {
            if *ns > 0 {
                s.push_str(&format!(" {}={}", sub.name(), ns));
            }
        }
        s.push('\n');
        let d = &self.discovery;
        s.push_str(&format!(
            "jit discovery: nominated={} deduped={} dropped_stale={} dropped_overflow={} queue={} hwm={} candidates={} gen={}\n",
            d.nominated, d.deduped, d.dropped_stale, d.dropped_overflow, d.queue_depth, d.queue_hwm, d.candidates, d.generation,
        ));
        if let Some(j) = &self.jit_cache {
            s.push_str(&format!(
                "jit cache: code_bytes={}/{} batches={}/{} evictions={} flushes={} installs={} retranslations={} rate={:.4} gen={}\n",
                j.code_bytes, j.budget.code_bytes, j.batches, j.budget.max_batches,
                j.evictions, j.flushes, j.installs, j.retranslations, j.retranslation_rate(), j.generation,
            ));
        }
        let p = &self.jit_pause;
        if p.count > 0 {
            s.push_str(&format!(
                "jit pause: samples={} max_ns={} mean_ns={} p95_ns={} over_5ms={} max_attempted_blocks={} max_submitted_blocks={} max_submitted_bytes={} run_count={} last_run_attempted={} max_run_attempted={} last_run_submitted={} max_run_submitted={} last_run_staged={} max_run_staged={} last_final_pumps={} max_final_pumps={} last_final_attempted={} max_final_attempted={} last_final_submitted={} max_final_submitted={}\n",
                p.count, p.max_ns, p.mean_ns(), p.percentile_ns(0.95), p.over_target,
                p.max_attempted_blocks, p.max_submitted_blocks, p.max_submitted_bytes, p.run_count,
                p.last_run_attempted_blocks, p.max_run_attempted_blocks,
                p.last_run_submitted_blocks, p.max_run_submitted_blocks,
                p.last_run_staged_nominations, p.max_run_staged_nominations, p.last_final_pumps,
                p.max_final_pumps, p.last_final_attempted_blocks, p.max_final_attempted_blocks,
                p.last_final_submitted_blocks, p.max_final_submitted_blocks,
            ));
        }
        s
    }

    /// Hand-rolled JSON (no `serde`) mirroring the repo's existing `PROFILE_JSON` line: a flat
    /// object with `regions` and `subsystems` arrays. Kept string-built so the `no_std` core needs
    /// no serialization dependency.
    pub fn to_json(&self) -> String {
        let mut regions = String::new();
        for r in &self.top_regions {
            if !regions.is_empty() {
                regions.push(',');
            }
            regions.push_str(&format!(
                "{{\"phys_pc\":\"{:#x}\",\"samples\":{},\"pct\":{:.2}}}",
                r.phys_pc, r.samples, r.pct
            ));
        }
        let mut subs = String::new();
        for (sub, ns) in &self.subsystem_ns {
            if !subs.is_empty() {
                subs.push(',');
            }
            subs.push_str(&format!("{{\"name\":\"{}\",\"ns\":{}}}", sub.name(), ns));
        }
        let d = &self.discovery;
        let discovery = format!(
            "{{\"nominated\":{},\"deduped\":{},\"dropped_stale\":{},\"dropped_overflow\":{},\"queue_depth\":{},\"queue_hwm\":{},\"candidates\":{},\"generation\":{}}}",
            d.nominated,
            d.deduped,
            d.dropped_stale,
            d.dropped_overflow,
            d.queue_depth,
            d.queue_hwm,
            d.candidates,
            d.generation,
        );
        let p = &self.jit_pause;
        let jit_pause = format!(
            "{{\"count\":{},\"max_ns\":{},\"sum_ns\":{},\"over_target\":{},\"max_attempted_blocks\":{},\"total_attempted_blocks\":{},\"max_submitted_blocks\":{},\"max_submitted_bytes\":{},\"total_submitted_blocks\":{},\"run_count\":{},\"last_run_attempted_blocks\":{},\"max_run_attempted_blocks\":{},\"last_run_submitted_blocks\":{},\"max_run_submitted_blocks\":{},\"last_run_staged_nominations\":{},\"max_run_staged_nominations\":{},\"last_final_pumps\":{},\"max_final_pumps\":{},\"last_final_attempted_blocks\":{},\"max_final_attempted_blocks\":{},\"last_final_submitted_blocks\":{},\"max_final_submitted_blocks\":{}}}",
            p.count,
            p.max_ns,
            p.sum_ns,
            p.over_target,
            p.max_attempted_blocks,
            p.total_attempted_blocks,
            p.max_submitted_blocks,
            p.max_submitted_bytes,
            p.total_submitted_blocks,
            p.run_count,
            p.last_run_attempted_blocks,
            p.max_run_attempted_blocks,
            p.last_run_submitted_blocks,
            p.max_run_submitted_blocks,
            p.last_run_staged_nominations,
            p.max_run_staged_nominations,
            p.last_final_pumps,
            p.max_final_pumps,
            p.last_final_attempted_blocks,
            p.max_final_attempted_blocks,
            p.last_final_submitted_blocks,
            p.max_final_submitted_blocks,
        );
        format!(
            "{{\"total_ns\":{},\"sample_count\":{},\"walk_count\":{},\"collisions\":{},\"regions\":[{}],\"subsystems\":[{}],\"discovery\":{},\"jit_pause\":{}}}",
            self.total_ns,
            self.sample_count,
            self.walk_count,
            self.collisions,
            regions,
            subs,
            discovery,
            jit_pause,
        )
    }
}
