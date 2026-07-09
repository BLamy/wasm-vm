//! E3-T14: `SlirpBackend` — plug the slirp user-mode network stack into the machine's virtio-net.
//!
//! The machine's [`NetBackend`] is a **synchronous** trait the run loop calls every quantum
//! (`tx` per guest frame, `rx`/`rx_ready` to feed the guest). slirp's `Bridge` is **async** (its
//! `on_guest_frame` awaits outbound `connect`, and `service` spawns tokio byte-pump tasks). We bridge
//! the two with a **dedicated driver thread** that owns the `Bridge` on a current-thread tokio
//! runtime and loops: receive guest frames off a channel → `on_guest_frame`, tick periodically →
//! `poll`/`service`/`expire`, then drain `take_egress` into a shared queue the guest reads. Keeping
//! the `Bridge` (which owns non-`Send` smoltcp state) on that one thread means nothing smoltcp ever
//! crosses a thread boundary — only `Vec<u8>` frames do, over the channels.
//!
//! Scope (pass 1): the TCP bridge path (guest SYN → real outbound socket → bytes both ways). DHCP so
//! a booted guest auto-configures, DNS/UDP services, and the long booted-Alpine acceptance are the
//! next passes; until DHCP lands, a guest must be given a static address (the integration test drives
//! frames directly). Known limitation, documented for the concurrency pass: `on_guest_frame` awaits
//! `connect` inside the driver's select arm, so a connect to an unreachable host serializes the loop
//! until its timeout — fine for reachable/local flows; the fix is to spawn the connect.

use std::collections::VecDeque;
use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;
use std::time::{Duration, Instant};

use wasm_vm_core::dev::virtio::net::NetBackend;
use wasm_vm_slirp::{Bridge, NativeConnector};

/// The slirp gateway's own MAC (10.0.2.2), distinct from the guest's virtio-net MAC
/// (`wasm_vm_core::dev::virtio::net::MAC` = 52:54:00:12:34:56). Locally-administered; the guest
/// learns it via ARP for the gateway.
pub const GATEWAY_MAC: [u8; 6] = [0x52, 0x54, 0x00, 0x12, 0x34, 0x02];

/// How many concurrent guest TCP flows the NAT table holds before LRU-evicting the oldest.
const MAX_FLOWS: usize = 256;
/// Driver tick — how often we `poll` smoltcp + `service` the pumps when no guest frame arrives.
/// smoltcp timers (retransmit, delayed-ACK) and server-initiated data both need this cadence.
const TICK: Duration = Duration::from_millis(1);

/// A [`NetBackend`] that terminates the guest's ethernet world in slirp and NATs it onto real
/// outbound sockets via [`NativeConnector`]. Cheap to call from the run loop: `tx` is a channel
/// send, `rx`/`rx_ready` read a shared queue — all real work is on the driver thread.
pub struct SlirpBackend {
    /// Guest → slirp: frames the guest transmitted, handed to the driver thread. `Option` so `Drop`
    /// can take + drop it, which ends the driver's `recv().await` and lets the thread exit.
    to_driver: Option<tokio::sync::mpsc::UnboundedSender<Vec<u8>>>,
    /// slirp → guest: egress frames the driver produced, drained by `rx`.
    egress: Arc<Mutex<VecDeque<Vec<u8>>>>,
    driver: Option<JoinHandle<()>>,
}

impl SlirpBackend {
    /// Start the driver thread with a fresh `Bridge` bound to `mac`. Returns immediately; the thread
    /// runs until this backend is dropped.
    pub fn new(mac: [u8; 6]) -> Self {
        let (to_driver, from_guest) = tokio::sync::mpsc::unbounded_channel::<Vec<u8>>();
        let egress: Arc<Mutex<VecDeque<Vec<u8>>>> = Arc::new(Mutex::new(VecDeque::new()));
        let egress_driver = Arc::clone(&egress);
        let driver = std::thread::Builder::new()
            .name("slirp-driver".into())
            .spawn(move || driver_loop(mac, from_guest, egress_driver))
            .expect("spawn slirp driver thread");
        SlirpBackend {
            to_driver: Some(to_driver),
            egress,
            driver: Some(driver),
        }
    }
}

