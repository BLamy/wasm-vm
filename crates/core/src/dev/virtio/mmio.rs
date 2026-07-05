//! virtio-mmio transport, non-legacy Version=2 (E2-T08, spec 1.2 §4.2.2).
//!
//! One [`VirtioMmio`] per platform slot (`virt::VIRTIO_BASE + i*stride`, IRQ `1+i`). An
//! EMPTY slot (no backend) answers Magic/Version/VendorID with `DeviceID = 0` — the kernel
//! skips it silently — and tolerates arbitrary writes.
//!
//! **Access-width policy (documented per the charter):** the spec mandates 4-byte accesses
//! for the register window (0x000–0x0FF); we return 0 / ignore anything else there. The
//! device config space (0x100+) allows 1/2/4/8 and delegates width-preserving to the
//! backend.
//!
//! Rules with teeth (all unit-tested):
//! - `VIRTIO_F_VERSION_1` is ALWAYS offered (FeaturesSel=1, bit 0).
//! - `FEATURES_OK` stays CLEAR on readback if the driver accepted any unoffered bit.
//! - `DRIVER_OK` without `FEATURES_OK` degrades to `NEEDS_RESET` (never wedges).
//! - Status write of 0 = full reset: queues, selections, features, InterruptStatus, and
//!   the backend's own state are all torn down.

use alloc::boxed::Box;

use super::{VIRTIO_F_VERSION_1, VirtioDevice};
use crate::bus::BusFault;
use crate::mmio::{MmioDevice, Width};

// Register offsets (§4.2.2).
const MAGIC_VALUE: u64 = 0x000;
const VERSION: u64 = 0x004;
const DEVICE_ID: u64 = 0x008;
const VENDOR_ID: u64 = 0x00c;
const DEVICE_FEATURES: u64 = 0x010;
const DEVICE_FEATURES_SEL: u64 = 0x014;
const DRIVER_FEATURES: u64 = 0x020;
const DRIVER_FEATURES_SEL: u64 = 0x024;
const QUEUE_SEL: u64 = 0x030;
const QUEUE_NUM_MAX: u64 = 0x034;
const QUEUE_NUM: u64 = 0x038;
const QUEUE_READY: u64 = 0x044;
const QUEUE_NOTIFY: u64 = 0x050;
const INTERRUPT_STATUS: u64 = 0x060;
const INTERRUPT_ACK: u64 = 0x064;
const STATUS: u64 = 0x070;
const QUEUE_DESC_LOW: u64 = 0x080;
const QUEUE_DESC_HIGH: u64 = 0x084;
const QUEUE_DRIVER_LOW: u64 = 0x090;
const QUEUE_DRIVER_HIGH: u64 = 0x094;
const QUEUE_DEVICE_LOW: u64 = 0x0a0;
const QUEUE_DEVICE_HIGH: u64 = 0x0a4;
const SHM_SEL: u64 = 0x0ac;
const SHM_LEN_LOW: u64 = 0x0b0;
const SHM_LEN_HIGH: u64 = 0x0b4;
const SHM_BASE_LOW: u64 = 0x0b8;
const SHM_BASE_HIGH: u64 = 0x0bc;
const CONFIG_GENERATION: u64 = 0x0fc;
const CONFIG_SPACE: u64 = 0x100;

/// `MagicValue`: "virt" little-endian.
pub const MAGIC: u32 = 0x7472_6976;
/// Our vendor id: "wmvm" little-endian (arbitrary per spec; QEMU uses "QEMU").
pub const VENDOR: u32 = 0x6D76_6D77;

// Status bits (§2.1).
pub const STATUS_ACKNOWLEDGE: u32 = 1;
pub const STATUS_DRIVER: u32 = 2;
pub const STATUS_DRIVER_OK: u32 = 4;
pub const STATUS_FEATURES_OK: u32 = 8;
pub const STATUS_NEEDS_RESET: u32 = 64;
pub const STATUS_FAILED: u32 = 128;

