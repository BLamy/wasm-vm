//! Virtio (spec 1.2) device framework (E2-T08): the [`VirtioDevice`] trait every backend
//! (blk in E2-T11; net/gpu/input later) implements, plus the shared mmio transport
//! ([`mmio::VirtioMmio`]). The transport owns ALL register/lifecycle/feature mechanics so a
//! backend is pure device logic.

pub mod blk;
pub mod mmio;
pub mod net;
pub mod queue;

/// Standard virtio feature bit the transport ALWAYS offers (spec 1.2 §6.1): bit 32,
/// "this device complies with virtio 1.x" — mandatory for non-legacy operation.
pub const VIRTIO_F_VERSION_1: u64 = 1 << 32;

/// A virtio backend plugged into one mmio slot. Queue RING processing arrives with
/// E2-T09/T11 (it needs bus access); this trait carries the transport-facing surface.
pub trait VirtioDevice {
    /// Device type (spec 1.2 §5): 2 = block, 1 = net, 16 = gpu, 18 = input …
    fn device_id(&self) -> u32;
    /// Device-specific feature bits (the transport ORs in [`VIRTIO_F_VERSION_1`]).
    fn device_features(&self) -> u64 {
        0
    }
    /// Number of virtqueues the device exposes.
    fn num_queues(&self) -> u32 {
        1
    }
    /// Per-queue maximum ring size (power of two, spec §2.6).
    fn queue_num_max(&self) -> u32 {
        256
    }
    /// Read from the device-specific config space (offset within 0x100+; width 1/2/4/8).
    fn config_read(&mut self, offset: u64, width: u8) -> u64 {
        let _ = (offset, width);
        0
    }
    /// Write to the device-specific config space.
    fn config_write(&mut self, offset: u64, width: u8, value: u64) {
        let _ = (offset, width, value);
    }
    /// The driver kicked queue `queue` (a QueueNotify write). Ring processing lands with
    /// E2-T09; the transport records the kick so backends/tests can observe it.
    fn queue_notify(&mut self, queue: u32) {
        let _ = queue;
    }
    /// Full device reset (Status write of 0): drop in-flight state.
    fn reset(&mut self) {}
}
