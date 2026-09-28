#![cfg(target_arch = "wasm32")]
use wasm_bindgen_test::*;
#[path = "../../../tests/support/jit_fp_from_integer_verifier.rs"]
mod proof;

fn private(_: &wasm_vm_core::Machine) -> Box<dyn wasm_vm_core::jit::CompiledBlockExecutor> {
    Box::new(wasm_vm_wasm::BrowserExecutor::new())
}
fn shared(m: &wasm_vm_core::Machine) -> Box<dyn wasm_vm_core::jit::CompiledBlockExecutor> {
    Box::new(wasm_vm_wasm::BrowserExecutor::new_inline(m).unwrap())
}
#[wasm_bindgen_test]
fn verifier_private_conversion() {
    console_log!(
        "CRITIC_PRIVATE_FROM_INT_LITERALS {:?}",
        proof::literal_goldens(private, false)
    );
    console_log!(
        "CRITIC_PRIVATE_FROM_INT_SEEDED {:?}",
        proof::seeded_aliases_and_illegal(private, false)
    );
    console_log!(
        "CRITIC_PRIVATE_FROM_INT_CONTROL {:?}",
        proof::control_and_faults(private, false)
    );
}
#[wasm_bindgen_test]
fn verifier_shared_conversion() {
    console_log!(
        "CRITIC_SHARED_FROM_INT_LITERALS {:?}",
        proof::literal_goldens(shared, true)
    );
    console_log!(
        "CRITIC_SHARED_FROM_INT_SEEDED {:?}",
        proof::seeded_aliases_and_illegal(shared, true)
    );
    console_log!(
        "CRITIC_SHARED_FROM_INT_CONTROL {:?}",
        proof::control_and_faults(shared, true)
    );
}

