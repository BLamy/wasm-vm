#![cfg(all(target_arch = "wasm32", not(feature = "zicsr-stub")))]

#[path = "../../core/tests/clock_advance.rs"]
mod core_clock_advance;
