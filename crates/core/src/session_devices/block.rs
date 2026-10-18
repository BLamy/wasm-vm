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
    fn max_transfer_bytes(&self) -> usize {
        MAX_RESULT
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
        if buf.len() > MAX_RESULT {
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
