//! Actual wasm32 execution of the exact native integer replay fixtures.
#![cfg(target_arch = "wasm32")]

#[path = "../../core/tests/integer_replay.rs"]
mod cases;
