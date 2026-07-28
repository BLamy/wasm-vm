//! WVFT v1: bounded host/guest file-transfer framing and state.
//!
//! This module deliberately knows nothing about sockets, URLs, host paths, or commands. Callers
//! feed bytes from the synthetic slirp listener and receive framed response bytes. File contents
//! cross [`TransferSource`] / [`TransferSink`] one bounded chunk at a time.

use std::collections::{BTreeMap, BTreeSet, VecDeque};

use sha2::{Digest, Sha256};
use unicode_normalization::UnicodeNormalization;

pub const PORT: u16 = 10021;
pub const VERSION: u8 = 1;
pub const HEADER_BYTES: usize = 16;
pub const MAX_FRAME_PAYLOAD: usize = 65_536;
pub const MAX_DATA_BYTES: usize = 65_528;
pub const MAX_TRANSFER_BYTES: u64 = 1_073_741_824;
pub const MAX_NAME_BYTES: usize = 255;
pub const MAX_CONCURRENT_TRANSFERS: usize = 2;
pub const MAX_IN_FLIGHT_DATA_FRAMES: usize = 4;
pub const MAX_CONTROL_PAYLOAD: usize = 4_096;
// Match the guest agent: browser-interpreted ext4 allocation/fsync can delay an ACK beyond 30
// seconds during a large real transfer. Forty-five seconds remains a bounded abandonment window.
pub const IDLE_TIMEOUT_MS: u64 = 45_000;
pub const MAX_OWNED_BYTES: usize =
    MAX_CONCURRENT_TRANSFERS * MAX_IN_FLIGHT_DATA_FRAMES * MAX_FRAME_PAYLOAD
        + MAX_CONCURRENT_TRANSFERS * (HEADER_BYTES + MAX_FRAME_PAYLOAD);

const MAGIC: &[u8; 4] = b"WVFT";
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
const UPLOAD: u8 = 1;
const DOWNLOAD: u8 = 2;

pub type ConnectionId = u64;

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

