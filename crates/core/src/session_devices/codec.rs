use super::*;
pub(crate) fn put_bytes(out: &mut Vec<u8>, bytes: &[u8]) {
    out.extend_from_slice(&(bytes.len() as u32).to_le_bytes());
    out.extend_from_slice(bytes);
}
pub(crate) struct Decoder<'a> {
    bytes: &'a [u8],
    at: usize,
}
impl<'a> Decoder<'a> {
    pub(crate) fn new(bytes: &'a [u8]) -> Self {
        Self { bytes, at: 0 }
    }
    pub(crate) fn take(&mut self, n: usize) -> Result<&'a [u8], DeviceError> {
        let end = self.at.checked_add(n).ok_or(DeviceError::Snapshot)?;
        let result = self.bytes.get(self.at..end).ok_or(DeviceError::Snapshot)?;
        self.at = end;
        Ok(result)
    }
    pub(crate) fn u8(&mut self) -> Result<u8, DeviceError> {
        Ok(self.take(1)?[0])
    }
    pub(crate) fn bool(&mut self) -> Result<bool, DeviceError> {
        match self.u8()? {
            0 => Ok(false),
            1 => Ok(true),
            _ => Err(DeviceError::Snapshot),
        }
    }
    pub(crate) fn u16(&mut self) -> Result<u16, DeviceError> {
        Ok(u16::from_le_bytes(self.take(2)?.try_into().unwrap()))
    }
    pub(crate) fn u32(&mut self) -> Result<u32, DeviceError> {
        Ok(u32::from_le_bytes(self.take(4)?.try_into().unwrap()))
    }
    pub(crate) fn u64(&mut self) -> Result<u64, DeviceError> {
        Ok(u64::from_le_bytes(self.take(8)?.try_into().unwrap()))
    }
    pub(crate) fn count(&mut self, max: usize) -> Result<usize, DeviceError> {
        let n = self.u32()? as usize;
        if n > max {
            Err(DeviceError::Limit)
        } else {
            Ok(n)
        }
    }
    pub(crate) fn bytes(&mut self, max: usize) -> Result<&'a [u8], DeviceError> {
        let n = self.count(max)?;
        self.take(n)
    }
    pub(crate) fn finish(self) -> Result<(), DeviceError> {
        if self.at == self.bytes.len() {
            Ok(())
        } else {
            Err(DeviceError::Snapshot)
        }
    }
}
fn put_ref(out: &mut Vec<u8>, reference: PayloadRef) {
    out.extend_from_slice(&reference.sha256);
    out.extend_from_slice(&reference.length.to_le_bytes());
}
fn get_ref(r: &mut Decoder<'_>) -> Result<PayloadRef, DeviceError> {
    Ok(PayloadRef {
        sha256: r.take(32)?.try_into().unwrap(),
        length: r.u32()?,
    })
}
fn put_request(out: &mut Vec<u8>, request: &DeviceRequest) {
    out.extend_from_slice(&request.id.to_le_bytes());
    match request.intent {
        DeviceIntent::BaseBlock { chunk, content } => {
            out.push(1);
            out.extend_from_slice(&chunk.to_le_bytes());
            put_ref(out, content);
        }
        DeviceIntent::Agent {
            generation,
            maximum,
        } => {
            out.push(2);
            out.extend_from_slice(&generation.to_le_bytes());
            out.extend_from_slice(&maximum.to_le_bytes());
        }
        DeviceIntent::Capture {
            samples,
            rate,
            channels,
        } => {
            out.push(3);
            out.extend_from_slice(&samples.to_le_bytes());
            out.extend_from_slice(&rate.to_le_bytes());
            out.push(channels);
        }
    }
}
fn get_request(r: &mut Decoder<'_>) -> Result<DeviceRequest, DeviceError> {
    let id = r.u64()?;
    let intent = match r.u8()? {
        1 => DeviceIntent::BaseBlock {
            chunk: r.u32()?,
            content: get_ref(r)?,
        },
        2 => DeviceIntent::Agent {
            generation: r.u64()?,
            maximum: r.u32()?,
        },
        3 => DeviceIntent::Capture {
            samples: r.u32()?,
            rate: r.u32()?,
            channels: r.u8()?,
        },
        _ => return Err(DeviceError::Intent),
    };
    if id == 0 {
        return Err(DeviceError::Intent);
    }
    Ok(DeviceRequest { id, intent })
}
impl DeviceCompletion {
    pub fn encode(&self) -> Result<Vec<u8>, DeviceError> {
        self.validate()?;
        let mut out = b"WVDEVC01".to_vec();
        put_request(&mut out, &self.request);
        out.push(self.status as u8);
        out.extend_from_slice(&self.frames.to_le_bytes());
        put_bytes(&mut out, &self.bytes);
        Ok(out)
    }
    pub fn decode(bytes: &[u8]) -> Result<Self, DeviceError> {
        if bytes.len() > MAX_RESULT + 128 {
            return Err(DeviceError::Limit);
        }
        let mut r = Decoder::new(bytes);
        if r.take(8)? != b"WVDEVC01" {
            return Err(DeviceError::Payload);
        }
        let request = get_request(&mut r)?;
        let status = match r.u8()? {
            0 => CompletionStatus::Supplied,
            1 => CompletionStatus::Failed,
            2 => CompletionStatus::Cancelled,
            _ => return Err(DeviceError::Payload),
        };
        let frames = r.u32()?;
        let bytes = r.bytes(MAX_RESULT)?.to_vec();
        r.finish()?;
        let value = Self {
            request,
            status,
            frames,
            bytes,
        };
        value.validate()?;
        Ok(value)
    }
}
impl DeviceHub {
    fn configuration(&self) -> Vec<u8> {
        let mut out = Vec::new();
        out.extend_from_slice(&[
            self.agent as u8,
            self.capture as u8,
            self.base.is_some() as u8,
        ]);
        if let Some(base) = &self.base {
            out.extend_from_slice(&base.identity);
            out.extend_from_slice(&base.sectors.to_le_bytes());
            out.extend_from_slice(&base.chunk_bytes.to_le_bytes());
            out.extend_from_slice(&(base.chunks.len() as u32).to_le_bytes());
            for reference in &base.chunks {
                put_ref(&mut out, *reference);
            }
        }
        out
    }
    pub(super) fn encode(&self) -> Result<Vec<u8>, DeviceError> {
        if self.error.is_some() {
            return Err(DeviceError::Snapshot);
        }
        let g = &self.guest;
        let mut out = b"WVDEVST1".to_vec();
        put_bytes(&mut out, &self.configuration());
        for n in [g.next_id, g.cursor, g.clock_ns, g.capture_epoch] {
            out.extend_from_slice(&n.to_le_bytes());
        }
        out.extend_from_slice(&(g.pending.len() as u32).to_le_bytes());
        for request in g.pending.values() {
            put_request(&mut out, request);
        }
        out.extend_from_slice(&(g.resident.len() as u32).to_le_bytes());
        for (chunk, resident) in &g.resident {
            out.extend_from_slice(&chunk.to_le_bytes());
            out.extend_from_slice(&resident.cursor.to_le_bytes());
            put_bytes(&mut out, &resident.bytes);
        }
        out.extend_from_slice(&(g.failed.len() as u32).to_le_bytes());
        for (chunk, status) in &g.failed {
            out.extend_from_slice(&chunk.to_le_bytes());
            out.push(*status as u8);
        }
        out.extend_from_slice(&(g.reads.len() as u32).to_le_bytes());
        for ((sector, length), chunks) in &g.reads {
            out.extend_from_slice(&sector.to_le_bytes());
            out.extend_from_slice(&length.to_le_bytes());
            out.extend_from_slice(&(chunks.len() as u32).to_le_bytes());
            for chunk in chunks {
                out.extend_from_slice(&chunk.to_le_bytes());
            }
        }
        out.extend_from_slice(&(g.overlay.len() as u32).to_le_bytes());
        for (sector, bytes) in &g.overlay {
            out.extend_from_slice(&sector.to_le_bytes());
            out.extend_from_slice(bytes);
        }
        out.extend_from_slice(&g.capture_pending.unwrap_or(0).to_le_bytes());
        out.push(g.capture_ready.is_some() as u8);
        if let Some(ready) = &g.capture_ready {
            put_bytes(&mut out, &ready.encode()?);
        }
        Ok(out)
    }
    pub(super) fn decode(&self, bytes: &[u8], sequence: u64) -> Result<GuestState, DeviceError> {
        // Bound before any allocation; COW sectors contribute at most 256 MiB, cache 16 MiB.
        if bytes.len() > (276 << 20) {
            return Err(DeviceError::Limit);
        }
        let mut r = Decoder::new(bytes);
        if r.take(8)? != b"WVDEVST1" || r.bytes(3 << 20)? != self.configuration() {
            return Err(DeviceError::Snapshot);
        }
        let mut g = GuestState {
            next_id: r.u64()?,
            cursor: r.u64()?,
            clock_ns: r.u64()?,
            capture_epoch: r.u64()?,
            ..GuestState::default()
        };
        if g.cursor > sequence || g.cursor > g.next_id {
            return Err(DeviceError::Snapshot);
        }
        let mut keys = Vec::new();
        for _ in 0..r.count(MAX_REQUESTS)? {
            let request = get_request(&mut r)?;
            let valid = match request.intent {
                DeviceIntent::BaseBlock { chunk, content } => self
                    .base
                    .as_ref()
                    .is_some_and(|base| base.chunks.get(chunk as usize) == Some(&content)),
                DeviceIntent::Agent { maximum, .. } => {
                    self.agent && maximum > 0 && maximum as usize <= MAX_RESULT
                }
                DeviceIntent::Capture {
                    samples,
                    rate,
                    channels,
                } => {
                    self.capture
                        && samples > 0
                        && samples as usize <= MAX_RESULT / 2
                        && rate > 0
                        && (1..=2).contains(&channels)
                        && samples.is_multiple_of(u32::from(channels))
                }
            };
            if !valid
                || request.id > g.next_id
                || (!matches!(request.intent, DeviceIntent::Agent { .. })
                    && keys.contains(&request.intent))
                || g.pending.insert(request.id, request.clone()).is_some()
            {
                return Err(DeviceError::Snapshot);
            }
            keys.push(request.intent);
        }
        if g.cursor
            .checked_add(g.pending.len() as u64)
            .is_none_or(|count| count > g.next_id)
        {
            return Err(DeviceError::Snapshot);
        }
        let mut resident_bytes = 0usize;
        for _ in 0..r.count(65536)? {
            let chunk = r.u32()?;
            let cursor = r.u64()?;
            let bytes = r.bytes(MAX_RESULT)?.to_vec();
            resident_bytes = resident_bytes
                .checked_add(bytes.len())
                .ok_or(DeviceError::Limit)?;
            if resident_bytes > CACHE_BUDGET
                || cursor == 0
                || cursor > g.cursor
                || !self.base.as_ref().is_some_and(|base| {
                    base.chunks
                        .get(chunk as usize)
                        .is_some_and(|reference| reference.matches(&bytes))
                })
                || g.resident
                    .insert(chunk, Resident { bytes, cursor })
                    .is_some()
            {
                return Err(DeviceError::Snapshot);
            }
        }
        for _ in 0..r.count(65536)? {
            let chunk = r.u32()?;
            let status = match r.u8()? {
                1 => CompletionStatus::Failed,
                2 => CompletionStatus::Cancelled,
                _ => return Err(DeviceError::Snapshot),
            };
            if self
                .base
                .as_ref()
                .is_none_or(|base| chunk as usize >= base.chunks.len())
                || g.resident.contains_key(&chunk)
                || g.failed.insert(chunk, status).is_some()
            {
                return Err(DeviceError::Snapshot);
            }
        }
        for request in g.pending.values() {
            if let DeviceIntent::BaseBlock { chunk, .. } = request.intent
                && (g.resident.contains_key(&chunk) || g.failed.contains_key(&chunk))
            {
                return Err(DeviceError::Snapshot);
            }
        }
        for _ in 0..r.count(MAX_REQUESTS)? {
            let sector = r.u64()?;
            let length = r.u32()?;
            let base = self.base.as_ref().ok_or(DeviceError::Snapshot)?;
            if length == 0
                || length as usize > MAX_RESULT
                || crate::block::check_range(base.sectors, sector, length as usize).is_err()
            {
                return Err(DeviceError::Snapshot);
            }
            let mut chunks = Vec::new();
            for _ in 0..r.count(MAX_REQUESTS)? {
                let chunk = r.u32()?;
                if chunk as usize >= base.chunks.len() || chunks.contains(&chunk) {
                    return Err(DeviceError::Snapshot);
                }
                chunks.push(chunk);
            }
            if chunks.is_empty() || g.reads.insert((sector, length), chunks).is_some() {
                return Err(DeviceError::Snapshot);
            }
        }
        for _ in 0..r.count(524288)? {
            let sector = r.u64()?;
            let bytes = r.take(512)?.to_vec();
            if self.base.as_ref().is_none_or(|base| sector >= base.sectors)
                || g.overlay.insert(sector, bytes).is_some()
            {
                return Err(DeviceError::Snapshot);
            }
        }
        let pending = r.u64()?;
        g.capture_pending = (pending != 0).then_some(pending);
        if r.bool()? {
            g.capture_ready = Some(DeviceCompletion::decode(r.bytes(MAX_RESULT + 128)?)?);
        }
        if let Some(ready) = &g.capture_ready
            && (!self.capture
                || !matches!(ready.request.intent, DeviceIntent::Capture { .. })
                || Some(ready.request.id) != g.capture_pending
                || g.pending.contains_key(&ready.request.id)
                || ready.request.id > g.next_id)
        {
            return Err(DeviceError::Snapshot);
        }
        // Ownership is reciprocal: an awaiting capture has exactly one pending request,
        // while a ready result has consumed it. An erased owner must not orphan a request.
        let mut captures = g
            .pending
            .values()
            .filter(|request| matches!(request.intent, DeviceIntent::Capture { .. }));
        let expected = if g.capture_ready.is_some() {
            None
        } else {
            g.capture_pending
        };
        if captures.next().map(|request| request.id) != expected || captures.next().is_some() {
            return Err(DeviceError::Snapshot);
        }
        r.finish()?;
        Ok(g)
    }
}

