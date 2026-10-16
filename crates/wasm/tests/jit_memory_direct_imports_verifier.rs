#![cfg(target_arch = "wasm32")]
//! Independent E5.5-T03bg critic: stale ambient-context and reservation isolation.
//! Two guests intentionally use identical guest addresses and different literal data.

use wasm_bindgen::prelude::*;
use wasm_bindgen_test::*;
use wasm_vm_core::Machine;
use wasm_vm_core::bus::{Bus, mmap::DRAM_BASE};
use wasm_vm_core::decode::{AmoOp, Instr};
use wasm_vm_core::dispatch::{DecodedBlock, MicroOp};
use wasm_vm_core::jit::{CompiledBlockExecutor, ExitCode};
use wasm_vm_wasm::BrowserExecutor;

#[wasm_bindgen(inline_js = r#"
export function criticMemoryInactive(exports) {
  const probes = [
    ['load', [0xfffffffffffffff8n, 3]],
    ['store', [0xfffffffffffffff8n, 0xfeedface98765432n, 8]],
    ['amo', [0xfffffffffffffff8n, 0xfeedface98765432n, 1, 8]],
    ['lr', [0xfffffffffffffff8n, 8]],
    ['sc', [0xfffffffffffffff8n, 0xfeedface98765432n, 8]],
  ];
  for (const [name,args] of probes) {
    let caught = false;
    try { exports['__jit_' + name](...args); }
    catch (error) {
      if (error !== null) throw new Error('CRITIC_INACTIVE_WRONG_EXCEPTION ' + name + ': ' + error);
      caught = true;
    }
    if (!caught) throw new Error('CRITIC_INACTIVE_RETURNED ' + name);
  }
  return probes.length;
}
export function criticMemoryBufferKind(buffer) {
  return Object.prototype.toString.call(buffer);
}
"#)]
extern "C" {
    #[wasm_bindgen(catch, js_name = criticMemoryInactive)]
    fn inactive(exports: &JsValue) -> Result<u32, JsValue>;
    #[wasm_bindgen(js_name = criticMemoryBufferKind)]
    fn buffer_kind(buffer: &JsValue) -> String;
}

const DATA: u64 = DRAM_BASE + 0x4000;
const A: u64 = 0x8000_0000_ffff_fffe;
const B: u64 = 0xffff_fffe_8000_0001;
const STORED_A: u64 = 0xfedc_ba98_7654_3210;
const STORED_B: u64 = 0x8765_4321_fedc_ba98;

fn block(at: u64, ops: &[Instr]) -> DecodedBlock {
    DecodedBlock::new(
        at,
        ops.iter()
            .copied()
            .map(|instr| MicroOp {
                instr,
                len: 4,
                raw: 0,
            })
            .collect(),
        4 * ops.len() as u64,
    )
}

fn install(machine: &Machine, inline: bool) -> BrowserExecutor {
    let mut executor = if inline {
        BrowserExecutor::new_inline(machine).unwrap()
    } else {
        BrowserExecutor::new()
    };
    for (index, ops) in [
        vec![
            Instr::Ld {
                rd: 7,
                rs1: 6,
                imm: 0,
            },
            Instr::Sd {
                rs1: 6,
                rs2: 5,
                imm: 8,
            },
        ],
        vec![Instr::LrD {
            rd: 8,
            rs1: 6,
            aq: true,
            rl: true,
        }],
        vec![Instr::ScD {
            rd: 9,
            rs1: 6,
            rs2: 5,
            aq: true,
            rl: true,
        }],
        vec![Instr::AmoD {
            op: AmoOp::Add,
            rd: 10,
            rs1: 6,
            rs2: 5,
            aq: true,
            rl: true,
        }],
    ]
    .into_iter()
    .enumerate()
    {
        let at = DRAM_BASE + index as u64 * 0x100;
        executor.install(&block(at, &ops));
        assert!(executor.is_compiled(at));
    }
    executor
}

fn execute(executor: &mut BrowserExecutor, machine: &mut Machine, index: u64, inline: bool) {
    let at = DRAM_BASE + index * 0x100;
    machine.hart_mut().regs.pc = at;
    let before = executor.executed_blocks();
    let ptr: *mut Machine = machine;
    // SAFETY: the synchronous compiled invocation borrows disjoint machine components.
    let exit = unsafe {
        executor
            .execute(at, (*ptr).hart_mut(), (*ptr).bus_mut())
            .unwrap()
    };
    let instructions = if index == 0 { 2 } else { 1 };
    assert_eq!(executor.executed_blocks(), before + 1);
    assert_eq!(exit.code, ExitCode::Fallthrough);
    assert_eq!(exit.next_pc, at + 4 * instructions);
    assert_eq!(exit.retired, if inline { instructions } else { 0 });
    assert_eq!(exit.trap, None);
    assert_eq!(inactive(&wasm_bindgen::exports()).unwrap(), 5);
}