pub trait TransferSink {
    fn write(&mut self, offset: u64, bytes: &[u8]) -> Result<(), ErrorCode>;
    fn commit(&mut self, total_len: u64, sha256: [u8; 32]) -> Result<CommitDisposition, ErrorCode>;
    fn cancel(&mut self);
    fn buffered_bytes(&self) -> usize {
        0
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum CommitDisposition {
    Durable,
    Pending,
}

pub trait TransferStore {
    fn open_sink(
        &mut self,
        connection_id: ConnectionId,
        stream_id: u32,
        name: &str,
        total_len: u64,
        sha256: [u8; 32],
    ) -> Result<Box<dyn TransferSink>, ErrorCode>;
}

pub trait TransferSource {
    fn name(&self) -> &str;
    fn total_len(&self) -> u64;
    fn sha256(&self) -> [u8; 32];
    /// Return the next sequential chunk. Implementations must return at most `max` bytes.
    fn read(&mut self, max: usize) -> Result<Vec<u8>, ErrorCode>;
    fn cancel(&mut self) {}
    fn buffered_bytes(&self) -> usize {
        0
    }
}

struct RejectingStore;

impl TransferStore for RejectingStore {
    fn open_sink(
        &mut self,
        _connection_id: ConnectionId,
        _stream_id: u32,
        _name: &str,
        _total_len: u64,
        _sha256: [u8; 32],
    ) -> Result<Box<dyn TransferSink>, ErrorCode> {
        Err(ErrorCode::Busy)
    }
}

#[derive(Debug, Default)]
pub struct ServiceOutput {
    pub frames: Vec<Vec<u8>>,
    pub close: bool,
}

struct Receiving {
    stream_id: u32,
    total_len: u64,
    expected_sha: [u8; 32],
    received: u64,
    receive_credit: u8,
    hasher: Sha256,
    sink: Box<dyn TransferSink>,
}

struct Sending {
    stream_id: u32,
    source: Box<dyn TransferSource>,
    total_len: u64,
    expected_sha: [u8; 32],
    sent: u64,
    acked: u64,
    credit: u8,
    outstanding_ends: VecDeque<u64>,
}

enum State {
    AwaitHello,
    Ready,
    Receiving(Receiving),
    AwaitAccept {
        stream_id: u32,
        source: Box<dyn TransferSource>,
        total_len: u64,
        expected_sha: [u8; 32],
    },
    Sending(Sending),
    AwaitComplete {
        stream_id: u32,
        total_len: u64,
        sha256: [u8; 32],
    },
    AwaitDurable {
        stream_id: u32,
        total_len: u64,
        sha256: [u8; 32],
        sink: Box<dyn TransferSink>,
    },
    Terminal,
}

struct Connection {
    rx: Vec<u8>,
    state: State,
    used_streams: BTreeSet<u32>,
    last_activity_ms: u64,
}

impl Connection {
    fn new(now_ms: u64) -> Self {
        Self {
            rx: Vec::new(),
            state: State::AwaitHello,
            used_streams: BTreeSet::new(),
            last_activity_ms: now_ms,
        }
    }

    fn active(&self) -> bool {
        matches!(
            self.state,
            State::Receiving(_)
                | State::AwaitAccept { .. }
                | State::Sending(_)
                | State::AwaitComplete { .. }
                | State::AwaitDurable { .. }
        )
    }

    fn active_stream_id(&self) -> Option<u32> {
        match &self.state {
            State::Receiving(receive) => Some(receive.stream_id),
            State::AwaitAccept { stream_id, .. }
            | State::AwaitComplete { stream_id, .. }
            | State::AwaitDurable { stream_id, .. } => Some(*stream_id),
            State::Sending(send) => Some(send.stream_id),
            _ => None,
        }
    }

    fn buffered_bytes(&self) -> usize {
        let state = match &self.state {
            State::Receiving(receive) => receive.sink.buffered_bytes(),
            State::AwaitAccept { source, .. } => source.buffered_bytes(),
            State::Sending(send) => send.source.buffered_bytes(),
            State::AwaitDurable { sink, .. } => sink.buffered_bytes(),
            _ => 0,
        };
        self.rx.len().saturating_add(state)
    }

    fn cancel(&mut self) {
        match &mut self.state {
            State::Receiving(receive) => receive.sink.cancel(),
            State::AwaitAccept { source, .. } => source.cancel(),
            State::Sending(send) => send.source.cancel(),
            State::AwaitDurable { sink, .. } => sink.cancel(),
            _ => {}
        }
        self.state = State::Terminal;
        self.rx.clear();
    }
}

pub struct FileTransferService {
    store: Box<dyn TransferStore>,
    connections: BTreeMap<ConnectionId, Connection>,
    next_connection: ConnectionId,
}

impl Default for FileTransferService {
    fn default() -> Self {
        Self::new(Box::new(RejectingStore))
    }
}

impl FileTransferService {
    pub fn new(store: Box<dyn TransferStore>) -> Self {
        Self {
            store,
            connections: BTreeMap::new(),
            next_connection: 1,
        }
    }

    pub fn connect(&mut self, now_ms: u64) -> ConnectionId {
        let id = self.next_connection;
        self.next_connection = self.next_connection.wrapping_add(1).max(1);
        self.connections.insert(id, Connection::new(now_ms));
        id
    }

    pub fn disconnect(&mut self, id: ConnectionId) {
        if let Some(mut connection) = self.connections.remove(&id) {
            connection.cancel();
        }
    }

    pub fn active_transfers(&self) -> usize {
        self.connections
            .values()
            .filter(|connection| connection.active())
            .count()
    }

    pub fn connection_ready(&self, id: ConnectionId) -> bool {
        self.connections
            .get(&id)
            .is_some_and(|connection| matches!(connection.state, State::Ready))
    }

    pub fn connection_terminal(&self, id: ConnectionId) -> bool {
        self.connections
            .get(&id)
            .is_some_and(|connection| matches!(connection.state, State::Terminal))
    }

    pub fn buffered_bytes(&self) -> usize {
        self.connections
            .values()
            .map(Connection::buffered_bytes)
            .sum()
    }

    /// Queue a host-to-guest upload after HELLO negotiation. The returned OFFER is the only way the
    /// source name/length/hash enter the wire protocol; no destination or host path field exists.
    pub fn queue_upload(
        &mut self,
        id: ConnectionId,
        stream_id: u32,
        source: Box<dyn TransferSource>,
        now_ms: u64,
    ) -> Result<Vec<Vec<u8>>, ErrorCode> {
        if stream_id == 0 || self.active_transfers() >= MAX_CONCURRENT_TRANSFERS {
            return Err(ErrorCode::Busy);
        }
        let name = normalize_name(source.name())?;
        let total_len = source.total_len();
        if total_len > MAX_TRANSFER_BYTES {
            return Err(ErrorCode::TooLarge);
        }
        let sha = source.sha256();
        let connection = self.connections.get_mut(&id).ok_or(ErrorCode::BadState)?;
        if !matches!(connection.state, State::Ready) {
            return Err(ErrorCode::BadState);
        }
        if !connection.used_streams.insert(stream_id) {
            return Err(ErrorCode::BadState);
        }
        connection.last_activity_ms = now_ms;
        connection.state = State::AwaitAccept {
            stream_id,
            source,
            total_len,
            expected_sha: sha,
        };
        Ok(vec![offer_frame(stream_id, UPLOAD, &name, total_len, sha)])
    }

    /// Cancel one active transfer from the host side without tearing down the permanent agent
    /// connection. The peer receives the same bounded CANCEL frame it would have sent itself, and
    /// the source/sink is notified before the connection returns to `Ready`.
    pub fn cancel(&mut self, id: ConnectionId, stream_id: u32, now_ms: u64) -> ServiceOutput {
        let Some(connection) = self.connections.get_mut(&id) else {
            return ServiceOutput {
                frames: vec![error_frame(stream_id, ErrorCode::BadState)],
                close: true,
            };
        };
        if connection.active_stream_id() != Some(stream_id) {
            return ServiceOutput {
                frames: vec![error_frame(stream_id, ErrorCode::BadState)],
                close: false,
            };
        }
        connection.last_activity_ms = now_ms;
        match &mut connection.state {
            State::Receiving(receive) => receive.sink.cancel(),
            State::AwaitAccept { source, .. } => source.cancel(),
            State::Sending(send) => send.source.cancel(),
            State::AwaitDurable { sink, .. } => sink.cancel(),
            State::AwaitComplete { .. } => {}
            _ => unreachable!("active stream checked above"),
        }
        connection.state = State::Ready;
        ServiceOutput {
            frames: vec![frame_bytes(CANCEL, stream_id, &0u16.to_be_bytes())],
            close: false,
        }
    }

    /// Finish a guest-to-host transfer only after an asynchronous host sink has durably closed.
    /// Until this call, the connection remains active and the peer cannot observe COMPLETE.
    pub fn finish_pending_download(
        &mut self,
        id: ConnectionId,
        stream_id: u32,
        result: Result<(), ErrorCode>,
        now_ms: u64,
    ) -> ServiceOutput {
        let Some(connection) = self.connections.get_mut(&id) else {
            return ServiceOutput {
                frames: vec![error_frame(stream_id, ErrorCode::BadState)],
                close: true,
            };
        };
        let State::AwaitDurable {
            stream_id: pending_stream,
            total_len,
            sha256,
            ..
        } = &connection.state
        else {
            return ServiceOutput {
                frames: vec![error_frame(stream_id, ErrorCode::BadState)],
                close: false,
            };
        };
        if *pending_stream != stream_id {
            return ServiceOutput {
                frames: vec![error_frame(stream_id, ErrorCode::BadState)],
                close: false,
            };
        }
        let total_len = *total_len;
        let sha256 = *sha256;
        connection.last_activity_ms = now_ms;
        match result {
            Ok(()) => {
                let mut payload = total_len.to_be_bytes().to_vec();
                payload.extend_from_slice(&sha256);
                connection.state = State::Ready;
                ServiceOutput {
                    frames: vec![frame_bytes(COMPLETE, stream_id, &payload)],
                    close: false,
                }
            }
            Err(code) => {
                if let State::AwaitDurable { sink, .. } = &mut connection.state {
                    sink.cancel();
                }
                connection.state = State::Terminal;
                ServiceOutput {
                    frames: vec![error_frame(stream_id, code)],
                    close: true,
                }
            }
        }
    }

    pub fn receive(&mut self, id: ConnectionId, bytes: &[u8], now_ms: u64) -> ServiceOutput {
        let Some(mut connection) = self.connections.remove(&id) else {
            return ServiceOutput {
                frames: vec![error_frame(0, ErrorCode::BadState)],
                close: true,
            };
        };
        connection.last_activity_ms = now_ms;
        if connection.rx.len().saturating_add(bytes.len()) > HEADER_BYTES + MAX_FRAME_PAYLOAD {
            connection.cancel();
            self.connections.insert(id, connection);
            return ServiceOutput {
                frames: vec![error_frame(0, ErrorCode::TooLarge)],
                close: true,
            };
        }
        connection.rx.extend_from_slice(bytes);
        let mut out = ServiceOutput::default();
        loop {
            let parsed = match parse_one(&connection.rx) {
                Parse::NeedMore => break,
                Parse::Fatal(code) => {
                    connection.cancel();
                    out.frames.push(error_frame(0, code));
                    out.close = true;
                    break;
                }
                Parse::Frame(frame, consumed) => {
                    connection.rx.drain(..consumed);
                    frame
                }
            };
            self.process_frame(id, &mut connection, parsed, &mut out);
            if out.close || matches!(connection.state, State::Terminal) {
                connection.rx.clear();
                break;
            }
        }
        if !out.close
            && let State::Receiving(receive) = &mut connection.state
        {
            // `receive` returning hands this batch of ACKs to the transport adapter. A later call
            // begins a new receiver window; frames pipelined in this same call must share the
            // original four-frame grant.
            receive.receive_credit = MAX_IN_FLIGHT_DATA_FRAMES as u8;
        }
        self.connections.insert(id, connection);
        out
    }

    pub fn poll(&mut self, now_ms: u64) -> Vec<(ConnectionId, Vec<u8>)> {
        let mut out = Vec::new();
        for (&id, connection) in &mut self.connections {
            if connection.active()
                && now_ms.saturating_sub(connection.last_activity_ms) >= IDLE_TIMEOUT_MS
            {
                let stream_id = connection.active_stream_id().unwrap_or(1);
                connection.cancel();
                out.push((id, error_frame(stream_id, ErrorCode::Timeout)));
                continue;
            }
            if matches!(connection.state, State::Sending(_)) {
                let mut produced = ServiceOutput::default();
                pump_source(connection, &mut produced);
                if !produced.frames.is_empty() {
                    connection.last_activity_ms = now_ms;
                }
                out.extend(produced.frames.into_iter().map(|frame| (id, frame)));
            }
        }
        out
    }

    fn process_frame(
        &mut self,
        connection_id: ConnectionId,
        connection: &mut Connection,
        frame: Frame,
        out: &mut ServiceOutput,
    ) {
        match &mut connection.state {
            State::AwaitHello => {
                if frame.kind != HELLO || frame.stream_id != 0 {
                    out.frames
                        .push(error_frame(frame.stream_id, ErrorCode::BadState));
                    connection.state = State::Terminal;
                    return;
                }
                if frame.payload.as_slice() != [VERSION] {
                    let code = ErrorCode::UnsupportedVersion;
                    out.frames.push(error_frame(frame.stream_id, code));
                    connection.state = State::Terminal;
                    return;
                }
                out.frames.push(frame_bytes(HELLO_ACK, 0, &[VERSION]));
                connection.state = State::Ready;
            }
            State::Ready => {
                if frame.stream_id != 0 && connection.used_streams.contains(&frame.stream_id) {
                    // Terminal stream IDs are never reusable. Late/duplicate frames for them are
                    // ignored without poisoning the framed connection.
                    return;
                }
                if frame.kind != OFFER || frame.stream_id == 0 {
                    fail_stream(connection, frame.stream_id, ErrorCode::BadState, out);
                    return;
                }
                let Some(offer) = parse_offer(&frame.payload) else {
                    fail_stream(connection, frame.stream_id, ErrorCode::BadFrame, out);
                    return;
                };
                if offer.direction != DOWNLOAD {
                    fail_stream(connection, frame.stream_id, ErrorCode::BadFrame, out);
                    return;
                }
                if self.active_transfers() >= MAX_CONCURRENT_TRANSFERS {
                    fail_stream(connection, frame.stream_id, ErrorCode::Busy, out);
                    return;
                }
                if offer.total_len > MAX_TRANSFER_BYTES {
                    fail_stream(connection, frame.stream_id, ErrorCode::TooLarge, out);
                    return;
                }
                let name = match normalize_name(&offer.name) {
                    Ok(name) => name,
                    Err(code) => {
                        fail_stream(connection, frame.stream_id, code, out);
                        return;
                    }
                };
                if !connection.used_streams.insert(frame.stream_id) {
                    fail_stream(connection, frame.stream_id, ErrorCode::BadState, out);
                    return;
                }
                let sink = match self.store.open_sink(
                    connection_id,
                    frame.stream_id,
                    &name,
                    offer.total_len,
                    offer.sha256,
                ) {
                    Ok(sink) => sink,
                    Err(code) => {
                        fail_stream(connection, frame.stream_id, code, out);
                        return;
                    }
                };
                connection.state = State::Receiving(Receiving {
                    stream_id: frame.stream_id,
                    total_len: offer.total_len,
                    expected_sha: offer.sha256,
                    received: 0,
                    receive_credit: MAX_IN_FLIGHT_DATA_FRAMES as u8,
                    hasher: Sha256::new(),
                    sink,
                });
                out.frames.push(frame_bytes(ACCEPT, frame.stream_id, &[4]));
            }
            State::Receiving(receive) => {
                if frame.stream_id != receive.stream_id {
                    fail_stream(connection, frame.stream_id, ErrorCode::BadState, out);
                    return;
                }
                match frame.kind {
                    DATA => {
                        if receive.receive_credit == 0 {
                            fail_stream(connection, frame.stream_id, ErrorCode::FlowControl, out);
                            return;
                        }
                        if frame.payload.len() <= 8 || frame.payload.len() > MAX_FRAME_PAYLOAD {
                            fail_stream(connection, frame.stream_id, ErrorCode::BadFrame, out);
                            return;
                        }
                        let offset = u64::from_be_bytes(frame.payload[..8].try_into().unwrap());
                        let data = &frame.payload[8..];
                        if data.len() > MAX_DATA_BYTES
                            || offset != receive.received
                            || receive
                                .received
                                .checked_add(data.len() as u64)
                                .is_none_or(|end| end > receive.total_len)
                        {
                            fail_stream(connection, frame.stream_id, ErrorCode::BadOffset, out);
                            return;
                        }
                        if let Err(code) = receive.sink.write(offset, data) {
                            fail_stream(connection, frame.stream_id, code, out);
                            return;
                        }
                        receive.hasher.update(data);
                        receive.received += data.len() as u64;
                        receive.receive_credit -= 1;
                        let mut ack = receive.received.to_be_bytes().to_vec();
                        ack.push(4);
                        out.frames.push(frame_bytes(ACK, frame.stream_id, &ack));
                    }
                    COMMIT => {
                        if frame.payload.len() != 40 {
                            fail_stream(connection, frame.stream_id, ErrorCode::BadFrame, out);
                            return;
                        }
                        let total = u64::from_be_bytes(frame.payload[..8].try_into().unwrap());
                        let sha: [u8; 32] = frame.payload[8..].try_into().unwrap();
                        let actual: [u8; 32] = receive.hasher.clone().finalize().into();
                        if total != receive.total_len
                            || receive.received != receive.total_len
                            || sha != receive.expected_sha
                            || actual != receive.expected_sha
                        {
                            fail_stream(connection, frame.stream_id, ErrorCode::HashMismatch, out);
                            return;
                        }
                        match receive.sink.commit(total, sha) {
                            Ok(CommitDisposition::Durable) => {
                                out.frames.push(frame_bytes(
                                    COMPLETE,
                                    frame.stream_id,
                                    &frame.payload,
                                ));
                                connection.state = State::Ready;
                            }
                            Ok(CommitDisposition::Pending) => {
                                let State::Receiving(receive) =
                                    std::mem::replace(&mut connection.state, State::Terminal)
                                else {
                                    unreachable!()
                                };
                                connection.state = State::AwaitDurable {
                                    stream_id: frame.stream_id,
                                    total_len: total,
                                    sha256: sha,
                                    sink: receive.sink,
                                };
                            }
                            Err(code) => {
                                fail_stream(connection, frame.stream_id, code, out);
                            }
                        }
                    }
                    CANCEL if frame.payload.len() == 2 => {
                        receive.sink.cancel();
                        out.frames
                            .push(error_frame(frame.stream_id, ErrorCode::Cancelled));
                        connection.state = State::Ready;
                    }
                    _ => fail_stream(connection, frame.stream_id, ErrorCode::BadState, out),
                }
            }
            State::AwaitAccept { stream_id, .. } => {
                if frame.kind != ACCEPT || frame.stream_id != *stream_id || frame.payload.len() != 1
                {
                    fail_stream(connection, frame.stream_id, ErrorCode::BadState, out);
                    return;
                }
                let credit = frame.payload[0];
                if !(1..=MAX_IN_FLIGHT_DATA_FRAMES as u8).contains(&credit) {
                    fail_stream(connection, frame.stream_id, ErrorCode::FlowControl, out);
                    return;
                }
                let State::AwaitAccept {
                    stream_id,
                    source,
                    total_len,
                    expected_sha,
                } = std::mem::replace(&mut connection.state, State::Terminal)
                else {
                    unreachable!()
                };
                connection.state = State::Sending(Sending {
                    stream_id,
                    source,
                    total_len,
                    expected_sha,
                    sent: 0,
                    acked: 0,
                    credit,
                    outstanding_ends: VecDeque::new(),
                });
                pump_source(connection, out);
            }
            State::Sending(send) => {
                if frame.kind == CANCEL
                    && frame.stream_id == send.stream_id
                    && frame.payload.len() == 2
                {
                    send.source.cancel();
                    out.frames
                        .push(error_frame(frame.stream_id, ErrorCode::Cancelled));
                    connection.state = State::Ready;
                    return;
                }
                if frame.kind != ACK
                    || frame.stream_id != send.stream_id
                    || frame.payload.len() != 9
                {
                    fail_stream(connection, frame.stream_id, ErrorCode::BadState, out);
                    return;
                }
                let next = u64::from_be_bytes(frame.payload[..8].try_into().unwrap());
                let credit = frame.payload[8];
                if next < send.acked || next > send.sent || credit > MAX_IN_FLIGHT_DATA_FRAMES as u8
                {
                    fail_stream(connection, frame.stream_id, ErrorCode::FlowControl, out);
                    return;
                }
                send.acked = next;
                send.credit = credit;
                while send
                    .outstanding_ends
                    .front()
                    .is_some_and(|end| *end <= next)
                {
                    send.outstanding_ends.pop_front();
                }
                pump_source(connection, out);
            }
            State::AwaitComplete {
                stream_id,
                total_len,
                sha256,
            } => {
                if frame.kind != COMPLETE
                    || frame.stream_id != *stream_id
                    || frame.payload.len() != 40
                    || frame.payload[..8] != total_len.to_be_bytes()
                    || frame.payload[8..] != sha256[..]
                {
                    fail_stream(connection, frame.stream_id, ErrorCode::BadState, out);
                    return;
                }
                connection.state = State::Ready;
            }
            State::AwaitDurable { stream_id, .. } => {
                if frame.kind == CANCEL && frame.stream_id == *stream_id && frame.payload.len() == 2
                {
                    if let State::AwaitDurable { sink, .. } = &mut connection.state {
                        sink.cancel();
                    }
                    out.frames
                        .push(error_frame(frame.stream_id, ErrorCode::Cancelled));
                    connection.state = State::Ready;
                } else {
                    fail_stream(connection, frame.stream_id, ErrorCode::BadState, out);
                }
            }
            State::Terminal => out.close = true,
        }
    }
}

fn pump_source(connection: &mut Connection, out: &mut ServiceOutput) {
    let mut failure = None;
    let mut commit = None;
    if let State::Sending(send) = &mut connection.state {
        if send.source.total_len() != send.total_len || send.source.sha256() != send.expected_sha {
            failure = Some((send.stream_id, ErrorCode::SourceChanged));
        }
        while failure.is_none()
            && send.outstanding_ends.len() < send.credit as usize
            && send.outstanding_ends.len() < MAX_IN_FLIGHT_DATA_FRAMES
            && send.sent < send.total_len
        {
            let remaining = (send.total_len - send.sent).min(MAX_DATA_BYTES as u64) as usize;
            let data = match send.source.read(remaining) {
                Ok(data) if !data.is_empty() && data.len() <= remaining => data,
                // A browser File/ReadableStream producer fills a bounded queue between wasm run
                // chunks. Empty means "not buffered yet", not EOF; the transfer's idle timeout
                // still bounds a producer that never supplies the declared bytes.
                Ok(data) if data.is_empty() => break,
                Ok(_) => {
                    failure = Some((send.stream_id, ErrorCode::SourceChanged));
                    break;
                }
                Err(code) => {
                    failure = Some((send.stream_id, code));
                    break;
                }
            };
            let mut payload = send.sent.to_be_bytes().to_vec();
            payload.extend_from_slice(&data);
            send.sent += data.len() as u64;
            send.outstanding_ends.push_back(send.sent);
            out.frames.push(frame_bytes(DATA, send.stream_id, &payload));
        }
        if failure.is_none() && send.sent == send.total_len && send.outstanding_ends.is_empty() {
            commit = Some((send.stream_id, send.total_len, send.expected_sha));
        }
    }
    if let Some((stream_id, code)) = failure {
        fail_stream(connection, stream_id, code, out);
        return;
    }
    if let Some((stream_id, total_len, sha256)) = commit {
        let mut payload = total_len.to_be_bytes().to_vec();
        payload.extend_from_slice(&sha256);
        out.frames.push(frame_bytes(COMMIT, stream_id, &payload));
        connection.state = State::AwaitComplete {
            stream_id,
            total_len,
            sha256,
        };
    }
}

fn fail_stream(
    connection: &mut Connection,
    stream_id: u32,
    code: ErrorCode,
    out: &mut ServiceOutput,
) {
    connection.cancel();
    out.frames.push(error_frame(stream_id, code));
}

struct Frame {
    kind: u8,
    stream_id: u32,
    payload: Vec<u8>,
}

enum Parse {
    NeedMore,
    Fatal(ErrorCode),
    Frame(Frame, usize),
}

fn parse_one(bytes: &[u8]) -> Parse {
    if bytes.len() < HEADER_BYTES {
        return Parse::NeedMore;
    }
    if &bytes[..4] != MAGIC || bytes[6..8] != [0, 0] {
        return Parse::Fatal(ErrorCode::BadFrame);
    }
    if bytes[4] != VERSION {
        return Parse::Fatal(ErrorCode::UnsupportedVersion);
    }
    let kind = bytes[5];
    if !(HELLO..=ERROR).contains(&kind) {
        return Parse::Fatal(ErrorCode::BadFrame);
    }
    let stream_id = u32::from_be_bytes(bytes[8..12].try_into().unwrap());
    if (matches!(kind, HELLO | HELLO_ACK) && stream_id != 0)
        || (!matches!(kind, HELLO | HELLO_ACK) && stream_id == 0)
    {
        return Parse::Fatal(ErrorCode::BadFrame);
    }
    let payload_len = u32::from_be_bytes(bytes[12..16].try_into().unwrap()) as usize;
    if payload_len > MAX_FRAME_PAYLOAD {
        return Parse::Fatal(ErrorCode::TooLarge);
    }
    if kind != DATA && payload_len > MAX_CONTROL_PAYLOAD {
        return Parse::Fatal(ErrorCode::TooLarge);
    }
    let total = HEADER_BYTES + payload_len;
    if bytes.len() < total {
        return Parse::NeedMore;
    }
    let payload = &bytes[HEADER_BYTES..total];
    let valid_shape = match kind {
        HELLO | HELLO_ACK | ACCEPT => payload_len == 1,
        OFFER => (45..=44 + MAX_NAME_BYTES).contains(&payload_len),
        DATA => (9..=MAX_FRAME_PAYLOAD).contains(&payload_len),
        ACK => payload_len == 9,
        COMMIT | COMPLETE => payload_len == 40,
        CANCEL => payload_len == 2,
        ERROR => {
            (4..=MAX_CONTROL_PAYLOAD).contains(&payload_len)
                && u16::from_be_bytes(payload[2..4].try_into().unwrap()) as usize == payload_len - 4
                && std::str::from_utf8(&payload[4..]).is_ok()
        }
        _ => false,
    };
    if !valid_shape {
        return Parse::Fatal(ErrorCode::BadFrame);
    }
    Parse::Frame(
        Frame {
            kind,
            stream_id,
            payload: payload.to_vec(),
        },
        total,
    )
}

fn frame_bytes(kind: u8, stream_id: u32, payload: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(HEADER_BYTES + payload.len());
    out.extend_from_slice(MAGIC);
    out.push(VERSION);
    out.push(kind);
    out.extend_from_slice(&0u16.to_be_bytes());
    out.extend_from_slice(&stream_id.to_be_bytes());
    out.extend_from_slice(&(payload.len() as u32).to_be_bytes());
    out.extend_from_slice(payload);
    out
}

fn error_frame(stream_id: u32, code: ErrorCode) -> Vec<u8> {
    let mut payload = (code as u16).to_be_bytes().to_vec();
    payload.extend_from_slice(&0u16.to_be_bytes());
    frame_bytes(ERROR, stream_id.max(1), &payload)
}

struct Offer {
    direction: u8,
    total_len: u64,
    sha256: [u8; 32],
    name: String,
}

fn parse_offer(payload: &[u8]) -> Option<Offer> {
    if payload.len() < 44 || payload[1] != 0 {
        return None;
    }
    let name_len = u16::from_be_bytes(payload[2..4].try_into().ok()?) as usize;
    if name_len == 0 || payload.len() != 44 + name_len {
        return None;
    }
    Some(Offer {
        direction: payload[0],
        total_len: u64::from_be_bytes(payload[4..12].try_into().ok()?),
        sha256: payload[12..44].try_into().ok()?,
        name: std::str::from_utf8(&payload[44..]).ok()?.to_owned(),
    })
}

fn offer_frame(
    stream_id: u32,
    direction: u8,
    name: &str,
    total_len: u64,
    sha256: [u8; 32],
) -> Vec<u8> {
    let mut payload = vec![direction, 0];
    payload.extend_from_slice(&(name.len() as u16).to_be_bytes());
    payload.extend_from_slice(&total_len.to_be_bytes());
    payload.extend_from_slice(&sha256);
    payload.extend_from_slice(name.as_bytes());
    frame_bytes(OFFER, stream_id, &payload)
}

pub fn normalize_name(name: &str) -> Result<String, ErrorCode> {
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
                || (ch as u32 & 0xfffe) == 0xfffe
        })
    {
        return Err(ErrorCode::BadName);
    }
    Ok(normalized)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::{Cell, RefCell};
    use std::rc::Rc;

