//! RelayCore tests: the full server policy as a pure step function — handshake, the
//! connect→OPEN_OK→initial-window handshake, guest→backend writes with credit re-grant,
//! backend→guest data under the guest's credit (the backpressure seam), half-close both ways,
//! close/RST→socket teardown, and reap-all on WS drop.

use super::{FAIL_CONNECT, INITIAL_WINDOW, RelayActions, RelayCore, RelayError, SocketOp};
use crate::ws_proxy::{Frame, MuxError, SessionError, StreamError, hello};

/// Drive a relay through the handshake and return it ready.
fn ready_relay() -> RelayCore {
    let mut r = RelayCore::new();
    assert!(!r.is_ready());
    let acts = r.on_inbound_frame(hello(vec![])).unwrap();
    assert_eq!(acts, RelayActions::default(), "handshake emits nothing");
    assert!(r.is_ready());
    r
}

/// Open stream `sid` end-to-end: guest OPEN → Connect op → connect ok → OPEN_OK + initial WINDOW.
fn open_stream(r: &mut RelayCore, sid: u32, host: &str, port: u16) {
    let acts = r
        .on_inbound_frame(Frame::Open {
            stream: sid,
            host: host.into(),
            port,
        })
        .unwrap();
    assert_eq!(
        acts.socket_ops,
        vec![SocketOp::Connect {
            stream: sid,
            host: host.into(),
            port
        }]
    );
    assert!(
        acts.ws_sends.is_empty(),
        "OPEN_OK waits for the connect result"
    );

    let acts = r.on_connect_result(sid, true).unwrap();
    assert_eq!(
        acts.ws_sends,
        vec![
            Frame::OpenOk { stream: sid },
            Frame::Window {
                stream: sid,
                credit: INITIAL_WINDOW
            }
        ],
        "on connect: OPEN_OK then the initial window"
    );
    assert_eq!(
        r.send_credit(sid),
        0,
        "guest hasn't granted us send credit yet"
    );
}

#[test]
fn a_stream_before_the_handshake_is_refused() {
    let mut r = RelayCore::new();
    let err = r
        .on_inbound_frame(Frame::Data {
            stream: 1,
            bytes: vec![1],
        })
        .unwrap_err();
    // The handshake path treats the first frame as a HELLO; a DATA is NotHello.
    assert!(matches!(
        err,
        RelayError::Session(SessionError::Handshake(_))
    ));
}

#[test]
fn connect_failure_refuses_the_open() {
    let mut r = ready_relay();
    r.on_inbound_frame(Frame::Open {
        stream: 5,
        host: "nope.local".into(),
        port: 9,
    })
    .unwrap();
    let acts = r.on_connect_result(5, false).unwrap();
    assert_eq!(
        acts.ws_sends,
        vec![Frame::OpenFail {
            stream: 5,
            code: FAIL_CONNECT
        }]
    );
    assert_eq!(r.live_streams(), 0, "a failed connect leaves no stream");
}

#[test]
fn a_duplicate_connect_result_is_rejected_and_cannot_double_grant_the_window() {
    // The MAJOR the critic found: without a guard, a second on_connect_result(true) re-grants
    // INITIAL_WINDOW (window doubles) and re-emits OPEN_OK. The `connecting` guard rejects it.
    let mut r = ready_relay();
    open_stream(&mut r, 1, "echo.local", 7); // performs exactly one on_connect_result(true)
    let err = r.on_connect_result(1, true).unwrap_err();
    assert_eq!(
        err,
        RelayError::UnknownStream(1),
        "a second connect-result has no outstanding connect to satisfy"
    );
    // Prove the window was NOT doubled: the guest may send exactly INITIAL_WINDOW before a
    // credit violation (513 KiB would be accepted if the window had doubled to 512 KiB).
    let one_over = r.on_inbound_frame(Frame::Data {
        stream: 1,
        bytes: vec![0u8; INITIAL_WINDOW as usize + 1],
    });
    assert!(
        matches!(one_over, Err(RelayError::Mux(MuxError::Stream(1, _)))),
        "the window is still exactly INITIAL_WINDOW, not doubled"
    );
}

