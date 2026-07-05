//! Native mmap-backed [`BlockBackend`] (E2-T10): fast iteration on multi-hundred-MB
//! images. Flush = `msync` write-back; read-only mode maps the file read-only so even a
//! trait-level bug cannot mutate the image.

use std::fs::OpenOptions;
use std::path::Path;

use memmap2::{Mmap, MmapMut};
use wasm_vm_core::block::{BlockBackend, BlockError, SECTOR_SIZE, check_range};

enum Map {
    Rw(MmapMut),
    Ro(Mmap),
}

/// Memory-mapped file image, sector-addressed.
pub struct FileBackend {
    map: Map,
    capacity: u64,
}

impl FileBackend {
    /// Open `path` read-write. The file length is truncated DOWN to whole sectors for
    /// addressing; a zero-sector file is an error.
    pub fn open(path: &Path) -> std::io::Result<Self> {
        let file = OpenOptions::new().read(true).write(true).open(path)?;
        let len = file.metadata()?.len();
        let capacity = len / SECTOR_SIZE as u64;
        if capacity == 0 {
            return Err(std::io::Error::other("image smaller than one sector"));
        }
        // SAFETY: we own the only mapping in this process; external mutation of the
        // file while mapped is the usual mmap caveat (documented).
        let map = unsafe { MmapMut::map_mut(&file)? };
        Ok(Self {
            map: Map::Rw(map),
            capacity,
        })
    }

    /// Open `path` read-only (the mapping itself is RO — defense in depth).
    pub fn open_read_only(path: &Path) -> std::io::Result<Self> {
        let file = OpenOptions::new().read(true).open(path)?;
        let len = file.metadata()?.len();
        let capacity = len / SECTOR_SIZE as u64;
        if capacity == 0 {
            return Err(std::io::Error::other("image smaller than one sector"));
        }
        let map = unsafe { Mmap::map(&file)? };
        Ok(Self {
            map: Map::Ro(map),
            capacity,
        })
    }
}

impl BlockBackend for FileBackend {
    fn capacity_sectors(&self) -> u64 {
        self.capacity
    }
    fn read(&mut self, sector: u64, buf: &mut [u8]) -> Result<(), BlockError> {
        let off = check_range(self.capacity, sector, buf.len())? as usize;
        let data: &[u8] = match &self.map {
            Map::Rw(m) => m,
            Map::Ro(m) => m,
        };
        buf.copy_from_slice(&data[off..off + buf.len()]);
        Ok(())
    }
    fn write(&mut self, sector: u64, buf: &[u8]) -> Result<(), BlockError> {
        let off = check_range(self.capacity, sector, buf.len())? as usize;
        match &mut self.map {
            Map::Rw(m) => {
                m[off..off + buf.len()].copy_from_slice(buf);
                Ok(())
            }
            Map::Ro(_) => Err(BlockError::ReadOnly),
        }
    }
    fn flush(&mut self) -> Result<(), BlockError> {
        match &self.map {
            Map::Rw(m) => m.flush().map_err(|_| BlockError::Io),
            Map::Ro(_) => Err(BlockError::ReadOnly),
        }
    }
    fn is_read_only(&self) -> bool {
        matches!(self.map, Map::Ro(_))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use std::process::Command;
    use wasm_vm_core::block::BlockBackend;

    fn temp_image(tag: &str, sectors: usize) -> std::path::PathBuf {
        let mut p = std::env::temp_dir();
        p.push(format!(
            "wasmvm_blk_{}_{tag}_{sectors}.img",
            std::process::id()
        ));
        let mut f = std::fs::File::create(&p).unwrap();
        f.write_all(&vec![0u8; sectors * SECTOR_SIZE]).unwrap();
        p
    }

    /// Acceptance: flush provably persists — write, flush, drop, reopen, verify.
    #[test]
    fn flush_persists_across_reopen() {
        let path = temp_image("persist", 8);
        {
            let mut b = FileBackend::open(&path).unwrap();
            let sec = [0xA5u8; SECTOR_SIZE];
            b.write(3, &sec).unwrap();
            b.flush().unwrap();
        } // dropped
        let mut b = FileBackend::open(&path).unwrap();
        let mut back = [0u8; SECTOR_SIZE];
        b.read(3, &mut back).unwrap();
        assert_eq!(back, [0xA5u8; SECTOR_SIZE]);
        std::fs::remove_file(&path).ok();
    }

    /// RO mapping: writes/flush rejected at the trait AND the mapping is physically RO.
    #[test]
    fn read_only_mapping_rejects_writes() {
        let path = temp_image("ro", 4);
        let mut b = FileBackend::open_read_only(&path).unwrap();
        assert!(b.is_read_only());
        let sec = [1u8; SECTOR_SIZE];
        assert_eq!(b.write(0, &sec), Err(BlockError::ReadOnly));
        assert_eq!(b.flush(), Err(BlockError::ReadOnly));
        let mut r = [9u8; SECTOR_SIZE];
        b.read(3, &mut r).unwrap();
        assert_eq!(r, [0u8; SECTOR_SIZE]);
        std::fs::remove_file(&path).ok();
    }

    /// Child half of the kill test: only acts when the env var points at an image.
    /// Writes flushed pattern A to sector 3, unflushed pattern B to sector 5, then dies
    /// via abort (no cleanup, no Drop, no msync — the SIGKILL-equivalent).
    #[test]
    fn kill_child_writer_helper() {
        let Ok(path) = std::env::var("WASMVM_BLK_KILL_PATH") else {
            return; // normal test runs: no-op
        };
        let mut b = FileBackend::open(std::path::Path::new(&path)).unwrap();
        b.write(3, &[0xAAu8; SECTOR_SIZE]).unwrap();
        b.flush().unwrap();
        b.write(5, &[0xBBu8; SECTOR_SIZE]).unwrap();
        // No flush for sector 5 — die hard.
        std::process::abort();
    }

    /// Charter kill-mid-write attack: child writes (flushed + unflushed) then dies with
    /// abort; parent reopens. Flushed sector MUST survive; the unflushed sector may be
    /// lost (documented-acceptable) but must never be TORN (partially written).
    #[test]
    fn kill_mid_write_no_torn_sectors() {
        let path = temp_image("kill", 8);
        let status = Command::new(std::env::current_exe().unwrap())
            .arg("--exact")
            .arg("file_backend::tests::kill_child_writer_helper")
            .arg("--nocapture")
            .env("WASMVM_BLK_KILL_PATH", &path)
            .status()
            .unwrap();
        assert!(!status.success(), "child aborted as intended");

        let mut b = FileBackend::open(&path).unwrap();
        let mut s3 = [0u8; SECTOR_SIZE];
        b.read(3, &mut s3).unwrap();
        assert_eq!(s3, [0xAAu8; SECTOR_SIZE], "flushed sector persisted");
        let mut s5 = [0u8; SECTOR_SIZE];
        b.read(5, &mut s5).unwrap();
        let all_b = s5.iter().all(|&x| x == 0xBB);
        let all_zero = s5.iter().all(|&x| x == 0);
        assert!(
            all_b || all_zero,
            "unflushed sector may be lost or kept, but NEVER torn: {:?}...",
            &s5[..8]
        );
        std::fs::remove_file(&path).ok();
    }
}
