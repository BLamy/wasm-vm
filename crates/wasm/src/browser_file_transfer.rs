use sha2::{Digest, Sha256};
use std::cell::RefCell;
use std::collections::{BTreeMap, VecDeque};
use std::rc::Rc;
use wasm_vm_core::dev::virtio::net::NetBackend;
use wasm_vm_slirp::{
    FileTransferError, SlirpLocalBackend, TransferSink, TransferSource, TransferStore,
    file_transfer::ConnectionId,
};

pub(crate) const MAX_BROWSER_TRANSFER_BUFFER: usize = 8 * 1024 * 1024;
const MAX_RETAINED_DOWNLOADS: usize = 32;

pub(crate) struct SharedSlirpBackend(pub Rc<RefCell<SlirpLocalBackend>>);

impl NetBackend for SharedSlirpBackend {
    fn poll(&mut self) {
        NetBackend::poll(&mut *self.0.borrow_mut());
    }

    fn external_io_pending(&self) -> bool {
        NetBackend::external_io_pending(&*self.0.borrow())
    }

    fn tx(&mut self, frame: &[u8]) {
        NetBackend::tx(&mut *self.0.borrow_mut(), frame);
    }

    fn rx(&mut self) -> Option<Vec<u8>> {
        NetBackend::rx(&mut *self.0.borrow_mut())
    }

    fn rx_ready(&self) -> bool {
        NetBackend::rx_ready(&*self.0.borrow())
    }
}

#[derive(Default)]
struct UploadQueue {
    chunks: VecDeque<Vec<u8>>,
    buffered: usize,
    sent: u64,
    total: u64,
    finished: bool,
    cancelled: bool,
}

struct BrowserUploadSource {
    name: String,
    sha256: [u8; 32],
    queue: Rc<RefCell<UploadQueue>>,
}

impl TransferSource for BrowserUploadSource {
    fn name(&self) -> &str {
        &self.name
    }

    fn total_len(&self) -> u64 {
        self.queue.borrow().total
    }

    fn sha256(&self) -> [u8; 32] {
        self.sha256
    }

    fn read(&mut self, max: usize) -> Result<Vec<u8>, FileTransferError> {
        let mut queue = self.queue.borrow_mut();
        let Some(mut bytes) = queue.chunks.pop_front() else {
            return if queue.finished && queue.sent != queue.total {
                Err(FileTransferError::SourceChanged)
            } else {
                Ok(Vec::new())
            };
        };
        queue.buffered = queue.buffered.saturating_sub(bytes.len());
        if bytes.len() > max {
            let tail = bytes.split_off(max);
            queue.buffered = queue.buffered.saturating_add(tail.len());
            queue.chunks.push_front(tail);
        }
        queue.sent = queue
            .sent
            .checked_add(bytes.len() as u64)
            .ok_or(FileTransferError::SourceChanged)?;
        if queue.sent > queue.total {
            return Err(FileTransferError::SourceChanged);
        }
        Ok(bytes)
    }

    fn cancel(&mut self) {
        let mut queue = self.queue.borrow_mut();
        queue.cancelled = true;
        queue.buffered = 0;
        queue.chunks.clear();
    }

    fn buffered_bytes(&self) -> usize {
        self.queue.borrow().buffered
    }
}

struct DownloadRecord {
    connection_id: ConnectionId,
    stream_id: u32,
    name: String,
    total: u64,
    expected_sha256: [u8; 32],
    received: u64,
    buffered: usize,
    chunks: VecDeque<Vec<u8>>,
    committed: bool,
    cancelled: bool,
}

#[derive(Default)]
struct DownloadManager {
    next_id: u32,
    accepting: bool,
    records: BTreeMap<u32, DownloadRecord>,
}

struct BrowserDownloadStore(Rc<RefCell<DownloadManager>>);

impl TransferStore for BrowserDownloadStore {
    fn open_sink(
        &mut self,
        connection_id: ConnectionId,
        stream_id: u32,
        name: &str,
        total_len: u64,
        sha256: [u8; 32],
    ) -> Result<Box<dyn TransferSink>, FileTransferError> {
        let mut manager = self.0.borrow_mut();
        if !manager.accepting || manager.records.len() >= MAX_RETAINED_DOWNLOADS {
            return Err(FileTransferError::Busy);
        }
        manager.next_id = manager.next_id.wrapping_add(1).max(1);
        let id = manager.next_id;
        manager.records.insert(
            id,
            DownloadRecord {
                connection_id,
                stream_id,
                name: name.to_owned(),
                total: total_len,
                expected_sha256: sha256,
                received: 0,
                buffered: 0,
                chunks: VecDeque::new(),
                committed: false,
                cancelled: false,
            },
        );
        Ok(Box::new(BrowserDownloadSink {
            id,
            manager: self.0.clone(),
        }))
    }
}

