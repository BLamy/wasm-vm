//! E3-T14: `SlirpBackend` — plug the slirp user-mode network stack into the machine's virtio-net.
//!
//! The machine's [`NetBackend`] is synchronous. A dedicated driver thread owns the same
//! [`SlirpLocalBackend`] used by wasm, with [`StdConnector`] supplying real non-blocking TCP and UDP
//! sockets. Guest frames cross the thread boundary; smoltcp state never does. Sharing this backend
//! is deliberate: native and browser now exercise identical NAT, expiry, framing, and backpressure
//! logic, while only their connector transport differs (OS sockets vs. WebSocket relay).
//!
//! Current scope: TCP and external UDP NAT plus DHCP. DNS service wiring remains E3-T15.

use std::collections::{BTreeMap, VecDeque};
use std::net::Ipv4Addr;
use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;
use std::time::{Duration, Instant};

use wasm_vm_core::dev::virtio::net::NetBackend;
use wasm_vm_slirp::{SlirpLocalBackend, StdConnector};

/// The slirp gateway's own MAC (10.0.2.2), distinct from the guest's virtio-net MAC
/// (`wasm_vm_core::dev::virtio::net::MAC` = 52:54:00:12:34:56). Locally-administered; the guest
/// learns it via ARP for the gateway.
pub const GATEWAY_MAC: [u8; 6] = [0x52, 0x54, 0x00, 0x12, 0x34, 0x02];

/// Driver tick — how often we `poll` smoltcp + `service` the pumps when no guest frame arrives.
/// smoltcp timers (retransmit, delayed-ACK) and server-initiated data both need this cadence.
const TICK: Duration = Duration::from_millis(1);

/// A [`NetBackend`] that terminates the guest's ethernet world in slirp and NATs it onto real
/// outbound sockets via [`StdConnector`]. Cheap to call from the run loop: `tx` is a channel
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
    /// Start the driver thread with a fresh shared local backend bound to `mac`. Returns immediately;
    /// the thread runs until this backend is dropped.
    pub fn new(mac: [u8; 6]) -> Self {
        let host_map = host_map_from_env();
        let (to_driver, from_guest) = tokio::sync::mpsc::unbounded_channel::<Vec<u8>>();
        let egress: Arc<Mutex<VecDeque<Vec<u8>>>> = Arc::new(Mutex::new(VecDeque::new()));
        let egress_driver = Arc::clone(&egress);
        let driver = std::thread::Builder::new()
            .name("slirp-driver".into())
            .spawn(move || driver_loop(mac, host_map, from_guest, egress_driver))
            .expect("spawn slirp driver thread");
        SlirpBackend {
            to_driver: Some(to_driver),
            egress,
            driver: Some(driver),
        }
    }
}

/// Optional deterministic native-acceptance mapping, e.g.
/// `WASM_VM_SLIRP_HOST_MAP=192.0.2.1=127.0.0.1`. The guest keeps the task's TEST-NET target while
/// the real HTTP server remains safely bound to loopback.
fn host_map_from_env() -> BTreeMap<Ipv4Addr, Ipv4Addr> {
    let Some(spec) = std::env::var_os("WASM_VM_SLIRP_HOST_MAP") else {
        return BTreeMap::new();
    };
    let spec = spec.to_string_lossy();
    let mut map = BTreeMap::new();
    for entry in spec.split(',').filter(|entry| !entry.is_empty()) {
        let (source, target) = entry.split_once('=').unwrap_or_else(|| {
            panic!("invalid WASM_VM_SLIRP_HOST_MAP entry {entry:?}; expected source=target")
        });
        let source: Ipv4Addr = source
            .parse()
            .unwrap_or_else(|_| panic!("invalid source IP in WASM_VM_SLIRP_HOST_MAP: {source:?}"));
        let target: Ipv4Addr = target
            .parse()
            .unwrap_or_else(|_| panic!("invalid target IP in WASM_VM_SLIRP_HOST_MAP: {target:?}"));
        assert!(
            map.insert(source, target).is_none(),
            "duplicate source IP in WASM_VM_SLIRP_HOST_MAP: {source}"
        );
    }
    map
}