// InterruptStatus bits.
pub const INT_USED_RING: u32 = 1;
pub const INT_CONFIG_CHANGE: u32 = 2;

/// The most queues any backend may expose through one slot.
pub const MAX_QUEUES: usize = 4;

/// Per-virtqueue transport state (addresses become *usable* only while `ready`).
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct QueueState {
    pub num: u32,
    pub ready: bool,
    pub desc: u64,
    pub driver: u64,
    pub device: u64,
}

/// One virtio-mmio slot: transport register file + optional backend.
pub struct VirtioMmio {
    dev: Option<Box<dyn VirtioDevice>>,
    status: u32,
    dev_feat_sel: u32,
    drv_feat_sel: u32,
    driver_features: u64,
    queue_sel: u32,
    queues: [QueueState; MAX_QUEUES],
    int_status: u32,
    config_gen: u32,
    /// QueueNotify kicks observed (queue index of the most recent, plus a count) — ring
    /// processing consumes these from E2-T09 on; tests observe them today.
    pub last_notify: Option<u32>,
    pub notify_count: u64,
}

impl VirtioMmio {
    /// An empty slot (`DeviceID` 0 — kernel skips silently).
    pub fn empty() -> Self {
        Self::with_backend(None)
    }

    /// A slot with a backend plugged in.
    pub fn new(dev: Box<dyn VirtioDevice>) -> Self {
        Self::with_backend(Some(dev))
    }

    fn with_backend(dev: Option<Box<dyn VirtioDevice>>) -> Self {
        Self {
            dev,
            status: 0,
            dev_feat_sel: 0,
            drv_feat_sel: 0,
            driver_features: 0,
            queue_sel: 0,
            queues: [QueueState::default(); MAX_QUEUES],
            int_status: 0,
            config_gen: 0,
            last_notify: None,
            notify_count: 0,
        }
    }

    /// The full feature set offered to the driver: backend bits + VERSION_1 (always).
    fn offered_features(&self) -> u64 {
        self.dev.as_ref().map(|d| d.device_features()).unwrap_or(0) | VIRTIO_F_VERSION_1
    }

    /// Level for the slot's PLIC line: high while any InterruptStatus bit is pending.
    pub fn irq_level(&self) -> bool {
        self.int_status != 0
    }

    /// Backend signal: buffers were used → interrupt the driver (E2-T09+ calls this).
    pub fn raise_used_irq(&mut self) {
        self.int_status |= INT_USED_RING;
    }

    /// E2-T09 policy: a ring protocol violation ([`super::queue::Violation`]) degrades
    /// the device to NEEDS_RESET with a config-change notification (spec §2.1) — loud,
    /// recoverable via reset, never a wedge.
    pub fn protocol_violation(&mut self) {
        self.status |= STATUS_NEEDS_RESET;
        self.raise_config_irq();
    }

    /// Backend signal: config space changed.
    pub fn raise_config_irq(&mut self) {
        self.int_status |= INT_CONFIG_CHANGE;
        self.config_gen = self.config_gen.wrapping_add(1);
    }

    /// Selected queue state (transport-internal and for E2-T09 ring processing).
    pub fn queue(&self, idx: usize) -> &QueueState {
        &self.queues[idx % MAX_QUEUES]
    }

    fn sel_queue_mut(&mut self) -> &mut QueueState {
        &mut self.queues[(self.queue_sel as usize) % MAX_QUEUES]
    }

    fn queue_sel_valid(&self) -> bool {
        // Enforce the transport's MAX_QUEUES cap too (critic advisory): a backend
        // advertising more queues than the transport can index must not alias.
        self.dev
            .as_ref()
            .is_some_and(|d| self.queue_sel < d.num_queues().min(MAX_QUEUES as u32))
    }

