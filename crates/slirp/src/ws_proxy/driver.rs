//! Native async relay driver (E3-T16) — executes [`RelayCore`]'s decisions against real sockets on
//! tokio. It carries WS binary messages over two `mpsc` channels (`inbound`/`outbound`) so it needs
//! **no WebSocket dependency**: the WS-wire adapter (tokio-tungstenite) is a thin later layer that
//! bridges a real WS to these channels; the tests drive them directly against a real TCP echo
//! server, proving the whole chain — guest frames → relay → real outbound TCP → bytes back — end to
//! end.
//!
//! **Concurrency model (actor).** One main task owns the [`RelayCore`] *exclusively* — no shared
//! mutable state, no lock held across `.await`. Each stream gets a **reader** task (real
//! `TcpStream` read half → `Internal::SocketData/Eof/Error`) and a **writer** task (a command mpsc →
//! real write half). The main task only orchestrates: it feeds frames/events into the core and
//! dispatches the resulting WS sends + socket ops. Backend→guest reads are **credit-gated** by a
//! per-stream `watch<u32>` the main task updates from [`RelayCore::send_credit`], so a stalled guest
//! reader pauses only its own backend socket (no head-of-line blocking).

use super::{Frame, RelayCore, RelayError};
use std::collections::HashMap;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpStream;
use tokio::net::tcp::{OwnedReadHalf, OwnedWriteHalf};
use tokio::sync::{mpsc, watch};
use tokio::task::JoinHandle;

/// Max bytes a reader pulls from a backend socket in one go (also capped by the granted credit).
const READ_CHUNK: usize = 64 * 1024;

/// A command to a stream's writer task.
#[derive(Debug)]
enum WriteCmd {
    Data(Vec<u8>),
    Shutdown,
}

/// An event from a per-stream I/O task back to the main loop.
enum Internal {
    Connected { stream: u32, io: TcpStream },
    ConnectFailed { stream: u32 },
    SocketData { stream: u32, bytes: Vec<u8> },
    SocketEof { stream: u32 },
    SocketError { stream: u32 },
}

/// Per-stream handles the main loop keeps to steer the stream's I/O tasks.
struct StreamHandle {
    writer_tx: mpsc::Sender<WriteCmd>,
    /// Current backend→guest send credit; the reader gates its reads on this.
    credit_tx: watch::Sender<u32>,
    reader: JoinHandle<()>,
    writer: JoinHandle<()>,
}

impl StreamHandle {
    /// Tear down both I/O tasks (drops the channels the tasks wait on, then aborts for promptness).
    fn shutdown(self) {
        self.reader.abort();
        self.writer.abort();
    }
}

/// The native relay server for one WS connection: WS binary messages in over `inbound`, out over
/// `outbound`.
pub struct RelayServer {
    core: RelayCore,
    inbound: mpsc::Receiver<Vec<u8>>,
    outbound: mpsc::Sender<Vec<u8>>,
    token: Vec<u8>,
}

impl RelayServer {
    pub fn new(
        inbound: mpsc::Receiver<Vec<u8>>,
        outbound: mpsc::Sender<Vec<u8>>,
        token: Vec<u8>,
    ) -> Self {
        Self {
            core: RelayCore::new(),
            inbound,
            outbound,
            token,
        }
    }

    /// Run until the WS transport closes (inbound channel ends) or the guest commits a protocol
    /// error. On exit every backend socket is torn down.
    pub async fn run(mut self) {
        // Both ends send a HELLO first.
        self.send_frame(self.core.hello(self.token.clone())).await;

        let (int_tx, mut int_rx) = mpsc::channel::<Internal>(256);
        let mut streams: HashMap<u32, StreamHandle> = HashMap::new();

        loop {
            tokio::select! {
                msg = self.inbound.recv() => match msg {
                    Some(bytes) => {
                        if self.on_ws_message(&bytes, &int_tx, &mut streams).await.is_err() {
                            break; // protocol error → close the connection
                        }
                    }
                    None => break, // WS transport closed
                },
                Some(ev) = int_rx.recv() => {
                    self.on_internal(ev, &int_tx, &mut streams).await;
                }
            }
        }

        // Transport gone → reap every backend socket.
        let actions = self.core.on_ws_closed();
        for op in actions.socket_ops {
            if let super::SocketOp::Close { stream } = op
                && let Some(h) = streams.remove(&stream)
            {
                h.shutdown();
            }
        }
        for (_, h) in streams.drain() {
            h.shutdown();
        }
    }