struct BrowserDownloadSink {
    id: u32,
    manager: Rc<RefCell<DownloadManager>>,
}

impl TransferSink for BrowserDownloadSink {
    fn write(&mut self, offset: u64, bytes: &[u8]) -> Result<(), FileTransferError> {
        let mut manager = self.manager.borrow_mut();
        let record = manager
            .records
            .get_mut(&self.id)
            .ok_or(FileTransferError::Io)?;
        if offset != record.received
            || record.buffered.saturating_add(bytes.len()) > MAX_BROWSER_TRANSFER_BUFFER
        {
            return Err(FileTransferError::FlowControl);
        }
        record.received = record
            .received
            .checked_add(bytes.len() as u64)
            .ok_or(FileTransferError::TooLarge)?;
        record.buffered += bytes.len();
        record.chunks.push_back(bytes.to_vec());
        Ok(())
    }

    fn commit(&mut self, total_len: u64, sha256: [u8; 32]) -> Result<(), FileTransferError> {
        let mut manager = self.manager.borrow_mut();
        let record = manager
            .records
            .get_mut(&self.id)
            .ok_or(FileTransferError::Io)?;
        if total_len != record.total
            || record.received != record.total
            || sha256 != record.expected_sha256
        {
            return Err(FileTransferError::HashMismatch);
        }
        record.committed = true;
        Ok(())
    }

    fn cancel(&mut self) {
        if let Some(record) = self.manager.borrow_mut().records.get_mut(&self.id) {
            record.cancelled = true;
        }
    }

    fn buffered_bytes(&self) -> usize {
        self.manager
            .borrow()
            .records
            .get(&self.id)
            .map_or(0, |record| record.buffered)
    }
}

struct UploadRecord {
    slot: usize,
    queue: Rc<RefCell<UploadQueue>>,
}

pub(crate) struct BrowserFileTransfers {
    backend: Rc<RefCell<SlirpLocalBackend>>,
    downloads: Rc<RefCell<DownloadManager>>,
    uploads: BTreeMap<u32, UploadRecord>,
    next_stream: u32,
}

impl BrowserFileTransfers {
    pub(crate) fn new(mut backend: SlirpLocalBackend) -> (Self, Rc<RefCell<SlirpLocalBackend>>) {
        let downloads = Rc::new(RefCell::new(DownloadManager::default()));
        backend =
            backend.with_file_transfer_store(Box::new(BrowserDownloadStore(downloads.clone())));
        let backend = Rc::new(RefCell::new(backend));
        (
            Self {
                backend: backend.clone(),
                downloads,
                uploads: BTreeMap::new(),
                next_stream: 0,
            },
            backend,
        )
    }

    pub(crate) fn ready(&self, slot: usize) -> bool {
        self.backend.borrow().file_upload_ready(slot)
    }

    pub(crate) fn set_download_ready(&mut self, ready: bool) {
        self.downloads.borrow_mut().accepting = ready;
    }

    pub(crate) fn begin_upload(
        &mut self,
        slot: usize,
        name: String,
        total: u64,
        sha256: [u8; 32],
    ) -> Result<u32, FileTransferError> {
        if total > wasm_vm_slirp::file_transfer::MAX_TRANSFER_BYTES {
            return Err(FileTransferError::TooLarge);
        }
        self.next_stream = self.next_stream.wrapping_add(1).max(1);
        let stream = self.next_stream;
        let queue = Rc::new(RefCell::new(UploadQueue {
            total,
            ..UploadQueue::default()
        }));
        self.backend.borrow_mut().queue_file_upload(
            slot,
            stream,
            Box::new(BrowserUploadSource {
                name,
                sha256,
                queue: queue.clone(),
            }),
        )?;
        self.uploads.insert(stream, UploadRecord { slot, queue });
        Ok(stream)
    }

    pub(crate) fn push_upload(
        &mut self,
        stream: u32,
        bytes: &[u8],
        finished: bool,
    ) -> Result<usize, FileTransferError> {
        let upload = self
            .uploads
            .get(&stream)
            .ok_or(FileTransferError::BadState)?;
        let mut queue = upload.queue.borrow_mut();
        if queue.cancelled || queue.finished || bytes.is_empty() && !finished {
            return Err(FileTransferError::BadState);
        }
        if queue.buffered.saturating_add(bytes.len()) > MAX_BROWSER_TRANSFER_BUFFER {
            return Err(FileTransferError::FlowControl);
        }
        if !bytes.is_empty() {
            queue.buffered += bytes.len();
            queue.chunks.push_back(bytes.to_vec());
        }
        queue.finished = finished;
        Ok(queue.buffered)
    }