    #[derive(Default)]
    struct Stats {
        bytes: u64,
        writes: u64,
        committed: u64,
        cancelled: u64,
        max_chunk: usize,
    }

    struct CountingSink(Rc<RefCell<Stats>>);

    impl TransferSink for CountingSink {
        fn write(&mut self, offset: u64, bytes: &[u8]) -> Result<(), ErrorCode> {
            let mut stats = self.0.borrow_mut();
            if offset != stats.bytes {
                return Err(ErrorCode::BadOffset);
            }
            stats.bytes += bytes.len() as u64;
            stats.writes += 1;
            stats.max_chunk = stats.max_chunk.max(bytes.len());
            Ok(())
        }

        fn commit(
            &mut self,
            total_len: u64,
            _sha256: [u8; 32],
        ) -> Result<CommitDisposition, ErrorCode> {
            let mut stats = self.0.borrow_mut();
            if total_len != stats.bytes {
                return Err(ErrorCode::Io);
            }
            stats.committed += 1;
            Ok(CommitDisposition::Durable)
        }

        fn cancel(&mut self) {
            self.0.borrow_mut().cancelled += 1;
        }
    }

    struct CountingStore(Rc<RefCell<Stats>>);

    impl TransferStore for CountingStore {
        fn open_sink(
            &mut self,
            _connection_id: ConnectionId,
            _stream_id: u32,
            _name: &str,
            _total_len: u64,
            _sha256: [u8; 32],
        ) -> Result<Box<dyn TransferSink>, ErrorCode> {
            Ok(Box::new(CountingSink(self.0.clone())))
        }
    }

