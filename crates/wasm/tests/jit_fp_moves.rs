#![cfg(target_arch = "wasm32")]
use wasm_bindgen_test::*;
#[path = "../../../tests/support/jit_fp_moves.rs"]
mod fixture;

#[wasm_bindgen_test]
fn fp_moves_browser_directed() {
    fixture::directed(&mut wasm_vm_wasm::BrowserExecutor::new());
}

#[wasm_bindgen_test]
fn fp_moves_browser_handoff_reuse() {
    fixture::handoff_reuse(&mut wasm_vm_wasm::BrowserExecutor::new());
}

#[wasm_bindgen_test]
fn fp_moves_browser_precise_runloop() {
    fixture::runloop(Box::new(wasm_vm_wasm::BrowserExecutor::new()));
}

fn chained(same_module: bool) {
    use wasm_vm_core::Machine;
    use wasm_vm_core::bus::mmap::DRAM_BASE;
    use wasm_vm_core::jit::{CompiledBlockExecutor, ExitCode};
    use wasm_vm_wasm::BrowserExecutor;
    let first = fixture::block(DRAM_BASE, &[0x00128293, 0x0040006f]);
    let raw = fixture::fp(0x10, 1, 0, 1, 2);
    let second = fixture::block(
        DRAM_BASE + 8,
        &[
            raw,
            fixture::fp(0x70, 0, 3, 0, 0),
            fixture::fp(0x78, 0, 31, 3, 0),
            0x0040006f,
        ],
    );
    let mut machine = Machine::new(64 * 1024);
    let mut executor = BrowserExecutor::new_inline(&machine).unwrap();
    if same_module {
        executor.install_batch(&[first, second], &[[Some(1), None], [None, None]]);
    } else {
        executor.install(&first);
        executor.install(&second);
    }
    for (fs, budget, expected_retired, expected_code) in [
        (0, 64, 2, ExitCode::IllegalInstruction),
        (2, 4, 2, ExitCode::Budget),
        (1, 64, 6, ExitCode::BranchTaken),
        (2, 64, 6, ExitCode::BranchTaken),
    ] {
        fixture::set_fs(machine.hart_mut(), fs);
        machine.hart_mut().fregs.write_raw(0, 0x123456789abcdef0);
        machine.hart_mut().fregs.write_raw(1, 0xffffffff7fa01234);
        machine.hart_mut().fregs.write_raw(2, 0xffffffff00000000);
        machine.hart_mut().fregs.write_raw(31, 0xfeedface);
        machine.hart_mut().regs.write(5, 41);
        machine.hart_mut().regs.pc = DRAM_BASE;
        let machine_ptr: *mut Machine = &mut machine;
        // The executor API borrows the two disjoint Machine components.
        if !same_module {
            unsafe {
                executor
                    .execute_with_budget(
                        DRAM_BASE,
                        (*machine_ptr).hart_mut(),
                        (*machine_ptr).bus_mut(),
                        64,
                        64,
                        false,
                    )
                    .unwrap();
            }
            executor.link_edge(DRAM_BASE, 0, DRAM_BASE + 8);
            assert_eq!(executor.linked_target(DRAM_BASE, 0), Some(DRAM_BASE + 8));
            machine.hart_mut().regs.pc = DRAM_BASE;
            machine.hart_mut().regs.write(5, 41);
        }
        let exit = unsafe {
            executor
                .execute_with_budget(
                    DRAM_BASE,
                    (*machine_ptr).hart_mut(),
                    (*machine_ptr).bus_mut(),
                    64,
                    budget,
                    true,
                )
                .unwrap()
        };
        assert_eq!(
            exit.code, expected_code,
            "same_module={same_module} fs={fs} budget={budget}"
        );
        assert_eq!(exit.retired, expected_retired);
        assert_eq!(machine.hart().regs.read(5), 42);
        if fs == 0 || budget == 4 {
            assert_eq!(exit.next_pc, DRAM_BASE + 8);
            if fs == 0 {
                assert_eq!(exit.exit_info, u64::from(raw));
            }
            assert_eq!(machine.hart().fregs.read_raw(0), 0x123456789abcdef0);
            assert_eq!(machine.hart().fregs.read_raw(31), 0xfeedface);
            assert_eq!(machine.hart().csr.fs(), fs as u8);
        } else {
            assert_eq!(exit.next_pc, DRAM_BASE + 24);
            assert_eq!(machine.hart().fregs.read_raw(0), 0xffffffffffa01234);
            assert_eq!(machine.hart().fregs.read_raw(31), 0xffffffffffa01234);
            assert_eq!(machine.hart().regs.read(3), 0xffffffffffa01234);
            assert_eq!(machine.hart().csr.fs(), 3);
        }
        console_log!(
            "FP_MOVES chain same_module={} fs={} budget={} retired={} pc={:016x}",
            same_module,
            fs,
            budget,
            exit.retired,
            exit.next_pc
        );
    }
}

