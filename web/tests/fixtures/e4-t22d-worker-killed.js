// Deliberately terminate before the CPU-worker ready handshake. The host must turn this into a
// bounded fatal/rejection instead of leaving bootCpuWorker's promise pending forever.
self.addEventListener("message", () => self.close(), { once: true });
