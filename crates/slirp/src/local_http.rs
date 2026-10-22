//! Bounded, opt-in HTTP service on the slirp gateway. Requests traverse real smoltcp
//! TCP sockets; this module never creates an outbound connector or Ethernet fixture.
use std::cell::RefCell;
use std::rc::Rc;

use smoltcp::socket::tcp::State;

use crate::stack::SlirpStack;

pub const PORT: u16 = 9191;
pub const SLOTS: usize = 4;
pub const BODY_BYTES: usize = 1024;
pub const MAX_HEADER_BYTES: usize = 4096;
pub const MAX_CONNECTIONS: u32 = 128;
pub const MAX_LIFETIME_MS: u64 = 30_000;
pub const MAX_EGRESS_FRAMES: usize = 256;
pub const MAX_EGRESS_BYTES: usize = 1 << 20;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum HttpError {
    UnsupportedEndpoint,
    AlreadyRegistered,
    Closed,
    ConnectionLimit,
    EgressLimit,
}

/// Aggregate server observations, independent of the machine's recording state.
/// `body_bytes_queued` counts actual accepted TCP-stream writes, not guest ACKs;
/// the acceptance guest separately authenticates every received body.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct HttpStats {
    // Connection aggregates are bounded by MAX_CONNECTIONS, invalid requests by twice
    // that (an invalid header and one late payload), body bytes by MAX_CONNECTIONS * 1024.
    pub accepted_connections: u32,
    pub requests: [u32; 10],
    pub responses_queued: [u32; 10],
    pub body_bytes_queued: [u32; 10],
    pub invalid_requests: u32,
    pub timed_out: u32,
    pub cancelled_connections: u32,
    pub closed: bool,
    pub failure: Option<HttpError>,
}

#[derive(Clone)]
pub struct HttpStatsHandle(Rc<RefCell<HttpStats>>);
impl HttpStatsHandle {
    pub fn snapshot(&self) -> HttpStats {
        self.0.borrow().clone()
    }
}

#[derive(Default)]
struct Slot {
    connected: bool,
    started: u64,
    header: Vec<u8>,
    response: Vec<u8>,
    written: usize,
    body_at: usize,
    index: Option<usize>,
    finished: bool,
}

pub(crate) struct LocalHttpService {
    slots: [Slot; SLOTS],
    stats: HttpStatsHandle,
    last_now: u64,
}

#[derive(Debug, PartialEq, Eq)]
enum RequestError {
    Malformed,
    NotFound,
    HeaderTooLarge,
}

fn request_index(bytes: &[u8]) -> Result<usize, RequestError> {
    if bytes.len() > MAX_HEADER_BYTES {
        return Err(RequestError::HeaderTooLarge);
    }
    let text = std::str::from_utf8(bytes).map_err(|_| RequestError::Malformed)?;
    if !text.ends_with("\r\n\r\n")
        || text[..text.len() - 4].contains("\r\n\r\n")
        || bytes.iter().any(|b| *b == 0 || !b.is_ascii())
    {
        return Err(RequestError::Malformed);
    }
    let mut lines = text[..text.len() - 4].split("\r\n");
    let mut first = lines.next().ok_or(RequestError::Malformed)?.split(' ');
    if first.next() != Some("GET") {
        return Err(RequestError::Malformed);
    }
    let path = first.next().ok_or(RequestError::Malformed)?;
    let version = first.next();
    if !matches!(version, Some("HTTP/1.0" | "HTTP/1.1")) || first.next().is_some() {
        return Err(RequestError::Malformed);
    }
    let index = path.strip_prefix("/e9/").ok_or(RequestError::NotFound)?;
    let index: usize = match index {
        "1" => 0,
        "2" => 1,
        "3" => 2,
        "4" => 3,
        "5" => 4,
        "6" => 5,
        "7" => 6,
        "8" => 7,
        "9" => 8,
        "10" => 9,
        _ => return Err(RequestError::NotFound),
    };
    let mut content_length = false;
    let mut host = false;
    for line in lines {
        let (name, value) = line.split_once(':').ok_or(RequestError::Malformed)?;
        if name.is_empty()
            || !name.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-')
            || value.bytes().any(|b| b < 0x20 && b != b'\t' || b == 0x7f)
        {
            return Err(RequestError::Malformed);
        }
        if name.eq_ignore_ascii_case("host") {
            if host || value.trim() != "10.0.2.2:9191" {
                return Err(RequestError::Malformed);
            }
            host = true;
        }
        if name.eq_ignore_ascii_case("transfer-encoding") || name.eq_ignore_ascii_case("upgrade") {
            return Err(RequestError::Malformed);
        }
        if name.eq_ignore_ascii_case("content-length") {
            if content_length || value.trim() != "0" {
                return Err(RequestError::Malformed);
            }
            content_length = true;
        }
    }
    if version == Some("HTTP/1.1") && !host {
        return Err(RequestError::Malformed);
    }
    Ok(index)
}

