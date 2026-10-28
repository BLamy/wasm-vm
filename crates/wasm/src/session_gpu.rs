//! Exact production GPU history. Renderer handles never cross the durable boundary.
use crate::{
    WasmLinux, event_clock, reentrant,
    virgl_host::{owned, set},
};
use wasm_bindgen::prelude::*;
fn gpu_error(error: impl core::fmt::Debug) -> JsError {
    JsError::new(&format!("gpu_session: {error:?}"))
}
fn admitted(inner: &crate::LinuxInner) -> Result<(), JsError> {
    if !inner.exact_gpu || inner.exact_session.is_none() || inner.finished.is_some() {
        return Err(JsError::new("exact GPU session is inactive or stopped"));
    }
    Ok(())
}
fn witness(inner: &mut crate::LinuxInner) -> Result<js_sys::Object, JsError> {
    admitted(inner)?;
    let digest = inner
        .machine
        .gpu_session_state_digest()
        .map_err(gpu_error)?;
    let out = event_clock::position_object(
        inner
            .machine
            .session_position()
            .ok_or_else(|| JsError::new("GPU event clock"))?,
    );
    set(&out, "digest", owned(&digest)).map_err(|_| JsError::new("GPU witness result"))?;
    Ok(out)
}
#[wasm_bindgen]
impl WasmLinux {
    #[wasm_bindgen(js_name=exactGpuSessionEpoch)]
    pub fn exact_gpu_session_epoch(&self) -> Result<String, JsError> {
        let inner = self.inner.try_borrow().map_err(|_| reentrant())?;
        admitted(&inner)?;
        let (_, gpu) = inner
            .machine
            .virtio_gpu()
            .ok_or_else(|| JsError::new("GPU unavailable"))?;
        let epoch = gpu
            .try_borrow()
            .map_err(|_| reentrant())?
            .control3d_snapshot()
            .ok_or_else(|| JsError::new("qualified GPU unavailable"))?
            .epoch;
        Ok(crate::virgl_host::hex(epoch))
    }
    #[wasm_bindgen(js_name=exactGpuSessionTopology)]
    pub fn exact_gpu_session_topology(&self) -> Result<String, JsError> {
        let inner = self.inner.try_borrow().map_err(|_| reentrant())?;
        if !inner.exact_gpu || !inner.machine.control3d_proof_installed() {
            return Err(JsError::new("qualified exact GPU profile required"));
        }
        exact_gpu_topology()
    }

    #[wasm_bindgen(js_name=exactGpuSessionWitness)]
    pub fn exact_gpu_session_witness(&self) -> Result<JsValue, JsError> {
        let mut inner = self.inner.try_borrow_mut().map_err(|_| reentrant())?;
        Ok(witness(&mut inner)?.into())
    }

    /// Enable a passive one-shot block failure observation in a private exact
    /// diagnostic owner. The flag and result are absent from guest snapshots.
    #[cfg(feature = "cold-block-diagnostic")]
    #[wasm_bindgen(js_name=armExactFirstBlockFailure)]
    pub fn arm_exact_first_block_failure(&self) -> Result<(), JsError> {
        let mut inner = self.inner.try_borrow_mut().map_err(|_| reentrant())?;
        admitted(&inner)?;
        inner.machine.enable_first_blk_failure_diagnostic();
        Ok(())
    }

    /// Record only the bounded diagnostic window around the original cold
    /// guest's large write. The log is passive and absent from snapshots.
    #[cfg(feature = "cold-block-diagnostic")]
    #[wasm_bindgen(js_name=armExactBlockLog)]
    pub fn arm_exact_block_log(&self) -> Result<(), JsError> {
        let mut inner = self.inner.try_borrow_mut().map_err(|_| reentrant())?;
        admitted(&inner)?;
        inner.machine.enable_blk_log();
        Ok(())
    }

