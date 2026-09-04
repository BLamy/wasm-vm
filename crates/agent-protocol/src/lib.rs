#![no_std]

//! The shared wire contract for the wasm-vm guest agent channel.
//!
//! A stream contains little-endian frames with an eight-byte header:
//!
//! ```text
//! u32 payload_len | u16 message_type | u16 flags | payload[payload_len]
//! ```
//!
//! `payload_len` is payload bytes, not including the header.  A payload is limited to 1 MiB, so a
//! complete wire frame is at most `MAX_FRAME_BYTES` bytes.  A malformed or oversized header is a
//! connection-fatal protocol error; callers should discard the stream and reconnect instead of
//! guessing at a byte-level resynchronization point.  A valid but unknown message type is not a
//! decoder error: the endpoint can return a [`NAK_UNKNOWN_TYPE`] frame and keep the connection.

extern crate alloc;

use alloc::vec::Vec;
use core::fmt;

pub const FRAME_HEADER_BYTES: usize = 8;
pub const MAX_PAYLOAD_BYTES: usize = 1 << 20;
pub const MAX_CLIPBOARD_BYTES: usize = 256 << 10;
pub const MAX_FRAME_BYTES: usize = FRAME_HEADER_BYTES + MAX_PAYLOAD_BYTES;
pub const PROTOCOL_VERSION: u16 = 1;

pub const TYPE_HELLO: u16 = 0;
pub const TYPE_PING: u16 = 1;
pub const TYPE_PONG: u16 = 2;
pub const TYPE_NAK: u16 = 3;
pub const TYPE_CLIP_SET: u16 = 4;
pub const TYPE_CLIP_GET: u16 = 5;

pub const FLAG_NONE: u16 = 0;
pub const NAK_UNKNOWN_TYPE: u16 = 1;

pub const CAP_PING: u64 = 1 << 0;
pub const CAP_CLIPBOARD: u64 = 1 << 1;
pub const CAP_DISPLAY: u64 = 1 << 2;

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Frame {
    pub message_type: u16,
    pub flags: u16,
    pub payload: Vec<u8>,
}

impl Frame {
    pub fn new(message_type: u16, flags: u16, payload: &[u8]) -> Result<Self, EncodeError> {
        if payload.len() > MAX_PAYLOAD_BYTES {
            return Err(EncodeError::PayloadTooLarge {
                length: payload.len(),
            });
        }
        Ok(Self {
            message_type,
            flags,
            payload: payload.to_vec(),
        })
    }

    pub fn encoded_len(&self) -> usize {
        FRAME_HEADER_BYTES + self.payload.len()
    }