fn response(index: Result<usize, RequestError>) -> (Vec<u8>, usize, Option<usize>) {
    match index {
        Ok(index) => {
            let mut bytes = b"HTTP/1.0 200 OK\r\nContent-Length: 1024\r\nContent-Type: application/octet-stream\r\nConnection: close\r\n\r\n".to_vec();
            let body_at = bytes.len();
            bytes.extend(std::iter::repeat_n(18 + index as u8, BODY_BYTES));
            (bytes, body_at, Some(index))
        }
        Err(error) => {
            let status = match error {
                RequestError::Malformed => "400 Bad Request",
                RequestError::NotFound => "404 Not Found",
                RequestError::HeaderTooLarge => "431 Request Header Fields Too Large",
            };
            let bytes =
                format!("HTTP/1.0 {status}\r\nContent-Length: 0\r\nConnection: close\r\n\r\n")
                    .into_bytes();
            let length = bytes.len();
            (bytes, length, None)
        }
    }
}

impl LocalHttpService {
    pub(crate) fn new() -> (Self, HttpStatsHandle) {
        let stats = HttpStatsHandle(Rc::new(RefCell::new(HttpStats::default())));
        (
            Self {
                slots: std::array::from_fn(|_| Slot::default()),
                stats: stats.clone(),
                last_now: 0,
            },
            stats,
        )
    }

    pub(crate) fn pending(&self) -> bool {
        !self.stats.0.borrow().closed && self.slots.iter().any(|slot| slot.connected)
    }

    pub(crate) fn buffered_bytes(&self) -> usize {
        self.slots
            .iter()
            .map(|slot| slot.header.len() + slot.response.len().saturating_sub(slot.written))
            .sum()
    }

    pub(crate) fn fail(&mut self, stack: &mut SlirpStack, failure: Option<HttpError>) {
        let mut stats = self.stats.0.borrow_mut();
        if stats.closed {
            return;
        }
        stats.closed = true;
        stats.failure = failure;
        for (index, slot) in self.slots.iter_mut().enumerate() {
            if slot.connected {
                stats.cancelled_connections += 1;
            }
            *slot = Slot::default();
            stack.http_tcp_abort(index);
        }
    }

