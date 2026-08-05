//! OS-backed entropy source for the native virtio-rng device. Pulls from the platform CSPRNG via
//! `getrandom` (getentropy/getrandom(2) on Linux/macOS), the same primitive the guest's own
//! userspace ultimately wants — we just feed it in early through `/dev/hwrng`.

use wasm_vm_core::dev::virtio::rng::EntropySource;

pub struct OsEntropy;

impl EntropySource for OsEntropy {
    fn fill(&mut self, out: &mut [u8]) {
        // Predictable bytes are worse than stopping: the guest kernel credits this device as a
        // hardware RNG. Fail closed if the host CSPRNG is unavailable rather than silently
        // weakening every guest key generated afterward.
        getrandom::getrandom(out).expect("host CSPRNG unavailable for virtio-rng");
    }
}
