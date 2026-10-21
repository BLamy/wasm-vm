//! E9-T05: one owner, one quiescent borrow, one authenticated software tuple.
use super::*;
use software_checkpoint::SoftwareCheckpoint;
use wasm_vm_storage::OverlayDelta;
use wasm_vm_storage::checkpoint::CheckpointContext;
use wasm_vm_storage::session::Phase;

fn context_for(inner: &LinuxInner, bytes: &[u8]) -> Result<CheckpointContext, JsError> {
    if inner.machine.ram_epoch_pending() {
        return Err(JsError::new("session keyframe publication pending"));
    }
    if inner.exact_session.is_none() {
        inner.refuse_capture_mutation()?;
    } else if inner.exact_driver.is_some() {
        return Err(JsError::new("session keyframe replay active"));
    }
    let context = CheckpointContext::from_bytes(bytes)
        .map_err(|error| JsError::new(&format!("session_checkpoint_context: {error:?}")))?;
    if inner.finished.is_some()
        || inner.session_has_initrd
        || inner.session_has_mic
        || inner.file_transfers.is_some()
        || inner.audio_attached
        || inner.capture_attached
        || (inner.checkpoint_disk.is_none() && inner.exact_session.is_none())
        || context.kernel.0 != inner.session_kernel
        || context.ram_bytes.0 != inner.machine.ram_len() as u64
        || context.ram_bytes.0 > 256 << 20
        || inner.machine.guest_clock_mode() != wasm_vm_core::time::TimeMode::ICount
    {
        return Err(JsError::new("session_checkpoint_profile"));
    }
    Ok(context)
}

// The exact-session adapter owns its complete immutable-base COW overlay inside the native
// SESSION_DEVICES section. Its disk-root object is the accepted empty base binding from T14;
// the native section, not this base root, supplies every later overlay block on restore.
fn disk_at_keyframe(inner: &LinuxInner, native: &[u8]) -> Result<Vec<u8>, JsError> {
    if let Some(disk) = &inner.checkpoint_disk {
        return disk
            .snapshot_delta(inner.machine.overlay_generation())
            .map(|delta| delta.to_bytes())
            .map_err(|error| JsError::new(&format!("session_keyframe_disk_busy: {error:?}")));
    }
    if inner.exact_session.is_none() {
        return Err(JsError::new("session_keyframe_disk_missing"));
    }
    let (header, _) = wasm_vm_core::resume::SnapshotHeader::parse(native)
        .map_err(|error| JsError::new(&format!("session_keyframe_header: {error:?}")))?;
    Ok(OverlayDelta {
        image_len: 512 << 20,
        base_binding: header.base_image_hash,
        generation: header.overlay_generation,
        blocks: Vec::new(),
    }
    .to_bytes())
}

#[derive(Clone, Copy)]
enum KeyframeKind {
    Full,
    Delta,
}

