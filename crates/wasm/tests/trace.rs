//! wasm32 trace determinism (E0-T16): the canonical trace of loops.elf produced on
//! wasm32 must equal the committed golden — which the native test also asserts, so
//! native and wasm are byte-identical transitively.

#![cfg(target_arch = "wasm32")]

use wasm_bindgen_test::wasm_bindgen_test;
use wasm_vm_core::Machine;
use wasm_vm_core::trace::{VecSink, fmt_canonical};

const LOOPS: &[u8] = include_bytes!("../../core/tests/../../../guest/prebuilt/loops.elf");
const GOLDEN: &str = include_str!("../../core/tests/../../../docs/golden/loops.trace.txt");

#[wasm_bindgen_test]
fn loops_canonical_trace_matches_golden_on_wasm32() {
    let mut m = Machine::new(64 * 1024);
    m.load_elf(LOOPS).unwrap();
    let mut sink = VecSink::new();
    while sink.records.len() < 40 {
        if m.step_traced(&mut sink).is_err() {
            break;
        }
        if m.htif_exit().is_some() {
            break;
        }
    }
    let mut s = String::new();
    use core::fmt::Write as _;
    for r in sink.records.iter().take(40) {
        writeln!(s, "{}", fmt_canonical(r)).unwrap();
    }
    assert_eq!(
        s, GOLDEN,
        "wasm32 canonical trace differs from the committed golden"
    );
}