    /// Decode + route one inbound WS message. Returns `Err` on a protocol error (caller closes).
    async fn on_ws_message(
        &mut self,
        bytes: &[u8],
        int_tx: &mpsc::Sender<Internal>,
        streams: &mut HashMap<u32, StreamHandle>,
    ) -> Result<(), RelayError> {
        let Some(frame) = Frame::decode(bytes) else {
            return Err(RelayError::UnknownStream(0)); // undecodable → protocol error
        };
        // A guest WINDOW grows our backend→guest send credit; note the stream to refresh its reader.
        let win_stream = match &frame {
            Frame::Window { stream, .. } => Some(*stream),
            _ => None,
        };
        let actions = self.core.on_inbound_frame(frame)?;
        self.dispatch(actions, int_tx, streams).await;
        if let Some(s) = win_stream {
            self.refresh_credit(s, streams);
        }
        Ok(())
    }

    /// Handle one per-stream I/O event.
    async fn on_internal(
        &mut self,
        ev: Internal,
        int_tx: &mpsc::Sender<Internal>,
        streams: &mut HashMap<u32, StreamHandle>,
    ) {
        match ev {
            Internal::Connected { stream, io } => {
                if let Ok(actions) = self.core.on_connect_result(stream, true) {
                    self.dispatch(actions, int_tx, streams).await;
                    self.spawn_stream(stream, io, int_tx, streams);
                }
            }
            Internal::ConnectFailed { stream } => {
                if let Ok(actions) = self.core.on_connect_result(stream, false) {
                    self.dispatch(actions, int_tx, streams).await;
                }
            }
            Internal::SocketData { stream, bytes } => {
                match self.core.on_socket_data(stream, bytes) {
                    Ok(actions) => {
                        self.dispatch(actions, int_tx, streams).await;
                        // Reserve done — refresh the reader's credit so it may read the next chunk.
                        self.refresh_credit(stream, streams);
                    }
                    Err(_) => {
                        // Stream gone / violation → drop its I/O tasks.
                        if let Some(h) = streams.remove(&stream) {
                            h.shutdown();
                        }
                    }
                }
            }
            Internal::SocketEof { stream } => {
                if let Ok(actions) = self.core.on_socket_eof(stream) {
                    self.dispatch(actions, int_tx, streams).await;
                }
            }
            Internal::SocketError { stream } => {
                if let Ok(actions) = self.core.on_socket_error(stream) {
                    self.dispatch(actions, int_tx, streams).await;
                }
                if let Some(h) = streams.remove(&stream) {
                    h.shutdown();
                }
            }
        }
    }

    /// Send the WS frames and perform the socket ops of a [`RelayActions`](super::RelayActions).
    async fn dispatch(
        &mut self,
        actions: super::RelayActions,
        int_tx: &mpsc::Sender<Internal>,
        streams: &mut HashMap<u32, StreamHandle>,
    ) {
        for f in actions.ws_sends {
            self.send_frame(f).await;
        }
        for op in actions.socket_ops {
            match op {
                super::SocketOp::Connect { stream, host, port } => {
                    let tx = int_tx.clone();
                    tokio::spawn(async move {
                        match TcpStream::connect((host.as_str(), port)).await {
                            Ok(io) => {
                                let _ = tx.send(Internal::Connected { stream, io }).await;
                            }
                            Err(_) => {
                                let _ = tx.send(Internal::ConnectFailed { stream }).await;
                            }
                        }
                    });
                }
                super::SocketOp::Write { stream, bytes } => {
                    if let Some(h) = streams.get(&stream) {
                        let _ = h.writer_tx.send(WriteCmd::Data(bytes)).await;
                    }
                }
                super::SocketOp::ShutdownWrite { stream } => {
                    if let Some(h) = streams.get(&stream) {
                        let _ = h.writer_tx.send(WriteCmd::Shutdown).await;
                    }
                }
                super::SocketOp::Close { stream } => {
                    if let Some(h) = streams.remove(&stream) {
                        h.shutdown();
                    }
                }
            }
        }
    }

