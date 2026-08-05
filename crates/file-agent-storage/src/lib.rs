//! Crash-safe, capability-narrow storage for the WVFT guest peer.
//!
//! The public transfer API accepts normalized basenames, byte counts, hashes, and byte chunks.
//! Roots are opened once during trusted process setup. No transfer method accepts a path, URL,
//! destination, command, socket, or listener.

use sha2::{Digest, Sha256};
use std::cell::RefCell;
use std::ffi::{CStr, CString, OsStr};
use std::fs::{self, File};
use std::io::{Read, Seek, SeekFrom, Write};
use std::os::fd::{AsRawFd, FromRawFd, RawFd};
use std::os::unix::ffi::OsStrExt;
use std::path::{Path, PathBuf};
use std::rc::Rc;
use unicode_normalization::UnicodeNormalization;

pub const MAX_NAME_BYTES: usize = 255;
pub const MAX_TRANSFER_BYTES: u64 = 1_073_741_824;
pub const MAX_CONCURRENT_TRANSFERS: usize = 2;
pub const MAX_CHUNK_BYTES: usize = 65_528;
pub const IDLE_TIMEOUT_MS: u64 = 30_000;
const RECORD_MAGIC: &[u8; 8] = b"WVFTCMT1";

#[derive(Debug)]
pub enum Error {
    BadName,
    BadOffset,
    TooLarge,
    Busy,
    Quota,
    Timeout,
    HashMismatch,
    SourceChanged,
    Exists,
    Io(std::io::Error),
    Injected(FaultPoint),
}

impl PartialEq for Error {
    fn eq(&self, other: &Self) -> bool {
        std::mem::discriminant(self) == std::mem::discriminant(other)
    }
}

impl From<std::io::Error> for Error {
    fn from(value: std::io::Error) -> Self {
        Self::Io(value)
    }
}

pub type Result<T> = std::result::Result<T, Error>;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FaultPoint {
    AfterPartialSync,
    AfterRecordSync,
    AfterRename,
    AfterDirectorySync,
    AfterRecordRemoval,
}

#[derive(Debug, Clone)]
pub struct Config {
    pub inbox: PathBuf,
    pub outbox: PathBuf,
    pub quota_bytes: u64,
}

struct Directory {
    file: File,
    path: PathBuf,
}

impl Directory {
    fn open(path: &Path) -> Result<Self> {
        fs::create_dir_all(path)?;
        let file = File::open(path)?;
        Ok(Self {
            file,
            path: path.to_owned(),
        })
    }

    fn fd(&self) -> RawFd {
        self.file.as_raw_fd()
    }

    fn sync(&self) -> Result<()> {
        self.file.sync_all().map_err(Error::Io)
    }

    fn open_file(&self, name: &CStr, flags: i32, mode: libc::mode_t) -> Result<File> {
        // SAFETY: directory fd and C string are live; returned fd is immediately owned by File.
        let fd = unsafe {
            libc::openat(
                self.fd(),
                name.as_ptr(),
                flags | libc::O_CLOEXEC,
                mode as libc::c_uint,
            )
        };
        if fd < 0 {
            return Err(Error::Io(std::io::Error::last_os_error()));
        }
        // SAFETY: openat returned a new owned descriptor.
        Ok(unsafe { File::from_raw_fd(fd) })
    }

    fn unlink(&self, name: &CStr) -> Result<()> {
        // SAFETY: directory fd and C string are live.
        if unsafe { libc::unlinkat(self.fd(), name.as_ptr(), 0) } == 0 {
            Ok(())
        } else {
            Err(Error::Io(std::io::Error::last_os_error()))
        }
    }

    fn link_no_replace(&self, source: &CStr, target: &CStr) -> Result<()> {
        // linkat is an atomic no-replace publication: an existing target returns EEXIST.
        // SAFETY: both names are single validated components under the same live directory fd.
        if unsafe { libc::linkat(self.fd(), source.as_ptr(), self.fd(), target.as_ptr(), 0) } == 0 {
            Ok(())
        } else {
            let error = std::io::Error::last_os_error();
            if error.raw_os_error() == Some(libc::EEXIST) {
                Err(Error::Exists)
            } else {
                Err(Error::Io(error))
            }
        }
    }

    fn identity(&self, name: &CStr) -> Result<FileIdentity> {
        // SAFETY: output storage, directory fd, and C string are valid.
        let mut stat: libc::stat = unsafe { std::mem::zeroed() };
        if unsafe {
            libc::fstatat(
                self.fd(),
                name.as_ptr(),
                &mut stat,
                libc::AT_SYMLINK_NOFOLLOW,
            )
        } != 0
        {
            return Err(Error::Io(std::io::Error::last_os_error()));
        }
        identity_from_stat(&stat)
    }

    #[cfg(target_os = "linux")]
    fn link_descriptor_no_replace(&self, source: &File, target: &CStr) -> Result<()> {
        let empty = CStr::from_bytes_with_nul(b"\0").expect("empty C string");
        // AT_EMPTY_PATH is the direct descriptor primitive. It succeeds for a suitably privileged
        // static agent and avoids requiring procfs to be mounted.
        // SAFETY: both descriptors and C strings are live.
        let direct = unsafe {
            libc::linkat(
                source.as_raw_fd(),
                empty.as_ptr(),
                self.fd(),
                target.as_ptr(),
                libc::AT_EMPTY_PATH,
            )
        };
        if direct == 0 {
            return Ok(());
        }
        let direct_error = std::io::Error::last_os_error();
        if direct_error.raw_os_error() == Some(libc::EEXIST) {
            return Err(Error::Exists);
        }

        // `/proc/self/fd/N` binds the source to the already-open, validated inode. In contrast,
        // linking the private pathname would reopen a race after its identity check. This is the
        // unprivileged fallback when AT_EMPTY_PATH is denied.
        let source_path =
            CString::new(format!("/proc/self/fd/{}", source.as_raw_fd())).expect("fd path");
        // SAFETY: both descriptors and C strings are live. AT_SYMLINK_FOLLOW dereferences only the
        // kernel-owned procfs descriptor link; the target remains beneath the held directory fd.
        let result = unsafe {
            libc::linkat(
                libc::AT_FDCWD,
                source_path.as_ptr(),
                self.fd(),
                target.as_ptr(),
                libc::AT_SYMLINK_FOLLOW,
            )
        };
        map_publish_result(result)
    }

