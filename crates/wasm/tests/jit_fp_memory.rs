#![cfg(target_arch = "wasm32")]
use wasm_bindgen_test::*;
#[path = "../../../tests/support/jit_fp_memory.rs"]
mod fixture;
fn private(_: &wasm_vm_core::Machine) -> Box<dyn wasm_vm_core::jit::CompiledBlockExecutor> {
    Box::new(wasm_vm_wasm::BrowserExecutor::new())
}
fn inline(m: &wasm_vm_core::Machine) -> Box<dyn wasm_vm_core::jit::CompiledBlockExecutor> {
    Box::new(wasm_vm_wasm::BrowserExecutor::new_inline(m).unwrap())
}
#[wasm_bindgen_test]
fn fp_memory_browser_private() {
    fixture::transfers(private);
    fixture::virtual_pages(private);
    fixture::mmio_and_faults(private);
    fixture::runloop(private);
}
#[wasm_bindgen_test]
fn fp_memory_browser_inline() {
    fixture::transfers(inline);
    fixture::virtual_pages(inline);
    fixture::mmio_and_faults(inline);
    fixture::runloop(inline);
}

#[wasm_bindgen_test]
fn fp_memory_browser_successors() {
    use wasm_vm_core::Machine;
    use wasm_vm_core::bus::{Bus, mmap::DRAM_BASE};
    use wasm_vm_core::hart::{Exception, Trap};
    use wasm_vm_core::jit::{CompiledBlockExecutor, ExitCode};
    for same in [true, false] {
        for fault in [false, true] {
            let mut m = Machine::new(64 * 1024);
            let first = fixture::block(
                DRAM_BASE,
                &[
                    fixture::load(false, 5, 5, 0),
                    fixture::store(true, 5, 8, 0),
                    0x0040006f,
                ],
            );
            let second = fixture::block(
                DRAM_BASE + 12,
                &[
                    fixture::load(true, 0, if fault { 7 } else { 8 }, 0),
                    fixture::store(false, 0, 5, 8),
                    0x00428293,
                    0x0040006f,
                ],
            );
            let mut e = wasm_vm_wasm::BrowserExecutor::new_inline(&m).unwrap();
            if same {
                e.install_batch(&[first, second], &[[Some(1), None], [None, None]]);
            } else {
                e.install(&first);
                e.install(&second);
            }
            for phase in 0..3 {
                m.hart_mut().regs.pc = DRAM_BASE;
                fixture::fs(m.hart_mut(), if phase == 2 { 0 } else { 2 });
                m.hart_mut().csr.fflags = 0x15;
                m.hart_mut().csr.frm = 7;
                m.hart_mut().regs.write(5, fixture::DATA);
                m.hart_mut().regs.write(7, 0x50000000);
                m.hart_mut().regs.write(8, fixture::DATA + 16);
                m.hart_mut().fregs.write_raw(0, 0xfeedface01234567);
                m.hart_mut().fregs.write_raw(5, 0x123456789abcdef0);
                m.bus_mut().store32(fixture::DATA, 0x7fa12345).unwrap();
                m.bus_mut().store64(fixture::DATA + 16, 0).unwrap();
                m.bus_mut().store64(fixture::DATA + 8, 0).unwrap();
                let exit = fixture::execute(&mut e, &mut m, DRAM_BASE, phase != 0);
                if phase == 0 {
                    if !same {
                        e.link_edge(DRAM_BASE, 0, DRAM_BASE + 12);
                    }
                    continue;
                }
                if phase == 2 {
                    assert_eq!(exit.code, ExitCode::IllegalInstruction);
                    assert_eq!(exit.retired, 0);
                    assert_eq!(exit.next_pc, DRAM_BASE);
                    assert_eq!(m.bus_mut().load64(fixture::DATA + 16).unwrap(), 0);
                } else {
                    assert_eq!(
                        m.bus_mut().load64(fixture::DATA + 16).unwrap(),
                        0xffffffff7fa12345
                    );
                    assert_eq!(m.hart().fregs.read_raw(5), 0xffffffff7fa12345);
                    if fault {
                        assert_eq!(
                            exit.trap,
                            Some(Trap {
                                cause: Exception::LoadAccessFault,
                                tval: 0x50000000
                            })
                        );
                        assert_eq!(exit.retired, 3);
                        assert_eq!(exit.next_pc, DRAM_BASE + 12);
                        assert_eq!(m.hart().fregs.read_raw(0), 0xfeedface01234567);
                        assert_eq!(m.hart().regs.read(5), fixture::DATA);
                    } else {
                        assert_eq!(exit.code, ExitCode::BranchTaken);
                        assert_eq!(exit.retired, 7);
                        assert_eq!(exit.next_pc, DRAM_BASE + 28);
                        assert_eq!(m.hart().fregs.read_raw(0), 0xffffffff7fa12345);
                        assert_eq!(m.hart().regs.read(5), fixture::DATA + 4);
                        assert_eq!(m.bus_mut().load32(fixture::DATA + 8).unwrap(), 0x7fa12345);
                    }
                }
                assert_eq!(m.hart().csr.fflags, 0x15);
                assert_eq!(m.hart().csr.frm, 7);
                console_log!(
                    "FP_MEMORY successor same={} fault={} FSoff={} retired={} pc={:x}",
                    same,
                    fault,
                    phase == 2,
                    exit.retired,
                    exit.next_pc
                );
            }
        }
    }
}