    pub(crate) fn pump(&mut self, stack: &mut SlirpStack, now_ms: i64) {
        if self.stats.0.borrow().closed {
            return;
        }
        self.last_now = self.last_now.max(now_ms.max(0) as u64);
        let now = self.last_now;
        for index in 0..SLOTS {
            let state = stack.http_tcp_state(index);
            if matches!(state, State::Closed | State::TimeWait | State::Closing) {
                self.slots[index] = Slot::default();
                stack.http_tcp_relisten(index);
                continue;
            }
            if state == State::Listen {
                continue;
            }
            if !self.slots[index].connected {
                if self.stats.0.borrow().accepted_connections == MAX_CONNECTIONS {
                    self.fail(stack, Some(HttpError::ConnectionLimit));
                    return;
                }
                self.stats.0.borrow_mut().accepted_connections += 1;
                self.slots[index].connected = true;
                self.slots[index].started = now;
            }
            let slot = &mut self.slots[index];
            if now - slot.started >= MAX_LIFETIME_MS {
                self.stats.0.borrow_mut().timed_out += 1;
                *slot = Slot::default();
                stack.http_tcp_abort(index);
                continue;
            }
            if !matches!(state, State::Established | State::CloseWait) {
                continue;
            }
            let received = stack.http_tcp_recv(index);
            if slot.response.is_empty() {
                let parsed = if slot.header.len() + received.len() > MAX_HEADER_BYTES {
                    Some(Err(RequestError::HeaderTooLarge))
                } else {
                    slot.header.extend_from_slice(&received);
                    if slot.header.windows(4).any(|bytes| bytes == b"\r\n\r\n") {
                        Some(request_index(&slot.header))
                    } else if state == State::CloseWait {
                        Some(Err(RequestError::Malformed))
                    } else {
                        None
                    }
                };
                if let Some(parsed) = parsed {
                    if let Ok(i) = parsed {
                        self.stats.0.borrow_mut().requests[i] += 1;
                    } else {
                        self.stats.0.borrow_mut().invalid_requests += 1;
                    }
                    (slot.response, slot.body_at, slot.index) = response(parsed);
                    slot.header.clear();
                }
            } else if !received.is_empty() {
                // One request per connection. A late pipelined body cannot create a second job.
                stack.http_tcp_abort(index);
                *slot = Slot::default();
                self.stats.0.borrow_mut().invalid_requests += 1;
                continue;
            }
            if slot.response.is_empty() || slot.finished {
                continue;
            }
            let accepted = stack.http_tcp_send(index, &slot.response[slot.written..]);
            let before_body = slot.written.saturating_sub(slot.body_at);
            slot.written += accepted;
            let after_body = slot.written.saturating_sub(slot.body_at);
            if let Some(i) = slot.index {
                self.stats.0.borrow_mut().body_bytes_queued[i] += (after_body - before_body) as u32;
            }
            if slot.written == slot.response.len() {
                if let Some(i) = slot.index {
                    self.stats.0.borrow_mut().responses_queued[i] += 1;
                }
                slot.finished = true;
                stack.http_tcp_close(index);
            }
        }
    }
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;

    #[test]
    fn strict_requests_bind_each_index_and_refuse_smuggled_or_unbounded_work() {
        for index in 1..=10 {
            let request = format!("GET /e9/{index} HTTP/1.1\r\nHost: 10.0.2.2:9191\r\n\r\n");
            assert_eq!(request_index(request.as_bytes()), Ok(index - 1));
            let (bytes, body_at, selected) = response(request_index(request.as_bytes()));
            assert_eq!(selected, Some(index - 1));
            assert_eq!(&bytes[body_at..], vec![17 + index as u8; 1024]);
        }
        for invalid in [
            b"GET /e9/01 HTTP/1.0\r\n\r\n".as_slice(),
            b"GET /e9/11 HTTP/1.0\r\n\r\n",
            b"POST /e9/1 HTTP/1.0\r\n\r\n",
            b"GET /e9/1 HTTP/1.1\r\nContent-Length: 1\r\n\r\nx",
            b"GET /e9/1 HTTP/1.1\r\nTransfer-Encoding: chunked\r\n\r\n",
            b"GET /e9/1 HTTP/1.1\r\nContent-Length: 0\r\nContent-Length: 0\r\n\r\n",
            b"GET /e9/1 HTTP/1.0\r\n\r\nGET /e9/2 HTTP/1.0\r\n\r\n",
        ] {
            assert!(request_index(invalid).is_err());
        }
        assert_eq!(
            request_index(&vec![b'x'; MAX_HEADER_BYTES + 1]),
            Err(RequestError::HeaderTooLarge)
        );
    }

    use crate::{SlirpDevice, SlirpLocalBackend};
    use smoltcp::iface::{Config, Interface, SocketHandle, SocketSet};
    use smoltcp::socket::tcp;
    use smoltcp::time::Instant;
    use smoltcp::wire::{EthernetAddress, HardwareAddress, IpAddress, IpCidr};
    use std::cell::Cell;
    use wasm_vm_core::dev::virtio::net::NetBackend;

