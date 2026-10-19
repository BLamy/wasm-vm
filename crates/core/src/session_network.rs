//! Owned Ethernet intents and before-boundary network observations. No live provider is stored
//! in this adapter, in either mode. Only the recording owner can obtain callback capabilities.
use crate::dev::virtio::net::NetBackend;
use crate::session_clock::{SessionEffect, SessionPhase, SessionPosition};
use alloc::{
    boxed::Box,
    collections::{BTreeMap, VecDeque},
    rc::Rc,
    vec::Vec,
};
use core::cell::RefCell;

mod codec;
pub const CHANNEL: u16 = 20;
pub const MAX_FRAME: usize = 65535;
pub const MAX_ENTRIES: usize = 256;
pub const MAX_OWNED: usize = 4 << 20;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum NetworkError {
    Inactive,
    Unsupported,
    ReplayIngress,
    StaleLease,
    UnknownRequest,
    Intent,
    Payload,
    Limit,
    Exhausted,
    Position,
    Snapshot,
}
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NetworkRequest {
    pub id: u64,
    pub frame: Vec<u8>,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[repr(u8)]
pub enum SendResult {
    Sent = 0,
    Failed = 1,
    Cancelled = 2,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[repr(u8)]
pub enum LinkStatus {
    Open = 1,
    Closed = 2,
    Failed = 3,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum NetworkEvent {
    Send {
        request: NetworkRequest,
        result: SendResult,
    },
    Receive(Vec<u8>),
    Link {
        status: LinkStatus,
        code: u32,
    },
    /// The host adapter's outstanding external work, distinct from queued guest sends.
    Pending(bool),
}
impl NetworkEvent {
    fn validate(&self) -> Result<(), NetworkError> {
        match self {
            Self::Send { request, .. } if request.id == 0 || request.frame.len() > MAX_FRAME => {
                Err(NetworkError::Payload)
            }
            Self::Receive(frame) if frame.len() > MAX_FRAME => Err(NetworkError::Payload),
            Self::Link {
                status: LinkStatus::Open,
                code,
            } if *code != 0 => Err(NetworkError::Payload),
            _ => Ok(()),
        }
    }
    fn outcome(&self, cursor: u64) -> [u64; 4] {
        match self {
            Self::Send { request, result } => [1, request.id, *result as u64, cursor],
            Self::Receive(frame) => [2, 0, frame.len() as u64, cursor],
            Self::Link { status, code } => [3, *status as u64, u64::from(*code), cursor],
            Self::Pending(value) => [4, 0, u64::from(*value), cursor],
        }
    }
}
/// Private allocation identity is deliberately outside the wire format.
pub struct NetworkLease {
    incarnation: Rc<()>,
    request: Option<NetworkRequest>,
}

#[derive(Default)]
struct GuestState {
    next_id: u64,
    cursor: u64,
    sent: u64,
    link: u8,
    code: u32,
    external_pending: bool,
    pending: BTreeMap<u64, NetworkRequest>,
    receive: VecDeque<Vec<u8>>,
}
impl GuestState {
    fn owned(&self) -> usize {
        self.pending.values().map(|r| r.frame.len()).sum::<usize>()
            + self.receive.iter().map(Vec::len).sum::<usize>()
    }
}
pub(crate) struct NetworkHub {
    replay: bool,
    incarnation: Rc<()>,
    guest: GuestState,
    pub(crate) error: Option<NetworkError>,
}
impl NetworkHub {
    fn validate(&self, event: &NetworkEvent) -> Result<(), NetworkError> {
        if let Some(error) = self.error {
            return Err(error);
        }
        event.validate()?;
        self.guest
            .cursor
            .checked_add(1)
            .ok_or(NetworkError::Exhausted)?;
        match event {
            NetworkEvent::Send { request, .. } => {
                let actual = self
                    .guest
                    .pending
                    .get(&request.id)
                    .ok_or(NetworkError::UnknownRequest)?;
                if actual != request {
                    return Err(NetworkError::Intent);
                }
                self.guest
                    .sent
                    .checked_add(1)
                    .ok_or(NetworkError::Exhausted)?;
            }
            NetworkEvent::Receive(frame)
                if self.guest.receive.len() == MAX_ENTRIES
                    || self.guest.owned() + frame.len() > MAX_OWNED =>
            {
                return Err(NetworkError::Limit);
            }
            _ => {}
        }
        Ok(())
    }
    fn accept(&mut self, event: NetworkEvent) {
        self.guest.cursor += 1;
        match event {
            NetworkEvent::Send { request, .. } => {
                self.guest.pending.remove(&request.id);
                self.guest.sent += 1;
            }
            NetworkEvent::Receive(frame) => self.guest.receive.push_back(frame),
            NetworkEvent::Link { status, code } => {
                self.guest.link = status as u8;
                self.guest.code = code;
                if status != LinkStatus::Open {
                    self.guest.external_pending = false;
                }
            }
            NetworkEvent::Pending(value) => self.guest.external_pending = value,
        }
    }
}
struct OwnedNetwork {
    hub: Rc<RefCell<NetworkHub>>,
}
impl NetBackend for OwnedNetwork {
    fn max_frame_bytes(&self) -> usize {
        MAX_FRAME
    }
    fn tx(&mut self, frame: &[u8]) {
        let mut hub = self.hub.borrow_mut();
        if hub.error.is_some() {
            return;
        }
        let result = (|| {
            if frame.len() > MAX_FRAME
                || hub.guest.pending.len() == MAX_ENTRIES
                || hub.guest.owned() + frame.len() > MAX_OWNED
            {
                return Err(NetworkError::Limit);
            }
            let id = hub
                .guest
                .next_id
                .checked_add(1)
                .ok_or(NetworkError::Exhausted)?;
            hub.guest.pending.insert(
                id,
                NetworkRequest {
                    id,
                    frame: frame.to_vec(),
                },
            );
            hub.guest.next_id = id;
            Ok(())
        })();
        if let Err(error) = result {
            hub.error = Some(error);
        }
    }
    fn rx(&mut self) -> Option<Vec<u8>> {
        self.hub.borrow_mut().guest.receive.pop_front()
    }
    fn rx_ready(&self) -> bool {
        !self.hub.borrow().guest.receive.is_empty()
    }
    fn idle(&self) -> bool {
        !self.rx_ready()
    }
    fn external_io_pending(&self) -> bool {
        let hub = self.hub.borrow();
        !hub.guest.pending.is_empty() || hub.guest.external_pending
    }
    fn reset(&mut self) {
        let mut hub = self.hub.borrow_mut();
        hub.guest.pending.clear();
        hub.guest.receive.clear();
        hub.guest.external_pending = false;
        hub.guest.link = 0;
        hub.guest.code = 0;
        hub.incarnation = Rc::new(());
    }
}

impl crate::Machine {
    /// Install before execution, after any qualified block/audio assembly. No live backend is
    /// adopted: the host owner explicitly pumps its provider outside the guest machine.
    pub fn enable_session_network(&mut self, replay: bool) -> Result<(), NetworkError> {
        if self.session_network.is_some()
            || self.session_position() != Some(Default::default())
            || self.net.is_some()
            || self.net_backend.is_some()
            || (!self.virtio.is_empty()
                && (self.virtio.len() < 2 || self.virtio[1].0.borrow().device_id() != 0))
        {
            return Err(NetworkError::Unsupported);
        }
        let hub = Rc::new(RefCell::new(NetworkHub {
            replay,
            incarnation: Rc::new(()),
            guest: GuestState::default(),
            error: None,
        }));
        if self.plic.is_none() {
            self.enable_plic();
        }
        if self.virtio.is_empty() {
            self.enable_virtio_slots(None);
        }
        self.enable_virtio_net(Box::new(OwnedNetwork { hub: hub.clone() }));
        self.session_network = Some(hub);
        Ok(())
    }
    pub fn session_network_replay(&self) -> Result<bool, NetworkError> {
        Ok(self
            .session_network
            .as_ref()
            .ok_or(NetworkError::Inactive)?
            .borrow()
            .replay)
    }
    /// Gate construction itself, so a replay caller cannot even open a live provider.
    pub fn open_session_network_provider<P>(
        &self,
        open: impl FnOnce() -> P,
    ) -> Result<(P, NetworkLease), NetworkError> {
        let lease = self.lease_session_network(None)?;
        Ok((open(), lease))
    }
    pub fn session_network_cursor(&self) -> Result<u64, NetworkError> {
        Ok(self
            .session_network
            .as_ref()
            .ok_or(NetworkError::Inactive)?
            .borrow()
            .guest
            .cursor)
    }
    pub fn finish_session_network_replay(&self, expected_cursor: u64) -> Result<(), NetworkError> {
        let hub = self
            .session_network
            .as_ref()
            .ok_or(NetworkError::Inactive)?
            .borrow();
        if !hub.replay {
            return Err(NetworkError::ReplayIngress);
        }
        if let Some(error) = hub.error {
            return Err(error);
        }
        if hub.guest.cursor != expected_cursor
            || !hub.guest.pending.is_empty()
            || !hub.guest.receive.is_empty()
            || hub.guest.external_pending
        {
            return Err(NetworkError::Exhausted);
        }
        Ok(())
    }
    pub fn session_network_requests(&self) -> Result<Vec<NetworkRequest>, NetworkError> {
        let hub = self
            .session_network
            .as_ref()
            .ok_or(NetworkError::Inactive)?
            .borrow();
        if let Some(error) = hub.error {
            return Err(error);
        }
        Ok(hub.guest.pending.values().cloned().collect())
    }
    pub fn lease_session_network(&self, id: Option<u64>) -> Result<NetworkLease, NetworkError> {
        if !self.host_ingress_gate.allows_host() {
            return Err(NetworkError::ReplayIngress);
        }
        let hub = self
            .session_network
            .as_ref()
            .ok_or(NetworkError::Inactive)?
            .borrow();
        if hub.replay {
            return Err(NetworkError::ReplayIngress);
        }
        if let Some(error) = hub.error {
            return Err(error);
        }
        let request = id
            .map(|id| {
                hub.guest
                    .pending
                    .get(&id)
                    .cloned()
                    .ok_or(NetworkError::UnknownRequest)
            })
            .transpose()?;
        Ok(NetworkLease {
            incarnation: hub.incarnation.clone(),
            request,
        })
    }
    pub fn complete_session_network(
        &mut self,
        lease: &NetworkLease,
        event: NetworkEvent,
    ) -> Result<(), NetworkError> {
        if !self.host_ingress_gate.allows_host() {
            return Err(NetworkError::ReplayIngress);
        }
        {
            let hub = self
                .session_network
                .as_ref()
                .ok_or(NetworkError::Inactive)?
                .borrow();
            if hub.replay {
                return Err(NetworkError::ReplayIngress);
            }
            if !Rc::ptr_eq(&hub.incarnation, &lease.incarnation) {
                return Err(NetworkError::StaleLease);
            }
            match (&lease.request, &event) {
                (Some(expected), NetworkEvent::Send { request, .. }) if expected == request => {}
                (
                    None,
                    NetworkEvent::Receive(_) | NetworkEvent::Link { .. } | NetworkEvent::Pending(_),
                ) => {}
                _ => return Err(NetworkError::Intent),
            }
        }
        self.apply_session_network(event)
    }
    pub fn replay_session_network(
        &mut self,
        position: SessionPosition,
        event: NetworkEvent,
    ) -> Result<(), NetworkError> {
        if self.session_replay_limit.is_some() || !self.host_ingress_gate.allows_host() {
            return Err(NetworkError::ReplayIngress);
        }
        self.replay_session_network_owned(position, event)
    }

    pub(crate) fn replay_recorded_session_network(
        &mut self,
        position: SessionPosition,
        event: NetworkEvent,
    ) -> Result<(), NetworkError> {
        if self.session_replay_limit.is_none() {
            return Err(NetworkError::ReplayIngress);
        }
        self.replay_session_network_owned(position, event)
    }

    fn replay_session_network_owned(
        &mut self,
        position: SessionPosition,
        event: NetworkEvent,
    ) -> Result<(), NetworkError> {
        if !self.session_network_replay()? {
            return Err(NetworkError::ReplayIngress);
        }
        let mut expected = self.session_position().ok_or(NetworkError::Inactive)?;
        if expected.phase != SessionPhase::Before {
            return Err(NetworkError::Position);
        }
        expected.ordinal = expected
            .ordinal
            .checked_add(1)
            .ok_or(NetworkError::Exhausted)?;
        expected.sequence = expected
            .sequence
            .checked_add(1)
            .ok_or(NetworkError::Exhausted)?;
        if expected != position {
            return Err(NetworkError::Position);
        }
        self.apply_session_network(event)
    }
    fn apply_session_network(&mut self, event: NetworkEvent) -> Result<(), NetworkError> {
        let hub = self
            .session_network
            .as_ref()
            .ok_or(NetworkError::Inactive)?
            .clone();
        hub.borrow().validate(&event)?;
        if self.session_pending_events() != 0 {
            return Err(NetworkError::Position);
        }
        let position = self.session_position().ok_or(NetworkError::Inactive)?;
        let encoded = event.encode()?;
        let effect = SessionEffect::HostInput {
            channel: CHANNEL,
            bytes: encoded,
        };
        let full_replay = self.session_replay_limit.is_some();
        let staged = if full_replay {
            self.stage_recorded_session_effect(position.transition, effect)
        } else {
            self.stage_session_effect(position.transition, effect)
        };
        staged.map_err(|_| NetworkError::Position)?;
        let mut event = Some(event);
        let apply = |machine: &mut Self, channel, _: &[u8]| {
            assert_eq!(channel, CHANNEL);
            let event = event.take().expect("one exclusive network event");
            let result = event.outcome(hub.borrow().guest.cursor + 1);
            hub.borrow_mut().accept(event);
            machine.fabric_idle_epoch = None;
            result
        };
        if full_replay {
            self.deliver_recorded_session_host_boundary(apply)
        } else {
            self.deliver_session_host_boundary(apply)
        }
        .map_err(|_| NetworkError::Position)
    }
}
