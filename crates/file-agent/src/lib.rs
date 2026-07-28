//! Bounded WVFT guest peer. The only network authority is [`connect_reserved`].

use sha2::{Digest, Sha256};
use std::io::{Read, Write};
use std::net::{SocketAddrV4, TcpStream};
use std::rc::Rc;
use std::time::Duration;
use wasm_vm_file_agent_storage::{Download, Error as StorageError, Storage, Upload};

pub const ENDPOINT: SocketAddrV4 = SocketAddrV4::new(std::net::Ipv4Addr::new(10, 0, 2, 2), 10021);
pub const VERSION: u8 = 1;
pub const HEADER_BYTES: usize = 16;
pub const MAX_FRAME_PAYLOAD: usize = 65_536;
pub const MAX_DATA_BYTES: usize = 65_528;
pub const MAX_CONTROL_PAYLOAD: usize = 4_096;
pub const MAX_IN_FLIGHT: u8 = 4;
pub const IDLE_TIMEOUT_MS: u64 = 30_000;

const HELLO: u8 = 1;
const HELLO_ACK: u8 = 2;
const OFFER: u8 = 3;
const ACCEPT: u8 = 4;
const DATA: u8 = 5;
const ACK: u8 = 6;
const COMMIT: u8 = 7;
const COMPLETE: u8 = 8;
const CANCEL: u8 = 9;
const ERROR: u8 = 10;
const HEARTBEAT: u8 = 11;
const UPLOAD: u8 = 1;
const DOWNLOAD: u8 = 2;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[repr(u16)]
pub enum ErrorCode {
    UnsupportedVersion = 1,
    BadFrame = 2,
    BadState = 3,
    BadName = 4,
    BadOffset = 5,
    TooLarge = 6,
    Busy = 7,
    Quota = 8,
    FlowControl = 9,
    HashMismatch = 10,
    SourceChanged = 11,
    Cancelled = 12,
    Timeout = 13,
    CompletionUnknown = 14,
    Io = 15,
}

#[derive(Debug, Default)]
pub struct Output {
    pub frames: Vec<Vec<u8>>,
    pub close: bool,
    pub complete: bool,
}

enum State {
    AwaitHelloAck,
    Ready,
    Receiving {
        stream: u32,
        upload: Option<Upload>,
        total: u64,
        sha: [u8; 32],
        offset: u64,
        hasher: Sha256,
        credit: u8,
    },
    AwaitAccept {
        stream: u32,
        name: String,
        source: Download,
    },
    Sending {
        stream: u32,
        source: Download,
        sent: u64,
        acked: u64,
        outstanding: Vec<u64>,
        credit: u8,
    },
    AwaitComplete {
        stream: u32,
        total: u64,
        sha: [u8; 32],
    },
    Terminal,
}

pub struct Session {
    storage: Rc<Storage>,
    rx: Vec<u8>,
    state: State,
    last_activity_ms: u64,
}

impl Session {
    pub fn service(storage: Rc<Storage>, now_ms: u64) -> (Self, Vec<u8>) {
        (
            Self {
                storage,
                rx: Vec::new(),
                state: State::AwaitHelloAck,
                last_activity_ms: now_ms,
            },
            frame(HELLO, 0, &[VERSION]),
        )
    }

    pub fn download(
        storage: Rc<Storage>,
        name: &str,
        stream: u32,
        now_ms: u64,
    ) -> Result<(Self, Vec<u8>), ErrorCode> {
        if stream == 0 {
            return Err(ErrorCode::BadState);
        }
        let source = storage.open_download(name).map_err(map_storage)?;
        Ok((
            Self {
                storage,
                rx: Vec::new(),
                state: State::AwaitAccept {
                    stream,
                    name: name.to_owned(),
                    source,
                },
                last_activity_ms: now_ms,
            },
            frame(HELLO, 0, &[VERSION]),
        ))
    }