    const GUEST_MAC: [u8; 6] = [0x52, 0x54, 0, 0x12, 0x34, 0x56];
    const GATEWAY_MAC: [u8; 6] = [0x52, 0x54, 0, 0x12, 0x34, 0x02];

    struct Client {
        device: SlirpDevice,
        iface: Interface,
        sockets: SocketSet<'static>,
        socket: SocketHandle,
    }
    impl Client {
        fn new(port: u16, receive_bytes: usize, destination: u16) -> Self {
            let mut device = SlirpDevice::new();
            let mut config = Config::new(HardwareAddress::Ethernet(EthernetAddress(GUEST_MAC)));
            config.random_seed = u64::from(port) * 17;
            let mut iface = Interface::new(config, &mut device, Instant::from_millis(0));
            iface.update_ip_addrs(|addresses| {
                addresses
                    .push(IpCidr::new(IpAddress::Ipv4(crate::net::GUEST), 24))
                    .unwrap();
            });
            let mut sockets = SocketSet::new(vec![]);
            let socket = sockets.add(tcp::Socket::new(
                tcp::SocketBuffer::new(vec![0; receive_bytes]),
                tcp::SocketBuffer::new(vec![0; 8192]),
            ));
            sockets
                .get_mut::<tcp::Socket>(socket)
                .connect(iface.context(), (crate::net::GATEWAY, destination), port)
                .unwrap();
            Self {
                device,
                iface,
                sockets,
                socket,
            }
        }
        fn exchange(&mut self, server: &mut SlirpLocalBackend, now: i64) {
            self.iface.poll(
                Instant::from_millis(now),
                &mut self.device,
                &mut self.sockets,
            );
            for bytes in self.device.tx.drain(..) {
                server.tx(&bytes);
            }
            server.poll();
            while let Some(bytes) = server.rx() {
                self.device.rx.push_back(bytes);
            }
        }
    }

    struct RequestOptions {
        fragment: usize,
        receive_bytes: usize,
        read_bytes: usize,
        half_close: bool,
        destination: u16,
        cancel_at: Option<usize>,
        timeout_at: Option<usize>,
    }
    impl Default for RequestOptions {
        fn default() -> Self {
            Self {
                fragment: 8192,
                receive_bytes: 2048,
                read_bytes: 2048,
                half_close: false,
                destination: PORT,
                cancel_at: None,
                timeout_at: None,
            }
        }
    }

    fn request(
        server: &mut SlirpLocalBackend,
        clock: &Rc<Cell<i64>>,
        port: u16,
        bytes: &[u8],
        options: RequestOptions,
    ) -> Vec<u8> {
        let mut client = Client::new(port, options.receive_bytes, options.destination);
        let mut written = 0;
        let mut half_closed = false;
        let mut response = Vec::new();
        for tick in 0..40_000 {
            if options.cancel_at == Some(tick) {
                server.close_local_http();
            }
            if options.timeout_at == Some(tick) {
                clock.set(clock.get() + MAX_LIFETIME_MS as i64);
            }
            let socket = client.sockets.get_mut::<tcp::Socket>(client.socket);
            if socket.can_send() && written < bytes.len() {
                let end = (written + options.fragment).min(bytes.len());
                written += socket.send_slice(&bytes[written..end]).unwrap();
            }
            if options.half_close && !half_closed && written == bytes.len() {
                socket.close();
                half_closed = true;
            }
            client.exchange(server, clock.get());
            client.exchange(server, clock.get());
            let socket = client.sockets.get_mut::<tcp::Socket>(client.socket);
            if socket.can_recv() {
                socket
                    .recv(|part| {
                        let n = options.read_bytes.min(part.len());
                        response.extend_from_slice(&part[..n]);
                        (n, ())
                    })
                    .unwrap();
            }
            if !socket.may_recv() && socket.state() == State::CloseWait {
                socket.close();
            }
            if socket.state() == State::TimeWait && !socket.can_recv() {
                socket.abort();
            }
            if socket.state() == State::Closed && !socket.can_recv() {
                client.exchange(server, clock.get());
                client.exchange(server, clock.get());
                return response;
            }
            clock.set(clock.get() + 1);
        }
        panic!(
            "bounded HTTP client did not settle; bytes={}, state={:?}",
            response.len(),
            client.sockets.get::<tcp::Socket>(client.socket).state()
        );
    }

