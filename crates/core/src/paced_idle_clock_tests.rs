//! Private-state refusal paths requested by the independent clock verifier.
use super::*;
use crate::bus::Bus;
use alloc::{boxed::Box, rc::Rc};
use core::cell::Cell;

#[derive(Clone, Default)]
struct Source {
    now: Rc<Cell<u64>>,
    reads: Rc<Cell<u64>>,
}
impl time::MonotonicClock for Source {
    fn now_nanos(&self) -> u64 {
        self.reads.set(self.reads.get() + 1);
        self.now.get()
    }
}

#[test]
fn paced_selection_refuses_invalid_private_phase_before_sampling_or_replacing_policy() {
    for (divider, residue) in [(0, 0), (7, 7), (7, 8)] {
        let mut m = Machine::new(4096);
        m.enable_clint(7);
        m.bus_mut()
            .store32(platform::virt::DRAM_BASE, 0x0000_006f)
            .unwrap();
        m.hart_mut().regs.pc = platform::virt::DRAM_BASE;
        m.bus_mut()
            .store64(platform::virt::CLINT_BASE + 0xbff8, 123_456)
            .unwrap();
        let old = Source::default();
        old.now.set(1_000_000_000);
        m.set_wall_clock(Box::new(old.clone()), time::WallClockPolicy::DEFAULT);
        m.last_time_jump = Some(time::TimeJump { from: 1, to: 2 });
        let before = alloc::format!("{:?}", m.wall_time);
        let old_reads = old.reads.get();
        m.clock_div = divider;
        m.tick_accum = residue;
        let refused = Source::default();
        refused.now.set(u64::MAX);
        assert_eq!(
            m.set_paced_icount_clock(Box::new(refused.clone())),
            Err("paced ICount requires a valid saved clock phase")
        );
        assert_eq!(refused.reads.get(), 0);
        assert_eq!(old.reads.get(), old_reads);
        assert_eq!(m.guest_clock_mode(), time::TimeMode::WallClock);
        assert_eq!(m.clint_mtime(), 123_456);
        assert_eq!((m.clock_div, m.tick_accum), (divider, residue));
        assert_eq!(alloc::format!("{:?}", m.wall_time), before);
        assert!(m.idle_pacer.is_none());
        assert_eq!(m.last_time_jump, Some(time::TimeJump { from: 1, to: 2 }));
        // Restore only the deliberately invalid test input. The previous actual
        // source/anchor must still drive a real guest retirement afterward.
        m.clock_div = 7;
        m.tick_accum = 0;
        old.now.set(1_001_000_000);
        let mut trace = trace::HashSink::new();
        assert_eq!(m.run_traced(1, &mut trace), RunOutcome::MaxInstrs);
        assert_eq!(m.clint_mtime(), 133_456);
        assert_eq!(refused.reads.get(), 0);
        std::eprintln!(
            "PACED_PRIVATE_REFUSAL divider={divider} residue={residue} new_reads=0 mode=wall mtime={} trace={:016x}",
            m.clint_mtime(),
            trace.hash()
        );
    }
}