    #[cfg(target_os = "linux")]
    fn publish_file_no_replace(
        &self,
        source: &File,
        target: &CStr,
        total_len: u64,
        expected_sha: [u8; 32],
    ) -> Result<()> {
        let dot = CStr::from_bytes_with_nul(b".\0").expect("dot C string");
        let mut promoted = self.open_file(dot, libc::O_RDWR | libc::O_TMPFILE, 0o600)?;
        copy_validated(source, &mut promoted, total_len, expected_sha)?;
        promoted.sync_data()?;
        // Only the unreachable O_TMPFILE inode becomes visible. Any writer retained from the
        // original partial therefore cannot mutate bytes after COMPLETE.
        self.link_descriptor_no_replace(&promoted, target)
    }

    #[cfg(target_os = "macos")]
    fn publish_file_no_replace(
        &self,
        source: &File,
        target: &CStr,
        total_len: u64,
        expected_sha: [u8; 32],
    ) -> Result<()> {
        // fclonefileat reads from the held descriptor and creates the target with no replacement.
        // It therefore preserves the same descriptor-binding guarantee as Linux's procfd link.
        // SAFETY: source/directory descriptors and target C string are live.
        let result =
            unsafe { libc::fclonefileat(source.as_raw_fd(), self.fd(), target.as_ptr(), 0) };
        map_publish_result(result)?;
        let published = self.open_file(target, libc::O_RDONLY | libc::O_NOFOLLOW, 0)?;
        if file_matches(&published, total_len, expected_sha)? {
            Ok(())
        } else {
            self.unlink(target)?;
            Err(Error::SourceChanged)
        }
    }

    #[cfg(not(any(target_os = "linux", target_os = "macos")))]
    fn publish_file_no_replace(
        &self,
        _source: &File,
        _target: &CStr,
        _total_len: u64,
        _expected_sha: [u8; 32],
    ) -> Result<()> {
        // This security boundary currently targets Linux guests and has a descriptor-bound macOS
        // model. Refuse publication on platforms without an equivalent primitive.
        Err(Error::Io(std::io::Error::new(
            std::io::ErrorKind::Unsupported,
            "descriptor-bound publication is unavailable",
        )))
    }
}

fn map_publish_result(result: i32) -> Result<()> {
    if result == 0 {
        Ok(())
    } else {
        let error = std::io::Error::last_os_error();
        if error.raw_os_error() == Some(libc::EEXIST) {
            Err(Error::Exists)
        } else {
            Err(Error::Io(error))
        }
    }
}

struct Shared {
    active: usize,
    reserved_bytes: u64,
    active_names: Vec<String>,
    next_epoch: u64,
    quota_bytes: u64,
    fault: Option<FaultPoint>,
    leases: Vec<Rc<RefCell<Lease>>>,
}

struct Lease {
    name: String,
    total_len: u64,
    resident_bytes: u64,
    last_activity_ms: u64,
    expired: bool,
    released: bool,
}

pub struct Storage {
    inbox: Rc<Directory>,
    outbox: Rc<Directory>,
    shared: Rc<RefCell<Shared>>,
}

impl Storage {
    pub fn open(config: Config) -> Result<Self> {
        if config.inbox == config.outbox {
            return Err(Error::BadName);
        }
        let inbox = Rc::new(Directory::open(&config.inbox)?);
        let outbox = Rc::new(Directory::open(&config.outbox)?);
        let inbox_identity = metadata(&inbox.file)?;
        let outbox_identity = metadata(&outbox.file)?;
        if (inbox_identity.device, inbox_identity.inode)
            == (outbox_identity.device, outbox_identity.inode)
        {
            return Err(Error::BadName);
        }
        let next_epoch = next_epoch(&inbox.path)?;
        let storage = Self {
            inbox,
            outbox,
            shared: Rc::new(RefCell::new(Shared {
                active: 0,
                reserved_bytes: 0,
                active_names: Vec::new(),
                next_epoch,
                quota_bytes: config.quota_bytes.min(MAX_TRANSFER_BYTES * 2),
                fault: None,
                leases: Vec::new(),
            })),
        };
        storage.recover()?;
        storage.shared.borrow_mut().reserved_bytes = retained_bytes(&storage.inbox)?;
        Ok(storage)
    }

    pub fn set_fault(&self, fault: Option<FaultPoint>) {
        self.shared.borrow_mut().fault = fault;
    }

    pub fn active_transfers(&self) -> usize {
        self.shared.borrow().active
    }

    pub fn begin_upload(
        &self,
        name: &str,
        total_len: u64,
        expected_sha: [u8; 32],
    ) -> Result<Upload> {
        self.begin_upload_at(name, total_len, expected_sha, 0)
    }

    pub fn begin_upload_at(
        &self,
        name: &str,
        total_len: u64,
        expected_sha: [u8; 32],
        now_ms: u64,
    ) -> Result<Upload> {
        let name = normalize_name(name)?;
        if total_len > MAX_TRANSFER_BYTES {
            return Err(Error::TooLarge);
        }
        let mut shared = self.shared.borrow_mut();
        if shared.active >= MAX_CONCURRENT_TRANSFERS {
            return Err(Error::Busy);
        }
        if shared.active_names.iter().any(|active| active == &name) {
            return Err(Error::Exists);
        }
        if shared
            .reserved_bytes
            .checked_add(total_len)
            .is_none_or(|total| total > shared.quota_bytes)
        {
            return Err(Error::Quota);
        }
        let final_name = c_name(&name)?;
        if entry_exists(self.inbox.fd(), &final_name)? {
            return Err(Error::Exists);
        }
        let epoch = shared.next_epoch;
        shared.next_epoch = shared.next_epoch.wrapping_add(1).max(1);
        let partial_text = format!(".wvft-{epoch:016x}.part");
        let record_text = format!(".wvft-{epoch:016x}.commit");
        let partial_name = c_name(&partial_text)?;
        let record_name = c_name(&record_text)?;
        let file = self.inbox.open_file(
            &partial_name,
            libc::O_RDWR | libc::O_CREAT | libc::O_EXCL | libc::O_NOFOLLOW,
            0o600,
        )?;
        shared.active += 1;
        shared.reserved_bytes += total_len;
        shared.active_names.push(name.clone());
        let lease = Rc::new(RefCell::new(Lease {
            name: name.clone(),
            total_len,
            resident_bytes: 0,
            last_activity_ms: now_ms,
            expired: false,
            released: false,
        }));
        shared.leases.push(lease.clone());
        drop(shared);
        Ok(Upload {
            dir: self.inbox.clone(),
            shared: self.shared.clone(),
            file: Some(file),
            name,
            final_name,
            partial_name,
            record_name,
            total_len,
            expected_sha,
            offset: 0,
            hasher: Sha256::new(),
            lease,
        })
    }

