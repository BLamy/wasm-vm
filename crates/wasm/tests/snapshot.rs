//! wasm32 snapshot determinism (E0-T17): running `loops.elf` to exit in 1 MiB of RAM on
//! wasm32 must yield the SAME `Snapshot` (pc, every xreg, memory digest) as the native
//! run — which the native test (`crates/core/tests/snapshot.rs`) also pins to this golden,
//! so native and wasm are byte-identical transitively. Pins down any float/endian/word
//! assumption (there should be none).

#![cfg(target_arch = "wasm32")]

use wasm_bindgen_test::wasm_bindgen_test;
use wasm_vm_core::{Machine, RunOutcome};

const LOOPS: &[u8] = include_bytes!("../../../guest/prebuilt/loops.elf");

#[wasm_bindgen_test]
fn loops_snapshot_matches_native_golden_on_wasm32() {
    let mut m = Machine::new(1024 * 1024);
    m.load_elf(LOOPS).unwrap();
    assert_eq!(m.run(1_000_000), RunOutcome::Exited(0));
    let snap = m.snapshot();

    // Same golden as crates/core/tests/snapshot.rs::loops_1mib_golden.
    let mut xregs = [0u64; 32];
    xregs[1] = 0x8000_002c;
    xregs[2] = 0x8000_2090;
    xregs[5] = 0x8000_0080;
    xregs[6] = 0x0000_000b;
    xregs[10] = 0x0000_0001;

    assert_eq!(
        snap.pc, 0x8000_0040,
        "wasm loops final pc differs from native"
    );
    assert_eq!(
        snap.xregs, xregs,
        "wasm loops register file differs from native"
    );
    assert_eq!(
        snap.hex_digest(),
        "0a18330cadd810ad35dde591012b6a8d4e6fa3d9d5487d30db12fbadde376a48",
        "wasm loops memory digest differs from native"
    );
}