/// The driver thread body: own the `Bridge` on a current-thread runtime and pump it forever.
fn driver_loop(
    mac: [u8; 6],
    mut from_guest: tokio::sync::mpsc::UnboundedReceiver<Vec<u8>>,
    egress: Arc<Mutex<VecDeque<Vec<u8>>>>,
) {
    let rt = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .expect("slirp driver tokio runtime");
    rt.block_on(async move {
        let start = Instant::now();
        let now_ms = || start.elapsed().as_millis() as i64;
        let mut bridge = Bridge::new(mac, NativeConnector::new(), MAX_FLOWS);
        let mut tick = tokio::time::interval(TICK);
        // Drive-on-cadence, not catch-up: after a stall (e.g. a slow connect) we want ONE resume
        // tick, not a burst of missed ones each re-running poll/service (critic m2).
        tick.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
        loop {
            tokio::select! {
                maybe = from_guest.recv() => match maybe {
                    // The guest transmitted a frame; feed it into the stack (may open an outbound flow).
                    Some(frame) => bridge.on_guest_frame(frame, now_ms() as u64).await,
                    // The backend was dropped (all senders gone) — shut the driver down.
                    None => break,
                },
                _ = tick.tick() => {}
            }
            // After every event, drive the stack + pumps and harvest anything bound for the guest.
            let t = now_ms();
            bridge.poll(t);
            bridge.service();
            bridge.expire(t as u64);
            let out = bridge.take_egress();
            if !out.is_empty() {
                // No hard cap here: egress is bounded below by smoltcp's per-socket send windows +
                // retransmit gating (it stops producing to-guest frames when the guest RX ring isn't
                // serviced), and the guest→driver channel is bounded by the guest's own tx rate. The
                // per-flow pump depth is capped at PUMP_DEPTH in slirp. (critic m3)
                let mut q = egress.lock().expect("egress mutex");
                q.extend(out);
            }
        }
    });
}

impl NetBackend for SlirpBackend {
    fn tx(&mut self, frame: &[u8]) {
        // Non-blocking hand-off to the driver. If the driver is gone (shutting down), drop the frame.
        if let Some(tx) = &self.to_driver {
            let _ = tx.send(frame.to_vec());
        }
    }

    fn rx(&mut self) -> Option<Vec<u8>> {
        self.egress.lock().expect("egress mutex").pop_front()
    }

    fn rx_ready(&self) -> bool {
        !self.egress.lock().expect("egress mutex").is_empty()
    }
}

impl Drop for SlirpBackend {
    fn drop(&mut self) {
        // Drop the only sender so the driver's `recv().await` yields `None` and the loop breaks.
        self.to_driver.take();
        if let Some(h) = self.driver.take() {
            // Bounded join (critic M1): an in-flight `connect().await` runs inside the driver's
            // already-resolved `select!` arm, so it is NOT interrupted by the sender dropping — a
            // plain `join()` would block up to the connector's timeout (~10 s to a black-holed host).
            // Give it a short grace window to exit cleanly, then detach: the thread is
            // self-terminating (its `recv()` returns `None` once the connect resolves) and owns all
            // its state (Bridge, runtime, its clone of `egress`), so detaching is memory-safe.
            let (done_tx, done_rx) = std::sync::mpsc::channel();
            std::thread::spawn(move || {
                let _ = h.join();
                let _ = done_tx.send(());
            });
            let _ = done_rx.recv_timeout(std::time::Duration::from_millis(250));
        }
    }
}