    struct PendingSink(Rc<RefCell<Stats>>);

    impl TransferSink for PendingSink {
        fn write(&mut self, offset: u64, bytes: &[u8]) -> Result<(), ErrorCode> {
            CountingSink(self.0.clone()).write(offset, bytes)
        }

        fn commit(
            &mut self,
            total_len: u64,
            _sha256: [u8; 32],
        ) -> Result<CommitDisposition, ErrorCode> {
            let mut stats = self.0.borrow_mut();
            if total_len != stats.bytes {
                return Err(ErrorCode::Io);
            }
            stats.committed += 1;
            Ok(CommitDisposition::Pending)
        }

        fn cancel(&mut self) {
            self.0.borrow_mut().cancelled += 1;
        }
    }

    struct PendingStore(Rc<RefCell<Stats>>);

    impl TransferStore for PendingStore {
        fn open_sink(
            &mut self,
            _connection_id: ConnectionId,
            _stream_id: u32,
            _name: &str,
            _total_len: u64,
            _sha256: [u8; 32],
        ) -> Result<Box<dyn TransferSink>, ErrorCode> {
            Ok(Box::new(PendingSink(self.0.clone())))
        }
    }

    struct BytesSource {
        name: String,
        bytes: Vec<u8>,
        offset: usize,
        sha256: [u8; 32],
    }

