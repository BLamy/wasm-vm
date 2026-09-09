// Verifier-only addition to async_compile_pipeline.rs; relies on its unchanged local helpers.
#[test]
fn verifier_outer_scope_zero_work_final_pump_refreshes_only_after_budget_renewal() {
    let (mut oracle, mut bounded, installs, hot_pc) = priority_workload(32);
    bounded.begin_cooperative_run();
    advance_priority_pair(&mut oracle, &mut bounded, 31 + 3 * 2);
    assert_eq!(installs.borrow().len(), 8);
    for work in [3 * 11, 3 * 37, 3 * 131, 0] {
        advance_priority_pair(&mut oracle, &mut bounded, work);
        assert_eq!(installs.borrow().len(), 8, "internal run reopened exhausted budget");
    }
    bounded.end_cooperative_run(wasm_vm_core::RunOutcome::MaxInstrs);
    assert_eq!(installs.borrow().len(), 8, "outer close reopened exhausted budget");
    let first = bounded.prof_report(0, 0).jit_pause;
    assert_eq!(first.last_run_attempted_blocks, 8);
    assert_eq!(first.last_run_submitted_blocks, 8);
    assert_eq!(first.last_run_staged_nominations, 32);
    assert_eq!(first.last_final_pumps, 0);
    assert_eq!(bounded.hart().regs.read(5), 181);
    assert_eq!(bounded.discovery_stats().queue_depth, 0);
    let before = bounded.snapshot();
    let retired = bounded.irq_stats().retired;
    let generation = bounded.discovery_stats().generation;
    let deduped = bounded.discovery_stats().deduped;

    // Renew only the outer host scope: no guest entry and no new nomination can supply a refresh.
    bounded.begin_cooperative_run();
    advance_priority_pair(&mut oracle, &mut bounded, 0);
    assert_eq!(installs.borrow().len(), 8);
    bounded.end_cooperative_run(wasm_vm_core::RunOutcome::MaxInstrs);
    let second = bounded.prof_report(0, 0).jit_pause;
    assert_eq!(second.last_run_staged_nominations, 0);
    assert_eq!(second.last_run_attempted_blocks, 8);
    assert_eq!(second.last_run_submitted_blocks, 8);
    assert_eq!(second.last_final_pumps, 1);
    assert_eq!(second.last_final_attempted_blocks, 8);
    assert!(second.max_run_attempted_blocks <= 8);
    assert!(second.max_run_staged_nominations <= 64);
    assert_eq!(installs.borrow().len(), 16);
    assert_eq!(installs.borrow()[8].0, hot_pc, "zero-work final pump used stale priority");
    assert_eq!(bounded.snapshot(), before);
    assert_eq!(bounded.snapshot(), oracle.snapshot());
    assert_eq!(bounded.irq_stats().retired, retired);
    assert_eq!(bounded.discovery_stats().generation, generation);
    assert_eq!(bounded.discovery_stats().deduped, deduped);
    println!("L critic outer scope: inner runs stay at8; renewed zero-work final pump stages0/submits8; first={hot_pc:#x}; retired={retired}; RAM={}", bounded.snapshot().hex_digest());
}
