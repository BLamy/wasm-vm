//! E5-T26k: actual cache/cursor/discovery and guest-state boundaries, not performance claims.
use super::*;
use alloc::rc::Rc;
use bus::{Bus, mmap::DRAM_BASE};
use csr::{Priv, SATP};
use hart::Exception;

fn machine(entries: usize) -> Machine {
    let mut m = Machine::new(64 * 1024);
    m.enable_clint(10);
    m.enable_plic();
    m.enable_uart16550();
    m.set_decoded_cache_entries(entries).unwrap();
    m.set_jit(true); // Real discovery without an executor; WASM tests exercise real compilation.
    m.set_hotness_threshold(2);
    for (i, word) in [0x0010_8093, 0x0011_0113, 0xff9f_f06f]
        .into_iter()
        .enumerate()
    {
        m.bus.store32(DRAM_BASE + i as u64 * 4, word).unwrap();
    }
    m.hart.regs.pc = DRAM_BASE;
    m
}

#[test]
fn default_and_legacy_pathological_sizes_report_actual_slots() {
    let mut m = Machine::new(0);
    assert_eq!(m.decoded_cache_entries(), 4096);
    for (requested, actual) in [(0, 1), (1, 1), (3, 4), (4095, 4096), (16383, 16384)] {
        m.set_block_cache_capacity(requested);
        assert_eq!(m.decoded_cache_entries(), actual);
    }
    for entries in [4096, 16384, 4096] {
        m.set_decoded_cache_entries(entries).unwrap();
        assert_eq!(m.block_cache.capacity(), entries);
    }
}

#[test]
fn invalid_and_same_actual_size_preserve_cursor_blocks_discovery_devices_and_snapshot() {
    for entries in [4096, 16384] {
        let mut m = machine(entries);
        assert_eq!(m.run(7), RunOutcome::MaxInstrs);
        assert!(m.block_cursor.is_some());
        assert!(m.discovery_stats().nominated > 0);
        m.bus.store32(DRAM_BASE + 0x2000, 0x1234_5678).unwrap();
        let blob = m.save_resume().unwrap();
        let cursor = m.block_cursor;
        let block = m.block_cache.get(DRAM_BASE).unwrap() as *const dispatch::DecodedBlock;
        let discovery = m.discovery_stats();
        let counters = m.block_cache_entry_stats();
        let pending = m.bus.code_write_log_mut().clone();
        let ram = m.ram_host_ptr();
        let clint = Rc::clone(m.clint.as_ref().unwrap());
        let plic = Rc::clone(m.plic.as_ref().unwrap());
        let uart = Rc::clone(&m.uart.as_ref().unwrap().0);
        for value in [0, 1, 3, 4095, 4097, 8192, 16383, 16385, usize::MAX, entries] {
            assert_eq!(m.set_decoded_cache_entries(value).is_ok(), value == entries);
            assert_eq!(m.decoded_cache_entries(), entries);
            assert_eq!(m.save_resume().unwrap(), blob);
            assert_eq!(m.block_cursor, cursor);
            assert_eq!(m.block_cache.get(DRAM_BASE).unwrap() as *const _, block);
            assert_eq!(m.discovery_stats(), discovery);
            assert_eq!(m.block_cache_entry_stats(), counters);
            assert_eq!(m.bus.code_write_log_mut(), &pending);
            assert_eq!(m.ram_host_ptr(), ram);
            assert!(Rc::ptr_eq(m.clint.as_ref().unwrap(), &clint));
            assert!(Rc::ptr_eq(m.plic.as_ref().unwrap(), &plic));
            assert!(Rc::ptr_eq(&m.uart.as_ref().unwrap().0, &uart));
        }
    }
}

