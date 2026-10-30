use super::*;
use crate::block::{BlockBackend, BlockError, SECTOR_SIZE, check_range};

/// Frozen immutable base manifest. Bytes are supplied only through authenticated completions.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BaseDisk {
    pub identity: [u8; 32],
    pub sectors: u64,
    pub chunk_bytes: u32,
    pub chunks: Vec<PayloadRef>,
}
impl BaseDisk {
    pub fn validate(&self) -> Result<(), DeviceError> {
        let length = self
            .sectors
            .checked_mul(SECTOR_SIZE as u64)
            .ok_or(DeviceError::Limit)?;
        if length == 0
            || self.identity == [0; 32]
            || self.chunk_bytes == 0
            || self.chunk_bytes as usize > MAX_RESULT
            || !self.chunk_bytes.is_multiple_of(SECTOR_SIZE as u32)
            || self.chunks.len() > 65536
            || length.div_ceil(u64::from(self.chunk_bytes)) != self.chunks.len() as u64
        {
            return Err(DeviceError::Payload);
        }
        for (i, reference) in self.chunks.iter().enumerate() {
            let expected =
                (length - i as u64 * u64::from(self.chunk_bytes)).min(u64::from(self.chunk_bytes));
            if u64::from(reference.length) != expected {
                return Err(DeviceError::Payload);
            }
        }
        Ok(())
    }
}

/// Sector-aligned local COW writes are derived guest state. Immutable misses create host requests;
/// no fetch, callback or shared host cache is consulted while a guest is running or replaying.
pub struct CompletionBlock {
    pub(super) hub: Rc<RefCell<DeviceHub>>,
}
impl BlockBackend for CompletionBlock {
    #[cfg(feature = "cold-block-diagnostic")]
    fn diagnostic_overlay_sectors(&self) -> Option<usize> {
        Some(self.hub.borrow().guest.overlay.len())
    }
    fn max_transfer_bytes(&self) -> usize {
        MAX_BLOCK_TRANSFER
    }
    fn capacity_sectors(&self) -> u64 {
        self.hub.borrow().base.as_ref().unwrap().sectors
    }
    fn read(&mut self, sector: u64, buf: &mut [u8]) -> Result<(), BlockError> {
        let offset = check_range(self.capacity_sectors(), sector, buf.len())?;
        let mut hub = self.hub.borrow_mut();
        if buf.is_empty() {
            return Ok(());
        }
        if buf.len() > MAX_BLOCK_TRANSFER {
            hub.error = Some(DeviceError::Limit);
            return Err(BlockError::WouldBlock { chunk: 0 });
        }
        let width = u64::from(hub.base.as_ref().unwrap().chunk_bytes);
        let key = (sector, buf.len() as u32);
        let mut required = Vec::new();
        for n in 0..buf.len() / SECTOR_SIZE {
            let disk_sector = sector + n as u64;
            if !hub.guest.overlay.contains_key(&disk_sector) {
                let chunk = ((offset + n as u64 * SECTOR_SIZE as u64) / width) as u32;
                if !required.contains(&chunk) {
                    required.push(chunk);
                }
            }
        }
        if required
            .iter()
            .any(|chunk| hub.guest.failed.contains_key(chunk))
        {
            hub.guest.reads.remove(&key);
            return Err(BlockError::Io);
        }
        let missing: Vec<_> = required
            .iter()
            .copied()
            .filter(|chunk| !hub.guest.resident.contains_key(chunk))
            .collect();
        if !missing.is_empty() {
            hub.guest.reads.insert(key, required);
            for chunk in &missing {
                if !hub.guest.pending.values().any(|request|matches!(request.intent,DeviceIntent::BaseBlock {chunk:c,..} if c==*chunk)) {
                    let content=hub.base.as_ref().unwrap().chunks[*chunk as usize];
                    if let Err(error)=hub.issue(DeviceIntent::BaseBlock {chunk:*chunk,content}) {hub.error=Some(error);}
                }
            }
            return Err(BlockError::WouldBlock {
                chunk: missing[0] as usize,
            });
        }
        // Preflight above guarantees every byte before any part of the caller's DMA buffer changes.
        for (n, output) in buf.chunks_exact_mut(SECTOR_SIZE).enumerate() {
            let disk_sector = sector + n as u64;
            if let Some(bytes) = hub.guest.overlay.get(&disk_sector) {
                output.copy_from_slice(bytes);
            } else {
                let pos = offset + n as u64 * SECTOR_SIZE as u64;
                let resident = hub.guest.resident.get(&((pos / width) as u32)).unwrap();
                let at = (pos % width) as usize;
                output.copy_from_slice(&resident.bytes[at..at + SECTOR_SIZE]);
            }
        }
        hub.guest.reads.remove(&key);
        Ok(())
    }
    fn write(&mut self, sector: u64, buf: &[u8]) -> Result<(), BlockError> {
        check_range(self.capacity_sectors(), sector, buf.len())?;
        let mut hub = self.hub.borrow_mut();
        if buf.len() > MAX_BLOCK_TRANSFER {
            hub.error = Some(DeviceError::Limit);
            return Err(BlockError::WouldBlock { chunk: 0 });
        }
        let additional = (0..buf.len() / SECTOR_SIZE)
            .filter(|n| !hub.guest.overlay.contains_key(&(sector + *n as u64)))
            .count();
        if hub.guest.overlay.len().saturating_add(additional) > 524288 {
            hub.error = Some(DeviceError::Limit);
            return Err(BlockError::WouldBlock { chunk: 0 });
        }
        for (n, bytes) in buf.chunks_exact(SECTOR_SIZE).enumerate() {
            hub.guest.overlay.insert(sector + n as u64, bytes.to_vec());
        }
        Ok(())
    }
    fn flush(&mut self) -> Result<(), BlockError> {
        Ok(())
    }
    fn write_reset(&mut self) {
        let mut hub = self.hub.borrow_mut();
        hub.guest
            .pending
            .retain(|_, r| !matches!(r.intent, DeviceIntent::BaseBlock { .. }));
        hub.guest.reads.clear();
    }
}

