//! Native boot-fixture adapters for WVFT.
//!
//! Paths in this module are selected by the host process, never by protocol fields. An upload
//! exposes exactly one already-open regular file. A download exposes only normalized basenames
//! beneath one host-selected directory, with private partials and no-replacement publication.

use sha2::{Digest, Sha256};
use std::fs::{self, File, OpenOptions};
use std::io::{Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};
use wasm_vm_slirp::{
    CommitDisposition, FileTransferError, TransferSink, TransferSource, TransferStore,
    file_transfer::MAX_DATA_BYTES,
};

#[derive(Clone, Default)]
pub(crate) struct FileTransferFixture {
    pub(crate) uploads: Vec<PathBuf>,
    pub(crate) download_dir: Option<PathBuf>,
}

pub(crate) struct HostFileSource {
    name: String,
    file: File,
    len: u64,
    sha256: [u8; 32],
    sent: u64,
    hasher: Sha256,
    identity: FileIdentity,
}

#[derive(Clone, Copy, PartialEq, Eq)]
struct FileIdentity {
    len: u64,
    #[cfg(unix)]
    dev: u64,
    #[cfg(unix)]
    ino: u64,
    #[cfg(unix)]
    nlink: u64,
}

impl FileIdentity {
    fn read(metadata: &fs::Metadata) -> Result<Self, FileTransferError> {
        if !metadata.is_file() {
            return Err(FileTransferError::BadName);
        }
        #[cfg(unix)]
        {
            use std::os::unix::fs::MetadataExt;
            if metadata.nlink() != 1 {
                return Err(FileTransferError::BadName);
            }
            Ok(Self {
                len: metadata.len(),
                dev: metadata.dev(),
                ino: metadata.ino(),
                nlink: metadata.nlink(),
            })
        }
        #[cfg(not(unix))]
        {
            Ok(Self {
                len: metadata.len(),
            })
        }
    }
}

impl HostFileSource {
    pub(crate) fn open(path: &Path) -> Result<Self, FileTransferError> {
        let name = path
            .file_name()
            .and_then(|name| name.to_str())
            .filter(|name| !name.is_empty())
            .ok_or(FileTransferError::BadName)?
            .to_owned();
        let mut file = OpenOptions::new()
            .read(true)
            .open(path)
            .map_err(|_| FileTransferError::Io)?;
        let identity = FileIdentity::read(&file.metadata().map_err(|_| FileTransferError::Io)?)?;
        let mut hasher = Sha256::new();
        let mut buffer = [0u8; MAX_DATA_BYTES];
        loop {
            let count = file.read(&mut buffer).map_err(|_| FileTransferError::Io)?;
            if count == 0 {
                break;
            }
            hasher.update(&buffer[..count]);
        }
        let sha256 = <[u8; 32]>::from(hasher.finalize());
        if FileIdentity::read(&file.metadata().map_err(|_| FileTransferError::Io)?)? != identity {
            return Err(FileTransferError::SourceChanged);
        }
        file.seek(SeekFrom::Start(0))
            .map_err(|_| FileTransferError::Io)?;
        Ok(Self {
            name,
            file,
            len: identity.len,
            sha256,
            sent: 0,
            hasher: Sha256::new(),
            identity,
        })
    }
}

impl TransferSource for HostFileSource {
    fn name(&self) -> &str {
        &self.name
    }

    fn total_len(&self) -> u64 {
        self.len
    }

    fn sha256(&self) -> [u8; 32] {
        self.sha256
    }

    fn read(&mut self, max: usize) -> Result<Vec<u8>, FileTransferError> {
        let remaining = self.len.saturating_sub(self.sent) as usize;
        if remaining == 0 {
            return Ok(Vec::new());
        }
        let mut bytes = vec![0u8; max.min(MAX_DATA_BYTES).min(remaining)];
        let count = self
            .file
            .read(&mut bytes)
            .map_err(|_| FileTransferError::Io)?;
        if count == 0 {
            return Err(FileTransferError::SourceChanged);
        }
        bytes.truncate(count);
        self.sent = self
            .sent
            .checked_add(count as u64)
            .ok_or(FileTransferError::SourceChanged)?;
        self.hasher.update(&bytes);
        if self.sent == self.len {
            let identity =
                FileIdentity::read(&self.file.metadata().map_err(|_| FileTransferError::Io)?)?;
            let observed = <[u8; 32]>::from(self.hasher.clone().finalize());
            if identity != self.identity || observed != self.sha256 {
                return Err(FileTransferError::SourceChanged);
            }
        }
        Ok(bytes)
    }
}

pub(crate) struct HostDirectoryStore {
    root: PathBuf,
}

impl HostDirectoryStore {
    pub(crate) fn open(root: PathBuf) -> Result<Self, FileTransferError> {
        if !fs::metadata(&root)
            .map_err(|_| FileTransferError::Io)?
            .is_dir()
        {
            return Err(FileTransferError::BadName);
        }
        Ok(Self { root })
    }
}

