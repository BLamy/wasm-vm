//! External UDP proof through the complete browser-side Rust path:
//! guest Ethernet frame → SlirpLocalBackend NAT → WsConnector frames → production RelayServer →
//! real UDP socket → reply back through every layer. The browser JS adapter is separately covered
//! by the real-WebSocket UDP test; this test holds the NAT and connector composition together.

use std::net::Ipv4Addr;
use std::sync::Arc;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Duration;

use tokio::sync::mpsc;
use wasm_vm_core::dev::virtio::net::NetBackend;
use wasm_vm_slirp::ws_proxy::{Frame, RelayServer};
use wasm_vm_slirp::{
    FrameTransport, SlirpLocalBackend, SyncConnector, WsConnector, build_udp_frame, parse_udp,
};

const GUEST_MAC: [u8; 6] = [0x52, 0x54, 0x00, 0x12, 0x34, 0x56];
const GATEWAY_MAC: [u8; 6] = [0x52, 0x54, 0x00, 0x12, 0x34, 0x02];

struct ChannelTransport {
    tx: mpsc::Sender<Vec<u8>>,
    rx: mpsc::Receiver<Vec<u8>>,
    failed: bool,
}

impl FrameTransport for ChannelTransport {
    fn send(&mut self, frame: Frame) {
        let Some(bytes) = frame.encode() else {
            self.failed = true;
            return;
        };
        if self.tx.try_send(bytes).is_err() {
            self.failed = true;
        }
    }

    fn poll(&mut self) -> Vec<Frame> {
        let mut out = Vec::new();
        loop {
            match self.rx.try_recv() {
                Ok(bytes) => match Frame::decode(&bytes) {
                    Some(frame) => out.push(frame),
                    None => self.failed = true,
                },
                Err(mpsc::error::TryRecvError::Empty) => break,
                Err(mpsc::error::TryRecvError::Disconnected) => {
                    self.failed = true;
                    break;
                }
            }
        }
        out
    }

    fn is_open(&self) -> bool {
        !self.failed && !self.tx.is_closed()
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn guest_udp_round_trips_through_ws_connector_and_production_relay() {
    let echo = tokio::net::UdpSocket::bind("127.0.0.1:0").await.unwrap();
    let port = echo.local_addr().unwrap().port();
    tokio::spawn(async move {
        let mut buf = [0u8; 4096];
        while let Ok((n, peer)) = echo.recv_from(&mut buf).await {
            if echo.send_to(&buf[..n], peer).await.is_err() {
                break;
            }
        }
    });

    let (to_relay_tx, to_relay_rx) = mpsc::channel(64);
    let (from_relay_tx, from_relay_rx) = mpsc::channel(64);
    tokio::spawn(RelayServer::new(to_relay_rx, from_relay_tx, Vec::new()).run());
    let connector: Box<dyn SyncConnector> = Box::new(WsConnector::new(
        ChannelTransport {
            tx: to_relay_tx,
            rx: from_relay_rx,
            failed: false,
        },
        Vec::new(),
    ));
    let now = Arc::new(AtomicU64::new(1));
    let clock = {
        let now = now.clone();
        Box::new(move || now.fetch_add(1, Ordering::Relaxed) as i64)
    };
    let mut backend = SlirpLocalBackend::with_connector(GATEWAY_MAC, clock, connector);
    let request = build_udp_frame(
        GUEST_MAC,
        GATEWAY_MAC,
        "10.0.2.15".parse().unwrap(),
        42000,
        "127.0.0.1".parse().unwrap(),
        port,
        b"browser-path-udp",
    )
    .unwrap();
    backend.tx(&request);

    let response = tokio::time::timeout(Duration::from_secs(5), async {
        loop {
            backend.poll();
            while let Some(frame) = backend.rx() {
                if let Some(udp) = parse_udp(&frame)
                    && udp.dst_port == 42000
                    && udp.payload == b"browser-path-udp"
                {
                    return udp;
                }
            }
            tokio::time::sleep(Duration::from_millis(1)).await;
        }
    })
    .await
    .expect("UDP round trip through the production relay timed out");

    assert_eq!(response.src_ip, Ipv4Addr::LOCALHOST);
    assert_eq!(response.src_port, port);
    assert_eq!(response.dst_ip, Ipv4Addr::new(10, 0, 2, 15));
    assert_eq!(response.payload, b"browser-path-udp");
}
