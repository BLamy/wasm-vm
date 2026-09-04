//! Small, bounded guest peer for the named virtio-console port.
//!
//! The process has one authority: `/dev/virtio-ports/org.wasmvm.agent`.  It does not accept
//! addresses, paths, commands, or environment overrides.  The protocol state machine is kept in
//! this library so native tests can attack it without needing a booted guest; the binary's only
//! runtime loop is the poll-bounded file-descriptor adapter below.

use std::collections::VecDeque;
use std::error::Error;
use std::ffi::c_int;
use std::fs::{File, OpenOptions};
use std::io::{self, ErrorKind, Read, Write};
use std::os::fd::{AsRawFd, RawFd};
use std::path::Path;
use std::time::Duration;

use wasm_vm_agent_protocol::{
    CAP_PING, DecodeError, EncodeError, FLAG_NONE, Frame, FrameDecoder, Hello, Nak,
    NegotiationError, PayloadError, Ping, TYPE_HELLO, TYPE_NAK, TYPE_PING, TYPE_PONG, encode_frame,
};

/// The only device node the production binary may open.
pub const PORT_PATH: &str = "/dev/virtio-ports/org.wasmvm.agent";
/// Every blocking wait in the service is capped at one second.
pub const POLL_TIMEOUT_MS: i32 = 1_000;
/// Backoff for a missing/recreated port starts at 100 ms and caps at 800 ms.
pub const RETRY_DELAY_MS: u64 = 100;
pub const MAX_RETRY_DELAY_MS: u64 = 800;
/// A read is deliberately smaller than the protocol's 1 MiB frame cap.  The decoder carries the
/// remainder across poll wakeups, so a peer cannot force a larger socket read allocation.
pub const READ_BUFFER_BYTES: usize = 16 * 1024;
/// Responses are all small, but an unknown-message storm must still have a hard memory ceiling.
pub const MAX_QUEUED_OUTPUT_BYTES: usize = 64 * 1024;
/// The guest advertises only the capability this slice implements.
pub const AGENT_CAPABILITIES: u64 = CAP_PING;

const POLLIN: i16 = 0x0001;
const POLLOUT: i16 = 0x0004;
const POLLERR: i16 = 0x0008;
const POLLHUP: i16 = 0x0010;
const POLLNVAL: i16 = 0x0020;
const F_GETFL: c_int = 3;
const F_SETFL: c_int = 4;

#[cfg(target_os = "linux")]
const O_NONBLOCK: c_int = 0x0800;
#[cfg(target_os = "macos")]
const O_NONBLOCK: c_int = 0x0004;
#[cfg(not(any(target_os = "linux", target_os = "macos")))]
const O_NONBLOCK: c_int = 0x0800;

#[repr(C)]
struct PollFd {
    fd: RawFd,
    events: i16,
    revents: i16,
}

unsafe extern "C" {
    fn fcntl(fd: c_int, command: c_int, ...) -> c_int;
    fn poll(fds: *mut PollFd, count: usize, timeout: c_int) -> c_int;
}

#[derive(Debug)]
pub enum SessionError {
    Decode(DecodeError),
    Encode(EncodeError),
    Payload(PayloadError),
    Negotiation(NegotiationError),
    OutputFull { needed: usize, available: usize },
    InvalidOutputAdvance { requested: usize, available: usize },
}

impl std::fmt::Display for SessionError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Decode(error) => write!(formatter, "protocol decode failed: {error}"),
            Self::Encode(error) => write!(formatter, "protocol encode failed: {error}"),
            Self::Payload(error) => write!(formatter, "protocol payload failed: {error}"),
            Self::Negotiation(error) => write!(formatter, "protocol negotiation failed: {error}"),
            Self::OutputFull { needed, available } => write!(
                formatter,
                "agent output queue needs {needed} bytes but only {available} remain"
            ),
            Self::InvalidOutputAdvance {
                requested,
                available,
            } => write!(
                formatter,
                "agent output advanced by {requested} bytes with {available} available"
            ),
        }
    }
}

impl Error for SessionError {}

impl From<DecodeError> for SessionError {
    fn from(error: DecodeError) -> Self {
        Self::Decode(error)
    }
}

impl From<EncodeError> for SessionError {
    fn from(error: EncodeError) -> Self {
        Self::Encode(error)
    }
}

impl From<PayloadError> for SessionError {
    fn from(error: PayloadError) -> Self {
        Self::Payload(error)
    }
}

impl From<NegotiationError> for SessionError {
    fn from(error: NegotiationError) -> Self {
        Self::Negotiation(error)
    }
}

struct PendingWrite {
    bytes: Vec<u8>,
    offset: usize,
}

