//! One owned local-network pump for recording and capture-OFF machines. No live
//! provider is retained by replay. In-flight results survive staging backpressure.
use std::cell::Cell;
use std::rc::Rc;

use wasm_vm_core::Machine;
use wasm_vm_core::dev::virtio::net::NetBackend;
use wasm_vm_core::session_network::{
    LinkStatus, NetworkError, NetworkEvent, NetworkLease, NetworkRequest, SendResult,
};
use wasm_vm_core::time::TimeMode;

use crate::{HttpError, HttpStatsHandle, SlirpLocalBackend};

const PUMP_STEPS: usize = 64;
const GATEWAY_MAC: [u8; 6] = [0x52, 0x54, 0, 0x12, 0x34, 2];
thread_local! { static FACTORY_ENTRIES: Cell<u64> = const { Cell::new(0) }; }

/// Payload-free external tripwire; independent of every VM and its saved state.
pub fn local_http_factory_entries() -> u64 {
    FACTORY_ENTRIES.with(Cell::get)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum OwnedHttpError {
    Network(NetworkError),
    Service(HttpError),
    UnsupportedClock,
    ClockOverflow,
    CounterExhausted,
    Closed,
}
impl From<NetworkError> for OwnedHttpError {
    fn from(value: NetworkError) -> Self {
        Self::Network(value)
    }
}
impl From<HttpError> for OwnedHttpError {
    fn from(value: HttpError) -> Self {
        Self::Service(value)
    }
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct PumpStats {
    pub polls: u64,
    pub tx_injected: u64,
    pub tx_committed: u64,
    pub tx_cancelled: u64,
    pub rx_calls: u64,
    pub rx_dequeued: u64,
    pub rx_committed: u64,
    pub rx_cancelled: u64,
    pub events: u64,
    pub clock_ms: i64,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct PumpProgress {
    pub blocked: bool,
    pub more: bool,
    pub closed: bool,
    pub network_cursor: u64,
}
struct Sending {
    lease: NetworkLease,
    request: NetworkRequest,
}

pub struct OwnedSessionHttp {
    backend: Option<SlirpLocalBackend>,
    clock: Rc<Cell<i64>>,
    observer: HttpStatsHandle,
    owner: NetworkLease,
    cursor: u64,
    linked: bool,
    pending_edge: Option<bool>,
    last_pending: bool,
    sending: Option<Sending>,
    receiving: Option<Vec<u8>>,
    drain_rx: bool,
    closing: Option<(LinkStatus, u32)>,
    closed: bool,
    stats: PumpStats,
}

fn next(value: u64) -> Result<u64, OwnedHttpError> {
    value.checked_add(1).ok_or(OwnedHttpError::CounterExhausted)
}
fn accept(
    machine: &mut Machine,
    lease: &NetworkLease,
    event: NetworkEvent,
) -> Result<bool, OwnedHttpError> {
    match machine
        .preflight_session_network_completion(lease, &event)
        .and_then(|()| machine.complete_session_network(lease, event))
    {
        Ok(()) => Ok(true),
        Err(NetworkError::Position | NetworkError::Limit) => Ok(false),
        Err(error) => Err(error.into()),
    }
}

impl OwnedSessionHttp {
    pub fn open(machine: &Machine) -> Result<Self, OwnedHttpError> {
        let (built, owner) = machine.open_session_network_provider(|| {
            FACTORY_ENTRIES.with(|counter| {
                let value = next(counter.get())?;
                counter.set(value);
                Ok::<_, OwnedHttpError>(())
            })?;
            if machine.guest_clock_mode() != TimeMode::ICount {
                return Err(OwnedHttpError::UnsupportedClock);
            }
            let clock = Rc::new(Cell::new(0));
            let local = clock.clone();
            let mut backend = SlirpLocalBackend::new(GATEWAY_MAC, Box::new(move || local.get()));
            let observer = backend.register_e9_local_http()?;
            Ok((backend, observer, clock))
        })?;
        let (backend, observer, clock) = built?;
        Ok(Self {
            backend: Some(backend),
            observer,
            clock,
            owner,
            cursor: machine.session_network_cursor()?,
            linked: false,
            pending_edge: None,
            last_pending: false,
            sending: None,
            receiving: None,
            drain_rx: true,
            closing: None,
            closed: false,
            stats: PumpStats::default(),
        })
    }

    pub fn observer(&self) -> HttpStatsHandle {
        self.observer.clone()
    }
    pub fn stats(&self) -> PumpStats {
        self.stats
    }
    pub fn closed(&self) -> bool {
        self.closed
    }

    /// Every live action requires the original current owner, not just a numeric cursor.
    pub fn validate(&self, machine: &Machine) -> Result<(), OwnedHttpError> {
        machine.validate_session_network_provider(&self.owner)?;
        if machine.session_network_cursor()? != self.cursor {
            return Err(NetworkError::StaleLease.into());
        }
        Ok(())
    }

    fn progress(&self, blocked: bool) -> PumpProgress {
        PumpProgress {
            blocked,
            more: blocked,
            closed: self.closed,
            network_cursor: self.cursor,
        }
    }

    /// Fixed work budget; no caller frames, ports, callbacks or execution budget enter here.
    pub fn pump(&mut self, machine: &mut Machine) -> Result<PumpProgress, OwnedHttpError> {
        self.validate(machine)?;
        if self.closed {
            return Err(OwnedHttpError::Closed);
        }
        let mut polled = false;
        for _ in 0..PUMP_STEPS {
            let event_count = next(self.stats.events)?;
            let cursor = next(self.cursor)?;
            if !self.linked {
                if !accept(
                    machine,
                    &self.owner,
                    NetworkEvent::Link {
                        status: LinkStatus::Open,
                        code: 0,
                    },
                )? {
                    return Ok(self.progress(true));
                }
                self.linked = true;
                self.cursor = cursor;
                self.stats.events = event_count;
                continue;
            }
            if let Some(value) = self.pending_edge {
                if !accept(machine, &self.owner, NetworkEvent::Pending(value))? {
                    return Ok(self.progress(true));
                }
                self.last_pending = value;
                self.pending_edge = None;
                self.cursor = cursor;
                self.stats.events = event_count;
                continue;
            }
            if let Some(sending) = &self.sending {
                let committed = next(self.stats.tx_committed)?;
                let event = NetworkEvent::Send {
                    request: sending.request.clone(),
                    result: SendResult::Sent,
                };
                if !accept(machine, &sending.lease, event)? {
                    return Ok(self.progress(true));
                }
                self.stats.tx_committed = committed;
                self.sending = None;
                self.cursor = cursor;
                self.stats.events = event_count;
                self.drain_rx = true;
                continue;
            }
            if let Some(frame) = &self.receiving {
                let committed = next(self.stats.rx_committed)?;
                if !accept(machine, &self.owner, NetworkEvent::Receive(frame.clone()))? {
                    return Ok(self.progress(true));
                }
                self.stats.rx_committed = committed;
                self.receiving = None;
                self.cursor = cursor;
                self.stats.events = event_count;
                continue;
            }
            if self.closing.is_none()
                && let Some(failure) = self.observer.snapshot().failure
            {
                self.closing = Some((
                    LinkStatus::Failed,
                    match failure {
                        HttpError::UnsupportedEndpoint => 1,
                        HttpError::AlreadyRegistered => 2,
                        HttpError::Closed => 3,
                        HttpError::ConnectionLimit => 4,
                        HttpError::EgressLimit => 5,
                    },
                ));
            }
            if let Some((status, code)) = self.closing {
                if let Some(request) = machine.session_network_next_request()? {
                    let cancelled = next(self.stats.tx_cancelled)?;
                    let lease = machine.lease_session_network(Some(request.id))?;
                    if !accept(
                        machine,
                        &lease,
                        NetworkEvent::Send {
                            request,
                            result: SendResult::Cancelled,
                        },
                    )? {
                        return Ok(self.progress(true));
                    }
                    self.stats.tx_cancelled = cancelled;
                    self.cursor = cursor;
                    self.stats.events = event_count;
                    continue;
                }
                if self.last_pending {
                    self.pending_edge = Some(false);
                    continue;
                }
                if !accept(machine, &self.owner, NetworkEvent::Link { status, code })? {
                    return Ok(self.progress(true));
                }
                self.cursor = cursor;
                self.stats.events = event_count;
                if let Some(mut backend) = self.backend.take() {
                    backend.close_local_http();
                }
                self.closed = true;
                return Ok(self.progress(false));
            }
            if !polled {
                match machine.validate_session_network_capacity(&self.owner, 1) {
                    Err(NetworkError::Position) => return Ok(self.progress(true)),
                    result => result?,
                }
                let polls = next(self.stats.polls)?;
                let milliseconds = machine.clint_mtime()
                    / u64::from(wasm_vm_core::platform::virt::TIMEBASE_FREQ_HZ / 1000);
                let milliseconds =
                    i64::try_from(milliseconds).map_err(|_| OwnedHttpError::ClockOverflow)?;
                let milliseconds = self.clock.get().max(milliseconds);
                self.clock.set(milliseconds);
                self.stats.clock_ms = milliseconds;
                self.backend.as_mut().ok_or(OwnedHttpError::Closed)?.poll();
                self.stats.polls = polls;
                polled = true;
                self.drain_rx = true;
                if self
                    .backend
                    .as_ref()
                    .ok_or(OwnedHttpError::Closed)?
                    .external_io_pending()
                    && !self.last_pending
                {
                    self.pending_edge = Some(true);
                }
                continue;
            }
            if self.drain_rx {
                self.validate(machine)?;
                match machine.validate_session_network_capacity(&self.owner, 1) {
                    Err(NetworkError::Position | NetworkError::Limit) => {
                        return Ok(self.progress(true));
                    }
                    result => result?,
                }
                let calls = next(self.stats.rx_calls)?;
                let dequeued = next(self.stats.rx_dequeued)?;
                let frame = self
                    .backend
                    .as_mut()
                    .ok_or(OwnedHttpError::Closed)?
                    .take_owned_egress();
                self.stats.rx_calls = calls;
                if let Some(frame) = frame {
                    self.receiving = Some(frame);
                    self.stats.rx_dequeued = dequeued;
                } else {
                    self.drain_rx = false;
                }
                continue;
            }
            if let Some(request) = machine.session_network_next_request()? {
                let lease = machine.lease_session_network(Some(request.id))?;
                let event = NetworkEvent::Send {
                    request: request.clone(),
                    result: SendResult::Sent,
                };
                match machine
                    .preflight_session_network_completion(&lease, &event)
                    .and_then(|()| machine.validate_session_network_capacity(&self.owner, 2))
                {
                    Err(NetworkError::Position | NetworkError::Limit) => {
                        return Ok(self.progress(true));
                    }
                    result => result?,
                }
                let injected = next(self.stats.tx_injected)?;
                let backend = self.backend.as_mut().ok_or(OwnedHttpError::Closed)?;
                backend.tx(&request.frame);
                self.stats.tx_injected = injected;
                let pending = backend.external_io_pending();
                self.sending = Some(Sending { lease, request });
                if pending && !self.last_pending {
                    self.pending_edge = Some(true);
                }
                continue;
            }
            let pending = self
                .backend
                .as_ref()
                .ok_or(OwnedHttpError::Closed)?
                .external_io_pending();
            if pending != self.last_pending {
                self.pending_edge = Some(pending);
                continue;
            }
            return Ok(self.progress(false));
        }
        let mut progress = self.progress(false);
        progress.more = true;
        Ok(progress)
    }

    /// Synchronous, bounded cancellation. Backpressure is reported for an explicit retry.
    pub fn cancel(&mut self, machine: &mut Machine) -> Result<PumpProgress, OwnedHttpError> {
        self.validate(machine)?;
        if self.closed {
            return Ok(self.progress(false));
        }
        if self.receiving.is_some() {
            let cancelled = next(self.stats.rx_cancelled)?;
            self.receiving = None;
            self.stats.rx_cancelled = cancelled;
        }
        self.closing = Some((LinkStatus::Closed, 0));
        self.pump(machine)
    }
}

// Dropping a VM/provider retires the sockets without polling or touching guest state.
impl Drop for OwnedSessionHttp {
    fn drop(&mut self) {
        if let Some(backend) = &mut self.backend {
            backend.close_local_http();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use wasm_vm_core::{
        RunOutcome,
        bus::{Bus, mmap::DRAM_BASE as BASE},
        session_clock::{SessionDelivery, SessionEffect},
    };

    const PROGRAM: &[u8] = include_bytes!("../../../web/assets/e9-network-capture.bin");

    fn fixture(replay: bool) -> Machine {
        let mut machine = Machine::new(1 << 20);
        machine.enable_clint(1);
        machine.start_session_clock(1).unwrap();
        machine.enable_session_network(replay).unwrap();
        machine.bus_mut().write_ram_slice(BASE, PROGRAM).unwrap();
        machine.hart_mut().regs.pc = BASE;
        machine
    }
    fn run(machine: &mut Machine, target: u64) {
        while machine.session_position().unwrap().transition < target {
            assert_eq!(
                machine.run_session_until(target, 37).unwrap(),
                RunOutcome::MaxInstrs
            );
        }
    }
    fn drain(pump: &mut OwnedSessionHttp, machine: &mut Machine) -> Vec<SessionDelivery> {
        let mut receipts = Vec::new();
        for _ in 0..1024 {
            let progress = pump.pump(machine).unwrap();
            receipts.extend(machine.take_session_deliveries().unwrap());
            assert!(
                !progress.blocked,
                "direct fixture must not have staging pressure"
            );
            if !progress.more {
                return receipts;
            }
        }
        panic!("bounded pump failed to settle");
    }
    // Actual virtio MMIO descriptors submit a second Ethernet packet after the
    // original guest has negotiated the device. No host RX fixture is supplied.
    fn submit_arp(machine: &mut Machine) {
        let frame = [
            0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0x52, 0x54, 0, 0x12, 0x34, 0x56, 8, 6, 0, 1, 8, 0,
            6, 4, 0, 1, 0x52, 0x54, 0, 0x12, 0x34, 0x56, 10, 0, 2, 15, 0, 0, 0, 0, 0, 0, 10, 0, 2,
            2,
        ];
        machine
            .bus_mut()
            .write_ram_slice(BASE + 0x23000, &[0; 12])
            .unwrap();
        machine
            .bus_mut()
            .write_ram_slice(BASE + 0x2300c, &frame)
            .unwrap();
        machine
            .bus_mut()
            .store32(BASE + 0x20008, (frame.len() + 12) as u32)
            .unwrap();
        machine.bus_mut().store16(BASE + 0x21006, 0).unwrap();
        machine.bus_mut().store16(BASE + 0x21002, 2).unwrap();
        machine.bus_mut().store32(0x10002050, 1).unwrap();
        run(machine, 1025);
    }

    #[test]
    fn shared_pump_commits_real_tx_before_caused_arp_rx_and_closes() {
        let mut machine = fixture(false);
        let mut pump = OwnedSessionHttp::open(&machine).unwrap();
        let observer = pump.observer();
        let mut receipts = drain(&mut pump, &mut machine);
        run(&mut machine, 1024);
        receipts.extend(drain(&mut pump, &mut machine));
        assert_eq!(pump.stats().tx_injected, 1);
        assert_eq!(pump.stats().tx_committed, 1);
        submit_arp(&mut machine);
        receipts.extend(drain(&mut pump, &mut machine));
        assert_eq!(pump.stats().tx_injected, 2);
        assert_eq!(pump.stats().tx_committed, 2);
        assert_eq!(pump.stats().rx_committed, 1);
        let events: Vec<_> = receipts
            .iter()
            .map(|receipt| {
                let SessionEffect::HostInput { channel, bytes } = &receipt.effect else {
                    panic!("network receipt")
                };
                assert_eq!(*channel, 20);
                NetworkEvent::decode(bytes).unwrap()
            })
            .collect();
        let sent = events.iter().position(|event| matches!(event, NetworkEvent::Send { request, result: SendResult::Sent } if request.id == 2)).unwrap();
        let received = events
            .iter()
            .position(|event| matches!(event, NetworkEvent::Receive(_)))
            .unwrap();
        assert!(sent < received);
        let NetworkEvent::Receive(frame) = &events[received] else {
            unreachable!()
        };
        assert_eq!(&frame[12..14], &[8, 6]);
        assert_eq!(&frame[20..22], &[0, 2]); // Actual smoltcp ARP reply.
        assert_eq!(&frame[28..32], &[10, 0, 2, 2]);
        let before = pump.stats();
        drain(&mut pump, &mut machine);
        assert_eq!(pump.stats().tx_injected, before.tx_injected);
        assert_eq!(pump.stats().rx_committed, before.rx_committed);
        assert!(pump.cancel(&mut machine).unwrap().closed);
        assert!(observer.snapshot().closed);
        assert!(pump.backend.is_none());
        assert_eq!(pump.pump(&mut machine), Err(OwnedHttpError::Closed));
        assert!(pump.cancel(&mut machine).unwrap().closed);
    }

    #[test]
    fn foreign_restore_offline_replay_and_foreign_cursor_refuse_before_live_work() {
        let mut original = fixture(false);
        let mut pump = OwnedSessionHttp::open(&original).unwrap();
        let observer = pump.observer();
        let untouched = observer.snapshot();
        let stats = pump.stats();
        let mut foreign = fixture(false);
        assert_eq!(
            pump.pump(&mut foreign),
            Err(NetworkError::StaleLease.into())
        );
        assert_eq!(
            pump.cancel(&mut foreign),
            Err(NetworkError::StaleLease.into())
        );
        assert_eq!(pump.stats(), stats);
        assert_eq!(observer.snapshot(), untouched);
        let saved = original.save_session_resume().unwrap();
        original.load_session_resume(&saved).unwrap();
        assert_eq!(
            pump.pump(&mut original),
            Err(NetworkError::StaleLease.into())
        );
        assert_eq!(
            pump.cancel(&mut original),
            Err(NetworkError::StaleLease.into())
        );
        assert_eq!(pump.stats(), stats);
        assert_eq!(observer.snapshot(), untouched);
        let mut offline_pump = OwnedSessionHttp::open(&original).unwrap();
        original.keep_session_branch_offline().unwrap();
        assert_eq!(
            offline_pump.pump(&mut original),
            Err(NetworkError::BranchOffline.into())
        );
        assert_eq!(
            offline_pump.cancel(&mut original),
            Err(NetworkError::BranchOffline.into())
        );
        let before = local_http_factory_entries();
        assert!(matches!(
            OwnedSessionHttp::open(&original),
            Err(OwnedHttpError::Network(NetworkError::BranchOffline))
        ));
        let mut replay = fixture(true);
        assert!(matches!(
            OwnedSessionHttp::open(&replay),
            Err(OwnedHttpError::Network(NetworkError::ReplayIngress))
        ));
        assert_eq!(
            pump.pump(&mut replay),
            Err(NetworkError::ReplayIngress.into())
        );
        assert_eq!(local_http_factory_entries(), before);
        let mut current = fixture(false);
        let mut current_pump = OwnedSessionHttp::open(&current).unwrap();
        let lease = current.lease_session_network(None).unwrap();
        current
            .complete_session_network(
                &lease,
                NetworkEvent::Link {
                    status: LinkStatus::Open,
                    code: 0,
                },
            )
            .unwrap();
        current.take_session_deliveries().unwrap();
        let frozen = current.save_session_resume().unwrap();
        assert_eq!(
            current_pump.pump(&mut current),
            Err(NetworkError::StaleLease.into())
        );
        assert_eq!(current.save_session_resume().unwrap(), frozen);
        assert_eq!(current_pump.stats(), PumpStats::default());
    }

    #[derive(Default)]
    struct GuestTrace(String);
    impl wasm_vm_core::trace::TraceSink for GuestTrace {
        fn retire(&mut self, record: &wasm_vm_core::trace::TraceRecord) {
            use std::fmt::Write;
            writeln!(self.0, "{}", wasm_vm_core::trace::fmt_canonical(record)).unwrap();
        }
    }
    fn trace_until(machine: &mut Machine, target: u64, quantum: u64, trace: &mut GuestTrace) {
        while machine.session_position().unwrap().transition < target {
            assert_eq!(
                machine
                    .run_session_until_traced(target, quantum, trace)
                    .unwrap(),
                RunOutcome::MaxInstrs
            );
        }
    }

    #[test]
    fn replay_original_send_receipts_has_no_provider_and_exact_state() {
        let mut machine = fixture(false);
        let initial = machine.save_session_resume().unwrap();
        let mut pump = OwnedSessionHttp::open(&machine).unwrap();
        let mut receipts = drain(&mut pump, &mut machine);
        let mut original_trace = GuestTrace::default();
        trace_until(&mut machine, 1024, 37, &mut original_trace);
        receipts.extend(drain(&mut pump, &mut machine));
        assert!(pump.cancel(&mut machine).unwrap().closed);
        receipts.extend(machine.take_session_deliveries().unwrap());
        trace_until(&mut machine, 8192, 37, &mut original_trace);
        let final_state = machine.save_session_resume().unwrap();
        let stats = pump.stats();
        let observer = pump.observer().snapshot();
        let entries = local_http_factory_entries();
        for quantum in [1, 7, 101] {
            let mut replay = fixture(true);
            replay.load_session_resume(&initial).unwrap();
            assert!(matches!(
                OwnedSessionHttp::open(&replay),
                Err(OwnedHttpError::Network(NetworkError::ReplayIngress))
            ));
            let mut replay_trace = GuestTrace::default();
            for receipt in &receipts {
                trace_until(
                    &mut replay,
                    receipt.position.transition,
                    quantum,
                    &mut replay_trace,
                );
                let SessionEffect::HostInput { bytes, .. } = &receipt.effect else {
                    unreachable!()
                };
                replay
                    .replay_session_network(receipt.position, NetworkEvent::decode(bytes).unwrap())
                    .unwrap();
                assert_eq!(
                    replay.take_session_deliveries().unwrap(),
                    vec![receipt.clone()]
                );
            }
            trace_until(&mut replay, 8192, quantum, &mut replay_trace);
            assert_eq!(replay_trace.0, original_trace.0);
            replay.finish_session_network_replay(stats.events).unwrap();
            assert_eq!(replay.save_session_resume().unwrap(), final_state);
        }

        println!(
            "E9_OWNED_NETWORK guest_retired={} events={} tx_injected={} rx_committed={} final_state={}",
            original_trace.0.lines().count(),
            stats.events,
            stats.tx_injected,
            stats.rx_committed,
            machine.snapshot().hex_digest()
        );
        if let Some(path) = std::env::var_os("E9_OWNED_HTTP_GUEST_EVIDENCE") {
            use std::fmt::Write;
            let directory = std::path::PathBuf::from(path);
            std::fs::create_dir_all(&directory).unwrap();
            std::fs::write(directory.join("record.trace"), &original_trace.0).unwrap();
            std::fs::write(directory.join("initial.resume"), &initial).unwrap();
            std::fs::write(directory.join("final.resume"), &final_state).unwrap();
            std::fs::write(
                directory.join("architectural-digest.txt"),
                machine.snapshot().hex_digest(),
            )
            .unwrap();
            let mut tape = String::new();
            for row in &receipts {
                let SessionEffect::HostInput { bytes, .. } = &row.effect else {
                    unreachable!()
                };
                write!(
                    tape,
                    "{}\t{}\t{}\t{}\t",
                    row.position.transition,
                    row.position.retired,
                    row.position.sequence,
                    row.position.ordinal
                )
                .unwrap();
                for byte in bytes {
                    write!(tape, "{byte:02x}").unwrap();
                }
                tape.push('\n');
            }
            std::fs::write(directory.join("network.tsv"), tape).unwrap();
        }
        assert_eq!(local_http_factory_entries(), entries);
        assert_eq!(pump.stats(), stats);
        assert_eq!(pump.observer().snapshot(), observer);
    }

    #[test]
    fn accepted_send_survives_budget_and_staging_backpressure_without_reinjection() {
        let mut machine = fixture(false);
        run(&mut machine, 1024);
        // Reuse a completed guest descriptor through the real MMIO notify path.
        for index in 2..=21u16 {
            machine
                .bus_mut()
                .store16(BASE + 0x21004 + u64::from((index - 1) % 16) * 2, 0)
                .unwrap();
            machine.bus_mut().store16(BASE + 0x21002, index).unwrap();
            machine.bus_mut().store32(0x10002050, 1).unwrap();
            let target = machine.session_position().unwrap().transition + 1;
            run(&mut machine, target);
        }
        assert_eq!(machine.session_network_requests().unwrap().len(), 21);
        let mut pump = OwnedSessionHttp::open(&machine).unwrap();
        let progress = pump.pump(&mut machine).unwrap();
        assert!(progress.more && !progress.blocked);
        assert_eq!(
            (pump.stats().tx_injected, pump.stats().tx_committed),
            (21, 20)
        );
        assert!(pump.sending.is_some()); // The 64th step accepted the actual last TX.
        machine.take_session_deliveries().unwrap();
        machine
            .stage_session_effect(
                machine.session_position().unwrap().transition,
                SessionEffect::ExternalPending(false),
            )
            .unwrap();
        let stats = pump.stats();
        for _ in 0..3 {
            assert!(pump.pump(&mut machine).unwrap().blocked);
            assert_eq!(pump.stats(), stats);
        }
        machine.deliver_session_boundary().unwrap();
        machine.take_session_deliveries().unwrap();
        drain(&mut pump, &mut machine);
        assert_eq!(
            (pump.stats().tx_injected, pump.stats().tx_committed),
            (21, 21)
        );
        assert!(machine.session_network_requests().unwrap().is_empty());
    }

    #[test]
    fn full_guest_rx_queue_retains_one_real_reply_for_retry() {
        let mut machine = fixture(false);
        run(&mut machine, 1024);
        submit_arp(&mut machine);
        let owner = machine.lease_session_network(None).unwrap();
        machine
            .complete_session_network(
                &owner,
                NetworkEvent::Link {
                    status: LinkStatus::Open,
                    code: 0,
                },
            )
            .unwrap();
        for _ in 0..wasm_vm_core::session_network::MAX_ENTRIES {
            machine
                .complete_session_network(&owner, NetworkEvent::Receive(Vec::new()))
                .unwrap();
            machine.take_session_deliveries().unwrap();
        }
        machine.take_session_deliveries().unwrap();
        let mut pump = OwnedSessionHttp::open(&machine).unwrap();
        assert!(pump.pump(&mut machine).unwrap().blocked);
        assert_eq!(pump.stats().rx_dequeued, 1);
        assert_eq!(pump.stats().rx_committed, 0);
        assert!(pump.receiving.is_some());
        let frozen = pump.stats();
        for _ in 0..3 {
            assert!(pump.pump(&mut machine).unwrap().blocked);
            assert_eq!(pump.stats(), frozen);
        }
        // The negotiated guest RX descriptor consumes one of the pre-existing frames.
        run(&mut machine, 1026);
        drain(&mut pump, &mut machine);
        assert_eq!(pump.stats().rx_dequeued, 1);
        assert_eq!(pump.stats().rx_committed, 1);
        assert!(pump.receiving.is_none());
        assert_eq!(pump.stats().tx_injected, 2);
    }

    #[test]
    fn full_profile_off_and_on_use_the_same_machine_clock_and_pump_without_off_history() {
        use wasm_vm_core::{
            dev::{rtc::FixedClock, virtio::rng::EntropySource},
            session_clock::SessionError,
            session_devices::{BaseDisk, PayloadRef},
            session_profile::ExecutionMode,
        };
        struct Entropy;
        impl EntropySource for Entropy {
            fn fill(&mut self, bytes: &mut [u8]) {
                bytes.fill(17);
            }
        }
        let mut observed = Vec::new();
        for mode in [ExecutionMode::LiveUnrecorded, ExecutionMode::Record] {
            let data = vec![0x5a; 512];
            let base = BaseDisk {
                identity: [37; 32],
                sectors: 1,
                chunk_bytes: 512,
                chunks: vec![PayloadRef::of(&data).unwrap()],
            };
            let mut machine = Machine::new(256 << 20);
            machine
                .install_full_software_mode(
                    base,
                    Box::new(FixedClock(123)),
                    Box::new(Entropy),
                    [9; 32],
                    mode,
                )
                .unwrap();
            machine.bus_mut().write_ram_slice(BASE, PROGRAM).unwrap();
            machine.hart_mut().regs.pc = BASE;
            if mode == ExecutionMode::Record {
                run(&mut machine, 250000);
            } else {
                assert_eq!(machine.run(250000), RunOutcome::MaxInstrs);
            }
            let mut pump = OwnedSessionHttp::open(&machine).unwrap();
            assert!(!pump.pump(&mut machine).unwrap().more);
            assert_eq!(
                pump.stats().clock_ms,
                (machine.clint_mtime() / 10000) as i64
            );
            assert!(pump.stats().clock_ms > 0);
            assert!(pump.cancel(&mut machine).unwrap().closed);
            observed.push((pump.stats(), pump.observer().snapshot()));
            if mode == ExecutionMode::LiveUnrecorded {
                assert_eq!(machine.session_position(), None);
                assert!(!machine.session_sources_active());
                assert!(!machine.recorder_dirty_tracking());
                assert_eq!(
                    machine.take_session_deliveries(),
                    Err(SessionError::Inactive)
                );
                assert_eq!(machine.live_unrecorded_work().unwrap().transitions, 250000);
            } else {
                assert!(machine.take_session_deliveries().unwrap().len() >= 3);
            }
        }
        assert_eq!(observed[0], observed[1]);
    }

    fn advance(machine: &mut Machine, count: u64) {
        if machine.live_unrecorded_work().is_some() {
            assert_eq!(machine.run(count), RunOutcome::MaxInstrs);
        } else {
            let target = machine.session_position().unwrap().transition + count;
            run(machine, target);
        }
    }
    fn collect_available(machine: &mut Machine) {
        if machine.session_position().is_some() {
            machine.take_session_deliveries().unwrap();
        }
    }
    fn drain_mode(pump: &mut OwnedSessionHttp, machine: &mut Machine) {
        for _ in 0..1024 {
            let progress = pump.pump(machine).unwrap();
            collect_available(machine);
            assert!(!progress.blocked);
            if !progress.more {
                return;
            }
        }
        panic!("pump did not settle");
    }
    fn tcp_syn(port: u16) -> Vec<u8> {
        use smoltcp::wire::*;
        let tcp = TcpRepr {
            src_port: port,
            dst_port: 9191,
            control: TcpControl::Syn,
            seq_number: TcpSeqNumber(17),
            ack_number: None,
            window_len: 4096,
            window_scale: None,
            max_seg_size: None,
            sack_permitted: false,
            sack_ranges: [None, None, None],
            timestamp: None,
            payload: &[],
        };
        let ip = Ipv4Repr {
            src_addr: crate::net::GUEST,
            dst_addr: crate::net::GATEWAY,
            next_header: IpProtocol::Tcp,
            payload_len: tcp.buffer_len(),
            hop_limit: 64,
        };
        let eth = EthernetRepr {
            src_addr: EthernetAddress([0x52, 0x54, 0, 0x12, 0x34, 0x56]),
            dst_addr: EthernetAddress(GATEWAY_MAC),
            ethertype: EthernetProtocol::Ipv4,
        };
        let mut bytes = vec![0; eth.buffer_len() + ip.buffer_len() + tcp.buffer_len()];
        let caps = smoltcp::phy::ChecksumCapabilities::default();
        let mut frame = EthernetFrame::new_unchecked(&mut bytes);
        eth.emit(&mut frame);
        let mut packet = Ipv4Packet::new_unchecked(frame.payload_mut());
        ip.emit(&mut packet, &caps);
        tcp.emit(
            &mut TcpPacket::new_unchecked(packet.payload_mut()),
            &IpAddress::Ipv4(crate::net::GUEST),
            &IpAddress::Ipv4(crate::net::GATEWAY),
            &caps,
        );
        bytes
    }

    #[test]
    fn real_tcp_pending_prevents_wfi_jump_in_off_and_on_then_close_releases_it() {
        use wasm_vm_core::{
            dev::{rtc::FixedClock, virtio::rng::EntropySource},
            session_devices::{BaseDisk, PayloadRef},
            session_profile::ExecutionMode,
        };
        struct Entropy;
        impl EntropySource for Entropy {
            fn fill(&mut self, bytes: &mut [u8]) {
                bytes.fill(17);
            }
        }
        for mode in [ExecutionMode::LiveUnrecorded, ExecutionMode::Record] {
            let base = BaseDisk {
                identity: [37; 32],
                sectors: 1,
                chunk_bytes: 512,
                chunks: vec![PayloadRef::of(&vec![0x5a; 512]).unwrap()],
            };
            let mut machine = Machine::new(256 << 20);
            machine
                .install_full_software_mode(
                    base,
                    Box::new(FixedClock(123)),
                    Box::new(Entropy),
                    [9; 32],
                    mode,
                )
                .unwrap();
            machine.bus_mut().write_ram_slice(BASE, PROGRAM).unwrap();
            machine.hart_mut().regs.pc = BASE;
            advance(&mut machine, 1024);
            let mut pump = OwnedSessionHttp::open(&machine).unwrap();
            drain_mode(&mut pump, &mut machine);
            // Submit an actual checksum-correct SYN through the negotiated virtio TX ring.
            let frame = tcp_syn(44000);
            machine
                .bus_mut()
                .write_ram_slice(BASE + 0x23000, &[0; 12])
                .unwrap();
            machine
                .bus_mut()
                .write_ram_slice(BASE + 0x2300c, &frame)
                .unwrap();
            machine
                .bus_mut()
                .store32(BASE + 0x20008, (frame.len() + 12) as u32)
                .unwrap();
            machine.bus_mut().store16(BASE + 0x21006, 0).unwrap();
            machine.bus_mut().store16(BASE + 0x21002, 2).unwrap();
            machine.bus_mut().store32(0x10002050, 1).unwrap();
            advance(&mut machine, 1);
            drain_mode(&mut pump, &mut machine);
            assert_eq!(pump.observer().snapshot().accepted_connections, 1);
            assert!(
                pump.last_pending,
                "real TCP handshake must hold the external wake flag"
            );
            assert_eq!(pump.stats().tx_injected, 2);
            let deadline = machine.clint_mtime() + 1_000_000;
            machine
                .bus_mut()
                .store64(wasm_vm_core::platform::virt::CLINT_BASE + 0x4000, deadline)
                .unwrap();
            machine
                .bus_mut()
                .store32(BASE + 0x50000, 0x10500073)
                .unwrap(); // WFI
            machine
                .bus_mut()
                .store32(BASE + 0x50004, 0x00108093)
                .unwrap();
            machine.hart_mut().regs.pc = BASE + 0x50000;
            advance(&mut machine, 2);
            assert!(
                machine.clint_mtime() < deadline,
                "pending real TCP cannot jump to the timer"
            );
            assert_eq!(machine.hart().regs.pc, BASE + 0x50008);
            assert!(pump.cancel(&mut machine).unwrap().closed);
            collect_available(&mut machine);
            assert!(!pump.last_pending);
            assert_eq!(pump.observer().snapshot().cancelled_connections, 1);
            machine.hart_mut().regs.pc = BASE + 0x50000;
            advance(&mut machine, 2);
            assert_eq!(
                machine.clint_mtime(),
                deadline,
                "closed TCP must release idle fast-forward"
            );
            assert_eq!(
                machine.hart().regs.pc,
                BASE + 0x50004,
                "idle is its own work slot"
            );
            if mode == ExecutionMode::LiveUnrecorded {
                assert_eq!(machine.session_position(), None);
                assert!(!machine.session_sources_active());
                assert!(!machine.recorder_dirty_tracking());
                assert_eq!(machine.live_unrecorded_work().unwrap().idle_transitions, 1);
            }
        }
    }

    #[test]
    fn connection_129_fails_the_owned_link_and_settles_queued_tx() {
        let mut machine = fixture(false);
        run(&mut machine, 1024);
        let mut pump = OwnedSessionHttp::open(&machine).unwrap();
        crate::local_http::tests::reach_lifetime_limit(pump.backend.as_mut().unwrap(), &pump.clock);
        let server = pump.observer().snapshot();
        assert_eq!(server.accepted_connections, 128);
        assert_eq!(server.responses_queued[0], 128);
        assert_eq!(server.body_bytes_queued[0], 128 * 1024);
        assert_eq!(server.requests[1], 0);
        assert_eq!(server.failure, Some(HttpError::ConnectionLimit));
        assert!(server.closed);
        let rows = drain(&mut pump, &mut machine);
        assert!(pump.closed());
        assert!(pump.backend.is_none());
        assert_eq!(pump.stats().tx_cancelled, 1);
        assert_eq!(pump.stats().tx_injected, 0);
        assert!(machine.session_network_requests().unwrap().is_empty());
        let last = rows.last().unwrap();
        let SessionEffect::HostInput { bytes, .. } = &last.effect else {
            unreachable!()
        };
        assert_eq!(
            NetworkEvent::decode(bytes).unwrap(),
            NetworkEvent::Link {
                status: LinkStatus::Failed,
                code: 4
            }
        );
        assert!(machine.save_session_resume().is_ok());
    }

    #[test]
    fn drop_retires_the_observed_server_without_a_poll() {
        let machine = fixture(false);
        let pump = OwnedSessionHttp::open(&machine).unwrap();
        let observer = pump.observer();
        assert!(!observer.snapshot().closed);
        drop(pump);
        assert!(observer.snapshot().closed);
        assert_eq!(observer.snapshot().accepted_connections, 0);
    }

    #[test]
    fn cancel_settles_queued_intent_without_injection() {
        let mut machine = fixture(false);
        let mut pump = OwnedSessionHttp::open(&machine).unwrap();
        drain(&mut pump, &mut machine);
        run(&mut machine, 1024);
        assert_eq!(machine.session_network_requests().unwrap().len(), 1);
        assert!(pump.cancel(&mut machine).unwrap().closed);
        assert_eq!(pump.stats().tx_injected, 0);
        assert_eq!(pump.stats().tx_cancelled, 1);
        assert!(machine.session_network_requests().unwrap().is_empty());
    }
}
