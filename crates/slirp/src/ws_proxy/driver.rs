//! Native async relay driver (E3-T16) — executes [`RelayCore`]'s decisions against real sockets on
//! tokio (behind the `native` feature). It carries WS binary messages over two `mpsc` channels
//! (`inbound`/`outbound`) so it needs **no WebSocket dependency**: the WS-wire adapter
//! (tokio-tungstenite) is a thin later layer that bridges a real WS to these channels; the tests
//! drive them directly against a real TCP echo server, proving the whole chain — guest frames →
//! relay → real outbound TCP → bytes back — end to end.
//!
//! **Concurrency model (actor).** One main task owns the [`RelayCore`] *exclusively* — no shared
//! mutable state. Each stream gets a **reader** task (real `TcpStream` read half →
//! `Internal::SocketData/Eof/Error`) and a **writer** task (a command channel → real write half).
//!
//! **Backpressure, both directions, without head-of-line blocking:**
//! - **backend → guest** is gated by a per-stream [`Semaphore`] carrying the send credit the *guest*
//!   granted. The reader acquires permits *before* reading, so it can never out-read the grant
//!   (permits accumulate — unlike a `watch`, no coalescing loses or double-counts a grant). Only its
//!   own backend socket pauses when the guest reader stalls.
//! - **guest → backend** never blocks the main loop: writes are handed to the per-stream writer over
//!   an **unbounded** channel, and the guest's window is refilled only once the writer *drains* the
//!   bytes to the backend ([`RelayCore::on_backend_written`]). So a stalled backend bounds a stream's
//!   queued data to the window (256 KiB) and can never freeze the shared main loop or other streams.

use super::relay_security::{RelayToken, verify_relay_token};
use super::{Frame, MAX_DATAGRAM_BYTES, MAX_STREAMS, RelayCore, RelayError};
use super::{ProtectedNetwork, RelayLimits, RelayUsageRegistry, destinations_are_allowed};
use std::collections::{BTreeMap, HashMap, HashSet};
use std::sync::Arc;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::tcp::{OwnedReadHalf, OwnedWriteHalf};
use tokio::net::{TcpStream, UdpSocket};
use tokio::sync::{Semaphore, mpsc};
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
    Connected {
        stream: u32,
        io: TcpStream,
    },
    ConnectFailed {
        stream: u32,
    },
    /// The backend accepted `n` bytes — refill the guest's window (backpressure tied to drain).
    Written {
        stream: u32,
        n: u32,
    },
    SocketData {
        stream: u32,
        bytes: Vec<u8>,
    },
    SocketEof {
        stream: u32,
    },
    SocketError {
        stream: u32,
    },
    UdpData {
        stream: u32,
        bytes: Vec<u8>,
    },
    UdpError {
        stream: u32,
    },
}

/// Per-stream handles the main loop keeps to steer the stream's I/O tasks.
struct StreamHandle {
    writer_tx: mpsc::UnboundedSender<WriteCmd>,
    /// Backend→guest send credit as permits; the main loop adds on each guest `WINDOW`.
    credit: Arc<Semaphore>,
    reader: JoinHandle<()>,
    writer: JoinHandle<()>,
}

struct UdpHandle {
    socket: Arc<UdpSocket>,
    reader: JoinHandle<()>,
}

impl UdpHandle {
    fn shutdown(self) {
        self.reader.abort();
    }
}

