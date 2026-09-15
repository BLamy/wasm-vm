#![cfg(target_arch = "wasm32")]
//! P19: preserve new FP transfer writes when an actual host import grows wasm memory.
use std::cell::Cell;
use std::rc::Rc;

use js_sys::WebAssembly;
use wasm_bindgen::JsCast;
use wasm_bindgen_test::*;
use wasm_vm_core::Machine;
use wasm_vm_core::bus::{Bus, BusFault, mmap::DRAM_BASE};
use wasm_vm_core::csr::{CsrOp, MSTATUS};
use wasm_vm_core::decode::decode;
use wasm_vm_core::dispatch::{DecodedBlock, MicroOp};
use wasm_vm_core::hart::{Exception, Trap};
use wasm_vm_core::jit::{CompiledBlockExecutor, ExitCode};
use wasm_vm_core::mmio::{MmioDevice, Width};
use wasm_vm_wasm::BrowserExecutor;

struct GrowOnFpStore {
    memory: WebAssembly::Memory,
    writes: Rc<Cell<u32>>,
    payload: Rc<Cell<u64>>,
    fault: bool,
}

impl MmioDevice for GrowOnFpStore {
    fn read(&mut self, _offset: u64, _width: Width) -> Result<u64, BusFault> {
        panic!("the growth device is not a read target")
    }

    fn write(&mut self, offset: u64, width: Width, value: u64) -> Result<(), BusFault> {
        assert_eq!(offset, 0);
        assert_eq!(width, Width::B8);
        self.memory.grow(1);
        self.writes.set(self.writes.get() + 1);
        self.payload.set(value);
        if self.fault {
            Err(BusFault::Access)
        } else {
            Ok(())
        }
    }
}

#[derive(Clone, Copy, Debug)]
enum Fault {
    None,
    Store,
    Load,
}