    pub fn receive(&mut self, bytes: &[u8], now_ms: u64) -> Output {
        self.last_activity_ms = now_ms;
        let mut output = Output::default();
        let mut remaining = bytes;
        while !remaining.is_empty() {
            let room = HEADER_BYTES + MAX_FRAME_PAYLOAD - self.rx.len();
            if room == 0 {
                self.state = State::Terminal;
                self.rx.clear();
                return failure(0, ErrorCode::TooLarge);
            }
            let take = room.min(remaining.len());
            self.rx.extend_from_slice(&remaining[..take]);
            remaining = &remaining[take..];

            loop {
                let parsed = match parse(&self.rx) {
                    Parse::NeedMore => break,
                    Parse::Fatal(code) => {
                        self.state = State::Terminal;
                        self.rx.clear();
                        return failure(0, code);
                    }
                    Parse::Frame(frame, used) => {
                        self.rx.drain(..used);
                        frame
                    }
                };
                self.handle(parsed, &mut output);
                if output.close {
                    self.rx.clear();
                    return output;
                }
            }
        }
        if let State::Receiving { credit, .. } = &mut self.state {
            *credit = MAX_IN_FLIGHT;
        }
        output
    }

    pub fn poll(&mut self, now_ms: u64) -> Output {
        if !matches!(self.state, State::Ready | State::Terminal)
            && now_ms.saturating_sub(self.last_activity_ms) >= IDLE_TIMEOUT_MS
        {
            let stream = self.stream_id().unwrap_or(1);
            self.state = State::Terminal;
            self.rx.clear();
            failure(stream, ErrorCode::Timeout)
        } else {
            Output::default()
        }
    }

    fn note_io_progress(&mut self, now_ms: u64) {
        self.last_activity_ms = now_ms;
    }

    pub fn disconnect(&mut self) {
        self.state = State::Terminal;
        self.rx.clear();
    }

    pub fn buffered_bytes(&self) -> usize {
        self.rx.len()
    }

    fn stream_id(&self) -> Option<u32> {
        match self.state {
            State::Receiving { stream, .. }
            | State::AwaitAccept { stream, .. }
            | State::Sending { stream, .. }
            | State::AwaitComplete { stream, .. } => Some(stream),
            _ => None,
        }
    }