    pub(crate) fn cancel(&mut self, stream: u32) -> Result<(), FileTransferError> {
        let upload = self
            .uploads
            .get(&stream)
            .ok_or(FileTransferError::BadState)?;
        self.backend
            .borrow_mut()
            .cancel_file_transfer(upload.slot, stream)
    }

    pub(crate) fn cancel_download(&mut self, id: u32) -> Result<(), FileTransferError> {
        let (connection_id, stream_id) = self
            .downloads
            .borrow()
            .records
            .get(&id)
            .map(|record| (record.connection_id, record.stream_id))
            .ok_or(FileTransferError::BadState)?;
        self.backend
            .borrow_mut()
            .cancel_file_transfer_by_connection(connection_id, stream_id)
    }

    pub(crate) fn take_download_chunk(&mut self, id: u32) -> Option<Vec<u8>> {
        let mut downloads = self.downloads.borrow_mut();
        let record = downloads.records.get_mut(&id)?;
        let bytes = record.chunks.pop_front()?;
        record.buffered = record.buffered.saturating_sub(bytes.len());
        Some(bytes)
    }

    pub(crate) fn dismiss_download(&mut self, id: u32) -> bool {
        let mut downloads = self.downloads.borrow_mut();
        let removable = downloads.records.get(&id).is_some_and(|record| {
            (record.committed || record.cancelled) && record.chunks.is_empty()
        });
        removable && downloads.records.remove(&id).is_some()
    }

    pub(crate) fn status_json(&self) -> String {
        let backend = self.backend.borrow();
        let uploads = self
            .uploads
            .iter()
            .map(|(stream, upload)| {
                let queue = upload.queue.borrow();
                let state = if queue.cancelled {
                    "partial"
                } else if queue.sent == queue.total && backend.file_upload_ready(upload.slot) {
                    "complete"
                } else if backend.file_connection_terminal(upload.slot) {
                    "error"
                } else {
                    "active"
                };
                format!(
                    "{{\"id\":{stream},\"slot\":{},\"sent\":{},\"total\":{},\"buffered\":{},\"state\":\"{state}\"}}",
                    upload.slot, queue.sent, queue.total, queue.buffered
                )
            })
            .collect::<Vec<_>>()
            .join(",");
        let downloads = self
            .downloads
            .borrow()
            .records
            .iter()
            .map(|(id, record)| {
                let state = if record.cancelled {
                    "partial"
                } else if record.committed {
                    "complete"
                } else {
                    "active"
                };
                format!(
                    "{{\"id\":{id},\"name\":\"{}\",\"received\":{},\"total\":{},\"buffered\":{},\"state\":\"{state}\"}}",
                    escape_json(&record.name),
                    record.received,
                    record.total,
                    record.buffered
                )
            })
            .collect::<Vec<_>>()
            .join(",");
        format!(
            "{{\"maxBuffered\":{MAX_BROWSER_TRANSFER_BUFFER},\"uploads\":[{uploads}],\"downloads\":[{downloads}]}}"
        )
    }
}

pub(crate) fn parse_sha256(hex: &str) -> Result<[u8; 32], FileTransferError> {
    if hex.len() != 64 {
        return Err(FileTransferError::HashMismatch);
    }
    let mut out = [0u8; 32];
    for (index, byte) in out.iter_mut().enumerate() {
        *byte = u8::from_str_radix(&hex[index * 2..index * 2 + 2], 16)
            .map_err(|_| FileTransferError::HashMismatch)?;
    }
    Ok(out)
}

fn escape_json(input: &str) -> String {
    input
        .chars()
        .flat_map(|ch| match ch {
            '"' => "\\\"".chars().collect::<Vec<_>>(),
            '\\' => "\\\\".chars().collect(),
            '\n' => "\\n".chars().collect(),
            '\r' => "\\r".chars().collect(),
            '\t' => "\\t".chars().collect(),
            ch if ch.is_control() => format!("\\u{:04x}", ch as u32).chars().collect(),
            ch => vec![ch],
        })
        .collect()
}

pub(crate) struct IncrementalSha256(Sha256);

impl IncrementalSha256 {
    pub(crate) fn new() -> Self {
        Self(Sha256::new())
    }

    pub(crate) fn update(&mut self, bytes: &[u8]) {
        self.0.update(bytes);
    }

    pub(crate) fn finish(self) -> String {
        format!("{:x}", self.0.finalize())
    }
}