    pub fn expire(&self, now_ms: u64) -> usize {
        let leases = self.shared.borrow().leases.clone();
        let mut expired = 0;
        for lease in leases {
            let mut lease = lease.borrow_mut();
            if !lease.released && now_ms.saturating_sub(lease.last_activity_ms) >= IDLE_TIMEOUT_MS {
                lease.expired = true;
                self.release_lease(&mut lease);
                expired += 1;
            }
        }
        self.shared
            .borrow_mut()
            .leases
            .retain(|lease| !lease.borrow().released);
        expired
    }

    fn release_lease(&self, lease: &mut Lease) {
        if lease.released {
            return;
        }
        let mut shared = self.shared.borrow_mut();
        shared.active = shared.active.saturating_sub(1);
        shared.reserved_bytes = shared
            .reserved_bytes
            .saturating_sub(lease.total_len.saturating_sub(lease.resident_bytes));
        shared.active_names.retain(|name| name != &lease.name);
        lease.released = true;
    }

    pub fn open_download(&self, name: &str) -> Result<Download> {
        let name = normalize_name(name)?;
        let c_name = c_name(&name)?;
        let mut file = self
            .outbox
            .open_file(&c_name, libc::O_RDONLY | libc::O_NOFOLLOW, 0)?;
        let before = metadata(&file)?;
        validate_source_metadata(&before)?;
        if before.size > MAX_TRANSFER_BYTES {
            return Err(Error::TooLarge);
        }
        let mut hasher = Sha256::new();
        let mut buffer = vec![0u8; MAX_CHUNK_BYTES];
        loop {
            let count = file.read(&mut buffer)?;
            if count == 0 {
                break;
            }
            hasher.update(&buffer[..count]);
        }
        let after_hash = metadata(&file)?;
        if before != after_hash {
            return Err(Error::SourceChanged);
        }
        file.seek(SeekFrom::Start(0))?;
        Ok(Download {
            file,
            expected: before,
            total_len: before.size,
            sha256: hasher.finalize().into(),
            offset: 0,
            observed: Sha256::new(),
        })
    }

    pub fn recover(&self) -> Result<()> {
        // Snapshot names before mutating the directory; renaming while walking `read_dir` can make
        // later entries disappear from the platform iterator.
        let names: Vec<_> = fs::read_dir(&self.inbox.path)?
            .map(|entry| entry.map(|entry| entry.file_name()))
            .collect::<std::io::Result<_>>()?;
        for name in names {
            let bytes = name.as_bytes();
            if !bytes.starts_with(b".wvft-") || !bytes.ends_with(b".commit") {
                continue;
            }
            let record_name = CString::new(bytes).map_err(|_| Error::BadName)?;
            let record =
                self.inbox
                    .open_file(&record_name, libc::O_RDONLY | libc::O_NOFOLLOW, 0)?;
            let mut encoded = Vec::new();
            record.take(4_096).read_to_end(&mut encoded)?;
            let parsed = decode_record(&encoded);
            match parsed {
                Ok(record) => {
                    let final_name = c_name(&record.name)?;
                    let partial_name = partial_name_for_record(&record_name)?;
                    if entry_exists(self.inbox.fd(), &final_name)? {
                        let file = self.inbox.open_file(
                            &final_name,
                            libc::O_RDONLY | libc::O_NOFOLLOW,
                            0,
                        )?;
                        let final_identity = metadata(&file)?;
                        let partial_identity = self.inbox.identity(&partial_name).ok();
                        let safe_links = final_identity.links == 1
                            || (final_identity.links == 2
                                && partial_identity.is_some_and(|partial| {
                                    (partial.device, partial.inode)
                                        == (final_identity.device, final_identity.inode)
                                }));
                        if safe_links && file_matches(&file, record.total_len, record.sha256)? {
                            let partial_exists = partial_identity.is_some();
                            if partial_exists {
                                self.inbox.unlink(&partial_name)?;
                            }
                            self.inbox.sync()?;
                            self.inbox.unlink(&record_name)?;
                            self.inbox.sync()?;
                        } else {
                            quarantine(&self.inbox, &final_name)?;
                            quarantine(&self.inbox, &record_name)?;
                        }
                    } else if !entry_exists(self.inbox.fd(), &partial_name)? {
                        quarantine(&self.inbox, &record_name)?;
                    }
                    // A valid record with only a partial is an explicit interrupted transfer. Keep
                    // both private artifacts for inspection/retry; never manufacture a final name.
                }
                Err(_) => {
                    if let Some(name) = salvage_record_name(&encoded) {
                        let final_name = c_name(&name)?;
                        if entry_exists(self.inbox.fd(), &final_name)? {
                            quarantine(&self.inbox, &final_name)?;
                        }
                    } else {
                        // If even the bounded basename field is corrupt, association is
                        // unknowable. Fail safe: quarantine every visible inbox final rather than
                        // let a possibly interrupted name masquerade as complete.
                        quarantine_visible_finals(&self.inbox)?;
                    }
                    quarantine(&self.inbox, &record_name)?;
                }
            }
        }
        Ok(())
    }
}

