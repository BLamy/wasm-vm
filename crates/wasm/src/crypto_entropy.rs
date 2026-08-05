//! Browser-backed entropy source for the wasm virtio-rng device. `getrandom`'s js backend calls
//! `crypto.getRandomValues` (available on both the main thread and Web Workers), chunking to the
//! 65536-byte per-call limit for us. This is the browser's CSPRNG — the strongest entropy the tab
//! can offer — fed into the guest CRNG through `/dev/hwrng`.

use wasm_vm_core::dev::virtio::rng::EntropySource;

pub(crate) struct CryptoEntropy;

impl EntropySource for CryptoEntropy {
    fn fill(&mut self, out: &mut [u8]) {
        // The guest kernel credits this device as a hardware RNG, so predictable fallback bytes
        // would silently weaken guest keys. Fail closed if Web Crypto is unavailable.
        getrandom::getrandom(out).expect("Web Crypto CSPRNG unavailable for virtio-rng");
    }
}