    fn handle(&mut self, incoming: Frame, output: &mut Output) {
        match &mut self.state {
            State::AwaitHelloAck => {
                if incoming.kind == HELLO_ACK
                    && incoming.stream == 0
                    && incoming.payload == [VERSION]
                {
                    self.state = State::Ready;
                } else {
                    *output = failure(incoming.stream, ErrorCode::BadState);
                }
            }
            State::Ready => {
                let Some(offer) = parse_offer(&incoming) else {
                    *output = failure(incoming.stream, ErrorCode::BadFrame);
                    return;
                };
                if offer.direction != UPLOAD {
                    *output = failure(incoming.stream, ErrorCode::BadFrame);
                    return;
                }
                match self
                    .storage
                    .begin_upload(&offer.name, offer.total, offer.sha)
                {
                    Ok(upload) => {
                        self.state = State::Receiving {
                            stream: incoming.stream,
                            upload: Some(upload),
                            total: offer.total,
                            sha: offer.sha,
                            offset: 0,
                            hasher: Sha256::new(),
                            credit: MAX_IN_FLIGHT,
                        };
                        output
                            .frames
                            .push(frame(ACCEPT, incoming.stream, &[MAX_IN_FLIGHT]));
                    }
                    Err(error) => *output = failure(incoming.stream, map_storage(error)),
                }
            }
            State::Receiving {
                stream,
                upload,
                total,
                sha,
                offset,
                hasher,
                credit,
            } => {
                if incoming.stream != *stream {
                    *output = failure(incoming.stream, ErrorCode::BadState);
                    return;
                }
                match incoming.kind {
                    DATA if incoming.payload.len() > 8 && *credit > 0 => {
                        let at = u64::from_be_bytes(incoming.payload[..8].try_into().unwrap());
                        let bytes = &incoming.payload[8..];
                        if at != *offset
                            || bytes.len() > MAX_DATA_BYTES
                            || offset
                                .checked_add(bytes.len() as u64)
                                .is_none_or(|end| end > *total)
                        {
                            *output = failure(*stream, ErrorCode::BadOffset);
                            return;
                        }
                        if let Err(error) = upload
                            .as_mut()
                            .ok_or(ErrorCode::BadState)
                            .and_then(|upload| upload.write_chunk(at, bytes).map_err(map_storage))
                        {
                            *output = failure(*stream, error);
                            return;
                        }
                        hasher.update(bytes);
                        *offset += bytes.len() as u64;
                        *credit -= 1;
                        let mut ack = offset.to_be_bytes().to_vec();
                        ack.push(MAX_IN_FLIGHT);
                        output.frames.push(frame(ACK, *stream, &ack));
                    }
                    DATA => *output = failure(*stream, ErrorCode::FlowControl),
                    COMMIT if incoming.payload.len() == 40 => {
                        let length = u64::from_be_bytes(incoming.payload[..8].try_into().unwrap());
                        let commit_sha: [u8; 32] = incoming.payload[8..].try_into().unwrap();
                        let observed: [u8; 32] = hasher.clone().finalize().into();
                        if length != *total
                            || *offset != *total
                            || commit_sha != *sha
                            || observed != *sha
                        {
                            *output = failure(*stream, ErrorCode::HashMismatch);
                            return;
                        }
                        let Some(upload) = upload.take() else {
                            *output = failure(*stream, ErrorCode::BadState);
                            return;
                        };
                        if let Err(error) = upload.commit().map_err(map_storage) {
                            *output = failure(*stream, error);
                            return;
                        }
                        output
                            .frames
                            .push(frame(COMPLETE, *stream, &incoming.payload));
                        output.complete = true;
                        self.state = State::Ready;
                    }
                    CANCEL if incoming.payload.len() == 2 => {
                        upload.take();
                        output
                            .frames
                            .push(error_frame(*stream, ErrorCode::Cancelled));
                        self.state = State::Ready;
                    }
                    _ => *output = failure(*stream, ErrorCode::BadState),
                }
            }
            State::AwaitAccept {
                stream,
                name,
                source,
            } => {
                if incoming.kind == HELLO_ACK
                    && incoming.stream == 0
                    && incoming.payload == [VERSION]
                {
                    let mut payload = Vec::with_capacity(44 + name.len());
                    payload.push(DOWNLOAD);
                    payload.push(0);
                    payload.extend_from_slice(&(name.len() as u16).to_be_bytes());
                    payload.extend_from_slice(&source.total_len().to_be_bytes());
                    payload.extend_from_slice(&source.sha256());
                    payload.extend_from_slice(name.as_bytes());
                    output.frames.push(frame(OFFER, *stream, &payload));
                } else if incoming.kind == ACCEPT
                    && incoming.stream == *stream
                    && incoming.payload.len() == 1
                    && (1..=MAX_IN_FLIGHT).contains(&incoming.payload[0])
                {
                    let State::AwaitAccept { stream, source, .. } =
                        std::mem::replace(&mut self.state, State::Terminal)
                    else {
                        unreachable!()
                    };
                    self.state = State::Sending {
                        stream,
                        source,
                        sent: 0,
                        acked: 0,
                        outstanding: Vec::new(),
                        credit: incoming.payload[0],
                    };
                    self.pump(output);
                } else {
                    *output = failure(incoming.stream, ErrorCode::BadState);
                }
            }
            State::Sending {
                stream,
                sent,
                acked,
                outstanding,
                credit,
                ..
            } => {
                if incoming.kind == CANCEL
                    && incoming.stream == *stream
                    && incoming.payload.len() == 2
                {
                    output
                        .frames
                        .push(error_frame(*stream, ErrorCode::Cancelled));
                    self.state = State::Terminal;
                } else if incoming.kind == ACK
                    && incoming.stream == *stream
                    && incoming.payload.len() == 9
                {
                    let next = u64::from_be_bytes(incoming.payload[..8].try_into().unwrap());
                    let next_credit = incoming.payload[8];
                    if next < *acked || next > *sent || next_credit > MAX_IN_FLIGHT {
                        *output = failure(*stream, ErrorCode::FlowControl);
                        return;
                    }
                    *acked = next;
                    outstanding.retain(|end| *end > next);
                    *credit = next_credit;
                    self.pump(output);
                } else {
                    *output = failure(incoming.stream, ErrorCode::BadState);
                }
            }
            State::AwaitComplete { stream, total, sha } => {
                let mut expected = total.to_be_bytes().to_vec();
                expected.extend_from_slice(sha);
                if incoming.kind == COMPLETE
                    && incoming.stream == *stream
                    && incoming.payload == expected
                {
                    output.complete = true;
                    self.state = State::Terminal;
                } else {
                    *output = failure(incoming.stream, ErrorCode::CompletionUnknown);
                }
            }
            State::Terminal => output.close = true,
        }
        if output.close {
            self.state = State::Terminal;
            self.rx.clear();
        }
    }