    struct MutatingSource {
        sha_calls: Cell<u8>,
    }

    struct QueuedSource {
        bytes: Rc<RefCell<VecDeque<Vec<u8>>>>,
        cancelled: Rc<Cell<bool>>,
        sha256: [u8; 32],
        total_len: u64,
    }

    impl TransferSource for QueuedSource {
        fn name(&self) -> &str {
            "stream.bin"
        }

        fn total_len(&self) -> u64 {
            self.total_len
        }

        fn sha256(&self) -> [u8; 32] {
            self.sha256
        }

        fn read(&mut self, max: usize) -> Result<Vec<u8>, ErrorCode> {
            let Some(mut bytes) = self.bytes.borrow_mut().pop_front() else {
                return Ok(Vec::new());
            };
            if bytes.len() > max {
                let tail = bytes.split_off(max);
                self.bytes.borrow_mut().push_front(tail);
            }
            Ok(bytes)
        }

        fn cancel(&mut self) {
            self.cancelled.set(true);
            self.bytes.borrow_mut().clear();
        }
    }

    impl TransferSource for MutatingSource {
        fn name(&self) -> &str {
            "changed.bin"
        }

        fn total_len(&self) -> u64 {
            1
        }

        fn sha256(&self) -> [u8; 32] {
            let call = self.sha_calls.get();
            self.sha_calls.set(call + 1);
            [call; 32]
        }

