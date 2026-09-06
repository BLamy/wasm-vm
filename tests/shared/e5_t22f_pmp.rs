// Shared native/actual-Wasm guest fixtures, using production core code in both.
use wasm_vm_core::bus::{Bus, mmap::DRAM_BASE};
use wasm_vm_core::csr::{CsrOp, Csrs, MEDELEG, Priv, SEPC, STVEC};
use wasm_vm_core::hart::{Exception, Trap};
use wasm_vm_core::resume::ComponentSnapshot;
use wasm_vm_core::trace::{HashSink, TraceRecord, TraceSink, fmt_canonical};
use wasm_vm_core::{Machine, RunOutcome};

fn csr(c: &mut Csrs, addr: u16, value: u64) {
    let mode = c.mode;
    c.mode = Priv::M;
    c.access(addr, CsrOp::Write, value, false, false, 0)
        .unwrap();
    c.mode = mode;
}
fn poke(m: &mut Machine, base: u64, words: &[u32]) {
    for (i, word) in words.iter().enumerate() {
        m.bus_mut().store32(base + i as u64 * 4, *word).unwrap();
    }
}
#[derive(Default)]
struct Recording {
    records: Vec<TraceRecord>,
    hash: HashSink,
}
impl TraceSink for Recording {
    fn retire(&mut self, record: &TraceRecord) {
        self.records.push(*record);
        self.hash.retire(record);
    }
}

pub fn su_machine(cache: Option<usize>) -> Machine {
    let mut m = Machine::new(1024 * 1024);
    // U: addi x5,x5,1; ecall; jal x0,-8.
    poke(&mut m, DRAM_BASE, &[0x00128293, 0x00000073, 0xff9ff06f]);
    // S trap handler: csrr x6,sepc; addi x6,x6,4; csrw sepc,x6; sret.
    poke(
        &mut m,
        DRAM_BASE + 0x100,
        &[0x14102373, 0x00430313, 0x14131073, 0x10200073],
    );
    m.hart_mut().csr.pmp.allow_all();
    csr(&mut m.hart_mut().csr, MEDELEG, 1 << 8);
    csr(&mut m.hart_mut().csr, STVEC, DRAM_BASE + 0x100);
    csr(&mut m.hart_mut().csr, SEPC, DRAM_BASE);
    m.hart_mut().csr.mode = Priv::S;
    m.hart_mut().regs.pc = DRAM_BASE + 0x10c; // first guest operation is SRET to U
    if let Some(capacity) = cache {
        m.set_block_cache_capacity(capacity);
    }
    m.set_block_cache(cache.is_some());
    m
}

pub fn su_guest_trace_parity() {
    // Frozen from the pre-change native run, not recomputed from the new cache
    // implementation. Actual Wasm must match these same complete trace hashes.
    for (turns, golden) in [
        (1, 0x1046a1baefeab5ca),
        (7, 0xbdacf09cb6d2a951),
        (37, 0xeac08f91a4e7b526),
        (191, 0x107b228d8e75d2b9),
    ] {
        let mut expected = su_machine(None);
        let mut reference = Recording::default();
        // ECALL traps without retiring, but consumes one bounded run-loop unit.
        let budget = 1 + turns * 7;
        assert_eq!(
            expected.run_traced(budget, &mut reference),
            RunOutcome::MaxInstrs
        );
        assert_eq!(expected.hart().regs.read(5), turns);
        assert_eq!(expected.hart().csr.mode, Priv::U);
        assert_eq!(expected.hart().regs.pc, DRAM_BASE);
        assert_eq!(reference.hash.retired(), 1 + turns * 6);
        assert_eq!(reference.hash.hash(), golden);
        for capacity in [1, 64, 1024] {
            let mut cached = su_machine(Some(capacity));
            let mut actual = Recording::default();
            assert_eq!(
                cached.run_traced(budget, &mut actual),
                RunOutcome::MaxInstrs
            );
            assert_eq!(
                actual.records, reference.records,
                "SRET/trap trace differs; capacity={capacity}"
            );
            assert_eq!(cached.hart().to_snapshot(), expected.hart().to_snapshot());
            assert_eq!(
                cached.snapshot().hex_digest(),
                expected.snapshot().hex_digest()
            );
            if capacity > 1 && turns > 1 {
                assert!(cached.block_cache_entry_stats().0 > 0);
            }
        }
        println!(
            "SU_TRACE turns={turns} retired={} hash={:016x} ram_sha256={}",
            reference.hash.retired(),
            reference.hash.hash(),
            expected.snapshot().hex_digest()
        );
        if turns == 1 {
            for record in &reference.records {
                println!("{}", fmt_canonical(record));
            }
        }
    }
}