#[test]
fn a_connect_result_for_an_unopened_stream_is_rejected() {
    let mut r = ready_relay();
    assert_eq!(
        r.on_connect_result(42, true).unwrap_err(),
        RelayError::UnknownStream(42)
    );
}

#[test]
fn the_relay_offers_its_own_hello_for_the_driver_to_send() {
    // Both ends send a HELLO as their opening frame; the driver sends this at connection open.
    let r = RelayCore::new();
    assert_eq!(r.hello(b"srv".to_vec()), hello(b"srv".to_vec()));
}

#[test]
fn guest_data_is_written_to_the_backend_and_the_window_refills_on_drain() {
    let mut r = ready_relay();
    open_stream(&mut r, 1, "echo.local", 7);
    // The guest sends within the window it was granted: bytes go to the backend, and NO window is
    // refilled yet — the refill is tied to the backend accepting the bytes, not to receipt.
    let acts = r
        .on_inbound_frame(Frame::Data {
            stream: 1,
            bytes: b"hello".to_vec(),
        })
        .unwrap();
    assert_eq!(
        acts.socket_ops,
        vec![SocketOp::Write {
            stream: 1,
            bytes: b"hello".to_vec()
        }],
        "guest bytes go to the backend"
    );
    assert!(
        acts.ws_sends.is_empty(),
        "no refill until the backend drains the bytes"
    );
    // Once the backend accepts the 5 bytes, the window is refilled by exactly 5.
    let acts = r.on_backend_written(1, 5).unwrap();
    assert_eq!(
        acts.ws_sends,
        vec![Frame::Window {
            stream: 1,
            credit: 5
        }],
        "the drained bytes are re-granted"
    );
    // A refill for a stream that was already reaped is silently dropped (no error, no frame).
    r.on_inbound_frame(Frame::Close { stream: 1 }).unwrap();
    assert_eq!(r.on_backend_written(1, 3).unwrap(), Default::default());
}

#[test]
fn backend_data_flows_to_the_guest_only_under_granted_credit() {
    let mut r = ready_relay();
    open_stream(&mut r, 1, "echo.local", 7);
    // Backend has data but the guest granted no send credit yet → the driver would read 0 bytes.
    assert_eq!(r.send_credit(1), 0);
    // Guest grants us 4 bytes.
    r.on_inbound_frame(Frame::Window {
        stream: 1,
        credit: 4,
    })
    .unwrap();
    assert_eq!(
        r.send_credit(1),
        4,
        "the driver may now read up to 4 backend bytes"
    );

    // The driver reads exactly 4 (== credit) and hands them over → one DATA frame.
    let acts = r.on_socket_data(1, b"data".to_vec()).unwrap();
    assert_eq!(
        acts.ws_sends,
        vec![Frame::Data {
            stream: 1,
            bytes: b"data".to_vec()
        }]
    );
    assert_eq!(
        r.send_credit(1),
        0,
        "credit consumed — backend read must pause"
    );
}

#[test]
fn a_driver_that_overruns_the_guests_credit_is_a_violation() {
    // Defensive: if the driver hands over more than send_credit (a bug), the mux rejects it rather
    // than the guest being flooded past its window.
    let mut r = ready_relay();
    open_stream(&mut r, 1, "echo.local", 7);
    r.on_inbound_frame(Frame::Window {
        stream: 1,
        credit: 2,
    })
    .unwrap();
    let err = r.on_socket_data(1, b"too much".to_vec()).unwrap_err();
    assert_eq!(
        err,
        RelayError::Mux(MuxError::Stream(1, StreamError::SendCreditExceeded))
    );
}