    fn pump(&mut self, output: &mut Output) {
        let State::Sending {
            stream,
            source,
            sent,
            acked: _,
            outstanding,
            credit,
        } = &mut self.state
        else {
            return;
        };
        while outstanding.len() < *credit as usize && outstanding.len() < MAX_IN_FLIGHT as usize {
            let bytes = match source.read_chunk(MAX_DATA_BYTES) {
                Ok(bytes) => bytes,
                Err(error) => {
                    *output = failure(*stream, map_storage(error));
                    return;
                }
            };
            if bytes.is_empty() {
                if *sent != source.total_len() {
                    *output = failure(*stream, ErrorCode::SourceChanged);
                    return;
                }
                if outstanding.is_empty() {
                    let total = source.total_len();
                    let sha = source.sha256();
                    let mut payload = total.to_be_bytes().to_vec();
                    payload.extend_from_slice(&sha);
                    output.frames.push(frame(COMMIT, *stream, &payload));
                    self.state = State::AwaitComplete {
                        stream: *stream,
                        total,
                        sha,
                    };
                }
                return;
            }
            let mut payload = sent.to_be_bytes().to_vec();
            payload.extend_from_slice(&bytes);
            *sent += bytes.len() as u64;
            outstanding.push(*sent);
            output.frames.push(frame(DATA, *stream, &payload));
        }
    }
}

fn failure(stream: u32, code: ErrorCode) -> Output {
    Output {
        frames: vec![error_frame(stream.max(1), code)],
        close: true,
        complete: false,
    }
}

pub fn connect_reserved() -> std::io::Result<TcpStream> {
    let stream = TcpStream::connect_timeout(&ENDPOINT.into(), Duration::from_secs(5))?;
    stream.set_read_timeout(Some(Duration::from_secs(1)))?;
    stream.set_write_timeout(Some(Duration::from_secs(5)))?;
    Ok(stream)
}

pub fn drive_stream(
    stream: &mut TcpStream,
    session: &mut Session,
    initial: &[u8],
) -> Result<(), ErrorCode> {
    drive_io(stream, session, initial)
}

fn drive_io<S: Read + Write>(
    stream: &mut S,
    session: &mut Session,
    initial: &[u8],
) -> Result<(), ErrorCode> {
    stream.write_all(initial).map_err(|_| ErrorCode::Io)?;
    session.note_io_progress(monotonic_ms());
    let mut buffer = [0u8; MAX_FRAME_PAYLOAD + HEADER_BYTES];
    loop {
        let count = match stream.read(&mut buffer) {
            Ok(0) => return Err(ErrorCode::CompletionUnknown),
            Ok(count) => count,
            Err(error) if error.kind() == std::io::ErrorKind::TimedOut => {
                let out = session.poll(monotonic_ms());
                for frame in out.frames {
                    stream.write_all(&frame).map_err(|_| ErrorCode::Io)?;
                }
                if out.close {
                    return Err(ErrorCode::Timeout);
                }
                continue;
            }
            Err(_) => return Err(ErrorCode::Io),
        };
        let out = session.receive(&buffer[..count], monotonic_ms());
        for frame in out.frames {
            stream.write_all(&frame).map_err(|_| ErrorCode::Io)?;
        }
        // Receiving a frame can synchronously extend or sync the guest ext4 file. Account from
        // completed protocol I/O, not from before that storage work, or a legitimate slow write
        // can make the next read poll falsely expire the session.
        session.note_io_progress(monotonic_ms());
        if out.complete {
            return Ok(());
        }
        if out.close {
            return Err(ErrorCode::BadState);
        }
    }
}

pub fn monotonic_ms() -> u64 {
    use std::sync::OnceLock;
    use std::time::Instant;
    static START: OnceLock<Instant> = OnceLock::new();
    START.get_or_init(Instant::now).elapsed().as_millis() as u64
}

struct Frame {
    kind: u8,
    stream: u32,
    payload: Vec<u8>,
}

struct Offer {
    direction: u8,
    name: String,
    total: u64,
    sha: [u8; 32],
}

enum Parse {
    NeedMore,
    Fatal(ErrorCode),
    Frame(Frame, usize),
}