impl PendingWrite {
    fn remaining(&self) -> &[u8] {
        &self.bytes[self.offset..]
    }
}

struct SessionState {
    output: VecDeque<PendingWrite>,
    output_bytes: usize,
    negotiated: Option<Hello>,
}

impl SessionState {
    fn new() -> Self {
        Self {
            output: VecDeque::new(),
            output_bytes: 0,
            negotiated: None,
        }
    }

    fn clear(&mut self) {
        self.output.clear();
        self.output_bytes = 0;
        self.negotiated = None;
    }
}

/// Protocol state for one open of the named virtio port.
pub struct AgentSession {
    decoder: FrameDecoder,
    state: SessionState,
}

impl AgentSession {
    /// Construct a fresh connection and queue the guest's HELLO immediately.
    pub fn new() -> Self {
        let mut session = Self {
            decoder: FrameDecoder::new(),
            state: SessionState::new(),
        };
        session
            .queue_hello()
            .expect("the fixed guest HELLO must fit the output bound");
        session
    }

    /// Feed bytes read from the named port.  A malformed frame terminates this session; callers
    /// must drop the file descriptor and create a fresh `AgentSession` rather than guessing at
    /// the next framing boundary.
    pub fn receive(&mut self, input: &[u8]) -> Result<usize, SessionError> {
        let mut failure = None;
        let decoder = &mut self.decoder;
        let state = &mut self.state;
        let consumed = decoder.push(input, |frame| {
            if failure.is_none()
                && let Err(error) = handle_frame(state, frame)
            {
                failure = Some(error);
            }
        })?;
        if let Some(error) = failure {
            Err(error)
        } else {
            Ok(consumed)
        }
    }

    /// An EOF is clean only when no frame header or payload is in flight.
    pub fn finish(&self) -> Result<(), DecodeError> {
        self.decoder.finish()
    }

    /// Drop all in-flight framing and responses, then begin the next port incarnation with a
    /// fresh HELLO.  The service normally drops the whole session on EOF; this explicit seam is
    /// used by the restart fixture and makes the in-flight-frame rule testable.
    pub fn reset(&mut self) {
        self.decoder.reset();
        self.state.clear();
        self.queue_hello()
            .expect("the fixed guest HELLO must fit the output bound");
    }

    pub fn pending_frame_bytes(&self) -> usize {
        self.decoder.pending_bytes()
    }

    pub fn negotiated(&self) -> Option<Hello> {
        self.state.negotiated
    }

    pub fn pending_output_bytes(&self) -> usize {
        self.state.output_bytes
    }

    pub fn has_output(&self) -> bool {
        !self.state.output.is_empty()
    }

    /// Bytes still waiting in the first response frame.  The returned slice is invalidated by
    /// `consume_output` or the next protocol operation.
    pub fn front_output(&self) -> Option<&[u8]> {
        self.state.output.front().map(PendingWrite::remaining)
    }

    /// Retire bytes successfully written by the file-descriptor adapter.
    pub fn consume_output(&mut self, amount: usize) -> Result<(), SessionError> {
        if amount == 0 {
            return Ok(());
        }
        let available = self
            .state
            .output
            .front()
            .map_or(0, PendingWrite::remaining_len);
        if amount > available {
            return Err(SessionError::InvalidOutputAdvance {
                requested: amount,
                available,
            });
        }
        if let Some(front) = self.state.output.front_mut() {
            front.offset += amount;
        }
        self.state.output_bytes -= amount;
        if self
            .state
            .output
            .front()
            .is_some_and(|front| front.offset == front.bytes.len())
        {
            self.state.output.pop_front();
        }
        Ok(())
    }

    /// Native test/fixture seam: drain all queued response bytes in wire order.
    pub fn drain_output(&mut self) -> Vec<u8> {
        let mut output = Vec::with_capacity(self.state.output_bytes);
        while let Some(frame) = self.state.output.pop_front() {
            output.extend_from_slice(frame.remaining());
        }
        self.state.output_bytes = 0;
        output
    }

    fn queue_hello(&mut self) -> Result<(), SessionError> {
        let hello = Hello::current(AGENT_CAPABILITIES);
        let mut payload = [0u8; Hello::PAYLOAD_BYTES];
        hello.encode_payload(&mut payload)?;
        self.queue_message(TYPE_HELLO, FLAG_NONE, &payload)
    }

    fn queue_message(
        &mut self,
        message_type: u16,
        flags: u16,
        payload: &[u8],
    ) -> Result<(), SessionError> {
        queue_message(&mut self.state, message_type, flags, payload)
    }
}

