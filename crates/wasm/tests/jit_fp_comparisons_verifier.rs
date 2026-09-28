#![cfg(target_arch = "wasm32")]
use wasm_bindgen_test::*;
#[path = "../../../tests/support/jit_fp_comparisons_verifier.rs"]
mod proof;

fn private(_: &wasm_vm_core::Machine) -> Box<dyn wasm_vm_core::jit::CompiledBlockExecutor> {
    Box::new(wasm_vm_wasm::BrowserExecutor::new())
}
fn shared(m: &wasm_vm_core::Machine) -> Box<dyn wasm_vm_core::jit::CompiledBlockExecutor> {
    Box::new(wasm_vm_wasm::BrowserExecutor::new_inline(m).unwrap())
}

#[wasm_bindgen_test]
fn verifier_private_comparisons() {
    console_log!(
        "CRITIC_PRIVATE_GOLDENS {:?}",
        proof::literal_goldens(private, false)
    );
    console_log!(
        "CRITIC_PRIVATE_SEEDED {:?}",
        proof::seeded_aliases_and_fs(private, false)
    );
    console_log!(
        "CRITIC_PRIVATE_CONTROL {:?}",
        proof::control_handoff_and_faults(private, false)
    );
}

#[wasm_bindgen_test]
fn verifier_shared_comparisons() {
    console_log!(
        "CRITIC_SHARED_GOLDENS {:?}",
        proof::literal_goldens(shared, true)
    );
    console_log!(
        "CRITIC_SHARED_SEEDED {:?}",
        proof::seeded_aliases_and_fs(shared, true)
    );
    console_log!(
        "CRITIC_SHARED_CONTROL {:?}",
        proof::control_handoff_and_faults(shared, true)
    );
}

fn direct_successors(same_module: bool, fault: bool) {
    use wasm_vm_core::Machine;
    use wasm_vm_core::bus::mmap::DRAM_BASE;
    use wasm_vm_core::hart::{Exception, Trap};
    use wasm_vm_core::jit::{CompiledBlockExecutor, ExitCode};
    use wasm_vm_wasm::BrowserExecutor;
    let root = proof::block(
        DRAM_BASE,
        &[
            proof::comparison(1, 5, 1, 2), // qNaN < 1: false + NV
            0x0012_8713,                   // addi x14,x5,1
            0x0040_006f,
        ],
    );
    let successor = proof::block(
        DRAM_BASE + 12,
        &[
            proof::comparison(2, 31, 3, 4), // +0 == -0: true, no new flag
            if fault { 0x0003_3583 } else { 0x01f2_86b3 }, // ld x11,0(x6) / add x13,x5,x31
            0x0040_006f,
        ],
    );
    let mut machine = Machine::new(64 * 1024);
    let mut executor = BrowserExecutor::new_inline(&machine).unwrap();
    if same_module {
        executor.install_batch(&[root, successor], &[[Some(1), None], [None, None]]);
    } else {
        executor.install(&root);
        executor.install(&successor);
    }
    assert!(executor.is_compiled(DRAM_BASE));
    assert!(executor.is_compiled(DRAM_BASE + 12));
    proof::fs(&mut machine, 2);
    for (r, bits) in [
        (1, 0xffff_ffff_7fc0_4321),
        (2, 0xffff_ffff_3f80_0000),
        (3, 0xffff_ffff_0000_0000),
        (4, 0xffff_ffff_8000_0000),
    ] {
        machine.hart_mut().fregs.write_raw(r, bits);
    }
    let want_f = proof::fregs(&machine);
    machine.hart_mut().regs.write(6, 0x5000_0000);
    machine.hart_mut().regs.pc = DRAM_BASE;
    let ptr: *mut Machine = &mut machine;
    for budget in [2, 3, 6] {
        proof::fs(&mut machine, 1);
        machine.hart_mut().regs.pc = DRAM_BASE;
        if !same_module {
            // Warm the root authority without a direct call, then publish the target.
            unsafe {
                executor
                    .execute_with_budget(
                        DRAM_BASE,
                        (*ptr).hart_mut(),
                        (*ptr).bus_mut(),
                        64,
                        64,
                        false,
                    )
                    .unwrap();
            }
            executor.link_edge(DRAM_BASE, 0, DRAM_BASE + 12);
            assert_eq!(executor.linked_target(DRAM_BASE, 0), Some(DRAM_BASE + 12));
        }
        // The warm call dirties architectural FS. Restore its entry context
        // before the measured call so the already-published link stays valid.
        proof::fs(&mut machine, 1);
        machine.hart_mut().csr.fflags = 1;
        machine.hart_mut().csr.frm = 6;
        machine.hart_mut().regs.pc = DRAM_BASE;
        for r in [5, 11, 13, 14, 31] {
            machine.hart_mut().regs.write(r, 99);
        }
        let entries = executor.direct_chain_entries();
        let links = executor.direct_chain_links();
        // SAFETY: one synchronous call borrowing the Machine's disjoint components.
        let exit = unsafe {
            executor
                .execute_with_budget(
                    DRAM_BASE,
                    (*ptr).hart_mut(),
                    (*ptr).bus_mut(),
                    64,
                    budget,
                    true,
                )
                .unwrap()
        };
        let retired = if budget < 3 {
            0
        } else if budget < 6 {
            3
        } else if fault {
            4
        } else {
            6
        };
        let calls = if budget < 3 {
            0
        } else if budget < 6 {
            1
        } else {
            2
        };
        let pc = if budget < 3 {
            DRAM_BASE
        } else if budget < 6 {
            DRAM_BASE + 12
        } else if fault {
            DRAM_BASE + 16
        } else {
            DRAM_BASE + 24
        };
        assert_eq!(
            exit.code,
            if budget < 6 {
                ExitCode::Budget
            } else if fault {
                ExitCode::Trap
            } else {
                ExitCode::BranchTaken
            }
        );
        assert_eq!(exit.next_pc, pc);
        assert_eq!(exit.retired, retired);
        assert_eq!(executor.direct_chain_entries() - entries, calls);
        assert_eq!(
            executor.direct_chain_links() - links,
            u64::from(budget == 6)
        );
        assert_eq!(machine.hart().regs.read(5), if budget < 3 { 99 } else { 0 });
        assert_eq!(
            machine.hart().regs.read(14),
            if budget < 3 { 99 } else { 1 }
        );
        assert_eq!(
            machine.hart().regs.read(31),
            if budget < 6 { 99 } else { 1 }
        );
        assert_eq!(
            machine.hart().regs.read(13),
            if budget < 6 || fault { 99 } else { 1 }
        );
        assert_eq!(machine.hart().regs.read(11), 99);
        assert_eq!(machine.hart().csr.fflags, if budget < 3 { 1 } else { 17 });
        assert_eq!(machine.hart().csr.frm, 6);
        assert_eq!(machine.hart().csr.fs(), if budget < 3 { 1 } else { 3 });
        assert_eq!(proof::fregs(&machine), want_f);
        assert_eq!(
            exit.trap,
            if budget == 6 && fault {
                Some(Trap {
                    cause: Exception::LoadAccessFault,
                    tval: 0x5000_0000,
                })
            } else {
                None
            }
        );
        console_log!(
            "CRITIC_CHAIN same={} fault={} budget={} retired={} entries={} links={} pc={:016x} flags={:02x}",
            same_module,
            fault,
            budget,
            exit.retired,
            executor.direct_chain_entries() - entries,
            executor.direct_chain_links() - links,
            exit.next_pc,
            machine.hart().csr.fflags
        );
    }
    proof::interpreted(&mut machine, 0x0010_2573);
    assert_eq!(machine.hart().regs.read(10), 17);
}

