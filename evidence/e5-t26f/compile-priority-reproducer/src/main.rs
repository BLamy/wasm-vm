//! Source-level queue composition only: no Machine execution, browser or performance verdict.
use wasm_vm_core::compile_queue::{CompileJob, CompileQueue};
use wasm_vm_core::decode::decode;
use wasm_vm_core::dispatch::{BlockDiscovery, MicroOp};

fn main() {
    const EARLIER: u64 = 0x8000_1000;
    const LATER: u64 = 0x8000_2000;
    const EXTRA_ENTRIES: u32 = 1_000;
    let raw = 0x0000_006f; // Actual decoder: jal x0, 0, a supported terminator.
    let ops = [MicroOp { instr: decode(raw).unwrap(), len: 4, raw }];
    let mut discovery = BlockDiscovery::new();
    let mut queue = CompileQueue::default();
    let threshold = discovery.threshold();
    let generation = discovery.generation();
    println!("scope=source-level-public-types-only acceptance=false browser_causality=unproven");
    println!("threshold={threshold} compile_queue_cap={} generation={generation}", queue.cap());

    // Both candidates reach the unchanged threshold, earlier first, with equal live hotness.
    for pc in [EARLIER, LATER] {
        for _ in 0..threshold {
            discovery.on_block_entry(pc, &ops);
        }
    }
    assert_eq!(discovery.stats().nominated, 2);
    let staged = discovery.take_requests_bounded(64);
    assert_eq!(staged.iter().map(|req| req.phys_pc).collect::<Vec<_>>(), [EARLIER, LATER]);
    // The same public API sequence as Machine::pump_jit_translations' staging loop.
    // This does not invoke that private function or model its complete run scheduling.
    for req in staged {
        assert_eq!(req.code_bytes, raw.to_le_bytes());
        assert_eq!(req.generation, generation);
        let hotness = discovery.queued_hotness(req.phys_pc);
        assert_eq!(hotness, threshold);
        println!("staged pc=0x{:x} stored_hotness={hotness}", req.phys_pc);
        queue.push(CompileJob { req, hotness });
    }
    assert_eq!(discovery.queue_len(), 0);
    assert_eq!(queue.len(), 2);

    // Execution observations continue after staging; no queue refresh/re-push or mutation seam.
    for _ in 0..EXTRA_ENTRIES {
        discovery.on_block_entry(LATER, &ops);
    }
    let earlier_live = discovery.queued_hotness(EARLIER);
    let later_live = discovery.queued_hotness(LATER);
    assert_eq!(earlier_live, threshold);
    assert_eq!(later_live, threshold + EXTRA_ENTRIES);
    assert_eq!(discovery.stats().deduped, u64::from(EXTRA_ENTRIES));
    assert_eq!(discovery.stats().nominated, 2);
    assert_eq!(discovery.generation(), generation);
    assert_eq!(discovery.queue_len(), 0);
    assert_eq!(queue.cancel_stale(generation), 0);
    println!("after_extra_entries={EXTRA_ENTRIES} earlier_live={earlier_live} later_live={later_live}");
    println!("discovery_nominated={} discovery_deduped={} discovery_queue_depth={}",
        discovery.stats().nominated, discovery.stats().deduped, discovery.queue_len());

    let first = queue.pop_hottest().unwrap();
    let second = queue.pop_hottest().unwrap();
    for (index, job) in [&first, &second].into_iter().enumerate() {
        println!("pop={} pc=0x{:x} stored_hotness={} live_hotness={}", index + 1,
            job.req.phys_pc, job.hotness, discovery.queued_hotness(job.req.phys_pc));
        assert_eq!(job.hotness, threshold);
        assert!(discovery.install_check(&job.req, &raw.to_le_bytes()));
    }
    assert_eq!(first.req.phys_pc, EARLIER);
    assert_eq!(second.req.phys_pc, LATER);
    assert!(queue.is_empty());
    assert!(queue.take_recount().is_empty());
    assert_eq!(queue.stats().admitted, 2);
    assert_eq!(queue.stats().popped, 2);
    assert_eq!(queue.stats().dropped_backpressure, 0);
    assert_eq!(queue.stats().cancelled_stale, 0);
    assert_eq!(discovery.stats().dropped_stale, 0);
    assert_eq!(discovery.stats().dropped_overflow, 0);
    println!("reproduced=true stored_tie_pops_earlier_despite_later_live_hotness_increase=true");
    println!("limits=no guest execution; no browser cause, E4 acceptance violation, or timing claim");
}
