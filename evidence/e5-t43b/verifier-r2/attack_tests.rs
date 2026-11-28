    // ===== E5-T43b round-2 verifier attacks (scratch copy only; appended to mod tests) =====

    /// Whenever idle() is true: 240 polls at 500 ms steps (120 s) produce no frame and idle()
    /// stays true. Returns whether the point was idle (so callers can count checked points).
    fn r2_contract(be: &mut SlirpLocalBackend, now: &Rc<Cell<i64>>, label: &str) -> bool {
        if !NetBackend::idle(be) {
            eprintln!("R2 {label}: not idle (dns {:?}, file {:?}/{:?}, xio {})", be.stack.dns_tcp_state(),
                be.stack.file_tcp_state(0), be.stack.file_tcp_state(1), NetBackend::external_io_pending(be));
            return false;
        }
        assert!(be.dns_tcp_rx.is_empty() && be.dns_tcp_tx.is_empty(), "{label}: idle with DNS-TCP bytes");
        assert!(be.file_connections.iter().all(Option::is_none), "{label}: idle with a file connection");
        assert!(be.file_tcp_tx.iter().all(VecDeque::is_empty), "{label}: idle with file bytes queued");
        assert!(be.flows.is_empty() && be.udp_flows.is_empty() && be.pending_dns.is_empty(), "{label}: idle with flows/dns");
        let start = now.get();
        for step in 1..=240 {
            now.set(start + step * 500);
            be.poll();
            assert!(!NetBackend::rx_ready(be), "{label}: CONTRACT — idle() true, poll at +{} ms produced a frame", step * 500);
            assert!(NetBackend::idle(be), "{label}: CONTRACT — idle() true, poll at +{} ms made it false", step * 500);
        }
        eprintln!("R2 {label}: idle, held over 120 s of polls");
        true
    }

    fn r2_drain(be: &mut SlirpLocalBackend) -> Vec<Vec<u8>> {
        let mut out = Vec::new();
        while let Some(f) = be.rx() { out.push(f); }
        out
    }

    fn r2_settle(be: &mut SlirpLocalBackend, now: &Rc<Cell<i64>>, ms: i64) -> usize {
        let mut frames = 0;
        let start = now.get();
        for step in 1..=(ms / 500) {
            now.set(start + step * 500);
            be.poll();
            frames += r2_drain(be).len();
        }
        frames
    }

    /// R5/R6/R8: scripted DNS-over-TCP and file-transfer lifecycles in the browser shape.
    #[test]
    fn r2_contract_dns_tcp_and_file_lifecycles() {
        let now = Rc::new(Cell::new(1_000i64));
        let mut be = browser_shaped(now.clone());
        be.tx(&guest_arp_request());
        r2_drain(&mut be);
        let mut checked = 0;
        checked += r2_contract(&mut be, &now, "after ARP") as u32;

        // UDP DNS answered.
        let q = dns::build_query(0x1111, "example.com", dns::TYPE_A);
        be.tx(&build_udp_frame(GUEST_MAC, GW_MAC, GUEST_IP, 41001, crate::net::DNS, 53, &q).unwrap());
        r2_drain(&mut be);
        checked += r2_contract(&mut be, &now, "UDP DNS answered") as u32;

        // DNS-over-TCP: partial length-prefixed message, then guest FIN.
        let cp = 40800;
        be.tx(&guest_tcp_segment(crate::net::DNS, cp, 53, 5000, None, TcpControl::Syn, &[]));
        let s = r2_drain(&mut be).iter().find_map(|f| match tcp_of(f) { Some((53, p, true, true, _, seq)) if p == cp => Some(seq), _ => None }).unwrap();
        be.tx(&guest_tcp_segment(crate::net::DNS, cp, 53, 5001, Some(s.wrapping_add(1)), TcpControl::None, &[]));
        r2_drain(&mut be);
        be.tx(&guest_tcp_segment(crate::net::DNS, cp, 53, 5001, Some(s.wrapping_add(1)), TcpControl::Psh, &[0, 40, 1, 2, 3]));
        r2_drain(&mut be);
        assert_eq!(be.dns_tcp_rx.len(), 5, "partial message buffered");
        be.tx(&guest_tcp_segment(crate::net::DNS, cp, 53, 5006, Some(s.wrapping_add(1)), TcpControl::Fin, &[]));
        let fin = r2_drain(&mut be).iter().find_map(|f| match tcp_of(f) { Some((53, p, _, _, true, seq)) if p == cp => Some(seq), _ => None });
        eprintln!("R2 dns partial+FIN: host FIN {fin:?}, state {:?}, rx {}", be.stack.dns_tcp_state(), be.dns_tcp_rx.len());
        checked += r2_contract(&mut be, &now, "DNS-TCP LastAck") as u32;
        be.tx(&guest_tcp_segment(crate::net::DNS, cp, 53, 5007, Some(fin.unwrap().wrapping_add(1)), TcpControl::None, &[]));
        r2_drain(&mut be);
        checked += r2_contract(&mut be, &now, "DNS-TCP closed after partial message") as u32;

        // File transfer: SYN, then guest RST in SynReceived (smoltcp returns the socket to Listen).
        be.tx(&guest_tcp_segment(GW_IP, 45100, crate::file_transfer::PORT, 7000, None, TcpControl::Syn, &[]));
        r2_drain(&mut be);
        be.tx(&guest_tcp_segment(GW_IP, 45100, crate::file_transfer::PORT, 7001, None, TcpControl::Rst, &[]));
        r2_drain(&mut be);
        eprintln!("R2 file RST in SynReceived: state {:?}", be.stack.file_tcp_state(0));
        checked += r2_contract(&mut be, &now, "file RST in SynReceived") as u32;

        // File transfer: established, garbage → host closes after its error frame (FinWait), guest
        // ACKs + FINs (TimeWait), then the 2MSL timer must drain it back to Listen.
        let isn = establish_file_tcp(&mut be, 45101, 8000);
        let mut cseq = 8001;
        let mut sseq = isn.wrapping_add(1);
        let reply = send_file_bytes(&mut be, 45101, &mut cseq, &mut sseq, b"GARBAGEGARBAGEGARBAGE!!");
        eprintln!("R2 file garbage: reply {} bytes, state {:?}, conn {:?}, close_after {:?}", reply.len(), be.stack.file_tcp_state(0), be.file_connections[0], be.file_close_after_write);
        checked += r2_contract(&mut be, &now, "file host-close after garbage") as u32;
        // host FIN seq = sseq (all payload consumed); guest ACKs the FIN and FINs.
        be.tx(&guest_tcp_segment(GW_IP, 45101, crate::file_transfer::PORT, cseq, Some(sseq.wrapping_add(1)), TcpControl::Fin, &[]));
        r2_drain(&mut be);
        eprintln!("R2 file after guest FIN: state {:?}", be.stack.file_tcp_state(0));
        checked += r2_contract(&mut be, &now, "file TimeWait") as u32;
        let f = r2_settle(&mut be, &now, 30_000);
        eprintln!("R2 file after 30 s: state {:?} frames {f}", be.stack.file_tcp_state(0));
        assert!(r2_contract(&mut be, &now, "file back to Listen after TimeWait"), "TimeWait must drain back to idle");
        checked += 1;
        eprintln!("R2 lifecycles: {checked} idle points held");
    }

    /// R10 sufficiency: a reachable state with slot 0 listening and slot 1 out of Listen (slot 1
    /// SynReceived). With the real code idle() must be false; the I5 mutant ("check slot 0 only")
    /// would report idle while a later poll retransmits the SYN-ACK.
    #[test]
    fn r2_slot1_isolated_half_open() {
        let now = Rc::new(Cell::new(1_000i64));
        let mut be = browser_shaped(now.clone());
        be.tx(&guest_arp_request());
        r2_drain(&mut be);
        // Slot 0 busy.
        let isn0 = establish_file_tcp(&mut be, 45200, 9000);
        // Second SYN lands on slot 1.
        be.tx(&guest_tcp_segment(GW_IP, 45201, crate::file_transfer::PORT, 9500, None, TcpControl::Syn, &[]));
        r2_drain(&mut be);
        // Slot 0 closes cleanly back to Listen.
        be.tx(&guest_tcp_segment(GW_IP, 45200, crate::file_transfer::PORT, 9001, Some(isn0.wrapping_add(1)), TcpControl::Fin, &[]));
        r2_drain(&mut be);
        be.tx(&guest_tcp_segment(GW_IP, 45200, crate::file_transfer::PORT, 9002, Some(isn0.wrapping_add(2)), TcpControl::None, &[]));
        r2_drain(&mut be);
        let states = (be.stack.file_tcp_state(0), be.stack.file_tcp_state(1));
        eprintln!("R2 slot1 isolated: states {states:?}, idle()={}", NetBackend::idle(&be));
        assert_eq!(states.0, smoltcp::socket::tcp::State::Listen);
        assert_eq!(states.1, smoltcp::socket::tcp::State::SynReceived);
        let idle = NetBackend::idle(&be);
        let frames = r2_settle(&mut be, &now, 5_000);
        eprintln!("R2 slot1 isolated: idle {idle}, frames over 5 s of polls {frames}");
        assert!(!(idle && frames > 0), "CONTRACT: idle() true with slot 1 SynReceived, poll retransmitted");
    }

    /// R7: local HTTP attached. Claim: "an attached local HTTP service is reported pending by
    /// external_io_pending". Observe the terms instead of trusting the claim.
    #[test]
    fn r2_local_http_why_not_idle() {
        let now = Rc::new(Cell::new(0i64));
        let n = now.clone();
        let mut be = SlirpLocalBackend::new(GW_MAC, Box::new(move || n.get()));
        be.register_e9_local_http().unwrap();
        eprintln!(
            "R2 local_http: external_io_pending={} egress={} dns_tcp={:?} file={:?}/{:?} idle={}",
            NetBackend::external_io_pending(&be), be.egress.len(), be.stack.dns_tcp_state(),
            be.stack.file_tcp_state(0), be.stack.file_tcp_state(1), NetBackend::idle(&be)
        );
        let frames = r2_settle(&mut be, &now, 120_000);
        eprintln!(
            "R2 local_http after 120 s quiet: frames {frames}, dns_tcp={:?} file={:?}/{:?} idle={}",
            be.stack.dns_tcp_state(), be.stack.file_tcp_state(0), be.stack.file_tcp_state(1), NetBackend::idle(&be)
        );
    }

    /// Scripted outbound TCP for R3/R8: Connecting → Established → sends "hi" → Closed.
    #[derive(Default)]
    struct ScriptTcpState { status: Option<ConnStatus>, inbound: Vec<u8>, closed: bool }
    struct ScriptTcp(Rc<RefCell<ScriptTcpState>>);
    impl SyncConnector for ScriptTcp {
        fn connect(&mut self, _h: Ipv4Addr, _p: u16) -> ConnId { 7 }
        fn status(&mut self, _id: ConnId) -> ConnStatus { self.0.borrow().status.clone().unwrap_or(ConnStatus::Connecting) }
        fn recv(&mut self, _id: ConnId) -> Vec<u8> { core::mem::take(&mut self.0.borrow_mut().inbound) }
        fn send(&mut self, _id: ConnId, d: &[u8]) -> usize { d.len() }
        fn shutdown_write(&mut self, _id: ConnId) {}
        fn close(&mut self, _id: ConnId) { self.0.borrow_mut().closed = true; }
    }

    /// R3/R8: a NAT TCP flow through remote data, remote close, guest close, teardown.
    #[test]
    fn r2_contract_nat_tcp_lifecycle() {
        const REMOTE: Ipv4Addr = Ipv4Addr::new(198, 51, 100, 7);
        let now = Rc::new(Cell::new(1_000i64));
        let n = now.clone();
        let st = Rc::new(RefCell::new(ScriptTcpState::default()));
        let mut be = SlirpLocalBackend::with_connector(GW_MAC, Box::new(move || n.get()), Box::new(ScriptTcp(st.clone())))
            .with_dns_service(Box::new(ImmediateDns::new(1, Rc::new(Cell::new(0)))));
        be.tx(&guest_arp_request());
        r2_drain(&mut be);
        assert!(r2_contract(&mut be, &now, "nat baseline"));
        be.tx(&guest_tcp_segment(REMOTE, 46000, 80, 100, None, TcpControl::Syn, &[]));
        let s = r2_drain(&mut be).iter().find_map(|f| match tcp_of(f) { Some((80, 46000, true, true, _, seq)) => Some(seq), _ => None }).expect("syn-ack");
        be.tx(&guest_tcp_segment(REMOTE, 46000, 80, 101, Some(s.wrapping_add(1)), TcpControl::None, &[]));
        r2_drain(&mut be);
        assert!(!r2_contract(&mut be, &now, "nat flow connecting"));
        st.borrow_mut().status = Some(ConnStatus::Established);
        st.borrow_mut().inbound = b"hi".to_vec();
        now.set(now.get() + 1);
        be.poll();
        let got = r2_drain(&mut be);
        eprintln!("R2 nat: frames after remote data {}", got.len());
        st.borrow_mut().status = Some(ConnStatus::Closed);
        now.set(now.get() + 1);
        be.poll();
        let fin = r2_drain(&mut be).iter().find_map(|f| match tcp_of(f) { Some((80, 46000, _, _, true, seq)) => Some(seq), _ => None });
        eprintln!("R2 nat: host FIN seq {fin:?}, flows {}", be.flows.len());
        assert!(!r2_contract(&mut be, &now, "nat flow FinWait"));
        let fin = fin.expect("host FIN");
        be.tx(&guest_tcp_segment(REMOTE, 46000, 80, 101, Some(fin.wrapping_add(1)), TcpControl::Fin, &[]));
        r2_drain(&mut be);
        now.set(now.get() + 1);
        be.poll();
        r2_drain(&mut be);
        eprintln!("R2 nat: after guest FIN flows {} manager {} closed {}", be.flows.len(), be.manager.flow_count(), st.borrow().closed);
        let idle = r2_contract(&mut be, &now, "nat flow torn down");
        eprintln!("R2 nat: torn-down idle {idle}");
    }
