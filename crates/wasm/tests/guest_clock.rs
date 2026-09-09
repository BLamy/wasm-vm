//! Run the same guest-instruction clock/lifecycle fixtures on the 32-bit WASM target.
#![cfg(all(target_arch = "wasm32", not(feature = "zicsr-stub")))]

#[path = "../../core/tests/guest_clock.rs"]
mod guest_clock;
