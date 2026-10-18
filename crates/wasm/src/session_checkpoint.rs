//! E9-T05: one owner, one quiescent borrow, one authenticated software tuple.
use super::*;
use software_checkpoint::SoftwareCheckpoint;
use wasm_vm_storage::checkpoint::CheckpointContext;

fn context_for(inner: &LinuxInner, bytes: &[u8]) -> Result<CheckpointContext, JsError> {
    let context = CheckpointContext::from_bytes(bytes)
        .map_err(|error| JsError::new(&format!("session_checkpoint_context: {error:?}")))?;
    if inner.finished.is_some()
        || inner.session_has_initrd
        || inner.session_has_mic
        || inner.file_transfers.is_some()
        || inner.audio_attached
        || inner.capture_attached
        || inner.checkpoint_disk.is_none()
        || context.kernel.0 != inner.session_kernel
        || context.ram_bytes.0 != inner.machine.ram_len() as u64
        || context.ram_bytes.0 > 256 << 20
        || inner.machine.guest_clock_mode() != wasm_vm_core::time::TimeMode::ICount
    {
        return Err(JsError::new("session_checkpoint_profile"));
    }
    Ok(context)
}

#[wasm_bindgen]
impl WasmLinux {
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
