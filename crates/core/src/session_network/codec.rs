use super::*;

fn put_bytes(out: &mut Vec<u8>, bytes: &[u8]) {
    out.extend_from_slice(&(bytes.len() as u32).to_le_bytes());
    out.extend_from_slice(bytes);
}
struct Reader<'a> {
    bytes: &'a [u8],
    at: usize,
}
impl<'a> Reader<'a> {
    fn new(bytes: &'a [u8]) -> Self {
        Self { bytes, at: 0 }
    }
    fn take(&mut self, n: usize) -> Result<&'a [u8], NetworkError> {
        let end = self.at.checked_add(n).ok_or(NetworkError::Payload)?;
        let out = self.bytes.get(self.at..end).ok_or(NetworkError::Payload)?;
        self.at = end;
        Ok(out)
    }
    fn u8(&mut self) -> Result<u8, NetworkError> {
        Ok(self.take(1)?[0])
    }
    fn u32(&mut self) -> Result<u32, NetworkError> {
        Ok(u32::from_le_bytes(self.take(4)?.try_into().unwrap()))
    }
    fn u64(&mut self) -> Result<u64, NetworkError> {
        Ok(u64::from_le_bytes(self.take(8)?.try_into().unwrap()))
    }
    fn boolean(&mut self) -> Result<bool, NetworkError> {
        match self.u8()? {
            0 => Ok(false),
            1 => Ok(true),
            _ => Err(NetworkError::Payload),
        }
    }
    fn bytes(&mut self) -> Result<&'a [u8], NetworkError> {
        let n = self.u32()? as usize;
        if n > MAX_FRAME {
            return Err(NetworkError::Limit);
        }
        self.take(n)
    }
    fn count(&mut self) -> Result<usize, NetworkError> {
        let n = self.u32()? as usize;
        if n > MAX_ENTRIES {
            return Err(NetworkError::Limit);
        }
        Ok(n)
    }
    fn finish(self) -> Result<(), NetworkError> {
        if self.at != self.bytes.len() {
            return Err(NetworkError::Payload);
        }
        Ok(())
    }
}
impl NetworkEvent {
    pub fn encode(&self) -> Result<Vec<u8>, NetworkError> {
        self.validate()?;
        let mut out = b"WVNETE01".to_vec();
        match self {
            Self::Send { request, result } => {
                out.extend_from_slice(&[1, *result as u8]);
                out.extend_from_slice(&request.id.to_le_bytes());
                put_bytes(&mut out, &request.frame);
            }
            Self::Receive(frame) => {
                out.push(2);
                put_bytes(&mut out, frame);
            }
            Self::Link { status, code } => {
                out.extend_from_slice(&[3, *status as u8]);
                out.extend_from_slice(&code.to_le_bytes());
            }
            Self::Pending(value) => out.extend_from_slice(&[4, *value as u8]),
        }
        Ok(out)
    }
    pub fn decode(bytes: &[u8]) -> Result<Self, NetworkError> {
        if bytes.len() > MAX_FRAME + 64 {
            return Err(NetworkError::Limit);
        }
        let mut r = Reader::new(bytes);
        if r.take(8)? != b"WVNETE01" {
            return Err(NetworkError::Payload);
        }
        let value = match r.u8()? {
            1 => {
                let result = match r.u8()? {
                    0 => SendResult::Sent,
                    1 => SendResult::Failed,
                    2 => SendResult::Cancelled,
                    _ => return Err(NetworkError::Payload),
                };
                let id = r.u64()?;
                Self::Send {
                    request: NetworkRequest {
                        id,
                        frame: r.bytes()?.to_vec(),
                    },
                    result,
                }
            }
            2 => Self::Receive(r.bytes()?.to_vec()),
            3 => {
                let status = match r.u8()? {
                    1 => LinkStatus::Open,
                    2 => LinkStatus::Closed,
                    3 => LinkStatus::Failed,
                    _ => return Err(NetworkError::Payload),
                };
                Self::Link {
                    status,
                    code: r.u32()?,
                }
            }
            4 => Self::Pending(r.boolean()?),
            _ => return Err(NetworkError::Payload),
        };
        r.finish()?;
        value.validate()?;
        Ok(value)
    }
}

