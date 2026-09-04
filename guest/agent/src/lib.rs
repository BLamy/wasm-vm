//! Small, bounded guest peer for the named virtio-console port.
//!
//! The process has one authority: `/dev/virtio-ports/org.wasmvm.agent`.  It does not accept
//! addresses, paths, commands, or environment overrides from callers; its only child commands
//! are the fixed `/usr/bin/wl-paste` and `/usr/bin/wl-copy` helpers. The protocol state machine is
//! kept in this library so native tests can attack it without needing a booted guest; the binary's
//! only runtime loop is the poll-bounded file-descriptor adapter below.

use std::collections::VecDeque;
use std::error::Error;
use std::ffi::c_int;
use std::fs::{File, OpenOptions};
use std::io::{self, ErrorKind, Read, Write};
use std::os::fd::{AsRawFd, RawFd};
use std::path::Path;
use std::process::{Child, ChildStdin, Command, Stdio};
use std::time::{Duration, Instant};

use wasm_vm_agent_protocol::{
    CAP_CLIPBOARD, CAP_PING, ClipboardError, ClipboardGet, ClipboardSet, DecodeError, EncodeError,
    FLAG_NONE, Frame, FrameDecoder, Hello, NAK_CAPABILITY, NAK_CLIPBOARD_UNAVAILABLE,
    NAK_INVALID_PAYLOAD, Nak, NegotiationError, PayloadError, Ping, TYPE_CLIP_GET, TYPE_CLIP_SET,
    TYPE_HELLO, TYPE_NAK, TYPE_PING, TYPE_PONG, encode_frame,
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
/// One bounded clipboard frame plus protocol responses fit in the queue; unknown-message storms
/// still have a hard memory ceiling, and key/UART input never shares this storage.
pub const MAX_QUEUED_OUTPUT_BYTES: usize = wasm_vm_agent_protocol::MAX_CLIPBOARD_BYTES + 64;
/// The guest advertises the protocol capabilities implemented by this binary.
pub const AGENT_CAPABILITIES: u64 = CAP_PING | CAP_CLIPBOARD;
/// The fixed Alpine paths supplied by the wl-clipboard package. There is no command/path override.
pub const WL_PASTE_PATH: &str = "/usr/bin/wl-paste";
pub const WL_COPY_PATH: &str = "/usr/bin/wl-copy";
/// Clipboard polls and child operations are bounded independently of the virtio port poll.
pub const CLIPBOARD_POLL_INTERVAL_MS: u64 = 250;
pub const CLIPBOARD_CHILD_TIMEOUT_MS: u64 = 1_000;

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
    Clipboard(ClipboardError),
    Payload(PayloadError),
    Negotiation(NegotiationError),
    CapabilityUnavailable { capability: u64 },
    OutputFull { needed: usize, available: usize },
    InvalidOutputAdvance { requested: usize, available: usize },
}

/// Failure modes from the fixed Wayland clipboard helper. These are recoverable service errors:
/// the agent keeps the virtio session alive and retries with bounded backoff.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ClipboardBackendError {
    MissingDisplay,
    ChildExited { code: Option<i32> },
    TimedOut,
    InvalidPayload(ClipboardError),
    Io,
}

impl std::fmt::Display for ClipboardBackendError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::MissingDisplay => formatter.write_str("Wayland clipboard helper unavailable"),
            Self::ChildExited { code } => {
                write!(formatter, "Wayland clipboard helper exited ({code:?})")
            }
            Self::TimedOut => formatter.write_str("Wayland clipboard helper timed out"),
            Self::InvalidPayload(error) => write!(
                formatter,
                "Wayland clipboard returned invalid data: {error}"
            ),
            Self::Io => formatter.write_str("Wayland clipboard helper I/O failed"),
        }
    }
}

impl Error for ClipboardBackendError {}

impl std::fmt::Display for SessionError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Decode(error) => write!(formatter, "protocol decode failed: {error}"),
            Self::Encode(error) => write!(formatter, "protocol encode failed: {error}"),
            Self::Clipboard(error) => write!(formatter, "clipboard payload failed: {error}"),
            Self::Payload(error) => write!(formatter, "protocol payload failed: {error}"),
            Self::Negotiation(error) => write!(formatter, "protocol negotiation failed: {error}"),
            Self::CapabilityUnavailable { capability } => {
                write!(
                    formatter,
                    "protocol capability {capability:#x} was not negotiated"
                )
            }
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

impl From<ClipboardError> for SessionError {
    fn from(error: ClipboardError) -> Self {
        Self::Clipboard(error)
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
    clipboard_set: Option<Vec<u8>>,
    clipboard_get: bool,
}

impl SessionState {
    fn new() -> Self {
        Self {
            output: VecDeque::new(),
            output_bytes: 0,
            negotiated: None,
            clipboard_set: None,
            clipboard_get: false,
        }
    }

