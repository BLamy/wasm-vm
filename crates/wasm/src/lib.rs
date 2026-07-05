//! wasm-vm-wasm: the thin `wasm-bindgen` boundary over `wasm-vm-core`.
//!
//! Rule of the house: this crate adapts types and marshals calls. Emulator logic that
//! sneaks in here can't be tested natively and doesn't survive review.

use wasm_bindgen::prelude::*;

/// The core crate version, exposed to JS.
#[wasm_bindgen]
pub fn version() -> String {
    wasm_vm_core::version().into()
}

/// JS-facing handle over [`wasm_vm_core::Machine`].
#[wasm_bindgen]
pub struct WasmMachine {
    inner: wasm_vm_core::Machine,
}

#[wasm_bindgen]
impl WasmMachine {
    /// Construct a machine with `ram_bytes` of zeroed guest RAM.
    #[wasm_bindgen(constructor)]
    pub fn new(ram_bytes: usize) -> WasmMachine {
        WasmMachine {
            inner: wasm_vm_core::Machine::new(ram_bytes),
        }
    }

    /// Size of guest RAM in bytes.
    #[wasm_bindgen(js_name = ramLen)]
    pub fn ram_len(&self) -> usize {
        self.inner.ram_len()
    }
}