fn alternating_guests(inline: bool) {
    // Probe before any guest exists; repeating after every compiled call detects
    // stale context publication while the allocations are still live as well.
    assert_eq!(inactive(&wasm_bindgen::exports()).unwrap(), 5);
    let mut first = Machine::new(64 * 1024);
    let mut survivor = Machine::new(64 * 1024);
    first.bus_mut().store64(DATA, A).unwrap();
    survivor.bus_mut().store64(DATA, B).unwrap();
    first.hart_mut().regs.write(6, DATA);
    survivor.hart_mut().regs.write(6, DATA);
    first.hart_mut().regs.write(5, STORED_A);
    survivor.hart_mut().regs.write(5, STORED_B);
    let mut first_executor = install(&first, inline);
    let mut survivor_executor = install(&survivor, inline);

    execute(&mut first_executor, &mut first, 0, inline);
    execute(&mut survivor_executor, &mut survivor, 0, inline);
    assert_eq!(first.hart().regs.read(7), A);
    assert_eq!(survivor.hart().regs.read(7), B);
    assert_eq!(first.bus_mut().load64(DATA + 8).unwrap(), STORED_A);
    assert_eq!(survivor.bus_mut().load64(DATA + 8).unwrap(), STORED_B);

    execute(&mut first_executor, &mut first, 1, inline);
    execute(&mut survivor_executor, &mut survivor, 1, inline);
    assert_eq!(first.hart().regs.read(8), A);
    assert_eq!(survivor.hart().regs.read(8), B);
    assert_eq!(first.hart().resv, Some((DATA, 8)));
    assert_eq!(survivor.hart().resv, Some((DATA, 8)));
    execute(&mut first_executor, &mut first, 2, inline);
    assert_eq!(first.hart().regs.read(9), 0);
    assert_eq!(first.hart().resv, None);
    assert_eq!(first.bus_mut().load64(DATA).unwrap(), STORED_A);
    assert_eq!(survivor.hart().resv, Some((DATA, 8)));
    assert_eq!(survivor.bus_mut().load64(DATA).unwrap(), B);

    // Drop the last-entered guest and executor, then re-enter its survivor.
    drop(first_executor);
    drop(first);
    assert_eq!(inactive(&wasm_bindgen::exports()).unwrap(), 5);
    execute(&mut survivor_executor, &mut survivor, 2, inline);
    assert_eq!(survivor.hart().regs.read(9), 0);
    assert_eq!(survivor.hart().resv, None);
    assert_eq!(survivor.bus_mut().load64(DATA).unwrap(), STORED_B);

    survivor.hart_mut().regs.write(5, 0x8000_0000_0000_0001);
    execute(&mut survivor_executor, &mut survivor, 3, inline);
    assert_eq!(survivor.hart().regs.read(10), STORED_B);
    assert_eq!(
        survivor.bus_mut().load64(DATA).unwrap(),
        0x0765_4321_fedc_ba99
    );
    assert_eq!(survivor.hart().resv, None);

    let memory = wasm_bindgen::memory().unchecked_into::<js_sys::WebAssembly::Memory>();
    let actual_buffer_kind = buffer_kind(&memory.buffer());
    let before_bytes = js_sys::Uint8Array::new(&memory.buffer()).length();
    memory.grow(1);
    let grown = js_sys::Uint8Array::new(&memory.buffer()).length() - before_bytes;
    assert_eq!(grown, 65_536);
    execute(&mut survivor_executor, &mut survivor, 0, inline);
    assert_eq!(survivor.hart().regs.read(7), 0x0765_4321_fedc_ba99);
    assert_eq!(
        survivor.bus_mut().load64(DATA + 8).unwrap(),
        0x8000_0000_0000_0001
    );
    drop(survivor_executor);
    drop(survivor);
    assert_eq!(inactive(&wasm_bindgen::exports()).unwrap(), 5);
    console_log!(
        "CRITIC_DIRECT_MEMORY_LIFETIME inline={} compiled_executions=8 inactive_calls=55 growth={} buffer={} reservation_isolation=true",
        inline,
        grown,
        actual_buffer_kind
    );
}

#[wasm_bindgen_test]
fn verifier_private_memory_interleaved_lifetime() {
    alternating_guests(false);
}

#[wasm_bindgen_test]
fn verifier_inline_memory_interleaved_lifetime() {
    alternating_guests(true);
}