fn parse(bytes: &[u8]) -> Parse {
    if bytes.len() < HEADER_BYTES {
        return Parse::NeedMore;
    }
    if &bytes[..4] != b"WVFT" || bytes[4] != VERSION || bytes[6..8] != [0, 0] {
        return Parse::Fatal(ErrorCode::BadFrame);
    }
    let kind = bytes[5];
    if !(HELLO..=HEARTBEAT).contains(&kind) {
        return Parse::Fatal(ErrorCode::BadFrame);
    }
    let stream = u32::from_be_bytes(bytes[8..12].try_into().unwrap());
    if (matches!(kind, HELLO | HELLO_ACK | HEARTBEAT) && stream != 0)
        || (!matches!(kind, HELLO | HELLO_ACK | HEARTBEAT) && stream == 0)
    {
        return Parse::Fatal(ErrorCode::BadFrame);
    }
    let length = u32::from_be_bytes(bytes[12..16].try_into().unwrap()) as usize;
    if length > MAX_FRAME_PAYLOAD || (kind != DATA && length > MAX_CONTROL_PAYLOAD) {
        return Parse::Fatal(ErrorCode::TooLarge);
    }
    if bytes.len() < HEADER_BYTES + length {
        return Parse::NeedMore;
    }
    Parse::Frame(
        Frame {
            kind,
            stream,
            payload: bytes[HEADER_BYTES..HEADER_BYTES + length].to_vec(),
        },
        HEADER_BYTES + length,
    )
}

fn parse_offer(frame: &Frame) -> Option<Offer> {
    if frame.kind != OFFER || frame.stream == 0 || !(45..=299).contains(&frame.payload.len()) {
        return None;
    }
    if frame.payload[1] != 0 {
        return None;
    }
    let name_len = u16::from_be_bytes(frame.payload[2..4].try_into().ok()?) as usize;
    if frame.payload.len() != 44 + name_len {
        return None;
    }
    Some(Offer {
        direction: frame.payload[0],
        total: u64::from_be_bytes(frame.payload[4..12].try_into().ok()?),
        sha: frame.payload[12..44].try_into().ok()?,
        name: std::str::from_utf8(&frame.payload[44..]).ok()?.to_owned(),
    })
}

pub fn frame(kind: u8, stream: u32, payload: &[u8]) -> Vec<u8> {
    let mut bytes = Vec::with_capacity(HEADER_BYTES + payload.len());
    bytes.extend_from_slice(b"WVFT");
    bytes.push(VERSION);
    bytes.push(kind);
    bytes.extend_from_slice(&0u16.to_be_bytes());
    bytes.extend_from_slice(&stream.to_be_bytes());
    bytes.extend_from_slice(&(payload.len() as u32).to_be_bytes());
    bytes.extend_from_slice(payload);
    bytes
}

pub fn heartbeat_frame() -> Vec<u8> {
    frame(HEARTBEAT, 0, &[])
}

fn error_frame(stream: u32, code: ErrorCode) -> Vec<u8> {
    let mut payload = (code as u16).to_be_bytes().to_vec();
    payload.extend_from_slice(&0u16.to_be_bytes());
    frame(ERROR, stream, &payload)
}