pub fn su_revision_revocation() {
    for (from, to) in [(Priv::S, Priv::U), (Priv::U, Priv::S)] {
        for cache in [false, true] {
            let mut m = Machine::new(1024 * 1024);
            poke(&mut m, DRAM_BASE, &[0x00100293, 0x00100313, 0xff9ff06f]);
            m.hart_mut().csr.pmp.write_addr(0, (DRAM_BASE + 4) >> 2);
            m.hart_mut().csr.pmp.write_addr(1, (DRAM_BASE + 4096) >> 2);
            m.hart_mut().csr.pmp.write_cfg(0, 0x0d0d); // two RX TOR ranges
            m.hart_mut().csr.mode = from;
            m.hart_mut().regs.pc = DRAM_BASE;
            m.set_block_cache(cache);
            assert_eq!(m.run(3), RunOutcome::MaxInstrs);
            m.hart_mut().regs.write(5, 0);
            m.hart_mut().regs.write(6, 0);
            // Change both effective revision and S/U mode at the same boundary.
            m.hart_mut().csr.pmp.write_cfg(0, 0x090d); // interior R-only, entry still RX
            m.hart_mut().csr.mode = to;
            let mut trace = Recording::default();
            assert_eq!(
                m.run_traced(2, &mut trace),
                RunOutcome::Trapped(Trap {
                    cause: Exception::InstrAccessFault,
                    tval: DRAM_BASE + 4,
                })
            );
            assert_eq!(m.hart().regs.read(5), 1);
            assert_eq!(m.hart().regs.read(6), 0, "revoked cached interior executed");
            assert_eq!(trace.records.len(), 1);
            assert_eq!(trace.records[0].pc, DRAM_BASE);
            println!(
                "SU_REVOKE {from:?}->{to:?} cache={cache} retired={} hash={:016x} fault={:x}",
                trace.hash.retired(),
                trace.hash.hash(),
                DRAM_BASE + 4
            );
        }
    }
}

pub fn su_snapshot_and_host_sequence() {
    let mut a = su_machine(Some(64));
    assert_eq!(a.run(20), RunOutcome::MaxInstrs);
    let snapshot = a.save_resume().unwrap();
    let mut b = su_machine(Some(64));
    assert_eq!(b.run(39), RunOutcome::MaxInstrs);
    b.load_resume(&snapshot).unwrap();
    let mut uncached = su_machine(None);
    uncached.load_resume(&snapshot).unwrap();
    assert!(!uncached.block_cache_enabled());
    let mut x = Recording::default();
    let mut y = Recording::default();
    let mut oracle = Recording::default();
    for round in 0..1000 {
        // Host privilege changes between bounded run calls, without changing PMP.
        // Keep execution at a privilege-neutral loop to isolate this boundary.
        let mode = if round % 2 == 0 { Priv::U } else { Priv::S };
        for m in [&mut a, &mut b, &mut uncached] {
            m.hart_mut().csr.mode = mode;
            m.hart_mut().regs.pc = DRAM_BASE + 8; // JAL, then ADDI; stop before ECALL
        }
        assert_eq!(a.run_traced(2, &mut x), RunOutcome::MaxInstrs);
        assert_eq!(b.run_traced(2, &mut y), RunOutcome::MaxInstrs);
        assert_eq!(uncached.run_traced(2, &mut oracle), RunOutcome::MaxInstrs);
    }
    assert_eq!(x.records, y.records);
    assert_eq!(a.hart().to_snapshot(), b.hart().to_snapshot());
    assert_eq!(x.records, oracle.records);
    assert_eq!(a.hart().to_snapshot(), uncached.hart().to_snapshot());
    assert_eq!(a.snapshot().hex_digest(), b.snapshot().hex_digest());
    assert_eq!(a.snapshot().hex_digest(), uncached.snapshot().hex_digest());
    assert_eq!(x.hash.hash(), 0x8907ff1cb93090b5);
    println!(
        "SU_RESTORE retired={} hash={:016x} ram_sha256={}",
        x.hash.retired(),
        x.hash.hash(),
        a.snapshot().hex_digest()
    );
}

pub fn su_midblock_revision_revocation() {
    for (from, to) in [(Priv::S, Priv::U), (Priv::U, Priv::S)] {
        for cache in [false, true] {
            let mut m = Machine::new(1024 * 1024);
            poke(&mut m, DRAM_BASE, &[0x00100293, 0x00100313, 0xff9ff06f]);
            m.hart_mut().csr.pmp.write_addr(0, (DRAM_BASE + 4) >> 2);
            m.hart_mut().csr.pmp.write_addr(1, (DRAM_BASE + 4096) >> 2);
            m.hart_mut().csr.pmp.write_cfg(0, 0x0d0d);
            m.hart_mut().csr.mode = from;
            m.hart_mut().regs.pc = DRAM_BASE;
            m.set_block_cache(cache);
            m.set_interrupt_batching(cache);
            // Retain a decoded cursor aimed at the interior. Batching means the
            // next run does not perform a second block-boundary sync that could
            // hide a broken entry-sync revision guard.
            assert_eq!(m.run(1), RunOutcome::MaxInstrs);
            assert_eq!(m.hart().regs.pc, DRAM_BASE + 4);
            assert_eq!(m.hart().regs.read(5), 1);
            m.hart_mut().csr.pmp.write_cfg(0, 0x090d);
            m.hart_mut().csr.mode = to;
            let mut trace = Recording::default();
            assert_eq!(
                m.run_traced(1, &mut trace),
                RunOutcome::Trapped(Trap {
                    cause: Exception::InstrAccessFault,
                    tval: DRAM_BASE + 4,
                }),
                "denied mid-block instruction retired: {from:?}->{to:?}, cache={cache}"
            );
            assert_eq!(m.hart().regs.read(6), 0);
            assert_eq!(trace.hash.retired(), 0);
            println!(
                "SU_MIDBLOCK {from:?}->{to:?} cache={cache} retired=0 x6=0 fault={:x}",
                DRAM_BASE + 4
            );
        }
    }
}