#[test]
fn guest_half_close_shuts_down_the_backend_write_side() {
    let mut r = ready_relay();
    open_stream(&mut r, 1, "echo.local", 7);
    let acts = r.on_inbound_frame(Frame::ShutdownWr { stream: 1 }).unwrap();
    assert_eq!(acts.socket_ops, vec![SocketOp::ShutdownWrite { stream: 1 }]);
    assert_eq!(r.live_streams(), 1, "half-close keeps the stream live");
}

#[test]
fn backend_eof_half_closes_toward_the_guest() {
    let mut r = ready_relay();
    open_stream(&mut r, 1, "echo.local", 7);
    let acts = r.on_socket_eof(1).unwrap();
    assert_eq!(acts.ws_sends, vec![Frame::ShutdownWr { stream: 1 }]);
    assert_eq!(r.live_streams(), 1);
}

#[test]
fn backend_error_resets_the_stream() {
    let mut r = ready_relay();
    open_stream(&mut r, 1, "echo.local", 7);
    let acts = r.on_socket_error(1).unwrap();
    assert_eq!(acts.ws_sends, vec![Frame::Rst { stream: 1 }]);
    assert_eq!(r.live_streams(), 0, "RST reaps the stream");
}

#[test]
fn guest_close_drops_the_backend_socket() {
    let mut r = ready_relay();
    open_stream(&mut r, 1, "echo.local", 7);
    let acts = r.on_inbound_frame(Frame::Close { stream: 1 }).unwrap();
    assert_eq!(acts.socket_ops, vec![SocketOp::Close { stream: 1 }]);
    assert_eq!(r.live_streams(), 0);
}

#[test]
fn ws_drop_reaps_every_backend_socket() {
    let mut r = ready_relay();
    open_stream(&mut r, 1, "a.local", 80);
    open_stream(&mut r, 2, "b.local", 80);
    open_stream(&mut r, 3, "c.local", 80);
    let acts = r.on_ws_closed();
    // A Close op for every live stream, in id order (BTreeMap), no ws_sends.
    assert_eq!(
        acts.socket_ops,
        vec![
            SocketOp::Close { stream: 1 },
            SocketOp::Close { stream: 2 },
            SocketOp::Close { stream: 3 },
        ]
    );
    assert!(acts.ws_sends.is_empty());
    assert_eq!(r.live_streams(), 0, "all sockets reaped, no leak");
}

#[test]
fn concurrent_streams_do_not_share_credit() {
    // Two streams: crediting/consuming one must not affect the other (no head-of-line blocking).
    let mut r = ready_relay();
    open_stream(&mut r, 1, "a.local", 80);
    open_stream(&mut r, 2, "b.local", 80);
    r.on_inbound_frame(Frame::Window {
        stream: 1,
        credit: 10,
    })
    .unwrap();
    assert_eq!(r.send_credit(1), 10);
    assert_eq!(r.send_credit(2), 0, "stream 2's credit is independent");
    // Draining stream 1 leaves stream 2 untouched.
    r.on_socket_data(1, vec![0u8; 10]).unwrap();
    assert_eq!(r.send_credit(1), 0);
    assert_eq!(r.send_credit(2), 0);
    // Now credit stream 2; stream 1 stays at 0.
    r.on_inbound_frame(Frame::Window {
        stream: 2,
        credit: 7,
    })
    .unwrap();
    assert_eq!(r.send_credit(1), 0);
    assert_eq!(r.send_credit(2), 7);
}

#[test]
fn a_guest_that_sends_open_ok_to_the_server_is_a_protocol_error() {
    // OPEN_OK is a client-role frame; a guest sending it to the relay (server) is rejected.
    let mut r = ready_relay();
    let err = r.on_inbound_frame(Frame::OpenOk { stream: 1 }).unwrap_err();
    assert_eq!(err, RelayError::Mux(MuxError::RoleViolation));
}

#[test]
fn data_for_an_unopened_stream_is_rejected() {
    let mut r = ready_relay();
    let err = r
        .on_inbound_frame(Frame::Data {
            stream: 99,
            bytes: vec![1],
        })
        .unwrap_err();
    assert_eq!(err, RelayError::Mux(MuxError::UnknownStream(99)));
}