impl Default for AgentSession {
    fn default() -> Self {
        Self::new()
    }
}

impl PendingWrite {
    fn remaining_len(&self) -> usize {
        self.bytes.len().saturating_sub(self.offset)
    }
}

fn queue_message(
    state: &mut SessionState,
    message_type: u16,
    flags: u16,
    payload: &[u8],
) -> Result<(), SessionError> {
    let required = wasm_vm_agent_protocol::FRAME_HEADER_BYTES
        .checked_add(payload.len())
        .ok_or(SessionError::OutputFull {
            needed: usize::MAX,
            available: 0,
        })?;
    if state.output_bytes.saturating_add(required) > MAX_QUEUED_OUTPUT_BYTES {
        return Err(SessionError::OutputFull {
            needed: required,
            available: MAX_QUEUED_OUTPUT_BYTES.saturating_sub(state.output_bytes),
        });
    }
    let mut bytes = vec![0u8; required];
    let used = encode_frame(message_type, flags, payload, &mut bytes)?;
    debug_assert_eq!(used, required);
    state.output_bytes += used;
    state.output.push_back(PendingWrite { bytes, offset: 0 });
    Ok(())
}

fn handle_frame(state: &mut SessionState, frame: Frame) -> Result<(), SessionError> {
    match frame.message_type {
        TYPE_HELLO => {
            let peer = Hello::from_payload(&frame.payload)?;
            let negotiated = Hello::current(AGENT_CAPABILITIES).negotiate(peer)?;
            state.negotiated = Some(negotiated);
            let mut payload = [0u8; Hello::PAYLOAD_BYTES];
            negotiated.encode_payload(&mut payload)?;
            queue_message(state, TYPE_HELLO, FLAG_NONE, &payload)
        }
        TYPE_PING => {
            let ping = Ping::from_payload(&frame.payload)?;
            let mut payload = [0u8; Ping::PAYLOAD_BYTES];
            ping.encode_payload(&mut payload)?;
            queue_message(state, TYPE_PONG, FLAG_NONE, &payload)
        }
        TYPE_PONG => {
            // PONG uses the same fixed nonce payload as PING.  Validate it so a malformed peer
            // cannot silently keep a session alive with a desynchronized stream.
            Ping::from_payload(&frame.payload)?;
            Ok(())
        }
        TYPE_NAK => {
            Nak::from_payload(&frame.payload)?;
            Ok(())
        }
        message_type => {
            let nak = Nak::unknown_type(message_type);
            let mut payload = [0u8; Nak::PAYLOAD_BYTES];
            nak.encode_payload(&mut payload)?;
            queue_message(state, TYPE_NAK, FLAG_NONE, &payload)
        }
    }
}

/// Exponential retry state used while the kernel removes/recreates the virtio port.
#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
pub struct RetryBackoff {
    failures: u8,
}

impl RetryBackoff {
    pub const fn new() -> Self {
        Self { failures: 0 }
    }

    pub fn delay_ms(&self) -> u64 {
        let shift = u32::from(self.failures.min(3));
        RETRY_DELAY_MS
            .saturating_mul(1u64 << shift)
            .min(MAX_RETRY_DELAY_MS)
    }

    pub fn record_failure(&mut self) -> u64 {
        let delay = self.delay_ms();
        self.failures = self.failures.saturating_add(1).min(3);
        delay
    }

    pub fn reset(&mut self) {
        self.failures = 0;
    }
}

/// Run forever, reopening the fixed named port after EOF, protocol failure, or port absence.
/// `poll()` bounds every open-port wait; the missing-port path uses the equally bounded retry
/// sleep.  No error is printed on the hot retry path, so a removed port cannot create a log storm.
pub fn run_service() -> ! {
    let mut backoff = RetryBackoff::new();
    loop {
        match run_connection(Path::new(PORT_PATH)) {
            Ok(()) => backoff.reset(),
            Err(_error) => {
                let delay = backoff.record_failure();
                std::thread::sleep(Duration::from_millis(delay));
            }
        }
    }
}

#[derive(Debug)]
enum ConnectionError {
    Io,
    Protocol,
    Disconnected,
}

impl From<io::Error> for ConnectionError {
    fn from(_error: io::Error) -> Self {
        Self::Io
    }
}

impl From<SessionError> for ConnectionError {
    fn from(_error: SessionError) -> Self {
        Self::Protocol
    }
}