#[wasm_bindgen_test]
fn verifier_same_module_comparison_successors() {
    direct_successors(true, false);
    direct_successors(true, true);
}

#[wasm_bindgen_test]
fn verifier_cross_module_comparison_successors() {
    direct_successors(false, false);
    direct_successors(false, true);
}

#[derive(Debug, Clone, Copy)]
enum GrowthFault {
    None,
    Store,
    Load,
}

struct GrowOnStore {
    memory: js_sys::WebAssembly::Memory,
    writes: std::rc::Rc<std::cell::Cell<u32>>,
    fault: bool,
}

impl wasm_vm_core::mmio::MmioDevice for GrowOnStore {
    fn read(
        &mut self,
        _: u64,
        _: wasm_vm_core::mmio::Width,
    ) -> Result<u64, wasm_vm_core::bus::BusFault> {
        panic!("comparison growth device cannot be read")
    }
    fn write(
        &mut self,
        offset: u64,
        width: wasm_vm_core::mmio::Width,
        value: u64,
    ) -> Result<(), wasm_vm_core::bus::BusFault> {
        assert_eq!(offset, 0);
        assert_eq!(width, wasm_vm_core::mmio::Width::B8);
        assert_eq!(value, 0x89ab_cdef_0123_4567);
        self.memory.grow(1);
        self.writes.set(self.writes.get() + 1);
        if self.fault {
            Err(wasm_vm_core::bus::BusFault::Access)
        } else {
            Ok(())
        }
    }
}

