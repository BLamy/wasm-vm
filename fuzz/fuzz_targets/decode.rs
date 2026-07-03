//! E0-T21 fuzz target: the decoder must never panic on ANY input, and every word it
//! accepts must round-trip through an independent re-encode. The exhaustive sweep already
//! proves no-panic over all 2^32 words; this target is the reusable libFuzzer SCAFFOLD
//! (coverage-guided, corpus-seeded from real `.text`) that every later parser — ELF
//! loader, virtio rings, device configs — will clone.
#![no_main]

use libfuzzer_sys::fuzz_target;
use wasm_vm_core::decode::decode;

fuzz_target!(|data: &[u8]| {
    // Each little-endian 4-byte window is an instruction word.
    for chunk in data.chunks_exact(4) {
        let w = u32::from_le_bytes([chunk[0], chunk[1], chunk[2], chunk[3]]);
        // Must not panic. (A legal decode's round-trip is exhaustively checked elsewhere;
        // here we just exercise the decoder under coverage guidance.)
        let _ = decode(w);
    }
});