#[cfg(test)]
mod tests {
    //! Drive the backend exactly as the machine's run loop does (`tx` a guest frame; poll
    //! `rx`/`rx_ready` for frames to the guest) — but hand the frames in directly instead of booting.
    //! (A) ARP round-trip proves the whole async-driver plumbing; (B) a guest SYN to a REAL local
    //! server proves slirp actually dials it (accept fires) and hands back a SYN-ACK — slirp's point.
    use super::{GATEWAY_MAC, SlirpBackend};
    use smoltcp::wire::{
        ArpOperation, ArpPacket, ArpRepr, EthernetAddress, EthernetFrame, EthernetProtocol,
        EthernetRepr, IpProtocol, Ipv4Address, Ipv4Packet, Ipv4Repr, TcpControl, TcpPacket,
        TcpRepr, TcpSeqNumber,
    };
    use std::time::{Duration, Instant};
    use wasm_vm_core::dev::virtio::net::{MAC as GUEST_MAC, NetBackend};

    const GUEST_IP: Ipv4Address = Ipv4Address::new(10, 0, 2, 15);
    const GATEWAY_IP: Ipv4Address = Ipv4Address::new(10, 0, 2, 2);

    fn wait_for_frame(
        backend: &mut SlirpBackend,
        dur: Duration,
        mut pred: impl FnMut(&[u8]) -> bool,
    ) -> Option<Vec<u8>> {
        let deadline = Instant::now() + dur;
        while Instant::now() < deadline {
            while let Some(f) = backend.rx() {
                if pred(&f) {
                    return Some(f);
                }
            }
            std::thread::sleep(Duration::from_millis(2));
        }
        None
    }

    fn guest_arp_request() -> Vec<u8> {
        let arp = ArpRepr::EthernetIpv4 {
            operation: ArpOperation::Request,
            source_hardware_addr: EthernetAddress(GUEST_MAC),
            source_protocol_addr: GUEST_IP,
            target_hardware_addr: EthernetAddress([0; 6]),
            target_protocol_addr: GATEWAY_IP,
        };
        let eth = EthernetRepr {
            src_addr: EthernetAddress(GUEST_MAC),
            dst_addr: EthernetAddress::BROADCAST,
            ethertype: EthernetProtocol::Arp,
        };
        let mut buf = vec![0u8; eth.buffer_len() + arp.buffer_len()];
        let mut frame = EthernetFrame::new_unchecked(&mut buf);
        eth.emit(&mut frame);
        let mut apkt = ArpPacket::new_unchecked(frame.payload_mut());
        arp.emit(&mut apkt);
        buf
    }

    fn guest_tcp_syn(src_port: u16, dst: Ipv4Address, dst_port: u16) -> Vec<u8> {
        let tcp = TcpRepr {
            src_port,
            dst_port,
            control: TcpControl::Syn,
            seq_number: TcpSeqNumber(1000),
            ack_number: None,
            window_len: 64240,
            window_scale: None,
            max_seg_size: Some(1460),
            sack_permitted: false,
            sack_ranges: [None, None, None],
            timestamp: None,
            payload: &[],
        };
        let ip = Ipv4Repr {
            src_addr: GUEST_IP,
            dst_addr: dst,
            next_header: IpProtocol::Tcp,
            payload_len: tcp.buffer_len(),
            hop_limit: 64,
        };
        let eth = EthernetRepr {
            src_addr: EthernetAddress(GUEST_MAC),
            dst_addr: EthernetAddress(GATEWAY_MAC),
            ethertype: EthernetProtocol::Ipv4,
        };
        let mut buf = vec![0u8; eth.buffer_len() + ip.buffer_len() + tcp.buffer_len()];
        let mut frame = EthernetFrame::new_unchecked(&mut buf);
        eth.emit(&mut frame);
        let mut ippkt = Ipv4Packet::new_unchecked(frame.payload_mut());
        ip.emit(&mut ippkt, &Default::default());
        let mut tpkt = TcpPacket::new_unchecked(ippkt.payload_mut());
        tcp.emit(
            &mut tpkt,
            &GUEST_IP.into(),
            &dst.into(),
            &Default::default(),
        );
        buf
    }