fn run_connection(path: &Path) -> Result<(), ConnectionError> {
    let mut port = OpenOptions::new().read(true).write(true).open(path)?;
    set_nonblocking(&port)?;
    let mut session = AgentSession::new();
    let mut read_buffer = [0u8; READ_BUFFER_BYTES];

    loop {
        let events = POLLIN | if session.has_output() { POLLOUT } else { 0 };
        let revents = poll_one(port.as_raw_fd(), events)?;
        if revents & POLLNVAL != 0 {
            return Err(ConnectionError::Disconnected);
        }

        if revents & POLLIN != 0 {
            loop {
                match port.read(&mut read_buffer) {
                    Ok(0) => {
                        return Err(ConnectionError::Disconnected);
                    }
                    Ok(count) => {
                        session.receive(&read_buffer[..count])?;
                        if count < read_buffer.len() {
                            break;
                        }
                    }
                    Err(error) if error.kind() == ErrorKind::Interrupted => continue,
                    Err(error) if error.kind() == ErrorKind::WouldBlock => break,
                    Err(_error) => return Err(ConnectionError::Io),
                }
            }
        }

        if revents & POLLOUT != 0 {
            flush_output(&mut port, &mut session)?;
        }

        if revents & (POLLERR | POLLHUP) != 0 {
            return Err(ConnectionError::Disconnected);
        }
    }
}

fn flush_output(port: &mut File, session: &mut AgentSession) -> Result<(), ConnectionError> {
    loop {
        let Some(bytes) = session.front_output() else {
            return Ok(());
        };
        match port.write(bytes) {
            Ok(0) => {
                return Err(ConnectionError::Disconnected);
            }
            Ok(count) => session.consume_output(count)?,
            Err(error) if error.kind() == ErrorKind::Interrupted => continue,
            Err(error) if error.kind() == ErrorKind::WouldBlock => return Ok(()),
            Err(_error) => return Err(ConnectionError::Io),
        }
    }
}

fn poll_one(fd: RawFd, events: i16) -> io::Result<i16> {
    let mut descriptor = PollFd {
        fd,
        events,
        revents: 0,
    };
    loop {
        // SAFETY: `descriptor` is a valid one-element poll array for the duration of the call;
        // the kernel writes only its revents field and the timeout is finite.
        let result = unsafe { poll(&mut descriptor, 1, POLL_TIMEOUT_MS) };
        if result >= 0 {
            return Ok(descriptor.revents);
        }
        let error = io::Error::last_os_error();
        if error.kind() == ErrorKind::Interrupted {
            continue;
        }
        return Err(error);
    }
}