        fn read(&mut self, _max: usize) -> Result<Vec<u8>, ErrorCode> {
            Ok(vec![0])
        }
    }

    impl BytesSource {
        fn new(name: &str, bytes: Vec<u8>) -> Self {
            let sha256 = Sha256::digest(&bytes).into();
            Self {
                name: name.to_owned(),
                bytes,
                offset: 0,
                sha256,
            }
        }
    }

    impl TransferSource for BytesSource {
        fn name(&self) -> &str {
            &self.name
        }

        fn total_len(&self) -> u64 {
            self.bytes.len() as u64
        }

        fn sha256(&self) -> [u8; 32] {
            self.sha256
        }

        fn read(&mut self, max: usize) -> Result<Vec<u8>, ErrorCode> {
            let end = self.offset.saturating_add(max).min(self.bytes.len());
            let chunk = self.bytes[self.offset..end].to_vec();
            self.offset = end;
            Ok(chunk)
        }
    }

    fn hello(service: &mut FileTransferService, id: ConnectionId) {
        let output = service.receive(id, &frame_bytes(HELLO, 0, &[1]), 0);
        assert_eq!(output.frames[0][5], HELLO_ACK);
    }

    fn offer(direction: u8, stream: u32, name: &str, data: &[u8]) -> Vec<u8> {
        offer_frame(
            stream,
            direction,
            name,
            data.len() as u64,
            Sha256::digest(data).into(),
        )
    }

    fn send_download(
        service: &mut FileTransferService,
        id: ConnectionId,
        stream: u32,
        name: &str,
        total: usize,
    ) {
        let byte = |offset: usize| ((offset.wrapping_mul(31) + 7) & 0xff) as u8;
        let mut expected = Sha256::new();
        for offset in 0..total {
            expected.update([byte(offset)]);
        }
        let sha: [u8; 32] = expected.finalize().into();
        let output = service.receive(
            id,
            &offer_frame(stream, DOWNLOAD, name, total as u64, sha),
            1,
        );
        assert_eq!(output.frames[0][5], ACCEPT);
        let mut offset = 0;
        while offset < total {
            let len = (total - offset).min(MAX_DATA_BYTES);
            let mut payload = (offset as u64).to_be_bytes().to_vec();
            payload.extend((offset..offset + len).map(byte));
            let output = service.receive(id, &frame_bytes(DATA, stream, &payload), 2);
            assert_eq!(output.frames[0][5], ACK);
            offset += len;
            assert!(service.buffered_bytes() <= MAX_OWNED_BYTES);
        }
        let mut commit = (total as u64).to_be_bytes().to_vec();
        commit.extend_from_slice(&sha);
        let output = service.receive(id, &frame_bytes(COMMIT, stream, &commit), 3);
        assert_eq!(output.frames[0][5], COMPLETE);
    }

    #[test]
    fn empty_and_100_mib_stream_without_whole_file_buffering() {
        let stats = Rc::new(RefCell::new(Stats::default()));
        let mut service = FileTransferService::new(Box::new(CountingStore(stats.clone())));
        let id = service.connect(0);
        hello(&mut service, id);
        send_download(&mut service, id, 1, "empty", 0);
        send_download(&mut service, id, 2, "large.bin", 100 * 1024 * 1024);
        let stats = stats.borrow();
        assert_eq!(stats.bytes, 100 * 1024 * 1024);
        assert_eq!(stats.committed, 2);
        assert!(stats.max_chunk <= MAX_DATA_BYTES);
    }

    #[test]
    fn pending_sink_withholds_complete_until_durable_finish() {
        let stats = Rc::new(RefCell::new(Stats::default()));
        let mut service = FileTransferService::new(Box::new(PendingStore(stats.clone())));
        let id = service.connect(0);
        hello(&mut service, id);
        let bytes = b"durable later";
        let sha: [u8; 32] = Sha256::digest(bytes).into();
        assert_eq!(
            service
                .receive(id, &offer(DOWNLOAD, 9, "later.bin", bytes), 1)
                .frames[0][5],
            ACCEPT
        );
        let mut data = 0u64.to_be_bytes().to_vec();
        data.extend_from_slice(bytes);
        assert_eq!(
            service.receive(id, &frame_bytes(DATA, 9, &data), 2).frames[0][5],
            ACK
        );
        let mut commit = (bytes.len() as u64).to_be_bytes().to_vec();
        commit.extend_from_slice(&sha);
        let before_close = service.receive(id, &frame_bytes(COMMIT, 9, &commit), 3);
        assert!(before_close.frames.is_empty());
        assert!(!service.connection_ready(id));
        assert_eq!(service.active_transfers(), 1);

        let after_close = service.finish_pending_download(id, 9, Ok(()), 4);
        assert_eq!(after_close.frames[0][5], COMPLETE);
        assert!(service.connection_ready(id));
        assert_eq!(stats.borrow().committed, 1);
    }

    #[test]
    fn host_stream_waits_for_bounded_chunks_and_cancel_returns_connection_to_ready() {
        let bytes = Rc::new(RefCell::new(VecDeque::new()));
        let cancelled = Rc::new(Cell::new(false));
        let payload = b"streamed later".to_vec();
        let mut service = FileTransferService::default();
        let id = service.connect(0);
        hello(&mut service, id);
        let offer = service
            .queue_upload(
                id,
                7,
                Box::new(QueuedSource {
                    bytes: bytes.clone(),
                    cancelled: cancelled.clone(),
                    sha256: Sha256::digest(&payload).into(),
                    total_len: payload.len() as u64,
                }),
                1,
            )
            .unwrap();
        assert_eq!(offer[0][5], OFFER);

        let accepted = service.receive(id, &frame_bytes(ACCEPT, 7, &[4]), 2);
        assert!(
            accepted.frames.is_empty(),
            "an empty producer queue is backpressure, not EOF"
        );
        bytes.borrow_mut().push_back(payload);
        let produced = service.poll(3);
        assert_eq!(produced.len(), 1);
        assert_eq!(produced[0].1[5], DATA);
        assert!(!service.connection_terminal(id));

        let cancel = service.cancel(id, 7, 4);
        assert_eq!(cancel.frames[0][5], CANCEL);
        assert!(cancelled.get());
        assert!(service.connection_ready(id));
    }