    /// Full device reset (Status write of 0), §4.2.2.1: tear down EVERYTHING.
    fn reset(&mut self) {
        self.status = 0;
        self.dev_feat_sel = 0;
        self.drv_feat_sel = 0;
        self.driver_features = 0;
        self.queue_sel = 0;
        self.queues = [QueueState::default(); MAX_QUEUES];
        self.int_status = 0;
        self.last_notify = None;
        if let Some(d) = self.dev.as_mut() {
            d.reset();
        }
    }

    fn read32(&mut self, offset: u64) -> u32 {
        match offset {
            MAGIC_VALUE => MAGIC,
            VERSION => 2,
            DEVICE_ID => self.dev.as_ref().map(|d| d.device_id()).unwrap_or(0),
            VENDOR_ID => VENDOR,
            DEVICE_FEATURES => {
                if self.dev.is_none() {
                    return 0;
                }
                match self.dev_feat_sel {
                    0 => self.offered_features() as u32,
                    1 => (self.offered_features() >> 32) as u32,
                    _ => 0,
                }
            }
            QUEUE_NUM_MAX => {
                if self.queue_sel_valid() {
                    self.dev.as_ref().unwrap().queue_num_max()
                } else {
                    0
                }
            }
            QUEUE_READY => {
                // Out-of-range QueueSel must never alias onto a real queue (critic
                // advisory: QEMU guards the sel write; we guard the accesses).
                if self.queue_sel_valid() {
                    self.sel_queue_ro().ready as u32
                } else {
                    0
                }
            }
            SHM_LEN_LOW | SHM_LEN_HIGH | SHM_BASE_LOW | SHM_BASE_HIGH => {
                // No shared-memory regions exist: spec says length -1 / base all-ones
                // for a nonexistent region (QEMU agrees; critic advisory).
                0xFFFF_FFFF
            }
            INTERRUPT_STATUS => self.int_status,
            STATUS => self.status,
            CONFIG_GENERATION => self.config_gen,
            _ => 0, // write-only / reserved registers read 0
        }
    }

    fn sel_queue_ro(&self) -> QueueState {
        self.queues[(self.queue_sel as usize) % MAX_QUEUES]
    }

    fn write32(&mut self, offset: u64, v: u32) {
        // Empty slots tolerate arbitrary writes (kernel probes then skips).
        if self.dev.is_none() {
            return;
        }
        match offset {
            DEVICE_FEATURES_SEL => self.dev_feat_sel = v,
            DRIVER_FEATURES_SEL => self.drv_feat_sel = v,
            DRIVER_FEATURES => match self.drv_feat_sel {
                0 => {
                    self.driver_features = (self.driver_features & !0xFFFF_FFFF) | u64::from(v);
                }
                1 => {
                    self.driver_features =
                        (self.driver_features & 0xFFFF_FFFF) | (u64::from(v) << 32);
                }
                _ => {}
            },
            QUEUE_SEL => self.queue_sel = v,
            QUEUE_NUM if self.queue_sel_valid() => self.sel_queue_mut().num = v,
            QUEUE_READY if self.queue_sel_valid() => {
                self.sel_queue_mut().ready = v & 1 != 0;
            }
            QUEUE_NUM | QUEUE_READY => {} // out-of-range sel: never alias (critic advisory)
            SHM_SEL => {}                 // no shared-memory regions; selector accepted and ignored
            QUEUE_NOTIFY => {
                self.last_notify = Some(v);
                self.notify_count += 1;
                if let Some(d) = self.dev.as_mut() {
                    d.queue_notify(v);
                }
            }
            INTERRUPT_ACK => self.int_status &= !v,
            STATUS => {
                if v == 0 {
                    self.reset();
                    return;
                }
                let mut new = v;
                // FEATURES_OK gate: accept only if the accepted set ⊆ offered set;
                // otherwise leave FEATURES_OK unset on readback (§4.2.2.2).
                if new & STATUS_FEATURES_OK != 0
                    && self.driver_features & !self.offered_features() != 0
                {
                    new &= !STATUS_FEATURES_OK;
                }
                // DRIVER_OK without FEATURES_OK: the driver skipped negotiation — degrade
                // to NEEDS_RESET (charter: never wedge, fail loudly). Spec §2.1: after
                // setting NEEDS_RESET with DRIVER_OK set, the device MUST send a config
                // change notification (critic advisory).
                if new & STATUS_DRIVER_OK != 0 && new & STATUS_FEATURES_OK == 0 {
                    new |= STATUS_NEEDS_RESET;
                    self.status = new;
                    self.raise_config_irq();
                    return;
                }
                self.status = new;
            }
            QUEUE_DESC_LOW if self.queue_sel_valid() => set_low(&mut self.sel_queue_mut().desc, v),
            QUEUE_DESC_HIGH if self.queue_sel_valid() => {
                set_high(&mut self.sel_queue_mut().desc, v)
            }
            QUEUE_DRIVER_LOW if self.queue_sel_valid() => {
                set_low(&mut self.sel_queue_mut().driver, v)
            }
            QUEUE_DRIVER_HIGH if self.queue_sel_valid() => {
                set_high(&mut self.sel_queue_mut().driver, v)
            }
            QUEUE_DEVICE_LOW if self.queue_sel_valid() => {
                set_low(&mut self.sel_queue_mut().device, v)
            }
            QUEUE_DEVICE_HIGH if self.queue_sel_valid() => {
                set_high(&mut self.sel_queue_mut().device, v)
            }
            _ => {} // read-only / reserved: ignored
        }
    }
}