/// The driver thread body: own the synchronous backend on a current-thread runtime and pump forever.
fn driver_loop(
    mac: [u8; 6],
    host_map: BTreeMap<Ipv4Addr, Ipv4Addr>,
    mut from_guest: tokio::sync::mpsc::UnboundedReceiver<Vec<u8>>,
    egress: Arc<Mutex<VecDeque<Vec<u8>>>>,
) {
    let rt = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .expect("slirp driver tokio runtime");
    rt.block_on(async move {
        let start = Instant::now();
        let connector = StdConnector::new().with_host_map(host_map);
        let mut backend = SlirpLocalBackend::with_connector(
            mac,
            Box::new(move || start.elapsed().as_millis() as i64),
            Box::new(connector),
        );
        let mut tick = tokio::time::interval(TICK);
        // Drive-on-cadence, not catch-up: after a stall (e.g. a slow connect) we want ONE resume
        // tick, not a burst of missed ones each re-running poll/service (critic m2).
        tick.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
        loop {
            tokio::select! {
                maybe = from_guest.recv() => match maybe {
                    // The guest transmitted a frame; feed it into the stack (may open an outbound flow).
                    Some(frame) => backend.tx(&frame),
                    // The backend was dropped (all senders gone) — shut the driver down.
                    None => break,
                },
                _ = tick.tick() => {}
            }
            // After every event, drive the stack + pumps and harvest anything bound for the guest.
            backend.poll();
            let mut out = Vec::new();
            while let Some(frame) = backend.rx() {
                out.push(frame);
            }
            if !out.is_empty() {
                // No hard cap here: egress is bounded below by smoltcp's per-socket send windows +
                // retransmit gating (it stops producing to-guest frames when the guest RX ring isn't
                // serviced), and the guest→driver channel is bounded by the guest's own tx rate. The
                // per-flow connector/NAT queues are explicitly capped in slirp. (critic m3)
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
            // Give the runtime thread a short grace window to observe sender closure and exit. TCP
            // dials themselves run on short-lived connector threads, so they cannot block this join.
            // Detaching after the grace window is memory-safe: the driver owns all remaining state.
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
    use wasm_vm_slirp::{build_udp_frame, parse_udp};

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

    fn guest_dhcp_discover() -> Vec<u8> {
        let mut bootp = vec![0u8; 236];
        bootp[0] = 1; // BOOTREQUEST
        bootp[1] = 1; // ethernet
        bootp[2] = 6;
        bootp[28..34].copy_from_slice(&GUEST_MAC);
        bootp.extend_from_slice(&[0x63, 0x82, 0x53, 0x63]); // DHCP cookie
        bootp.extend_from_slice(&[53, 1, 1, 255]); // DISCOVER + END
        build_udp_frame(
            GUEST_MAC,
            [0xff; 6],
            std::net::Ipv4Addr::UNSPECIFIED,
            68,
            std::net::Ipv4Addr::BROADCAST,
            67,
            &bootp,
        )
        .expect("build DHCP discover")
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

    #[test]
    fn guest_dhcp_discover_gets_an_offer_through_the_native_driver() {
        let mut backend = SlirpBackend::new(GATEWAY_MAC);
        backend.tx(&guest_dhcp_discover());
        let offer = wait_for_frame(&mut backend, Duration::from_secs(3), |frame| {
            if frame.len() < 42 + 244 {
                return false;
            }
            let bootp = &frame[42..];
            bootp[0] == 2
                && bootp[16..20] == [10, 0, 2, 15]
                && bootp[240..].windows(3).any(|option| option == [53, 1, 2])
        });
        assert!(
            offer.is_some(),
            "native driver must answer DHCP so Alpine can auto-configure eth0"
        );
    }

    /// Full production-driver regression for the verifier's refused-connect finding. A real closed
    /// loopback port must produce a guest-visible RST within the driver's deadline; merely deleting
    /// the internal flow and waiting for the guest's TCP timeout is not acceptable behavior.
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn guest_syn_to_a_refused_port_gets_a_prompt_rst_from_the_native_driver() {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        drop(listener); // the selected port now deterministically refuses a connect

        let got_rst = tokio::task::spawn_blocking(move || {
            let mut backend = SlirpBackend::new(GATEWAY_MAC);
            backend.tx(&guest_arp_request());
            std::thread::sleep(Duration::from_millis(50));
            let src_port = 40009;
            backend.tx(&guest_tcp_syn(
                src_port,
                Ipv4Address::new(127, 0, 0, 1),
                port,
            ));
            wait_for_frame(&mut backend, Duration::from_secs(3), |frame| {
                let Ok(eth) = EthernetFrame::new_checked(frame) else {
                    return false;
                };
                let Ok(ip) = Ipv4Packet::new_checked(eth.payload()) else {
                    return false;
                };
                let Ok(tcp) = TcpPacket::new_checked(ip.payload()) else {
                    return false;
                };
                tcp.dst_port() == src_port && tcp.rst()
            })
            .is_some()
        })
        .await
        .unwrap();

        assert!(
            got_rst,
            "a refused native outbound connect must RST the guest within 3 seconds"
        );
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn external_udp_round_trips_through_the_native_driver() {
        let echo = tokio::net::UdpSocket::bind("127.0.0.1:0").await.unwrap();
        let port = echo.local_addr().unwrap().port();
        tokio::spawn(async move {
            let mut buf = [0u8; 2048];
            if let Ok((n, peer)) = echo.recv_from(&mut buf).await {
                let _ = echo.send_to(&buf[..n], peer).await;
            }
        });

        let response = tokio::task::spawn_blocking(move || {
            let mut backend = SlirpBackend::new(GATEWAY_MAC);
            let request = build_udp_frame(
                GUEST_MAC,
                GATEWAY_MAC,
                GUEST_IP,
                41001,
                Ipv4Address::new(127, 0, 0, 1),
                port,
                b"native-udp-datagram",
            )
            .unwrap();
            backend.tx(&request);
            wait_for_frame(&mut backend, Duration::from_secs(3), |frame| {
                parse_udp(frame).is_some_and(|udp| {
                    udp.src_ip == Ipv4Address::new(127, 0, 0, 1)
                        && udp.src_port == port
                        && udp.dst_port == 41001
                        && udp.payload == b"native-udp-datagram"
                })
            })
        })
        .await
        .unwrap();

        assert!(
            response.is_some(),
            "the native production driver must preserve an external UDP datagram round trip"
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