    #[cfg(feature = "cold-block-diagnostic")]
    #[wasm_bindgen(js_name=drainExactBlockLog)]
    pub fn drain_exact_block_log(&self) -> Result<String, JsError> {
        let mut inner = self.inner.try_borrow_mut().map_err(|_| reentrant())?;
        admitted(&inner)?;
        let rows: Vec<_> = inner
            .machine
            .drain_blk_log()
            .into_iter()
            .map(|row| {
                serde_json::json!({
                    "type":row.rtype,
                    "sector":row.sector.to_string(),
                    "bytes":row.requested_bytes,
                    "guestWrittenBytes":row.len,
                    "status":row.status,
                })
            })
            .collect();
        serde_json::to_string(&rows).map_err(|error| JsError::new(&error.to_string()))
    }

    #[cfg(feature = "cold-block-diagnostic")]
    #[wasm_bindgen(js_name=exactParkedBlocks)]
    pub fn exact_parked_blocks(&self) -> Result<String, JsError> {
        let inner = self.inner.try_borrow().map_err(|_| reentrant())?;
        admitted(&inner)?;
        let rows: Vec<_> = inner
            .machine
            .parked_blk_witnesses()
            .into_iter()
            .map(|row| {
                let reason = match row.reason {
                    wasm_vm_core::dev::virtio::blk::ParkReason::Chunk(index) => {
                        serde_json::json!({"kind":"chunk","index":index})
                    }
                    wasm_vm_core::dev::virtio::blk::ParkReason::Flush => {
                        serde_json::json!({"kind":"flush"})
                    }
                    wasm_vm_core::dev::virtio::blk::ParkReason::Write => {
                        serde_json::json!({"kind":"write"})
                    }
                };
                serde_json::json!({
                    "head":row.head,
                    "reason":reason,
                    "statusAddress":row.status_addr.to_string(),
                    "statusByte":row.status_byte,
                    "usedShadowIndex":row.used_shadow_index,
                    "usedGuestIndex":row.used_guest_index,
                    "nextUsedSlotHead":row.next_used_slot_head,
                })
            })
            .collect();
        serde_json::to_string(&rows).map_err(|error| JsError::new(&error.to_string()))
    }

    #[cfg(feature = "cold-block-diagnostic")]
    #[wasm_bindgen(js_name=exactFirstBlockFailure)]
    pub fn exact_first_block_failure(&self) -> Result<Option<String>, JsError> {
        let inner = self.inner.try_borrow().map_err(|_| reentrant())?;
        admitted(&inner)?;
        let Some(failure) = inner.machine.first_blk_failure() else {
            return Ok(None);
        };
        let witness = inner
            .machine
            .first_blk_failure_witness()
            .ok_or_else(|| JsError::new("completed block failure has no boundary witness"))?;
        if failure.event_position != Some(witness.position)
            || failure.ram_digest != Some(witness.ram_digest)
        {
            return Err(JsError::new("completed block failure witness changed"));
        }
        let hex = |bytes: [u8; 32]| -> String {
            bytes.iter().map(|byte| format!("{byte:02x}")).collect()
        };
        let range = match failure.range {
            Some(Ok(offset)) => {
                serde_json::json!({"status":"in-range","byteOffset":offset.to_string()})
            }
            Some(Err(error)) => {
                serde_json::json!({"status":"rejected","error":format!("{error:?}")})
            }
            None => serde_json::Value::Null,
        };
        serde_json::to_string(&serde_json::json!({
            "head":failure.head,
            "eventPosition":{
                "transition":witness.position.transition.to_string(),
                "retired":witness.position.retired.to_string(),
                "sequence":witness.position.sequence.to_string(),
                "phase":witness.position.phase.label(),
                "ordinal":witness.position.ordinal,
            },
            "guestWitnessDigest":hex(witness.guest_digest),
            "ramDigest":hex(witness.ram_digest),
            "pc":format!("0x{:016x}",witness.pc),
            "type":failure.rtype,
            "sector":failure.sector.map(|value|value.to_string()),
            "requestedBytes":failure.requested_bytes.to_string(),
            "capacitySectors":failure.capacity_sectors.to_string(),
            "maxTransferBytes":failure.max_transfer_bytes,
            "range":range,
            "overlayBefore":failure.overlay_before,
            "overlayAfter":failure.overlay_after,
            "stage":format!("{:?}",failure.stage),
            "backendError":failure.backend_error.map(|error|format!("{error:?}")),
            "status":"S_IOERR",
            "statusDmaWritten":failure.status_dma_written,
            "usedRingCommitted":failure.used_ring_committed,
        }))
        .map(Some)
        .map_err(gpu_error)
    }