#[test]
fn real_resize_clears_live_cursor_and_discovery_but_preserves_architecture_and_handles() {
    for (old, new) in [(4096, 16384), (16384, 4096)] {
        let mut m = machine(old);
        assert_eq!(m.run(7), RunOutcome::MaxInstrs);
        let requests = m.take_translation_requests();
        assert!(!requests.is_empty());
        let generation = m.discovery_stats().generation;
        let ram = m.ram_host_ptr();
        let clint = Rc::clone(m.clint.as_ref().unwrap());
        let plic = Rc::clone(m.plic.as_ref().unwrap());
        let uart = Rc::clone(&m.uart.as_ref().unwrap().0);
        m.bus.store32(DRAM_BASE + 0x2000, 0xaabb_ccdd).unwrap();
        assert!(!m.bus.code_write_log_mut().is_empty());
        let blob = m.save_resume().unwrap();
        m.set_decoded_cache_entries(new).unwrap();
        assert_eq!(m.decoded_cache_entries(), new);
        assert_eq!(
            m.save_resume().unwrap(),
            blob,
            "register/RAM/clock/device bytes changed"
        );
        assert_eq!(m.ram_host_ptr(), ram);
        assert!(Rc::ptr_eq(m.clint.as_ref().unwrap(), &clint));
        assert!(Rc::ptr_eq(m.plic.as_ref().unwrap(), &plic));
        assert!(Rc::ptr_eq(&m.uart.as_ref().unwrap().0, &uart));
        assert!(m.block_cursor.is_none());
        assert_eq!(m.block_cache.live_blocks().count(), 0);
        assert_eq!(m.block_cache_entry_stats(), (0, 0));
        assert!(m.bus.code_write_log_mut().is_empty());
        assert_eq!(m.discovery_stats().generation, generation + 1);
        assert!(m.take_translation_requests().is_empty());
        assert!(m.block_cache_enabled());
        assert_eq!(m.discovery.threshold(), 2);
        for request in requests {
            assert!(!m.discovery_install_check(&request, &request.code_bytes));
        }
        let before = clint.borrow().mtime;
        assert_eq!(m.run(10), RunOutcome::MaxInstrs);
        assert_eq!(
            clint.borrow().mtime,
            before + 1,
            "original device remains live"
        );
        assert!(m.block_cache_entry_stats().1 > 0);
    }
}

#[test]
fn restore_and_existing_cache_reset_hold_host_selection_without_new_snapshot_fields() {
    for entries in [4096, 16384] {
        let mut source = machine(4096);
        assert_eq!(source.run(7), RunOutcome::MaxInstrs);
        let snapshot = source.save_resume().unwrap();
        source.set_decoded_cache_entries(16384).unwrap();
        assert_eq!(
            source.save_resume().unwrap(),
            snapshot,
            "capacity leaked into snapshot wire format"
        );
        let mut target = machine(entries);
        assert_eq!(target.run(13), RunOutcome::MaxInstrs);
        target.load_resume(&snapshot).unwrap();
        assert_eq!(target.decoded_cache_entries(), entries);
        assert_eq!(target.save_resume().unwrap(), snapshot);
        assert!(target.block_cursor.is_none());
        assert_eq!(target.block_cache.live_blocks().count(), 0);
        assert_eq!(target.run(3), RunOutcome::MaxInstrs);
        target.set_block_cache(false);
        target.set_block_cache(true);
        assert_eq!(target.decoded_cache_entries(), entries);
        assert_eq!(target.block_cache.live_blocks().count(), 0);
    }
}

