//! `NativeConnector` tests against real local tokio sockets — proving the OutboundConnector contract
//! (yields a duplex stream, or a typed failure within the connect timeout; never hangs).

use super::*;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;

#[test]
fn map_io_covers_the_error_table() {
    // Pure, deterministic coverage of the io::Error → ConnectError mapping (no sockets needed).
    use std::io::{Error, ErrorKind};
    let m = |k: ErrorKind| super::map_io(Error::from(k));
    assert_eq!(m(ErrorKind::ConnectionRefused), ConnectError::Refused);
    assert_eq!(m(ErrorKind::ConnectionReset), ConnectError::Refused);
    assert_eq!(m(ErrorKind::ConnectionAborted), ConnectError::Refused);
    assert_eq!(m(ErrorKind::TimedOut), ConnectError::TimedOut);
    assert_eq!(m(ErrorKind::NetworkUnreachable), ConnectError::Unreachable);
    assert_eq!(m(ErrorKind::HostUnreachable), ConnectError::Unreachable);
    assert_eq!(m(ErrorKind::AddrNotAvailable), ConnectError::Unreachable);
    assert!(matches!(
        m(ErrorKind::PermissionDenied),
        ConnectError::Denied(_)
    ));
    // Anything unforeseen is a typed Unreachable, never a panic.
    assert_eq!(m(ErrorKind::Other), ConnectError::Unreachable);
}

#[tokio::test]
async fn connects_to_a_live_listener_and_round_trips() {
    // A local server that echoes one byte back.
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(async move {
        let (mut sock, _) = listener.accept().await.unwrap();
        let mut b = [0u8; 1];
        sock.read_exact(&mut b).await.unwrap();
        sock.write_all(&[b[0] + 1]).await.unwrap();
    });

    let conn = NativeConnector::new();
    let mut stream = conn
        .connect(addr.ip(), addr.port())
        .await
        .expect("connect to the live listener");
    stream.write_all(&[41]).await.unwrap();
    let mut reply = [0u8; 1];
    stream.read_exact(&mut reply).await.unwrap();
    assert_eq!(reply[0], 42, "the duplex stream carries bytes both ways");
}

#[tokio::test]
async fn deterministic_host_map_dials_loopback_for_a_test_net_guest_target() {
    use std::collections::BTreeMap;
    use std::net::{IpAddr, Ipv4Addr};

    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    let accepted = tokio::spawn(async move { listener.accept().await.map(|_| ()) });
    let test_net = IpAddr::V4(Ipv4Addr::new(192, 0, 2, 1));
    let loopback = IpAddr::V4(Ipv4Addr::LOCALHOST);
    let connector = NativeConnector::new().with_host_map(BTreeMap::from([(test_net, loopback)]));

    connector
        .connect(test_net, port)
        .await
        .expect("mapped TEST-NET target must dial the loopback listener");
    accepted
        .await
        .expect("accept task")
        .expect("loopback listener accepted the mapped connection");
}

#[tokio::test]
async fn connect_to_a_closed_port_is_refused() {
    // Bind to grab a free port, then drop the listener → the port is closed.
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    drop(listener);

    let conn = NativeConnector::new();
    let err = conn
        .connect(addr.ip(), addr.port())
        .await
        .expect_err("a closed loopback port must refuse");
    assert_eq!(err, ConnectError::Refused, "got {err:?}");
}

#[tokio::test]
async fn connect_to_an_unroutable_address_fails_typed_within_the_timeout() {
    use std::net::{IpAddr, Ipv4Addr};
    use std::time::Duration;
    // TEST-NET-1 (192.0.2.0/24) is reserved and black-holed — connect must not hang: with a short
    // timeout it fails with a TYPED error (TimedOut if the SYN is dropped, or Unreachable if the OS
    // rejects the route), never a success and never a hang.
    let conn = NativeConnector::new().with_connect_timeout(Duration::from_millis(300));
    let start = tokio::time::Instant::now();
    let err = conn
        .connect(IpAddr::V4(Ipv4Addr::new(192, 0, 2, 1)), 80)
        .await
        .expect_err("an unroutable address must not connect");
    assert!(
        matches!(err, ConnectError::TimedOut | ConnectError::Unreachable),
        "typed failure, got {err:?}"
    );
    assert!(
        start.elapsed() < Duration::from_secs(3),
        "must fail promptly (within the timeout), not hang"
    );
}