fn run_growth(inline: bool, fault: Fault) {
    const DATA: u64 = DRAM_BASE + 0x4000;
    const MMIO: u64 = 0x1000_0000;
    const BAD: u64 = 0x5000_0000;
    const VIRTUAL_PC: u64 = 0x4000_6000;
    const SENTINEL: u64 = 0x0123_4567_89ab_cdef;
    // Independent literal words: addi x12; flw f31,0(x5); fsd f31,0(x6);
    // addi x13; fld f0,0(x7); addi x14. All addi instructions add one.
    let words = [
        0x0016_0613,
        0x0002_af87,
        0x01f3_3027,
        0x0016_8693,
        0x0003_b007,
        0x0017_0713,
    ];
    let block = DecodedBlock::new(
        DRAM_BASE,
        words
            .iter()
            .map(|&raw| MicroOp {
                instr: decode(raw).expect("independent FP growth encoding"),
                len: 4,
                raw,
            })
            .collect(),
        24,
    );
    let mut machine = Machine::new(64 * 1024);
    machine.bus_mut().store32(DATA, 0xffa1_2345).unwrap();
    machine
        .bus_mut()
        .store64(DATA + 8, 0x7ff0_0000_0000_1234)
        .unwrap();
    let writes = Rc::new(Cell::new(0));
    let payload = Rc::new(Cell::new(0));
    machine
        .bus_mut()
        .attach(
            MMIO,
            8,
            Box::new(GrowOnFpStore {
                memory: wasm_bindgen::memory().unchecked_into::<WebAssembly::Memory>(),
                writes: Rc::clone(&writes),
                payload: Rc::clone(&payload),
                fault: matches!(fault, Fault::Store),
            }),
        )
        .unwrap();
    machine
        .hart_mut()
        .csr
        .access(MSTATUS, CsrOp::Write, 2 << 13, false, false, 0)
        .unwrap();
    machine.hart_mut().csr.fflags = 21;
    machine.hart_mut().csr.frm = 6;
    machine.hart_mut().regs.pc = VIRTUAL_PC;
    machine.hart_mut().regs.write(5, DATA);
    machine.hart_mut().regs.write(6, MMIO);
    machine.hart_mut().regs.write(
        7,
        if matches!(fault, Fault::Load) {
            BAD
        } else {
            DATA + 8
        },
    );
    for (r, value) in [(12, 7), (13, 9), (14, 11)] {
        machine.hart_mut().regs.write(r, value);
    }
    machine.hart_mut().fregs.write_raw(0, SENTINEL);
    machine.hart_mut().fregs.write_raw(31, SENTINEL);
    let mut executor = if inline {
        BrowserExecutor::new_inline(&machine).unwrap()
    } else {
        BrowserExecutor::new()
    };
    executor.install(&block);
    assert!(executor.is_compiled(DRAM_BASE));
    let machine_ptr: *mut Machine = &mut machine;
    // SAFETY: the live Machine owns disjoint Hart/SystemBus components, borrowed
    // only for this synchronous generated call. Wasm memory growth preserves offsets.
    let exit = unsafe {
        executor
            .execute(
                DRAM_BASE,
                (*machine_ptr).hart_mut(),
                (*machine_ptr).bus_mut(),
            )
            .expect("a recorded memory outcome returns an exact exit")
    };
    let (want_pc, want_retired, want_trap) = match fault {
        Fault::None => (VIRTUAL_PC + 24, 6, None),
        Fault::Store => (
            VIRTUAL_PC + 8,
            2,
            Some(Trap {
                cause: Exception::StoreAccessFault,
                tval: MMIO,
            }),
        ),
        Fault::Load => (
            VIRTUAL_PC + 16,
            4,
            Some(Trap {
                cause: Exception::LoadAccessFault,
                tval: BAD,
            }),
        ),
    };
    console_log!(
        "CRITIC_GROWTH inline={} fault={:?} code={:?} pc={:016x} retired={} trap={:?} f31={:016x} f0={:016x} writes={} payload={:016x}",
        inline,
        fault,
        exit.code,
        exit.next_pc,
        exit.retired,
        exit.trap,
        machine.hart().fregs.read_raw(31),
        machine.hart().fregs.read_raw(0),
        writes.get(),
        payload.get(),
    );
    assert_eq!(
        exit.code,
        if want_trap.is_some() {
            ExitCode::Trap
        } else {
            ExitCode::Fallthrough
        }
    );
    assert_eq!(exit.trap, want_trap);
    assert_eq!(exit.next_pc, want_pc);
    assert_eq!(exit.retired, if inline { want_retired } else { 0 });
    assert_eq!(writes.get(), 1, "the FP MMIO store must not replay");
    assert_eq!(
        payload.get(),
        0xffff_ffff_ffa1_2345,
        "CRITIC_GROWTH_RAW_SIGNALING_PAYLOAD"
    );
    assert_eq!(machine.hart().fregs.read_raw(31), 0xffff_ffff_ffa1_2345);
    assert_eq!(
        machine.hart().fregs.read_raw(0),
        if matches!(fault, Fault::None) {
            0x7ff0_0000_0000_1234
        } else {
            SENTINEL
        }
    );
    assert_eq!(machine.hart().csr.fs(), 3);
    assert_eq!(machine.hart().csr.fflags, 21);
    assert_eq!(machine.hart().csr.frm, 6);
    assert_eq!(machine.hart().regs.read(12), 8);
    assert_eq!(
        machine.hart().regs.read(13),
        if matches!(fault, Fault::Store) { 9 } else { 10 }
    );
    assert_eq!(
        machine.hart().regs.read(14),
        if matches!(fault, Fault::None) { 12 } else { 11 }
    );
    assert_eq!(machine.hart().regs.pc, VIRTUAL_PC, "caller owns PC commit");
}

#[wasm_bindgen_test]
fn critic_fp_growth_private_success_and_precise_faults() {
    for fault in [Fault::None, Fault::Store, Fault::Load] {
        run_growth(false, fault);
    }
}

#[wasm_bindgen_test]
fn critic_fp_growth_shared_success_and_precise_faults() {
    for fault in [Fault::None, Fault::Store, Fault::Load] {
        run_growth(true, fault);
    }
}