    #[test]
    fn malformed_oversized_hostile_and_interrupted_inputs_fail_closed() {
        let stats = Rc::new(RefCell::new(Stats::default()));
        let mut service = FileTransferService::new(Box::new(CountingStore(stats.clone())));

        let malformed = service.connect(0);
        let output = service.receive(malformed, b"NOPE\0\0\0\0\0\0\0\0\0\0\0\0", 0);
        assert!(output.close);

        let oversized = service.connect(0);
        let mut header = frame_bytes(HELLO, 0, &[]);
        header[12..16].copy_from_slice(&((MAX_FRAME_PAYLOAD + 1) as u32).to_be_bytes());
        assert!(service.receive(oversized, &header, 0).close);

        for (kind, payload) in [
            (HELLO, vec![]),
            (ACCEPT, vec![]),
            (DATA, vec![0; 8]),
            (ACK, vec![0; 8]),
            (COMMIT, vec![0; 39]),
            (COMPLETE, vec![0; 41]),
            (CANCEL, vec![0]),
            (ERROR, vec![0; 3]),
        ] {
            let id = service.connect(0);
            let stream = if matches!(kind, HELLO | HELLO_ACK) {
                0
            } else {
                7
            };
            assert!(
                service
                    .receive(id, &frame_bytes(kind, stream, &payload), 0)
                    .close,
                "type {kind} rejects its wrong exact length"
            );
        }

        for mut header in [
            frame_bytes(HELLO, 0, &[1]),
            frame_bytes(HELLO, 0, &[1]),
            frame_bytes(HELLO, 0, &[1]),
        ] {
            let id = service.connect(0);
            match id % 3 {
                0 => header[4] = 2,
                1 => header[5] = 0xff,
                _ => header[6] = 1,
            }
            assert!(service.receive(id, &header, 0).close);
        }

        for name in ["../x", "/etc/passwd", r"a\b", ".", "..", "x\u{202e}y"] {
            let id = service.connect(0);
            hello(&mut service, id);
            let output = service.receive(id, &offer(DOWNLOAD, 7, name, b"x"), 1);
            assert_eq!(output.frames[0][5], ERROR);
        }

        let interrupted = service.connect(0);
        hello(&mut service, interrupted);
        service.receive(interrupted, &offer(DOWNLOAD, 9, "partial", b"abc"), 1);
        service.disconnect(interrupted);
        assert_eq!(stats.borrow().cancelled, 1);

        let too_large = service.connect(0);
        hello(&mut service, too_large);
        let output = service.receive(
            too_large,
            &offer_frame(12, DOWNLOAD, "huge", MAX_TRANSFER_BYTES + 1, [0; 32]),
            1,
        );
        assert_eq!(
            u16::from_be_bytes(output.frames[0][16..18].try_into().unwrap()),
            ErrorCode::TooLarge as u16
        );

        let gap = service.connect(0);
        hello(&mut service, gap);
        service.receive(gap, &offer(DOWNLOAD, 13, "gap", b"x"), 1);
        let mut data = 1u64.to_be_bytes().to_vec();
        data.push(b'x');
        let output = service.receive(gap, &frame_bytes(DATA, 13, &data), 2);
        assert_eq!(
            u16::from_be_bytes(output.frames[0][16..18].try_into().unwrap()),
            ErrorCode::BadOffset as u16
        );
    }

    #[test]
    fn two_transfers_are_allowed_and_third_is_busy() {
        let stats = Rc::new(RefCell::new(Stats::default()));
        let mut service = FileTransferService::new(Box::new(CountingStore(stats)));
        let ids = [service.connect(0), service.connect(0), service.connect(0)];
        for id in ids {
            hello(&mut service, id);
        }
        assert_eq!(
            service
                .receive(ids[0], &offer(DOWNLOAD, 1, "a", b"x"), 1)
                .frames[0][5],
            ACCEPT
        );
        assert_eq!(
            service
                .receive(ids[1], &offer(DOWNLOAD, 2, "b", b"x"), 1)
                .frames[0][5],
            ACCEPT
        );
        let third = service.receive(ids[2], &offer(DOWNLOAD, 3, "c", b"x"), 1);
        assert_eq!(third.frames[0][5], ERROR);
        assert_eq!(
            u16::from_be_bytes(third.frames[0][16..18].try_into().unwrap()),
            ErrorCode::Busy as u16
        );
    }

    #[test]
    fn timeout_cancels_active_sink() {
        let stats = Rc::new(RefCell::new(Stats::default()));
        let mut service = FileTransferService::new(Box::new(CountingStore(stats.clone())));
        let id = service.connect(0);
        hello(&mut service, id);
        service.receive(id, &offer(DOWNLOAD, 1, "a", b"x"), 1);
        let output = service.poll(IDLE_TIMEOUT_MS + 1);
        assert_eq!(output.len(), 1);
        assert_eq!(stats.borrow().cancelled, 1);
    }

    #[test]
    fn receiver_rejects_data_beyond_advertised_credit() {
        let stats = Rc::new(RefCell::new(Stats::default()));
        let mut service = FileTransferService::new(Box::new(CountingStore(stats.clone())));
        let id = service.connect(0);
        hello(&mut service, id);
        let data = b"abcde";
        let accepted = service.receive(id, &offer(DOWNLOAD, 42, "credit.bin", data), 1);
        assert_eq!(accepted.frames[0][5], ACCEPT);
        assert_eq!(accepted.frames[0][16], MAX_IN_FLIGHT_DATA_FRAMES as u8);

        // All five frames arrive in one read before any ACK returned by `receive` can reach the
        // sender. The fifth therefore exceeds the four-frame receiver credit.
        let mut pipelined = Vec::new();
        for (offset, byte) in data.iter().enumerate() {
            let mut payload = (offset as u64).to_be_bytes().to_vec();
            payload.push(*byte);
            pipelined.extend_from_slice(&frame_bytes(DATA, 42, &payload));
        }
        let output = service.receive(id, &pipelined, 2);
        let last = output.frames.last().expect("terminal FLOW_CONTROL error");
        assert_eq!(last[5], ERROR);
        assert_eq!(
            u16::from_be_bytes(last[16..18].try_into().unwrap()),
            ErrorCode::FlowControl as u16
        );
        assert_eq!(
            stats.borrow().bytes,
            MAX_IN_FLIGHT_DATA_FRAMES as u64,
            "the over-credit frame must not reach the sink"
        );
    }

