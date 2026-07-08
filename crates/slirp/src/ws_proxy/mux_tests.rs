//! Mux tests: the client/server open handshake, routing an inbound frame to the right stream, and
//! the connection-level violations the lower layers can't catch — DATA before OPEN, id reuse, a
//! frame for a reaped stream, role violations, and the unbounded-open cap + reap-on-disconnect.

use super::{MAX_STREAMS, Mux, MuxError, MuxEvent, Role};
use crate::ws_proxy::{Frame, StreamError};

/// A full client→server open, a credited DATA each way, and a clean close that reaps both ends.
#[test]
fn full_open_transfer_close_across_both_ends() {
    let mut client = Mux::new(Role::Client);
    let mut server = Mux::new(Role::Server);

    // Client opens; server sees the request.
    let (sid, open) = client.open("echo.local".into(), 7).unwrap();
    assert_eq!(
        server.on_frame(open).unwrap(),
        MuxEvent::OpenRequested {
            stream: sid,
            host: "echo.local".into(),
            port: 7
        }
    );
    assert_eq!(server.live_count(), 1);

    // Server connected → OPEN_OK; client confirms.
    let ok = server.open_succeeded(sid).unwrap();
    assert_eq!(client.on_frame(ok).unwrap(), MuxEvent::Opened(sid));

    // Server grants the client 5 bytes; client sends exactly 5.
    let win = server.grant(sid, 5).unwrap();
    assert_eq!(
        client.on_frame(win).unwrap(),
        MuxEvent::WindowGranted {
            stream: sid,
            credit: 5
        }
    );
    let data = client.send_data(sid, b"hello".to_vec()).unwrap();
    assert_eq!(
        server.on_frame(data).unwrap(),
        MuxEvent::Data {
            stream: sid,
            bytes: b"hello".to_vec()
        }
    );

    // Client closes; both ends reap the stream.
    let close = client.local_close(sid).unwrap();
    assert_eq!(client.live_count(), 0, "closer reaped locally");
    assert_eq!(server.on_frame(close).unwrap(), MuxEvent::Closed(sid));
    assert_eq!(server.live_count(), 0, "peer reaped on CLOSE");
}

#[test]
fn data_before_open_is_rejected() {
    // The charter's headline case: DATA for a stream the server never OPENed.
    let mut server = Mux::new(Role::Server);
    let stray = Frame::Data {
        stream: 9,
        bytes: b"x".to_vec(),
    };
    assert_eq!(server.on_frame(stray), Err(MuxError::UnknownStream(9)));
    // WINDOW / SHUTDOWN_WR / CLOSE / RST for an unopened stream are likewise rejected.
    assert_eq!(
        server.on_frame(Frame::Window {
            stream: 9,
            credit: 1
        }),
        Err(MuxError::UnknownStream(9))
    );
    assert_eq!(
        server.on_frame(Frame::ShutdownWr { stream: 9 }),
        Err(MuxError::UnknownStream(9))
    );
    assert_eq!(
        server.on_frame(Frame::Close { stream: 9 }),
        Err(MuxError::UnknownStream(9))
    );
    assert_eq!(server.live_count(), 0, "no phantom stream created");
}

#[test]
fn open_reusing_a_live_id_is_rejected() {
    let mut server = Mux::new(Role::Server);
    server
        .on_frame(Frame::Open {
            stream: 3,
            host: "a".into(),
            port: 80,
        })
        .unwrap();
    // A second OPEN for the still-live id 3 is a reuse violation.
    assert_eq!(
        server.on_frame(Frame::Open {
            stream: 3,
            host: "b".into(),
            port: 81
        }),
        Err(MuxError::StreamExists(3))
    );
    assert_eq!(server.live_count(), 1);
}

#[test]
fn a_frame_for_a_reaped_stream_is_unknown() {
    // After CLOSE reaps a stream, a late DATA for that id is UnknownStream (not a resurrection),
    // and the id may be OPENed fresh again.
    let mut server = Mux::new(Role::Server);
    server
        .on_frame(Frame::Open {
            stream: 4,
            host: "a".into(),
            port: 80,
        })
        .unwrap();
    server.on_frame(Frame::Close { stream: 4 }).unwrap();
    assert_eq!(server.live_count(), 0);
    assert_eq!(
        server.on_frame(Frame::Data {
            stream: 4,
            bytes: vec![1]
        }),
        Err(MuxError::UnknownStream(4)),
        "late frame for a reaped stream"
    );
    // The id is free again.
    assert_eq!(
        server.on_frame(Frame::Open {
            stream: 4,
            host: "c".into(),
            port: 82
        }),
        Ok(MuxEvent::OpenRequested {
            stream: 4,
            host: "c".into(),
            port: 82
        })
    );
}

#[test]
fn a_hacked_client_sending_past_credit_surfaces_as_a_stream_violation() {
    // Server OPENs a stream but grants zero credit; the client blasts data → RecvCreditExceeded
    // wrapped as a Stream error the caller acts on by killing the stream/connection.
    let mut server = Mux::new(Role::Server);
    server
        .on_frame(Frame::Open {
            stream: 2,
            host: "a".into(),
            port: 80,
        })
        .unwrap();
    let flood = Frame::Data {
        stream: 2,
        bytes: vec![0u8; 1_000_000],
    };
    assert_eq!(
        server.on_frame(flood),
        Err(MuxError::Stream(2, StreamError::RecvCreditExceeded))
    );
}

