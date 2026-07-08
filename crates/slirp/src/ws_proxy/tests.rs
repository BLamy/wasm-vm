//! ws-proxy codec tests: byte-exact conformance vectors (the shared client/server contract), full
//! round-trip of every frame, and the adversarial fuzz the charter calls out (malformed frames must
//! never panic).

use super::*;

/// Every frame encodes then decodes back to itself.
#[test]
fn every_frame_round_trips() {
    let frames = [
        Frame::Hello {
            version: VERSION,
            token: b"tok".to_vec(),
        },
        Frame::Hello {
            version: VERSION,
            token: vec![], // empty token allowed
        },
        Frame::Open {
            stream: 7,
            host: "dl-cdn.alpinelinux.org".to_string(),
            port: 443,
        },
        Frame::OpenOk { stream: 7 },
        Frame::OpenFail {
            stream: 7,
            code: 111,
        },
        Frame::Data {
            stream: 7,
            bytes: b"GET / HTTP/1.1\r\n\r\n".to_vec(),
        },
        Frame::Data {
            stream: 7,
            bytes: vec![], // empty DATA (e.g. a keepalive) round-trips
        },
        Frame::ShutdownWr { stream: 7 },
        Frame::Close { stream: 7 },
        Frame::Rst { stream: 7 },
        Frame::Window {
            stream: 7,
            credit: 65536,
        },
    ];
    for f in frames {
        let wire = f.encode().expect("encodes");
        assert_eq!(Frame::decode(&wire), Some(f.clone()), "round-trip {f:?}");
    }
}

/// Byte-exact conformance vectors — pin the wire format so the client, server, and any future
/// re-implementation agree. `[stream_id(4 BE)][opcode(1)][payload]`.
#[test]
fn conformance_vectors_are_byte_exact() {
    // HELLO v1, token "hi": stream 0, op 0, version 1, "hi".
    assert_eq!(
        Frame::Hello {
            version: 1,
            token: b"hi".to_vec()
        }
        .encode()
        .unwrap(),
        vec![0, 0, 0, 0, /*op*/ 0, /*ver*/ 1, b'h', b'i']
    );
    // OPEN stream 1 → "a.com":80: op 1, host_len 5, "a.com", port 0x0050.
    assert_eq!(
        Frame::Open {
            stream: 1,
            host: "a.com".to_string(),
            port: 80
        }
        .encode()
        .unwrap(),
        vec![0, 0, 0, 1, 1, 5, b'a', b'.', b'c', b'o', b'm', 0x00, 0x50]
    );
    // WINDOW stream 0x01020304 credit 256: op 8, credit BE.
    assert_eq!(
        Frame::Window {
            stream: 0x0102_0304,
            credit: 256
        }
        .encode()
        .unwrap(),
        vec![1, 2, 3, 4, 8, 0x00, 0x00, 0x01, 0x00]
    );
    // RST stream 9: op 7, no payload.
    assert_eq!(
        Frame::Rst { stream: 9 }.encode().unwrap(),
        vec![0, 0, 0, 9, 7]
    );
}

#[test]
fn a_255_byte_host_is_the_max_a_longer_one_is_rejected() {
    let ok = Frame::Open {
        stream: 1,
        host: "a".repeat(255),
        port: 80,
    };
    assert!(ok.encode().is_some(), "a 255-byte host encodes");
    let too_long = Frame::Open {
        stream: 1,
        host: "a".repeat(256),
        port: 80,
    };
    assert!(
        too_long.encode().is_none(),
        "a 256-byte host can't be u8-length-prefixed"
    );
}

#[test]
fn hello_must_be_on_stream_zero_and_others_must_not() {
    // A HELLO on a nonzero stream is a protocol error.
    let mut bad_hello = Frame::Hello {
        version: 1,
        token: vec![],
    }
    .encode()
    .unwrap();
    bad_hello[3] = 1; // stream_id = 1
    assert!(
        Frame::decode(&bad_hello).is_none(),
        "HELLO must be on stream 0"
    );

    // A per-flow frame (OPEN_OK) on the control stream (0) is a protocol error.
    let mut bad_ok = Frame::OpenOk { stream: 5 }.encode().unwrap();
    bad_ok[0..4].copy_from_slice(&0u32.to_be_bytes());
    assert!(
        Frame::decode(&bad_ok).is_none(),
        "per-flow frame needs a nonzero stream"
    );
}

#[test]
fn malformed_frames_never_panic_and_decode_to_none() {
    // Short / no header.
    assert!(Frame::decode(&[]).is_none());
    assert!(Frame::decode(&[0, 0, 0, 1]).is_none(), "4 bytes: no opcode");

    // Unknown opcode.
    assert!(Frame::decode(&[0, 0, 0, 1, 99]).is_none());

    // HELLO with no version byte.
    assert!(Frame::decode(&[0, 0, 0, 0, 0]).is_none());

    // OPEN whose host_len runs past the buffer.
    assert!(
        Frame::decode(&[0, 0, 0, 1, 1, 200, b'x']).is_none(),
        "host_len overruns"
    );
    // OPEN with a host but no room for the 2-byte port.
    assert!(
        Frame::decode(&[0, 0, 0, 1, 1, 1, b'x']).is_none(),
        "no port bytes"
    );
    // OPEN with a non-UTF8 host.
    assert!(Frame::decode(&[0, 0, 0, 1, 1, 1, 0xff, 0x00, 0x50]).is_none());

    // WINDOW with the wrong credit length.
    assert!(
        Frame::decode(&[0, 0, 0, 1, 8, 0, 0, 1]).is_none(),
        "credit must be exactly 4 bytes"
    );
    // A no-payload opcode carrying a stray payload byte.
    assert!(
        Frame::decode(&[0, 0, 0, 1, 7, 0xAB]).is_none(),
        "RST takes no payload"
    );

    // Fuzz: every truncation + single-byte corruption of a set of valid frames, and structured random.
    let valids: Vec<Vec<u8>> = [
        Frame::Hello {
            version: 1,
            token: b"t".to_vec(),
        },
        Frame::Open {
            stream: 3,
            host: "h.io".into(),
            port: 22,
        },
        Frame::Data {
            stream: 3,
            bytes: b"payload".to_vec(),
        },
        Frame::Window {
            stream: 3,
            credit: 1,
        },
    ]
    .iter()
    .map(|f| f.encode().unwrap())
    .collect();
    for v in &valids {
        for cut in 0..=v.len() {
            let _ = Frame::decode(&v[..cut]);
        }
        for i in 0..v.len() {
            let mut m = v.clone();
            m[i] ^= 0xff;
            let _ = Frame::decode(&m); // any result, just no panic
        }
    }
    // Structured-random buffers (xorshift, deterministic).
    let mut seed = 0x1234_5678u32;
    let mut rng = || {
        seed ^= seed << 13;
        seed ^= seed >> 17;
        seed ^= seed << 5;
        seed
    };
    for _ in 0..50_000 {
        let len = (rng() as usize) % 40;
        let m: Vec<u8> = (0..len).map(|_| (rng() & 0xff) as u8).collect();
        let _ = Frame::decode(&m); // must not panic
    }
}