    #[test]
    fn four_concurrent_clients_fill_only_four_slots_and_fifth_is_refused() {
        let (mut server, stats, clock) = server();
        let mut clients: Vec<_> = (0..4).map(|i| Client::new(41000 + i, 2048, PORT)).collect();
        for _ in 0..20 {
            for client in &mut clients {
                client.exchange(&mut server, clock.get());
            }
            clock.set(clock.get() + 1);
        }
        assert!(clients.iter().all(
            |client| client.sockets.get::<tcp::Socket>(client.socket).state() == State::Established
        ));
        assert_eq!(stats.snapshot().accepted_connections, 4);
        let mut fifth = Client::new(41004, 2048, PORT);
        for _ in 0..20 {
            fifth.exchange(&mut server, clock.get());
            clock.set(clock.get() + 1);
        }
        assert_eq!(
            fifth.sockets.get::<tcp::Socket>(fifth.socket).state(),
            State::Closed
        );
        assert_eq!(stats.snapshot().accepted_connections, 4);
        assert!(!stats.snapshot().closed);
        server.close_local_http();
        assert_eq!(stats.snapshot().cancelled_connections, 4);
    }

    // Shared real client harness for the owned pump's failure-settlement test.
    pub(crate) fn reach_lifetime_limit(server: &mut SlirpLocalBackend, clock: &Rc<Cell<i64>>) {
        for index in 0..MAX_CONNECTIONS {
            let bytes = request(
                server,
                clock,
                42000 + index as u16,
                b"GET /e9/1 HTTP/1.1\r\nHost: 10.0.2.2:9191\r\n\r\n",
                RequestOptions::default(),
            );
            let body = bytes.windows(4).position(|b| b == b"\r\n\r\n").unwrap() + 4;
            assert_eq!(&bytes[body..], vec![18; 1024]);
        }
        let bytes = request(
            server,
            clock,
            43000,
            b"GET /e9/2 HTTP/1.1\r\nHost: 10.0.2.2:9191\r\n\r\n",
            RequestOptions::default(),
        );
        assert!(bytes.is_empty(), "129th client must never receive a body");
    }

    fn server() -> (SlirpLocalBackend, HttpStatsHandle, Rc<Cell<i64>>) {
        let clock = Rc::new(Cell::new(0i64));
        let local = clock.clone();
        let mut backend = SlirpLocalBackend::new(GATEWAY_MAC, Box::new(move || local.get()));
        let stats = backend.register_e9_local_http().unwrap();
        (backend, stats, clock)
    }

    #[test]
    fn real_tcp_all_ten_bodies_fragment_tiny_windows_half_close_and_relisten() {
        let (mut server, stats, clock) = server();
        let before = stats.snapshot();
        assert_eq!(
            server.register_e9_local_http().err(),
            Some(HttpError::AlreadyRegistered)
        );
        assert_eq!(before, stats.snapshot());
        for index in 1..=10u16 {
            let input = format!("GET /e9/{index} HTTP/1.1\r\nHost: 10.0.2.2:9191\r\n\r\n");
            let bytes = request(
                &mut server,
                &clock,
                41000 + index,
                input.as_bytes(),
                RequestOptions {
                    fragment: 3,
                    receive_bytes: 64,
                    read_bytes: 7,
                    half_close: index % 2 == 0,
                    ..Default::default()
                },
            );
            let body = bytes
                .windows(4)
                .position(|part| part == b"\r\n\r\n")
                .expect("real HTTP response")
                + 4;
            assert!(bytes.starts_with(b"HTTP/1.0 200 OK\r\n"));
            assert_eq!(&bytes[body..], vec![17 + index as u8; 1024]);
            let observed = stats.snapshot();
            assert_eq!(observed.requests[index as usize - 1], 1);
            assert_eq!(observed.responses_queued[index as usize - 1], 1);
            assert_eq!(observed.body_bytes_queued[index as usize - 1], 1024);
            assert!(!observed.closed);
        }
        let final_stats = stats.snapshot();
        assert_eq!(final_stats.accepted_connections, 10);
        assert_eq!(final_stats.requests, [1; 10]);
        assert_eq!(final_stats.body_bytes_queued, [1024; 10]);
    }

