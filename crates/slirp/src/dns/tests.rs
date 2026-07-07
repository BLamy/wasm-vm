//! DNS wire-layer tests: real query bytes in, assert the parsed fields and the response bytes out,
//! plus the compression-pointer-loop / malformed fuzzing the adversarial charter calls out.

use super::*;

/// Encode a name as DNS labels (`example.com` → 7"example"3"com"0).
fn encode_name(name: &str) -> Vec<u8> {
    let mut v = Vec::new();
    for label in name.split('.').filter(|l| !l.is_empty()) {
        v.push(label.len() as u8);
        v.extend_from_slice(label.as_bytes());
    }
    v.push(0);
    v
}

/// Build a single-question query.
fn build_query(id: u16, name: &str, qtype: u16, rd: bool) -> Vec<u8> {
    let mut b = Vec::new();
    b.extend_from_slice(&id.to_be_bytes());
    b.extend_from_slice(&(if rd { 0x0100u16 } else { 0 }).to_be_bytes());
    b.extend_from_slice(&1u16.to_be_bytes()); // QDCOUNT
    b.extend_from_slice(&[0, 0, 0, 0, 0, 0]); // AN / NS / AR counts
    b.extend_from_slice(&encode_name(name));
    b.extend_from_slice(&qtype.to_be_bytes());
    b.extend_from_slice(&CLASS_IN.to_be_bytes());
    b
}

fn resp_flags(r: &[u8]) -> u16 {
    u16::from_be_bytes([r[2], r[3]])
}
fn resp_ancount(r: &[u8]) -> u16 {
    u16::from_be_bytes([r[6], r[7]])
}
fn resp_rcode(r: &[u8]) -> u8 {
    (resp_flags(r) & 0x000F) as u8
}

#[test]
fn parses_a_query() {
    let q = parse_query(&build_query(0x1234, "dl-cdn.alpinelinux.org", TYPE_A, true))
        .expect("valid query parses");
    assert_eq!(q.id, 0x1234);
    assert_eq!(q.name, "dl-cdn.alpinelinux.org");
    assert_eq!(q.qtype, TYPE_A);
    assert_eq!(q.qclass, CLASS_IN);
    assert!(q.rd, "RD echoed");
    assert!(q.is_a() && !q.is_aaaa());
}

#[test]
fn name_is_lowercased() {
    let q = parse_query(&build_query(1, "EXAMPLE.COM", TYPE_A, false)).unwrap();
    assert_eq!(q.name, "example.com", "names compared case-insensitively");
}

#[test]
fn builds_an_a_response_pointing_at_the_question() {
    let name = "example.com";
    let q = parse_query(&build_query(0xABCD, name, TYPE_A, true)).unwrap();
    let ip = std::net::Ipv4Addr::new(93, 184, 216, 34);
    let resp = build_response(&q, RCODE_NOERROR, &[Answer::a(ip, 300)]);

    assert_eq!(&resp[0..2], &[0xAB, 0xCD], "id echoed");
    assert_eq!(resp_flags(&resp) & 0x8000, 0x8000, "QR=1");
    assert_eq!(resp_flags(&resp) & 0x0080, 0x0080, "RA=1");
    assert_eq!(resp_flags(&resp) & 0x0100, 0x0100, "RD echoed");
    assert_eq!(resp_rcode(&resp), RCODE_NOERROR);
    assert_eq!(resp_ancount(&resp), 1);

    // The answer follows the echoed question.
    let qlen = encode_name(name).len() + 4;
    let ans = &resp[HEADER_LEN + qlen..];
    assert_eq!(
        &ans[0..2],
        &[0xC0, 0x0C],
        "NAME is a pointer to the question at 0x0c"
    );
    assert_eq!(u16::from_be_bytes([ans[2], ans[3]]), TYPE_A);
    assert_eq!(u16::from_be_bytes([ans[4], ans[5]]), CLASS_IN);
    assert_eq!(
        u32::from_be_bytes([ans[6], ans[7], ans[8], ans[9]]),
        300,
        "TTL"
    );
    assert_eq!(u16::from_be_bytes([ans[10], ans[11]]), 4, "RDLENGTH");
    assert_eq!(&ans[12..16], &ip.octets(), "A record RDATA");
}

#[test]
fn aaaa_gets_empty_noerror() {
    let q = parse_query(&build_query(7, "example.com", TYPE_AAAA, true)).unwrap();
    let resp = empty_aaaa(&q);
    assert_eq!(
        resp_rcode(&resp),
        RCODE_NOERROR,
        "empty NOERROR, not an error"
    );
    assert_eq!(resp_ancount(&resp), 0, "no AAAA answers (IPv4-only stack)");
}

#[test]
fn nxdomain_and_servfail_rcodes() {
    let q = parse_query(&build_query(1, "nope.invalid", TYPE_A, true)).unwrap();
    assert_eq!(resp_rcode(&nxdomain(&q)), RCODE_NXDOMAIN);
    assert_eq!(resp_ancount(&nxdomain(&q)), 0);
    assert_eq!(resp_rcode(&servfail(&q)), RCODE_SERVFAIL);
    assert_eq!(resp_ancount(&servfail(&q)), 0);
}