fn direct_successors(same_module: bool, fault: bool) {
    use wasm_vm_core::Machine;
    use wasm_vm_core::bus::mmap::DRAM_BASE;
    use wasm_vm_core::hart::{Exception, Trap};
    use wasm_vm_core::jit::{CompiledBlockExecutor, ExitCode};
    use wasm_vm_wasm::BrowserExecutor;
    let root = proof::block(DRAM_BASE, &[0x001f_8f93, 0x0040_006f]); // addi x31,x31,1; jal
    let successor = proof::block(
        DRAM_BASE + 8,
        &[
            proof::conversion(3, 0, 31, 7), // consume new x31 using dynamic RUP
            0x0000_00d3,                    // fadd.s f1,f0,f0: 33554436 exactly
            if fault { 0x0003_3583 } else { 0xe000_86d3 }, // ld x11,0(x6) / fmv.x.w x13,f1
            0x0040_006f,
        ],
    );
    let mut m = Machine::new(64 * 1024);
    let mut e = BrowserExecutor::new_inline(&m).unwrap();
    if same_module {
        e.install_batch(&[root, successor], &[[Some(1), None], [None, None]]);
    } else {
        e.install(&root);
        e.install(&successor);
    }
    assert!(e.is_compiled(DRAM_BASE) && e.is_compiled(DRAM_BASE + 8));
    m.hart_mut().regs.write(6, 0x5000_0000);
    let ptr: *mut Machine = &mut m;
    for budget in [1, 2, 5, 6] {
        if !same_module {
            proof::fs(&mut m, 1);
            m.hart_mut().csr.frm = 3;
            m.hart_mut().regs.pc = DRAM_BASE;
            m.hart_mut().regs.write(31, 1 << 24);
            // SAFETY: synchronous authority warm-up with live disjoint components.
            unsafe {
                e.execute_with_budget(
                    DRAM_BASE,
                    (*ptr).hart_mut(),
                    (*ptr).bus_mut(),
                    64,
                    64,
                    false,
                )
                .unwrap();
            }
            e.link_edge(DRAM_BASE, 0, DRAM_BASE + 8);
            assert_eq!(e.linked_target(DRAM_BASE, 0), Some(DRAM_BASE + 8));
        }
        proof::fs(&mut m, 1);
        m.hart_mut().csr.fflags = 8;
        m.hart_mut().csr.frm = 3;
        m.hart_mut().regs.pc = DRAM_BASE;
        m.hart_mut().regs.write(31, 1 << 24);
        m.hart_mut().regs.write(11, 99);
        m.hart_mut().regs.write(13, 99);
        m.hart_mut().fregs.write_raw(0, proof::SENTINEL);
        m.hart_mut().fregs.write_raw(1, proof::SENTINEL);
        let mut want_f = proof::fregs(&m);
        if budget == 6 {
            want_f[0] = proof::BOX | 0x4b80_0001;
            want_f[1] = proof::BOX | 0x4c00_0001;
        }
        let entries = e.direct_chain_entries();
        let links = e.direct_chain_links();
        // SAFETY: synchronous generated invocation with disjoint live components.
        let exit = unsafe {
            e.execute_with_budget(
                DRAM_BASE,
                (*ptr).hart_mut(),
                (*ptr).bus_mut(),
                64,
                budget,
                true,
            )
            .unwrap()
        };
        let retired = if budget < 2 {
            0
        } else if budget < 6 {
            2
        } else if fault {
            4
        } else {
            6
        };
        let pc = DRAM_BASE
            + if budget < 2 {
                0
            } else if budget < 6 {
                8
            } else if fault {
                16
            } else {
                24
            };
        let calls = if budget < 2 {
            0
        } else if budget < 6 {
            1
        } else {
            2
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
        assert_eq!(e.direct_chain_entries() - entries, calls);
        assert_eq!(e.direct_chain_links() - links, u64::from(budget == 6));
        assert_eq!(m.hart().regs.read(31), (1 << 24) + u64::from(budget >= 2));
        assert_eq!(
            m.hart().regs.read(13),
            if budget < 6 || fault { 99 } else { 0x4c00_0001 }
        );
        assert_eq!(m.hart().regs.read(11), 99);
        assert_eq!(m.hart().regs.read(0), 0);
        assert_eq!(m.hart().csr.fflags, if budget < 6 { 8 } else { 9 });
        assert_eq!(m.hart().csr.frm, 3);
        assert_eq!(m.hart().csr.fs(), if budget < 6 { 1 } else { 3 });
        assert_eq!(proof::fregs(&m), want_f);
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
            "CRITIC_FROM_INT_CHAIN same={} fault={} budget={} retired={} entries={} links={} pc={:016x} flags={:02x}",
            same_module,
            fault,
            budget,
            exit.retired,
            e.direct_chain_entries() - entries,
            e.direct_chain_links() - links,
            exit.next_pc,
            m.hart().csr.fflags
        );
    }
    proof::interpreted(&mut m, 0x0010_2573);
    assert_eq!(m.hart().regs.read(10), 9);
}
#[wasm_bindgen_test]
fn verifier_same_module_conversion_successors() {
    direct_successors(true, false);
    direct_successors(true, true);
}
#[wasm_bindgen_test]
fn verifier_cross_module_conversion_successors() {
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
    growth: std::rc::Rc<std::cell::Cell<u32>>,
    fault: bool,
}
impl wasm_vm_core::mmio::MmioDevice for GrowOnStore {
    fn read(
        &mut self,
        _: u64,
        _: wasm_vm_core::mmio::Width,
    ) -> Result<u64, wasm_vm_core::bus::BusFault> {
        panic!("conversion growth device cannot be read")
    }
    fn write(
        &mut self,
        offset: u64,
        width: wasm_vm_core::mmio::Width,
        value: u64,
    ) -> Result<(), wasm_vm_core::bus::BusFault> {
        assert_eq!(offset, 0);
        assert_eq!(width, wasm_vm_core::mmio::Width::B8);
        assert_eq!(value, 0x7654_3210_89ab_cdef);
        let before = js_sys::Uint8Array::new(&self.memory.buffer()).length();
        self.memory.grow(1);
        let after = js_sys::Uint8Array::new(&self.memory.buffer()).length();
        self.growth.set(after - before);
        self.writes.set(self.writes.get() + 1);
        if self.fault {
            Err(wasm_vm_core::bus::BusFault::Access)
        } else {
            Ok(())
        }
    }
}
fn growth_between_conversions(inline: bool, fault: GrowthFault) {
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
    let growth = Rc::new(Cell::new(0));
    m.bus_mut()
        .attach(
            MMIO,
            8,
            Box::new(GrowOnStore {
                memory: wasm_bindgen::memory().unchecked_into(),
                writes: Rc::clone(&writes),
                growth: Rc::clone(&growth),
                fault: matches!(fault, GrowthFault::Store),
            }),
        )
        .unwrap();
    m.bus_mut().store64(DATA, 0x0123_4567_89ab_cdef).unwrap();
    let mut e = if inline { shared(&m) } else { private(&m) };
    e.install(&proof::block(
        DRAM_BASE,
        &[
            proof::conversion(2, 3, 1, 3), // 2^24+1 RUP -> 2^24+2, NX
            0x0093_3023,                   // sd x9,0(x6): actual outer WASM memory.grow
            0x0010_8093,                   // addi x1,x1,1
            proof::conversion(3, 4, 1, 0), // updated integer -> exact 2^24+2
            0x0004_3383,                   // ld x7,0(x8): optional later fault
            0x0016_8693,
        ],
    ));
    e.install(&proof::block(
        DRAM_BASE + 0x100,
        &[proof::conversion(3, 31, 1, 7)],
    ));
    assert!(e.is_compiled(DRAM_BASE) && e.is_compiled(DRAM_BASE + 0x100));
    proof::fs(&mut m, 2);
    m.hart_mut().csr.fflags = 8;
    m.hart_mut().csr.frm = 7;
    m.hart_mut().regs.write(1, 0x0100_0001);
    m.hart_mut().fregs.write_raw(3, proof::SENTINEL);
    m.hart_mut().fregs.write_raw(4, proof::SENTINEL);
    let mut want_f = proof::fregs(&m);
    want_f[3] = proof::BOX | 0x4b80_0001;
    if !matches!(fault, GrowthFault::Store) {
        want_f[4] = proof::BOX | 0x4b80_0001;
    }
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
    m.hart_mut().regs.write(9, 0x7654_3210_89ab_cdef);
    m.hart_mut().regs.write(13, 99);
    let exit = proof::execute(e.as_mut(), &mut m, DRAM_BASE);
    let (pc, retired, trap) = match fault {
        GrowthFault::None => (proof::PC + 24, 6, None),
        GrowthFault::Store => (
            proof::PC + 4,
            1,
            Some(Trap {
                cause: Exception::StoreAccessFault,
                tval: MMIO,
            }),
        ),
        GrowthFault::Load => (
            proof::PC + 16,
            4,
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
    assert_eq!(writes.get(), 1, "memory-growing import must never replay");
    assert_eq!(
        growth.get(),
        65536,
        "must really grow host WebAssembly memory"
    );
    assert_eq!(
        m.hart().regs.read(1),
        if matches!(fault, GrowthFault::Store) {
            0x0100_0001
        } else {
            0x0100_0002
        }
    );
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
    assert_eq!(m.hart().csr.fflags, 9);
    assert_eq!(m.hart().csr.frm, 7);
    assert_eq!(m.hart().csr.fs(), 3);
    assert_eq!(proof::fregs(&m), want_f);
    m.hart_mut().regs.write(9, (1 << 5) | 16);
    proof::interpreted(&mut m, 0x0034_9073); // clear prior NX and replace frm with RTZ
    m.hart_mut().regs.write(1, 0x8000_0000_0000_0001);
    m.hart_mut().regs.pc = proof::PC + 0x100;
    let next = proof::execute(e.as_mut(), &mut m, DRAM_BASE + 0x100);
    want_f[31] = proof::BOX | 0x5f00_0000;
    assert_eq!(next.code, ExitCode::Fallthrough);
    assert_eq!(m.hart().csr.fflags, 17);
    assert_eq!(m.hart().csr.frm, 1);
    assert_eq!(proof::fregs(&m), want_f);
    console_log!(
        "CRITIC_FROM_INT_GROWTH inline={} fault={:?} pc={:016x} retired={} writes={} bytes_grown={} flags_before=9 flags_after={}",
        inline,
        fault,
        exit.next_pc,
        exit.retired,
        writes.get(),
        growth.get(),
        m.hart().csr.fflags
    );
}
#[wasm_bindgen_test]
fn verifier_private_conversion_memory_growth() {
    for fault in [GrowthFault::None, GrowthFault::Store, GrowthFault::Load] {
        growth_between_conversions(false, fault);
    }
}
#[wasm_bindgen_test]
fn verifier_shared_conversion_memory_growth() {
    for fault in [GrowthFault::None, GrowthFault::Store, GrowthFault::Load] {
        growth_between_conversions(true, fault);
    }
}
