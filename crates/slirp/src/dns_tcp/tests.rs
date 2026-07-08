//! DNS-over-TCP framing tests: frame↔parse round-trip, partial/pipelined stream buffers, oversized
//! rejection, and (integration with the real query/response parsers) a length-prefixed A query →
//! answer over the TCP framing.

use super::*;

#[test]
fn frame_then_parse_round_trips() {
    let msg = b"a dns message body";
    let framed = frame_message(msg).unwrap();
    assert_eq!(
        &framed[0..2],
        &(msg.len() as u16).to_be_bytes(),
        "2-byte length prefix"
    );
    match next_message(&framed) {
        TcpFrame::Message { msg: got, consumed } => {
            assert_eq!(got, msg);
            assert_eq!(consumed, framed.len());
        }
        other => panic!("expected a whole message, got {other:?}"),
    }
}

#[test]
fn a_partial_buffer_reports_need_more_with_the_total() {
    let framed = frame_message(b"hello").unwrap(); // 2 + 5 = 7 bytes
    // Only the length prefix so far → need the whole 7 bytes.
    assert_eq!(
        next_message(&framed[..2]),
        TcpFrame::NeedMore { need_total: 7 }
    );
    // Prefix + partial body → still need 7.
    assert_eq!(
        next_message(&framed[..5]),
        TcpFrame::NeedMore { need_total: 7 }
    );
    // Fewer than the 2-byte prefix → need at least the prefix.
    assert_eq!(
        next_message(&framed[..1]),
        TcpFrame::NeedMore { need_total: 2 }
    );
    assert_eq!(next_message(&[]), TcpFrame::NeedMore { need_total: 2 });
}

#[test]
fn pipelined_messages_are_pulled_one_at_a_time() {
    // Two messages back-to-back in one stream buffer.
    let mut buf = frame_message(b"first").unwrap();
    buf.extend_from_slice(&frame_message(b"second").unwrap());

    let TcpFrame::Message { msg, consumed } = next_message(&buf) else {
        panic!("first message");
    };
    assert_eq!(msg, b"first");
    // Advance past the first; the second is now at the front.
    let rest = &buf[consumed..];
    let TcpFrame::Message { msg, consumed: c2 } = next_message(rest) else {
        panic!("second message");
    };
    assert_eq!(msg, b"second");
    assert_eq!(consumed + c2, buf.len(), "both messages consumed exactly");
    // Nothing left.
    assert_eq!(
        next_message(&rest[c2..]),
        TcpFrame::NeedMore { need_total: 2 }
    );
}

#[test]
fn a_zero_length_message_consumes_the_prefix_and_makes_progress() {
    // A declared length of 0 → an empty Message consuming the 2-byte prefix (no stall).
    let buf = [0u8, 0, 0xAB]; // length=0, then a stray byte
    match next_message(&buf) {
        TcpFrame::Message { msg, consumed } => {
            assert!(msg.is_empty());
            assert_eq!(consumed, 2, "only the prefix consumed");
        }
        other => panic!("expected an empty message, got {other:?}"),
    }
}

#[test]
fn oversized_message_cannot_be_framed() {
    // A body over 65535 bytes can't be described by the u16 length prefix.
    let too_big = vec![0u8; 65536];
    assert!(frame_message(&too_big).is_none());
    // The exact max frames fine.
    let max = vec![0u8; 65535];
    assert_eq!(frame_message(&max).unwrap().len(), 2 + 65535);
}

// ── Integration with the real DNS parsers over the TCP framing ───────────────
use crate::dns::{self, CLASS_IN, TYPE_A};

fn encode_name(name: &str) -> Vec<u8> {
    let mut v = Vec::new();
    for label in name.split('.').filter(|l| !l.is_empty()) {
        v.push(label.len() as u8);
        v.extend_from_slice(label.as_bytes());
    }
    v.push(0);
    v
}

#[test]
fn a_length_prefixed_query_parses_and_an_answer_frames_back() {
    // A guest sends a length-prefixed DNS A query over the TCP stream.
    let query = dns::build_query(0x1234, "example.com", TYPE_A);
    let stream = frame_message(&query).unwrap();

    // The server pulls the whole message and parses it with the SAME UDP parser.
    let TcpFrame::Message { msg, .. } = next_message(&stream) else {
        panic!("whole query");
    };
    let q = dns::parse_query(&msg).expect("the de-framed query parses");
    assert_eq!(q.name, "example.com");
    assert_eq!(q.qtype, TYPE_A);

    // It answers with build_response, framed for TCP.
    let ip = std::net::Ipv4Addr::new(93, 184, 216, 34);
    let resp = dns::build_response(&q, dns::RCODE_NOERROR, &[dns::Answer::a(ip, 300)]);
    let framed = frame_message(&resp).unwrap();
    let TcpFrame::Message { msg: got, .. } = next_message(&framed) else {
        panic!("whole answer");
    };
    let info = dns::parse_response(&got).unwrap();
    assert_eq!(info.a_records, vec![(ip, 300)]);
}

#[test]
fn truncated_udp_response_sets_the_tc_bit() {
    // The UDP-side trigger for the TCP fallback: dns::truncated marks TC=1 so the guest retries over TCP.
    let query = dns::build_query(1, "example.com", TYPE_A);
    let q = dns::parse_query(&query).unwrap();
    let tc = dns::truncated(&q);
    let flags = u16::from_be_bytes([tc[2], tc[3]]);
    assert_eq!(flags & 0x8000, 0x8000, "QR=1 (a response)");
    assert_eq!(flags & 0x0200, 0x0200, "TC=1 (truncated)");
    assert_eq!(
        flags & 0x000F,
        0,
        "NOERROR — the name resolved, the answer just didn't fit UDP"
    );
    // A truncated response carries the question but no answers.
    assert_eq!(u16::from_be_bytes([tc[6], tc[7]]), 0, "no answers");
    // Sanity: the echoed question is present (header + name + qtype + qclass).
    let qlen = encode_name("example.com").len() + 4;
    assert_eq!(tc.len(), 12 + qlen);
    assert_eq!(&tc[12 + qlen - 4..12 + qlen - 2], &TYPE_A.to_be_bytes());
    assert_eq!(&tc[12 + qlen - 2..12 + qlen], &CLASS_IN.to_be_bytes());
}