    /// Split a freshly-connected backend socket into a reader + writer task and record its handle.
    fn spawn_stream(
        &self,
        stream: u32,
        io: TcpStream,
        int_tx: &mpsc::Sender<Internal>,
        streams: &mut HashMap<u32, StreamHandle>,
    ) {
        let (rh, wh) = io.into_split();
        let (writer_tx, writer_rx) = mpsc::channel::<WriteCmd>(64);
        let (credit_tx, credit_rx) = watch::channel::<u32>(self.core.send_credit(stream));
        let reader = tokio::spawn(read_pump(stream, rh, credit_rx, int_tx.clone()));
        let writer = tokio::spawn(write_pump(stream, wh, writer_rx, int_tx.clone()));
        streams.insert(
            stream,
            StreamHandle {
                writer_tx,
                credit_tx,
                reader,
                writer,
            },
        );
    }

    /// Push the stream's current send credit to its reader (unblocks / re-caps its next read).
    fn refresh_credit(&self, stream: u32, streams: &HashMap<u32, StreamHandle>) {
        if let Some(h) = streams.get(&stream) {
            let _ = h.credit_tx.send(self.core.send_credit(stream));
        }
    }

    async fn send_frame(&self, frame: Frame) {
        if let Some(bytes) = frame.encode() {
            let _ = self.outbound.send(bytes).await;
        }
    }
}

/// Backend → guest: read the socket only up to the granted credit, forwarding each chunk to the main
/// loop, then wait for the main loop to reserve credit (a `watch` tick) before reading again — so a
/// read never runs past the guest's window.
async fn read_pump(
    stream: u32,
    mut rh: OwnedReadHalf,
    mut credit_rx: watch::Receiver<u32>,
    int_tx: mpsc::Sender<Internal>,
) {
    let mut buf = vec![0u8; READ_CHUNK];
    loop {
        let credit = *credit_rx.borrow_and_update();
        if credit == 0 {
            if credit_rx.changed().await.is_err() {
                break; // main loop dropped the stream
            }
            continue;
        }
        let cap = (credit as usize).min(buf.len());
        match rh.read(&mut buf[..cap]).await {
            Ok(0) => {
                let _ = int_tx.send(Internal::SocketEof { stream }).await;
                break;
            }
            Ok(n) => {
                if int_tx
                    .send(Internal::SocketData {
                        stream,
                        bytes: buf[..n].to_vec(),
                    })
                    .await
                    .is_err()
                {
                    break;
                }
                // Block until the main loop reserves the just-sent bytes (credit tick), so cumulative
                // reads never exceed cumulative granted credit.
                if credit_rx.changed().await.is_err() {
                    break;
                }
            }
            Err(_) => {
                let _ = int_tx.send(Internal::SocketError { stream }).await;
                break;
            }
        }
    }
}

/// Guest → backend: apply write / shutdown commands to the backend socket's write half. A write
/// failure surfaces as a stream error.
async fn write_pump(
    stream: u32,
    mut wh: OwnedWriteHalf,
    mut cmd_rx: mpsc::Receiver<WriteCmd>,
    int_tx: mpsc::Sender<Internal>,
) {
    while let Some(cmd) = cmd_rx.recv().await {
        match cmd {
            WriteCmd::Data(bytes) => {
                if wh.write_all(&bytes).await.is_err() {
                    let _ = int_tx.send(Internal::SocketError { stream }).await;
                    break;
                }
            }
            WriteCmd::Shutdown => {
                let _ = wh.shutdown().await;
            }
        }
    }
}

#[cfg(test)]
#[path = "driver_tests.rs"]
mod driver_tests;
