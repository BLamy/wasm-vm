//! Execute the exact public-API native evidence producer in actual WebAssembly.
#![cfg(target_arch = "wasm32")]

use std::cell::RefCell;
use wasm_bindgen_test::wasm_bindgen_test;

thread_local! {
    static CAPTURED: RefCell<String> = const { RefCell::new(String::new()) };
}

// Preserve the producer's byte-for-byte native stdout without depending on WASI.
macro_rules! print {
    ($($arg:tt)*) => {{
        $crate::CAPTURED.with(|output| output.borrow_mut().push_str(&format!($($arg)*)));
    }};
}

macro_rules! println {
    () => {{
        $crate::CAPTURED.with(|output| output.borrow_mut().push('\n'));
    }};
    ($($arg:tt)*) => {{
        print!($($arg)*);
        $crate::CAPTURED.with(|output| output.borrow_mut().push('\n'));
    }};
}

#[path = "../../core/examples/retirement_capture_baseline.rs"]
mod producer;

#[wasm_bindgen_test]
fn actual_wasm_capture_matrix_matches_independently_retained_baseline() {
    CAPTURED.with(|output| output.borrow_mut().clear());
    producer::main();
    let output = CAPTURED.with(|output| std::mem::take(&mut *output.borrow_mut()));
    let expected = include_str!("../../../evidence/e5-t26p/baseline-semantic.stdout");
    assert_eq!(
        output, expected,
        "actual WASM differs from the old-source native baseline"
    );
    wasm_bindgen_test::console_log!("{}", output);
}