fn set_nonblocking(file: &File) -> io::Result<()> {
    let fd = file.as_raw_fd();
    // SAFETY: `fd` belongs to the open file and both fcntl commands use the documented integer
    // argument ABI on Linux/musl and macOS, the two platforms this library is checked on.
    let flags = unsafe { fcntl(fd, F_GETFL) };
    if flags < 0 {
        return Err(io::Error::last_os_error());
    }
    // SAFETY: the descriptor remains owned by `file`; F_SETFL changes only its status flags.
    if unsafe { fcntl(fd, F_SETFL, flags | O_NONBLOCK) } < 0 {
        return Err(io::Error::last_os_error());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use wasm_vm_agent_protocol::{
        FRAME_HEADER_BYTES, NAK_UNKNOWN_TYPE, PROTOCOL_VERSION, TYPE_HELLO, TYPE_NAK, TYPE_PING,
        TYPE_PONG,
    };

    fn encoded(message_type: u16, flags: u16, payload: &[u8]) -> Vec<u8> {
        let mut bytes = vec![0u8; FRAME_HEADER_BYTES + payload.len()];
        let used = encode_frame(message_type, flags, payload, &mut bytes).unwrap();
        bytes.truncate(used);
        bytes
    }

    fn decode(bytes: &[u8]) -> Vec<Frame> {
        let mut decoder = FrameDecoder::new();
        let mut frames = Vec::new();
        assert_eq!(
            decoder.push(bytes, |frame| frames.push(frame)).unwrap(),
            bytes.len()
        );
        assert!(decoder.finish().is_ok());
        frames
    }

    #[test]
    fn hello_ping_and_unknown_frames_have_exact_handlers() {
        let mut agent = AgentSession::new();
        let initial = decode(&agent.drain_output());
        assert_eq!(initial.len(), 1);
        assert_eq!(initial[0].message_type, TYPE_HELLO);
        assert_eq!(
            Hello::from_payload(&initial[0].payload),
            Ok(Hello::new(PROTOCOL_VERSION, CAP_PING))
        );

        let peer_hello = Hello::current(CAP_PING | wasm_vm_agent_protocol::CAP_CLIPBOARD);
        let mut hello_payload = [0u8; Hello::PAYLOAD_BYTES];
        peer_hello.encode_payload(&mut hello_payload).unwrap();
        let mut wire = encoded(TYPE_HELLO, FLAG_NONE, &hello_payload);
        wire.extend(encoded(
            TYPE_PING,
            FLAG_NONE,
            &0x0102_0304_0506_0708u64.to_le_bytes(),
        ));
        wire.extend(encoded(0xbeef, 0x55, &[9, 8, 7]));
        assert_eq!(agent.receive(&wire).unwrap(), wire.len());

        let responses = decode(&agent.drain_output());
        assert_eq!(responses.len(), 3);
        assert_eq!(responses[0].message_type, TYPE_HELLO);
        assert_eq!(
            Hello::from_payload(&responses[0].payload),
            Ok(Hello::new(PROTOCOL_VERSION, CAP_PING))
        );
        assert_eq!(responses[1].message_type, TYPE_PONG);
        assert_eq!(
            Ping::from_payload(&responses[1].payload),
            Ok(Ping::new(0x0102_0304_0506_0708))
        );
        assert_eq!(responses[2].message_type, TYPE_NAK);
        assert_eq!(
            Nak::from_payload(&responses[2].payload),
            Ok(Nak {
                rejected_type: 0xbeef,
                code: NAK_UNKNOWN_TYPE,
            })
        );
        assert_eq!(
            agent.negotiated(),
            Some(Hello::new(PROTOCOL_VERSION, CAP_PING))
        );
    }

    #[test]
    fn dribbled_frames_and_oversized_lengths_stay_bounded() {
        let mut agent = AgentSession::new();
        agent.drain_output();
        let ping = encoded(TYPE_PING, FLAG_NONE, &17u64.to_le_bytes());
        for byte in &ping {
            assert_eq!(agent.receive(std::slice::from_ref(byte)).unwrap(), 1);
        }
        let response = decode(&agent.drain_output());
        assert_eq!(response.len(), 1);
        assert_eq!(response[0].message_type, TYPE_PONG);

        let oversized = [0xff, 0xff, 0xff, 0xff, 0, 0, 0, 0];
        assert!(matches!(
            agent.receive(&oversized),
            Err(SessionError::Decode(DecodeError::PayloadTooLarge {
                length: u32::MAX
            }))
        ));
        assert_eq!(agent.pending_frame_bytes(), 0);
        assert!(agent.pending_output_bytes() <= MAX_QUEUED_OUTPUT_BYTES);
    }

    #[test]
    fn malformed_payload_and_unknown_storm_fail_closed_at_output_bound() {
        let mut agent = AgentSession::new();
        agent.drain_output();
        let malformed_ping = encoded(TYPE_PING, FLAG_NONE, &[1, 2, 3]);
        assert!(matches!(
            agent.receive(&malformed_ping),
            Err(SessionError::Payload(PayloadError::WrongLength {
                expected: Ping::PAYLOAD_BYTES,
                actual: 3
            }))
        ));

        agent.reset();
        agent.drain_output();
        let mut storm = Vec::new();
        for message_type in 0..6_000u16 {
            storm.extend(encoded(message_type.wrapping_add(0x4000), FLAG_NONE, &[]));
        }
        assert!(matches!(
            agent.receive(&storm),
            Err(SessionError::OutputFull { .. })
        ));
        assert!(agent.pending_output_bytes() <= MAX_QUEUED_OUTPUT_BYTES);
    }

    #[test]
    fn reset_terminates_an_inflight_frame_and_backoff_is_bounded() {
        let mut agent = AgentSession::new();
        agent.drain_output();
        let ping = encoded(TYPE_PING, FLAG_NONE, &99u64.to_le_bytes());
        agent.receive(&ping[..3]).unwrap();
        assert_eq!(agent.pending_frame_bytes(), 3);

        agent.reset();
        assert_eq!(agent.pending_frame_bytes(), 0);
        assert_eq!(decode(&agent.drain_output())[0].message_type, TYPE_HELLO);
        agent.receive(&ping[3..]).unwrap();
        assert!(agent.drain_output().is_empty());
        agent.reset();
        agent.drain_output();
        agent.receive(&ping).unwrap();
        assert_eq!(decode(&agent.drain_output())[0].message_type, TYPE_PONG);

        let mut retry = RetryBackoff::new();
        assert_eq!(retry.delay_ms(), 100);
        assert_eq!(retry.record_failure(), 100);
        assert_eq!(retry.record_failure(), 200);
        assert_eq!(retry.record_failure(), 400);
        assert_eq!(retry.record_failure(), 800);
        assert_eq!(retry.record_failure(), 800);
        retry.reset();
        assert_eq!(retry.delay_ms(), 100);
    }
}
