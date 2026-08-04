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
        format!(
            "{{\"total_ns\":{},\"sample_count\":{},\"walk_count\":{},\"collisions\":{},\"regions\":[{}],\"subsystems\":[{}]}}",
            self.total_ns, self.sample_count, self.walk_count, self.collisions, regions, subs
        )
    }
}
