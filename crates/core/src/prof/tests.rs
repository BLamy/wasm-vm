//! Deterministic unit tests for the profiling core (E4-T01 phase 1). No host clock, no sampling
//! (stride/anti-alias sampling lives in the run loop — a LATER phase — and is not tested here).

use super::histogram::{HotHistogram, REGION_SHIFT, SIZE};
use super::*;

/// The slot index the histogram uses — duplicated here (the real one is private) so a test can
/// deliberately construct a colliding pair.
fn index_of(region: u64) -> usize {
    const GOLDEN64: u64 = 0x9E3779B97F4A7C15;
    const LOG2_SIZE: u32 = 13;
    (region.wrapping_mul(GOLDEN64) >> (64 - LOG2_SIZE)) as usize
}

/// Two DISTINCT regions that hash to the same slot index — found by brute-force scan so the test
/// is self-contained and deterministic.
fn colliding_regions() -> (u64, u64) {
    let target = index_of(1);
    for r in 2..1_000_000u64 {
        if index_of(r) == target {
            return (1, r);
        }
    }
    panic!("no colliding region found in scan range");
}

#[test]
fn records_land_in_expected_64_byte_regions() {
    let mut h = HotHistogram::new();
    // Two PCs 0x1000 and 0x1020 are within one 64-byte region (0x1000..0x1040); 0x1040 is the
    // next region.
    h.record(0x1000);
    h.record(0x1020);
    h.record(0x1040);
    let top = h.top(8);
    assert_eq!(h.samples(), 3);
    // Region base for 0x1000/0x1020 is 0x1000 with count 2; 0x1040 is its own region, count 1.
    assert!(
        top.contains(&(0x1000, 2)),
        "0x1000+0x1020 share region: {top:?}"
    );
    assert!(
        top.contains(&(0x1040, 1)),
        "0x1040 is a separate region: {top:?}"
    );
    // Region base is region << REGION_SHIFT — sanity-check the shift constant.
    assert_eq!(0x1000u64 >> REGION_SHIFT << REGION_SHIFT, 0x1000);
}

#[test]
fn tight_loop_concentrates() {
    let mut h = HotHistogram::new();
    // A tight loop bouncing between two PCs inside ONE region dominates the histogram.
    for _ in 0..1000 {
        h.record(0x2000);
        h.record(0x2008);
    }
    // A few scattered other regions.
    h.record(0x9000);
    h.record(0xA000);
    let top = h.top(3);
    assert_eq!(
        top[0],
        (0x2000, 2000),
        "the hot loop region tops the list: {top:?}"
    );
    assert!(top[0].1 > top[1].1 * 100, "hot region dwarfs the rest");
}

#[test]
fn top_is_descending_with_low_pc_tie_break() {
    let mut h = HotHistogram::new();
    // Region 0x4000 gets 3, 0x5000 and 0x6000 each get 1 (a tie the lower pc wins).
    for _ in 0..3 {
        h.record(0x4000);
    }
    h.record(0x6000);
    h.record(0x5000);
    let top = h.top(8);
    assert_eq!(top[0], (0x4000, 3), "highest count first");
    // Ties (count 1) ordered by lower pc first regardless of insertion order.
    assert_eq!(top[1], (0x5000, 1));
    assert_eq!(top[2], (0x6000, 1));
}

#[test]
fn collisions_are_visible_not_silently_merged() {
    let (a, b) = colliding_regions();
    assert_ne!(a, b);
    assert_eq!(index_of(a), index_of(b), "constructed regions must alias");
    let pa = a << REGION_SHIFT;
    let pb = b << REGION_SHIFT;
    let mut h = HotHistogram::new();
    // Region A becomes hot (well above the evict threshold) and OWNS the slot.
    for _ in 0..100 {
        h.record(pa);
    }
    // Region B now hammers the same slot: A holds, B is recorded as collisions — NOT merged into
    // A's count and NOT overwriting A.
    for _ in 0..50 {
        h.record(pb);
    }
    assert_eq!(
        h.collisions(),
        50,
        "every aliased B record is a visible collision"
    );
    let top = h.top(8);
    assert_eq!(top.len(), 1, "only A occupies its slot; B never got one");
    assert_eq!(
        top[0],
        (pa, 100),
        "A's count is uncorrupted by B's aliasing"
    );
}

#[test]
fn weak_incumbent_is_evicted_by_newcomer() {
    let (a, b) = colliding_regions();
    let pa = a << REGION_SHIFT;
    let pb = b << REGION_SHIFT;
    let mut h = HotHistogram::new();
    // A is a weak squatter (count 1 <= threshold 2) → B evicts it.
    h.record(pa);
    h.record(pb);
    let top = h.top(8);
    assert_eq!(
        top,
        alloc::vec![(pb, 1)],
        "weak A evicted, B owns the slot: {top:?}"
    );
    assert_eq!(h.collisions(), 0, "eviction is not a collision");
}