impl WasmLinux {
    async fn capture_keyframe(
        &self,
        context_bytes: &[u8],
        kind: KeyframeKind,
    ) -> Result<js_sys::Uint8Array, JsError> {
        {
            let inner = self.inner.try_borrow().map_err(|_| reentrant())?;
            context_for(&inner, context_bytes)?;
            if inner.exact_session == Some(true) {
                return Err(JsError::new("session_keyframe_recording_required"));
            }
        }
        for _ in 0..Machine::QUIESCE_MAX_PASSES {
            {
                let mut inner = self.inner.try_borrow_mut().map_err(|_| reentrant())?;
                let context = context_for(&inner, context_bytes)?;
                let position = inner
                    .machine
                    .session_position()
                    .ok_or_else(|| JsError::new("session_keyframe_clock_required"))?;
                if context.position.phase != Phase::Before
                    || position.phase != wasm_vm_core::session_clock::SessionPhase::Before
                    || context.position.transition.0 != position.transition
                    || context.position.retired.0 != position.retired
                    || context.position.ordinal != position.ordinal
                    || context.position.sequence.0 != position.sequence
                {
                    return Err(JsError::new("session_keyframe_position_mismatch"));
                }
                if inner.machine.guest_clock_div() != u64::from(context.clock.divider) {
                    return Err(JsError::new("session_checkpoint_clock"));
                }
                match inner.machine.quiesce() {
                    Ok(()) => {
                        inner
                            .machine
                            .bus_mut()
                            .ram_mut()
                            .begin_dirty_epoch()
                            .map_err(|_| JsError::new("session_keyframe_epoch_busy"))?;
                        let result = (|| {
                            let native = match kind {
                                KeyframeKind::Full => inner.machine.save_session_resume(),
                                KeyframeKind::Delta => {
                                    inner.machine.save_session_state_without_ram()
                                }
                            }
                            .map_err(|error| {
                                JsError::new(&format!("session_keyframe_native: {error:?}"))
                            })?;
                            let disk = disk_at_keyframe(&inner, &native)?;
                            let pending: Vec<u8> = inner.pending.iter().copied().collect();
                            let out = inner.out.borrow();
                            let encoded = match kind {
                                KeyframeKind::Full => SoftwareCheckpoint::encode_keyframe_base(
                                    &context, &native, &disk, &pending, &out,
                                ),
                                KeyframeKind::Delta => SoftwareCheckpoint::encode_delta(
                                    &context, &native, &disk, &pending, &out,
                                ),
                            };
                            encoded.map_err(|error| {
                                JsError::new(&format!("session_keyframe_encode: {error:?}"))
                            })
                        })();
                        if result.is_err() {
                            let _ = inner.machine.bus_mut().ram_mut().finish_dirty_epoch(false);
                        }
                        return result.map(|bytes| js_sys::Uint8Array::from(bytes.as_slice()));
                    }
                    Err(resume::SnapshotError::NotQuiesced { .. }) => {}
                    Err(error) => {
                        return Err(JsError::new(&format!(
                            "session_keyframe_quiesce: {error:?}"
                        )));
                    }
                }
            }
            self.fetch_pending().await?;
            self.persist_pending().await?;
        }
        Err(JsError::new("session_keyframe_busy_or_budget"))
    }
}

#[wasm_bindgen]
impl WasmLinux {
    /// Install the same owned observation adapter that T14's replay driver installs before its
    /// initial full restore. This candidate has no live providers and no admitted replay plan.
    #[wasm_bindgen(js_name = prepareSoftwareKeyframeCandidate)]
    pub fn prepare_software_keyframe_candidate(&self) -> Result<(), JsError> {
        use wasm_vm_core::session_clock::sources::ObservationTape;
        let mut inner = self.inner.try_borrow_mut().map_err(|_| reentrant())?;
        if inner.exact_session != Some(true)
            || inner.exact_driver.is_some()
            || inner.machine.session_sources_active()
            || inner.machine.session_position() != Some(Default::default())
        {
            return Err(JsError::new("session_keyframe_exact_candidate_required"));
        }
        let policy = inner.machine.source_policy();
        inner
            .machine
            .start_session_sources(
                policy,
                Some(ObservationTape {
                    policy,
                    records: Vec::new(),
                }),
            )
            .map_err(|error| JsError::new(&format!("session_keyframe_sources: {error:?}")))
    }

    /// Begin a full keyframe and freeze the dirty set until its store publication resolves.
    #[wasm_bindgen(js_name = captureSoftwareBaseKeyframe)]
    pub async fn capture_software_base_keyframe(
        &self,
        context_bytes: &[u8],
    ) -> Result<js_sys::Uint8Array, JsError> {
        self.capture_keyframe(context_bytes, KeyframeKind::Full)
            .await
    }

    /// Capture CPU/devices/disk/host queues while RAM is represented by separately streamed
    /// dirty-page objects. The caller must hold the guest paused until it acknowledges the epoch.
    #[wasm_bindgen(js_name = captureSoftwareDeltaKeyframe)]
    pub async fn capture_software_delta_keyframe(
        &self,
        context_bytes: &[u8],
    ) -> Result<js_sys::Uint8Array, JsError> {
        self.capture_keyframe(context_bytes, KeyframeKind::Delta)
            .await
    }

    #[wasm_bindgen(js_name = pendingSoftwareRamPages)]
    pub fn pending_software_ram_pages(&self) -> Result<u32, JsError> {
        let mut inner = self.inner.try_borrow_mut().map_err(|_| reentrant())?;
        inner
            .machine
            .bus_mut()
            .ram()
            .pending_dirty_pages()
            .and_then(|count| u32::try_from(count).ok())
            .ok_or_else(|| JsError::new("session_keyframe_epoch_missing"))
    }