impl TransferStore for HostDirectoryStore {
    fn open_sink(
        &mut self,
        _connection_id: wasm_vm_slirp::file_transfer::ConnectionId,
        _stream_id: u32,
        name: &str,
        total_len: u64,
        sha256: [u8; 32],
    ) -> Result<Box<dyn TransferSink>, FileTransferError> {
        let path = Path::new(name);
        if path.file_name().and_then(|part| part.to_str()) != Some(name) {
            return Err(FileTransferError::BadName);
        }
        let final_path = self.root.join(name);
        if fs::symlink_metadata(&final_path).is_ok() {
            return Err(FileTransferError::Busy);
        }
        let name_hash = Sha256::digest(name.as_bytes());
        let partial_path = self.root.join(format!(
            ".wvft-host-{}.part",
            name_hash[..12]
                .iter()
                .map(|byte| format!("{byte:02x}"))
                .collect::<String>()
        ));
        let file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&partial_path)
            .map_err(|_| FileTransferError::Busy)?;
        Ok(Box::new(HostFileSink {
            root: self.root.clone(),
            partial_path,
            final_path,
            file: Some(file),
            expected_len: total_len,
            expected_sha: sha256,
            written: 0,
            hasher: Sha256::new(),
            committed: false,
        }))
    }
}

struct HostFileSink {
    root: PathBuf,
    partial_path: PathBuf,
    final_path: PathBuf,
    file: Option<File>,
    expected_len: u64,
    expected_sha: [u8; 32],
    written: u64,
    hasher: Sha256,
    committed: bool,
}

impl TransferSink for HostFileSink {
    fn write(&mut self, offset: u64, bytes: &[u8]) -> Result<(), FileTransferError> {
        if offset != self.written
            || self
                .written
                .checked_add(bytes.len() as u64)
                .is_none_or(|end| end > self.expected_len)
        {
            return Err(FileTransferError::BadOffset);
        }
        self.file
            .as_mut()
            .ok_or(FileTransferError::Io)?
            .write_all(bytes)
            .map_err(|_| FileTransferError::Io)?;
        self.hasher.update(bytes);
        self.written += bytes.len() as u64;
        Ok(())
    }

    fn commit(
        &mut self,
        total_len: u64,
        sha256: [u8; 32],
    ) -> Result<CommitDisposition, FileTransferError> {
        let observed = <[u8; 32]>::from(self.hasher.clone().finalize());
        if total_len != self.expected_len
            || total_len != self.written
            || sha256 != self.expected_sha
            || observed != self.expected_sha
        {
            return Err(FileTransferError::HashMismatch);
        }
        let file = self.file.take().ok_or(FileTransferError::Io)?;
        file.sync_all().map_err(|_| FileTransferError::Io)?;
        drop(file);
        fs::hard_link(&self.partial_path, &self.final_path).map_err(|_| FileTransferError::Io)?;
        fs::remove_file(&self.partial_path).map_err(|_| FileTransferError::Io)?;
        File::open(&self.root)
            .and_then(|directory| directory.sync_all())
            .map_err(|_| FileTransferError::Io)?;
        self.committed = true;
        Ok(CommitDisposition::Durable)
    }

    fn cancel(&mut self) {
        self.file.take();
        let _ = fs::remove_file(&self.partial_path);
    }
}

impl Drop for HostFileSink {
    fn drop(&mut self) {
        if !self.committed {
            self.file.take();
            let _ = fs::remove_file(&self.partial_path);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{HostDirectoryStore, HostFileSource};
    use sha2::{Digest, Sha256};
    use std::io::Read;
    use wasm_vm_slirp::{TransferSource, TransferStore};

    #[test]
    fn fixed_source_and_directory_sink_round_trip_without_replacement() {
        let temp = tempfile::tempdir().unwrap();
        let source_path = temp.path().join("source.bin");
        std::fs::write(&source_path, b"fixture bytes").unwrap();
        let mut source = HostFileSource::open(&source_path).unwrap();
        let mut bytes = Vec::new();
        loop {
            let chunk = source.read(3).unwrap();
            if chunk.is_empty() {
                break;
            }
            bytes.extend(chunk);
        }
        assert_eq!(bytes, b"fixture bytes");

        let output = temp.path().join("output");
        std::fs::create_dir(&output).unwrap();
        let mut store = HostDirectoryStore::open(output.clone()).unwrap();
        let sha = <[u8; 32]>::from(Sha256::digest(&bytes));
        let mut sink = store
            .open_sink(1, 1, "download.bin", bytes.len() as u64, sha)
            .unwrap();
        sink.write(0, &bytes[..4]).unwrap();
        sink.write(4, &bytes[4..]).unwrap();
        sink.commit(bytes.len() as u64, sha).unwrap();
        assert_eq!(std::fs::read(output.join("download.bin")).unwrap(), bytes);
        assert!(
            store
                .open_sink(1, 2, "download.bin", bytes.len() as u64, sha)
                .is_err()
        );

        let mut opened = std::fs::File::open(output.join("download.bin")).unwrap();
        let mut observed = Vec::new();
        opened.read_to_end(&mut observed).unwrap();
        assert_eq!(observed, b"fixture bytes");
    }
}
