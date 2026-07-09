//! DNS forwarder — wire layer (E3-T15). Parse a guest DNS query off the UDP:53 payload and build the
//! response bytes. This slice is the PURE, synchronous message layer: name parsing (compression-safe),
//! question extraction, and response assembly (answers / NXDOMAIN / SERVFAIL / the empty-AAAA policy).
//! The async resolver (`Resolver` trait: DoH in the browser, the OS resolver natively), the TTL cache,
//! and the slirp UDP wiring build on this. No tokio/async here — it compiles into the browser build.
//!
//! Parsing is defensively bounds-checked and compression-loop-proof: a pointer must jump strictly
//! backward and a label/jump budget bounds the walk, so a malformed query (pointer loop, zero
//! questions, oversized name, truncation) yields `None` rather than a hang or a panic.

use std::net::Ipv4Addr;

/// DNS RCODEs we produce.
pub const RCODE_NOERROR: u8 = 0;
pub const RCODE_SERVFAIL: u8 = 2;
pub const RCODE_NXDOMAIN: u8 = 3;

/// RR / query types we care about.
pub const TYPE_A: u16 = 1;
pub const TYPE_CNAME: u16 = 5;
pub const TYPE_AAAA: u16 = 28;
/// The one class we serve (IN).
pub const CLASS_IN: u16 = 1;

const HEADER_LEN: usize = 12;
/// Max encoded name length (RFC 1035 §3.1) and a hard cap on labels/pointer jumps to defeat loops.
const MAX_NAME: usize = 255;
const WALK_BUDGET: usize = 128;

/// A parsed guest query. `question` is the raw QNAME+QTYPE+QCLASS bytes, copied so the response can
/// echo the question section verbatim (and answers can point at it with a compression pointer to 0x0c).
#[derive(Debug, Clone)]
pub struct Query {
    pub id: u16,
    /// The queried name, lowercased, dot-joined (labels are UTF-8-lossy — DNS is bytes).
    pub name: String,
    pub qtype: u16,
    pub qclass: u16,
    /// Recursion-Desired bit, echoed into the response.
    pub rd: bool,
    question: Vec<u8>,
}

impl Query {
    pub fn is_aaaa(&self) -> bool {
        self.qtype == TYPE_AAAA
    }
    pub fn is_a(&self) -> bool {
        self.qtype == TYPE_A
    }
}

/// One answer record to emit (its NAME is always a pointer to the question).
#[derive(Debug, Clone)]
pub struct Answer {
    pub rtype: u16,
    pub ttl: u32,
    pub rdata: Vec<u8>,
}

impl Answer {
    /// An `A` record for `ip` with `ttl` seconds.
    pub fn a(ip: Ipv4Addr, ttl: u32) -> Self {
        Answer {
            rtype: TYPE_A,
            ttl,
            rdata: ip.octets().to_vec(),
        }
    }
}

/// Parse a single-question DNS query. Returns `None` on anything malformed (so the caller drops it or
/// answers SERVFAIL) — never panics, never loops.
pub fn parse_query(msg: &[u8]) -> Option<Query> {
    if msg.len() < HEADER_LEN {
        return None;
    }
    let id = u16::from_be_bytes([msg[0], msg[1]]);
    let flags = u16::from_be_bytes([msg[2], msg[3]]);
    let qdcount = u16::from_be_bytes([msg[4], msg[5]]);
    if flags & 0x8000 != 0 {
        return None; // QR=1 → it's a response, not a query
    }
    if qdcount != 1 {
        return None; // we handle exactly one question (zero-QD / multi-QD → drop)
    }
    let (name, after) = parse_name(msg, HEADER_LEN)?;
    // QTYPE + QCLASS follow the name.
    let qtype = u16::from_be_bytes([*msg.get(after)?, *msg.get(after + 1)?]);
    let qclass = u16::from_be_bytes([*msg.get(after + 2)?, *msg.get(after + 3)?]);
    let question = msg.get(HEADER_LEN..after + 4)?.to_vec();
    Some(Query {
        id,
        name,
        qtype,
        qclass,
        rd: flags & 0x0100 != 0,
        question,
    })
}

