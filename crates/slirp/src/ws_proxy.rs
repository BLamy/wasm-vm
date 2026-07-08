//! WebSocket TCP-proxy framing codec (E3-T16) — the shared wire format between the browser client
//! (`WsConnector`) and the Rust relay server (`proxy/`), so their encoders/decoders agree by
//! construction. See `docs/design/ws-proxy-protocol.md`.
//!
//! Each WebSocket binary message IS one frame: `[stream_id: u32 BE][opcode: u8][opcode-specific
//! payload]` (the WS layer preserves message boundaries, so no length prefix is needed). Decoding is
//! DEFENSIVE: a short message, an unknown opcode, a bad stream id, or a malformed payload yields
//! `None` — never a panic (the adversarial charter: fuzzing with garbage must not panic or leak). No
//! tokio → browser-safe.

/// The protocol version carried in the [`Frame::Hello`] frame.
pub const VERSION: u8 = 1;

const OP_HELLO: u8 = 0;
const OP_OPEN: u8 = 1;
const OP_OPEN_OK: u8 = 2;
const OP_OPEN_FAIL: u8 = 3;
const OP_DATA: u8 = 4;
const OP_SHUTDOWN_WR: u8 = 5;
const OP_CLOSE: u8 = 6;
const OP_RST: u8 = 7;
const OP_WINDOW: u8 = 8;

const HEADER_LEN: usize = 5; // stream_id(4) + opcode(1)
/// Stream 0 is reserved for connection-level frames (HELLO); per-flow frames use a nonzero id.
const CONTROL_STREAM: u32 = 0;

/// One decoded proxy frame. Per-flow variants carry their `stream` id; `Hello` is connection-level
/// (wire stream id 0).
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Frame {
    /// Version negotiation + an optional auth token (may be empty; auth is E3-T19).
    Hello { version: u8, token: Vec<u8> },
    /// Open a flow to `host:port` — the host is a NAME (the relay resolves it).
    Open {
        stream: u32,
        host: String,
        port: u16,
    },
    /// The flow opened.
    OpenOk { stream: u32 },
    /// The flow could not open; `code` is a small errno-ish class.
    OpenFail { stream: u32, code: u8 },
    /// Stream bytes.
    Data { stream: u32, bytes: Vec<u8> },
    /// Half-close: the sender's write side is done (the peer may keep sending).
    ShutdownWr { stream: u32 },
    /// Clean bidirectional close.
    Close { stream: u32 },
    /// Abort — surfaces to the guest as `ECONNRESET`.
    Rst { stream: u32 },
    /// Grant `credit` bytes of send window for this stream (per-stream flow control).
    Window { stream: u32, credit: u32 },
}

impl Frame {
    /// The wire stream id for this frame (0 for `Hello`).
    fn stream_id(&self) -> u32 {
        match self {
            Frame::Hello { .. } => CONTROL_STREAM,
            Frame::Open { stream, .. }
            | Frame::OpenOk { stream }
            | Frame::OpenFail { stream, .. }
            | Frame::Data { stream, .. }
            | Frame::ShutdownWr { stream }
            | Frame::Close { stream }
            | Frame::Rst { stream }
            | Frame::Window { stream, .. } => *stream,
        }
    }

    fn opcode(&self) -> u8 {
        match self {
            Frame::Hello { .. } => OP_HELLO,
            Frame::Open { .. } => OP_OPEN,
            Frame::OpenOk { .. } => OP_OPEN_OK,
            Frame::OpenFail { .. } => OP_OPEN_FAIL,
            Frame::Data { .. } => OP_DATA,
            Frame::ShutdownWr { .. } => OP_SHUTDOWN_WR,
            Frame::Close { .. } => OP_CLOSE,
            Frame::Rst { .. } => OP_RST,
            Frame::Window { .. } => OP_WINDOW,
        }
    }

    /// Encode this frame to a WebSocket binary message. `Open` with a host longer than 255 bytes
    /// returns `None` (a name that can't be length-prefixed by a u8 — no legal DNS name is that long).
    pub fn encode(&self) -> Option<Vec<u8>> {
        let mut b = Vec::with_capacity(HEADER_LEN + 8);
        b.extend_from_slice(&self.stream_id().to_be_bytes());
        b.push(self.opcode());
        match self {
            Frame::Hello { version, token } => {
                b.push(*version);
                b.extend_from_slice(token);
            }
            Frame::Open { host, port, .. } => {
                let len: u8 = host.len().try_into().ok()?;
                b.push(len);
                b.extend_from_slice(host.as_bytes());
                b.extend_from_slice(&port.to_be_bytes());
            }
            Frame::OpenFail { code, .. } => b.push(*code),
            Frame::Data { bytes, .. } => b.extend_from_slice(bytes),
            Frame::Window { credit, .. } => b.extend_from_slice(&credit.to_be_bytes()),
            // No payload.
            Frame::OpenOk { .. }
            | Frame::ShutdownWr { .. }
            | Frame::Close { .. }
            | Frame::Rst { .. } => {}
        }
        Some(b)
    }

    /// Decode one WebSocket binary message into a frame, or `None` on any protocol error (short
    /// header, unknown opcode, wrong stream id for the opcode, malformed payload). Never panics.
    pub fn decode(msg: &[u8]) -> Option<Frame> {
        if msg.len() < HEADER_LEN {
            return None;
        }
        let stream = u32::from_be_bytes([msg[0], msg[1], msg[2], msg[3]]);
        let opcode = msg[4];
        let payload = &msg[HEADER_LEN..];

        // HELLO is the only frame on the control stream; every other frame needs a nonzero stream.
        if opcode == OP_HELLO {
            if stream != CONTROL_STREAM {
                return None;
            }
            let (&version, token) = payload.split_first()?; // ≥1 byte: the version
            return Some(Frame::Hello {
                version,
                token: token.to_vec(),
            });
        }
        if stream == CONTROL_STREAM {
            return None; // a per-flow frame on the control stream is a protocol error
        }

        match opcode {
            OP_OPEN => {
                let (&host_len, rest) = payload.split_first()?;
                let host_len = host_len as usize;
                let host_bytes = rest.get(..host_len)?;
                let port_bytes = rest.get(host_len..host_len + 2)?;
                let host = core::str::from_utf8(host_bytes).ok()?.to_string();
                let port = u16::from_be_bytes([port_bytes[0], port_bytes[1]]);
                Some(Frame::Open { stream, host, port })
            }
            OP_OPEN_OK => payload.is_empty().then_some(Frame::OpenOk { stream }),
            OP_OPEN_FAIL => {
                let (&code, rest) = payload.split_first()?;
                rest.is_empty().then_some(Frame::OpenFail { stream, code })
            }
            OP_DATA => Some(Frame::Data {
                stream,
                bytes: payload.to_vec(),
            }),
            OP_SHUTDOWN_WR => payload.is_empty().then_some(Frame::ShutdownWr { stream }),
            OP_CLOSE => payload.is_empty().then_some(Frame::Close { stream }),
            OP_RST => payload.is_empty().then_some(Frame::Rst { stream }),
            OP_WINDOW => {
                let b: [u8; 4] = payload.try_into().ok()?;
                Some(Frame::Window {
                    stream,
                    credit: u32::from_be_bytes(b),
                })
            }
            _ => None, // unknown opcode
        }
    }
}

#[cfg(test)]
mod tests;