fn growth_after_comparison(inline: bool, fault: GrowthFault) {
    use std::cell::Cell;
    use std::rc::Rc;
    use wasm_bindgen::JsCast;
    use wasm_vm_core::Machine;
    use wasm_vm_core::bus::{Bus, mmap::DRAM_BASE};
    use wasm_vm_core::hart::{Exception, Trap};
    use wasm_vm_core::jit::ExitCode;
    const MMIO: u64 = 0x1000_0000;
    const BAD: u64 = 0x5000_0000;
    const DATA: u64 = DRAM_BASE + 0x4000;
    let mut m = Machine::new(64 * 1024);
    let writes = Rc::new(Cell::new(0));
    m.bus_mut()
        .attach(
            MMIO,
            8,
            Box::new(GrowOnStore {
                memory: wasm_bindgen::memory().unchecked_into(),
                writes: Rc::clone(&writes),
                fault: matches!(fault, GrowthFault::Store),
            }),
        )
        .unwrap();
    m.bus_mut().store64(DATA, 0x0123_4567_89ab_cdef).unwrap();
    let mut e = if inline { shared(&m) } else { private(&m) };
    e.install(&proof::block(
        DRAM_BASE,
        &[
            proof::comparison(1, 31, 1, 2), // invalid before memory grows
            0x0093_3023,                    // sd x9,0(x6): grow outer WASM memory
            proof::comparison(2, 0, 3, 4),  // valid compare to x0 after growth
            0x0004_3383,                    // ld x7,0(x8): may fault after refreshed view
            0x0016_8693,                    // addi x13,x13,1
        ],
    ));
    e.install(&proof::block(
        DRAM_BASE + 0x100,
        &[proof::comparison(2, 31, 3, 4)],
    ));
    assert!(e.is_compiled(DRAM_BASE) && e.is_compiled(DRAM_BASE + 0x100));
    proof::fs(&mut m, 2);
    m.hart_mut().csr.fflags = 3;
    m.hart_mut().csr.frm = 7;
    for (r, raw) in [
        (1, 0xffff_ffff_7fc0_0567),
        (2, 0xffff_ffff_3f80_0000),
        (3, 0xffff_ffff_8000_0000),
        (4, 0xffff_ffff_0000_0000),
    ] {
        m.hart_mut().fregs.write_raw(r, raw);
    }
    let want_f = proof::fregs(&m);
    m.hart_mut().regs.pc = proof::PC;
    m.hart_mut().regs.write(6, MMIO);
    m.hart_mut().regs.write(7, 99);
    m.hart_mut().regs.write(
        8,
        if matches!(fault, GrowthFault::Load) {
            BAD
        } else {
            DATA
        },
    );
    m.hart_mut().regs.write(9, 0x89ab_cdef_0123_4567);
    m.hart_mut().regs.write(13, 99);
    m.hart_mut().regs.write(31, 99);
    let exit = proof::execute(e.as_mut(), &mut m, DRAM_BASE);
    let (pc, retired, trap) = match fault {
        GrowthFault::None => (proof::PC + 20, 5, None),
        GrowthFault::Store => (
            proof::PC + 4,
            1,
            Some(Trap {
                cause: Exception::StoreAccessFault,
                tval: MMIO,
            }),
        ),
        GrowthFault::Load => (
            proof::PC + 12,
            3,
            Some(Trap {
                cause: Exception::LoadAccessFault,
                tval: BAD,
            }),
        ),
    };
    assert_eq!(
        exit.code,
        if trap.is_some() {
            ExitCode::Trap
        } else {
            ExitCode::Fallthrough
        }
    );
    assert_eq!(exit.trap, trap);
    assert_eq!(exit.next_pc, pc);
    assert_eq!(exit.retired, if inline { retired } else { 0 });
    assert_eq!(writes.get(), 1, "a memory-growing import must never replay");
    assert_eq!(m.hart().regs.read(0), 0);
    assert_eq!(m.hart().regs.read(31), 0);
    assert_eq!(
        m.hart().regs.read(13),
        if matches!(fault, GrowthFault::None) {
            100
        } else {
            99
        }
    );
    assert_eq!(
        m.hart().regs.read(7),
        if matches!(fault, GrowthFault::None) {
            0x0123_4567_89ab_cdef
        } else {
            99
        }
    );
    assert_eq!(m.hart().csr.fflags, 19, "CRITIC_GROWTH_ACCRUED_NV");
    assert_eq!(m.hart().csr.frm, 7);
    assert_eq!(m.hart().csr.fs(), 3);
    assert_eq!(proof::fregs(&m), want_f);
    // Next call after growth: interpreted CSR replacement must survive a clean comparison.
    m.hart_mut().regs.write(9, (5 << 5) | 2);
    proof::interpreted(&mut m, 0x0034_9073);
    m.hart_mut().regs.pc = proof::PC + 0x100;
    let next = proof::execute(e.as_mut(), &mut m, DRAM_BASE + 0x100);
    assert_eq!(next.code, ExitCode::Fallthrough);
    assert_eq!(m.hart().regs.read(31), 1);
    assert_eq!(m.hart().csr.fflags, 2);
    assert_eq!(m.hart().csr.frm, 5);
    assert_eq!(proof::fregs(&m), want_f);
    console_log!(
        "CRITIC_GROWTH inline={} fault={:?} pc={:016x} retired={} writes={} flags_before=19 flags_after={}",
        inline,
        fault,
        exit.next_pc,
        exit.retired,
        writes.get(),
        m.hart().csr.fflags
    );
}

#[wasm_bindgen_test]
fn verifier_private_comparison_flags_survive_growth() {
    for fault in [GrowthFault::None, GrowthFault::Store, GrowthFault::Load] {
        growth_after_comparison(false, fault);
    }
}

#[wasm_bindgen_test]
fn verifier_shared_comparison_flags_survive_growth() {
    for fault in [GrowthFault::None, GrowthFault::Store, GrowthFault::Load] {
        growth_after_comparison(true, fault);
    }
}
