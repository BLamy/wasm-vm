//! The per-flow byte PUMP — the final data-path slice of the slirp bridge (E3-T14). It copies bytes
//! bidirectionally between a guest flow and its outbound duplex `stream`, honoring half-close in BOTH
//! directions, and runs until both directions are done.
//!
//! It is deliberately DECOUPLED from smoltcp: the pump talks to the guest side over a pair of channels
//! (`guest_rx`: bytes the guest sent; `guest_tx`: bytes to hand back to the guest) and to the outbound
//! side over any `AsyncRead + AsyncWrite` stream. That makes it (a) transport-agnostic — the same pump
//! serves the native `tokio::net::TcpStream` and a future browser transport — and (b) unit-testable
//! with an in-memory `tokio::io::duplex` and channels, with no real sockets and no smoltcp. The
//! `Bridge` slice that wires these channels to `SlirpStack::tcp_recv`/`tcp_send`/`tcp_close` (and the
//! booted-guest acceptance) build on this; the tricky part — the half-close semantics each way — is
//! proven here.

use tokio::io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt};
use tokio::sync::mpsc;

/// Total bytes the pump copied in each direction over the flow's lifetime.
#[derive(Debug, Default, Clone, Copy, PartialEq, Eq)]
pub struct PumpStats {
    /// Guest → outbound (bytes written to the real server).
    pub to_outbound: u64,
    /// Outbound → guest (bytes handed back to the guest).
    pub to_guest: u64,
}

/// Pump output for the guest-facing stack. Keeping clean EOF distinct from reset is load-bearing:
/// EOF becomes a TCP FIN, while any outbound I/O error must become a TCP RST.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PumpEvent {
    Data(Vec<u8>),
    Eof,
    Reset,
}

/// How much we read from the outbound stream per `read` call.
const READ_CHUNK: usize = 16 * 1024;

