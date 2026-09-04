//! E5-T23e: proof-only host driver for the real Alpine virtio-console agent.
//!
//! This module deliberately sits beside the CLI boot loop instead of becoming part of the
//! protocol or transport implementation.  It drives the already-frozen named port from the host,
//! drives the serial shell only far enough to inspect/restart the service, and writes a compact
//! report at the end of the run.  Normal `wasm-vm boot` runs never construct this type.

use std::cell::RefCell;
use std::collections::{HashMap, VecDeque};
use std::path::PathBuf;
use std::rc::Rc;
use std::time::{Duration, Instant};

use serde_json::json;
use wasm_vm_agent_protocol::{
    CAP_PING, FLAG_NONE, Frame, FrameDecoder, Hello, MAX_PAYLOAD_BYTES, Nak, PROTOCOL_VERSION,
    Ping, TYPE_HELLO, TYPE_NAK, TYPE_PING, TYPE_PONG, encode_frame,
};
use wasm_vm_core::RunOutcome;
use wasm_vm_core::dev::uart16550::Uart16550;
use wasm_vm_core::dev::virtio::console::ConsoleState;

const BASIC_PINGS: u64 = 8;
const FLOOD_PINGS: u64 = 10_000;
const UNKNOWN_TYPE: u16 = 0x7ffe;
const BOUNDARY_TYPE: u16 = 0x7ffd;
const INFLIGHT_NONCE: u64 = 0xe5e0_0000_0000_0001;
const AGENT_INPUT_CHUNK: usize = 16 * 1024;
const SERIAL_TAIL_BYTES: usize = 8192;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum Stage {
    WaitingLogin,
    WaitingRootPrompt,
    WaitingLoginMarker,
    WaitingPortMarker,
    Handshaking,
    BasicTraffic,
    Flood,
    Boundary,
    Restarting,
    ReconnectMarker,
    Stopping,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum PendingKind {
    Basic,
    Flood,
    InFlight,
}

/// The proof driver is intentionally single-threaded with the emulator, just like the Machine
/// itself.  The only queues are bounded by the protocol/data budgets or by the fixed proof cases.
pub(crate) struct AgentProof {
    output: PathBuf,
    state: Rc<RefCell<ConsoleState>>,
    decoder: FrameDecoder,
    stage: Stage,
    started: Instant,
    port_open_at: Option<Instant>,
    first_hello_at: Option<Instant>,
    hello_count: u64,
    hello_versions: Vec<u16>,
    hello_capabilities: Vec<u64>,
    host_hello_sent: bool,
    version_bump_sent: bool,
    version_bump_ok: bool,
    reconnect_host_hello_sent: bool,
    reconnect_hello_seen: bool,
    reconnect_negotiated: bool,
    restart_hello_floor: u64,
    pending_pings: HashMap<u64, (Instant, PendingKind)>,
    basic_pongs: u64,
    flood_pongs: u64,
    ping_latencies: Vec<Duration>,
    agent_pending: VecDeque<u8>,
    uart_pending: VecDeque<u8>,
    serial_tail: Vec<u8>,
    login_sent: bool,
    password_dismissed: bool,
    login_marker_sent: bool,
    port_marker_seen: bool,
    unknown_sent: bool,
    unknown_nak: bool,
    boundary_started: bool,
    boundary_nak: bool,
    saturation_command_sent: bool,
    serial_marker_seen: bool,
    inflight_staged: bool,
    inflight_lost: bool,
    restart_command_sent: bool,
    restart_marker_seen: bool,
    reconnect_marker_sent: bool,
    poweroff_sent: bool,
    max_agent_input_bytes: usize,
    max_agent_output_bytes: usize,
    max_pending_pings: usize,
    failures: Vec<String>,
}

impl AgentProof {
    pub(crate) fn new(state: Rc<RefCell<ConsoleState>>, output: PathBuf) -> Self {
        Self {
            output,
            state,
            decoder: FrameDecoder::new(),
            stage: Stage::WaitingLogin,
            started: Instant::now(),
            port_open_at: None,
            first_hello_at: None,
            hello_count: 0,
            hello_versions: Vec::new(),
            hello_capabilities: Vec::new(),
            host_hello_sent: false,
            version_bump_sent: false,
            version_bump_ok: false,
            reconnect_host_hello_sent: false,
            reconnect_hello_seen: false,
            reconnect_negotiated: false,
            restart_hello_floor: 0,
            pending_pings: HashMap::new(),
            basic_pongs: 0,
            flood_pongs: 0,
            ping_latencies: Vec::new(),
            agent_pending: VecDeque::new(),
            uart_pending: VecDeque::new(),
            serial_tail: Vec::new(),
            login_sent: false,
            password_dismissed: false,
            login_marker_sent: false,
            port_marker_seen: false,
            unknown_sent: false,
            unknown_nak: false,
            boundary_started: false,
            boundary_nak: false,
            saturation_command_sent: false,
            serial_marker_seen: false,
            inflight_staged: false,
            inflight_lost: false,
            restart_command_sent: false,
            restart_marker_seen: false,
            reconnect_marker_sent: false,
            poweroff_sent: false,
            max_agent_input_bytes: 0,
            max_agent_output_bytes: 0,
            max_pending_pings: 0,
            failures: Vec::new(),
        }
    }

    /// Pump one post-quantum host boundary.  UART output has already been drained by the caller;
    /// the same byte stream is inspected here while still being written unchanged to stdout.
    pub(crate) fn pump(&mut self, serial_output: &[u8], uart: &Rc<RefCell<Uart16550>>) {
        self.observe_serial(serial_output);
        self.observe_bounds();
        self.drain_agent_output();
        self.observe_bounds();

        if self.state.borrow().agent_open() {
            if self.port_open_at.is_none() {
                self.port_open_at = Some(Instant::now());
            }
            if !self.host_hello_sent {
                self.queue_hello(PROTOCOL_VERSION);
                self.host_hello_sent = true;
            }
        }

        self.drive_serial_state();
        self.advance_protocol_state();
        self.pump_agent_input();

        // Put the serial saturation marker behind a non-empty agent input queue.  This ordering
        // makes the isolation claim observable in the same guest run rather than merely adjacent
        // to the flood setup.
        if self.stage == Stage::Flood
            && !self.saturation_command_sent
            && self.state.borrow().agent_input_bytes() != 0
        {
            self.queue_uart_line("echo T23E_SERIAL_\"OK\"");
            self.saturation_command_sent = true;
        }
        self.pump_uart(uart);
        self.observe_bounds();
    }

    fn observe_serial(&mut self, output: &[u8]) {
        if output.is_empty() {
            return;
        }
        self.serial_tail.extend_from_slice(output);
        if self.serial_tail.len() > SERIAL_TAIL_BYTES {
            let cut = self.serial_tail.len() - SERIAL_TAIL_BYTES / 2;
            self.serial_tail.drain(..cut);
        }
    }

    fn serial_has(&self, marker: &[u8]) -> bool {
        self.serial_tail
            .windows(marker.len())
            .any(|window| window == marker)
    }

    fn queue_uart_line(&mut self, line: &str) {
        self.uart_pending.extend(line.as_bytes());
        self.uart_pending.push_back(b'\n');
    }

    fn pump_uart(&mut self, uart: &Rc<RefCell<Uart16550>>) {
        if self.uart_pending.is_empty() {
            return;
        }
        let free = uart.borrow().rx_free();
        let count = free.min(self.uart_pending.len());
        if count == 0 {
            return;
        }
        let bytes: Vec<u8> = self.uart_pending.drain(..count).collect();
        uart.borrow_mut().push_input(&bytes);
    }

    fn drain_agent_output(&mut self) {
        let bytes = self.state.borrow_mut().take_agent_output();
        if bytes.is_empty() {
            return;
        }
        let mut frames = Vec::new();
        if let Err(error) = self.decoder.push(&bytes, |frame| frames.push(frame)) {
            self.fail(format!("host decoder rejected guest output: {error}"));
            return;
        }
        for frame in frames {
            self.handle_frame(frame);
        }
    }

    fn handle_frame(&mut self, frame: Frame) {
        match frame.message_type {
            TYPE_HELLO => match Hello::from_payload(&frame.payload) {
                Ok(hello) => {
                    self.hello_count = self.hello_count.saturating_add(1);
                    self.hello_versions.push(hello.version);
                    self.hello_capabilities.push(hello.capabilities);
                    if self.first_hello_at.is_none() {
                        self.first_hello_at = Some(Instant::now());
                    }
                    if self.version_bump_sent
                        && hello.version == PROTOCOL_VERSION
                        && hello.capabilities & CAP_PING != 0
                    {
                        self.version_bump_ok = true;
                    }
                    if self.stage == Stage::Restarting
                        && self.restart_command_sent
                        && self.hello_count > self.restart_hello_floor
                        && !self.reconnect_host_hello_sent
                    {
                        self.reconnect_hello_seen = true;
                        self.reconnect_host_hello_sent = true;
                        self.queue_hello(PROTOCOL_VERSION);
                        if self.pending_pings.remove(&INFLIGHT_NONCE).is_some() {
                            self.inflight_lost = true;
                        }
                    } else if self.stage == Stage::Restarting
                        && self.reconnect_host_hello_sent
                        && self.hello_count >= self.restart_hello_floor.saturating_add(2)
                    {
                        self.reconnect_negotiated = true;
                    }
                }
                Err(error) => self.fail(format!("guest HELLO payload was invalid: {error}")),
            },
            TYPE_PONG => match Ping::from_payload(&frame.payload) {
                Ok(ping) => {
                    let Some((sent, kind)) = self.pending_pings.remove(&ping.nonce) else {
                        self.fail(format!("unexpected PONG nonce {:#x}", ping.nonce));
                        return;
                    };
                    match kind {
                        PendingKind::Basic => {
                            self.basic_pongs = self.basic_pongs.saturating_add(1);
                            self.ping_latencies.push(sent.elapsed());
                        }
                        PendingKind::Flood => {
                            self.flood_pongs = self.flood_pongs.saturating_add(1);
                        }
                        PendingKind::InFlight => {
                            self.fail("the deliberately partial in-flight PING completed".into());
                        }
                    }
                }
                Err(error) => self.fail(format!("guest PONG payload was invalid: {error}")),
            },
            TYPE_NAK => match Nak::from_payload(&frame.payload) {
                Ok(nak) => {
                    if nak.rejected_type == UNKNOWN_TYPE {
                        self.unknown_nak = true;
                    }
                    if nak.rejected_type == BOUNDARY_TYPE {
                        self.boundary_nak = true;
                    }
                }
                Err(error) => self.fail(format!("guest NAK payload was invalid: {error}")),
            },
            other => self.fail(format!("unexpected guest frame type {other:#x}")),
        }
    }

    fn advance_protocol_state(&mut self) {
        match self.stage {
            Stage::Handshaking
                if self.port_marker_seen
                    && self.hello_count >= 2
                    && self.pending_pings.is_empty() =>
            {
                self.start_basic_traffic();
            }
            Stage::BasicTraffic
                if self.basic_pongs == BASIC_PINGS
                    && self.unknown_nak
                    && self.version_bump_ok
                    && self.pending_pings.is_empty()
                    && self.agent_pending.is_empty() =>
            {
                self.start_flood();
            }
            Stage::Flood
                if self.flood_pongs == FLOOD_PINGS
                    && self.agent_pending.is_empty()
                    && self.saturation_command_sent
                    && self.serial_marker_seen
                    && self.pending_pings.is_empty() =>
            {
                self.start_boundary();
            }
            Stage::Boundary
                if self.boundary_nak
                    && self.agent_pending.is_empty()
                    && self.pending_pings.is_empty() =>
            {
                self.start_restart();
            }
            Stage::Restarting
                if self.restart_command_sent
                    && self.restart_marker_seen
                    && self.reconnect_negotiated
                    && !self.reconnect_marker_sent =>
            {
                self.queue_uart_line("echo T23E_RECONNECT_\"OK\"");
                self.reconnect_marker_sent = true;
                self.stage = Stage::ReconnectMarker;
            }
            Stage::ReconnectMarker if self.serial_has(b"T23E_RECONNECT_OK") => {
                self.queue_uart_line("poweroff");
                self.poweroff_sent = true;
                self.stage = Stage::Stopping;
            }
            _ => {}
        }

        if self.stage == Stage::Restarting
            && self.inflight_staged
            && !self.restart_command_sent
            && self.state.borrow().agent_input_bytes() == 0
        {
            self.queue_uart_line("rc-service wasmvm-agent restart; echo T23E_RESTART_\"OK\"");
            self.restart_command_sent = true;
            self.restart_hello_floor = self.hello_count;
        }
    }

    fn start_basic_traffic(&mut self) {
        self.stage = Stage::BasicTraffic;
        for index in 0..BASIC_PINGS {
            let nonce = 0xe5e0_0000_0001_0000 + index;
            self.queue_ping(nonce, PendingKind::Basic);
        }
        self.queue_frame(UNKNOWN_TYPE, &[]);
        self.unknown_sent = true;
        self.queue_hello(2);
        self.version_bump_sent = true;
    }

    fn start_flood(&mut self) {
        self.stage = Stage::Flood;
        for index in 0..FLOOD_PINGS {
            let nonce = 0xe5e0_1000_0000_0000 + index;
            self.queue_ping(nonce, PendingKind::Flood);
        }
    }

    fn start_boundary(&mut self) {
        self.stage = Stage::Boundary;
        self.boundary_started = true;
        let payload = vec![0xa5; MAX_PAYLOAD_BYTES];
        self.queue_frame(BOUNDARY_TYPE, &payload);
    }

    fn start_restart(&mut self) {
        self.stage = Stage::Restarting;
        self.inflight_staged = true;
        self.pending_pings
            .insert(INFLIGHT_NONCE, (Instant::now(), PendingKind::InFlight));
        let frame = Self::encoded_frame(TYPE_PING, &INFLIGHT_NONCE.to_le_bytes());
        self.agent_pending.extend(frame.into_iter().take(3));
    }

    fn queue_ping(&mut self, nonce: u64, kind: PendingKind) {
        self.pending_pings.insert(nonce, (Instant::now(), kind));
        self.max_pending_pings = self.max_pending_pings.max(self.pending_pings.len());
        self.queue_frame(TYPE_PING, &nonce.to_le_bytes());
    }

    fn queue_hello(&mut self, version: u16) {
        let mut payload = [0u8; Hello::PAYLOAD_BYTES];
        let hello = Hello::new(version, CAP_PING);
        if let Err(error) = hello.encode_payload(&mut payload) {
            self.fail(format!("cannot encode host HELLO: {error}"));
            return;
        }
        self.queue_frame(TYPE_HELLO, &payload);
    }

    fn encoded_frame(message_type: u16, payload: &[u8]) -> Vec<u8> {
        let mut bytes = vec![0u8; 8 + payload.len()];
        let used = encode_frame(message_type, FLAG_NONE, payload, &mut bytes)
            .expect("proof payloads are within the shared frame limit");
        bytes.truncate(used);
        bytes
    }

    fn queue_frame(&mut self, message_type: u16, payload: &[u8]) {
        self.agent_pending
            .extend(Self::encoded_frame(message_type, payload));
    }

    fn pump_agent_input(&mut self) {
        if self.agent_pending.is_empty() || !self.state.borrow().agent_open() {
            return;
        }
        let room = {
            let state = self.state.borrow();
            state
                .data_budget()
                .saturating_sub(state.agent_input_bytes())
        };
        let count = room.min(AGENT_INPUT_CHUNK).min(self.agent_pending.len());
        if count == 0 {
            return;
        }
        let bytes: Vec<u8> = self.agent_pending.drain(..count).collect();
        let accepted = self.state.borrow_mut().enqueue_agent_input(&bytes);
        for byte in bytes[accepted..].iter().rev() {
            self.agent_pending.push_front(*byte);
        }
    }

    fn observe_bounds(&mut self) {
        let state = self.state.borrow();
        self.max_agent_input_bytes = self.max_agent_input_bytes.max(state.agent_input_bytes());
        self.max_agent_output_bytes = self.max_agent_output_bytes.max(state.agent_output_bytes());
        self.max_pending_pings = self.max_pending_pings.max(self.pending_pings.len());
    }

    fn drive_serial_state(&mut self) {
        match self.stage {
            Stage::WaitingLogin if !self.login_sent && self.serial_has(b"login:") => {
                self.queue_uart_line("root");
                self.login_sent = true;
                self.stage = Stage::WaitingRootPrompt;
            }
            Stage::WaitingRootPrompt => {
                if !self.password_dismissed && self.serial_has(b"Password:") {
                    self.queue_uart_line("");
                    self.password_dismissed = true;
                }
                if !self.login_marker_sent && self.serial_has(b"# ") {
                    self.queue_uart_line("echo T23E_LOGIN_\"OK\"");
                    self.login_marker_sent = true;
                    self.stage = Stage::WaitingLoginMarker;
                }
            }
            Stage::WaitingLoginMarker if self.serial_has(b"T23E_LOGIN_OK") => {
                self.queue_uart_line(
                    "test -c /dev/virtio-ports/org.wasmvm.agent && echo T23E_PORT_\"OK\"",
                );
                self.stage = Stage::WaitingPortMarker;
            }
            Stage::WaitingPortMarker if self.serial_has(b"T23E_PORT_OK") => {
                self.port_marker_seen = true;
                self.stage = Stage::Handshaking;
            }
            Stage::Flood if self.serial_has(b"T23E_SERIAL_OK") => {
                self.serial_marker_seen = true;
            }
            Stage::Restarting if self.serial_has(b"T23E_RESTART_OK") => {
                self.restart_marker_seen = true;
            }
            _ => {}
        }
    }

    fn fail(&mut self, message: String) {
        if self.failures.len() < 16 && !self.failures.iter().any(|item| item == &message) {
            self.failures.push(message);
        }
    }

    fn p50_ms(&self) -> Option<f64> {
        if self.ping_latencies.is_empty() {
            return None;
        }
        let mut values: Vec<u128> = self
            .ping_latencies
            .iter()
            .map(Duration::as_micros)
            .collect();
        values.sort_unstable();
        Some(values[(values.len() - 1) / 2] as f64 / 1000.0)
    }

    fn outcome_label(outcome: &RunOutcome) -> String {
        match outcome {
            RunOutcome::Reset(reason) => format!("reset:{reason:?}"),
            RunOutcome::Exited(code) => format!("exited:{code}"),
            RunOutcome::Trapped(trap) => format!("trapped:{:?}", trap.cause),
            RunOutcome::MaxInstrs => "max-instrs".to_string(),
        }
    }

    /// Write the exact-head report and return whether all end-to-end assertions held.
    pub(crate) fn finish(&mut self, outcome: &RunOutcome) -> bool {
        if self.decoder.finish().is_err() {
            self.fail("guest output ended with a partial frame".into());
        }
        let hello_ms = self
            .port_open_at
            .zip(self.first_hello_at)
            .map(|(open, hello)| hello.saturating_duration_since(open).as_secs_f64() * 1000.0);
        let hello_within_2s = hello_ms.is_some_and(|value| value <= 2_000.0);
        let p50_ms = self.p50_ms();
        let clean_poweroff = matches!(
            outcome,
            RunOutcome::Reset(wasm_vm_core::ExitReason::PowerOff) | RunOutcome::Exited(0)
        );

        let checks = [
            (
                self.port_marker_seen,
                "named virtio-console port was not observed",
            ),
            (
                hello_within_2s,
                "agent HELLO did not arrive within 2 seconds of port open",
            ),
            (
                self.basic_pongs == BASIC_PINGS && p50_ms.is_some_and(|value| value < 20.0),
                "host PING p50 was not below 20 ms",
            ),
            (
                self.unknown_nak,
                "unknown message type did not receive a NAK",
            ),
            (
                self.boundary_nak,
                "the exact 1 MiB payload boundary did not receive a NAK",
            ),
            (
                self.flood_pongs == FLOOD_PINGS,
                "the 10,000-PING flow-control run did not drain completely",
            ),
            (
                self.serial_marker_seen,
                "serial console marker did not arrive while agent input was queued",
            ),
            (
                self.restart_marker_seen && self.reconnect_negotiated,
                "agent restart did not complete with a second HELLO negotiation",
            ),
            (
                self.inflight_lost,
                "the deliberately partial in-flight frame was not discarded on restart",
            ),
            (
                self.poweroff_sent && clean_poweroff,
                "guest did not power off after the proof",
            ),
        ];
        for (held, message) in checks {
            if !held {
                self.fail(message.to_string());
            }
        }

        let success = self.failures.is_empty();
        let report = json!({
            "schema": "e5-t23e-agent-channel-proof-v1",
            "stage": format!("{:?}", self.stage),
            "success": success,
            "outcome": Self::outcome_label(outcome),
            "elapsed_ms": self.started.elapsed().as_secs_f64() * 1000.0,
            "named_port": "/dev/virtio-ports/org.wasmvm.agent",
            "port_open_seen": self.port_open_at.is_some(),
            "hello": {
                "count": self.hello_count,
                "versions": self.hello_versions,
                "capabilities": self.hello_capabilities,
                "within_2s": hello_within_2s,
                "latency_ms": hello_ms,
                "version_bump_accepted": self.version_bump_ok,
                "reconnect_seen": self.reconnect_hello_seen,
                "reconnected_negotiation": self.reconnect_negotiated,
            },
            "ping": {
                "basic_count": BASIC_PINGS,
                "basic_pongs": self.basic_pongs,
                "p50_ms": p50_ms,
                "under_20ms": p50_ms.is_some_and(|value| value < 20.0),
                "flood_attempted": FLOOD_PINGS,
                "flood_pongs": self.flood_pongs,
            },
            "attacks": {
                "unknown_nak": self.unknown_nak,
                "one_mib_boundary_payload": MAX_PAYLOAD_BYTES,
                "one_mib_boundary_nak": self.boundary_nak,
                "partial_inflight_discarded": self.inflight_lost,
            },
            "serial": {
                "port_marker": self.port_marker_seen,
                "saturation_command_sent": self.saturation_command_sent,
                "usable_under_saturation": self.serial_marker_seen,
            },
            "bounds": {
                "max_agent_input_bytes": self.max_agent_input_bytes,
                "max_agent_output_bytes": self.max_agent_output_bytes,
                "max_pending_pings": self.max_pending_pings,
                "protocol_payload_limit": MAX_PAYLOAD_BYTES,
            },
            "failures": self.failures,
        });
        match serde_json::to_vec_pretty(&report)
            .ok()
            .and_then(|bytes| std::fs::write(&self.output, bytes).ok())
        {
            Some(()) => {}
            None => {
                eprintln!(
                    "wasm-vm: cannot write agent proof {}",
                    self.output.display()
                );
                return false;
            }
        }
        eprintln!(
            "AGENT_PROOF_JSON {}",
            serde_json::to_string(&report).unwrap_or_else(|_| "{\"success\":false}".into())
        );
        success
    }
}