#[test]
fn histogram_memory_is_fixed() {
    // The table is SIZE slots regardless of how many distinct PCs are recorded — a bound check.
    let mut h = HotHistogram::new();
    for pc in 0..(SIZE as u64 * 4) {
        h.record(pc << (REGION_SHIFT + 4)); // spread across many regions
    }
    // top() never returns more than SIZE live entries.
    assert!(h.top(usize::MAX).len() <= SIZE);
}

#[test]
fn add_ns_accumulates_per_subsystem() {
    let mut p = ProfStats::new();
    p.add_ns(Subsystem::MmuWalk, 100);
    p.add_ns(Subsystem::MmuWalk, 50);
    p.add_ns(Subsystem::Uart, 7);
    let rep = p.report(0, 4);
    let mmu = rep
        .subsystem_ns
        .iter()
        .find(|(s, _)| *s == Subsystem::MmuWalk)
        .unwrap()
        .1;
    let uart = rep
        .subsystem_ns
        .iter()
        .find(|(s, _)| *s == Subsystem::Uart)
        .unwrap()
        .1;
    let clint = rep
        .subsystem_ns
        .iter()
        .find(|(s, _)| *s == Subsystem::Clint)
        .unwrap()
        .1;
    assert_eq!(mmu, 150, "MmuWalk accumulates exactly");
    assert_eq!(uart, 7);
    assert_eq!(clint, 0, "untouched subsystems stay zero");
}

#[test]
fn report_computes_pct_and_passes_total_through() {
    let mut p = ProfStats::new();
    // 3 samples in region 0x1000, 1 in 0x2000 → 75% / 25%.
    for _ in 0..3 {
        p.record_pc(0x1000);
    }
    p.record_pc(0x2000);
    p.note_walk();
    p.note_walk();
    let rep = p.report(999, 4);
    assert_eq!(rep.total_ns, 999, "total_ns passes straight through");
    assert_eq!(rep.sample_count, 4);
    assert_eq!(rep.walk_count, 2);
    assert_eq!(rep.top_regions[0].phys_pc, 0x1000);
    assert!((rep.top_regions[0].pct - 75.0).abs() < 1e-9, "3/4 = 75%");
    assert!((rep.top_regions[1].pct - 25.0).abs() < 1e-9, "1/4 = 25%");
    // Subsystems are emitted in ALL order.
    assert_eq!(rep.subsystem_ns.len(), Subsystem::ALL.len());
    assert_eq!(rep.subsystem_ns[0].0, Subsystem::CpuInterp);
}

#[test]
fn report_on_empty_profile_does_not_divide_by_zero() {
    let p = ProfStats::new();
    let rep = p.report(0, 4);
    assert!(rep.top_regions.is_empty());
    assert_eq!(rep.sample_count, 0);
}

#[test]
fn fixed_timer_reflects_set_and_advance_monotonically() {
    let t = FixedTimer::new(1000);
    assert_eq!(t.now_ns(), 1000);
    t.set(5000);
    assert_eq!(t.now_ns(), 5000);
    let before = t.now_ns();
    t.advance(250);
    assert_eq!(t.now_ns(), 5250);
    assert!(
        t.now_ns() >= before,
        "advance is non-decreasing (monotonic)"
    );
}

#[test]
fn report_text_contains_pc_and_subsystem_names() {
    let mut p = ProfStats::new();
    for _ in 0..4 {
        p.record_pc(0xDEAD00);
    }
    p.add_ns(Subsystem::VirtioBlk, 42);
    let text = p.report(1234, 4).to_text();
    assert!(
        text.contains("0xdead00"),
        "text names the hot region pc: {text}"
    );
    assert!(
        text.contains("virtio_blk=42"),
        "text names the subsystem: {text}"
    );
    assert!(text.contains("total_ns=1234"));
}

#[test]
fn report_json_shape_and_contents() {
    let mut p = ProfStats::new();
    for _ in 0..4 {
        p.record_pc(0xBEEF00);
    }
    p.add_ns(Subsystem::Clint, 9);
    let json = p.report(77, 4).to_json();
    // Shape sanity via string checks (no serde in core).
    assert!(
        json.starts_with('{') && json.ends_with('}'),
        "is a JSON object: {json}"
    );
    assert!(json.contains("\"total_ns\":77"));
    assert!(json.contains("\"regions\":["));
    assert!(json.contains("\"subsystems\":["));
    assert!(json.contains("0xbeef00"), "top region pc present: {json}");
    assert!(
        json.contains("\"name\":\"clint\",\"ns\":9"),
        "subsystem present: {json}"
    );
    // Balanced braces — a crude but effective malformed-JSON guard.
    assert_eq!(
        json.chars().filter(|&c| c == '{').count(),
        json.chars().filter(|&c| c == '}').count(),
        "braces balance: {json}"
    );
}