    #[wasm_bindgen(js_name=exactGpuSessionState)]
    pub fn exact_gpu_session_state(&self) -> Result<js_sys::Uint8Array, JsError> {
        let mut inner = self.inner.try_borrow_mut().map_err(|_| reentrant())?;
        admitted(&inner)?;
        let bytes = inner
            .machine
            .gpu_session_state_witness_bytes()
            .map_err(gpu_error)?;
        Ok(owned(&bytes))
    }
    /// Receipts and every owned readback transfer atomically out of the native window.
    #[wasm_bindgen(js_name=takeExactGpuBatch)]
    pub fn take_exact_gpu_batch(&self) -> Result<JsValue, JsError> {
        let mut inner = self.inner.try_borrow_mut().map_err(|_| reentrant())?;
        admitted(&inner)?;
        if inner.exact_session != Some(false) {
            return Err(JsError::new("GPU recording required"));
        }
        let batch = inner
            .machine
            .take_session_gpu_recording()
            .map_err(gpu_error)?;
        let events = js_sys::Array::new();
        for row in batch.events {
            events.push(&crate::session_replay::encode_event(row));
        }
        let payloads = js_sys::Array::new();
        for payload in batch.payloads {
            let value = js_sys::Object::new();
            set(&value, "sha256", owned(&payload.reference.sha256))
                .map_err(|_| JsError::new("GPU payload result"))?;
            set(&value, "length", payload.reference.length)
                .map_err(|_| JsError::new("GPU payload result"))?;
            set(&value, "bytes", owned(&payload.bytes))
                .map_err(|_| JsError::new("GPU payload result"))?;
            payloads.push(&value);
        }
        let out = js_sys::Object::new();
        set(&out, "events", events).map_err(|_| JsError::new("GPU batch result"))?;
        set(&out, "payloads", payloads).map_err(|_| JsError::new("GPU batch result"))?;
        Ok(out.into())
    }
    /// Freeze RAM pages, CPU/devices and the genuine pending result frontier together.
    /// The caller owns the paused guest until finishSoftwareRamEpoch acknowledges publication.
    #[wasm_bindgen(js_name=captureExactGpuKeyframe)]
    pub fn capture_exact_gpu_keyframe(
        &self,
        renderer_digest: &[u8],
        full: bool,
    ) -> Result<JsValue, JsError> {
        let renderer_digest: &[u8; 32] = renderer_digest
            .try_into()
            .map_err(|_| JsError::new("GPU renderer digest"))?;
        let mut inner = self.inner.try_borrow_mut().map_err(|_| reentrant())?;
        admitted(&inner)?;
        if inner.exact_session != Some(false) || inner.machine.ram_epoch_pending() {
            return Err(JsError::new("GPU recording boundary required"));
        }
        let out = witness(&mut inner)?;
        inner
            .machine
            .bus_mut()
            .ram_mut()
            .begin_dirty_epoch()
            .map_err(gpu_error)?;
        let result = (|| {
            let native = if full {
                inner.machine.save_gpu_result_resume(renderer_digest)
            } else {
                inner
                    .machine
                    .save_gpu_result_state_without_ram(renderer_digest)
            }
            .map_err(gpu_error)?;
            set(&out, "native", owned(&native)).map_err(|_| JsError::new("GPU native result"))?;
            set(
                &out,
                "ramDigest",
                owned(&inner.machine.snapshot().mem_digest),
            )
            .map_err(|_| JsError::new("GPU RAM result"))?;
            set(&out, "full", full).map_err(|_| JsError::new("GPU RAM result"))?;
            let pending: Vec<u8> = inner.pending.iter().copied().collect();
            // UART-owned pending output remains inside the native UART snapshot.
            let output = inner.out.borrow();
            set(&out, "pending", owned(&pending))
                .map_err(|_| JsError::new("GPU host queue result"))?;
            set(&out, "output", owned(&output))
                .map_err(|_| JsError::new("GPU host queue result"))?;
            Ok(out.into())
        })();
        if result.is_err() {
            let _ = inner.machine.bus_mut().ram_mut().finish_dirty_epoch(false);
        }
        result
    }
    #[wasm_bindgen(js_name=seedExactGpuRam)]
    pub fn seed_exact_gpu_ram(&self, native: &[u8], renderer_digest: &[u8]) -> Result<(), JsError> {
        let digest = renderer_digest
            .try_into()
            .map_err(|_| JsError::new("GPU renderer digest"))?;
        let mut inner = self.inner.try_borrow_mut().map_err(|_| reentrant())?;
        if !inner.exact_gpu
            || inner.exact_session != Some(true)
            || inner.exact_driver.is_some()
            || inner.machine.session_sources_active()
        {
            return Err(JsError::new("fresh GPU RAM candidate required"));
        }
        inner
            .machine
            .seed_gpu_session_ram_from_full_resume(native, digest)
            .map_err(gpu_error)
    }
}