#[wasm_bindgen_test]
fn fp_memory_browser_store_barriers() {
    use wasm_vm_core::Machine;
    use wasm_vm_core::bus::{Bus, mmap::DRAM_BASE};
    use wasm_vm_core::jit::{CompiledBlockExecutor, ExitCode};
    for mode in 0..3 {
        let mut m = Machine::new(64 * 1024);
        // mode 0: data successor; 1: live code page; 2: atomic successor;
        let data = if mode == 1 {
            DRAM_BASE + 0x800
        } else {
            fixture::DATA
        };
        let count = 1;
        let mut ops = vec![fixture::store(true, 0, 5, 0); count];
        ops.push(0x0040006f);
        let target = DRAM_BASE + ops.len() as u64 * 4;
        let first = fixture::block(DRAM_BASE, &ops);
        let second = fixture::block(
            target,
            &[if mode == 2 { 0x0022b3af } else { 0x00138393 }, 0x0040006f],
        );
        let mut e = wasm_vm_wasm::BrowserExecutor::new_inline(&m).unwrap();
        e.install_batch(&[first, second], &[[Some(1), None], [None, None]]);
        for warm in [false, true] {
            fixture::fs(m.hart_mut(), 2);
            m.hart_mut().regs.pc = DRAM_BASE;
            m.hart_mut().regs.write(5, data);
            m.hart_mut().regs.write(7, 0);
            m.hart_mut().regs.write(2, 1);
            m.hart_mut().fregs.write_raw(0, 0x7ff123456789abcd);
            m.hart_mut().resv = Some((data, 8));
            m.bus_mut().arm_code_write_tracking(true);
            m.bus_mut().code_write_log_mut().clear();
            let exit = fixture::execute(&mut e, &mut m, DRAM_BASE, true);
            if !warm {
                continue;
            }
            assert_eq!(m.hart().resv, None);
            assert_eq!(m.bus_mut().load64(data).unwrap(), 0x7ff123456789abcd);
            assert_eq!(m.hart().csr.fs(), 2, "stores preserve FS");
            assert!(m.bus_mut().code_write_log_mut().contains(&(data >> 12)));
            if mode == 1 || mode == 2 {
                assert_eq!(exit.retired, 2);
                assert_eq!(exit.next_pc, target);
                assert_eq!(m.hart().regs.read(7), 0);
                if mode == 2 {
                    assert_eq!(exit.code, ExitCode::Budget);
                }
            } else {
                assert_eq!(exit.retired, count as u64 + 3);
                assert_eq!(m.hart().regs.read(7), 1);
            }
            console_log!(
                "FP_MEMORY store barrier mode={} retired={} code={:?}",
                mode,
                exit.retired,
                exit.code
            );
        }
    }
}