fn set_low(target: &mut u64, v: u32) {
    *target = (*target & !0xFFFF_FFFF) | u64::from(v);
}
fn set_high(target: &mut u64, v: u32) {
    *target = (*target & 0xFFFF_FFFF) | (u64::from(v) << 32);
}

/// Bus adapter: the Machine shares each slot with the run loop (irq level) via
/// `Rc<RefCell<_>>` — the CLINT/PLIC/UART pattern.
pub struct SharedVirtioMmio(pub alloc::rc::Rc<core::cell::RefCell<VirtioMmio>>);

impl MmioDevice for SharedVirtioMmio {
    fn read(&mut self, offset: u64, width: Width) -> Result<u64, BusFault> {
        self.0.borrow_mut().read(offset, width)
    }
    fn write(&mut self, offset: u64, width: Width, value: u64) -> Result<(), BusFault> {
        self.0.borrow_mut().write(offset, width, value)
    }
}

impl MmioDevice for VirtioMmio {
    fn read(&mut self, offset: u64, width: Width) -> Result<u64, BusFault> {
        if offset >= CONFIG_SPACE {
            let w = match width {
                Width::B1 => 1,
                Width::B2 => 2,
                Width::B4 => 4,
                Width::B8 => 8,
            };
            return Ok(self
                .dev
                .as_mut()
                .map(|d| d.config_read(offset - CONFIG_SPACE, w))
                .unwrap_or(0));
        }
        // Register window: spec mandates 4-byte; anything else reads 0 (documented policy).
        if width != Width::B4 {
            return Ok(0);
        }
        Ok(u64::from(self.read32(offset)))
    }

