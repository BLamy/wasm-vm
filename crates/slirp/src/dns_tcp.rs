//! DNS-over-TCP framing (E3-T15, RFC 1035 §4.2.2) — the guest's resolver falls back to TCP when a UDP
//! answer is truncated (`TC=1`, see [`crate::dns::truncated`]). Over TCP each DNS message is prefixed
//! with a 2-byte big-endian LENGTH, so a byte STREAM can carry back-to-back messages of any size (no
//! 512-byte UDP limit). This module is the pure framing layer: pull whole length-prefixed messages out
//! of a stream buffer, and frame an outbound message with its length prefix. It composes with the same
//! [`crate::dns::parse_query`] / [`crate::dns::build_response`] as the UDP path — only the transport
//! framing differs. No tokio → browser-safe. (Wiring it to an internal TCP listener on the DNS address
//! is a later leg; this is the wire layer the charter's "TCP fallback" acceptance needs.)

/// The 2-byte length prefix on every TCP DNS message.
const LEN_PREFIX: usize = 2;

/// The outcome of trying to pull the next length-prefixed DNS message out of a stream buffer.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TcpFrame {
    /// A whole message: its bytes, and how many bytes of `buf` it consumed (prefix + body). The caller
    /// advances the buffer by `consumed` and may call [`next_message`] again for a pipelined message.
    Message { msg: Vec<u8>, consumed: usize },
    /// Not enough bytes yet — the caller should read more from the stream and retry. Carries the total
    /// message length still needed (prefix + declared body), so the caller can size its read.
    NeedMore { need_total: usize },
}

/// Pull the next complete length-prefixed DNS message from the front of `buf`, or report that more
/// bytes are needed. Never panics on a short/partial buffer. A declared length of 0 (a malformed
/// empty message) is returned as an empty `Message` consuming the 2-byte prefix, so the caller makes
/// progress rather than stalling.
pub fn next_message(buf: &[u8]) -> TcpFrame {
    if buf.len() < LEN_PREFIX {
        return TcpFrame::NeedMore {
            need_total: LEN_PREFIX,
        };
    }
    let body_len = u16::from_be_bytes([buf[0], buf[1]]) as usize;
    let total = LEN_PREFIX + body_len;
    if buf.len() < total {
        return TcpFrame::NeedMore { need_total: total };
    }
    TcpFrame::Message {
        msg: buf[LEN_PREFIX..total].to_vec(),
        consumed: total,
    }
}

/// Frame a DNS message for TCP transport: prepend its 2-byte big-endian length. Returns `None` if the
/// message exceeds 65535 bytes (the u16 length can't describe it) — no legal DNS message is that large.
pub fn frame_message(msg: &[u8]) -> Option<Vec<u8>> {
    let len: u16 = msg.len().try_into().ok()?;
    let mut out = Vec::with_capacity(LEN_PREFIX + msg.len());
    out.extend_from_slice(&len.to_be_bytes());
    out.extend_from_slice(msg);
    Some(out)
}

#[cfg(test)]
mod tests;
