//! wasm-vm-wasm: the thin `wasm-bindgen` boundary over `wasm-vm-core`.
//!
//! Rule of the house: this crate adapts types and marshals calls. Emulator logic that
//! sneaks in here can't be tested natively and doesn't survive review.

use core::sync::atomic::{AtomicBool, Ordering};

use wasm_bindgen::prelude::*;

/// One-time browser diagnostics setup: route `log` to the JS console and install the
/// panic hook that turns Rust panics into readable console errors. Idempotent — the
/// guard makes a second call a no-op, since `console_log::init` and the panic hook both
/// misbehave if run twice.
#[wasm_bindgen(js_name = initLogging)]
pub fn init_logging() {
    static DONE: AtomicBool = AtomicBool::new(false);
    if DONE.swap(true, Ordering::SeqCst) {
        return;
    }
    console_error_panic_hook::set_once();
    // Ignore the Err if a host already installed a logger.
    let _ = console_log::init_with_level(log::Level::Debug);
}

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