impl crate::Machine {
    pub(crate) fn session_devices_snapshot(&self) -> Result<Option<Vec<u8>>, DeviceError> {
        let Some(hub) = &self.session_devices else {
            return Ok(None);
        };
        let mut out = Vec::new();
        put_bytes(&mut out, &hub.borrow().encode()?);
        if let Some((block, _)) = &self.blk {
            put_bytes(&mut out, &block.borrow().session_pending());
        } else {
            put_bytes(&mut out, &[]);
        }
        self.check_session_devices_snapshot(
            &out,
            self.session_position()
                .ok_or(DeviceError::Inactive)?
                .sequence,
        )?;
        Ok(Some(out))
    }
    pub(crate) fn check_session_devices_snapshot(
        &self,
        bytes: &[u8],
        sequence: u64,
    ) -> Result<DeviceRestore, DeviceError> {
        let hub = self
            .session_devices
            .as_ref()
            .ok_or(DeviceError::Inactive)?
            .borrow();
        let mut r = Decoder::new(bytes);
        let guest = hub.decode(r.bytes(276 << 20)?, sequence)?;
        let pending = r.bytes(2 << 20)?;
        let block = if self.blk.is_some() {
            Some(crate::dev::virtio::blk::SessionPending::decode(
                pending,
                self.bus.ram().base(),
                self.bus.ram().len(),
            )?)
        } else {
            if !pending.is_empty() {
                return Err(DeviceError::Snapshot);
            }
            None
        };
        r.finish()?;
        Ok(DeviceRestore { guest, block })
    }
    pub(crate) fn restore_session_devices(&mut self, restore: DeviceRestore) {
        let mut hub = self.session_devices.as_ref().unwrap().borrow_mut();
        hub.guest = restore.guest;
        hub.incarnation = Rc::new(());
        hub.error = None;
        if let Some(pending) = restore.block {
            self.blk
                .as_ref()
                .unwrap()
                .0
                .borrow_mut()
                .restore_session_pending(pending);
        }
    }
}
pub(crate) struct DeviceRestore {
    guest: GuestState,
    block: Option<crate::dev::virtio::blk::SessionPending>,
}
impl DeviceRestore {
    pub(crate) fn sound_matches(&self, state: &crate::dev::virtio::snd::SndState) -> bool {
        if self.guest.capture_epoch != state.capture_lifecycle_epoch() {
            return false;
        }
        let due = state.session_capture_due_shape(self.guest.clock_ns);
        let Some(id) = self.guest.capture_pending else {
            return due.is_none();
        };
        let request = self
            .guest
            .capture_ready
            .as_ref()
            .map(|result| &result.request)
            .or_else(|| self.guest.pending.get(&id));
        let Some(DeviceRequest {
            intent:
                DeviceIntent::Capture {
                    samples,
                    rate,
                    channels,
                },
            ..
        }) = request
        else {
            return false;
        };
        due == Some((*samples, *rate, *channels))
    }
}