    #[wasm_bindgen(js_name = nextSoftwareRamDeltaChunk)]
    pub fn next_software_ram_delta_chunk(&self, from_page: u32) -> Result<JsValue, JsError> {
        let mut inner = self.inner.try_borrow_mut().map_err(|_| reentrant())?;
        let next = inner
            .machine
            .bus_mut()
            .ram()
            .next_pending_delta_chunk(from_page as usize)
            .map_err(|error| JsError::new(&format!("session_keyframe_chunk: {error:?}")))?;
        let Some((cursor, bytes)) = next else {
            return Ok(JsValue::NULL);
        };
        let object = js_sys::Object::new();
        js_sys::Reflect::set(
            &object,
            &JsValue::from_str("next"),
            &JsValue::from_f64(cursor as f64),
        )
        .map_err(|_| JsError::new("session_keyframe_chunk_result"))?;
        js_sys::Reflect::set(
            &object,
            &JsValue::from_str("bytes"),
            &js_sys::Uint8Array::from(bytes.as_slice()),
        )
        .map_err(|_| JsError::new("session_keyframe_chunk_result"))?;
        Ok(object.into())
    }

    #[wasm_bindgen(js_name = softwareRamDigest)]
    pub fn software_ram_digest(&self) -> Result<String, JsError> {
        let inner = self.inner.try_borrow().map_err(|_| reentrant())?;
        Ok(inner.machine.snapshot().hex_digest())
    }

    #[wasm_bindgen(js_name = finishSoftwareRamEpoch)]
    pub fn finish_software_ram_epoch(&self, committed: bool) -> Result<(), JsError> {
        self.inner
            .try_borrow_mut()
            .map_err(|_| reentrant())?
            .machine
            .bus_mut()
            .ram_mut()
            .finish_dirty_epoch(committed)
            .map_err(|_| JsError::new("session_keyframe_epoch_missing"))
    }

    /// Private restore candidate: validate the full ancestor envelope, then seed only RAM.
    /// Its disk generation may be older than the target; the final delta envelope is bound to
    /// the target candidate's disk generation before CPU/devices are committed.
    #[wasm_bindgen(js_name = seedSoftwareRamFromCheckpoint)]
    pub fn seed_software_ram_from_checkpoint(&self, base_frame: &[u8]) -> Result<(), JsError> {
        let base = SoftwareCheckpoint::from_keyframe_base_bytes(base_frame)
            .map_err(|error| JsError::new(&format!("session_keyframe_base: {error:?}")))?;
        let mut inner = self.inner.try_borrow_mut().map_err(|_| reentrant())?;
        context_for(&inner, base.context_bytes)?;
        inner
            .machine
            .seed_session_ram_from_full_resume(base.resume)
            .map_err(|error| JsError::new(&format!("session_keyframe_base_ram: {error:?}")))
    }

    /// The exact journal's T14 initial checkpoint is already a full native resume. Admit its
    /// strict empty-queue envelope as a RAM ancestor without asking T14 to duplicate 256 MiB.
    #[wasm_bindgen(js_name = seedSoftwareRamFromExactStart)]
    pub fn seed_software_ram_from_exact_start(&self, frame: &[u8]) -> Result<(), JsError> {
        if frame.len() < 112 || frame.get(..8) != Some(b"WVEXACT1") {
            return Err(JsError::new("session_keyframe_exact_start"));
        }
        let version = u32::from_le_bytes(frame[8..12].try_into().unwrap());
        let length = u64::from_le_bytes(frame[12..20].try_into().unwrap());
        let pending = u32::from_le_bytes(frame[20..24].try_into().unwrap());
        let output = u32::from_le_bytes(frame[24..28].try_into().unwrap());
        if version != 1
            || length < 84
            || length > 300 << 20
            || pending != 0
            || output != 0
            || 28u64.checked_add(length) != Some(frame.len() as u64)
        {
            return Err(JsError::new("session_keyframe_exact_start"));
        }
        let mut inner = self.inner.try_borrow_mut().map_err(|_| reentrant())?;
        if inner.exact_session != Some(true) || inner.exact_driver.is_some() {
            return Err(JsError::new("session_keyframe_exact_candidate_required"));
        }
        inner
            .machine
            .seed_session_ram_from_full_resume(&frame[28..])
            .map_err(|error| JsError::new(&format!("session_keyframe_base_ram: {error:?}")))
    }

