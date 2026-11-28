
    // ===== E5-T43b verifier attacks (scratch copy only) =====
    fn browser_shaped(now: Rc<Cell<i64>>) -> SlirpLocalBackend {
        let clock = Box::new(move || now.get());
        let state = Rc::new(RefCell::new(UdpProbeState::default()));
        SlirpLocalBackend::with_connector(GW_MAC, clock, Box::new(UdpProbe(state)))
            .with_dns_service(Box::new(ImmediateDns::new(1, Rc::new(Cell::new(0)))))
    }

    fn tcp_of(frame: &[u8]) -> Option<(u16, u16, bool, bool, bool, i32)> {
        let eth = EthernetFrame::new_checked(frame).ok()?;
        let ip = Ipv4Packet::new_checked(eth.payload()).ok()?;
        let tcp = TcpPacket::new_checked(ip.payload()).ok()?;
        Some((tcp.src_port(), tcp.dst_port(), tcp.syn(), tcp.ack(), tcp.fin(), tcp.seq_number().0))
    }

    /// P3: half-open guest handshake to the file-transfer endpoint.
    #[test]
    fn verifier_p3_half_open_file_transfer_syn() {
        let now = Rc::new(Cell::new(1_000i64));
        let mut be = browser_shaped(now.clone());
        be.tx(&guest_arp_request());
        while be.rx().is_some() {}
        assert!(NetBackend::idle(&be), "baseline idle");
        be.tx(&guest_tcp_segment(GW_IP, 45000, crate::file_transfer::PORT, 7000, None, TcpControl::Syn, &[]));
        let mut synacks = 0;
        while let Some(f) = be.rx() {
            if let Some((_, _, true, true, _, _)) = tcp_of(&f) { synacks += 1; }
        }
        assert_eq!(synacks, 1);
        let idle_after = NetBackend::idle(&be);
        eprintln!("P3 idle() after SYN-ACK drained, socket SynReceived: {idle_after}; state {:?}", be.stack.file_tcp_state(0));
        let mut changed_at = None;
        for step in 1..=120 {
            now.set(1_000 + step * 500);
            be.poll();
            if NetBackend::rx_ready(&be) {
                changed_at = Some(now.get());
                break;
            }
        }
        let mut retrans = 0;
        while let Some(f) = be.rx() {
            if let Some((_, _, true, true, _, _)) = tcp_of(&f) { retrans += 1; }
        }
        eprintln!("P3 poll() first produced a frame at clock {changed_at:?} ms (SYN-ACK retransmissions drained: {retrans}); idle() was {idle_after}");
        assert!(!(idle_after && changed_at.is_some()), "CONTRACT: idle() true but a later poll produced a frame");
    }

    /// P4: guest closes an established (HELLO-less) agent slot; host side sits in LastAck.
    #[test]
    fn verifier_p4_last_ack_after_guest_fin() {
        let now = Rc::new(Cell::new(1_000i64));
        let mut be = browser_shaped(now.clone());
        be.tx(&guest_arp_request());
        while be.rx().is_some() {}
        let server_isn = establish_file_tcp(&mut be, 45001, 9000);
        assert!(!NetBackend::idle(&be), "established slot: not idle");
        be.tx(&guest_tcp_segment(GW_IP, 45001, crate::file_transfer::PORT, 9001, Some(server_isn.wrapping_add(1)), TcpControl::Fin, &[]));
        let mut fins = 0;
        while let Some(f) = be.rx() {
            if let Some((_, _, _, _, true, _)) = tcp_of(&f) { fins += 1; }
        }
        let idle_after = NetBackend::idle(&be);
        eprintln!("P4 host FINs drained: {fins}; idle()={idle_after}; slot state {:?}; conn {:?}", be.stack.file_tcp_state(0), be.file_connections[0]);
        let mut changed_at = None;
        for step in 1..=120 {
            now.set(1_000 + step * 500);
            be.poll();
            if NetBackend::rx_ready(&be) {
                changed_at = Some(now.get());
                break;
            }
        }
        eprintln!("P4 poll() first produced a frame at clock {changed_at:?} ms; state now {:?}", be.stack.file_tcp_state(0));
        assert!(!(idle_after && changed_at.is_some()), "CONTRACT: idle() true but a later poll produced a frame");
    }

    /// P4b: the same, but the guest ACKs the host FIN (the normal, lossless case).
    #[test]
    fn verifier_p4b_full_close_returns_idle() {
        let now = Rc::new(Cell::new(1_000i64));
        let mut be = browser_shaped(now.clone());
        be.tx(&guest_arp_request());
        while be.rx().is_some() {}
        let server_isn = establish_file_tcp(&mut be, 45002, 9100);
        be.tx(&guest_tcp_segment(GW_IP, 45002, crate::file_transfer::PORT, 9101, Some(server_isn.wrapping_add(1)), TcpControl::Fin, &[]));
        while be.rx().is_some() {}
        be.tx(&guest_tcp_segment(GW_IP, 45002, crate::file_transfer::PORT, 9102, Some(server_isn.wrapping_add(2)), TcpControl::None, &[]));
        while be.rx().is_some() {}
        eprintln!("P4b after guest ACK of FIN: state {:?} idle()={}", be.stack.file_tcp_state(0), NetBackend::idle(&be));
        for step in 1..=120 {
            now.set(1_000 + step * 500);
            be.poll();
            assert!(!NetBackend::rx_ready(&be), "quiet after a clean close");
        }
        eprintln!("P4b after 60 s of polls: state {:?} idle()={}", be.stack.file_tcp_state(0), NetBackend::idle(&be));
    }

    /// P6: quiet established agent slot — poll does nothing but idle() stays false.
    #[test]
    fn verifier_p6_quiet_established_slot() {
        let now = Rc::new(Cell::new(1_000i64));
        let mut be = browser_shaped(now.clone());
        be.tx(&guest_arp_request());
        while be.rx().is_some() {}
        let _ = establish_file_tcp(&mut be, 45003, 9200);
        let mut produced = 0;
        for step in 1..=1200 {
            now.set(1_000 + step * 500);
            be.poll();
            while be.rx().is_some() { produced += 1; }
        }
        eprintln!("P6 established slot after 600 s of polls: frames {produced}, idle()={}, state {:?}", NetBackend::idle(&be), be.stack.file_tcp_state(0));
    }

    /// P5: DNS-over-TCP full cycle returns idle.
    #[test]
    fn verifier_p5_dns_tcp_cycle() {
        let now = Rc::new(Cell::new(1_000i64));
        let mut be = browser_shaped(now.clone());
        be.tx(&guest_arp_request());
        while be.rx().is_some() {}
        let cp = 40600;
        be.tx(&guest_tcp_segment(crate::net::DNS, cp, 53, 1000, None, TcpControl::Syn, &[]));
        let mut server_isn = None;
        while let Some(f) = be.rx() {
            if let Some((53, p, true, true, _, seq)) = tcp_of(&f) { if p == cp { server_isn = Some(seq); } }
        }
        let s = server_isn.expect("syn-ack");
        assert!(!NetBackend::idle(&be), "DNS TCP in handshake: not idle");
        be.tx(&guest_tcp_segment(crate::net::DNS, cp, 53, 1001, Some(s.wrapping_add(1)), TcpControl::None, &[]));
        while be.rx().is_some() {}
        let q = dns::build_query(0x1234, "example.com", dns::TYPE_A);
        let mut framed = (q.len() as u16).to_be_bytes().to_vec();
        framed.extend_from_slice(&q);
        be.tx(&guest_tcp_segment(crate::net::DNS, cp, 53, 1001, Some(s.wrapping_add(1)), TcpControl::Psh, &framed));
        let mut srv_bytes = 0usize;
        let mut host_fin_seq = None;
        while let Some(f) = be.rx() {
            if let Some((53, _, _, _, fin, seq)) = tcp_of(&f) { if fin { host_fin_seq = Some(seq); } }
            srv_bytes += 1;
        }
        let gseq = 1001 + framed.len() as i32;
        // Guest ACKs the answer and FINs.
        let ack_to = s.wrapping_add(1).wrapping_add(2 + 0); // placeholder, recomputed below
        let _ = ack_to;
        eprintln!("P5 answer frames {srv_bytes}, idle() with conn open = {}", NetBackend::idle(&be));
        // Close: just reset the connection from the guest side (RST) — simplest terminal path.
        be.tx(&guest_tcp_segment(crate::net::DNS, cp, 53, gseq, None, TcpControl::Rst, &[]));
        while be.rx().is_some() {}
        eprintln!("P5 after guest RST: dns_tcp_state {:?} idle()={} fin_seen={:?}", be.stack.dns_tcp_state(), NetBackend::idle(&be), host_fin_seq);
    }
