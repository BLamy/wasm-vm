//! E5.5-T03bb — the disabled dynamic-link option must not publish unused targets.

use std::cell::RefCell;
use std::rc::Rc;

use wasm_vm_core::Machine;
use wasm_vm_core::bus::Bus;
use wasm_vm_core::bus::mmap::DRAM_BASE;
use wasm_vm_core::dispatch::DecodedBlock;
use wasm_vm_core::hart::Hart;
use wasm_vm_core::jit::{CompiledBlockExecutor, ExitCode, JitExit};
use wasm_vm_core::mmio::SystemBus;

const CALLER: u64 = DRAM_BASE;
const TARGET: u64 = DRAM_BASE + 4;

fn jalr(rd: u32, rs1: u32) -> u32 {
    (rs1 << 15) | (rd << 7) | 0b1100111
}

fn jal(rd: u32) -> u32 {
    (rd << 7) | 0b1101111
}

struct Probe {
    links: Rc<RefCell<Vec<(u64, u64)>>>,
    chaining: bool,
    dynamic_chaining: bool,
}

impl CompiledBlockExecutor for Probe {
    fn install(&mut self, _block: &DecodedBlock) {}

    fn is_compiled(&self, _phys_pc: u64) -> bool {
        true
    }

    fn execute(
        &mut self,
        _phys_pc: u64,
        _hart: &mut Hart,
        _bus: &mut SystemBus,
    ) -> Option<JitExit> {
        Some(JitExit {
            code: ExitCode::BranchTaken,
            next_pc: TARGET,
            exit_info: 0,
            trap: None,
            retired: 1,
        })
    }

    fn invalidate_all(&mut self) {}

    fn invalidate_page(&mut self, _frame: u64) {}

    fn compiled_count(&self) -> usize {
        2
    }

    fn executed_blocks(&self) -> u64 {
        0
    }

    fn retired_via_jit(&self) -> u64 {
        0
    }

    fn set_chaining(&mut self, on: bool) {
        self.chaining = on;
    }

    fn chaining(&self) -> bool {
        self.chaining
    }

    fn chain_depth_budget(&self) -> u32 {
        128
    }

    fn set_dynamic_chaining(&mut self, on: bool) {
        self.dynamic_chaining = on;
    }

    fn dynamic_chaining(&self) -> bool {
        eprintln!("dynamic_chaining getter -> {}", self.dynamic_chaining);
        self.dynamic_chaining
    }

    fn link_dynamic_target(&mut self, virtual_pc: u64, phys_pc: u64) {
        self.links.borrow_mut().push((virtual_pc, phys_pc));
    }
}

fn dynamic_publications(enabled: bool) -> Vec<(u64, u64)> {
    let links = Rc::new(RefCell::new(Vec::new()));
    let mut machine = Machine::new(64 * 1024);
    machine.bus_mut().store32(CALLER, jalr(0, 1)).unwrap();
    machine.bus_mut().store32(TARGET, jal(0)).unwrap();
    machine.hart_mut().regs.write(1, TARGET);
    machine.hart_mut().regs.pc = CALLER;
    machine.set_executor(Box::new(Probe {
        links: Rc::clone(&links),
        chaining: false,
        dynamic_chaining: true,
    }));
    machine.set_block_cache(true);
    machine.set_interrupt_batching(true);
    machine.set_hotness_threshold(1);
    machine.set_chaining(true);
    machine.set_dynamic_chaining(enabled);
    machine.set_jit(true);
    let _ = machine.run(1); // decode/nominate the dynamic caller before the compiled probe run
    machine.hart_mut().regs.pc = CALLER;
    let _ = machine.run(4);
    let _ = machine.take_executor();
    Rc::try_unwrap(links).unwrap().into_inner()
}

#[test]
fn disabled_dynamic_chaining_skips_publication_but_enabled_publishes() {
    let disabled = dynamic_publications(false);
    let enabled = dynamic_publications(true);
    assert!(disabled.is_empty(), "disabled path published {disabled:?}");
    assert!(
        !enabled.is_empty(),
        "enabled path did not publish a dynamic target"
    );
    assert!(
        enabled
            .iter()
            .all(|&(virtual_pc, phys_pc)| { virtual_pc == TARGET && phys_pc == TARGET })
    );
}