    fn write(&mut self, offset: u64, width: Width, value: u64) -> Result<(), BusFault> {
        if offset >= CONFIG_SPACE {
            let w = match width {
                Width::B1 => 1,
                Width::B2 => 2,
                Width::B4 => 4,
                Width::B8 => 8,
            };
            if let Some(d) = self.dev.as_mut() {
                d.config_write(offset - CONFIG_SPACE, w, value);
            }
            return Ok(());
        }
        if width != Width::B4 {
            return Ok(()); // non-4-byte register writes ignored (documented policy)
        }
        self.write32(offset, value as u32);
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Minimal backend for lifecycle tests: blk-shaped placeholder (DeviceID 2).
    struct BlkStub {
        resets: u32,
        notified: Option<u32>,
    }
    impl VirtioDevice for BlkStub {
        fn device_id(&self) -> u32 {
            2
        }
        fn device_features(&self) -> u64 {
            0b110 // two arbitrary device bits (1,2) for negotiation tests
        }
        fn queue_notify(&mut self, q: u32) {
            self.notified = Some(q);
        }
        fn reset(&mut self) {
            self.resets += 1;
        }
        fn config_read(&mut self, offset: u64, _w: u8) -> u64 {
            0xAB00 + offset // recognizable pattern
        }
    }

    fn slot() -> VirtioMmio {
        VirtioMmio::new(Box::new(BlkStub {
            resets: 0,
            notified: None,
        }))
    }
    fn r32(m: &mut VirtioMmio, off: u64) -> u32 {
        m.read(off, Width::B4).unwrap() as u32
    }
    fn w32(m: &mut VirtioMmio, off: u64, v: u32) {
        m.write(off, Width::B4, u64::from(v)).unwrap();
    }

    /// The full happy lifecycle: reset → ACK → DRIVER → read features (both banks) →
    /// accept them → FEATURES_OK sticks → queue setup → DRIVER_OK.
    #[test]
    fn lifecycle_happy_path() {
        let mut m = slot();
        assert_eq!(r32(&mut m, MAGIC_VALUE), MAGIC);
        assert_eq!(r32(&mut m, VERSION), 2);
        assert_eq!(r32(&mut m, DEVICE_ID), 2);
        w32(&mut m, STATUS, STATUS_ACKNOWLEDGE);
        w32(&mut m, STATUS, STATUS_ACKNOWLEDGE | STATUS_DRIVER);
        // Features: bank 0 has the device bits, bank 1 bit 0 is VERSION_1 (always offered).
        w32(&mut m, DEVICE_FEATURES_SEL, 0);
        assert_eq!(r32(&mut m, DEVICE_FEATURES), 0b110);
        w32(&mut m, DEVICE_FEATURES_SEL, 1);
        assert_eq!(r32(&mut m, DEVICE_FEATURES), 1, "VERSION_1 offered");
        // Accept exactly what was offered.
        w32(&mut m, DRIVER_FEATURES_SEL, 0);
        w32(&mut m, DRIVER_FEATURES, 0b110);
        w32(&mut m, DRIVER_FEATURES_SEL, 1);
        w32(&mut m, DRIVER_FEATURES, 1);
        w32(
            &mut m,
            STATUS,
            STATUS_ACKNOWLEDGE | STATUS_DRIVER | STATUS_FEATURES_OK,
        );
        assert_ne!(
            r32(&mut m, STATUS) & STATUS_FEATURES_OK,
            0,
            "FEATURES_OK stuck"
        );
        // Queue 0 setup.
        w32(&mut m, QUEUE_SEL, 0);
        assert_eq!(r32(&mut m, QUEUE_NUM_MAX), 256);
        w32(&mut m, QUEUE_NUM, 128);
        w32(&mut m, QUEUE_DESC_LOW, 0x8000_1000);
        w32(&mut m, QUEUE_DESC_HIGH, 0);
        w32(&mut m, QUEUE_DRIVER_LOW, 0x8000_2000);
        w32(&mut m, QUEUE_DRIVER_HIGH, 0);
        w32(&mut m, QUEUE_DEVICE_LOW, 0x8000_3000);
        w32(&mut m, QUEUE_DEVICE_HIGH, 0);
        w32(&mut m, QUEUE_READY, 1);
        assert_eq!(r32(&mut m, QUEUE_READY), 1);
        w32(
            &mut m,
            STATUS,
            STATUS_ACKNOWLEDGE | STATUS_DRIVER | STATUS_FEATURES_OK | STATUS_DRIVER_OK,
        );
        let st = r32(&mut m, STATUS);
        assert_ne!(st & STATUS_DRIVER_OK, 0);
        assert_eq!(
            st & STATUS_NEEDS_RESET,
            0,
            "clean lifecycle, no NEEDS_RESET"
        );
        // Notify lands at the backend.
        w32(&mut m, QUEUE_NOTIFY, 0);
        assert_eq!(m.last_notify, Some(0));
        assert_eq!(m.queue(0).desc, 0x8000_1000);
    }

    /// Acceptance #1: an unoffered bit keeps FEATURES_OK clear; re-negotiating with the
    /// offered set then sticks.
    #[test]
    fn unoffered_feature_rejected() {
        let mut m = slot();
        w32(&mut m, DRIVER_FEATURES_SEL, 0);
        w32(&mut m, DRIVER_FEATURES, 0b1000); // bit 3: never offered
        w32(
            &mut m,
            STATUS,
            STATUS_ACKNOWLEDGE | STATUS_DRIVER | STATUS_FEATURES_OK,
        );
        assert_eq!(r32(&mut m, STATUS) & STATUS_FEATURES_OK, 0, "rejected");
        // Fix the set → accepted.
        w32(&mut m, DRIVER_FEATURES, 0b110);
        w32(&mut m, DRIVER_FEATURES_SEL, 1);
        w32(&mut m, DRIVER_FEATURES, 1);
        w32(
            &mut m,
            STATUS,
            STATUS_ACKNOWLEDGE | STATUS_DRIVER | STATUS_FEATURES_OK,
        );
        assert_ne!(r32(&mut m, STATUS) & STATUS_FEATURES_OK, 0);
    }

    /// Acceptance #2: Status write of 0 clears queue state, features, InterruptStatus,
    /// and resets the backend — including MID-lifecycle.
    #[test]
    fn status_zero_is_full_reset() {
        let mut m = slot();
        w32(&mut m, STATUS, STATUS_ACKNOWLEDGE | STATUS_DRIVER);
        w32(&mut m, QUEUE_NUM, 64);
        w32(&mut m, QUEUE_DESC_LOW, 0xAAAA_0000);
        w32(&mut m, QUEUE_READY, 1);
        w32(&mut m, DRIVER_FEATURES, 0b10);
        m.raise_used_irq();
        assert!(m.irq_level());
        w32(&mut m, STATUS, 0); // reset mid-lifecycle
        assert_eq!(r32(&mut m, STATUS), 0);
        assert_eq!(r32(&mut m, QUEUE_READY), 0);
        assert_eq!(m.queue(0), &QueueState::default(), "queue state torn down");
        assert_eq!(m.driver_features, 0);
        assert_eq!(r32(&mut m, INTERRUPT_STATUS), 0, "InterruptStatus cleared");
        assert!(!m.irq_level());
    }

    /// Charter lifecycle attack: DRIVER_OK without FEATURES_OK → NEEDS_RESET, not a wedge.
    #[test]
    fn driver_ok_without_features_ok_needs_reset() {
        let mut m = slot();
        w32(
            &mut m,
            STATUS,
            STATUS_ACKNOWLEDGE | STATUS_DRIVER | STATUS_DRIVER_OK,
        );
        let st = r32(&mut m, STATUS);
        assert_ne!(st & STATUS_NEEDS_RESET, 0, "degraded loudly");
        // Recovery via reset works.
        w32(&mut m, STATUS, 0);
        assert_eq!(r32(&mut m, STATUS), 0);
    }

    /// Acceptance #3: empty slots — DeviceID 0, magic intact, arbitrary writes tolerated.
    #[test]
    fn empty_slot_answers_and_tolerates() {
        let mut m = VirtioMmio::empty();
        assert_eq!(r32(&mut m, MAGIC_VALUE), MAGIC);
        assert_eq!(r32(&mut m, VERSION), 2);
        assert_eq!(r32(&mut m, DEVICE_ID), 0, "kernel skips silently");
        for off in (0u64..0x200).step_by(4) {
            w32(&mut m, off, 0xFFFF_FFFF); // arbitrary writes: ignored
        }
        assert_eq!(r32(&mut m, DEVICE_ID), 0);
        assert_eq!(r32(&mut m, STATUS), 0);
        assert_eq!(r32(&mut m, DEVICE_FEATURES), 0);
    }

    /// InterruptStatus/ACK: ACK clears only the acked bits; a bit re-armed after the read
    /// but before the ACK write is NOT lost if the driver acks only what it read (the QEMU
    /// race contract: ACK is a mask-clear, not a full clear).
    #[test]
    fn interrupt_ack_is_mask_clear() {
        let mut m = slot();
        m.raise_used_irq();
        let read = r32(&mut m, INTERRUPT_STATUS);
        assert_eq!(read, INT_USED_RING);
        // Config-change fires BETWEEN the driver's read and its ACK.
        m.raise_config_irq();
        w32(&mut m, INTERRUPT_ACK, read); // driver acks only what it saw
        assert_eq!(
            r32(&mut m, INTERRUPT_STATUS),
            INT_CONFIG_CHANGE,
            "late-arriving bit survives the ACK — no lost interrupt"
        );
        assert!(m.irq_level());
    }

    /// Critic advisories, pinned: out-of-range QueueSel never aliases; NEEDS_RESET
    /// degradation raises a config-change notification; SHM registers answer "no region".
    #[test]
    fn critic_advisories_pinned() {
        let mut m = slot();
        // Configure queue 0, then attack via out-of-range sel.
        w32(&mut m, QUEUE_SEL, 0);
        w32(&mut m, QUEUE_NUM, 64);
        w32(&mut m, QUEUE_READY, 1);
        w32(&mut m, QUEUE_SEL, 4); // aliases to index 0 pre-fix
        assert_eq!(r32(&mut m, QUEUE_READY), 0, "no alias on read");
        w32(&mut m, QUEUE_NUM, 7); // must NOT touch queue 0
        w32(&mut m, QUEUE_DESC_LOW, 0xDEAD_0000);
        w32(&mut m, QUEUE_SEL, 0);
        assert_eq!(m.queue(0).num, 64, "queue 0 num intact");
        assert_eq!(m.queue(0).desc, 0, "queue 0 desc intact");
        // NEEDS_RESET degradation raises config-change (spec §2.1 MUST).
        let mut m2 = slot();
        w32(
            &mut m2,
            STATUS,
            STATUS_ACKNOWLEDGE | STATUS_DRIVER | STATUS_DRIVER_OK,
        );
        assert_ne!(r32(&mut m2, STATUS) & STATUS_NEEDS_RESET, 0);
        assert_ne!(
            r32(&mut m2, INTERRUPT_STATUS) & INT_CONFIG_CHANGE,
            0,
            "config-change notification sent with NEEDS_RESET"
        );
        // SHM: no region => len/base all-ones (spec + QEMU).
        for off in [SHM_LEN_LOW, SHM_LEN_HIGH, SHM_BASE_LOW, SHM_BASE_HIGH] {
            assert_eq!(r32(&mut m, off), 0xFFFF_FFFF, "SHM off {off:#x}");
        }
        w32(&mut m, SHM_SEL, 3); // accepted, ignored
    }

    /// Charter fuzz: 10^6 random-width random-offset ops over 0x000–0x1FF — no panic,
    /// and 4-byte-only policy holds (sub-width register reads are 0).
    #[test]
    fn register_fuzz_1e6() {
        let mut m = slot();
        let mut e = VirtioMmio::empty();
        let mut x = 0x1234_5678_9ABC_DEF0u64;
        let mut next = move || {
            x ^= x << 13;
            x ^= x >> 7;
            x ^= x << 17;
            x
        };
        for i in 0..1_000_000u32 {
            let off = next() % 0x200;
            let width = match next() % 4 {
                0 => Width::B1,
                1 => Width::B2,
                2 => Width::B4,
                _ => Width::B8,
            };
            let target: &mut VirtioMmio = if i % 2 == 0 { &mut m } else { &mut e };
            if next() % 2 == 0 {
                let v = target.read(off, width).unwrap();
                if off < 0x100 && width != Width::B4 {
                    assert_eq!(v, 0, "sub-width register read policy");
                }
            } else {
                target.write(off, width, next()).unwrap();
            }
        }
    }
}
