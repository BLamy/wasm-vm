use std::cell::RefCell;
use std::rc::Rc;

use wasm_vm_core::bus::mmap::DRAM_BASE;
use wasm_vm_core::bus::{Bus, BusFault};
use wasm_vm_core::hart::{Exception, Hart, Trap};
use wasm_vm_core::mmio::{MmioDevice, SystemBus, Width};
use wasm_vm_core::ram::Ram;
use wasm_vm_core::trace::{MemOp, TraceRecord, TraceSink};
use wasm_vm_core::{Machine, RunOutcome};

const RAM_BYTES: usize = 64 * 1024;
const CODE: u64 = DRAM_BASE;
const MMIO_BASE: u64 = 0x1000_0000;
const MMIO_LEN: u64 = 0x100;
const MMIO_VALUE: u64 = 0xffff_ffff_89ab_cdef;

// lw x0, 0(x1): the load must still happen and be traced even though architectural
// writeback is discarded by x0.
const LW_X0_MMIO: u32 = (1 << 15) | (0b010 << 12) | 0x03;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Event {
    Read {
        offset: u64,
        width: Width,
    },
    Write {
        offset: u64,
        width: Width,
        value: u64,
    },
}

struct OrderedReadDevice {
    events: Rc<RefCell<Vec<Event>>>,
    result: Result<u64, BusFault>,
}

impl MmioDevice for OrderedReadDevice {
    fn read(&mut self, offset: u64, width: Width) -> Result<u64, BusFault> {
        self.events.borrow_mut().push(Event::Read { offset, width });
        self.result
    }

    fn write(&mut self, offset: u64, width: Width, value: u64) -> Result<(), BusFault> {
        self.events.borrow_mut().push(Event::Write {
            offset,
            width,
            value,
        });
        Ok(())
    }
}

#[derive(Default)]
struct FalseRecordingSink {
    records: Vec<TraceRecord>,
}

impl TraceSink for FalseRecordingSink {
    fn retire(&mut self, record: &TraceRecord) {
        self.records.push(*record);
    }

    fn wants_records(&self) -> bool {
        false
    }
}

fn attach_device(bus: &mut SystemBus, result: Result<u64, BusFault>) -> Rc<RefCell<Vec<Event>>> {
    let events = Rc::new(RefCell::new(Vec::new()));
    bus.attach(
        MMIO_BASE,
        MMIO_LEN,
        Box::new(OrderedReadDevice {
            events: Rc::clone(&events),
            result,
        }),
    )
    .unwrap();
    events
}

fn direct_fixture(result: Result<u64, BusFault>) -> (Hart, SystemBus, Rc<RefCell<Vec<Event>>>) {
    let mut bus = SystemBus::new(Ram::new(RAM_BYTES).unwrap());
    bus.store32(CODE, LW_X0_MMIO).unwrap();
    let events = attach_device(&mut bus, result);
    let mut hart = Hart::new();
    hart.regs.pc = CODE;
    hart.regs.write(1, MMIO_BASE);
    (hart, bus, events)
}

fn machine_fixture(
    cache: bool,
    result: Result<u64, BusFault>,
) -> (Machine, Rc<RefCell<Vec<Event>>>) {
    let mut machine = Machine::new(RAM_BYTES);
    machine.set_block_cache(cache);
    machine.bus_mut().store32(CODE, LW_X0_MMIO).unwrap();
    let events = attach_device(machine.bus_mut(), result);
    machine.hart_mut().regs.pc = CODE;
    machine.hart_mut().regs.write(1, MMIO_BASE);
    (machine, events)
}

fn expected_record() -> TraceRecord {
    TraceRecord {
        pc: CODE,
        insn: LW_X0_MMIO,
        rd: None,
        mem: Some(MemOp {
            addr: MMIO_BASE,
            len: 4,
            is_store: false,
            value: 0,
        }),
    }
}

fn expected_trap() -> Trap {
    Trap {
        cause: Exception::LoadAccessFault,
        tval: MMIO_BASE,
    }
}

fn assert_one_read(events: &Rc<RefCell<Vec<Event>>>, case: &str) {
    assert_eq!(
        events.borrow().as_slice(),
        &[Event::Read {
            offset: 0,
            width: Width::B4,
        }],
        "ordered MMIO transcript differs for {case}"
    );
}

fn assert_direct_success(hart: &Hart, events: &Rc<RefCell<Vec<Event>>>, case: &str) {
    assert_eq!(hart.regs.read(0), 0, "x0 changed for {case}");
    assert_eq!(
        hart.regs.read(1),
        MMIO_BASE,
        "base register changed for {case}"
    );
    assert_eq!(
        hart.regs.pc,
        CODE + 4,
        "successful load did not retire for {case}"
    );
    assert_one_read(events, case);
}