pub struct Upload {
    dir: Rc<Directory>,
    shared: Rc<RefCell<Shared>>,
    file: Option<File>,
    name: String,
    final_name: CString,
    partial_name: CString,
    record_name: CString,
    total_len: u64,
    expected_sha: [u8; 32],
    offset: u64,
    hasher: Sha256,
    lease: Rc<RefCell<Lease>>,
}

impl Upload {
    pub fn write_chunk(&mut self, offset: u64, bytes: &[u8]) -> Result<()> {
        if self.lease.borrow().expired {
            return Err(Error::Timeout);
        }
        if bytes.is_empty() || bytes.len() > MAX_CHUNK_BYTES || offset != self.offset {
            return Err(Error::BadOffset);
        }
        if self
            .offset
            .checked_add(bytes.len() as u64)
            .is_none_or(|end| end > self.total_len)
        {
            return Err(Error::BadOffset);
        }
        self.file
            .as_mut()
            .ok_or(Error::SourceChanged)?
            .write_all(bytes)?;
        self.hasher.update(bytes);
        self.offset += bytes.len() as u64;
        self.lease.borrow_mut().resident_bytes = self.offset;
        Ok(())
    }

    pub fn touch(&self, now_ms: u64) -> Result<()> {
        let mut lease = self.lease.borrow_mut();
        if lease.expired {
            return Err(Error::Timeout);
        }
        lease.last_activity_ms = now_ms;
        Ok(())
    }

    pub fn buffered_bytes(&self) -> usize {
        0
    }

    pub fn commit(mut self) -> Result<()> {
        if self.lease.borrow().expired {
            return Err(Error::Timeout);
        }
        if self.offset != self.total_len
            || <[u8; 32]>::from(self.hasher.clone().finalize()) != self.expected_sha
        {
            return Err(Error::HashMismatch);
        }
        let file = self.file.take().ok_or(Error::SourceChanged)?;
        file.sync_data()?;
        self.hit(FaultPoint::AfterPartialSync)?;
        let held_identity = metadata(&file)?;
        if held_identity.mode & libc::S_IFMT as u32 != libc::S_IFREG as u32
            || held_identity.size != self.total_len
            || held_identity.links != 1
            || self.dir.identity(&self.partial_name)? != held_identity
        {
            return Err(Error::SourceChanged);
        }

        let record = encode_record(&self.name, self.total_len, self.expected_sha);
        let mut record_file = self.dir.open_file(
            &self.record_name,
            libc::O_WRONLY | libc::O_CREAT | libc::O_EXCL | libc::O_NOFOLLOW,
            0o600,
        )?;
        record_file.write_all(&record)?;
        record_file.sync_all()?;
        self.hit(FaultPoint::AfterRecordSync)?;

        self.dir.publish_file_no_replace(
            &file,
            &self.final_name,
            self.total_len,
            self.expected_sha,
        )?;
        self.hit(FaultPoint::AfterRename)?;
        self.dir.unlink(&self.partial_name)?;
        self.dir.sync()?;
        self.hit(FaultPoint::AfterDirectorySync)?;
        self.dir.unlink(&self.record_name)?;
        self.hit(FaultPoint::AfterRecordRemoval)?;
        self.dir.sync()?;
        self.release();
        Ok(())
    }

    fn hit(&self, point: FaultPoint) -> Result<()> {
        if self.shared.borrow().fault == Some(point) {
            Err(Error::Injected(point))
        } else {
            Ok(())
        }
    }

    fn release(&mut self) {
        let mut lease = self.lease.borrow_mut();
        if lease.released {
            return;
        }
        let mut shared = self.shared.borrow_mut();
        shared.active = shared.active.saturating_sub(1);
        shared.reserved_bytes = shared
            .reserved_bytes
            .saturating_sub(lease.total_len.saturating_sub(lease.resident_bytes));
        shared.active_names.retain(|name| name != &lease.name);
        lease.released = true;
    }
}

impl Drop for Upload {
    fn drop(&mut self) {
        self.release();
        // Cancellation retains only private `.part`/commit artifacts for explicit interrupted
        // transfer inspection or recovery; it never promotes them.
    }
}

pub struct Download {
    file: File,
    expected: FileIdentity,
    total_len: u64,
    sha256: [u8; 32],
    offset: u64,
    observed: Sha256,
}

impl Download {
    pub fn total_len(&self) -> u64 {
        self.total_len
    }

    pub fn sha256(&self) -> [u8; 32] {
        self.sha256
    }

