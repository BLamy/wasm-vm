#![cfg(all(target_arch = "wasm32", not(feature = "zicsr-stub")))]

#[path = "../../core/tests/paced_idle_clock.rs"]
mod paced_idle_clock;