    #[test]
    fn real_tcp_refuses_other_ports_invalid_authority_body_and_header_overflow() {
        let (mut server, stats, clock) = server();
        let valid = b"GET /e9/1 HTTP/1.0\r\n\r\n";
        let before = stats.snapshot();
        assert!(
            request(
                &mut server,
                &clock,
                42001,
                valid,
                RequestOptions {
                    destination: PORT + 1,
                    ..Default::default()
                }
            )
            .is_empty()
        );
        assert_eq!(before, stats.snapshot());
        for (i, invalid) in [
            b"GET /e9/11 HTTP/1.0\r\n\r\n".as_slice(),
            b"GET /e9/1 HTTP/1.1\r\nHost: other.example\r\n\r\n",
            b"GET /e9/1 HTTP/1.0\r\nContent-Length: 1024\r\n\r\n",
        ]
        .iter()
        .enumerate()
        {
            let bytes = request(
                &mut server,
                &clock,
                42010 + i as u16,
                invalid,
                RequestOptions::default(),
            );
            assert!(!bytes.starts_with(b"HTTP/1.0 200"));
            assert!(bytes.starts_with(b"HTTP/1.0 4"));
        }
        let mut oversized = b"GET /e9/1 HTTP/1.0\r\nX: ".to_vec();
        oversized.extend(vec![b'a'; MAX_HEADER_BYTES]);
        let bytes = request(
            &mut server,
            &clock,
            42020,
            &oversized,
            RequestOptions {
                fragment: 127,
                ..Default::default()
            },
        );
        assert!(bytes.starts_with(b"HTTP/1.0 431"));
        assert_eq!(stats.snapshot().requests, [0; 10]);
        assert_eq!(stats.snapshot().invalid_requests, 4);
        let local = clock.clone();
        let mut ordinary = SlirpLocalBackend::new(GATEWAY_MAC, Box::new(move || local.get()));
        assert!(
            request(
                &mut ordinary,
                &clock,
                42021,
                valid,
                RequestOptions::default()
            )
            .is_empty()
        );
    }

    #[test]
    fn real_tcp_cancel_timeout_and_egress_overflow_are_finite_failures() {
        for cancel in [true, false] {
            let (mut server, stats, clock) = server();
            let bytes = request(
                &mut server,
                &clock,
                43001,
                b"GET /e9/1 HTTP/1.1\r\nHost: 10.0.2.2:9191\r\n\r\n",
                RequestOptions {
                    fragment: 1,
                    cancel_at: cancel.then_some(8),
                    timeout_at: (!cancel).then_some(8),
                    ..Default::default()
                },
            );
            assert!(bytes.is_empty());
            let snapshot = stats.snapshot();
            assert_eq!(snapshot.requests, [0; 10]);
            if cancel {
                assert!(snapshot.closed);
                assert_eq!(snapshot.cancelled_connections, 1);
            } else {
                assert_eq!(snapshot.timed_out, 1);
            }
        }
        let (mut server, stats, _) = server();
        let mut arp = vec![0u8; 42];
        arp[..6].fill(0xff);
        arp[6..12].copy_from_slice(&GUEST_MAC);
        arp[12..22].copy_from_slice(&[8, 6, 0, 1, 8, 0, 6, 4, 0, 1]);
        arp[22..28].copy_from_slice(&GUEST_MAC);
        arp[28..32].copy_from_slice(&crate::net::GUEST.octets());
        arp[38..42].copy_from_slice(&crate::net::GATEWAY.octets());
        for _ in 0..MAX_EGRESS_FRAMES + 8 {
            server.tx(&arp);
        }
        assert!(server.egress_len_for_test() <= MAX_EGRESS_FRAMES);
        assert_eq!(stats.snapshot().failure, Some(HttpError::EgressLimit));
    }
}