    pub fn read_chunk(&mut self, max: usize) -> Result<Vec<u8>> {
        if max == 0 || max > MAX_CHUNK_BYTES {
            return Err(Error::BadOffset);
        }
        if metadata(&self.file)? != self.expected {
            return Err(Error::SourceChanged);
        }
        let mut bytes = vec![0; max.min((self.total_len - self.offset) as usize)];
        let count = self.file.read(&mut bytes)?;
        bytes.truncate(count);
        self.observed.update(&bytes);
        self.offset += count as u64;
        if self.offset == self.total_len
            && (metadata(&self.file)? != self.expected
                || <[u8; 32]>::from(self.observed.clone().finalize()) != self.sha256
                || !file_matches(&self.file, self.total_len, self.sha256)?)
        {
            return Err(Error::SourceChanged);
        }
        Ok(bytes)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct FileIdentity {
    device: u64,
    inode: u64,
    size: u64,
    links: u64,
    mode: u32,
    modified_sec: i64,
    modified_nsec: i64,
}

fn metadata(file: &File) -> Result<FileIdentity> {
    // SAFETY: zeroed stat is valid output storage and fd is live.
    let mut stat: libc::stat = unsafe { std::mem::zeroed() };
    if unsafe { libc::fstat(file.as_raw_fd(), &mut stat) } != 0 {
        return Err(Error::Io(std::io::Error::last_os_error()));
    }
    identity_from_stat(&stat)
}

fn identity_from_stat(stat: &libc::stat) -> Result<FileIdentity> {
    Ok(FileIdentity {
        device: stat.st_dev as u64,
        inode: stat.st_ino,
        size: stat.st_size.try_into().map_err(|_| Error::TooLarge)?,
        links: stat.st_nlink as u64,
        mode: stat.st_mode as u32,
        modified_sec: stat.st_mtime,
        modified_nsec: stat.st_mtime_nsec,
    })
}

fn retained_bytes(dir: &Directory) -> Result<u64> {
    let mut identities = Vec::new();
    let mut total = 0u64;
    for entry in fs::read_dir(&dir.path)? {
        let entry = entry?;
        let name = CString::new(entry.file_name().as_bytes()).map_err(|_| Error::BadName)?;
        let identity = dir.identity(&name)?;
        if identity.mode & libc::S_IFMT as u32 != libc::S_IFREG as u32
            || identities.contains(&(identity.device, identity.inode))
        {
            continue;
        }
        identities.push((identity.device, identity.inode));
        total = total.checked_add(identity.size).ok_or(Error::TooLarge)?;
    }
    Ok(total)
}

fn validate_source_metadata(identity: &FileIdentity) -> Result<()> {
    if identity.mode & libc::S_IFMT as u32 != libc::S_IFREG as u32 || identity.links != 1 {
        Err(Error::BadName)
    } else {
        Ok(())
    }
}

fn entry_exists(dir: RawFd, name: &CStr) -> Result<bool> {
    // SAFETY: output storage, directory fd, and C string are valid.
    let mut stat: libc::stat = unsafe { std::mem::zeroed() };
    let result = unsafe { libc::fstatat(dir, name.as_ptr(), &mut stat, libc::AT_SYMLINK_NOFOLLOW) };
    if result == 0 {
        Ok(true)
    } else {
        let error = std::io::Error::last_os_error();
        if error.raw_os_error() == Some(libc::ENOENT) {
            Ok(false)
        } else {
            Err(Error::Io(error))
        }
    }
}

fn normalize_name(name: &str) -> Result<String> {
    let normalized: String = name.nfc().collect();
    if normalized.is_empty()
        || normalized.len() > MAX_NAME_BYTES
        || normalized == "."
        || normalized == ".."
        || normalized.ends_with([' ', '.'])
        || normalized.chars().any(|ch| {
            ch == '/'
                || ch == '\\'
                || ch.is_control()
                || matches!(ch as u32, 0x202a..=0x202e | 0x2066..=0x2069)
                || matches!(ch as u32, 0xfdd0..=0xfdef)
                || (ch as u32 & 0xfffe) == 0xfffe
        })
    {
        return Err(Error::BadName);
    }
    Ok(normalized)
}

fn c_name(name: &str) -> Result<CString> {
    CString::new(OsStr::new(name).as_bytes()).map_err(|_| Error::BadName)
}

struct CommitRecord {
    name: String,
    total_len: u64,
    sha256: [u8; 32],
}

fn encode_record(name: &str, total_len: u64, sha256: [u8; 32]) -> Vec<u8> {
    let mut encoded = Vec::with_capacity(50 + name.len());
    encoded.extend_from_slice(RECORD_MAGIC);
    encoded.extend_from_slice(&(name.len() as u16).to_be_bytes());
    encoded.extend_from_slice(&total_len.to_be_bytes());
    encoded.extend_from_slice(&sha256);
    encoded.extend_from_slice(name.as_bytes());
    encoded
}

fn decode_record(encoded: &[u8]) -> Result<CommitRecord> {
    if encoded.len() < 50 || &encoded[..8] != RECORD_MAGIC {
        return Err(Error::HashMismatch);
    }
    let name_len = u16::from_be_bytes(encoded[8..10].try_into().unwrap()) as usize;
    if encoded.len() != 50 + name_len {
        return Err(Error::HashMismatch);
    }
    let name = std::str::from_utf8(&encoded[50..]).map_err(|_| Error::BadName)?;
    let total_len = u64::from_be_bytes(encoded[10..18].try_into().unwrap());
    if total_len > MAX_TRANSFER_BYTES {
        return Err(Error::TooLarge);
    }
    Ok(CommitRecord {
        name: normalize_name(name)?,
        total_len,
        sha256: encoded[18..50].try_into().unwrap(),
    })
}

fn salvage_record_name(encoded: &[u8]) -> Option<String> {
    if encoded.len() <= 50 || encoded.len() > 50 + MAX_NAME_BYTES {
        return None;
    }
    let name = std::str::from_utf8(&encoded[50..]).ok()?;
    normalize_name(name).ok()
}

fn partial_name_for_record(record_name: &CStr) -> Result<CString> {
    CString::new(
        record_name
            .to_bytes()
            .strip_suffix(b".commit")
            .ok_or(Error::BadName)?
            .iter()
            .copied()
            .chain(b".part".iter().copied())
            .collect::<Vec<_>>(),
    )
    .map_err(|_| Error::BadName)
}

#[cfg(target_os = "linux")]
fn copy_validated(
    source: &File,
    target: &mut File,
    total_len: u64,
    sha256: [u8; 32],
) -> Result<()> {
    let mut source = source.try_clone()?;
    source.seek(SeekFrom::Start(0))?;
    let mut copied = 0u64;
    let mut hasher = Sha256::new();
    let mut buffer = vec![0; MAX_CHUNK_BYTES];
    loop {
        let count = source.read(&mut buffer)?;
        if count == 0 {
            break;
        }
        copied = copied.checked_add(count as u64).ok_or(Error::TooLarge)?;
        if copied > total_len {
            return Err(Error::SourceChanged);
        }
        target.write_all(&buffer[..count])?;
        hasher.update(&buffer[..count]);
    }
    if copied != total_len || <[u8; 32]>::from(hasher.finalize()) != sha256 {
        Err(Error::SourceChanged)
    } else {
        Ok(())
    }
}

fn file_matches(file: &File, total_len: u64, sha256: [u8; 32]) -> Result<bool> {
    let identity = metadata(file)?;
    if identity.mode & libc::S_IFMT as u32 != libc::S_IFREG as u32 || identity.size != total_len {
        return Ok(false);
    }
    let mut clone = file.try_clone()?;
    clone.seek(SeekFrom::Start(0))?;
    let mut hasher = Sha256::new();
    let mut buffer = vec![0; MAX_CHUNK_BYTES];
    loop {
        let count = clone.read(&mut buffer)?;
        if count == 0 {
            break;
        }
        hasher.update(&buffer[..count]);
    }
    Ok(<[u8; 32]>::from(hasher.finalize()) == sha256)
}

fn quarantine(dir: &Directory, record_name: &CStr) -> Result<()> {
    let digest = Sha256::digest(record_name.to_bytes());
    let prefix = digest[..8]
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect::<String>();
    for counter in 0..16 {
        let target = c_name(&format!(".wvft-quarantine-{prefix}-{counter}.quarantine"))?;
        match dir.link_no_replace(record_name, &target) {
            Ok(()) => {
                dir.unlink(record_name)?;
                return dir.sync();
            }
            Err(Error::Exists) => continue,
            Err(error) => return Err(error),
        }
    }
    Err(Error::Busy)
}

fn quarantine_visible_finals(dir: &Directory) -> Result<()> {
    let names: Vec<_> = fs::read_dir(&dir.path)?
        .filter_map(|entry| entry.ok())
        .map(|entry| entry.file_name())
        .filter(|name| !name.as_bytes().starts_with(b"."))
        .collect();
    for name in names {
        let name = CString::new(name.as_bytes()).map_err(|_| Error::BadName)?;
        quarantine(dir, &name)?;
    }
    Ok(())
}

fn next_epoch(path: &Path) -> Result<u64> {
    let mut next = 1u64;
    for entry in fs::read_dir(path)? {
        let entry = entry?;
        let name = entry.file_name();
        let bytes = name.as_bytes();
        if let Some(hex) = bytes
            .strip_prefix(b".wvft-")
            .and_then(|rest| rest.get(..16))
            .and_then(|hex| std::str::from_utf8(hex).ok())
            && let Ok(epoch) = u64::from_str_radix(hex, 16)
        {
            next = next.max(epoch.wrapping_add(1).max(1));
        }
    }
    Ok(next)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn setup(quota_bytes: u64) -> (TempDir, Storage, PathBuf, PathBuf) {
        let temp = tempfile::tempdir().unwrap();
        let inbox = temp.path().join("inbox");
        let outbox = temp.path().join("outbox");
        let storage = Storage::open(Config {
            inbox: inbox.clone(),
            outbox: outbox.clone(),
            quota_bytes,
        })
        .unwrap();
        (temp, storage, inbox, outbox)
    }

    fn pattern_sha(total: usize) -> [u8; 32] {
        let chunk = vec![0x5a; MAX_CHUNK_BYTES];
        let mut hasher = Sha256::new();
        let mut remaining = total;
        while remaining > 0 {
            let count = remaining.min(chunk.len());
            hasher.update(&chunk[..count]);
            remaining -= count;
        }
        hasher.finalize().into()
    }

    fn upload_pattern(storage: &Storage, name: &str, total: usize) {
        let sha = pattern_sha(total);
        let mut upload = storage.begin_upload(name, total as u64, sha).unwrap();
        let chunk = vec![0x5a; MAX_CHUNK_BYTES];
        let mut offset = 0;
        while offset < total {
            let count = (total - offset).min(chunk.len());
            upload.write_chunk(offset as u64, &chunk[..count]).unwrap();
            assert_eq!(upload.buffered_bytes(), 0);
            offset += count;
        }
        upload.commit().unwrap();
    }

    #[test]
    fn empty_and_100_mib_uploads_stream_without_owned_file_buffering() {
        let (_temp, storage, inbox, _outbox) = setup(200 * 1024 * 1024);
        upload_pattern(&storage, "empty.bin", 0);
        upload_pattern(&storage, "large.bin", 100 * 1024 * 1024);
        assert_eq!(fs::metadata(inbox.join("empty.bin")).unwrap().len(), 0);
        assert_eq!(
            fs::metadata(inbox.join("large.bin")).unwrap().len(),
            100 * 1024 * 1024
        );
        let mut file = File::open(inbox.join("large.bin")).unwrap();
        let mut hasher = Sha256::new();
        let mut buffer = vec![0; MAX_CHUNK_BYTES];
        loop {
            let count = file.read(&mut buffer).unwrap();
            if count == 0 {
                break;
            }
            hasher.update(&buffer[..count]);
        }
        assert_eq!(
            <[u8; 32]>::from(hasher.finalize()),
            pattern_sha(100 * 1024 * 1024)
        );
        assert_eq!(storage.active_transfers(), 0);
    }

    #[test]
    fn hostile_names_aliases_links_and_symlinks_fail_closed() {
        let (_temp, storage, inbox, outbox) = setup(1024);
        for bad in [
            "",
            ".",
            "..",
            "../x",
            "/etc/passwd",
            "a/b",
            r"a\b",
            "trailing.",
            "trailing ",
            "x\0y",
            "x\u{85}y",
            "x\u{202e}y",
            "x\u{fdd0}y",
            "x\u{ffff}y",
        ] {
            assert!(
                matches!(
                    storage.begin_upload(bad, 0, Sha256::digest([]).into()),
                    Err(Error::BadName)
                ),
                "hostile name accepted or misclassified: {bad:?}"
            );
        }
        assert!(matches!(
            storage.begin_upload(&"x".repeat(256), 0, Sha256::digest([]).into()),
            Err(Error::BadName)
        ));

        let first = storage
            .begin_upload("e\u{301}.txt", 1, Sha256::digest(b"x").into())
            .unwrap();
        assert!(matches!(
            storage.begin_upload("é.txt", 1, Sha256::digest(b"x").into()),
            Err(Error::Exists)
        ));
        drop(first);

        fs::write(inbox.join("exists"), b"x").unwrap();
        assert!(matches!(
            storage.begin_upload("exists", 0, Sha256::digest([]).into()),
            Err(Error::Exists)
        ));
        std::os::unix::fs::symlink("/etc/passwd", inbox.join("symlink")).unwrap();
        assert!(
            storage
                .begin_upload("symlink", 0, Sha256::digest([]).into())
                .is_err()
        );

        fs::write(outbox.join("offered"), b"secret").unwrap();
        fs::hard_link(
            outbox.join("offered"),
            outbox.parent().unwrap().join("outside"),
        )
        .unwrap();
        assert!(matches!(
            storage.open_download("offered"),
            Err(Error::BadName)
        ));
        std::os::unix::fs::symlink("/etc/passwd", outbox.join("source-link")).unwrap();
        assert!(storage.open_download("source-link").is_err());
    }

    #[test]
    fn quota_concurrency_and_exact_offsets_are_enforced() {
        let (_temp, storage, _inbox, _outbox) = setup(10);
        let mut first = storage
            .begin_upload("a", 5, Sha256::digest(b"aaaaa").into())
            .unwrap();
        let second = storage
            .begin_upload("b", 5, Sha256::digest(b"bbbbb").into())
            .unwrap();
        assert!(matches!(
            storage.begin_upload("c", 0, Sha256::digest([]).into()),
            Err(Error::Busy)
        ));
        assert!(matches!(first.write_chunk(1, b"a"), Err(Error::BadOffset)));
        assert!(matches!(
            first.write_chunk(0, &vec![0; MAX_CHUNK_BYTES + 1]),
            Err(Error::BadOffset)
        ));
        drop(second);
        assert!(matches!(
            storage.begin_upload("quota", 6, Sha256::digest([0; 6]).into()),
            Err(Error::Quota)
        ));
        assert!(matches!(
            storage.begin_upload(
                "too-large",
                MAX_TRANSFER_BYTES + 1,
                Sha256::digest([]).into()
            ),
            Err(Error::TooLarge)
        ));
        drop(first);
        assert_eq!(storage.active_transfers(), 0);
    }

    #[test]
    fn idle_timeout_releases_shared_quota_and_terminalizes_the_handle() {
        let (_temp, storage, _inbox, _outbox) = setup(5);
        let mut upload = storage
            .begin_upload_at("idle", 5, Sha256::digest(b"aaaaa").into(), 10)
            .unwrap();
        upload.touch(20).unwrap();
        assert_eq!(storage.expire(20 + IDLE_TIMEOUT_MS - 1), 0);
        assert_eq!(storage.expire(20 + IDLE_TIMEOUT_MS), 1);
        assert_eq!(storage.active_transfers(), 0);
        assert!(matches!(upload.write_chunk(0, b"a"), Err(Error::Timeout)));
        let replacement = storage
            .begin_upload("replacement", 5, Sha256::digest(b"bbbbb").into())
            .unwrap();
        drop(replacement);
    }

    #[test]
    fn cancellation_before_data_after_partial_and_after_last_data_never_publishes() {
        for (name, chunks) in [
            ("before", Vec::<&[u8]>::new()),
            ("partial", vec![b"a".as_slice()]),
            ("after-last", vec![b"ab".as_slice()]),
        ] {
            let (_temp, storage, inbox, _outbox) = setup(16);
            let mut upload = storage
                .begin_upload(name, 2, Sha256::digest(b"ab").into())
                .unwrap();
            let mut offset = 0;
            for chunk in chunks {
                upload.write_chunk(offset, chunk).unwrap();
                offset += chunk.len() as u64;
            }
            drop(upload);
            assert!(!inbox.join(name).exists());
            assert_eq!(storage.active_transfers(), 0);
            assert!(
                fs::read_dir(&inbox).unwrap().all(|entry| entry
                    .unwrap()
                    .file_name()
                    .as_bytes()
                    .starts_with(b".wvft-"))
            );
        }
    }

    #[test]
    fn replaced_partial_name_cannot_publish_unvalidated_out_of_root_inode() {
        let (temp, storage, inbox, _outbox) = setup(1024);
        let outside = temp.path().join("outside-attacker-file");
        fs::write(&outside, b"attacker").unwrap();

        let mut upload = storage
            .begin_upload("final", 7, Sha256::digest(b"correct").into())
            .unwrap();
        upload.write_chunk(0, b"correct").unwrap();

        let partial = inbox.join(".wvft-0000000000000001.part");
        fs::remove_file(&partial).unwrap();
        fs::hard_link(&outside, &partial).unwrap();

        assert!(
            upload.commit().is_err(),
            "commit must reject a partial pathname that no longer identifies the held, hashed inode"
        );
        assert!(
            !inbox.join("final").exists(),
            "unvalidated attacker bytes became visible under the final name"
        );
        assert_eq!(fs::read(&outside).unwrap(), b"attacker");
    }

    #[test]
    fn final_cannot_be_mutated_through_a_precommit_partial_handle() {
        let (_temp, storage, inbox, _outbox) = setup(1024);
        let mut upload = storage
            .begin_upload("final", 7, Sha256::digest(b"correct").into())
            .unwrap();
        upload.write_chunk(0, b"correct").unwrap();

        // The adversary has the same directory authority needed by the task's link-replacement
        // attack and retains a writable handle before the private name is removed.
        let partial = inbox.join(".wvft-0000000000000001.part");
        let mut retained = File::options().write(true).open(partial).unwrap();
        upload.commit().unwrap();
        retained.seek(SeekFrom::Start(0)).unwrap();
        retained.write_all(b"attacker").unwrap();
        retained.sync_data().unwrap();

        assert_eq!(
            fs::read(inbox.join("final")).unwrap(),
            b"correct",
            "a COMPLETE final must not remain the writable partial inode"
        );
    }

    #[test]
    fn retained_interrupted_partials_count_against_storage_quota_after_restart() {
        let temp = tempfile::tempdir().unwrap();
        let inbox = temp.path().join("inbox");
        let outbox = temp.path().join("outbox");
        let config = Config {
            inbox,
            outbox,
            quota_bytes: 2,
        };
        {
            let storage = Storage::open(config.clone()).unwrap();
            let mut interrupted = storage
                .begin_upload("first", 2, Sha256::digest(b"ab").into())
                .unwrap();
            interrupted.write_chunk(0, b"ab").unwrap();
        }

        let reopened = Storage::open(config).unwrap();
        assert!(
            matches!(
                reopened.begin_upload("second", 1, Sha256::digest(b"x").into()),
                Err(Error::Quota)
            ),
            "retained interrupted bytes must remain charged to the configured storage quota"
        );
    }

    #[test]
    fn retained_partial_and_committed_final_stay_charged_in_process() {
        let (_temp, storage, _inbox, _outbox) = setup(4);
        let mut interrupted = storage
            .begin_upload("partial", 2, Sha256::digest(b"ab").into())
            .unwrap();
        interrupted.write_chunk(0, b"ab").unwrap();
        drop(interrupted);
        assert!(matches!(
            storage.begin_upload("over-partial", 3, Sha256::digest(b"xyz").into()),
            Err(Error::Quota)
        ));

        let mut committed = storage
            .begin_upload("final", 2, Sha256::digest(b"cd").into())
            .unwrap();
        committed.write_chunk(0, b"cd").unwrap();
        committed.commit().unwrap();
        assert!(matches!(
            storage.begin_upload("over-final", 1, Sha256::digest(b"x").into()),
            Err(Error::Quota)
        ));
    }

    #[test]
    fn restart_skips_private_epoch_collisions_and_alias_roots_are_rejected() {
        let temp = tempfile::tempdir().unwrap();
        let inbox = temp.path().join("inbox");
        let outbox = temp.path().join("outbox");
        let config = Config {
            inbox: inbox.clone(),
            outbox: outbox.clone(),
            quota_bytes: 16,
        };
        {
            let storage = Storage::open(config.clone()).unwrap();
            let upload = storage
                .begin_upload("interrupted", 1, Sha256::digest(b"x").into())
                .unwrap();
            drop(upload);
        }
        let storage = Storage::open(config).unwrap();
        let next = storage
            .begin_upload("next", 1, Sha256::digest(b"y").into())
            .unwrap();
        drop(next);
        assert!(inbox.join(".wvft-0000000000000001.part").exists());
        assert!(inbox.join(".wvft-0000000000000002.part").exists());

        let alias = temp.path().join("inbox-alias");
        std::os::unix::fs::symlink(&inbox, &alias).unwrap();
        assert!(matches!(
            Storage::open(Config {
                inbox,
                outbox: alias,
                quota_bytes: 16,
            }),
            Err(Error::BadName)
        ));
    }

    #[test]
    fn download_detects_hard_links_and_in_place_source_mutation() {
        let (_temp, storage, _inbox, outbox) = setup(1024);
        fs::write(outbox.join("mutable"), b"original").unwrap();
        let mut download = storage.open_download("mutable").unwrap();
        assert_eq!(download.total_len(), 8);
        let expected_sha: [u8; 32] = Sha256::digest(b"original").into();
        assert_eq!(download.sha256(), expected_sha);
        fs::write(outbox.join("mutable"), b"modified").unwrap();
        assert!(matches!(
            download.read_chunk(MAX_CHUNK_BYTES),
            Err(Error::SourceChanged)
        ));
    }

    #[test]
    fn every_commit_kill_point_recovers_without_an_incomplete_final() {
        for fault in [
            FaultPoint::AfterPartialSync,
            FaultPoint::AfterRecordSync,
            FaultPoint::AfterRename,
            FaultPoint::AfterDirectorySync,
            FaultPoint::AfterRecordRemoval,
        ] {
            let temp = tempfile::tempdir().unwrap();
            let inbox = temp.path().join("inbox");
            let outbox = temp.path().join("outbox");
            let config = Config {
                inbox: inbox.clone(),
                outbox,
                quota_bytes: 1024,
            };
            {
                let storage = Storage::open(config.clone()).unwrap();
                storage.set_fault(Some(fault));
                let mut upload = storage
                    .begin_upload("final", 7, Sha256::digest(b"correct").into())
                    .unwrap();
                upload.write_chunk(0, b"correct").unwrap();
                assert!(matches!(upload.commit(), Err(Error::Injected(point)) if point == fault));
            }

            if inbox.join("final").exists() {
                assert_eq!(
                    fs::read(inbox.join("final")).unwrap(),
                    b"correct",
                    "a visible final is always independently validated"
                );
            }
            let _reopened = Storage::open(config).unwrap();
            if matches!(
                fault,
                FaultPoint::AfterRename
                    | FaultPoint::AfterDirectorySync
                    | FaultPoint::AfterRecordRemoval
            ) {
                assert_eq!(fs::read(inbox.join("final")).unwrap(), b"correct");
                assert!(
                    !fs::read_dir(&inbox).unwrap().any(|entry| entry
                        .unwrap()
                        .file_name()
                        .as_bytes()
                        .ends_with(b".commit"))
                );
            } else {
                assert!(!inbox.join("final").exists());
            }
        }
    }

    #[test]
    fn corrupt_commit_fields_and_mismatched_final_are_quarantined() {
        let (_temp, storage, inbox, _outbox) = setup(1024);
        for (index, mutation) in ["magic", "name-len", "total", "hash"].iter().enumerate() {
            let record_name = format!(".wvft-{index:016x}.commit");
            let mut record = encode_record("victim", 4, Sha256::digest(b"good").into());
            match *mutation {
                "magic" => record[0] ^= 0xff,
                "name-len" => record[8..10].copy_from_slice(&u16::MAX.to_be_bytes()),
                "total" => record[10..18].copy_from_slice(&u64::MAX.to_be_bytes()),
                "hash" => record[18] ^= 0xff,
                _ => unreachable!(),
            }
            fs::write(inbox.join(record_name), record).unwrap();
        }
        fs::write(inbox.join("victim"), b"evil").unwrap();
        storage.recover().unwrap();
        assert!(!inbox.join("victim").exists());
        let names: Vec<_> = fs::read_dir(&inbox)
            .unwrap()
            .map(|entry| entry.unwrap().file_name())
            .collect();
        assert!(
            names
                .iter()
                .all(|name| !name.as_bytes().ends_with(b".commit")),
            "unprocessed recovery entries: {names:?}"
        );
        assert!(
            names
                .iter()
                .any(|name| name.as_bytes().ends_with(b".quarantine"))
        );
    }
}
