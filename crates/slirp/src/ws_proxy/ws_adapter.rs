//! WebSocket-wire adapter (E3-T16) — the thin layer that bridges a **real** WebSocket to the
//! [`RelayServer`](super::RelayServer). Each accepted TCP connection is upgraded to a WebSocket
//! (`tokio-tungstenite`); its binary messages are piped into the relay's `inbound` channel and the
//! relay's `outbound` frames are sent back as binary messages. This is the only piece of the proxy
//! that depends on a WebSocket library — the relay itself speaks the protocol over plain channels.
//!
//! No TLS: the relay terminates **plaintext** `ws://`. TLS termination belongs at the ingress
//! (a reverse proxy / the browser's `wss://` terminator), not here.

use super::{RelayConnectionSecurity, RelayLimits, RelayServer, RelayUsageRegistry};
use futures_util::{SinkExt, StreamExt};
use std::collections::{BTreeMap, BTreeSet};
use std::sync::{Arc, Mutex};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::mpsc;
use tokio_tungstenite::tungstenite::Message;
use tokio_tungstenite::{accept_async, accept_hdr_async};

/// Channel depth between the WS pumps and the relay (bounded → WS backpressure propagates).
const CHAN_DEPTH: usize = 64;

/// Accept WebSocket connections on `listener` forever, running one [`RelayServer`] per connection.
/// A transient `accept` error (fd exhaustion, an aborted connection) must NOT kill the listener —
/// the fd frees moments later — so it is backed off and retried rather than treated as fatal.
pub async fn serve(listener: TcpListener, token: Vec<u8>) {
    serve_with_host_map(listener, token, BTreeMap::new()).await;
}

/// Like [`serve`], with exact guest-host → relay-host rewrites. This is primarily a deterministic
/// acceptance/development hook; an empty map is byte-for-byte the normal relay policy.
pub async fn serve_with_host_map(
    listener: TcpListener,
    token: Vec<u8>,
    host_map: BTreeMap<String, String>,
) {
    loop {
        match listener.accept().await {
            Ok((tcp, _peer)) => {
                let token = token.clone();
                let host_map = host_map.clone();
                tokio::spawn(async move {
                    handle_conn(tcp, token, host_map).await;
                });
            }
            Err(_) => {
                // Back off briefly so a persistent error can't become a busy-spin, then keep serving.
                tokio::time::sleep(std::time::Duration::from_millis(10)).await;
            }
        }
    }
}

/// Public serving mode. Every upgrade must present an exact allowed Origin and every first binary
/// message must be an origin-bound, short-lived HMAC token. Failed upgrades are dropped before a
/// relay actor (and therefore before any outbound `OPEN`) exists.
pub async fn serve_secure(
    listener: TcpListener,
    hmac_secret: Vec<u8>,
    allowed_origins: BTreeSet<String>,
    host_map: BTreeMap<String, String>,
) {
    serve_secure_with_limits(
        listener,
        hmac_secret,
        allowed_origins,
        host_map,
        RelayLimits::default(),
    )
    .await;
}

pub async fn serve_secure_with_limits(
    listener: TcpListener,
    hmac_secret: Vec<u8>,
    allowed_origins: BTreeSet<String>,
    host_map: BTreeMap<String, String>,
    limits: RelayLimits,
) {
    let usage = RelayUsageRegistry::default();
    loop {
        match listener.accept().await {
            Ok((tcp, _peer)) => {
                let secret = hmac_secret.clone();
                let origins = allowed_origins.clone();
                let host_map = host_map.clone();
                let usage = usage.clone();
                tokio::spawn(async move {
                    handle_secure_conn(tcp, secret, origins, host_map, limits, usage).await;
                });
            }
            Err(_) => tokio::time::sleep(std::time::Duration::from_millis(10)).await,
        }
    }
}