    #[wasm_bindgen(js_name = applySoftwareRamDeltaChunk)]
    pub fn apply_software_ram_delta_chunk(&self, bytes: &[u8]) -> Result<u32, JsError> {
        let mut inner = self.inner.try_borrow_mut().map_err(|_| reentrant())?;
        if inner.exact_session.is_none() {
            inner.refuse_capture_mutation()?;
        } else if inner.exact_session != Some(true) || inner.exact_driver.is_some() {
            return Err(JsError::new("session_keyframe_exact_candidate_required"));
        }
        inner
            .machine
            .apply_session_ram_delta_chunk(bytes)
            .and_then(|count| {
                u32::try_from(count).map_err(|_| wasm_vm_core::ram::RamDeltaError::Bound)
            })
            .map_err(|error| JsError::new(&format!("session_keyframe_ram_chunk: {error:?}")))
    }

    #[wasm_bindgen(js_name = restoreSoftwareDeltaKeyframe)]
    pub fn restore_software_delta_keyframe(
        &self,
        bytes: &[u8],
        expected_context: &[u8],
        expected_ram_digest: &[u8],
    ) -> Result<(), JsError> {
        let checkpoint = SoftwareCheckpoint::from_delta_bytes(bytes)
            .map_err(|error| JsError::new(&format!("session_keyframe_admission: {error:?}")))?;
        let digest: [u8; 32] = expected_ram_digest
            .try_into()
            .map_err(|_| JsError::new("session_keyframe_ram_digest"))?;
        let mut inner = self.inner.try_borrow_mut().map_err(|_| reentrant())?;
        if inner.exact_session == Some(false) {
            return Err(JsError::new("session_keyframe_restore_candidate_required"));
        }
        let expected = context_for(&inner, expected_context)?;
        if checkpoint.context != expected {
            return Err(JsError::new("session_keyframe_context_mismatch"));
        }
        let actual = disk_at_keyframe(&inner, checkpoint.resume)?;
        if actual != checkpoint.disk {
            return Err(JsError::new("session_keyframe_disk_mismatch"));
        }
        let pending: std::collections::VecDeque<u8> = checkpoint.input.iter().copied().collect();
        let output = checkpoint.output.to_vec();
        inner
            .machine
            .load_session_state_without_ram(checkpoint.resume, &digest)
            .map_err(|error| JsError::new(&format!("session_keyframe_native: {error:?}")))?;
        inner.pending = pending;
        *inner.out.borrow_mut() = output;
        Ok(())
    }
    /// The loader fences all host mutations and execution until this bounded Promise settles.
    /// Pending block fetches/durability drain without CPU execution; final serialization has no
    /// await, callback or borrow release between architectural state, COW map and UART queues.
    #[wasm_bindgen(js_name = captureSoftwareCheckpoint)]
    pub async fn capture_software_checkpoint(
        &self,
        context_bytes: &[u8],
    ) -> Result<js_sys::Uint8Array, JsError> {
        {
            let inner = self.inner.try_borrow().map_err(|_| reentrant())?;
            context_for(&inner, context_bytes)?;
        }
        for _ in 0..Machine::QUIESCE_MAX_PASSES {
            {
                let mut inner = self.inner.try_borrow_mut().map_err(|_| reentrant())?;
                let context = context_for(&inner, context_bytes)?;
                if inner.machine.guest_clock_div() != u64::from(context.clock.divider) {
                    return Err(JsError::new("session_checkpoint_clock"));
                }
                match inner.machine.quiesce() {
                    Ok(()) => {
                        let native = inner.machine.save_session_resume().map_err(|error| {
                            JsError::new(&format!("session_checkpoint_native: {error:?}"))
                        })?;
                        if let Ok(delta) = inner
                            .checkpoint_disk
                            .as_ref()
                            .unwrap()
                            .snapshot_delta(inner.machine.overlay_generation())
                        {
                            let pending: Vec<u8> = inner.pending.iter().copied().collect();
                            let out = inner.out.borrow();
                            let bytes = SoftwareCheckpoint::encode(
                                &context,
                                &native,
                                &delta.to_bytes(),
                                &pending,
                                &out,
                            )
                            .map_err(|error| {
                                JsError::new(&format!("session_checkpoint_encode: {error:?}"))
                            })?;
                            return Ok(js_sys::Uint8Array::from(bytes.as_slice()));
                        }
                    }
                    Err(resume::SnapshotError::NotQuiesced { .. }) => {}
                    Err(error) => {
                        return Err(JsError::new(&format!(
                            "session_checkpoint_quiesce: {error:?}"
                        )));
                    }
                }
            }
            self.fetch_pending().await?;
            self.persist_pending().await?;
        }
        Err(JsError::new("session_checkpoint_busy_or_budget"))
    }