#[wasm_bindgen_test]
fn fp_memory_browser_full_store_log() {
    use wasm_vm_core::Machine;
    use wasm_vm_core::bus::{Bus, mmap::DRAM_BASE};
    use wasm_vm_core::jit::CompiledBlockExecutor;
    let mut m = Machine::new(64 * 1024);
    let mut ops = vec![fixture::store(true, 0, 5, 0); 127];
    ops.push(0x0040006f);
    let first = fixture::block(DRAM_BASE, &ops);
    let second = fixture::block(
        DRAM_BASE + 512,
        &[
            fixture::store(false, 0, 5, 8),
            fixture::store(true, 0, 5, 16),
            0x00138393,
            0x0040006f,
        ],
    );
    let mut e = wasm_vm_wasm::BrowserExecutor::new_inline(&m).unwrap();
    e.install_batch(&[first, second], &[[Some(1), None], [None, None]]);
    for _ in 0..2 {
        fixture::fs(m.hart_mut(), 2);
        m.hart_mut().regs.pc = DRAM_BASE;
        m.hart_mut().regs.write(5, fixture::DATA);
        m.hart_mut().regs.write(7, 0);
        m.hart_mut().fregs.write_raw(0, 0x012345677fa12345);
        m.hart_mut().resv = Some((fixture::DATA + 16, 8));
        m.bus_mut().arm_code_write_tracking(true);
        m.bus_mut().code_write_log_mut().clear();
        let exit = fixture::execute(&mut e, &mut m, DRAM_BASE, true);
        assert_eq!(exit.retired, 132);
        assert_eq!(m.hart().regs.read(7), 1);
        assert_eq!(
            m.bus_mut().load64(fixture::DATA).unwrap(),
            0x012345677fa12345
        );
        assert_eq!(m.bus_mut().load32(fixture::DATA + 8).unwrap(), 0x7fa12345);
        assert_eq!(
            m.bus_mut().load64(fixture::DATA + 16).unwrap(),
            0x012345677fa12345
        );
        assert_eq!(m.hart().resv, None);
        assert_eq!(m.hart().csr.fs(), 2);
        assert!(
            m.bus_mut()
                .code_write_log_mut()
                .contains(&(fixture::DATA >> 12))
        );
    }
    console_log!(
        "FP_MEMORY full store log: 129 stores, 132 retired, final raw payload=012345677fa12345"
    );
}

#[wasm_bindgen_test]
fn fp_memory_browser_proves_inline_hits() {
    use wasm_vm_core::Machine;
    use wasm_vm_core::bus::{Bus, mmap::DRAM_BASE};
    use wasm_vm_core::csr::{CsrOp, Priv, SATP};
    use wasm_vm_core::jit::CompiledBlockExecutor;
    for shared in [false, true] {
        for wide in [false, true] {
            for write in [false, true] {
                let mut m = Machine::new(64 * 1024);
                let root = DRAM_BASE + 0x1000;
                let middle = DRAM_BASE + 0x2000;
                let leaf = DRAM_BASE + 0x3000;
                m.bus_mut()
                    .store64(root, ((middle >> 12) << 10) | 1)
                    .unwrap();
                m.bus_mut()
                    .store64(middle, ((leaf >> 12) << 10) | 1)
                    .unwrap();
                m.bus_mut()
                    .store64(leaf + 32, ((fixture::DATA >> 12) << 10) | 0xcf)
                    .unwrap();
                m.bus_mut()
                    .store64(fixture::DATA, 0x7ff123457fa67890)
                    .unwrap();
                // Keep FS stable across the measured warm call; load dirtying is tested separately.
                fixture::fs(m.hart_mut(), 3);
                m.hart_mut().csr.pmp.allow_all();
                m.hart_mut()
                    .csr
                    .access(
                        SATP,
                        CsrOp::Write,
                        (8 << 60) | (root >> 12),
                        false,
                        false,
                        0,
                    )
                    .unwrap();
                m.hart_mut().csr.mode = Priv::S;
                m.hart_mut().regs.write(5, 0x4000);
                m.hart_mut().fregs.write_raw(0, 0x123456787fa67890);
                m.hart_mut().regs.pc = 0x1000;
                let raw = if write {
                    fixture::store(wide, 0, 5, 0)
                } else {
                    fixture::load(wide, 0, 5, 0)
                };
                let mut e = if shared {
                    wasm_vm_wasm::BrowserExecutor::new_inline(&m).unwrap()
                } else {
                    wasm_vm_wasm::BrowserExecutor::new()
                };
                e.install(&fixture::block(DRAM_BASE, &[raw]));
                fixture::execute(&mut e, &mut m, DRAM_BASE, false);
                let before = m.hart().tlb.hits() + m.hart().tlb.walks();
                assert!(before > 0, "cold transfer must resolve its virtual address");
                fixture::execute(&mut e, &mut m, DRAM_BASE, false);
                let additional = m.hart().tlb.hits() + m.hart().tlb.walks() - before;
                if shared {
                    assert_eq!(
                        additional, 0,
                        "warm inline access never enters software translation"
                    );
                } else {
                    assert!(additional > 0, "private control must enter checked import");
                }
                console_log!(
                    "FP_MEMORY path shared={} wide={} store={} cold_translations={} warm_translations={}",
                    shared,
                    wide,
                    write,
                    before,
                    additional
                );
            }
        }
    }
}