#[cfg(all(test, feature = "cold-block-diagnostic"))]
mod diagnostic_tests {
    use super::*;
    use crate::bus::Bus;
    use crate::platform::virt;
    use crate::{Machine, RunOutcome};

    #[test]
    fn capacity_park_is_not_a_completed_io_error() {
        let mut guest = GuestState::default();
        for sector in 0..524288u64 {
            guest.overlay.insert(sector, Vec::new());
        }
        let hub = Rc::new(RefCell::new(DeviceHub {
            base: Some(BaseDisk {
                identity: [1; 32],
                sectors: 600000,
                chunk_bytes: 262144,
                chunks: Vec::new(),
            }),
            agent: false,
            capture: false,
            replay: false,
            unrecorded: false,
            incarnation: Rc::new(()),
            guest,
            error: None,
        }));
        let mut backend = CompletionBlock { hub: hub.clone() };
        assert_eq!(backend.diagnostic_overlay_sectors(), Some(524288));
        assert_eq!(
            backend.write(524288, &[7; SECTOR_SIZE]),
            Err(BlockError::WouldBlock { chunk: 0 })
        );
        assert_eq!(backend.diagnostic_overlay_sectors(), Some(524288));
        assert_eq!(hub.borrow().error, Some(DeviceError::Limit));
        // Existing sectors do not consume capacity; the limit decision depends on
        // the count of new sectors, not on the transfer length alone.
        assert_eq!(backend.write(0, &[9; SECTOR_SIZE]), Ok(()));
        assert_eq!(backend.diagnostic_overlay_sectors(), Some(524288));

        // Exercise the same capacity path through a real virtio descriptor.
        hub.borrow_mut().error = None;
        const SLOT: u64 = 0x1000_1000;
        const DESC: u64 = virt::DRAM_BASE + 0x10_0000;
        const AVAIL: u64 = virt::DRAM_BASE + 0x11_0000;
        const USED: u64 = virt::DRAM_BASE + 0x12_0000;
        const HDR: u64 = virt::DRAM_BASE + 0x13_0000;
        const DATA: u64 = virt::DRAM_BASE + 0x14_0000;
        const STATUS: u64 = virt::DRAM_BASE + 0x15_0000;
        let mut machine = Machine::new(16 * 1024 * 1024);
        machine.enable_clint(10);
        machine.enable_plic();
        machine.enable_virtio_blk(Box::new(CompletionBlock { hub: hub.clone() }));
        machine.enable_builtin_sbi();
        machine.boot_supervisor(0, 0);
        machine
            .bus_mut()
            .store32(virt::KERNEL_BASE, 0x0000_006f)
            .unwrap();
        for status in [1, 3] {
            machine.bus_mut().store32(SLOT + 0x70, status).unwrap();
        }
        machine.bus_mut().store32(SLOT + 0x24, 0).unwrap();
        machine.bus_mut().store32(SLOT + 0x20, 0).unwrap();
        machine.bus_mut().store32(SLOT + 0x24, 1).unwrap();
        machine.bus_mut().store32(SLOT + 0x20, 1).unwrap();
        machine.bus_mut().store32(SLOT + 0x70, 11).unwrap();
        machine.bus_mut().store32(SLOT + 0x30, 0).unwrap();
        machine.bus_mut().store32(SLOT + 0x38, 8).unwrap();
        machine.bus_mut().store32(SLOT + 0x80, DESC as u32).unwrap();
        machine.bus_mut().store32(SLOT + 0x84, 0).unwrap();
        machine
            .bus_mut()
            .store32(SLOT + 0x90, AVAIL as u32)
            .unwrap();
        machine.bus_mut().store32(SLOT + 0x94, 0).unwrap();
        machine.bus_mut().store32(SLOT + 0xa0, USED as u32).unwrap();
        machine.bus_mut().store32(SLOT + 0xa4, 0).unwrap();
        machine.bus_mut().store32(SLOT + 0x44, 1).unwrap();
        machine.bus_mut().store32(SLOT + 0x70, 15).unwrap();
        machine.enable_first_blk_failure_diagnostic();
        machine.bus_mut().store32(HDR, 1).unwrap();
        machine.bus_mut().store32(HDR + 4, 0).unwrap();
        machine.bus_mut().store64(HDR + 8, 524288).unwrap();
        for (index, addr, length, flags, next) in [
            (0, HDR, 16, 1, 1),
            (1, DATA, SECTOR_SIZE as u32, 1, 2),
            (2, STATUS, 1, 2, 0),
        ] {
            let at = DESC + index * 16;
            machine.bus_mut().store64(at, addr).unwrap();
            machine.bus_mut().store32(at + 8, length).unwrap();
            machine.bus_mut().store16(at + 12, flags).unwrap();
            machine.bus_mut().store16(at + 14, next).unwrap();
        }
        machine.bus_mut().store8(STATUS, 0xa5).unwrap();
        machine.bus_mut().store16(AVAIL + 4, 0).unwrap();
        machine.bus_mut().store16(AVAIL + 2, 1).unwrap();
        machine.bus_mut().store32(SLOT + 0x50, 0).unwrap();
        assert_eq!(machine.run(4), RunOutcome::MaxInstrs);
        assert_eq!(hub.borrow().error, Some(DeviceError::Limit));
        assert_eq!(backend.diagnostic_overlay_sectors(), Some(524288));
        assert_eq!(machine.pending_blk_chunks(), vec![0]);
        assert_eq!(machine.bus_mut().load8(STATUS).unwrap(), 0xa5);
        assert_eq!(machine.bus_mut().load16(USED + 2).unwrap(), 0);
        assert!(machine.first_blk_failure().is_none());
        let parked = machine.parked_blk_witnesses();
        assert_eq!(parked.len(), 1);
        assert_eq!(parked[0].head, 0);
        assert_eq!(
            parked[0].reason,
            crate::dev::virtio::blk::ParkReason::Chunk(0)
        );
        assert_eq!(parked[0].status_addr, STATUS);
        assert_eq!(parked[0].status_byte, 0xa5);
        assert_eq!(parked[0].used_shadow_index, 0);
        assert_eq!(parked[0].used_guest_index, 0);

        // Host completion envelopes remain below 1 MiB; a local guest DMA
        // request has its own finite bound, independent of that envelope.
        hub.borrow_mut().guest.overlay.clear();
        hub.borrow_mut().error = None;
        const HDR2: u64 = virt::DRAM_BASE + 0x16_0000;
        const DATA2: u64 = virt::DRAM_BASE + 0x20_0000;
        const STATUS2: u64 = virt::DRAM_BASE + 0x17_0000;
        let maximum_aligned = MAX_BLOCK_TRANSFER as u32;
        assert_eq!(maximum_aligned, 8 << 20);
        machine.bus_mut().store32(HDR2, 1).unwrap();
        machine.bus_mut().store64(HDR2 + 8, 0).unwrap();
        for (index, addr, length, flags, next) in [
            (3, HDR2, 16, 1, 4),
            (4, DATA2, maximum_aligned, 1, 5),
            (5, STATUS2, 1, 2, 0),
        ] {
            let at = DESC + index * 16;
            machine.bus_mut().store64(at, addr).unwrap();
            machine.bus_mut().store32(at + 8, length).unwrap();
            machine.bus_mut().store16(at + 12, flags).unwrap();
            machine.bus_mut().store16(at + 14, next).unwrap();
        }
        machine.bus_mut().store8(STATUS2, 0xa5).unwrap();
        machine.bus_mut().store16(AVAIL + 6, 3).unwrap();
        machine.bus_mut().store16(AVAIL + 2, 2).unwrap();
        machine.bus_mut().store32(SLOT + 0x50, 0).unwrap();
        assert_eq!(machine.run(4), RunOutcome::MaxInstrs);
        assert_eq!(machine.bus_mut().load8(STATUS).unwrap(), 0);
        assert_eq!(machine.bus_mut().load8(STATUS2).unwrap(), 0);
        assert_eq!(machine.bus_mut().load16(USED + 2).unwrap(), 2);
        assert_eq!(
            hub.borrow().guest.overlay.len(),
            MAX_BLOCK_TRANSFER / SECTOR_SIZE + 1 // earlier capacity-parked sector completes
        );
        assert!(machine.first_blk_failure().is_none());

        // The original cold desktop wrote 1,179,648 bytes in one virtio
        // request. It is larger than any host completion, but fits local DMA.
        const HDR3: u64 = virt::DRAM_BASE + 0x18_0000;
        const DATA3: u64 = virt::DRAM_BASE + 0x30_0000;
        const STATUS3: u64 = virt::DRAM_BASE + 0x19_0000;
        machine.bus_mut().store32(HDR3, 1).unwrap();
        machine.bus_mut().store64(HDR3 + 8, 20_000).unwrap();
        for (index, addr, length, flags, next) in [
            (0, HDR3, 16, 1, 1),
            (1, DATA3, 1_179_648, 1, 2),
            (2, STATUS3, 1, 2, 0),
        ] {
            let at = DESC + index * 16;
            machine.bus_mut().store64(at, addr).unwrap();
            machine.bus_mut().store32(at + 8, length).unwrap();
            machine.bus_mut().store16(at + 12, flags).unwrap();
            machine.bus_mut().store16(at + 14, next).unwrap();
        }
        machine.bus_mut().store8(STATUS3, 0xa5).unwrap();
        machine.bus_mut().store16(AVAIL + 8, 0).unwrap();
        machine.bus_mut().store16(AVAIL + 2, 3).unwrap();
        machine.bus_mut().store32(SLOT + 0x50, 0).unwrap();
        assert_eq!(machine.run(4), RunOutcome::MaxInstrs);
        assert_eq!(machine.bus_mut().load8(STATUS3).unwrap(), 0);
        assert_eq!(machine.bus_mut().load16(USED + 2).unwrap(), 3);
        assert_eq!(
            hub.borrow().guest.overlay.len(),
            MAX_BLOCK_TRANSFER / SECTOR_SIZE + 2305
        );
        assert!(machine.first_blk_failure().is_none());

        // Exactly one sector over the independent DMA bound still fails
        // before calling the backend or touching the COW overlay.
        const HDR4: u64 = virt::DRAM_BASE + 0x1a_0000;
        const DATA4: u64 = virt::DRAM_BASE + 0x30_0000;
        const STATUS4: u64 = virt::DRAM_BASE + 0x1b_0000;
        machine.bus_mut().store32(HDR4, 1).unwrap();
        machine.bus_mut().store64(HDR4 + 8, 8192).unwrap();
        for (index, addr, length, flags, next) in [
            (0, HDR4, 16, 1, 1),
            (1, DATA4, (MAX_BLOCK_TRANSFER + SECTOR_SIZE) as u32, 1, 2),
            (2, STATUS4, 1, 2, 0),
        ] {
            let at = DESC + index * 16;
            machine.bus_mut().store64(at, addr).unwrap();
            machine.bus_mut().store32(at + 8, length).unwrap();
            machine.bus_mut().store16(at + 12, flags).unwrap();
            machine.bus_mut().store16(at + 14, next).unwrap();
        }
        machine.bus_mut().store8(STATUS4, 0xa5).unwrap();
        machine.bus_mut().store16(AVAIL + 10, 0).unwrap();
        machine.bus_mut().store16(AVAIL + 2, 4).unwrap();
        machine.bus_mut().store32(SLOT + 0x50, 0).unwrap();
        assert_eq!(machine.run(4), RunOutcome::MaxInstrs);
        assert_eq!(machine.bus_mut().load8(STATUS4).unwrap(), 1);
        assert_eq!(machine.bus_mut().load16(USED + 2).unwrap(), 4);
        let failure = machine.first_blk_failure().unwrap();
        assert_eq!(failure.rtype, Some(1));
        assert_eq!(failure.sector, Some(8192));
        assert_eq!(
            failure.requested_bytes,
            (MAX_BLOCK_TRANSFER + SECTOR_SIZE) as u64
        );
        assert_eq!(failure.max_transfer_bytes, MAX_BLOCK_TRANSFER);
        assert_eq!(
            failure.stage,
            crate::dev::virtio::blk::BlkFailureStage::TransferShape
        );
        assert_eq!(failure.backend_error, None);
        assert!(failure.status_dma_written && failure.used_ring_committed);
        assert_eq!(
            hub.borrow().guest.overlay.len(),
            MAX_BLOCK_TRANSFER / SECTOR_SIZE + 2305
        );
    }
}
