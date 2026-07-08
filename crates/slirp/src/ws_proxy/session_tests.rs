//! Session tests: the HELLO handshake (round-trip, version-mismatch refusal, non-HELLO first
//! frame, token plumbing) and the ordering gate — streams are refused before HELLO, routed after,
//! and a second HELLO is rejected.

use super::{HandshakeError, Session, SessionError, accept_hello, hello};
use crate::ws_proxy::{Frame, MuxEvent, Role, VERSION};

#[test]
fn hello_round_trips_and_carries_the_token() {
    let h = hello(b"secret".to_vec());
    assert_eq!(
        h,
        Frame::Hello {
            version: VERSION,
            token: b"secret".to_vec()
        }
    );
    // The peer accepts our version and gets our token back.
    assert_eq!(accept_hello(&h), Ok(b"secret".to_vec()));
    // An empty token is fine.
    assert_eq!(accept_hello(&hello(vec![])), Ok(vec![]));
}

#[test]
fn a_version_mismatch_is_refused() {
    let future = Frame::Hello {
        version: VERSION + 1,
        token: vec![],
    };
    assert_eq!(
        accept_hello(&future),
        Err(HandshakeError::VersionMismatch {
            peer: VERSION + 1,
            ours: VERSION
        })
    );
}

#[test]
fn a_non_hello_first_frame_is_refused() {
    assert_eq!(
        accept_hello(&Frame::Data {
            stream: 1,
            bytes: vec![]
        }),
        Err(HandshakeError::NotHello)
    );
}

#[test]
fn streams_are_refused_before_the_handshake() {
    let mut server = Session::new(Role::Server);
    assert!(!server.is_ready());
    assert!(server.mux().is_none() && server.mux_mut().is_none());
    // A stream frame before HELLO → NotReady, not routed.
    assert_eq!(
        server.on_frame(Frame::Open {
            stream: 1,
            host: "a".into(),
            port: 80
        }),
        Err(SessionError::NotReady)
    );
}

#[test]
fn a_version_mismatched_peer_never_reaches_the_mux() {
    let mut server = Session::new(Role::Server);
    let bad = Frame::Hello {
        version: VERSION + 7,
        token: vec![],
    };
    assert_eq!(
        server.on_hello(&bad),
        Err(SessionError::Handshake(HandshakeError::VersionMismatch {
            peer: VERSION + 7,
            ours: VERSION
        }))
    );
    // Still not ready — no mux, streams still refused.
    assert!(!server.is_ready());
    assert_eq!(
        server.on_frame(Frame::Data {
            stream: 1,
            bytes: vec![1]
        }),
        Err(SessionError::NotReady)
    );
}

#[test]
fn after_hello_streams_route_to_the_mux() {
    // A full handshake on both ends, then a client-originated open routes through the server session.
    let mut client = Session::new(Role::Client);
    let mut server = Session::new(Role::Server);
    server.on_hello(&client.hello(vec![])).unwrap();
    client.on_hello(&server.hello(vec![])).unwrap();
    assert!(client.is_ready() && server.is_ready());

    let (sid, open) = client
        .mux_mut()
        .unwrap()
        .open("echo.local".into(), 7)
        .unwrap();
    assert_eq!(
        server.on_frame(open).unwrap(),
        MuxEvent::OpenRequested {
            stream: sid,
            host: "echo.local".into(),
            port: 7
        }
    );
    assert_eq!(server.mux().unwrap().live_count(), 1);
}

#[test]
fn a_second_hello_after_ready_is_rejected() {
    let mut server = Session::new(Role::Server);
    server.on_hello(&hello(vec![])).unwrap();
    assert!(server.is_ready());
    assert_eq!(
        server.on_hello(&hello(vec![])),
        Err(SessionError::AlreadyReady)
    );
}

#[test]
fn the_session_carries_its_role_into_the_mux() {
    let mut client = Session::new(Role::Client);
    assert_eq!(client.role(), Role::Client);
    client.on_hello(&hello(vec![])).unwrap();
    assert_eq!(client.mux().unwrap().role(), Role::Client);

    let mut server = Session::new(Role::Server);
    server.on_hello(&hello(vec![])).unwrap();
    assert_eq!(server.mux().unwrap().role(), Role::Server);
}