/// Read a DNS name starting at `start`. Returns `(name, offset_just_past_the_name_in_sequence)`.
/// Compression pointers are followed but must jump strictly BACKWARD (so the walk always terminates),
/// and a budget bounds total labels/jumps. `None` on any malformed encoding.
fn parse_name(msg: &[u8], start: usize) -> Option<(String, usize)> {
    let mut labels: Vec<String> = Vec::new();
    let mut pos = start;
    let mut seq_end: Option<usize> = None; // offset past the name in the READING sequence
    let mut name_len = 0usize;

    for _ in 0..WALK_BUDGET {
        let len = *msg.get(pos)?;
        match len & 0xC0 {
            0x00 => {
                let len = len as usize;
                if len == 0 {
                    // root label ends the name.
                    if seq_end.is_none() {
                        seq_end = Some(pos + 1);
                    }
                    let name = labels.join(".");
                    return Some((name, seq_end?));
                }
                let label = msg.get(pos + 1..pos + 1 + len)?;
                name_len += len + 1;
                if name_len > MAX_NAME {
                    return None;
                }
                labels.push(String::from_utf8_lossy(label).to_ascii_lowercase());
                pos += 1 + len;
            }
            0xC0 => {
                // Compression pointer: 14-bit offset. Record where the sequence continues (only on the
                // FIRST pointer), then jump — but strictly backward, which guarantees termination.
                let b2 = *msg.get(pos + 1)?;
                let ptr = (((len & 0x3F) as usize) << 8) | b2 as usize;
                if seq_end.is_none() {
                    seq_end = Some(pos + 2);
                }
                // Must jump strictly BACKWARD (defeats pointer loops) and never INTO the fixed header:
                // no legitimate name points at the 12-byte header, and since a QNAME starts at offset
                // 12, this also rejects a QNAME that is itself a pointer (which would otherwise make the
                // echoed answer's `0xC0 0x0C` resolve back into the response header — a malformed reply;
                // critic MINOR).
                if ptr >= pos || ptr < HEADER_LEN {
                    return None;
                }
                pos = ptr;
            }
            _ => return None, // 0x40 / 0x80 are reserved
        }
    }
    None // budget exhausted → treat as malformed
}

/// Build a response to `query` with the given rcode and answers (each answer's NAME is a compression
/// pointer to the echoed question at offset 12).
pub fn build_response(query: &Query, rcode: u8, answers: &[Answer]) -> Vec<u8> {
    let mut b = Vec::with_capacity(HEADER_LEN + query.question.len() + answers.len() * 16);
    b.extend_from_slice(&query.id.to_be_bytes());
    // Flags: QR=1, Opcode=0, AA=0, TC=0, RD=echo, RA=1, Z=0, RCODE.
    let flags: u16 =
        0x8000 | (if query.rd { 0x0100 } else { 0 }) | 0x0080 | (rcode as u16 & 0x000F);
    b.extend_from_slice(&flags.to_be_bytes());
    b.extend_from_slice(&1u16.to_be_bytes()); // QDCOUNT
    b.extend_from_slice(&(answers.len() as u16).to_be_bytes()); // ANCOUNT
    b.extend_from_slice(&0u16.to_be_bytes()); // NSCOUNT
    b.extend_from_slice(&0u16.to_be_bytes()); // ARCOUNT
    b.extend_from_slice(&query.question); // echo the question verbatim
    for a in answers {
        b.extend_from_slice(&[0xC0, 0x0C]); // NAME → pointer to the question name (offset 12)
        b.extend_from_slice(&a.rtype.to_be_bytes());
        b.extend_from_slice(&CLASS_IN.to_be_bytes());
        b.extend_from_slice(&a.ttl.to_be_bytes());
        b.extend_from_slice(&(a.rdata.len() as u16).to_be_bytes());
        b.extend_from_slice(&a.rdata);
    }
    b
}

/// The empty-AAAA policy (documented): the stack is IPv4-only, so we answer AAAA queries HONESTLY with
/// `NOERROR` and zero answers — NOT an error. Returning SERVFAIL/NXDOMAIN or a bogus record would make
/// guests slow via happy-eyeballs timeouts; an empty NOERROR tells the resolver "no AAAA here, use A".
pub fn empty_aaaa(query: &Query) -> Vec<u8> {
    build_response(query, RCODE_NOERROR, &[])
}

/// A `SERVFAIL` response (resolver failed / unreachable) — the guest fails fast instead of hanging.
pub fn servfail(query: &Query) -> Vec<u8> {
    build_response(query, RCODE_SERVFAIL, &[])
}

/// An `NXDOMAIN` response (the name does not exist).
pub fn nxdomain(query: &Query) -> Vec<u8> {
    build_response(query, RCODE_NXDOMAIN, &[])
}

#[cfg(test)]
mod tests;
