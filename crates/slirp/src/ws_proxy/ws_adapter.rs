//! WebSocket-wire adapter (E3-T16) — the thin layer that bridges a **real** WebSocket to the
//! [`RelayServer`](super::RelayServer). Each accepted TCP connection is upgraded to a WebSocket
//! (`tokio-tungstenite`); its binary messages are piped into the relay's `inbound` channel and the
//! relay's `outbound` frames are sent back as binary messages. This is the only piece of the proxy
//! that depends on a WebSocket library — the relay itself speaks the protocol over plain channels.
//!
//! No TLS: the relay terminates **plaintext** `ws://`. TLS termination belongs at the ingress
//! (a reverse proxy / the browser's `wss://` terminator), not here.

use super::RelayServer;
use futures_util::{SinkExt, StreamExt};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::mpsc;
use tokio_tungstenite::accept_async;
use tokio_tungstenite::tungstenite::Message;

/// Channel depth between the WS pumps and the relay (bounded → WS backpressure propagates).
const CHAN_DEPTH: usize = 64;

/// Accept WebSocket connections on `listener` forever, running one [`RelayServer`] per connection.
/// Returns when the listener errors (e.g. it was closed).
pub async fn serve(listener: TcpListener, token: Vec<u8>) {
    while let Ok((tcp, _peer)) = listener.accept().await {
        let token = token.clone();
        tokio::spawn(async move {
            handle_conn(tcp, token).await;
        });
    }
}

/// Upgrade one TCP connection to a WebSocket and bridge it to a fresh relay.
async fn handle_conn(tcp: TcpStream, token: Vec<u8>) {
    let ws = match accept_async(tcp).await {
        Ok(ws) => ws,
        Err(_) => return, // failed upgrade → drop the connection
    };
    let (mut ws_sink, mut ws_stream) = ws.split();

    let (in_tx, in_rx) = mpsc::channel::<Vec<u8>>(CHAN_DEPTH);
    let (out_tx, mut out_rx) = mpsc::channel::<Vec<u8>>(CHAN_DEPTH);
    tokio::spawn(RelayServer::new(in_rx, out_tx, token).run());

    // Outbound: relay frames → WS binary messages.
    let writer = tokio::spawn(async move {
        while let Some(bytes) = out_rx.recv().await {
            if ws_sink.send(Message::Binary(bytes)).await.is_err() {
                break;
            }
        }
        let _ = ws_sink.close().await;
    });

    // Inbound: WS binary messages → relay. Control frames (ping/pong/text) are ignored; a Close or a
    // transport error ends the bridge.
    while let Some(msg) = ws_stream.next().await {
        match msg {
            Ok(Message::Binary(bytes)) => {
                if in_tx.send(bytes).await.is_err() {
                    break; // relay gone
                }
            }
            Ok(Message::Close(_)) | Err(_) => break,
            Ok(_) => {} // ping/pong (tungstenite auto-pongs) / text — not part of the framing
        }
    }

    // Inbound ended → dropping `in_tx` closes the relay's inbound, which shuts the relay down, which
    // drops `out_tx` and ends the writer.
    drop(in_tx);
    let _ = writer.await;
}

#[cfg(test)]
#[path = "ws_adapter_tests.rs"]
mod ws_adapter_tests;