impl StreamHandle {
    /// Tear down both I/O tasks: close the credit semaphore (wakes a reader blocked on a permit) and
    /// abort (wakes one blocked in `read`/`write`).
    fn shutdown(self) {
        self.credit.close();
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
    /// Optional exact host rewrites for deterministic/local deployments (for example the E3-T14
    /// acceptance address 192.0.2.1 → 127.0.0.1). Empty in production by default.
    host_map: BTreeMap<String, String>,
    /// Public-relay authentication. Development/local callers may leave this unset; public serving
    /// uses [`Self::with_security`] and refuses any stream until the origin-bound HELLO verifies.
    security: Option<RelayConnectionSecurity>,
    authenticated_token: Option<RelayToken>,
    quota_streams: HashSet<u32>,
}

#[derive(Debug, Clone)]
pub struct RelayConnectionSecurity {
    pub hmac_secret: Vec<u8>,
    pub origin: String,
    pub limits: RelayLimits,
    pub usage: RelayUsageRegistry,
    pub protected_networks: Vec<ProtectedNetwork>,
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
            host_map: BTreeMap::new(),
            security: None,
            authenticated_token: None,
            quota_streams: HashSet::new(),
        }
    }

    pub fn with_host_map(
        inbound: mpsc::Receiver<Vec<u8>>,
        outbound: mpsc::Sender<Vec<u8>>,
        token: Vec<u8>,
        host_map: BTreeMap<String, String>,
    ) -> Self {
        Self {
            core: RelayCore::new(),
            inbound,
            outbound,
            token,
            host_map,
            security: None,
            authenticated_token: None,
            quota_streams: HashSet::new(),
        }
    }

    pub fn with_security(
        inbound: mpsc::Receiver<Vec<u8>>,
        outbound: mpsc::Sender<Vec<u8>>,
        security: RelayConnectionSecurity,
        host_map: BTreeMap<String, String>,
    ) -> Self {
        Self {
            core: RelayCore::new(),
            inbound,
            outbound,
            token: Vec::new(),
            host_map,
            security: Some(security),
            authenticated_token: None,
            quota_streams: HashSet::new(),
        }
    }

    /// Run until the WS transport closes (inbound channel ends) or the guest commits a protocol
    /// error. On exit every backend socket is torn down.
    pub async fn run(mut self) {
        // Both ends send a HELLO first.
        self.send_frame(self.core.hello(self.token.clone())).await;

        let (int_tx, mut int_rx) = mpsc::channel::<Internal>(256);
        let mut streams: HashMap<u32, StreamHandle> = HashMap::new();
        let mut udp: HashMap<u32, UdpHandle> = HashMap::new();

        loop {
            tokio::select! {
                msg = self.inbound.recv() => match msg {
                    Some(bytes) => {
                        if self.on_ws_message(&bytes, &int_tx, &mut streams, &mut udp).await.is_err() {
                            break; // protocol error → close the connection
                        }
                    }
                    None => break, // WS transport closed
                },
                Some(ev) = int_rx.recv() => {
                    self.on_internal(ev, &int_tx, &mut streams, &mut udp).await;
                }
            }
        }

        // Transport gone → reap every backend socket.
        self.core.on_ws_closed();
        for (_, h) in streams.drain() {
            h.shutdown();
        }
        for (_, h) in udp.drain() {
            h.shutdown();
        }
        self.release_all_quota_streams();
    }

    /// Decode + route one inbound WS message. Returns `Err` on a protocol error (caller closes).
    async fn on_ws_message(
        &mut self,
        bytes: &[u8],
        int_tx: &mpsc::Sender<Internal>,
        streams: &mut HashMap<u32, StreamHandle>,
        udp: &mut HashMap<u32, UdpHandle>,
    ) -> Result<(), RelayError> {
        let Some(frame) = Frame::decode(bytes) else {
            return Err(RelayError::UnknownStream(0)); // undecodable → protocol error
        };
        if !self.core.is_ready()
            && let Some(security) = &self.security
        {
            let Frame::Hello { token, .. } = &frame else {
                return Err(RelayError::Authentication);
            };
            let now = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map_err(|_| RelayError::Authentication)?
                .as_secs();
            let verified = match verify_relay_token(
                &security.hmac_secret,
                now,
                &security.origin,
                token,
            ) {
                Ok(token) => token,
                Err(reason) => {
                    security.usage.record_authentication(false);
                    eprintln!(
                        "{{\"event\":\"relay_authentication_rejected\",\"reason\":\"{reason:?}\"}}"
                    );
                    return Err(RelayError::Authentication);
                }
            };
            security.usage.record_authentication(true);
            eprintln!("{{\"event\":\"relay_session_authenticated\"}}");
            self.authenticated_token = Some(verified);
        }
        if self.core.is_ready() {
            match &frame {
                Frame::Open { stream, .. } | Frame::UdpOpen { stream, .. }
                    if !self.reserve_quota_stream(*stream) =>
                {
                    self.send_frame(match frame {
                        Frame::Open { stream, .. } => Frame::OpenFail { stream, code: 2 },
                        Frame::UdpOpen { stream, .. } => Frame::UdpOpenFail { stream, code: 2 },
                        _ => unreachable!(),
                    })
                    .await;
                    return Ok(());
                }
                Frame::Open { stream, .. }
                    if *stream == 0
                        || udp.contains_key(stream)
                        || self.core.live_streams().saturating_add(udp.len()) >= MAX_STREAMS =>
                {
                    // TCP and UDP share the u32 wire namespace and one resource cap. Refuse this
                    // OPEN without feeding it to the TCP mux; otherwise a live UDP id can also gain
                    // a TCP socket (and OPEN_OK/WINDOW), making later frames ambiguous.
                    self.send_frame(Frame::OpenFail {
                        stream: *stream,
                        code: 1,
                    })
                    .await;
                    self.release_quota_stream(*stream);
                    return Ok(());
                }
                Frame::UdpOpen { stream, host, port } => {
                    if *stream == 0
                        || self.core.has_stream(*stream)
                        || udp.contains_key(stream)
                        || self.core.live_streams().saturating_add(udp.len()) >= MAX_STREAMS
                    {
                        self.send_frame(Frame::UdpOpenFail {
                            stream: *stream,
                            code: 1,
                        })
                        .await;
                        self.release_quota_stream(*stream);
                        return Ok(());
                    }
                    let (host, development_allow) = match self.host_map.get(host) {
                        Some(rewrite) => (rewrite.clone(), true),
                        None => (host.clone(), false),
                    };
                    let socket = match UdpSocket::bind((std::net::Ipv4Addr::UNSPECIFIED, 0)).await {
                        Ok(socket)
                            if connect_udp_destination(
                                &socket,
                                &host,
                                *port,
                                self.security.is_some() && !development_allow,
                                self.security.as_ref().map_or(&[][..], |security| {
                                    security.protected_networks.as_slice()
                                }),
                            )
                            .await =>
                        {
                            Arc::new(socket)
                        }
                        _ => {
                            self.send_frame(Frame::UdpOpenFail {
                                stream: *stream,
                                code: 1,
                            })
                            .await;
                            self.release_quota_stream(*stream);
                            return Ok(());
                        }
                    };
                    let stream = *stream;
                    let reader_socket = socket.clone();
                    let tx = int_tx.clone();
                    let reader = tokio::spawn(async move {
                        let mut buf = vec![0u8; MAX_DATAGRAM_BYTES];
                        loop {
                            match reader_socket.recv(&mut buf).await {
                                Ok(n) => {
                                    if tx
                                        .send(Internal::UdpData {
                                            stream,
                                            bytes: buf[..n].to_vec(),
                                        })
                                        .await
                                        .is_err()
                                    {
                                        break;
                                    }
                                }
                                Err(_) => {
                                    let _ = tx.send(Internal::UdpError { stream }).await;
                                    break;
                                }
                            }
                        }
                    });
                    udp.insert(stream, UdpHandle { socket, reader });
                    self.send_frame(Frame::UdpOpenOk { stream }).await;
                    return Ok(());
                }
                Frame::UdpData { stream, bytes } => {
                    if !self.record_quota_bytes(bytes.len()) {
                        if let Some(handle) = udp.remove(stream) {
                            handle.shutdown();
                        }
                        self.send_frame(Frame::UdpClose { stream: *stream }).await;
                        self.release_quota_stream(*stream);
                        return Ok(());
                    }
                    let sent = match udp.get(stream) {
                        Some(handle) => handle.socket.send(bytes).await.ok(),
                        None => None,
                    };
                    if sent != Some(bytes.len()) {
                        if let Some(handle) = udp.remove(stream) {
                            handle.shutdown();
                        }
                        self.send_frame(Frame::UdpClose { stream: *stream }).await;
                    }
                    return Ok(());
                }
                Frame::UdpClose { stream } => {
                    if let Some(handle) = udp.remove(stream) {
                        handle.shutdown();
                    }
                    self.release_quota_stream(*stream);
                    return Ok(());
                }
                Frame::UdpOpenOk { .. } | Frame::UdpOpenFail { .. } => {
                    return Err(RelayError::UnknownStream(0));
                }
                _ => {}
            }
        }
        // A guest WINDOW grows this stream's backend→guest credit; add the exact grant as permits.
        let grant = match &frame {
            Frame::Window { stream, credit } => Some((*stream, *credit)),
            _ => None,
        };
        if let Frame::Data { stream, bytes } = &frame
            && !self.record_quota_bytes(bytes.len())
        {
            if let Ok(actions) = self.core.on_inbound_frame(Frame::Rst { stream: *stream }) {
                self.dispatch(actions, int_tx, streams).await;
            }
            self.send_frame(Frame::Rst { stream: *stream }).await;
            self.release_quota_stream(*stream);
            return Ok(());
        }
        let terminal_stream = match &frame {
            Frame::Close { stream } | Frame::Rst { stream } => Some(*stream),
            _ => None,
        };
        let actions = self.core.on_inbound_frame(frame)?;
        self.dispatch(actions, int_tx, streams).await;
        if let Some(stream) = terminal_stream {
            self.release_quota_stream(stream);
        }
        if let Some((stream, credit)) = grant
            && let Some(h) = streams.get(&stream)
        {
            h.credit.add_permits(credit as usize);
        }
        Ok(())
    }

    /// Handle one per-stream I/O event.
    async fn on_internal(
        &mut self,
        ev: Internal,
        int_tx: &mpsc::Sender<Internal>,
        streams: &mut HashMap<u32, StreamHandle>,
        udp: &mut HashMap<u32, UdpHandle>,
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
                self.release_quota_stream(stream);
            }
            Internal::Written { stream, n } => {
                if let Ok(actions) = self.core.on_backend_written(stream, n) {
                    self.dispatch(actions, int_tx, streams).await;
                }
            }
            Internal::SocketData { stream, bytes } => match self.core.on_socket_data(stream, bytes)
            {
                Ok(actions)
                    if self.record_quota_bytes(actions.ws_sends.iter().map(frame_bytes).sum()) =>
                {
                    self.dispatch(actions, int_tx, streams).await
                }
                Ok(_) => {
                    if let Ok(actions) = self.core.on_socket_error(stream) {
                        self.dispatch(actions, int_tx, streams).await;
                    }
                    if let Some(h) = streams.remove(&stream) {
                        h.shutdown();
                    }
                    self.release_quota_stream(stream);
                }
                Err(_) => {
                    // Should not happen (the semaphore gates reads to the grant), but if it ever
                    // does, tell the guest with an RST rather than silently dropping the stream.
                    if let Ok(actions) = self.core.on_socket_error(stream) {
                        self.dispatch(actions, int_tx, streams).await;
                    }
                    if let Some(h) = streams.remove(&stream) {
                        h.shutdown();
                    }
                    self.release_quota_stream(stream);
                }
            },
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
                self.release_quota_stream(stream);
            }
            Internal::UdpData { stream, bytes } => {
                if udp.contains_key(&stream) && self.record_quota_bytes(bytes.len()) {
                    self.send_frame(Frame::UdpData { stream, bytes }).await;
                } else if let Some(handle) = udp.remove(&stream) {
                    handle.shutdown();
                    self.send_frame(Frame::UdpClose { stream }).await;
                    self.release_quota_stream(stream);
                }
            }
            Internal::UdpError { stream } => {
                if let Some(handle) = udp.remove(&stream) {
                    handle.shutdown();
                    self.send_frame(Frame::UdpClose { stream }).await;
                    self.release_quota_stream(stream);
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
                    let (host, development_allow) = match self.host_map.get(&host) {
                        Some(rewrite) => (rewrite.clone(), true),
                        None => (host, false),
                    };
                    let require_public = self.security.is_some() && !development_allow;
                    let protected_networks = self
                        .security
                        .as_ref()
                        .map_or_else(Vec::new, |security| security.protected_networks.clone());
                    let tx = int_tx.clone();
                    tokio::spawn(async move {
                        match connect_tcp_destination(
                            &host,
                            port,
                            require_public,
                            &protected_networks,
                        )
                        .await
                        {
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
                    // Unbounded → the main loop never blocks here; a stalled backend can't freeze it.
                    if let Some(h) = streams.get(&stream) {
                        let _ = h.writer_tx.send(WriteCmd::Data(bytes));
                    }
                }
                super::SocketOp::ShutdownWrite { stream } => {
                    if let Some(h) = streams.get(&stream) {
                        let _ = h.writer_tx.send(WriteCmd::Shutdown);
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
        let (writer_tx, writer_rx) = mpsc::unbounded_channel::<WriteCmd>();
        // Seed the credit with whatever the guest granted before connect completed.
        let credit = Arc::new(Semaphore::new(self.core.send_credit(stream) as usize));
        let reader = tokio::spawn(read_pump(stream, rh, credit.clone(), int_tx.clone()));
        let writer = tokio::spawn(write_pump(stream, wh, writer_rx, int_tx.clone()));
        streams.insert(
            stream,
            StreamHandle {
                writer_tx,
                credit,
                reader,
                writer,
            },
        );
    }

    async fn send_frame(&self, frame: Frame) {
        if let Some(bytes) = frame.encode() {
            let _ = self.outbound.send(bytes).await;
        }
    }

    fn reserve_quota_stream(&mut self, stream: u32) -> bool {
        let Some(security) = &self.security else {
            return true;
        };
        // A repeated wire id is a protocol-level duplicate, not a new stream. Reject it before
        // touching the shared token registry so a malicious duplicate OPEN cannot reserve a
        // phantom concurrency slot or consume the token's connect-rate budget.
        if self.quota_streams.contains(&stream) {
            return false;
        }
        let Some(token) = &self.authenticated_token else {
            return false;
        };
        let now = unix_now();
        if let Err(reason) = security.usage.reserve_stream(token, now, security.limits) {
            let metrics = security.usage.metrics();
            eprintln!(
                "{{\"event\":\"relay_quota_rejected\",\"reason\":\"{reason:?}\",\"active_streams\":{},\"connects_accepted\":{},\"rejected_concurrency\":{},\"rejected_rate\":{},\"rejected_bytes\":{},\"bytes_accounted\":{}}}",
                metrics.active_streams,
                metrics.connects_accepted,
                metrics.rejected_concurrency,
                metrics.rejected_rate,
                metrics.rejected_bytes,
                metrics.bytes_accounted,
            );
            return false;
        }
        self.quota_streams.insert(stream)
    }

    fn release_quota_stream(&mut self, stream: u32) {
        if !self.quota_streams.remove(&stream) {
            return;
        }
        if let (Some(security), Some(token)) = (&self.security, &self.authenticated_token) {
            security.usage.release_stream(&token.id);
        }
    }

    fn release_all_quota_streams(&mut self) {
        let streams: Vec<_> = self.quota_streams.iter().copied().collect();
        for stream in streams {
            self.release_quota_stream(stream);
        }
    }

    fn record_quota_bytes(&self, bytes: usize) -> bool {
        let Some(security) = &self.security else {
            return true;
        };
        let Some(token) = &self.authenticated_token else {
            return false;
        };
        let accepted = security
            .usage
            .record_bytes(&token.id, bytes, security.limits)
            .is_ok();
        if !accepted {
            let metrics = security.usage.metrics();
            eprintln!(
                "{{\"event\":\"relay_quota_rejected\",\"reason\":\"ByteLimit\",\"active_streams\":{},\"connects_accepted\":{},\"rejected_concurrency\":{},\"rejected_rate\":{},\"rejected_bytes\":{},\"bytes_accounted\":{}}}",
                metrics.active_streams,
                metrics.connects_accepted,
                metrics.rejected_concurrency,
                metrics.rejected_rate,
                metrics.rejected_bytes,
                metrics.bytes_accounted,
            );
        }
        accepted
    }
}

fn unix_now() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |duration| duration.as_secs())
}

fn frame_bytes(frame: &Frame) -> usize {
    match frame {
        Frame::Data { bytes, .. } | Frame::UdpData { bytes, .. } => bytes.len(),
        _ => 0,
    }
}

async fn resolve_destination(
    host: &str,
    port: u16,
    require_public: bool,
    protected_networks: &[ProtectedNetwork],
) -> Result<Vec<std::net::SocketAddr>, ()> {
    let addresses: Vec<_> = tokio::net::lookup_host((host, port))
        .await
        .map_err(|_| ())?
        .collect();
    // Reject a mixed answer in full. Picking only its public member would let a rebinding attacker
    // race the resolver/connect boundary or steer retries onto a protected address.
    if addresses.is_empty()
        || (require_public
            && !destinations_are_allowed(
                &addresses
                    .iter()
                    .map(|address| address.ip())
                    .collect::<Vec<_>>(),
                protected_networks,
            ))
    {
        return Err(());
    }
    Ok(addresses)
}

async fn connect_tcp_destination(
    host: &str,
    port: u16,
    require_public: bool,
    protected_networks: &[ProtectedNetwork],
) -> Result<TcpStream, ()> {
    for address in resolve_destination(host, port, require_public, protected_networks).await? {
        if let Ok(stream) = TcpStream::connect(address).await {
            return Ok(stream);
        }
    }
    Err(())
}

async fn connect_udp_destination(
    socket: &UdpSocket,
    host: &str,
    port: u16,
    require_public: bool,
    protected_networks: &[ProtectedNetwork],
) -> bool {
    let Ok(addresses) = resolve_destination(host, port, require_public, protected_networks).await
    else {
        return false;
    };
    for address in addresses {
        if socket.connect(address).await.is_ok() {
            return true;
        }
    }
    false
}

/// Backend → guest: acquire credit *permits* before reading, so a read can never exceed the credit
/// the guest granted (permits accumulate across grants — no coalescing over-read). Any permits not
/// backed by bytes read are returned.
async fn read_pump(
    stream: u32,
    mut rh: OwnedReadHalf,
    credit: Arc<Semaphore>,
    int_tx: mpsc::Sender<Internal>,
) {
    let mut buf = vec![0u8; READ_CHUNK];
    loop {
        // Block for at least 1 permit; then opportunistically take everything available up to the
        // chunk. The reader is the sole consumer of this stream's permits, so `try_acquire_many`
        // after `available_permits()` cannot lose a race (only the main loop *adds*).
        match credit.acquire().await {
            Ok(p) => p.forget(),
            Err(_) => break, // semaphore closed → stream torn down
        }
        let mut budget = 1usize;
        let extra = credit.available_permits().min(READ_CHUNK - 1);
        if extra > 0
            && let Ok(p) = credit.try_acquire_many(extra as u32)
        {
            p.forget();
            budget += extra;
        }

        match rh.read(&mut buf[..budget]).await {
            Ok(0) => {
                credit.add_permits(budget); // release the reservation we didn't use
                let _ = int_tx.send(Internal::SocketEof { stream }).await;
                break;
            }
            Ok(n) => {
                if n < budget {
                    credit.add_permits(budget - n); // return the permits we didn't consume
                }
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
            }
            Err(_) => {
                credit.add_permits(budget);
                let _ = int_tx.send(Internal::SocketError { stream }).await;
                break;
            }
        }
    }
}

/// Guest → backend: apply write / shutdown commands to the backend socket's write half, and report
/// each drained write so the main loop can refill the guest's window (backpressure tied to drain).
async fn write_pump(
    stream: u32,
    mut wh: OwnedWriteHalf,
    mut cmd_rx: mpsc::UnboundedReceiver<WriteCmd>,
    int_tx: mpsc::Sender<Internal>,
) {
    while let Some(cmd) = cmd_rx.recv().await {
        match cmd {
            WriteCmd::Data(bytes) => {
                let n = bytes.len() as u32;
                if wh.write_all(&bytes).await.is_err() {
                    let _ = int_tx.send(Internal::SocketError { stream }).await;
                    break;
                }
                if int_tx.send(Internal::Written { stream, n }).await.is_err() {
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