#[wasm_bindgen_test]
fn fp_moves_browser_same_module_chain() {
    chained(true);
}

#[wasm_bindgen_test]
fn fp_moves_browser_cross_module_chain() {
    chained(false);
}

#[wasm_bindgen_test]
fn fp_moves_browser_fp_prefix_survives_chained_memory_fault() {
    use wasm_vm_core::Machine;
    use wasm_vm_core::bus::mmap::DRAM_BASE;
    use wasm_vm_core::hart::{Exception, Trap};
    use wasm_vm_core::jit::{CompiledBlockExecutor, ExitCode};
    use wasm_vm_wasm::BrowserExecutor;
    for same_module in [true, false] {
        let root = fixture::block(
            DRAM_BASE,
            &[0x00128293, fixture::fp(0x10, 0, 31, 1, 2), 0x0040006f],
        );
        let successor = fixture::block(
            DRAM_BASE + 12,
            &[
                fixture::fp(0x70, 0, 3, 31, 0),
                0x00012303,
                fixture::fp(0x78, 0, 0, 5, 0),
                0x0040006f,
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
        let machine_ptr: *mut Machine = &mut machine;
        for warm in [true, false] {
            fixture::set_fs(machine.hart_mut(), 2);
            machine.hart_mut().csr.fflags = 9;
            machine.hart_mut().csr.frm = 7;
            machine.hart_mut().fregs.write_raw(0, 0x123456789abcdef0);
            machine.hart_mut().fregs.write_raw(1, 0xffffffff7fa01234);
            machine.hart_mut().fregs.write_raw(2, 0xffffffff80000000);
            machine.hart_mut().fregs.write_raw(31, 0xfeedface);
            machine.hart_mut().regs.write(5, 41);
            machine.hart_mut().regs.write(2, 0xdeadbeec);
            machine.hart_mut().regs.pc = DRAM_BASE;
            // The two pointers designate disjoint components of this live Machine.
            let exit = unsafe {
                executor
                    .execute_with_budget(
                        DRAM_BASE,
                        (*machine_ptr).hart_mut(),
                        (*machine_ptr).bus_mut(),
                        64,
                        64,
                        !warm,
                    )
                    .unwrap()
            };
            if warm {
                if !same_module {
                    executor.link_edge(DRAM_BASE, 0, DRAM_BASE + 12);
                }
                continue;
            }
            assert_eq!(exit.code, ExitCode::Trap);
            assert_eq!(
                exit.trap,
                Some(Trap {
                    cause: Exception::LoadAccessFault,
                    tval: 0xdeadbeec
                })
            );
            assert_eq!(exit.next_pc, DRAM_BASE + 16);
            assert_eq!(exit.retired, 4);
            assert_eq!(machine.hart().regs.read(5), 42);
            assert_eq!(machine.hart().regs.read(3), 0xffffffffffa01234);
            assert_eq!(machine.hart().fregs.read_raw(31), 0xffffffffffa01234);
            assert_eq!(machine.hart().fregs.read_raw(0), 0x123456789abcdef0);
            assert_eq!(machine.hart().csr.fs(), 3);
            assert_eq!(machine.hart().csr.fflags, 9);
            assert_eq!(machine.hart().csr.frm, 7);
            console_log!(
                "FP_MOVES chained fault same_module={} retired={} pc={:016x} f31={:016x}",
                same_module,
                exit.retired,
                exit.next_pc,
                machine.hart().fregs.read_raw(31)
            );
        }
    }
}