    #[test]
    fn duplicate_cancel_is_idempotent_and_connection_remains_usable() {
        let stats = Rc::new(RefCell::new(Stats::default()));
        let mut service = FileTransferService::new(Box::new(CountingStore(stats)));
        let id = service.connect(0);
        hello(&mut service, id);
        service.receive(id, &offer(DOWNLOAD, 43, "cancel.bin", b"x"), 1);
        let cancel = frame_bytes(CANCEL, 43, &0u16.to_be_bytes());
        let first = service.receive(id, &cancel, 2);
        assert_eq!(first.frames[0][5], ERROR);
        assert_eq!(
            u16::from_be_bytes(first.frames[0][16..18].try_into().unwrap()),
            ErrorCode::Cancelled as u16
        );

        let duplicate = service.receive(id, &cancel, 3);
        assert!(
            !duplicate.close,
            "duplicate CANCEL must not reclassify or kill the connection"
        );
        assert!(
            duplicate.frames.is_empty(),
            "frames after the terminal stream state are ignored"
        );
        let next = service.receive(id, &offer(DOWNLOAD, 44, "next.bin", b"x"), 4);
        assert_eq!(
            next.frames[0][5], ACCEPT,
            "a terminal stream must not make a framed connection unusable"
        );
    }

    #[test]
    fn timeout_error_identifies_the_affected_stream() {
        let stats = Rc::new(RefCell::new(Stats::default()));
        let mut service = FileTransferService::new(Box::new(CountingStore(stats)));
        let id = service.connect(0);
        hello(&mut service, id);
        service.receive(id, &offer(DOWNLOAD, 45, "timeout.bin", b"x"), 1);
        let output = service.poll(IDLE_TIMEOUT_MS + 1);
        assert_eq!(output.len(), 1);
        assert_eq!(
            u32::from_be_bytes(output[0].1[8..12].try_into().unwrap()),
            45,
            "timeout must be correlated with the active transfer"
        );
    }

    #[test]
    fn timeout_error_identifies_a_host_upload_awaiting_accept() {
        let mut service = FileTransferService::default();
        let id = service.connect(0);
        hello(&mut service, id);
        service
            .queue_upload(
                id,
                46,
                Box::new(BytesSource::new("waiting.bin", b"x".to_vec())),
                1,
            )
            .unwrap();

        let output = service.poll(IDLE_TIMEOUT_MS + 1);
        assert_eq!(output.len(), 1);
        assert_eq!(output[0].0, id);
        assert_eq!(output[0].1[5], ERROR);
        assert_eq!(
            u32::from_be_bytes(output[0].1[8..12].try_into().unwrap()),
            46,
            "the AwaitAccept branch must preserve the host-upload stream ID"
        );
        assert_eq!(
            u16::from_be_bytes(output[0].1[16..18].try_into().unwrap()),
            ErrorCode::Timeout as u16
        );
    }

    #[test]
    fn host_upload_obeys_credit_and_waits_for_complete() {
        let mut service = FileTransferService::default();
        let id = service.connect(0);
        hello(&mut service, id);
        let bytes = vec![0x5a; MAX_DATA_BYTES + 17];
        let sha: [u8; 32] = Sha256::digest(&bytes).into();
        let offer = service
            .queue_upload(
                id,
                41,
                Box::new(BytesSource::new("host.bin", bytes.clone())),
                1,
            )
            .unwrap();
        assert_eq!(offer.len(), 1);
        assert_eq!(offer[0][5], OFFER);
        assert_eq!(offer[0][16], UPLOAD);

        let first = service.receive(id, &frame_bytes(ACCEPT, 41, &[1]), 2);
        assert_eq!(first.frames.len(), 1, "one credit emits exactly one DATA");
        assert_eq!(first.frames[0][5], DATA);
        assert_eq!(
            u64::from_be_bytes(first.frames[0][16..24].try_into().unwrap()),
            0
        );
        assert_eq!(first.frames[0].len() - HEADER_BYTES - 8, MAX_DATA_BYTES);

        let mut ack = (MAX_DATA_BYTES as u64).to_be_bytes().to_vec();
        ack.push(1);
        let second = service.receive(id, &frame_bytes(ACK, 41, &ack), 3);
        assert_eq!(second.frames.len(), 1);
        assert_eq!(second.frames[0][5], DATA);
        assert_eq!(
            u64::from_be_bytes(second.frames[0][16..24].try_into().unwrap()),
            MAX_DATA_BYTES as u64
        );
        assert_eq!(second.frames[0].len() - HEADER_BYTES - 8, 17);

        let mut final_ack = (bytes.len() as u64).to_be_bytes().to_vec();
        final_ack.push(1);
        let commit = service.receive(id, &frame_bytes(ACK, 41, &final_ack), 4);
        assert_eq!(commit.frames.len(), 1);
        assert_eq!(commit.frames[0][5], COMMIT);
        assert_eq!(&commit.frames[0][24..56], &sha);
        assert_eq!(service.active_transfers(), 1);

        let mut complete = (bytes.len() as u64).to_be_bytes().to_vec();
        complete.extend_from_slice(&sha);
        let done = service.receive(id, &frame_bytes(COMPLETE, 41, &complete), 5);
        assert!(done.frames.is_empty());
        assert_eq!(service.active_transfers(), 0);
        assert!(service.buffered_bytes() <= MAX_OWNED_BYTES);
    }

    #[test]
    fn stream_ids_cannot_be_reused_and_source_mutation_is_terminal() {
        let stats = Rc::new(RefCell::new(Stats::default()));
        let mut service = FileTransferService::new(Box::new(CountingStore(stats)));
        let id = service.connect(0);
        hello(&mut service, id);
        send_download(&mut service, id, 77, "first", 0);
        let reused = service.receive(id, &offer(DOWNLOAD, 77, "second", b""), 4);
        assert!(reused.frames.is_empty());
        assert!(!reused.close);

        let source_id = service.connect(0);
        hello(&mut service, source_id);
        service
            .queue_upload(
                source_id,
                78,
                Box::new(MutatingSource {
                    sha_calls: Cell::new(0),
                }),
                1,
            )
            .unwrap();
        let changed = service.receive(source_id, &frame_bytes(ACCEPT, 78, &[1]), 2);
        assert_eq!(changed.frames[0][5], ERROR);
        assert_eq!(
            u16::from_be_bytes(changed.frames[0][16..18].try_into().unwrap()),
            ErrorCode::SourceChanged as u16
        );
    }

    #[test]
    fn name_normalization_is_nfc_and_component_free() {
        assert_eq!(normalize_name("e\u{301}.txt").unwrap(), "é.txt");
        for bad in ["", ".", "..", "a/b", r"a\b", "trailing.", "trailing "] {
            assert_eq!(normalize_name(bad), Err(ErrorCode::BadName));
        }
    }
}
