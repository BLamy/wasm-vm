//! StreamState tests: credit flow control (the acceptance criterion "outstanding credit hits zero
//! and pauses"), the adversarial "spend past zero credit" violation, half-close directionality,
//! close/RST retirement + reuse rejection, and counter-overflow protocol errors.

use super::{StreamError, StreamState, Terminal};

#[test]
fn nothing_may_be_sent_until_credit_is_granted() {
    let mut s = StreamState::new();
    assert_eq!(s.send_credit(), 0);
    // A fresh stream has zero credit — even a 1-byte send is refused.
    assert_eq!(s.reserve_send(1), Err(StreamError::SendCreditExceeded));
    // Grant, then it flows.
    s.on_window(10).unwrap();
    assert_eq!(s.send_credit(), 10);
    s.reserve_send(4).unwrap();
    assert_eq!(s.send_credit(), 6);
}

#[test]
fn credit_drains_to_zero_and_then_pauses() {
    // The acceptance criterion: a sender under a granted window sends until credit hits zero, then
    // MUST pause; a fresh WINDOW resumes it.
    let mut s = StreamState::new();
    s.on_window(100).unwrap();
    s.reserve_send(100).unwrap();
    assert_eq!(s.send_credit(), 0, "credit exhausted");
    // Paused: the next byte is refused, credit unchanged (no debt).
    assert_eq!(s.reserve_send(1), Err(StreamError::SendCreditExceeded));
    assert_eq!(s.send_credit(), 0, "a refused send does not go negative");
    // A new WINDOW resumes it.
    s.on_window(50).unwrap();
    s.reserve_send(50).unwrap();
    assert_eq!(s.send_credit(), 0);
}

#[test]
fn a_send_larger_than_credit_is_refused_atomically() {
    let mut s = StreamState::new();
    s.on_window(10).unwrap();
    // 11 > 10 → refused, and credit is NOT partially consumed.
    assert_eq!(s.reserve_send(11), Err(StreamError::SendCreditExceeded));
    assert_eq!(s.send_credit(), 10, "refused send leaves credit intact");
    // Exactly-at-limit works.
    s.reserve_send(10).unwrap();
}

#[test]
fn a_hacked_peer_that_sends_past_granted_credit_is_a_violation() {
    // The adversarial case: we granted the peer 8 bytes; it blasts 100 MB. on_recv_data must reject
    // so the caller kills the stream instead of buffering unboundedly.
    let mut s = StreamState::new();
    s.grant(8).unwrap();
    s.on_recv_data(8).unwrap(); // within grant
    assert_eq!(s.recv_credit(), 0);
    assert_eq!(
        s.on_recv_data(100_000_000),
        Err(StreamError::RecvCreditExceeded),
        "peer overran the credit we granted"
    );
    // And a single oversized burst with zero prior consumption is likewise refused.
    let mut s2 = StreamState::new();
    assert_eq!(
        s2.on_recv_data(1),
        Err(StreamError::RecvCreditExceeded),
        "no grant yet → any data is a violation"
    );
}

#[test]
fn half_close_is_directional() {
    // Our SHUTDOWN_WR ends OUR sending but we can still receive; the peer's SHUTDOWN_WR is the mirror.
    let mut s = StreamState::new();
    s.on_window(10).unwrap();
    s.grant(10).unwrap();

    s.local_shutdown().unwrap();
    assert!(!s.write_open(), "our write side closed");
    assert!(s.read_open(), "we can still receive");
    assert_eq!(s.reserve_send(1), Err(StreamError::WriteClosed));
    s.on_recv_data(5).unwrap(); // still fine to receive

    s.peer_shutdown().unwrap();
    assert!(!s.read_open(), "peer's write side closed");
    assert_eq!(
        s.on_recv_data(1),
        Err(StreamError::PeerWriteClosed),
        "no DATA after the peer's SHUTDOWN_WR"
    );
}

#[test]
fn shutdown_is_idempotent_while_live() {
    let mut s = StreamState::new();
    s.local_shutdown().unwrap();
    s.local_shutdown().unwrap(); // re-declaring the half-close state is benign
    s.peer_shutdown().unwrap();
    s.peer_shutdown().unwrap();
    assert!(!s.write_open() && !s.read_open());
    assert!(!s.is_terminal(), "half-close is not retirement");
}

#[test]
fn close_and_reset_retire_the_stream_and_reuse_is_rejected() {
    let mut closed = StreamState::new();
    closed.close().unwrap();
    assert_eq!(closed.terminal(), Some(Terminal::Closed));
    assert!(closed.is_terminal());
    // Every op after retirement is Terminated (a retired id must not be reused).
    assert_eq!(closed.on_window(1), Err(StreamError::Terminated));
    assert_eq!(closed.reserve_send(0), Err(StreamError::Terminated));
    assert_eq!(closed.grant(1), Err(StreamError::Terminated));
    assert_eq!(closed.on_recv_data(0), Err(StreamError::Terminated));
    assert_eq!(closed.local_shutdown(), Err(StreamError::Terminated));
    assert_eq!(closed.peer_shutdown(), Err(StreamError::Terminated));
    assert_eq!(closed.close(), Err(StreamError::Terminated), "double close");
    assert_eq!(closed.reset(), Err(StreamError::Terminated));

    let mut reset = StreamState::new();
    reset.reset().unwrap();
    assert_eq!(reset.terminal(), Some(Terminal::Reset));
    assert_eq!(reset.close(), Err(StreamError::Terminated));
    assert!(!reset.write_open() && !reset.read_open());
}

#[test]
fn a_zero_length_data_frame_is_allowed_within_an_open_stream() {
    // Empty DATA (keepalive) consumes no credit and is legal while the peer's write side is open.
    let mut s = StreamState::new();
    s.on_recv_data(0).unwrap();
    s.reserve_send(0).unwrap();
    assert_eq!(s.send_credit(), 0);
    assert_eq!(s.recv_credit(), 0);
}

#[test]
fn credit_counters_reject_overflow_instead_of_wrapping() {
    let mut s = StreamState::new();
    s.on_window(u32::MAX).unwrap();
    // One more credit would wrap u32 → protocol error, and the counter is left intact.
    assert_eq!(s.on_window(1), Err(StreamError::CreditOverflow));
    assert_eq!(
        s.send_credit(),
        u32::MAX,
        "credit not corrupted by the rejected grant"
    );

    let mut r = StreamState::new();
    r.grant(u32::MAX).unwrap();
    assert_eq!(r.grant(1), Err(StreamError::CreditOverflow));
    assert_eq!(r.recv_credit(), u32::MAX);
}

#[test]
fn default_matches_new() {
    assert_eq!(StreamState::default(), StreamState::new());
}
