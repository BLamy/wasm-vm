//! E0-T22: the `#[wasm_bindgen]` boundary, exercised under `wasm-pack test --node`.
//! Every acceptance criterion + the re-entrancy attack.
#![cfg(target_arch = "wasm32")]

use std::cell::RefCell;
use std::rc::Rc;

use wasm_bindgen::JsCast;
use wasm_bindgen::prelude::*;
use wasm_bindgen_test::wasm_bindgen_test;
use wasm_vm_wasm::WasmMachine;

const HELLO: &[u8] = include_bytes!("../../../guest/prebuilt/hello.elf");
const LOOPS: &[u8] = include_bytes!("../../../guest/prebuilt/loops.elf");
const LOOPS_GOLDEN: &str = include_str!("../../../docs/golden/loops.trace.txt");
/// Native `wasm-vm run hello.elf --dump-state` digest at the 128 MiB default (E0-T17).
const HELLO_DIGEST_128MIB: &str =
    "df49438130a9da1733bd689ccf2327837ac09385f8e91ea685359f1b915ceb05";

/// Attach a console callback that appends every byte to a shared buffer.
fn capture(m: &WasmMachine) -> Rc<RefCell<Vec<u8>>> {
    let buf = Rc::new(RefCell::new(Vec::new()));
    let sink = buf.clone();
    let cb =
        Closure::wrap(Box::new(move |byte: u8| sink.borrow_mut().push(byte)) as Box<dyn FnMut(u8)>);
    m.set_console(cb.as_ref().unchecked_ref::<js_sys::Function>().clone())
        .unwrap();
    cb.forget(); // keep the closure alive for the machine's lifetime
    buf
}

fn get_str(v: &JsValue, key: &str) -> Option<String> {
    js_sys::Reflect::get(v, &JsValue::from_str(key))
        .ok()
        .and_then(|x| x.as_string())
}
fn get_num(v: &JsValue, key: &str) -> Option<f64> {
    js_sys::Reflect::get(v, &JsValue::from_str(key))
        .ok()
        .and_then(|x| x.as_f64())
}

#[wasm_bindgen_test]
fn hello_console_bytes_and_exit_status() {
    let m = WasmMachine::new(128);
    let out = capture(&m);
    m.load_elf(HELLO).unwrap();
    let status = m.run(1_000_000).unwrap();

    assert_eq!(get_str(&status, "kind").as_deref(), Some("exited"));
    assert_eq!(get_num(&status, "code"), Some(0.0));
    // retired must equal the native CLI's retired= for the same ELF.
    assert_eq!(get_num(&status, "retired"), Some(83.0));
    assert_eq!(
        &*out.borrow(),
        b"Hello from RV64\n",
        "console bytes, in order"
    );
}

#[wasm_bindgen_test]
fn loops_trace_first_40_lines_match_golden() {
    let m = WasmMachine::new(1);
    m.set_trace(true).unwrap();
    m.load_elf(LOOPS).unwrap();
    m.run(1_000_000).unwrap();
    let trace = m.take_trace().unwrap();
    let first40: String = trace.lines().take(40).map(|l| format!("{l}\n")).collect();
    assert_eq!(
        first40, LOOPS_GOLDEN,
        "canonical trace drifted from the E0-T16 golden"
    );
}

#[wasm_bindgen_test]
fn malformed_elf_throws_named_error_and_machine_survives() {
    let m = WasmMachine::new(1);
    let err: JsValue = m.load_elf(b"not an ELF at all").unwrap_err().into();
    let msg = get_str(&err, "message").unwrap_or_default();
    assert!(
        msg.contains("BadMagic"),
        "message must name the ElfError variant: {msg}"
    );
    // The machine is still usable: a valid ELF now loads and runs.
    m.load_elf(LOOPS).unwrap();
    let status = m.run(1_000_000).unwrap();
    assert_eq!(get_str(&status, "kind").as_deref(), Some("exited"));
}

#[wasm_bindgen_test]
fn run_before_load_and_after_exit_throw() {
    let m = WasmMachine::new(1);
    assert!(m.run(10).is_err(), "run before load_elf must throw");
    m.load_elf(LOOPS).unwrap();
    m.run(1_000_000).unwrap(); // runs to HTIF exit
    assert!(m.run(10).is_err(), "run after exit must throw");
    assert!(m.step(10).is_err(), "step after exit must throw");
}

#[wasm_bindgen_test]
fn state_digest_matches_native_dump_state() {
    let m = WasmMachine::new(128);
    m.load_elf(HELLO).unwrap();
    m.run(1_000_000).unwrap();
    assert_eq!(m.state_digest().unwrap(), HELLO_DIGEST_128MIB);
}

#[wasm_bindgen_test]
fn registers_expose_pc_and_32_gprs() {
    let m = WasmMachine::new(1);
    m.load_elf(LOOPS).unwrap();
    m.run(1_000_000).unwrap();
    let regs = m.registers().unwrap();
    assert_eq!(regs.length(), 33, "pc + x0..x31");
    assert_eq!(regs.get_index(1), 0, "x0 is always zero");
}

#[wasm_bindgen_test]
fn reentrant_console_callback_is_a_caught_error_not_an_abort() {
    // A console callback that calls back into the machine must get a thrown, catchable
    // error — never a wasm `unreachable` abort (which would crash this test).
    let m = Rc::new(WasmMachine::new(128));
    let m_cb = m.clone();
    let saw_error = Rc::new(RefCell::new(None::<bool>));
    let record = saw_error.clone();
    let cb = Closure::wrap(Box::new(move |_byte: u8| {
        // Re-enter during the callback; must return Err, not abort.
        *record.borrow_mut() = Some(m_cb.step(1).is_err());
    }) as Box<dyn FnMut(u8)>);
    m.set_console(cb.as_ref().unchecked_ref::<js_sys::Function>().clone())
        .unwrap();
    cb.forget();

    m.load_elf(HELLO).unwrap();
    let _ = m.run(1_000_000); // first console byte fires the re-entrant callback
    assert_eq!(
        *saw_error.borrow(),
        Some(true),
        "re-entrant step() must return a caught error"
    );
}
