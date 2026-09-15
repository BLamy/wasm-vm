#![cfg(target_arch = "wasm32")]
//! Independent E5.5-T03u memory-authority attacks, predicted before evidence.
use wasm_bindgen_test::*;
use wasm_vm_core::Machine;
use wasm_vm_core::bus::{Bus, mmap::DRAM_BASE};
use wasm_vm_core::csr::{CsrOp, MSTATUS, Priv};
use wasm_vm_core::decode::decode;
use wasm_vm_core::dispatch::{DecodedBlock, MicroOp};
use wasm_vm_core::hart::{Exception, Trap};
use wasm_vm_core::jit::{CompiledBlockExecutor, ExitCode};
use wasm_vm_wasm::BrowserExecutor;

fn block(words: &[u32]) -> DecodedBlock {
    DecodedBlock::new(
        DRAM_BASE,
        words
            .iter()
            .map(|&raw| MicroOp {
                instr: decode(raw).expect("independent legal memory encoding"),
                len: 4,
                raw,
            })
            .collect(),
        words.len() as u64 * 4,
    )
}

fn pmp_adjacent_word(store: bool, fp: bool, inline: bool) {
    const DATA: u64 = DRAM_BASE + 0x4000;
    const VIRTUAL_PC: u64 = 0x4000_2000;
    let words = match (store, fp) {
        (false, true) => [0x0002_a007, 0x0042_a087], // flw f0,0(x5); flw f1,4(x5)
        (true, true) => [0x0002_a027, 0x0012_a227],  // fsw f0,0(x5); fsw f1,4(x5)
        (false, false) => [0x0002_a303, 0x0042_a383], // lw x6,0(x5); lw x7,4(x5)
        (true, false) => [0x0062_a023, 0x0072_a223], // sw x6,0(x5); sw x7,4(x5)
    };
    let mut machine = Machine::new(64 * 1024);
    machine.bus_mut().store32(DATA, 0x7fa1_2345).unwrap();
    machine.bus_mut().store32(DATA + 4, 0x8123_4567).unwrap();
    machine
        .hart_mut()
        .csr
        .access(MSTATUS, CsrOp::Write, 2 << 13, false, false, 0)
        .unwrap();
    machine.hart_mut().csr.mode = Priv::S;
    // NA4 entry 0 grants R/W for exactly one four-byte word. With no other
    // enabled entry, S-mode cannot access the next word in the same page.
    machine.hart_mut().csr.pmp.write_addr(0, DATA >> 2);
    machine.hart_mut().csr.pmp.write_cfg(0, 0x13);
    machine.hart_mut().regs.write(5, DATA);
    machine.hart_mut().regs.write(6, 0xffa1_2345);
    machine.hart_mut().regs.write(7, 0x7fa0_5678);
    machine.hart_mut().fregs.write_raw(0, 0x0123_4567_ffa1_2345);
    machine.hart_mut().fregs.write_raw(1, 0x89ab_cdef_7fa0_5678);
    machine.hart_mut().regs.pc = VIRTUAL_PC;
    let mut executor = if inline {
        BrowserExecutor::new_inline(&machine).unwrap()
    } else {
        BrowserExecutor::new()
    };
    executor.install(&block(&words));
    assert!(executor.is_compiled(DRAM_BASE));
    let machine_ptr: *mut Machine = &mut machine;
    // SAFETY: these are disjoint components borrowed for one synchronous call.
    let exit = unsafe {
        executor
            .execute(
                DRAM_BASE,
                (*machine_ptr).hart_mut(),
                (*machine_ptr).bus_mut(),
            )
            .expect("compiled two-access attack returns an exit")
    };
    let data0 = machine.bus_mut().load32(DATA).unwrap();
    let data1 = machine.bus_mut().load32(DATA + 4).unwrap();
    console_log!(
        "CRITIC_PMP inline={} fp={} store={} code={:?} pc={:016x} retired={} trap={:?} f0={:016x} f1={:016x} x6={:016x} x7={:016x} data0={:08x} data1={:08x}",
        inline,
        fp,
        store,
        exit.code,
        exit.next_pc,
        exit.retired,
        exit.trap,
        machine.hart().fregs.read_raw(0),
        machine.hart().fregs.read_raw(1),
        machine.hart().regs.read(6),
        machine.hart().regs.read(7),
        data0,
        data1,
    );
    assert_eq!(exit.code, ExitCode::Trap, "CRITIC_PMP_NEXT_WORD_DENIED");
    assert_eq!(exit.next_pc, VIRTUAL_PC + 4);
    assert_eq!(
        exit.trap,
        Some(Trap {
            cause: if store {
                Exception::StoreAccessFault
            } else {
                Exception::LoadAccessFault
            },
            tval: DATA + 4,
        })
    );
    assert_eq!(exit.retired, u64::from(inline));
    assert_eq!(
        data1, 0x8123_4567,
        "faulting store leaves adjacent word intact"
    );
    if fp {
        assert_eq!(machine.hart().fregs.read_raw(1), 0x89ab_cdef_7fa0_5678);
        assert_eq!(
            machine.hart().fregs.read_raw(0),
            if store {
                0x0123_4567_ffa1_2345
            } else {
                0xffff_ffff_7fa1_2345
            }
        );
        assert_eq!(machine.hart().csr.fs(), if store { 2 } else { 3 });
    } else if !store {
        assert_eq!(machine.hart().regs.read(7), 0x7fa0_5678);
        assert_eq!(machine.hart().regs.read(6), 0x7fa1_2345);
    }
}

#[wasm_bindgen_test]
fn critic_pmp_two_fp_loads_respect_narrow_authority() {
    for inline in [false, true] {
        pmp_adjacent_word(false, true, inline);
    }
}

#[wasm_bindgen_test]
fn critic_pmp_two_fp_stores_respect_narrow_authority() {
    for inline in [false, true] {
        pmp_adjacent_word(true, true, inline);
    }
}

#[wasm_bindgen_test]
fn critic_pmp_integer_load_control() {
    for inline in [false, true] {
        pmp_adjacent_word(false, false, inline);
    }
}

#[wasm_bindgen_test]
fn critic_pmp_integer_store_control() {
    for inline in [false, true] {
        pmp_adjacent_word(true, false, inline);
    }
}