    /// Build a guest TCP segment (ACK or PSH+ACK, no MSS option) with an explicit seq/ack — used to
    /// complete the handshake and carry data after the SYN.
    #[allow(clippy::too_many_arguments)]
    fn guest_tcp_seg(
        src_port: u16,
        dst: Ipv4Address,
        dst_port: u16,
        seq: TcpSeqNumber,
        ack: TcpSeqNumber,
        ctrl: TcpControl,
        payload: &[u8],
    ) -> Vec<u8> {
        let tcp = TcpRepr {
            src_port,
            dst_port,
            control: ctrl,
            seq_number: seq,
            ack_number: Some(ack),
            window_len: 64240,
            window_scale: None,
            max_seg_size: None,
            sack_permitted: false,
            sack_ranges: [None, None, None],
            timestamp: None,
            payload,
        };
        let ip = Ipv4Repr {
            src_addr: GUEST_IP,
            dst_addr: dst,
            next_header: IpProtocol::Tcp,
            payload_len: tcp.buffer_len(),
            hop_limit: 64,
        };
        let eth = EthernetRepr {
            src_addr: EthernetAddress(GUEST_MAC),
            dst_addr: EthernetAddress(GATEWAY_MAC),
            ethertype: EthernetProtocol::Ipv4,
        };
        let mut buf = vec![0u8; eth.buffer_len() + ip.buffer_len() + tcp.buffer_len()];
        let mut frame = EthernetFrame::new_unchecked(&mut buf);
        eth.emit(&mut frame);
        let mut ippkt = Ipv4Packet::new_unchecked(frame.payload_mut());
        ip.emit(&mut ippkt, &Default::default());
        let mut tpkt = TcpPacket::new_unchecked(ippkt.payload_mut());
        tcp.emit(
            &mut tpkt,
            &GUEST_IP.into(),
            &dst.into(),
            &Default::default(),
        );
        buf
    }

    /// Parse a guest-bound frame as IPv4/TCP: `(dst_port, syn, ack, seq, ack_no, payload)`.
    fn guest_tcp(f: &[u8]) -> Option<(u16, bool, bool, i32, i32, Vec<u8>)> {
        let frame = EthernetFrame::new_checked(f).ok()?;
        if frame.ethertype() != EthernetProtocol::Ipv4 {
            return None;
        }
        let ip = Ipv4Packet::new_checked(frame.payload()).ok()?;
        if ip.next_header() != IpProtocol::Tcp {
            return None;
        }
        let tcp = TcpPacket::new_checked(ip.payload()).ok()?;
        Some((
            tcp.dst_port(),
            tcp.syn(),
            tcp.ack(),
            tcp.seq_number().0,
            tcp.ack_number().0,
            tcp.payload().to_vec(),
        ))
    }

