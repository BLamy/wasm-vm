use std::cell::RefCell;
use std::rc::Rc;

use wasm_vm_core::Machine;
use wasm_vm_core::dispatch::DecodedBlock;
use wasm_vm_core::hart::Hart;
use wasm_vm_core::jit::{CompiledBlockExecutor, JitExit};
use wasm_vm_core::mmio::SystemBus;

#[derive(Default)]
struct TimingProbe {
    transitions: Rc<RefCell<Vec<bool>>>,
}

impl CompiledBlockExecutor for TimingProbe {
    fn install(&mut self, _block: &DecodedBlock) {}

    fn is_compiled(&self, _phys_pc: u64) -> bool {
        false
    }

    fn execute(
        &mut self,
        _phys_pc: u64,
        _hart: &mut Hart,
        _bus: &mut SystemBus,
    ) -> Option<JitExit> {
        None
    }

    fn invalidate_all(&mut self) {}

    fn invalidate_page(&mut self, _frame: u64) {}

    fn compiled_count(&self) -> usize {
        0
    }

    fn executed_blocks(&self) -> u64 {
        0
    }

    fn retired_via_jit(&self) -> u64 {
        0
    }

    fn set_entry_timing(&mut self, on: bool) {
        self.transitions.borrow_mut().push(on);
    }
}

#[test]
fn profiling_state_follows_executor_lifecycle() {
    let mut machine = Machine::new(8 * 1024 * 1024);
    let first = Rc::new(RefCell::new(Vec::new()));
    machine.set_executor(Box::new(TimingProbe {
        transitions: Rc::clone(&first),
    }));
    assert_eq!(&*first.borrow(), &[false]);

    machine.set_profiling(true);
    machine.set_profiling(false);
    machine.set_profiling(true);
    assert_eq!(&*first.borrow(), &[false, true, false, true]);

    let replacement = Rc::new(RefCell::new(Vec::new()));
    machine.set_executor(Box::new(TimingProbe {
        transitions: Rc::clone(&replacement),
    }));
    assert_eq!(&*replacement.borrow(), &[true]);

    machine.set_profiling(false);
    assert_eq!(&*replacement.borrow(), &[true, false]);
}