    pub fn encode_into(&self, output: &mut [u8]) -> Result<usize, EncodeError> {
        encode_frame(self.message_type, self.flags, &self.payload, output)
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct Hello {
    pub version: u16,
    pub capabilities: u64,
}

impl Hello {
    pub const PAYLOAD_BYTES: usize = 2 + 8;

    pub const fn new(version: u16, capabilities: u64) -> Self {
        Self {
            version,
            capabilities,
        }
    }

    pub const fn current(capabilities: u64) -> Self {
        Self::new(PROTOCOL_VERSION, capabilities)
    }

    pub fn encode_payload(self, output: &mut [u8]) -> Result<usize, EncodeError> {
        if output.len() < Self::PAYLOAD_BYTES {
            return Err(EncodeError::BufferTooSmall {
                required: Self::PAYLOAD_BYTES,
                available: output.len(),
            });
        }
        put_u16(&mut output[0..2], self.version);
        put_u64(&mut output[2..10], self.capabilities);
        Ok(Self::PAYLOAD_BYTES)
    }

    pub fn from_payload(payload: &[u8]) -> Result<Self, PayloadError> {
        if payload.len() != Self::PAYLOAD_BYTES {
            return Err(PayloadError::WrongLength {
                expected: Self::PAYLOAD_BYTES,
                actual: payload.len(),
            });
        }
        Ok(Self {
            version: get_u16(&payload[0..2]),
            capabilities: get_u64(&payload[2..10]),
        })
    }

    pub fn negotiate(self, peer: Self) -> Result<Self, NegotiationError> {
        let version = self.version.min(peer.version);
        if version == 0 {
            return Err(NegotiationError::NoCommonVersion {
                local: self.version,
                peer: peer.version,
            });
        }
        Ok(Self {
            version,
            capabilities: self.capabilities & peer.capabilities,
        })
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct Ping {
    pub nonce: u64,
}

impl Ping {
    pub const PAYLOAD_BYTES: usize = 8;

    pub const fn new(nonce: u64) -> Self {
        Self { nonce }
    }

    pub fn encode_payload(self, output: &mut [u8]) -> Result<usize, EncodeError> {
        if output.len() < Self::PAYLOAD_BYTES {
            return Err(EncodeError::BufferTooSmall {
                required: Self::PAYLOAD_BYTES,
                available: output.len(),
            });
        }
        put_u64(output, self.nonce);
        Ok(Self::PAYLOAD_BYTES)
    }

    pub fn from_payload(payload: &[u8]) -> Result<Self, PayloadError> {
        if payload.len() != Self::PAYLOAD_BYTES {
            return Err(PayloadError::WrongLength {
                expected: Self::PAYLOAD_BYTES,
                actual: payload.len(),
            });
        }
        Ok(Self {
            nonce: get_u64(payload),
        })
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct Nak {
    pub rejected_type: u16,
    pub code: u16,
}

impl Nak {
    pub const PAYLOAD_BYTES: usize = 4;

    pub const fn unknown_type(rejected_type: u16) -> Self {
        Self {
            rejected_type,
            code: NAK_UNKNOWN_TYPE,
        }
    }

    pub fn encode_payload(self, output: &mut [u8]) -> Result<usize, EncodeError> {
        if output.len() < Self::PAYLOAD_BYTES {
            return Err(EncodeError::BufferTooSmall {
                required: Self::PAYLOAD_BYTES,
                available: output.len(),
            });
        }
        put_u16(&mut output[0..2], self.rejected_type);
        put_u16(&mut output[2..4], self.code);
        Ok(Self::PAYLOAD_BYTES)
    }

    pub fn from_payload(payload: &[u8]) -> Result<Self, PayloadError> {
        if payload.len() != Self::PAYLOAD_BYTES {
            return Err(PayloadError::WrongLength {
                expected: Self::PAYLOAD_BYTES,
                actual: payload.len(),
            });
        }
        Ok(Self {
            rejected_type: get_u16(&payload[0..2]),
            code: get_u16(&payload[2..4]),
        })
    }
}

/// A validated text/plain clipboard update. The type tag supplies the content type, so the wire
/// payload is exactly the UTF-8 bytes and has no second length or encoding field.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ClipboardSet {
    text: Vec<u8>,
}

impl ClipboardSet {
    pub fn new(text: &[u8]) -> Result<Self, ClipboardError> {
        if text.len() > MAX_CLIPBOARD_BYTES {
            return Err(ClipboardError::TooLarge { length: text.len() });
        }
        core::str::from_utf8(text).map_err(|_| ClipboardError::InvalidUtf8)?;
        Ok(Self {
            text: text.to_vec(),
        })
    }

    pub fn from_payload(payload: &[u8]) -> Result<Self, ClipboardError> {
        Self::new(payload)
    }

    pub fn encode_payload(&self, output: &mut [u8]) -> Result<usize, EncodeError> {
        if output.len() < self.text.len() {
            return Err(EncodeError::BufferTooSmall {
                required: self.text.len(),
                available: output.len(),
            });
        }
        output[..self.text.len()].copy_from_slice(&self.text);
        Ok(self.text.len())
    }

    pub fn as_bytes(&self) -> &[u8] {
        &self.text
    }
}

/// A request for the peer's current text/plain clipboard. Its payload is always empty.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct ClipboardGet;

impl ClipboardGet {
    pub const PAYLOAD_BYTES: usize = 0;

    pub const fn new() -> Self {
        Self
    }

    pub fn encode_payload(self, _output: &mut [u8]) -> Result<usize, EncodeError> {
        Ok(0)
    }

    pub fn from_payload(payload: &[u8]) -> Result<Self, PayloadError> {
        if !payload.is_empty() {
            return Err(PayloadError::WrongLength {
                expected: Self::PAYLOAD_BYTES,
                actual: payload.len(),
            });
        }
        Ok(Self)
    }
}

impl Default for ClipboardGet {
    fn default() -> Self {
        Self::new()
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ClipboardError {
    TooLarge { length: usize },
    InvalidUtf8,
}

impl fmt::Display for ClipboardError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::TooLarge { length } => write!(
                formatter,
                "clipboard payload is {length} bytes; maximum is {MAX_CLIPBOARD_BYTES}"
            ),
            Self::InvalidUtf8 => formatter.write_str("clipboard payload is not valid UTF-8"),
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum EncodeError {
    PayloadTooLarge { length: usize },
    BufferTooSmall { required: usize, available: usize },
}

impl fmt::Display for EncodeError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::PayloadTooLarge { length } => {
                write!(
                    formatter,
                    "agent payload is {length} bytes; maximum is {MAX_PAYLOAD_BYTES}"
                )
            }
            Self::BufferTooSmall {
                required,
                available,
            } => write!(
                formatter,
                "agent frame needs {required} bytes; buffer has {available}"
            ),
        }
    }
}

pub fn encode_frame(
    message_type: u16,
    flags: u16,
    payload: &[u8],
    output: &mut [u8],
) -> Result<usize, EncodeError> {
    if payload.len() > MAX_PAYLOAD_BYTES {
        return Err(EncodeError::PayloadTooLarge {
            length: payload.len(),
        });
    }
    let required = FRAME_HEADER_BYTES + payload.len();
    if output.len() < required {
        return Err(EncodeError::BufferTooSmall {
            required,
            available: output.len(),
        });
    }
    put_u32(&mut output[0..4], payload.len() as u32);
    put_u16(&mut output[4..6], message_type);
    put_u16(&mut output[6..8], flags);
    output[FRAME_HEADER_BYTES..required].copy_from_slice(payload);
    Ok(required)
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum PayloadError {
    WrongLength { expected: usize, actual: usize },
}

impl fmt::Display for PayloadError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::WrongLength { expected, actual } => {
                write!(
                    formatter,
                    "agent payload length {actual}; expected {expected}"
                )
            }
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum NegotiationError {
    NoCommonVersion { local: u16, peer: u16 },
}

impl fmt::Display for NegotiationError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::NoCommonVersion { local, peer } => {
                write!(
                    formatter,
                    "no common agent protocol version ({local}, {peer})"
                )
            }
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum DecodeError {
    PayloadTooLarge { length: u32 },
    Truncated { bytes: usize },
}

impl fmt::Display for DecodeError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::PayloadTooLarge { length } => write!(
                formatter,
                "agent payload length {length}; maximum is {MAX_PAYLOAD_BYTES}"
            ),
            Self::Truncated { bytes } => {
                write!(formatter, "agent stream ended with {bytes} pending bytes")
            }
        }
    }
}

/// Incrementally decodes frames from one byte stream.
///
/// The decoder owns at most one validated payload buffer, bounded by [`MAX_PAYLOAD_BYTES`]. It
/// intentionally does not scan for magic bytes: a malformed length makes framing ambiguous, so
/// the caller gets an error and must reset the transport. Valid unknown message types are emitted
/// normally for the endpoint's NAK policy.
pub struct FrameDecoder {
    header: [u8; FRAME_HEADER_BYTES],
    header_len: usize,
    message_type: u16,
    flags: u16,
    payload_len: usize,
    payload_filled: usize,
    payload: Vec<u8>,
}

impl FrameDecoder {
    pub const fn new() -> Self {
        Self {
            header: [0; FRAME_HEADER_BYTES],
            header_len: 0,
            message_type: 0,
            flags: 0,
            payload_len: 0,
            payload_filled: 0,
            payload: Vec::new(),
        }
    }

    pub fn push<F>(&mut self, mut input: &[u8], mut emit: F) -> Result<usize, DecodeError>
    where
        F: FnMut(Frame),
    {
        let original_len = input.len();
        loop {
            if input.is_empty()
                && (self.header_len != FRAME_HEADER_BYTES
                    || self.payload_filled != self.payload_len)
            {
                break;
            }
            if self.header_len < FRAME_HEADER_BYTES {
                let needed = FRAME_HEADER_BYTES - self.header_len;
                let copied = needed.min(input.len());
                let end = self.header_len + copied;
                self.header[self.header_len..end].copy_from_slice(&input[..copied]);
                self.header_len = end;
                input = &input[copied..];
                if self.header_len < FRAME_HEADER_BYTES {
                    break;
                }
                let length = get_u32(&self.header[0..4]);
                if length as usize > MAX_PAYLOAD_BYTES {
                    self.reset();
                    return Err(DecodeError::PayloadTooLarge { length });
                }
                self.payload_len = length as usize;
                self.payload_filled = 0;
                self.message_type = get_u16(&self.header[4..6]);
                self.flags = get_u16(&self.header[6..8]);
                self.payload.clear();
                if self.payload_len != 0 {
                    self.payload.resize(self.payload_len, 0);
                }
            }

            let remaining = self.payload_len - self.payload_filled;
            let copied = remaining.min(input.len());
            if copied != 0 {
                let start = self.payload_filled;
                self.payload[start..start + copied].copy_from_slice(&input[..copied]);
                self.payload_filled += copied;
                input = &input[copied..];
            }
            if self.payload_filled != self.payload_len {
                break;
            }

            let frame = Frame {
                message_type: self.message_type,
                flags: self.flags,
                payload: core::mem::take(&mut self.payload),
            };
            self.reset_frame();
            emit(frame);
        }
        Ok(original_len - input.len())
    }

    /// Return an error only when the byte stream is closed while a frame is incomplete.
    pub fn finish(&self) -> Result<(), DecodeError> {
        if self.header_len == 0 {
            Ok(())
        } else {
            Err(DecodeError::Truncated {
                bytes: self.header_len + self.payload_filled,
            })
        }
    }

    pub const fn is_idle(&self) -> bool {
        self.header_len == 0
    }

    pub const fn pending_bytes(&self) -> usize {
        self.header_len + self.payload_filled
    }

    /// Capacity is exposed for a verifier to prove an oversized header allocates nothing.
    pub fn payload_capacity(&self) -> usize {
        self.payload.capacity()
    }

    /// Discard a partial frame after the transport has been closed or reset.
    pub fn reset(&mut self) {
        self.reset_frame();
        self.payload.clear();
    }

    fn reset_frame(&mut self) {
        self.header_len = 0;
        self.message_type = 0;
        self.flags = 0;
        self.payload_len = 0;
        self.payload_filled = 0;
    }
}

impl Default for FrameDecoder {
    fn default() -> Self {
        Self::new()
    }
}

fn put_u16(output: &mut [u8], value: u16) {
    output[0] = value as u8;
    output[1] = (value >> 8) as u8;
}

fn put_u32(output: &mut [u8], value: u32) {
    output[0] = value as u8;
    output[1] = (value >> 8) as u8;
    output[2] = (value >> 16) as u8;
    output[3] = (value >> 24) as u8;
}

fn put_u64(output: &mut [u8], value: u64) {
    output[0] = value as u8;
    output[1] = (value >> 8) as u8;
    output[2] = (value >> 16) as u8;
    output[3] = (value >> 24) as u8;
    output[4] = (value >> 32) as u8;
    output[5] = (value >> 40) as u8;
    output[6] = (value >> 48) as u8;
    output[7] = (value >> 56) as u8;
}

fn get_u16(input: &[u8]) -> u16 {
    u16::from_le_bytes([input[0], input[1]])
}

fn get_u32(input: &[u8]) -> u32 {
    u32::from_le_bytes([input[0], input[1], input[2], input[3]])
}

fn get_u64(input: &[u8]) -> u64 {
    u64::from_le_bytes([
        input[0], input[1], input[2], input[3], input[4], input[5], input[6], input[7],
    ])
}

#[cfg(test)]
mod tests {
    use super::*;
    use alloc::{string::ToString, vec, vec::Vec};

    fn encoded(message_type: u16, flags: u16, payload: &[u8]) -> Vec<u8> {
        let mut bytes = vec![0; FRAME_HEADER_BYTES + payload.len()];
        let used = encode_frame(message_type, flags, payload, &mut bytes).unwrap();
        bytes.truncate(used);
        bytes
    }

    #[test]
    fn wire_header_is_little_endian_and_round_trips() {
        let payload = [1, 2, 3, 4, 5];
        let bytes = encoded(0x1234, 0x5678, &payload);
        assert_eq!(&bytes[..8], &[5, 0, 0, 0, 0x34, 0x12, 0x78, 0x56]);

        let mut decoder = FrameDecoder::new();
        let mut frames = Vec::new();
        assert_eq!(
            decoder.push(&bytes, |frame| frames.push(frame)).unwrap(),
            bytes.len()
        );
        assert_eq!(frames, vec![Frame::new(0x1234, 0x5678, &payload).unwrap()]);
        assert!(decoder.is_idle());
        assert!(decoder.finish().is_ok());
    }

    #[test]
    fn one_byte_dribble_and_coalesced_frames_are_equivalent() {
        let mut wire = Vec::new();
        for nonce in 0..10u64 {
            wire.extend(encoded(TYPE_PING, FLAG_NONE, &nonce.to_le_bytes()));
        }

        let mut dribble_decoder = FrameDecoder::new();
        let mut dribble = Vec::new();
        for byte in &wire {
            assert_eq!(
                dribble_decoder
                    .push(core::slice::from_ref(byte), |frame| dribble.push(frame))
                    .unwrap(),
                1
            );
        }
        let mut coalesced_decoder = FrameDecoder::new();
        let mut coalesced = Vec::new();
        assert_eq!(
            coalesced_decoder
                .push(&wire, |frame| coalesced.push(frame))
                .unwrap(),
            wire.len()
        );
        assert_eq!(dribble, coalesced);
        assert_eq!(dribble.len(), 10);
    }

    #[test]
    fn truncated_stream_is_reported_only_at_finish() {
        let wire = encoded(TYPE_PING, FLAG_NONE, &[9; Ping::PAYLOAD_BYTES]);
        let mut decoder = FrameDecoder::new();
        let mut frames = Vec::new();
        assert_eq!(
            decoder
                .push(&wire[..wire.len() - 1], |frame| frames.push(frame))
                .unwrap(),
            wire.len() - 1
        );
        assert!(frames.is_empty());
        assert_eq!(
            decoder.finish(),
            Err(DecodeError::Truncated {
                bytes: wire.len() - 1
            })
        );
        decoder.reset();
        assert!(decoder.is_idle());
    }

    #[test]
    fn oversized_length_fails_before_payload_allocation() {
        let header = [0xff, 0xff, 0xff, 0xff, 0, 0, 0, 0];
        let mut decoder = FrameDecoder::new();
        assert_eq!(decoder.payload_capacity(), 0);
        assert_eq!(
            decoder.push(&header, |_| {}).unwrap_err(),
            DecodeError::PayloadTooLarge { length: u32::MAX }
        );
        assert_eq!(decoder.payload_capacity(), 0);
        assert!(decoder.is_idle());
    }

    #[test]
    fn zero_length_frame_is_emitted_when_header_is_the_whole_write() {
        let wire = encoded(TYPE_PONG, FLAG_NONE, &[]);
        assert_eq!(wire.len(), FRAME_HEADER_BYTES);
        let mut decoder = FrameDecoder::new();
        let mut frames = Vec::new();
        assert_eq!(
            decoder.push(&wire, |frame| frames.push(frame)).unwrap(),
            wire.len()
        );
        assert_eq!(frames, vec![Frame::new(TYPE_PONG, FLAG_NONE, &[]).unwrap()]);
        assert!(decoder.is_idle());
    }

    #[test]
    fn unknown_message_type_is_emitted_for_nak_policy() {
        let wire = encoded(0xfeed, 0x12, &[7, 8]);
        let mut decoder = FrameDecoder::new();
        let mut frames = Vec::new();
        decoder.push(&wire, |frame| frames.push(frame)).unwrap();
        assert_eq!(frames[0].message_type, 0xfeed);
        assert_eq!(frames[0].flags, 0x12);
        assert_eq!(
            Nak::unknown_type(frames[0].message_type).code,
            NAK_UNKNOWN_TYPE
        );
    }

    #[test]
    fn hello_intersects_version_and_capabilities() {
        let local = Hello::new(3, CAP_PING | CAP_CLIPBOARD);
        let peer = Hello::new(2, CAP_PING | CAP_DISPLAY);
        assert_eq!(local.negotiate(peer), Ok(Hello::new(2, CAP_PING)));
        assert_eq!(
            Hello::new(0, 1).negotiate(Hello::new(1, 1)),
            Err(NegotiationError::NoCommonVersion { local: 0, peer: 1 })
        );
    }

    #[test]
    fn clipboard_payloads_are_strictly_bounded_and_byte_exact() {
        let text = "abc\r\n🦀".as_bytes();
        let clipboard = ClipboardSet::new(text).unwrap();
        assert_eq!(clipboard.as_bytes(), text);
        let mut encoded_payload = vec![0; text.len()];
        assert_eq!(
            clipboard.encode_payload(&mut encoded_payload),
            Ok(text.len())
        );
        assert_eq!(
            ClipboardSet::from_payload(&encoded_payload),
            Ok(clipboard.clone())
        );

        let boundary = vec![b'a'; MAX_CLIPBOARD_BYTES];
        assert_eq!(ClipboardSet::new(&boundary).unwrap().as_bytes(), boundary);
        assert_eq!(
            ClipboardSet::new(&vec![b'a'; MAX_CLIPBOARD_BYTES + 1]),
            Err(ClipboardError::TooLarge {
                length: MAX_CLIPBOARD_BYTES + 1
            })
        );
        assert_eq!(ClipboardSet::new(&[0xff]), Err(ClipboardError::InvalidUtf8));
        assert_eq!(
            ClipboardError::InvalidUtf8.to_string(),
            "clipboard payload is not valid UTF-8"
        );
        assert!(
            ClipboardError::TooLarge {
                length: MAX_CLIPBOARD_BYTES + 1
            }
            .to_string()
            .contains("maximum is 262144")
        );

        assert_eq!(
            clipboard.encode_payload(&mut []),
            Err(EncodeError::BufferTooSmall {
                required: text.len(),
                available: 0
            })
        );

        let get = ClipboardGet::default();
        assert_eq!(get.encode_payload(&mut []), Ok(0));
        assert_eq!(ClipboardGet::from_payload(&[]), Ok(get));
        assert_eq!(
            ClipboardGet::from_payload(&[0]),
            Err(PayloadError::WrongLength {
                expected: ClipboardGet::PAYLOAD_BYTES,
                actual: 1
            })
        );
    }

    #[test]
    fn clipboard_frames_survive_dribble_and_coalescing() {
        let set = encoded(TYPE_CLIP_SET, FLAG_NONE, b"abc");
        let get = encoded(TYPE_CLIP_GET, FLAG_NONE, &[]);
        let wire = [set, get].concat();

        let mut dribble_decoder = FrameDecoder::new();
        let mut dribble = Vec::new();
        for byte in &wire {
            dribble_decoder
                .push(core::slice::from_ref(byte), |frame| dribble.push(frame))
                .unwrap();
        }
        let mut coalesced_decoder = FrameDecoder::new();
        let mut coalesced = Vec::new();
        coalesced_decoder
            .push(&wire, |frame| coalesced.push(frame))
            .unwrap();

        assert_eq!(dribble, coalesced);
        assert_eq!(dribble.len(), 2);
        assert_eq!(
            ClipboardSet::from_payload(&dribble[0].payload)
                .unwrap()
                .as_bytes(),
            b"abc"
        );
        assert_eq!(
            ClipboardGet::from_payload(&dribble[1].payload),
            Ok(ClipboardGet::new())
        );
    }

    #[test]
    fn typed_payloads_have_fixed_lengths() {
        let hello = Hello::new(7, 0x0102_0304_0506_0708);
        let mut hello_bytes = [0; Hello::PAYLOAD_BYTES];
        hello.encode_payload(&mut hello_bytes).unwrap();
        assert_eq!(Hello::from_payload(&hello_bytes), Ok(hello));

        let ping = Ping::new(0x0102_0304_0506_0708);
        let mut ping_bytes = [0; Ping::PAYLOAD_BYTES];
        ping.encode_payload(&mut ping_bytes).unwrap();
        assert_eq!(Ping::from_payload(&ping_bytes), Ok(ping));

        let nak = Nak::unknown_type(0xbeef);
        let mut nak_bytes = [0; Nak::PAYLOAD_BYTES];
        nak.encode_payload(&mut nak_bytes).unwrap();
        assert_eq!(Nak::from_payload(&nak_bytes), Ok(nak));
    }

    #[test]
    fn exact_max_payload_is_accepted_and_next_byte_is_not_consumed() {
        let payload = vec![0x5a; MAX_PAYLOAD_BYTES];
        let wire = encoded(0x99, FLAG_NONE, &payload);
        let mut decoder = FrameDecoder::new();
        let mut frames = Vec::new();
        assert_eq!(
            decoder.push(&wire, |frame| frames.push(frame)).unwrap(),
            wire.len()
        );
        assert_eq!(frames.len(), 1);
        assert_eq!(frames[0].payload.len(), MAX_PAYLOAD_BYTES);
    }
}