/// Upgrade one TCP connection to a WebSocket and bridge it to a fresh relay.
async fn handle_conn(tcp: TcpStream, token: Vec<u8>, host_map: BTreeMap<String, String>) {
    let ws = match accept_async(tcp).await {
        Ok(ws) => ws,
        Err(_) => return, // failed upgrade → drop the connection
    };
    let (mut ws_sink, mut ws_stream) = ws.split();

    let (in_tx, in_rx) = mpsc::channel::<Vec<u8>>(CHAN_DEPTH);
    let (out_tx, mut out_rx) = mpsc::channel::<Vec<u8>>(CHAN_DEPTH);
    tokio::spawn(RelayServer::with_host_map(in_rx, out_tx, token, host_map).run());

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

// `accept_hdr_async` fixes the callback's error type to tungstenite's intentionally rich HTTP
// response. We only return `Ok`, but clippy still attributes the trait's large unused Err here.
#[allow(clippy::result_large_err)]
async fn handle_secure_conn(
    tcp: TcpStream,
    hmac_secret: Vec<u8>,
    allowed_origins: BTreeSet<String>,
    host_map: BTreeMap<String, String>,
    limits: RelayLimits,
    usage: RelayUsageRegistry,
) {
    let captured_origin = Arc::new(Mutex::new(None::<String>));
    let callback_origin = captured_origin.clone();
    let ws = match accept_hdr_async(
        tcp,
        move |request: &tokio_tungstenite::tungstenite::handshake::server::Request, response| {
            let origin = request
                .headers()
                .get("origin")
                .and_then(|value| value.to_str().ok())
                .map(str::to_owned);
            *callback_origin.lock().expect("origin capture poisoned") = origin;
            Ok(response)
        },
    )
    .await
    {
        Ok(ws) => ws,
        Err(_) => return,
    };
    let origin = captured_origin
        .lock()
        .expect("origin capture poisoned")
        .clone();
    let Some(origin) = origin.filter(|origin| allowed_origins.contains(origin)) else {
        eprintln!("{{\"event\":\"relay_origin_rejected\"}}");
        return;
    };
    let session_usage = usage.clone();
    bridge_ws(
        ws,
        RelayConnectionSecurity {
            hmac_secret,
            origin,
            limits,
            usage,
        },
        host_map,
    )
    .await;
    let metrics = session_usage.metrics();
    eprintln!(
        "{{\"event\":\"relay_session_closed\",\"sessions_authenticated\":{},\"rejected_authentication\":{},\"active_streams\":{},\"connects_accepted\":{},\"rejected_concurrency\":{},\"rejected_rate\":{},\"rejected_bytes\":{},\"bytes_accounted\":{}}}",
        metrics.sessions_authenticated,
        metrics.rejected_authentication,
        metrics.active_streams,
        metrics.connects_accepted,
        metrics.rejected_concurrency,
        metrics.rejected_rate,
        metrics.rejected_bytes,
        metrics.bytes_accounted,
    );
}

async fn bridge_ws(
    ws: tokio_tungstenite::WebSocketStream<TcpStream>,
    security: RelayConnectionSecurity,
    host_map: BTreeMap<String, String>,
) {
    let (mut ws_sink, mut ws_stream) = ws.split();
    let (in_tx, in_rx) = mpsc::channel::<Vec<u8>>(CHAN_DEPTH);
    let (out_tx, mut out_rx) = mpsc::channel::<Vec<u8>>(CHAN_DEPTH);
    tokio::spawn(RelayServer::with_security(in_rx, out_tx, security, host_map).run());
    let writer = tokio::spawn(async move {
        while let Some(bytes) = out_rx.recv().await {
            if ws_sink.send(Message::Binary(bytes)).await.is_err() {
                break;
            }
        }
        let _ = ws_sink.close().await;
    });
    while let Some(msg) = ws_stream.next().await {
        match msg {
            Ok(Message::Binary(bytes)) => {
                if in_tx.send(bytes).await.is_err() {
                    break;
                }
            }
            Ok(Message::Close(_)) | Err(_) => break,
            Ok(_) => {}
        }
    }
    drop(in_tx);
    let _ = writer.await;
}

#[cfg(test)]
#[path = "ws_adapter_tests.rs"]
mod ws_adapter_tests;