pub(crate) struct NetworkRestore {
    guest: GuestState,
    flags: [bool; 2],
}
impl NetworkHub {
    fn checkpoint(&self, flags: [bool; 2]) -> Result<Vec<u8>, NetworkError> {
        if self.error.is_some() {
            return Err(NetworkError::Snapshot);
        }
        let g = &self.guest;
        let mut out = b"WVNETS01".to_vec();
        for n in [g.next_id, g.cursor, g.sent] {
            out.extend_from_slice(&n.to_le_bytes());
        }
        out.extend_from_slice(&[
            g.link,
            g.external_pending as u8,
            flags[0] as u8,
            flags[1] as u8,
        ]);
        out.extend_from_slice(&g.code.to_le_bytes());
        out.extend_from_slice(&(g.pending.len() as u32).to_le_bytes());
        for request in g.pending.values() {
            out.extend_from_slice(&request.id.to_le_bytes());
            put_bytes(&mut out, &request.frame);
        }
        out.extend_from_slice(&(g.receive.len() as u32).to_le_bytes());
        for frame in &g.receive {
            put_bytes(&mut out, frame);
        }
        Ok(out)
    }
    fn check_checkpoint(
        &self,
        bytes: &[u8],
        sequence: u64,
    ) -> Result<NetworkRestore, NetworkError> {
        if bytes.len() > MAX_OWNED + 16384 {
            return Err(NetworkError::Limit);
        }
        let mut r = Reader::new(bytes);
        if r.take(8)? != b"WVNETS01" {
            return Err(NetworkError::Snapshot);
        }
        let mut g = GuestState {
            next_id: r.u64()?,
            cursor: r.u64()?,
            sent: r.u64()?,
            link: r.u8()?,
            external_pending: r.boolean()?,
            ..Default::default()
        };
        let flags = [r.boolean()?, r.boolean()?];
        g.code = r.u32()?;
        if g.link > 3
            || (g.link <= 1 && g.code != 0)
            || g.cursor > sequence
            || g.sent > g.cursor
            || g.sent > g.next_id
        {
            return Err(NetworkError::Snapshot);
        }
        for _ in 0..r.count()? {
            let id = r.u64()?;
            let frame = r.bytes()?.to_vec();
            if id == 0
                || id > g.next_id
                || g.pending.insert(id, NetworkRequest { id, frame }).is_some()
            {
                return Err(NetworkError::Snapshot);
            }
        }
        for _ in 0..r.count()? {
            g.receive.push_back(r.bytes()?.to_vec());
        }
        // Every represented external result required its own accepted cursor increment.
        // TX intents are guest-derived and instead consume allocator identities below.
        let represented = g
            .sent
            .checked_add(g.receive.len() as u64)
            .and_then(|n| n.checked_add(u64::from(g.link != 0)))
            .and_then(|n| n.checked_add(u64::from(g.external_pending)));
        if represented.is_none_or(|n| n > g.cursor)
            || g.owned() > MAX_OWNED
            || g.sent
                .checked_add(g.pending.len() as u64)
                .is_none_or(|n| n > g.next_id)
        {
            return Err(NetworkError::Snapshot);
        }
        r.finish()?;
        Ok(NetworkRestore { guest: g, flags })
    }
}
impl crate::Machine {
    pub(crate) fn session_network_snapshot(&self) -> Result<Option<Vec<u8>>, NetworkError> {
        let Some(hub) = &self.session_network else {
            return Ok(None);
        };
        let state = self.net.as_ref().ok_or(NetworkError::Snapshot)?.0.borrow();
        let bytes = hub.borrow().checkpoint(state.session_flags())?;
        self.check_session_network_snapshot(
            &bytes,
            self.session_position()
                .ok_or(NetworkError::Inactive)?
                .sequence,
        )?;
        Ok(Some(bytes))
    }
    pub(crate) fn check_session_network_snapshot(
        &self,
        bytes: &[u8],
        sequence: u64,
    ) -> Result<NetworkRestore, NetworkError> {
        self.session_network
            .as_ref()
            .ok_or(NetworkError::Inactive)?
            .borrow()
            .check_checkpoint(bytes, sequence)
    }
    pub(crate) fn restore_session_network(&mut self, restore: NetworkRestore) {
        let mut hub = self.session_network.as_ref().unwrap().borrow_mut();
        hub.guest = restore.guest;
        hub.incarnation = Rc::new(());
        hub.error = None;
        self.net
            .as_ref()
            .unwrap()
            .0
            .borrow_mut()
            .restore_session_flags(restore.flags);
        self.fabric_idle_epoch = None;
    }
}