#[test]
fn rejects_non_queries_and_bad_question_counts() {
    // QR=1 (a response).
    let mut resp = build_query(1, "example.com", TYPE_A, true);
    resp[2] |= 0x80;
    assert!(parse_query(&resp).is_none(), "QR=1 rejected");

    // QDCOUNT=0.
    let mut zero_qd = build_query(1, "example.com", TYPE_A, true);
    zero_qd[4] = 0;
    zero_qd[5] = 0;
    assert!(
        parse_query(&zero_qd).is_none(),
        "zero-question query rejected"
    );

    // QDCOUNT=2.
    let mut two_qd = build_query(1, "example.com", TYPE_A, true);
    two_qd[5] = 2;
    assert!(
        parse_query(&two_qd).is_none(),
        "multi-question query rejected"
    );

    // Shorter than the header.
    assert!(parse_query(&[0u8; 5]).is_none());
    // Header only, no question.
    assert!(parse_query(&[0u8; HEADER_LEN]).is_none());
}

#[test]
fn compression_pointers_are_loop_safe() {
    // parse_name directly: a name at offset 4, then a backward pointer to it resolves.
    let mut buf = vec![0u8; 4];
    buf.extend_from_slice(&encode_name("a.b")); // name at offset 4
    let name_at_4 = parse_name(&buf, 4).expect("plain name parses");
    assert_eq!(name_at_4.0, "a.b");

    // A pointer at offset `p` pointing BACK to offset 4 resolves to the same name.
    let p = buf.len();
    buf.push(0xC0);
    buf.push(4); // → offset 4
    let via_ptr = parse_name(&buf, p).expect("backward pointer resolves");
    assert_eq!(via_ptr.0, "a.b");
    assert_eq!(via_ptr.1, p + 2, "sequence continues just past the pointer");

    // A self-pointer (ptr == pos) is rejected — not <= a loop.
    let self_ptr = vec![0xC0u8, 0x00]; // at offset 0, points to 0
    assert!(parse_name(&self_ptr, 0).is_none(), "self-pointer rejected");

    // A forward pointer (ptr > pos) is rejected.
    let mut fwd = vec![0u8; 10];
    fwd[0] = 0xC0;
    fwd[1] = 8; // points forward to 8
    assert!(parse_name(&fwd, 0).is_none(), "forward pointer rejected");

    // A two-pointer mutual loop: A@2→4, B@4→2. Backward-only rule breaks it (4→2 ok, 2→4 is forward).
    let loopy = vec![0x00, 0x00, 0xC0, 0x04, 0xC0, 0x02];
    assert!(
        parse_name(&loopy, 2).is_none(),
        "mutual pointer loop cannot hang"
    );
}

#[test]
fn oversized_name_rejected() {
    // A name longer than 255 encoded bytes must be rejected (not OOM / hang).
    let mut b = 0u16.to_be_bytes().to_vec();
    b.extend_from_slice(&0u16.to_be_bytes());
    b.extend_from_slice(&1u16.to_be_bytes());
    b.extend_from_slice(&[0, 0, 0, 0, 0, 0]);
    for _ in 0..40 {
        b.push(6);
        b.extend_from_slice(b"labell"); // 40 * 7 = 280 bytes > 255
    }
    b.push(0);
    b.extend_from_slice(&TYPE_A.to_be_bytes());
    b.extend_from_slice(&CLASS_IN.to_be_bytes());
    assert!(parse_query(&b).is_none(), "oversized name rejected");
}

#[test]
fn malformed_queries_never_panic() {
    assert!(parse_query(&[]).is_none());

    let valid = build_query(0x4242, "dl-cdn.alpinelinux.org", TYPE_A, true);
    // Every truncation must be handled.
    for cut in 0..valid.len() {
        let _ = parse_query(&valid[..cut]);
    }
    // Every single-byte corruption must be handled (any output, just no panic).
    for i in 0..valid.len() {
        let mut m = valid.clone();
        m[i] ^= 0xff;
        let _ = parse_query(&m);
    }
    // A pile of structured-random inputs: random-length buffers with a plausible header.
    let mut seed = 0x9e3779b9u32;
    let mut rng = || {
        seed ^= seed << 13;
        seed ^= seed >> 17;
        seed ^= seed << 5;
        seed
    };
    for _ in 0..20_000 {
        let len = (rng() as usize % 300) + 1;
        let mut m: Vec<u8> = (0..len).map(|_| (rng() & 0xff) as u8).collect();
        if m.len() >= 6 {
            // force QDCOUNT=1 sometimes to drive deeper into the name parser
            m[4] = 0;
            m[5] = 1;
        }
        let _ = parse_query(&m); // must not panic
    }
}
