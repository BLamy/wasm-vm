#![cfg(target_arch="wasm32")]
use wasm_bindgen_test::wasm_bindgen_test;
#[path="../../../../crates/storage/tests/checkpoint_context/cases.rs"] mod cases;
#[wasm_bindgen_test] fn exact_cursor_and_keys(){cases::exact_cursor_and_keys();}
#[wasm_bindgen_test] fn refuse_shapes_versions_and_unrecorded_modes(){cases::refuse_shapes_versions_and_unrecorded_modes();}