    fn clear(&mut self) {
        self.output.clear();
        self.output_bytes = 0;
        self.negotiated = None;
        self.clipboard_set = None;
        self.clipboard_get = false;
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

    pub fn clipboard_negotiated(&self) -> bool {
        self.state
            .negotiated
            .is_some_and(|hello| hello.capabilities & CAP_CLIPBOARD != 0)
    }

    /// Take the newest validated host clipboard value. Only one value is retained so a peer
    /// cannot build an unbounded clipboard queue while the desktop helper is unavailable.
    pub fn take_clipboard_set(&mut self) -> Option<Vec<u8>> {
        self.state.clipboard_set.take()
    }

    /// Take one host request for the current guest clipboard. Repeated requests coalesce.
    pub fn take_clipboard_get(&mut self) -> bool {
        let requested = self.state.clipboard_get;
        self.state.clipboard_get = false;
        requested
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

    /// Queue one validated guest clipboard value on the agent port. The separate output queue is
    /// deliberately not the keyboard/UART input path, so clipboard pressure cannot drop keys.
    pub fn queue_clipboard_set(&mut self, text: &[u8]) -> Result<(), SessionError> {
        if !self.clipboard_negotiated() {
            return Err(SessionError::CapabilityUnavailable {
                capability: CAP_CLIPBOARD,
            });
        }
        let clipboard = ClipboardSet::new(text)?;
        let mut payload = vec![0u8; text.len()];
        let used = clipboard.encode_payload(&mut payload)?;
        debug_assert_eq!(used, payload.len());
        self.queue_message(TYPE_CLIP_SET, FLAG_NONE, &payload)
    }

    pub fn queue_clipboard_nak(&mut self, message_type: u16) -> Result<(), SessionError> {
        queue_nak(&mut self.state, message_type, NAK_CLIPBOARD_UNAVAILABLE)
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
        TYPE_CLIP_SET => {
            if !clipboard_capability_negotiated(state) {
                return queue_nak(state, TYPE_CLIP_SET, NAK_CAPABILITY);
            }
            match ClipboardSet::from_payload(&frame.payload) {
                Ok(clipboard) => {
                    // Keep only the newest value. The bridge drains this slot synchronously and
                    // applies it through wl-copy, so a flood cannot consume an unbounded queue.
                    state.clipboard_set = Some(clipboard.into_bytes());
                    Ok(())
                }
                Err(ClipboardError::TooLarge { .. } | ClipboardError::InvalidUtf8) => {
                    queue_nak(state, TYPE_CLIP_SET, NAK_INVALID_PAYLOAD)
                }
            }
        }
        TYPE_CLIP_GET => {
            if !clipboard_capability_negotiated(state) {
                return queue_nak(state, TYPE_CLIP_GET, NAK_CAPABILITY);
            }
            if ClipboardGet::from_payload(&frame.payload).is_err() {
                return queue_nak(state, TYPE_CLIP_GET, NAK_INVALID_PAYLOAD);
            }
            state.clipboard_get = true;
            Ok(())
        }
        message_type => queue_nak(
            state,
            message_type,
            wasm_vm_agent_protocol::NAK_UNKNOWN_TYPE,
        ),
    }
}

fn clipboard_capability_negotiated(state: &SessionState) -> bool {
    state
        .negotiated
        .is_some_and(|hello| hello.capabilities & CAP_CLIPBOARD != 0)
}

fn queue_nak(state: &mut SessionState, rejected_type: u16, code: u16) -> Result<(), SessionError> {
    let nak = Nak {
        rejected_type,
        code,
    };
    let mut payload = [0u8; Nak::PAYLOAD_BYTES];
    nak.encode_payload(&mut payload)?;
    queue_message(state, TYPE_NAK, FLAG_NONE, &payload)
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

/// A guest clipboard backend has no access to the UART or keyboard queues. The production
/// implementation below is intentionally tiny so the bridge can be tested with a deterministic
/// fake without running a Wayland compositor.
pub trait ClipboardBackend {
    fn read_text(&mut self) -> Result<Vec<u8>, ClipboardBackendError>;
    fn write_text(&mut self, text: &[u8]) -> Result<(), ClipboardBackendError>;

    fn maintain(&mut self) -> Result<(), ClipboardBackendError> {
        Ok(())
    }
}

/// Fixed-path wl-clipboard adapter used by the Alpine guest. Missing binaries, missing display
/// variables, non-zero helper exits, and timeouts all become recoverable backend errors; no shell
/// command or caller-controlled path is accepted.
pub struct WlClipboardBackend {
    owner: Option<Child>,
}

impl WlClipboardBackend {
    pub const fn new() -> Self {
        Self { owner: None }
    }

    fn stop_owner(&mut self) {
        if let Some(mut child) = self.owner.take() {
            terminate_child(&mut child);
        }
    }
}

impl Default for WlClipboardBackend {
    fn default() -> Self {
        Self::new()
    }
}

impl Drop for WlClipboardBackend {
    fn drop(&mut self) {
        self.stop_owner();
    }
}

impl ClipboardBackend for WlClipboardBackend {
    fn read_text(&mut self) -> Result<Vec<u8>, ClipboardBackendError> {
        self.maintain()?;
        let mut command = Command::new(WL_PASTE_PATH);
        command
            .args(["--no-newline", "--type", "text/plain"])
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::null());
        let child = command
            .spawn()
            .map_err(|_| ClipboardBackendError::MissingDisplay)?;
        let output = capture_child(child)?;
        validate_backend_text(output)
    }

    fn write_text(&mut self, text: &[u8]) -> Result<(), ClipboardBackendError> {
        let clipboard = ClipboardSet::new(text).map_err(ClipboardBackendError::InvalidPayload)?;
        self.stop_owner();

        let mut command = Command::new(WL_COPY_PATH);
        command
            .args(["--type", "text/plain"])
            .stdin(Stdio::piped())
            .stdout(Stdio::null())
            .stderr(Stdio::null());
        let mut child = command
            .spawn()
            .map_err(|_| ClipboardBackendError::MissingDisplay)?;
        let Some(stdin) = child.stdin.take() else {
            terminate_child(&mut child);
            return Err(ClipboardBackendError::Io);
        };
        if let Err(error) = write_child_input(stdin, clipboard.as_bytes()) {
            terminate_child(&mut child);
            return Err(error);
        }

        match child.try_wait() {
            Ok(Some(status)) if status.success() => Ok(()),
            Ok(Some(status)) => Err(ClipboardBackendError::ChildExited {
                code: status.code(),
            }),
            Ok(None) => {
                // wl-copy normally stays alive while it owns the selection. Holding exactly one
                // child prevents a copy storm from piling up helper processes.
                self.owner = Some(child);
                Ok(())
            }
            Err(_) => {
                terminate_child(&mut child);
                Err(ClipboardBackendError::Io)
            }
        }
    }

    fn maintain(&mut self) -> Result<(), ClipboardBackendError> {
        let Some(mut child) = self.owner.take() else {
            return Ok(());
        };
        match child.try_wait() {
            Ok(Some(status)) if status.success() => Ok(()),
            Ok(Some(status)) => Err(ClipboardBackendError::ChildExited {
                code: status.code(),
            }),
            Ok(None) => {
                self.owner = Some(child);
                Ok(())
            }
            Err(_) => {
                terminate_child(&mut child);
                Err(ClipboardBackendError::Io)
            }
        }
    }
}

fn validate_backend_text(text: Vec<u8>) -> Result<Vec<u8>, ClipboardBackendError> {
    if text.len() > wasm_vm_agent_protocol::MAX_CLIPBOARD_BYTES {
        return Err(ClipboardBackendError::InvalidPayload(
            ClipboardError::TooLarge { length: text.len() },
        ));
    }
    if core::str::from_utf8(&text).is_err() {
        return Err(ClipboardBackendError::InvalidPayload(
            ClipboardError::InvalidUtf8,
        ));
    }
    Ok(text)
}

fn terminate_child(child: &mut Child) {
    let _ = child.kill();
    let _ = child.wait();
}

fn write_child_input(mut stdin: ChildStdin, text: &[u8]) -> Result<(), ClipboardBackendError> {
    set_nonblocking_fd(stdin.as_raw_fd()).map_err(|_| ClipboardBackendError::Io)?;
    let deadline = Instant::now() + Duration::from_millis(CLIPBOARD_CHILD_TIMEOUT_MS);
    let mut offset = 0;
    while offset < text.len() {
        match stdin.write(&text[offset..]) {
            Ok(0) => return Err(ClipboardBackendError::Io),
            Ok(count) => offset += count,
            Err(error) if error.kind() == ErrorKind::Interrupted => continue,
            Err(error) if error.kind() == ErrorKind::WouldBlock => {
                let timeout = remaining_timeout_ms(deadline);
                if timeout == 0 {
                    return Err(ClipboardBackendError::TimedOut);
                }
                let revents = poll_one_timeout(stdin.as_raw_fd(), POLLOUT, timeout)
                    .map_err(|_| ClipboardBackendError::Io)?;
                if revents & (POLLERR | POLLHUP | POLLNVAL) != 0 {
                    return Err(ClipboardBackendError::Io);
                }
            }
            Err(_) => return Err(ClipboardBackendError::Io),
        }
    }
    Ok(())
}

fn capture_child(mut child: Child) -> Result<Vec<u8>, ClipboardBackendError> {
    let Some(mut stdout) = child.stdout.take() else {
        terminate_child(&mut child);
        return Err(ClipboardBackendError::Io);
    };
    if set_nonblocking_fd(stdout.as_raw_fd()).is_err() {
        terminate_child(&mut child);
        return Err(ClipboardBackendError::Io);
    }
    let fd = stdout.as_raw_fd();
    let deadline = Instant::now() + Duration::from_millis(CLIPBOARD_CHILD_TIMEOUT_MS);
    let mut output = Vec::new();
    let mut stdout_closed = false;
    let mut status = None;

    loop {
        let mut chunk = [0u8; READ_BUFFER_BYTES];
        match stdout.read(&mut chunk) {
            Ok(0) => stdout_closed = true,
            Ok(count) => {
                let length = output.len().saturating_add(count);
                if length > wasm_vm_agent_protocol::MAX_CLIPBOARD_BYTES {
                    terminate_child(&mut child);
                    return Err(ClipboardBackendError::InvalidPayload(
                        ClipboardError::TooLarge { length },
                    ));
                }
                output.extend_from_slice(&chunk[..count]);
            }
            Err(error) if error.kind() == ErrorKind::Interrupted => continue,
            Err(error) if error.kind() == ErrorKind::WouldBlock => {}
            Err(_) => {
                terminate_child(&mut child);
                return Err(ClipboardBackendError::Io);
            }
        }

        if status.is_none() {
            status = match child.try_wait() {
                Ok(status) => status,
                Err(_) => {
                    terminate_child(&mut child);
                    return Err(ClipboardBackendError::Io);
                }
            };
        }
        if status.is_some() && stdout_closed {
            break;
        }

        let timeout = remaining_timeout_ms(deadline);
        if timeout == 0 {
            terminate_child(&mut child);
            return Err(ClipboardBackendError::TimedOut);
        }
        if stdout_closed {
            std::thread::sleep(Duration::from_millis(timeout.min(10) as u64));
        } else {
            if poll_one_timeout(fd, POLLIN, timeout).is_err() {
                terminate_child(&mut child);
                return Err(ClipboardBackendError::Io);
            }
        }
    }

    let status = status.expect("child status is set before stdout closes");
    if !status.success() {
        return Err(ClipboardBackendError::ChildExited {
            code: status.code(),
        });
    }
    Ok(output)
}

fn remaining_timeout_ms(deadline: Instant) -> i32 {
    let millis = deadline
        .saturating_duration_since(Instant::now())
        .as_millis();
    millis.min(i32::MAX as u128) as i32
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ClipboardBridgeStatus {
    Starting,
    Ready,
    Unavailable { retry_at_ms: u64 },
}

/// Coordinates guest polling, host-to-guest application, and protocol responses. Every pending
/// clipboard value is bounded and coalesced; backend faults never tear down the verified agent
/// session and retry no slower than the existing 800 ms backoff.
pub struct ClipboardBridge<B: ClipboardBackend> {
    backend: B,
    backoff: RetryBackoff,
    retry_at_ms: u64,
    next_poll_at_ms: u64,
    status: ClipboardBridgeStatus,
    baseline_set: bool,
    last_observed: Option<Vec<u8>>,
    pending_guest_set: Option<Vec<u8>>,
    pending_apply: Option<Vec<u8>>,
    pending_get: bool,
    pending_get_value: Option<Vec<u8>>,
    last_error: Option<ClipboardBackendError>,
    apply_failure_reported: bool,
    get_failure_reported: bool,
}

impl<B: ClipboardBackend> ClipboardBridge<B> {
    pub fn new(backend: B) -> Self {
        Self {
            backend,
            backoff: RetryBackoff::new(),
            retry_at_ms: 0,
            next_poll_at_ms: 0,
            status: ClipboardBridgeStatus::Starting,
            baseline_set: false,
            last_observed: None,
            pending_guest_set: None,
            pending_apply: None,
            pending_get: false,
            pending_get_value: None,
            last_error: None,
            apply_failure_reported: false,
            get_failure_reported: false,
        }
    }

    pub fn status(&self) -> ClipboardBridgeStatus {
        self.status
    }

    pub fn last_error(&self) -> Option<ClipboardBackendError> {
        self.last_error
    }

    pub fn pending_clipboard_bytes(&self) -> usize {
        self.pending_guest_set
            .as_ref()
            .map_or(0, Vec::len)
            .saturating_add(self.pending_apply.as_ref().map_or(0, Vec::len))
            .saturating_add(self.pending_get_value.as_ref().map_or(0, Vec::len))
    }

    pub fn into_backend(self) -> B {
        self.backend
    }

    /// Return the next bounded wakeup so a quiet virtio port does not delay clipboard detection
    /// until the full one-second port poll expires.
    pub fn poll_timeout_ms(&self, now_ms: u64) -> i32 {
        let wake_at = if now_ms < self.retry_at_ms {
            self.retry_at_ms
        } else {
            self.next_poll_at_ms
        };
        wake_at.saturating_sub(now_ms).min(POLL_TIMEOUT_MS as u64) as i32
    }

    /// Service protocol-delivered clipboard work and poll the guest desktop at most once per
    /// interval. Backend failures are intentionally consumed into `Unavailable` status.
    pub fn tick(&mut self, now_ms: u64, session: &mut AgentSession) {
        if let Some(value) = session.take_clipboard_set() {
            self.pending_apply = Some(value);
            self.apply_failure_reported = false;
        }
        if session.take_clipboard_get() {
            self.pending_get = true;
            self.get_failure_reported = false;
        }
        if !session.clipboard_negotiated() || now_ms < self.retry_at_ms {
            return;
        }

        if let Err(error) = self.backend.maintain() {
            self.mark_unavailable_for(now_ms, error);
            self.report_unavailable(session, TYPE_CLIP_SET, self.pending_apply.is_some());
            self.report_unavailable(
                session,
                TYPE_CLIP_GET,
                self.pending_get || self.pending_get_value.is_some(),
            );
            return;
        }

        if let Some(value) = self.pending_apply.take() {
            if let Err(error) = self.backend.write_text(&value) {
                self.pending_apply = Some(value);
                self.mark_unavailable_for(now_ms, error);
                self.report_unavailable(session, TYPE_CLIP_SET, true);
                return;
            }
            self.mark_ready(now_ms);
            self.apply_failure_reported = false;
        }

        if self.pending_get_value.is_none() && self.pending_get {
            match self.read_backend_text() {
                Ok(value) => {
                    self.pending_get = false;
                    self.pending_get_value = Some(value);
                    self.next_poll_at_ms = now_ms.saturating_add(CLIPBOARD_POLL_INTERVAL_MS);
                    self.mark_ready(now_ms);
                }
                Err(error) => {
                    self.mark_unavailable_for(now_ms, error);
                    self.report_unavailable(session, TYPE_CLIP_GET, true);
                    return;
                }
            }
        }

        if let Some(value) = self.pending_get_value.take() {
            match session.queue_clipboard_set(&value) {
                Ok(()) => {}
                Err(SessionError::OutputFull { .. }) => self.pending_get_value = Some(value),
                Err(SessionError::CapabilityUnavailable { .. }) => {}
                Err(_) => self.pending_get_value = Some(value),
            }
        }

        if let Some(value) = self.pending_guest_set.take() {
            match session.queue_clipboard_set(&value) {
                Ok(()) | Err(SessionError::CapabilityUnavailable { .. }) => {}
                Err(SessionError::OutputFull { .. }) | Err(_) => {
                    self.pending_guest_set = Some(value)
                }
            }
        }

        if now_ms < self.next_poll_at_ms {
            return;
        }
        match self.read_backend_text() {
            Ok(value) => {
                self.next_poll_at_ms = now_ms.saturating_add(CLIPBOARD_POLL_INTERVAL_MS);
                self.mark_ready(now_ms);
                if !self.baseline_set {
                    self.baseline_set = true;
                    self.last_observed = Some(value);
                } else if self.last_observed.as_deref() != Some(value.as_slice()) {
                    self.last_observed = Some(value.clone());
                    self.pending_guest_set = Some(value);
                }
            }
            Err(error) => self.mark_unavailable_for(now_ms, error),
        }
    }

    fn mark_ready(&mut self, now_ms: u64) {
        self.backoff.reset();
        self.retry_at_ms = now_ms;
        self.last_error = None;
        self.status = ClipboardBridgeStatus::Ready;
    }

    fn mark_unavailable_for(&mut self, now_ms: u64, error: ClipboardBackendError) {
        let delay = self.backoff.record_failure();
        self.retry_at_ms = now_ms.saturating_add(delay);
        self.next_poll_at_ms = self.retry_at_ms;
        self.last_error = Some(error);
        self.status = ClipboardBridgeStatus::Unavailable {
            retry_at_ms: self.retry_at_ms,
        };
    }

    fn report_unavailable(&mut self, session: &mut AgentSession, message_type: u16, pending: bool) {
        if !pending {
            return;
        }
        let reported = if message_type == TYPE_CLIP_SET {
            &mut self.apply_failure_reported
        } else {
            &mut self.get_failure_reported
        };
        if !*reported && session.queue_clipboard_nak(message_type).is_ok() {
            *reported = true;
        }
    }

    fn read_backend_text(&mut self) -> Result<Vec<u8>, ClipboardBackendError> {
        validate_backend_text(self.backend.read_text()?)
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
    let mut clipboard = ClipboardBridge::new(WlClipboardBackend::new());
    let started = Instant::now();
    let mut read_buffer = [0u8; READ_BUFFER_BYTES];

    loop {
        let events = POLLIN | if session.has_output() { POLLOUT } else { 0 };
        let now_ms = started.elapsed().as_millis().min(u64::MAX as u128) as u64;
        let revents =
            poll_one_timeout(port.as_raw_fd(), events, clipboard.poll_timeout_ms(now_ms))?;
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

        let now_ms = started.elapsed().as_millis().min(u64::MAX as u128) as u64;
        clipboard.tick(now_ms, &mut session);

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

fn poll_one_timeout(fd: RawFd, events: i16, timeout: i32) -> io::Result<i16> {
    let mut descriptor = PollFd {
        fd,
        events,
        revents: 0,
    };
    loop {
        // SAFETY: `descriptor` is a valid one-element poll array for the duration of the call;
        // the kernel writes only its revents field and the timeout is finite.
        let result = unsafe { poll(&mut descriptor, 1, timeout) };
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
    set_nonblocking_fd(file.as_raw_fd())
}

fn set_nonblocking_fd(fd: RawFd) -> io::Result<()> {
    // SAFETY: `fd` belongs to the open file or child pipe and both fcntl commands use the
    // documented integer argument ABI on Linux/musl and macOS, the two platforms this library is
    // checked on.
    let flags = unsafe { fcntl(fd, F_GETFL) };
    if flags < 0 {
        return Err(io::Error::last_os_error());
    }
    // SAFETY: the descriptor remains owned by its caller; F_SETFL changes only its status flags.
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

    struct FakeClipboardBackend {
        current: Vec<u8>,
        reads: VecDeque<Result<Vec<u8>, ClipboardBackendError>>,
        writes: VecDeque<Result<(), ClipboardBackendError>>,
        maintains: VecDeque<Result<(), ClipboardBackendError>>,
        written: Vec<Vec<u8>>,
    }

    impl FakeClipboardBackend {
        fn with_reads(
            reads: impl IntoIterator<Item = Result<Vec<u8>, ClipboardBackendError>>,
        ) -> Self {
            Self {
                current: Vec::new(),
                reads: reads.into_iter().collect(),
                writes: VecDeque::new(),
                maintains: VecDeque::new(),
                written: Vec::new(),
            }
        }
    }

    impl ClipboardBackend for FakeClipboardBackend {
        fn read_text(&mut self) -> Result<Vec<u8>, ClipboardBackendError> {
            let value = self
                .reads
                .pop_front()
                .unwrap_or_else(|| Ok(self.current.clone()))?;
            self.current = value.clone();
            Ok(value)
        }

        fn write_text(&mut self, text: &[u8]) -> Result<(), ClipboardBackendError> {
            if let Some(result) = self.writes.pop_front() {
                result?;
            }
            self.current = text.to_vec();
            self.written.push(self.current.clone());
            Ok(())
        }

        fn maintain(&mut self) -> Result<(), ClipboardBackendError> {
            self.maintains.pop_front().unwrap_or(Ok(()))
        }
    }

    fn ready_clipboard_agent(peer_capabilities: u64) -> AgentSession {
        let mut agent = AgentSession::new();
        agent.drain_output();
        let hello = Hello::current(peer_capabilities);
        let mut payload = [0u8; Hello::PAYLOAD_BYTES];
        hello.encode_payload(&mut payload).unwrap();
        agent
            .receive(&encoded(TYPE_HELLO, FLAG_NONE, &payload))
            .unwrap();
        agent.drain_output();
        agent
    }

    #[test]
    fn clipboard_bridge_emits_changes_applies_host_values_and_answers_get() {
        let initial = b"initial".to_vec();
        let changed = "abc\r\n🦀".as_bytes().to_vec();
        let mut backend = FakeClipboardBackend::with_reads([
            Ok(initial),
            Ok(changed.clone()),
            Ok(changed.clone()),
        ]);
        let mut agent = ready_clipboard_agent(CAP_PING | CAP_CLIPBOARD);
        let mut bridge = ClipboardBridge::new(backend);

        bridge.tick(0, &mut agent);
        assert_eq!(bridge.status(), ClipboardBridgeStatus::Ready);
        bridge.tick(CLIPBOARD_POLL_INTERVAL_MS, &mut agent);
        assert!(agent.drain_output().is_empty());
        bridge.tick(CLIPBOARD_POLL_INTERVAL_MS * 2, &mut agent);
        let emitted = decode(&agent.drain_output());
        assert_eq!(emitted.len(), 1);
        assert_eq!(emitted[0].message_type, TYPE_CLIP_SET);
        assert_eq!(emitted[0].payload, changed);

        let host_value = vec![b'z'; wasm_vm_agent_protocol::MAX_CLIPBOARD_BYTES];
        let host_frame = encoded(TYPE_CLIP_SET, FLAG_NONE, &host_value);
        agent.receive(&host_frame).unwrap();
        bridge.tick(CLIPBOARD_POLL_INTERVAL_MS * 3, &mut agent);
        backend = bridge.into_backend();
        assert_eq!(backend.written, vec![host_value]);

        let backend = FakeClipboardBackend::with_reads([Ok(b"from-guest".to_vec())]);
        let mut agent = ready_clipboard_agent(CAP_PING | CAP_CLIPBOARD);
        let mut bridge = ClipboardBridge::new(backend);
        agent
            .receive(&encoded(TYPE_CLIP_GET, FLAG_NONE, &[]))
            .unwrap();
        bridge.tick(0, &mut agent);
        let response = decode(&agent.drain_output());
        assert_eq!(response.len(), 1);
        assert_eq!(response[0].message_type, TYPE_CLIP_SET);
        assert_eq!(response[0].payload, b"from-guest");
    }

    #[test]
    fn clipboard_bridge_retries_missing_display_and_child_death_with_bounded_state() {
        let mut backend = FakeClipboardBackend::with_reads([
            Err(ClipboardBackendError::MissingDisplay),
            Err(ClipboardBackendError::ChildExited { code: Some(7) }),
            Ok(b"recovered".to_vec()),
        ]);
        backend
            .maintains
            .push_back(Err(ClipboardBackendError::ChildExited { code: None }));
        let mut agent = ready_clipboard_agent(CAP_PING | CAP_CLIPBOARD);
        let mut bridge = ClipboardBridge::new(backend);

        bridge.tick(0, &mut agent);
        assert_eq!(
            bridge.status(),
            ClipboardBridgeStatus::Unavailable { retry_at_ms: 100 }
        );
        assert_eq!(
            bridge.last_error(),
            Some(ClipboardBackendError::ChildExited { code: None })
        );
        assert_eq!(bridge.pending_clipboard_bytes(), 0);
        assert_eq!(bridge.poll_timeout_ms(99), 1);

        bridge.tick(99, &mut agent);
        assert_eq!(
            bridge.last_error(),
            Some(ClipboardBackendError::ChildExited { code: None })
        );
        bridge.tick(100, &mut agent);
        assert_eq!(
            bridge.status(),
            ClipboardBridgeStatus::Unavailable { retry_at_ms: 300 }
        );
        assert_eq!(
            bridge.last_error(),
            Some(ClipboardBackendError::MissingDisplay)
        );

        bridge.tick(299, &mut agent);
        bridge.tick(300, &mut agent);
        assert_eq!(
            bridge.status(),
            ClipboardBridgeStatus::Unavailable { retry_at_ms: 700 }
        );
        assert_eq!(
            bridge.last_error(),
            Some(ClipboardBackendError::ChildExited { code: Some(7) })
        );
        bridge.tick(700, &mut agent);
        assert_eq!(bridge.status(), ClipboardBridgeStatus::Ready);
        assert_eq!(bridge.last_error(), None);
        assert!(bridge.poll_timeout_ms(700) <= CLIPBOARD_POLL_INTERVAL_MS as i32);
        assert!(
            bridge.pending_clipboard_bytes() <= 3 * wasm_vm_agent_protocol::MAX_CLIPBOARD_BYTES
        );
    }

    #[test]
    fn clipboard_bridge_retains_host_set_across_helper_failures_and_reports_fallback() {
        let host_value = "host\r\n🦀".as_bytes().to_vec();
        let mut backend = FakeClipboardBackend::with_reads([Ok(Vec::new())]);
        backend.writes.extend([
            Err(ClipboardBackendError::MissingDisplay),
            Err(ClipboardBackendError::ChildExited { code: Some(9) }),
            Ok(()),
        ]);
        let mut agent = ready_clipboard_agent(CAP_PING | CAP_CLIPBOARD);
        agent
            .receive(&encoded(TYPE_CLIP_SET, FLAG_NONE, &host_value))
            .unwrap();
        let mut bridge = ClipboardBridge::new(backend);

        bridge.tick(0, &mut agent);
        assert_eq!(bridge.pending_clipboard_bytes(), host_value.len());
        assert_eq!(
            bridge.last_error(),
            Some(ClipboardBackendError::MissingDisplay)
        );
        let fallback = decode(&agent.drain_output());
        assert_eq!(fallback.len(), 1);
        assert_eq!(fallback[0].message_type, TYPE_NAK);
        assert_eq!(
            Nak::from_payload(&fallback[0].payload).unwrap().code,
            NAK_CLIPBOARD_UNAVAILABLE
        );

        bridge.tick(100, &mut agent);
        assert_eq!(
            bridge.last_error(),
            Some(ClipboardBackendError::ChildExited { code: Some(9) })
        );
        assert!(
            agent.drain_output().is_empty(),
            "fallback is reported once per value"
        );
        bridge.tick(300, &mut agent);
        assert_eq!(bridge.status(), ClipboardBridgeStatus::Ready);
        let backend = bridge.into_backend();
        assert_eq!(backend.written, vec![host_value]);
    }

    #[test]
    fn clipboard_payload_errors_are_naked_without_touching_the_serial_session() {
        let mut agent = ready_clipboard_agent(CAP_PING | CAP_CLIPBOARD);
        let invalid = encoded(TYPE_CLIP_SET, FLAG_NONE, &[0xff]);
        agent.receive(&invalid).unwrap();
        let oversized = encoded(
            TYPE_CLIP_SET,
            FLAG_NONE,
            &vec![b'a'; wasm_vm_agent_protocol::MAX_CLIPBOARD_BYTES + 1],
        );
        agent.receive(&oversized).unwrap();
        agent
            .receive(&encoded(TYPE_CLIP_GET, FLAG_NONE, &[1]))
            .unwrap();
        let responses = decode(&agent.drain_output());
        assert_eq!(responses.len(), 3);
        for (response, expected_type) in
            responses
                .iter()
                .zip([TYPE_CLIP_SET, TYPE_CLIP_SET, TYPE_CLIP_GET])
        {
            assert_eq!(response.message_type, TYPE_NAK);
            assert_eq!(
                Nak::from_payload(&response.payload).unwrap().rejected_type,
                expected_type
            );
            assert_eq!(
                Nak::from_payload(&response.payload).unwrap().code,
                NAK_INVALID_PAYLOAD
            );
        }
        assert!(agent.take_clipboard_set().is_none());
        assert!(!agent.take_clipboard_get());

        let mut legacy = ready_clipboard_agent(CAP_PING);
        legacy
            .receive(&encoded(TYPE_CLIP_SET, FLAG_NONE, b"not negotiated"))
            .unwrap();
        let response = decode(&legacy.drain_output());
        assert_eq!(response.len(), 1);
        assert_eq!(
            Nak::from_payload(&response[0].payload).unwrap().code,
            NAK_CAPABILITY
        );
    }

    #[test]
    fn wayland_backend_contract_is_fixed_and_validates_helper_output() {
        assert_eq!(WL_PASTE_PATH, "/usr/bin/wl-paste");
        assert_eq!(WL_COPY_PATH, "/usr/bin/wl-copy");
        assert_eq!(
            validate_backend_text("abc\r\n🦀".as_bytes().to_vec()),
            Ok("abc\r\n🦀".as_bytes().to_vec())
        );
        assert_eq!(
            validate_backend_text(vec![0xff]),
            Err(ClipboardBackendError::InvalidPayload(
                ClipboardError::InvalidUtf8
            ))
        );
        assert_eq!(
            validate_backend_text(vec![b'a'; wasm_vm_agent_protocol::MAX_CLIPBOARD_BYTES + 1]),
            Err(ClipboardBackendError::InvalidPayload(
                ClipboardError::TooLarge {
                    length: wasm_vm_agent_protocol::MAX_CLIPBOARD_BYTES + 1
                }
            ))
        );
    }

    #[test]
    fn helper_children_are_reaped_and_io_is_bounded_without_a_shell() {
        let mut command = Command::new("/usr/bin/printf");
        command
            .arg("%s")
            .arg("abc\r\n🦀")
            .stdout(Stdio::piped())
            .stderr(Stdio::null());
        let output = capture_child(command.spawn().unwrap()).unwrap();
        assert_eq!(
            validate_backend_text(output).unwrap(),
            "abc\r\n🦀".as_bytes()
        );

        let mut command = Command::new("/usr/bin/false");
        command.stdout(Stdio::piped()).stderr(Stdio::null());
        assert_eq!(
            capture_child(command.spawn().unwrap()),
            Err(ClipboardBackendError::ChildExited { code: Some(1) })
        );

        let mut command = Command::new("/usr/bin/yes");
        command.stdout(Stdio::piped()).stderr(Stdio::null());
        assert!(matches!(
            capture_child(command.spawn().unwrap()),
            Err(ClipboardBackendError::InvalidPayload(
                ClipboardError::TooLarge { .. }
            ))
        ));
    }

    #[test]
    fn helper_input_closes_cleanly_after_a_bounded_write() {
        let mut command = Command::new("/bin/cat");
        command
            .stdin(Stdio::piped())
            .stdout(Stdio::null())
            .stderr(Stdio::null());
        let mut child = command.spawn().unwrap();
        let stdin = child.stdin.take().unwrap();
        write_child_input(
            stdin,
            &vec![b'z'; wasm_vm_agent_protocol::MAX_CLIPBOARD_BYTES],
        )
        .unwrap();
        assert!(child.wait().unwrap().success());
    }

    #[test]
    fn hello_ping_and_unknown_frames_have_exact_handlers() {
        let mut agent = AgentSession::new();
        let initial = decode(&agent.drain_output());
        assert_eq!(initial.len(), 1);
        assert_eq!(initial[0].message_type, TYPE_HELLO);
        assert_eq!(
            Hello::from_payload(&initial[0].payload),
            Ok(Hello::new(
                PROTOCOL_VERSION,
                CAP_PING | wasm_vm_agent_protocol::CAP_CLIPBOARD
            ))
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
            Ok(Hello::new(
                PROTOCOL_VERSION,
                CAP_PING | wasm_vm_agent_protocol::CAP_CLIPBOARD,
            ))
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
            Some(Hello::new(
                PROTOCOL_VERSION,
                CAP_PING | wasm_vm_agent_protocol::CAP_CLIPBOARD,
            ))
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
        for message_type in 0..30_000u16 {
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

    #[test]
    fn poll_adapter_closes_an_empty_port_without_blocking() {
        let path =
            std::env::temp_dir().join(format!("wasmvm-agent-empty-port-{}", std::process::id()));
        let _ = std::fs::remove_file(&path);
        File::create(&path).unwrap();

        let started = std::time::Instant::now();
        let result = run_connection(&path);
        let _ = std::fs::remove_file(&path);

        assert!(matches!(result, Err(ConnectionError::Disconnected)));
        assert!(started.elapsed() < Duration::from_secs(1));
    }

    #[test]
    fn flush_adapter_retires_the_initial_hello_on_a_writable_port() {
        let path =
            std::env::temp_dir().join(format!("wasmvm-agent-writable-port-{}", std::process::id()));
        let _ = std::fs::remove_file(&path);
        File::create(&path).unwrap();
        let mut port = OpenOptions::new()
            .read(true)
            .write(true)
            .open(&path)
            .unwrap();
        let mut agent = AgentSession::new();

        flush_output(&mut port, &mut agent).unwrap();
        let _ = std::fs::remove_file(&path);

        assert!(!agent.has_output());
        assert_eq!(agent.pending_output_bytes(), 0);
    }

    #[test]
    fn malformed_port_input_terminates_the_connection() {
        let path = std::env::temp_dir().join(format!(
            "wasmvm-agent-malformed-port-{}",
            std::process::id()
        ));
        let _ = std::fs::remove_file(&path);
        std::fs::write(&path, [0xff; FRAME_HEADER_BYTES]).unwrap();

        let result = run_connection(&path);
        let _ = std::fs::remove_file(&path);

        assert!(matches!(result, Err(ConnectionError::Protocol)));
    }
}
