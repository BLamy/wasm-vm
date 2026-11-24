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

/// A fixed, seeded byte stream for the virtio-rng device (`--virtio-rng-seed`). NOT entropy: it
/// exists only so a run that needs the rng slot present (a snapshot taken with it) can be
/// reproduced bit-for-bit for equivalence evidence. splitmix64, one output word per 8 bytes.
pub struct SeededEntropy(pub u64);

impl EntropySource for SeededEntropy {
    fn fill(&mut self, out: &mut [u8]) {
        for chunk in out.chunks_mut(8) {
            self.0 = self.0.wrapping_add(0x9E37_79B9_7F4A_7C15);
            let mut z = self.0;
            z = (z ^ (z >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
            z = (z ^ (z >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
            z ^= z >> 31;
            chunk.copy_from_slice(&z.to_le_bytes()[..chunk.len()]);
        }
    }
}