/// Copy bytes bidirectionally between a guest flow and its outbound `stream` until BOTH directions
/// close. Half-close is honored each way and independently:
/// - **Guest → outbound:** each `Vec<u8>` from `guest_rx` is written to the stream. When `guest_rx`
///   closes (all senders dropped — i.e. the guest sent FIN), the pump `shutdown`s the stream's WRITE
///   half only (the server may still be sending), then stops that direction.
/// - **Outbound → guest:** bytes read from the stream are sent on `guest_tx`. On EOF (server FIN) or a
///   read error, the pump drops `guest_tx` — closing the channel signals the stack to FIN the guest —
///   and stops that direction.
///
/// The returned future completes only when BOTH directions have ended, so a half-open connection
/// (one side FIN'd, the other still flowing) keeps the pump alive — exactly as TCP requires. Errors
/// on either side end only that direction (a write error also ends guest→outbound); the peer side is
/// unaffected until it too closes.
pub async fn pump_flow<S>(
    stream: S,
    mut guest_rx: mpsc::Receiver<Vec<u8>>,
    guest_tx: mpsc::Sender<PumpEvent>,
) -> PumpStats
where
    S: AsyncRead + AsyncWrite,
{
    let (mut rd, mut wr) = tokio::io::split(stream);

    // Guest → outbound: drain guest bytes to the server, then half-close the write side on guest FIN.
    let reset_tx = guest_tx.clone();
    let to_outbound = async {
        let mut n: u64 = 0;
        while let Some(buf) = guest_rx.recv().await {
            if wr.write_all(&buf).await.is_err() {
                // Outbound write is dead (server reset / closed its read side). CLOSE the receiver so
                // any further guest `send`s fail immediately — otherwise, because `join!` keeps this
                // future alive until the reverse side also ends, the guest would keep enqueueing bytes
                // that get Ok'd, never written, and silently dropped: false "delivered" acks and lost
                // data (critic MAJOR). Closing makes the stack learn the outbound is gone. (The reverse
                // direction stays alive: on a real RST its `read` also errors and ends promptly; on an
                // odd write-only-close the guest may still legitimately receive.)
                guest_rx.close();
                let _ = reset_tx.send(PumpEvent::Reset).await;
                return n;
            }
            n += buf.len() as u64;
        }
        let _ = wr.shutdown().await; // guest FIN → FIN the outbound write half (server may still send).
        n
    };

    // Outbound → guest: forward server bytes, preserving clean EOF versus reset for the stack.
    let to_guest = async {
        let mut n: u64 = 0;
        let mut buf = vec![0u8; READ_CHUNK];
        loop {
            match rd.read(&mut buf).await {
                Ok(0) => {
                    let _ = guest_tx.send(PumpEvent::Eof).await;
                    break;
                }
                Err(_) => {
                    let _ = guest_tx.send(PumpEvent::Reset).await;
                    break;
                }
                Ok(k) => {
                    if guest_tx
                        .send(PumpEvent::Data(buf[..k].to_vec()))
                        .await
                        .is_err()
                    {
                        break; // guest side is gone — nowhere to deliver.
                    }
                    n += k as u64;
                }
            }
        }
        n
    };

    let (to_outbound, to_guest) = tokio::join!(to_outbound, to_guest);
    PumpStats {
        to_outbound,
        to_guest,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io;
    use std::pin::Pin;
    use std::task::{Context, Poll};
    use std::time::Duration;
    use tokio::io::ReadBuf;

    /// Every pump test runs under this deadline so a half-close / backpressure regression fails
    /// CLEANLY with a timeout instead of hanging CI forever (critic NIT: neutering `shutdown` made a
    /// test hang indefinitely rather than fail).
    async fn guarded<F: std::future::Future>(f: F) -> F::Output {
        tokio::time::timeout(Duration::from_secs(5), f)
            .await
            .expect("pump test exceeded 5s — likely a half-close/backpressure regression (hang)")
    }

    /// Full bidirectional flow: guest bytes reach the server, server bytes reach the guest, then a
    /// guest FIN half-closes outbound (server sees EOF) and a server close closes the guest channel.
    #[tokio::test]
    async fn copies_both_ways_then_honors_guest_fin_then_server_close() {
        guarded(async {
            let (pump_side, mut server) = tokio::io::duplex(1024);
            let (g2o_tx, g2o_rx) = mpsc::channel::<Vec<u8>>(8); // guest → outbound
            let (o2g_tx, mut o2g_rx) = mpsc::channel::<PumpEvent>(8); // outbound → guest
            let h = tokio::spawn(pump_flow(pump_side, g2o_rx, o2g_tx));

            // Guest → server.
            g2o_tx.send(b"hello".to_vec()).await.unwrap();
            let mut buf = [0u8; 5];
            server.read_exact(&mut buf).await.unwrap();
            assert_eq!(&buf, b"hello", "guest bytes reached the server");

            // Server → guest.
            server.write_all(b"world!").await.unwrap();
            assert_eq!(
                o2g_rx.recv().await.unwrap(),
                PumpEvent::Data(b"world!".to_vec()),
                "server bytes reached the guest"
            );

            // Guest FIN → the server's read side sees EOF (write half shut down), but reverse still open.
            drop(g2o_tx);
            let mut tail = Vec::new();
            server.read_to_end(&mut tail).await.unwrap();
            assert!(tail.is_empty(), "guest FIN half-closed outbound cleanly");

            // Server closes → the stack gets an explicit clean EOF (and therefore sends FIN).
            drop(server);
            assert_eq!(o2g_rx.recv().await, Some(PumpEvent::Eof));

            let stats = h.await.unwrap();
            assert_eq!(
                stats,
                PumpStats {
                    to_outbound: 5,
                    to_guest: 6
                }
            );
        })
        .await;
    }

    /// The other half-close order: the SERVER FINs first (its write half), which closes the guest
    /// channel, yet the guest can keep sending (half-open) until it FINs too.
    #[tokio::test]
    async fn server_fin_closes_guest_channel_but_guest_can_still_send() {
        guarded(async {
            let (pump_side, mut server) = tokio::io::duplex(1024);
            let (g2o_tx, g2o_rx) = mpsc::channel::<Vec<u8>>(8);
            let (o2g_tx, mut o2g_rx) = mpsc::channel::<PumpEvent>(8);
            let h = tokio::spawn(pump_flow(pump_side, g2o_rx, o2g_tx));

            // Server sends, then FINs its write half.
            server.write_all(b"ab").await.unwrap();
            server.shutdown().await.unwrap();
            assert_eq!(o2g_rx.recv().await, Some(PumpEvent::Data(b"ab".to_vec())));
            assert_eq!(
                o2g_rx.recv().await,
                Some(PumpEvent::Eof),
                "server FIN is reported as clean EOF"
            );

            // Half-open: the guest keeps sending after the server's FIN; bytes still reach the server.
            g2o_tx.send(b"tail".to_vec()).await.unwrap();
            let mut buf = [0u8; 4];
            server.read_exact(&mut buf).await.unwrap();
            assert_eq!(
                &buf, b"tail",
                "guest can still send on a half-open connection"
            );

            // Guest FIN completes the flow.
            drop(g2o_tx);
            let stats = h.await.unwrap();
            assert_eq!(
                stats,
                PumpStats {
                    to_outbound: 4,
                    to_guest: 2
                }
            );
        })
        .await;
    }

    /// Integrity + backpressure: a payload larger than the duplex buffer and the channel depth is
    /// delivered in full and in order (the pump must interleave reads/writes, not deadlock).
    #[tokio::test]
    async fn large_transfer_is_delivered_in_full_and_in_order() {
        guarded(async {
            let (pump_side, mut server) = tokio::io::duplex(64); // tiny buffer forces backpressure
            let (g2o_tx, g2o_rx) = mpsc::channel::<Vec<u8>>(4);
            let (o2g_tx, mut o2g_rx) = mpsc::channel::<PumpEvent>(4);
            let h = tokio::spawn(pump_flow(pump_side, g2o_rx, o2g_tx));

            const N: usize = 100 * 1024;
            let payload: Vec<u8> = (0..N).map(|i| (i % 251) as u8).collect();

            // Server drains everything the guest sends (echo not needed here).
            let expect = payload.clone();
            let drain = tokio::spawn(async move {
                let mut got = Vec::with_capacity(N);
                let mut b = [0u8; 4096];
                while got.len() < N {
                    let k = server.read(&mut b).await.unwrap();
                    if k == 0 {
                        break;
                    }
                    got.extend_from_slice(&b[..k]);
                }
                assert_eq!(got, expect, "server received the exact payload, in order");
                got.len()
            });

            // Guest streams the payload in chunks, then FINs.
            for chunk in payload.chunks(1024) {
                g2o_tx.send(chunk.to_vec()).await.unwrap();
            }
            drop(g2o_tx);
            // No reverse traffic here: the pump's read side hits EOF when the drain task drops `server`,
            // which reports an explicit clean EOF to the stack.
            assert_eq!(o2g_rx.recv().await, Some(PumpEvent::Eof));

            let received = drain.await.unwrap();
            assert_eq!(received, N);
            let stats = h.await.unwrap();
            assert_eq!(
                stats.to_outbound, N as u64,
                "every guest byte was pumped outbound"
            );
        })
        .await;
    }

    /// A stream whose WRITES always fail (server reset its read side) but whose READS never resolve
    /// (server keeps its own write half open) — models the exact window where guest→outbound dies
    /// while the reverse direction is still pending.
    struct DeadWriteLiveRead;
    impl AsyncRead for DeadWriteLiveRead {
        fn poll_read(
            self: Pin<&mut Self>,
            _: &mut Context<'_>,
            _: &mut ReadBuf<'_>,
        ) -> Poll<io::Result<()>> {
            Poll::Pending // server never sends and never closes its write half
        }
    }
    impl AsyncWrite for DeadWriteLiveRead {
        fn poll_write(
            self: Pin<&mut Self>,
            _: &mut Context<'_>,
            _: &[u8],
        ) -> Poll<io::Result<usize>> {
            Poll::Ready(Err(io::Error::from(io::ErrorKind::ConnectionReset)))
        }
        fn poll_flush(self: Pin<&mut Self>, _: &mut Context<'_>) -> Poll<io::Result<()>> {
            Poll::Ready(Ok(()))
        }
        fn poll_shutdown(self: Pin<&mut Self>, _: &mut Context<'_>) -> Poll<io::Result<()>> {
            Poll::Ready(Ok(()))
        }
    }

    /// Regression (critic MAJOR): when the outbound write dies but the reverse side is still open,
    /// the pump must CLOSE the guest receiver so further guest sends fail fast — it must NOT keep
    /// returning `Ok` for bytes it silently drops (false "delivered" acks + data loss). Without the
    /// `guest_rx.close()` fix the receiver stays open, `closed()` never resolves, and the 5s guard
    /// fires — so this test is a genuine discriminator.
    #[tokio::test]
    async fn write_error_closes_guest_channel_so_further_sends_fail_fast() {
        guarded(async {
            let (g2o_tx, g2o_rx) = mpsc::channel::<Vec<u8>>(8);
            let (o2g_tx, mut o2g_rx) = mpsc::channel::<PumpEvent>(8);
            // Pre-load one byte the pump will try (and fail) to write.
            g2o_tx.send(b"x".to_vec()).await.unwrap();
            let _pump = tokio::spawn(pump_flow(DeadWriteLiveRead, g2o_rx, o2g_tx));

            // The failed write must close the receiver → the sender observes the closure.
            g2o_tx.closed().await;
            assert!(
                g2o_tx.send(b"y".to_vec()).await.is_err(),
                "guest sends fail after outbound death — no false delivery ack, no silent drop"
            );
            assert_eq!(
                o2g_rx.recv().await,
                Some(PumpEvent::Reset),
                "an outbound write error is a guest-visible reset, never a clean EOF"
            );
        })
        .await;
    }

    /// A read-side connection reset must remain distinguishable from a clean EOF. Conflating these
    /// made the bridge send FIN for a remote RST, which falsely tells the guest all prior bytes were
    /// delivered cleanly.
    struct ResetRead;
    impl AsyncRead for ResetRead {
        fn poll_read(
            self: Pin<&mut Self>,
            _: &mut Context<'_>,
            _: &mut ReadBuf<'_>,
        ) -> Poll<io::Result<()>> {
            Poll::Ready(Err(io::Error::from(io::ErrorKind::ConnectionReset)))
        }
    }
    impl AsyncWrite for ResetRead {
        fn poll_write(
            self: Pin<&mut Self>,
            _: &mut Context<'_>,
            buf: &[u8],
        ) -> Poll<io::Result<usize>> {
            Poll::Ready(Ok(buf.len()))
        }
        fn poll_flush(self: Pin<&mut Self>, _: &mut Context<'_>) -> Poll<io::Result<()>> {
            Poll::Ready(Ok(()))
        }
        fn poll_shutdown(self: Pin<&mut Self>, _: &mut Context<'_>) -> Poll<io::Result<()>> {
            Poll::Ready(Ok(()))
        }
    }

    #[tokio::test]
    async fn read_reset_is_reported_as_reset_not_eof() {
        guarded(async {
            let (g2o_tx, g2o_rx) = mpsc::channel::<Vec<u8>>(1);
            let (o2g_tx, mut o2g_rx) = mpsc::channel::<PumpEvent>(1);
            drop(g2o_tx);
            let stats = pump_flow(ResetRead, g2o_rx, o2g_tx).await;
            assert_eq!(o2g_rx.recv().await, Some(PumpEvent::Reset));
            assert_eq!(stats.to_guest, 0);
        })
        .await;
    }
}
