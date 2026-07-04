//! E1-T22 (wasm32 side): the wasm build produces the SAME determinism fingerprints as the native
//! build. This asserts the identical frozen golden that `crates/core/tests/determinism.rs` asserts
//! natively — so the two builds are the same machine (native == wasm32) transitively, the whole
//! premise of "debug natively, ship WASM". Run by `wasm-pack test --node crates/wasm`.
#![cfg(target_arch = "wasm32")]

use wasm_bindgen_test::wasm_bindgen_test;
use wasm_vm_core::Machine;
use wasm_vm_core::trace::HashSink;

include!("../../../tests/golden/determinism_golden.rs");

/// The pinned ELFs embedded into the wasm binary (no filesystem under wasm/node). Kept in lockstep
/// with `GOLDEN` — the assertion below fails loudly if a name has no golden row.
const PINNED: &[(&str, &[u8])] = &[
    (
        "rv64ui-p-add",
        include_bytes!("../../../tests/riscv-tests-bin/rv64ui-p-add"),
    ),
    (
        "rv64um-p-mulh",
        include_bytes!("../../../tests/riscv-tests-bin/rv64um-p-mulh"),
    ),
    (
        "rv64ua-p-amoadd_d",
        include_bytes!("../../../tests/riscv-tests-bin/rv64ua-p-amoadd_d"),
    ),
    (
        "rv64ud-p-fadd",
        include_bytes!("../../../tests/riscv-tests-bin/rv64ud-p-fadd"),
    ),
    (
        "rv64uc-p-rvc",
        include_bytes!("../../../tests/riscv-tests-bin/rv64uc-p-rvc"),
    ),
];

#[wasm_bindgen_test]
fn pinned_fingerprints_match_golden_on_wasm() {
    for (name, bytes) in PINNED {
        let mut m = Machine::new(RAM_BYTES);
        m.load_elf(bytes).unwrap();
        let mut hs = HashSink::new();
        let _ = m.run_traced(5_000_000, &mut hs);
        let digest = m.snapshot().hex_digest();
        let state = final_state_hash(&mut m);
        let (_, ghash, gret, gdigest, gstate) = GOLDEN
            .iter()
            .find(|(n, _, _, _, _)| n == name)
            .expect("pinned ELF must have a golden row");
        assert_eq!(
            hs.hash(),
            *ghash,
            "{name}: wasm trace hash != native golden"
        );
        assert_eq!(
            hs.retired(),
            *gret,
            "{name}: wasm retire count != native golden"
        );
        assert_eq!(&digest, gdigest, "{name}: wasm RAM digest != native golden");
        assert_eq!(
            state, *gstate,
            "{name}: wasm final-state (f-regs/fcsr/CSRs) hash != native golden"
        );
    }
}