    #[test]
    fn guest_arp_for_gateway_gets_a_reply_through_the_backend() {
        let mut backend = SlirpBackend::new(GATEWAY_MAC);
        backend.tx(&guest_arp_request());
        let reply = wait_for_frame(&mut backend, Duration::from_secs(3), |f| {
            let Ok(frame) = EthernetFrame::new_checked(f) else {
                return false;
            };
            if frame.ethertype() != EthernetProtocol::Arp {
                return false;
            }
            let Ok(pkt) = ArpPacket::new_checked(frame.payload()) else {
                return false;
            };
            ArpRepr::parse(&pkt)
                .map(|r| {
                    matches!(r, ArpRepr::EthernetIpv4 { operation, source_protocol_addr, source_hardware_addr, .. }
                        if operation == ArpOperation::Reply
                            && source_protocol_addr == GATEWAY_IP
                            && source_hardware_addr == EthernetAddress(GATEWAY_MAC))
                })
                .unwrap_or(false)
        });
        assert!(
            reply.is_some(),
            "expected a gateway ARP reply back through the backend"
        );
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn guest_syn_dials_a_real_server_and_gets_a_syn_ack() {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        let accepted = tokio::spawn(async move { listener.accept().await.map(|_| ()) });

        let dst = Ipv4Address::new(127, 0, 0, 1);
        let src_port = 40001u16;
        let syn_ack = tokio::task::spawn_blocking(move || {
            let mut backend = SlirpBackend::new(GATEWAY_MAC);
            // ARP first so the stack learns the guest's MAC (neighbor cache) — otherwise it can't
            // address the SYN-ACK back to the guest and just ARP-storms for it (as a real guest's
            // stack would have ARPed the gateway before sending traffic).
            backend.tx(&guest_arp_request());
            std::thread::sleep(Duration::from_millis(50));
            backend.tx(&guest_tcp_syn(src_port, dst, addr.port()));
            wait_for_frame(&mut backend, Duration::from_secs(3), |f| {
                let Ok(frame) = EthernetFrame::new_checked(f) else {
                    return false;
                };
                if frame.ethertype() != EthernetProtocol::Ipv4 {
                    return false;
                }
                let Ok(ip) = Ipv4Packet::new_checked(frame.payload()) else {
                    return false;
                };
                if ip.next_header() != IpProtocol::Tcp {
                    return false;
                }
                let Ok(tcp) = TcpPacket::new_checked(ip.payload()) else {
                    return false;
                };
                // A SYN-ACK to the guest's source port: slirp accepted the flow and is handshaking back.
                tcp.dst_port() == src_port && tcp.syn() && tcp.ack()
            })
            .is_some()
        })
        .await
        .unwrap();

        let dialed = tokio::time::timeout(Duration::from_secs(3), accepted)
            .await
            .expect("server accept() should fire within 3s (slirp dialed it)")
            .unwrap()
            .is_ok();

        assert!(
            dialed,
            "slirp should open a real outbound TCP connection to the echo server"
        );
        assert!(
            syn_ack,
            "guest should receive a SYN-ACK from slirp for the accepted flow"
        );
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn guest_tcp_data_round_trips_through_the_backend_to_a_real_echo_server() {
        // A real echo server: accept one connection, copy read→write. The guest's bytes only come
        // back if slirp's byte pump actually shuttled them out to this socket and the echo back in —
        // this is the data-path proof the SYN-ACK-only tests don't give (critic M2).
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        tokio::spawn(async move {
            if let Ok((mut sock, _)) = listener.accept().await {
                let (mut r, mut w) = sock.split();
                let _ = tokio::io::copy(&mut r, &mut w).await;
            }
        });

        let marker = b"PING_slirp_42".to_vec();
        let dst = Ipv4Address::new(127, 0, 0, 1);
        let src_port = 40007u16;
        let echoed = tokio::task::spawn_blocking(move || {
            let mut backend = SlirpBackend::new(GATEWAY_MAC);
            backend.tx(&guest_arp_request());
            std::thread::sleep(Duration::from_millis(50));
            // Handshake: SYN (our ISN=1000) → read slirp's SYN-ACK to learn its ISN → ACK.
            backend.tx(&guest_tcp_syn(src_port, dst, addr.port()));
            let synack = wait_for_frame(&mut backend, Duration::from_secs(3), |f| {
                matches!(guest_tcp(f), Some((dp, syn, ack, ..)) if dp == src_port && syn && ack)
            })
            .expect("SYN-ACK");
            let (.., server_isn, _my_ack, _) = guest_tcp(&synack).unwrap();
            let my_seq = TcpSeqNumber(1001); // our ISN + 1
            let my_ack = TcpSeqNumber(server_isn.wrapping_add(1));
            backend.tx(&guest_tcp_seg(
                src_port,
                dst,
                addr.port(),
                my_seq,
                my_ack,
                TcpControl::None,
                &[],
            ));
            // Send the data (PSH+ACK) and wait for the SAME bytes to come back from the echo server.
            backend.tx(&guest_tcp_seg(
                src_port,
                dst,
                addr.port(),
                my_seq,
                my_ack,
                TcpControl::Psh,
                &marker,
            ));
            wait_for_frame(&mut backend, Duration::from_secs(5), |f| {
                matches!(guest_tcp(f), Some((dp, .., payload))
                    if dp == src_port && payload.windows(marker.len()).any(|w| w == marker.as_slice()))
            })
            .is_some()
        })
        .await
        .unwrap();

        assert!(
            echoed,
            "guest should receive its bytes echoed back through slirp's pump from the real server"
        );
    }
}