#[test]
fn both_sizes_keep_physical_aliases_and_page_write_cursor_invalidation() {
    for entries in [4096, 16384] {
        let mut m = machine(entries);
        // Two Sv39 level-1 aliases of the same aligned 2MiB physical superpage.
        let root = DRAM_BASE + 0x3000;
        let table = root + 0x1000;
        m.bus.store64(root, ((table >> 12) << 10) | 1).unwrap();
        for va in [0x1000_0000u64, 0x2000_0000] {
            m.bus
                .store64(
                    table + ((va >> 21) & 511) * 8,
                    ((DRAM_BASE >> 12) << 10) | 0x4b,
                )
                .unwrap(); // V/R/X/A
        }
        m.bus.store32(DRAM_BASE, 0x0000_006f).unwrap(); // jal x0,0
        m.hart.csr.pmp.allow_all();
        m.hart
            .csr
            .access(
                SATP,
                csr::CsrOp::Write,
                (8 << 60) | (root >> 12),
                false,
                false,
                0,
            )
            .unwrap();
        m.hart.csr.mode = Priv::S;
        m.hart.regs.pc = 0x1000_0000;
        assert_eq!(m.run(1), RunOutcome::MaxInstrs);
        m.hart.regs.pc = 0x2000_0000;
        assert_eq!(m.run(1), RunOutcome::MaxInstrs);
        assert_eq!(m.block_cache_entry_stats(), (1, 1));
        assert_eq!(m.hart.regs.pc, 0x2000_0000);
        // Same logged bus store used by DMA must invalidate the physical block under both aliases.
        m.bus.store32(DRAM_BASE, 0x0090_0293).unwrap(); // addi x5,x0,9
        assert_eq!(m.run(1), RunOutcome::MaxInstrs);
        assert_eq!(m.hart.regs.read(5), 9);
        assert_eq!(m.block_cache_entry_stats().1, 2);
        assert!(m.discovery_stats().blocks_discarded > 0);
    }
}

#[test]
fn both_sizes_recheck_revoked_pmp_for_live_cached_interior() {
    for entries in [4096, 16384] {
        let mut m = machine(entries);
        m.hart.csr.pmp.write_addr(0, (DRAM_BASE + 4) >> 2);
        m.hart.csr.pmp.write_addr(1, (DRAM_BASE + 0x1000) >> 2);
        m.hart.csr.pmp.write_cfg(0, 0x0d0d); // TOR R/X at entry and interior.
        m.hart.csr.mode = Priv::S;
        assert_eq!(m.run(3), RunOutcome::MaxInstrs);
        m.hart.csr.pmp.write_cfg(0, 0x090d); // Interior loses X; entry retains X.
        m.hart.regs.write(1, 0);
        m.hart.regs.write(2, 0);
        m.hart.regs.pc = DRAM_BASE;
        let RunOutcome::Trapped(trap) = m.run(2) else {
            panic!("denied interior executed")
        };
        assert_eq!(trap.cause, Exception::InstrAccessFault);
        assert_eq!(trap.tval, DRAM_BASE + 4);
        assert_eq!(m.hart.regs.read(1), 1);
        assert_eq!(m.hart.regs.read(2), 0);
    }
}

#[test]
fn hostile_guest_store_patches_next_cached_op_with_legacy_trace_parity() {
    let execute = |entries: Option<usize>| {
        let mut m = machine(entries.unwrap_or(4096));
        m.set_block_cache(entries.is_some());
        // sw x5,4(x4); addi x1,x0,1; jal x0,0. Store patches the NEXT decoded op to addi 9.
        for (i, word) in [0x0052_2223, 0x0010_0093, 0x0000_006f]
            .into_iter()
            .enumerate()
        {
            m.bus.store32(DRAM_BASE + i as u64 * 4, word).unwrap();
        }
        m.hart.regs.write(4, DRAM_BASE);
        m.hart.regs.write(5, 0x0090_0093);
        let mut trace = trace::HashSink::new();
        assert_eq!(m.run_traced(20, &mut trace), RunOutcome::MaxInstrs);
        assert_eq!(m.hart.regs.read(1), 9);
        (trace.hash(), trace.retired(), m.save_resume().unwrap())
    };
    let reference = execute(None);
    println!(
        "E5-T26k hostile SMC trace: legacy hash={:016x} retired={}",
        reference.0, reference.1
    );
    for entries in [4096, 16384] {
        assert_eq!(execute(Some(entries)), reference);
        println!("E5-T26k capacity={entries}: trace/retirement/snapshot identical to legacy");
    }
}