fn assert_direct_fault(hart: &Hart, events: &Rc<RefCell<Vec<Event>>>, case: &str) {
    assert_eq!(hart.regs.read(0), 0, "x0 changed for {case}");
    assert_eq!(
        hart.regs.read(1),
        MMIO_BASE,
        "base register changed for {case}"
    );
    assert_eq!(hart.regs.pc, CODE, "faulting load retired for {case}");
    assert_one_read(events, case);
}

pub fn direct_x0_mmio_read_and_fault_keep_effects_and_callbacks() {
    let (mut hart, mut bus, events) = direct_fixture(Ok(MMIO_VALUE));
    hart.step(&mut bus).unwrap();
    assert_direct_success(&hart, &events, "direct unit success");

    let (mut hart, mut bus, events) = direct_fixture(Ok(MMIO_VALUE));
    let mut sink = FalseRecordingSink::default();
    assert!(!sink.wants_records());
    hart.step_traced(&mut bus, &mut sink).unwrap();
    assert_eq!(sink.records, vec![expected_record()]);
    assert_direct_success(&hart, &events, "direct false-sink success");

    let (mut hart, mut bus, events) = direct_fixture(Err(BusFault::Access));
    assert_eq!(hart.step(&mut bus), Err(expected_trap()));
    assert_direct_fault(&hart, &events, "direct unit fault");

    let (mut hart, mut bus, events) = direct_fixture(Err(BusFault::Access));
    let mut sink = FalseRecordingSink::default();
    assert!(!sink.wants_records());
    assert_eq!(hart.step_traced(&mut bus, &mut sink), Err(expected_trap()));
    assert!(sink.records.is_empty(), "fault emitted a direct callback");
    assert_direct_fault(&hart, &events, "direct false-sink fault");
}

fn assert_machine_success(machine: &Machine, events: &Rc<RefCell<Vec<Event>>>, case: &str) {
    assert_eq!(machine.hart().regs.read(0), 0, "x0 changed for {case}");
    assert_eq!(
        machine.hart().regs.read(1),
        MMIO_BASE,
        "base register changed for {case}"
    );
    assert_eq!(
        machine.hart().regs.pc,
        CODE + 4,
        "successful load did not retire for {case}"
    );
    assert_eq!(machine.irq_stats().retired, 1, "retired count for {case}");
    assert_one_read(events, case);
}

fn assert_machine_fault(machine: &Machine, events: &Rc<RefCell<Vec<Event>>>, case: &str) {
    assert_eq!(machine.hart().regs.read(0), 0, "x0 changed for {case}");
    assert_eq!(
        machine.hart().regs.read(1),
        MMIO_BASE,
        "base register changed for {case}"
    );
    assert_eq!(
        machine.hart().regs.pc,
        CODE,
        "faulting load retired for {case}"
    );
    assert_eq!(machine.irq_stats().retired, 0, "retired count for {case}");
    assert_one_read(events, case);
}

pub fn run_x0_mmio_read_and_fault_keep_effects_and_callbacks() {
    for cache in [false, true] {
        let path = if cache { "cached" } else { "ordinary" };

        let (mut machine, events) = machine_fixture(cache, Ok(MMIO_VALUE));
        assert_eq!(machine.run(1), RunOutcome::MaxInstrs, "{path} unit success");
        assert_machine_success(&machine, &events, &format!("{path} unit success"));

        let (mut machine, events) = machine_fixture(cache, Ok(MMIO_VALUE));
        let mut sink = FalseRecordingSink::default();
        assert!(!sink.wants_records());
        assert_eq!(
            machine.run_traced(1, &mut sink),
            RunOutcome::MaxInstrs,
            "{path} false-sink success"
        );
        assert_eq!(
            sink.records,
            vec![expected_record()],
            "{path} false sink lost or changed the callback"
        );
        assert_machine_success(&machine, &events, &format!("{path} false-sink success"));

        let (mut machine, events) = machine_fixture(cache, Err(BusFault::Access));
        assert_eq!(
            machine.run(1),
            RunOutcome::Trapped(expected_trap()),
            "{path} unit fault"
        );
        assert_machine_fault(&machine, &events, &format!("{path} unit fault"));

        let (mut machine, events) = machine_fixture(cache, Err(BusFault::Access));
        let mut sink = FalseRecordingSink::default();
        assert!(!sink.wants_records());
        assert_eq!(
            machine.run_traced(1, &mut sink),
            RunOutcome::Trapped(expected_trap()),
            "{path} false-sink fault"
        );
        assert!(
            sink.records.is_empty(),
            "{path} fault emitted a false-sink callback"
        );
        assert_machine_fault(&machine, &events, &format!("{path} false-sink fault"));
    }
}
