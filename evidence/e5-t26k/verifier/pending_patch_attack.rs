// Included only into the verifier's scratch decoded_cache_capacity_tests module.
// Independent next-op oracle: execute the newly stored addi x2,x0,imm, not cached addi x2,x2,1.
#[test]
fn verifier_pending_code_patch_survives_same_size_and_rejected_selection() {
    for entries in [4096, 16384] {
        for selection in [entries, 8192] {
            for immediate in [7u32, 127, 1021] {
                let mut m = machine(entries);
                assert_eq!(m.run(7), RunOutcome::MaxInstrs);
                assert_eq!(m.hart.regs.pc, DRAM_BASE + 4);
                assert!(m.block_cursor.is_some());
                let cursor = m.block_cursor;
                let counters = m.block_cache_entry_stats();
                let discovery = m.discovery_stats();
                let x1 = m.hart.regs.read(1);
                let old_x2 = m.hart.regs.read(2);
                assert_ne!(old_x2 + 1, u64::from(immediate));
                m.bus.store32(DRAM_BASE + 4, (immediate << 20) | 0x113).unwrap();
                let pending = m.bus.code_write_log_mut().clone();
                assert!(!pending.is_empty());
                let saved = m.save_resume().unwrap();
                assert_eq!(m.set_decoded_cache_entries(selection).is_ok(), selection == entries);
                assert_eq!(m.block_cursor, cursor);
                assert_eq!(m.block_cache_entry_stats(), counters);
                assert_eq!(m.discovery_stats(), discovery);
                assert_eq!(m.bus.code_write_log_mut(), &pending);
                assert_eq!(m.save_resume().unwrap(), saved);
                assert_eq!(m.decoded_cache_entries(), entries);
                let mut trace = trace::HashSink::new();
                assert_eq!(m.run_traced(1, &mut trace), RunOutcome::MaxInstrs);
                assert_eq!(trace.retired(), 1);
                assert_eq!(m.hart.regs.read(2), u64::from(immediate));
                assert_eq!(m.hart.regs.read(1), x1);
                assert_eq!(m.hart.regs.pc, DRAM_BASE + 8);
                assert!(m.discovery_stats().blocks_discarded > discovery.blocks_discarded);
                println!("K critic pending patch: entries={entries} selection={selection} immediate={immediate} x2={} trace={:016x} retired={}", m.hart.regs.read(2), trace.hash(), trace.retired());
            }
        }
    }
}