/// Decode the small native envelope before durable publication or replay admission.
#[wasm_bindgen(js_name=sessionGpuResultInfo)]
pub fn session_gpu_result_info(bytes: &[u8]) -> Result<JsValue, JsError> {
    use wasm_vm_core::session_gpu::{GpuResult, ResultKind};
    let result = GpuResult::decode(bytes).map_err(gpu_error)?;
    let (kind, length, exchange, failed, reference) = match result.kind {
        ResultKind::Gather {
            exchange, expected, ..
        } => (1, expected.length, exchange.exchange_sequence, false, None),
        ResultKind::Scatter {
            exchange, payload, ..
        } => (
            2,
            payload.length,
            exchange.exchange_sequence,
            false,
            Some(payload),
        ),
        ResultKind::Complete(c) => (3, 0, c.exchange_sequence, c.outcome.is_err(), None),
    };
    let out = js_sys::Object::new();
    for (key, value) in [
        ("kind", JsValue::from(kind)),
        ("length", length.into()),
        ("exchange", exchange.to_string().into()),
        ("failed", failed.into()),
    ] {
        set(&out, key, value).map_err(|_| JsError::new("GPU result metadata"))?;
    }
    if let Some(reference) = reference {
        set(&out, "sha256", owned(&reference.sha256))
            .map_err(|_| JsError::new("GPU result reference"))?;
    }
    Ok(out.into())
}

fn exact_gpu_topology() -> Result<String, JsError> {
    use wasm_vm_core::{platform::virt, session_profile::AGENT_SLOT};
    let mut entries: Vec<serde_json::Value> =
        serde_json::from_str(&crate::session_checkpoint::software_checkpoint_topology())
            .map_err(gpu_error)?;
    for entry in &mut entries {
        if entry["kind"] == "virtio-gpu2d" {
            entry["kind"] = "virtio-gpu3d".into();
        }
        if entry["kind"] == "virtio-console" {
            entry["id"] = format!("slot{AGENT_SLOT}").into();
            entry["mmio_base"] = (virt::VIRTIO_BASE + AGENT_SLOT as u64 * virt::VIRTIO_STRIDE)
                .to_string()
                .into();
            entry["irq"] = (virt::VIRTIO_IRQ_BASE + AGENT_SLOT as u32).into();
        }
    }
    serde_json::to_string(&entries).map_err(gpu_error)
}

/// Installed exact GPU identity, without constructing or restoring a machine.
#[wasm_bindgen(js_name = sessionExactGpuIdentity)]
pub fn session_exact_gpu_identity() -> Result<String, JsError> {
    let topology: serde_json::Value =
        serde_json::from_str(&exact_gpu_topology()?).map_err(gpu_error)?;
    serde_json::to_string(&serde_json::json!({
        "version": 1, "coreHash": crate::build_core_hash().iter().map(|b| format!("{b:02x}")).collect::<String>(),
        "devices": topology,
    })).map_err(gpu_error)
}
