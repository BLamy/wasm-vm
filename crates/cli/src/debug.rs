//! Boot-debugging tooling (E2-T14): a PC histogram ("where is it spinning?"), a last-N
//! instruction ring ("what led up to the hang?"), and a no-forward-progress hang watchdog.
//! All three ride the existing [`TraceSink`] hook; the watchdog drives the run in quanta so
//! it can STOP a spinning guest (a sink can't halt the loop on its own).

use std::collections::HashMap;
use std::collections::VecDeque;

use wasm_vm_core::trace::{TraceRecord, TraceSink};

/// Captures a PC-frequency histogram and/or a ring buffer of the last N retired records.
/// Either is enabled independently; both are cheap enough to leave on across a full boot.
#[derive(Default)]
pub struct DebugSink {
    histogram: Option<HashMap<u64, u64>>,
    ring: Option<(VecDeque<(u64, u32)>, usize)>, // ((pc, raw_insn), capacity)
    /// Total retired — the watchdog's forward-progress signal.
    pub retired: u64,
}

impl DebugSink {
    pub fn new(histogram: bool, ring_capacity: Option<usize>) -> Self {
        Self {
            histogram: histogram.then(HashMap::new),
            ring: ring_capacity.map(|c| (VecDeque::with_capacity(c.min(1 << 20)), c)),
            retired: 0,
        }
    }

    /// Top-`n` hottest PCs, most-frequent first — the spin site is row 0.
    pub fn hottest(&self, n: usize) -> Vec<(u64, u64)> {
        let mut v: Vec<(u64, u64)> = self
            .histogram
            .as_ref()
            .map(|h| h.iter().map(|(&pc, &c)| (pc, c)).collect())
            .unwrap_or_default();
        // Deterministic: sort by count desc, then pc asc (ties never reorder run-to-run).
        v.sort_by(|a, b| b.1.cmp(&a.1).then(a.0.cmp(&b.0)));
        v.truncate(n);
        v
    }

    /// The captured last-N `(pc, raw_insn)` in chronological order.
    pub fn last_trace(&self) -> Vec<(u64, u32)> {
        self.ring
            .as_ref()
            .map(|(dq, _)| dq.iter().copied().collect())
            .unwrap_or_default()
    }
}

impl TraceSink for DebugSink {
    fn retire(&mut self, r: &TraceRecord) {
        self.retired = self.retired.wrapping_add(1);
        if let Some(h) = self.histogram.as_mut() {
            *h.entry(r.pc).or_insert(0) += 1;
        }
        if let Some((dq, cap)) = self.ring.as_mut() {
            if dq.len() == *cap {
                dq.pop_front();
            }
            dq.push_back((r.pc, r.insn));
        }
    }
}

/// Outcome of a watchdog-driven run.
pub enum WatchdogResult {
    /// The run ended normally (exit/trap/budget) after `retired` instructions.
    Ended(wasm_vm_core::RunOutcome, u64),
    /// A quantum made NO forward progress (pc + integer registers unchanged) — a spin/hang.
    Hang { pc: u64, retired: u64 },
}

/// A cheap forward-progress fingerprint: pc + a fold of the 31 integer registers. A tight
/// self-loop (`1: j 1b`) leaves this identical across a whole quantum; any real boot changes
/// it. (Deliberately ignores memory/CSRs — a `j .` touches neither, and hashing RAM every
/// quantum would dwarf the boot.)
fn progress_fingerprint(m: &wasm_vm_core::Machine) -> u64 {
    let regs = &m.hart().regs;
    let mut h = regs.pc;
    for i in 1..32u8 {
        h = h.rotate_left(7) ^ regs.read(i);
    }
    h
}

/// Run with the hang watchdog: execute `quantum` instructions at a time (feeding `sink`), and
/// declare a hang the first time a full quantum leaves the progress fingerprint unchanged.
/// `max_instrs` still bounds the whole run.
pub fn run_with_watchdog(
    m: &mut wasm_vm_core::Machine,
    sink: &mut DebugSink,
    quantum: u64,
    max_instrs: u64,
) -> WatchdogResult {
    use wasm_vm_core::RunOutcome;
    let q = quantum.max(1);
    let mut total = 0u64;
    let mut last_fp = progress_fingerprint(m);
    while total < max_instrs {
        let step = q.min(max_instrs - total);
        let before = sink.retired;
        let outcome = m.run_traced(step, sink);
        let ran = sink.retired - before;
        total += ran;
        if !matches!(outcome, RunOutcome::MaxInstrs) {
            return WatchdogResult::Ended(outcome, total);
        }
        let fp = progress_fingerprint(m);
        // A full quantum retired but the fingerprint didn't move → spinning in place.
        if ran >= step && fp == last_fp {
            return WatchdogResult::Hang {
                pc: m.hart().regs.pc,
                retired: total,
            };
        }
        last_fp = fp;
    }
    WatchdogResult::Ended(RunOutcome::MaxInstrs, total)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn rec(pc: u64, insn: u32) -> TraceRecord {
        TraceRecord {
            pc,
            insn,
            rd: None,
            mem: None,
        }
    }

    #[test]
    fn histogram_ranks_hottest_first() {
        let mut s = DebugSink::new(true, None);
        for _ in 0..5 {
            s.retire(&rec(0x80, 0x13));
        }
        for _ in 0..2 {
            s.retire(&rec(0x90, 0x13));
        }
        s.retire(&rec(0xA0, 0x13));
        let hot = s.hottest(2);
        assert_eq!(hot, vec![(0x80, 5), (0x90, 2)]);
        assert_eq!(s.retired, 8);
    }

    #[test]
    fn ring_keeps_last_n() {
        let mut s = DebugSink::new(false, Some(3));
        for i in 0..10u32 {
            s.retire(&rec(u64::from(i), i));
        }
        let last = s.last_trace();
        assert_eq!(last, vec![(7, 7), (8, 8), (9, 9)]);
    }
}