    /// Only a private seeded candidate is admitted by the loader. Native callers additionally get
    /// a complete byte comparison of its COW map, not merely a generation comparison (siblings may
    /// share generations). All fallible checks precede the first CPU/device/host-queue mutation.
    #[wasm_bindgen(js_name = restoreSoftwareCheckpoint)]
    pub fn restore_software_checkpoint(
        &self,
        bytes: &[u8],
        expected_context: &[u8],
    ) -> Result<(), JsError> {
        let checkpoint = SoftwareCheckpoint::from_bytes(bytes)
            .map_err(|error| JsError::new(&format!("session_checkpoint_admission: {error:?}")))?;
        let mut inner = self.inner.try_borrow_mut().map_err(|_| reentrant())?;
        let expected = context_for(&inner, expected_context)?;
        if checkpoint.context != expected {
            return Err(JsError::new("session_checkpoint_context_mismatch"));
        }
        let actual = inner
            .checkpoint_disk
            .as_ref()
            .unwrap()
            .snapshot_delta(inner.machine.overlay_generation())
            .map_err(|error| JsError::new(&format!("session_checkpoint_disk_busy: {error:?}")))?;
        if actual.to_bytes() != checkpoint.disk {
            return Err(JsError::new("session_checkpoint_disk_mismatch"));
        }
        // Preallocate host queues before the atomic architectural commit.
        let pending: std::collections::VecDeque<u8> = checkpoint.input.iter().copied().collect();
        let output = checkpoint.output.to_vec();
        inner
            .machine
            .load_session_resume(checkpoint.resume)
            .map_err(|error| JsError::new(&format!("session_checkpoint_native: {error:?}")))?;
        inner.pending = pending;
        *inner.out.borrow_mut() = output;
        Ok(())
    }

    /// Device map of the standard Linux constructor, using the authoritative platform constants.
    #[wasm_bindgen(js_name = softwareCheckpointTopology)]
    pub fn software_checkpoint_topology(&self) -> String {
        use wasm_vm_core::platform::virt;
        let mut entries = Vec::new();
        for (id, kind, base, length, irq) in [
            (
                "uart0",
                "uart16550",
                virt::UART0_BASE,
                virt::UART0_LEN,
                virt::UART0_IRQ,
            ),
            ("clint", "clint", virt::CLINT_BASE, virt::CLINT_LEN, 0),
            ("plic", "plic", virt::PLIC_BASE, virt::PLIC_LEN, 0),
            (
                "rtc",
                "goldfish-rtc",
                virt::RTC_BASE,
                virt::RTC_LEN,
                virt::RTC_IRQ,
            ),
        ] {
            entries.push(format!("{{\"id\":\"{id}\",\"kind\":\"{kind}\",\"mmio_base\":\"{base}\",\"mmio_length\":{length},\"irq\":{irq},\"state_version\":1}}"));
        }
        for (slot, kind) in [
            "virtio-blk",
            "virtio-net",
            "virtio-rng",
            "virtio-keyboard",
            "virtio-tablet",
            "virtio-mouse",
            "virtio-snd",
            "virtio-gpu2d",
            "virtio-console",
        ]
        .iter()
        .enumerate()
        {
            let base = virt::VIRTIO_BASE + slot as u64 * virt::VIRTIO_STRIDE;
            let irq = virt::VIRTIO_IRQ_BASE + slot as u32;
            let length = virt::VIRTIO_LEN;
            entries.push(format!("{{\"id\":\"slot{slot}\",\"kind\":\"{kind}\",\"mmio_base\":\"{base}\",\"mmio_length\":{length},\"irq\":{irq},\"state_version\":1}}"));
        }
        format!("[{}]", entries.join(","))
    }
}