fn map_storage(error: StorageError) -> ErrorCode {
    match error {
        StorageError::BadName => ErrorCode::BadName,
        StorageError::BadOffset => ErrorCode::BadOffset,
        StorageError::TooLarge => ErrorCode::TooLarge,
        StorageError::Busy => ErrorCode::Busy,
        StorageError::Quota => ErrorCode::Quota,
        StorageError::Timeout => ErrorCode::Timeout,
        StorageError::HashMismatch => ErrorCode::HashMismatch,
        StorageError::SourceChanged => ErrorCode::SourceChanged,
        StorageError::Exists => ErrorCode::BadName,
        StorageError::Io(_) | StorageError::Injected(_) => ErrorCode::Io,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::path::PathBuf;
    use tempfile::TempDir;
    use wasm_vm_file_agent_storage::Config;

    fn setup(quota: u64) -> (TempDir, Rc<Storage>, PathBuf, PathBuf) {
        let temp = tempfile::tempdir().unwrap();
        let inbox = temp.path().join("inbox");
        let outbox = temp.path().join("outbox");
        let storage = Rc::new(
            Storage::open(Config {
                inbox: inbox.clone(),
                outbox: outbox.clone(),
                quota_bytes: quota,
            })
            .unwrap(),
        );
        (temp, storage, inbox, outbox)
    }

    fn negotiate(session: &mut Session) {
        let out = session.receive(&frame(HELLO_ACK, 0, &[VERSION]), 1);
        assert!(!out.close);
    }

    fn offer(direction: u8, stream: u32, name: &str, bytes: &[u8]) -> Vec<u8> {
        let mut payload = vec![direction, 0];
        payload.extend_from_slice(&(name.len() as u16).to_be_bytes());
        payload.extend_from_slice(&(bytes.len() as u64).to_be_bytes());
        payload.extend_from_slice(&<[u8; 32]>::from(Sha256::digest(bytes)));
        payload.extend_from_slice(name.as_bytes());
        frame(OFFER, stream, &payload)
    }

    fn kind(bytes: &[u8]) -> u8 {
        bytes[5]
    }

    #[test]
    fn fragmented_upload_round_trip_is_hash_validated_and_durable() {
        let (_temp, storage, inbox, _outbox) = setup(1024);
        let (mut session, hello) = Session::service(storage, 0);
        assert_eq!(kind(&hello), HELLO);
        negotiate(&mut session);

        let bytes = b"bounded upload";
        let offered = offer(UPLOAD, 7, "hello.txt", bytes);
        let split = offered.len() / 2;
        assert!(session.receive(&offered[..split], 2).frames.is_empty());
        let accepted = session.receive(&offered[split..], 3);
        assert_eq!(kind(&accepted.frames[0]), ACCEPT);

        let mut data = 0u64.to_be_bytes().to_vec();
        data.extend_from_slice(bytes);
        let ack = session.receive(&frame(DATA, 7, &data), 4);
        assert_eq!(kind(&ack.frames[0]), ACK);
        let mut commit = (bytes.len() as u64).to_be_bytes().to_vec();
        commit.extend_from_slice(&<[u8; 32]>::from(Sha256::digest(bytes)));
        let complete = session.receive(&frame(COMMIT, 7, &commit), 5);
        assert!(complete.complete);
        assert_eq!(kind(&complete.frames[0]), COMPLETE);
        assert_eq!(fs::read(inbox.join("hello.txt")).unwrap(), bytes);
    }

    #[test]
    fn valid_coalesced_frames_survive_a_full_transport_read_after_fragmentation() {
        let (_temp, storage, _inbox, _outbox) = setup((MAX_DATA_BYTES * 2) as u64);
        let (mut session, _) = Session::service(storage, 0);
        negotiate(&mut session);

        let bytes = vec![0x5a; MAX_DATA_BYTES * 2];
        let accepted = session.receive(&offer(UPLOAD, 7, "coalesced.bin", &bytes), 2);
        assert_eq!(kind(&accepted.frames[0]), ACCEPT);

        let mut first_payload = 0u64.to_be_bytes().to_vec();
        first_payload.extend_from_slice(&bytes[..MAX_DATA_BYTES]);
        let first = frame(DATA, 7, &first_payload);
        let mut second_payload = (MAX_DATA_BYTES as u64).to_be_bytes().to_vec();
        second_payload.extend_from_slice(&bytes[MAX_DATA_BYTES..]);
        let second = frame(DATA, 7, &second_payload);

        // This is a valid byte-stream split a real drive_io read can produce: a short read
        // leaves a frame prefix buffered, then the next maximum-sized read contains the rest
        // of that frame and a prefix of the following frame.
        assert!(session.receive(&first[..100], 3).frames.is_empty());
        let mut full_read = first[100..].to_vec();
        full_read.extend_from_slice(&second[..100]);
        assert_eq!(full_read.len(), HEADER_BYTES + MAX_FRAME_PAYLOAD);
        let out = session.receive(&full_read, 4);
        assert!(!out.close, "valid coalesced frames must not be rejected");
        assert_eq!(kind(&out.frames[0]), ACK);
        assert_eq!(session.buffered_bytes(), 100);
    }

    #[test]
    fn maximum_frames_are_transport_shape_invariant_and_residual_stays_bounded() {
        let (_temp, storage, inbox, _outbox) = setup((MAX_DATA_BYTES * 4) as u64);
        let bytes = vec![0xa5; MAX_DATA_BYTES * 2];
        let mut wire = Vec::new();
        for (offset, chunk) in bytes.chunks(MAX_DATA_BYTES).enumerate() {
            let mut payload = ((offset * MAX_DATA_BYTES) as u64).to_be_bytes().to_vec();
            payload.extend_from_slice(chunk);
            wire.extend_from_slice(&frame(DATA, 7, &payload));
        }

        let (mut coalesced, _) = Session::service(storage.clone(), 0);
        negotiate(&mut coalesced);
        let accepted = coalesced.receive(&offer(UPLOAD, 7, "coalesced-all.bin", &bytes), 2);
        assert_eq!(kind(&accepted.frames[0]), ACCEPT);
        let out = coalesced.receive(&wire, 3);
        assert!(!out.close);
        assert_eq!(out.frames.len(), 2);
        assert!(out.frames.iter().all(|frame| kind(frame) == ACK));
        assert_eq!(coalesced.buffered_bytes(), 0);
        let mut commit = (bytes.len() as u64).to_be_bytes().to_vec();
        commit.extend_from_slice(&<[u8; 32]>::from(Sha256::digest(&bytes)));
        assert!(coalesced.receive(&frame(COMMIT, 7, &commit), 4).complete);
        assert_eq!(fs::read(inbox.join("coalesced-all.bin")).unwrap(), bytes);

        let (mut fragmented, _) = Session::service(storage, 10);
        negotiate(&mut fragmented);
        let accepted = fragmented.receive(&offer(UPLOAD, 7, "fragmented-all.bin", &bytes), 12);
        assert_eq!(kind(&accepted.frames[0]), ACCEPT);
        let chunk_sizes = [1, 7, 257, 4_096];
        let mut cursor = 0;
        let mut turn = 0;
        while cursor < wire.len() {
            let end = (cursor + chunk_sizes[turn % chunk_sizes.len()]).min(wire.len());
            let out = fragmented.receive(&wire[cursor..end], 13 + turn as u64);
            assert!(!out.close);
            assert!(fragmented.buffered_bytes() <= HEADER_BYTES + MAX_FRAME_PAYLOAD);
            cursor = end;
            turn += 1;
        }
        assert_eq!(fragmented.buffered_bytes(), 0);
        assert!(
            fragmented
                .receive(&frame(COMMIT, 7, &commit), 20_000)
                .complete
        );
        assert_eq!(fs::read(inbox.join("fragmented-all.bin")).unwrap(), bytes);
    }

    #[test]
    fn download_streams_under_credit_and_waits_for_complete() {
        let (_temp, storage, _inbox, outbox) = setup(1024);
        let bytes = vec![0x5a; MAX_DATA_BYTES + 9];
        fs::write(outbox.join("result.bin"), &bytes).unwrap();
        let (mut session, hello) = Session::download(storage, "result.bin", 9, 0).unwrap();
        assert_eq!(kind(&hello), HELLO);
        let offered = session.receive(&frame(HELLO_ACK, 0, &[VERSION]), 1);
        assert_eq!(kind(&offered.frames[0]), OFFER);
        let first = session.receive(&frame(ACCEPT, 9, &[1]), 2);
        assert_eq!(first.frames.len(), 1);
        assert_eq!(kind(&first.frames[0]), DATA);

        let first_end = u64::from_be_bytes(first.frames[0][16..24].try_into().unwrap())
            + (first.frames[0].len() - 24) as u64;
        let mut ack = first_end.to_be_bytes().to_vec();
        ack.push(1);
        let second = session.receive(&frame(ACK, 9, &ack), 3);
        assert_eq!(kind(&second.frames[0]), DATA);
        let second_end = u64::from_be_bytes(second.frames[0][16..24].try_into().unwrap())
            + (second.frames[0].len() - 24) as u64;
        let mut ack = second_end.to_be_bytes().to_vec();
        ack.push(1);
        let commit = session.receive(&frame(ACK, 9, &ack), 4);
        assert_eq!(kind(&commit.frames[0]), COMMIT);
        assert!(!commit.complete);
        let done = session.receive(&frame(COMPLETE, 9, &commit.frames[0][16..]), 5);
        assert!(done.complete);
    }

    #[test]
    fn cancellation_timeout_disconnect_and_malformed_envelope_are_terminal() {
        let (_temp, storage, inbox, _outbox) = setup(1024);
        let (mut cancelled, _) = Session::service(storage.clone(), 0);
        negotiate(&mut cancelled);
        cancelled.receive(&offer(UPLOAD, 1, "cancelled", b"abc"), 2);
        let out = cancelled.receive(&frame(CANCEL, 1, &0u16.to_be_bytes()), 3);
        assert_eq!(kind(&out.frames[0]), ERROR);
        assert!(!inbox.join("cancelled").exists());

        let (mut timed, _) = Session::service(storage.clone(), 10);
        negotiate(&mut timed);
        timed.receive(&offer(UPLOAD, 2, "timed", b"x"), 11);
        let out = timed.poll(11 + IDLE_TIMEOUT_MS);
        assert!(out.close);
        assert_eq!(kind(&out.frames[0]), ERROR);

        let (mut disconnected, _) = Session::service(storage.clone(), 0);
        negotiate(&mut disconnected);
        disconnected.receive(&offer(UPLOAD, 3, "gone", b"x"), 1);
        disconnected.disconnect();
        assert!(!inbox.join("gone").exists());

        let (mut malformed, _) = Session::service(storage, 0);
        let mut hostile = frame(HELLO_ACK, 0, &[VERSION]);
        hostile[12..16].copy_from_slice(&u32::MAX.to_be_bytes());
        let out = malformed.receive(&hostile, 1);
        assert!(out.close);
        assert_eq!(kind(&out.frames[0]), ERROR);
        assert_eq!(malformed.buffered_bytes(), 0);
    }

    #[test]
    fn completed_io_progress_restarts_the_idle_window() {
        let (_temp, storage, _inbox, _outbox) = setup(1024);
        let (mut session, _) = Session::service(storage, 0);
        negotiate(&mut session);
        session.receive(&offer(UPLOAD, 4, "slow-write", b"x"), 11);

        // Model a frame whose synchronous storage work completed one full watchdog window after
        // it arrived. `drive_io` records this completion time before its next blocking read.
        session.note_io_progress(11 + IDLE_TIMEOUT_MS);
        assert!(!session.poll(11 + IDLE_TIMEOUT_MS).close);
        assert!(session.poll(11 + IDLE_TIMEOUT_MS.saturating_mul(2)).close);
    }

    #[test]
    fn heartbeat_is_an_empty_connection_level_control_frame() {
        let bytes = heartbeat_frame();
        match parse(&bytes) {
            Parse::Frame(frame, used) => {
                assert_eq!(used, HEADER_BYTES);
                assert_eq!(frame.kind, HEARTBEAT);
                assert_eq!(frame.stream, 0);
                assert!(frame.payload.is_empty());
            }
            _ => panic!("heartbeat must parse as one complete frame"),
        }
    }

    #[test]
    fn shared_storage_accepts_two_transfers_and_rejects_third() {
        let (_temp, storage, _inbox, _outbox) = setup(16);
        let mut sessions = Vec::new();
        for stream in 1..=3 {
            let (mut session, _) = Session::service(storage.clone(), 0);
            negotiate(&mut session);
            let out = session.receive(&offer(UPLOAD, stream, &format!("file-{stream}"), b"x"), 2);
            sessions.push((session, out));
        }
        assert_eq!(kind(&sessions[0].1.frames[0]), ACCEPT);
        assert_eq!(kind(&sessions[1].1.frames[0]), ACCEPT);
        assert!(sessions[2].1.close);
        assert_eq!(kind(&sessions[2].1.frames[0]), ERROR);
    }

    #[test]
    fn vm_download_rejects_every_path_shaped_name() {
        let (_temp, storage, _inbox, outbox) = setup(1024);
        fs::write(outbox.join("allowed"), b"x").unwrap();
        assert!(Session::download(storage.clone(), "allowed", 1, 0).is_ok());
        for name in ["../allowed", "/etc/passwd", "a/b", r"a\b", ".", ".."] {
            assert!(matches!(
                Session::download(storage.clone(), name, 1, 0),
                Err(ErrorCode::BadName)
            ));
        }
    }

    #[cfg(unix)]
    #[test]
    fn native_socket_eof_never_reports_false_completion() {
        use std::os::unix::net::UnixStream;
        let (_temp, storage, _inbox, _outbox) = setup(1024);
        let (mut agent, mut peer) = UnixStream::pair().unwrap();
        let (mut session, hello) = Session::service(storage, 0);
        let hello_len = hello.len();
        let peer = std::thread::spawn(move || {
            let mut received = vec![0; hello_len];
            peer.read_exact(&mut received).unwrap();
        });
        assert_eq!(
            drive_io(&mut agent, &mut session, &hello),
            Err(ErrorCode::CompletionUnknown)
        );
        peer.join().unwrap();
    }
}