#[test]
fn roles_are_enforced_both_directions() {
    let mut client = Mux::new(Role::Client);
    let mut server = Mux::new(Role::Server);

    // A client must not receive OPEN; a server must not receive OPEN_OK.
    assert_eq!(
        client.on_frame(Frame::Open {
            stream: 1,
            host: "a".into(),
            port: 80
        }),
        Err(MuxError::RoleViolation)
    );
    assert_eq!(
        server.on_frame(Frame::OpenOk { stream: 1 }),
        Err(MuxError::RoleViolation)
    );
    // A server can't originate via open(); a client can't answer via open_succeeded().
    assert_eq!(server.open("a".into(), 80), Err(MuxError::RoleViolation));
    assert_eq!(client.open_succeeded(1), Err(MuxError::RoleViolation));
}

#[test]
fn open_ok_or_fail_for_an_unknown_stream_is_rejected() {
    let mut client = Mux::new(Role::Client);
    // No pending stream 5.
    assert_eq!(
        client.on_frame(Frame::OpenOk { stream: 5 }),
        Err(MuxError::UnknownStream(5))
    );
    assert_eq!(
        client.on_frame(Frame::OpenFail { stream: 5, code: 1 }),
        Err(MuxError::UnknownStream(5))
    );
    // A double OPEN_OK is rejected: the id leaves `pending` on the first.
    let (sid, _open) = client.open("a".into(), 80).unwrap();
    client.on_frame(Frame::OpenOk { stream: sid }).unwrap();
    assert_eq!(
        client.on_frame(Frame::OpenOk { stream: sid }),
        Err(MuxError::UnknownStream(sid)),
        "OPEN_OK is not idempotent — the stream is already confirmed"
    );
}

#[test]
fn open_fail_reaps_the_pending_client_stream() {
    let mut client = Mux::new(Role::Client);
    let (sid, _open) = client.open("nope.local".into(), 9).unwrap();
    assert_eq!(client.live_count(), 1);
    assert_eq!(
        client
            .on_frame(Frame::OpenFail {
                stream: sid,
                code: 111
            })
            .unwrap(),
        MuxEvent::OpenFailed {
            stream: sid,
            code: 111
        }
    );
    assert_eq!(client.live_count(), 0, "a refused open leaves no stream");
}

#[test]
fn hello_reaching_the_mux_is_an_error() {
    let mut server = Mux::new(Role::Server);
    assert_eq!(
        server.on_frame(Frame::Hello {
            version: 1,
            token: vec![]
        }),
        Err(MuxError::UnexpectedHello)
    );
}

#[test]
fn client_allocates_distinct_nonzero_ids_and_reuses_freed_ones() {
    let mut client = Mux::new(Role::Client);
    let (a, _) = client.open("h".into(), 1).unwrap();
    let (b, _) = client.open("h".into(), 2).unwrap();
    assert_ne!(a, b);
    assert!(a != 0 && b != 0, "stream 0 is reserved");
    // Confirm + close `a`, freeing its id; a later open may reuse it (BTreeMap has no live entry).
    client.on_frame(Frame::OpenOk { stream: a }).unwrap();
    client.local_close(a).unwrap();
    assert_eq!(client.live_count(), 1, "only b remains");
}

#[test]
fn the_stream_cap_refuses_unbounded_opens_and_reap_all_frees_everything() {
    // Fill a server to MAX_STREAMS via inbound OPENs, then one more is refused.
    let mut server = Mux::new(Role::Server);
    for i in 1..=MAX_STREAMS as u32 {
        server
            .on_frame(Frame::Open {
                stream: i,
                host: "h".into(),
                port: 80,
            })
            .unwrap();
    }
    assert_eq!(server.live_count(), MAX_STREAMS);
    assert_eq!(
        server.on_frame(Frame::Open {
            stream: MAX_STREAMS as u32 + 1,
            host: "h".into(),
            port: 80
        }),
        Err(MuxError::TooManyStreams),
        "unbounded open refused at the cap"
    );
    // WS drop → reap_all returns every id and empties the table (no socket leak).
    let reaped = server.reap_all();
    assert_eq!(reaped.len(), MAX_STREAMS);
    assert_eq!(server.live_count(), 0);
    assert_eq!(reaped[0], 1, "ids returned sorted (BTreeMap order)");
}

#[test]
fn client_open_cap_is_enforced_too() {
    let mut client = Mux::new(Role::Client);
    for _ in 0..MAX_STREAMS {
        client.open("h".into(), 80).unwrap();
    }
    assert_eq!(client.live_count(), MAX_STREAMS);
    assert_eq!(client.open("h".into(), 80), Err(MuxError::TooManyStreams));
}

#[test]
fn a_reset_reaps_and_reports_reset() {
    let mut server = Mux::new(Role::Server);
    server
        .on_frame(Frame::Open {
            stream: 6,
            host: "a".into(),
            port: 80,
        })
        .unwrap();
    assert_eq!(
        server.on_frame(Frame::Rst { stream: 6 }).unwrap(),
        MuxEvent::Reset(6)
    );
    assert_eq!(server.live_count(), 0);
}

#[test]
fn half_close_keeps_the_stream_live_until_close() {
    // SHUTDOWN_WR does NOT reap — data can still flow the other way until CLOSE.
    let mut server = Mux::new(Role::Server);
    server
        .on_frame(Frame::Open {
            stream: 8,
            host: "a".into(),
            port: 80,
        })
        .unwrap();
    // The peer grants the server send credit (inbound WINDOW) so the server can still send after
    // the peer half-closes its own write side.
    server
        .on_frame(Frame::Window {
            stream: 8,
            credit: 10,
        })
        .unwrap();
    assert_eq!(
        server.on_frame(Frame::ShutdownWr { stream: 8 }).unwrap(),
        MuxEvent::PeerShutdown(8)
    );
    assert_eq!(server.live_count(), 1, "half-close is not a reap");
    // The server can still send its late response.
    assert!(server.send_data(8, b"late reply".to_vec()).is_ok());
}
