//! Production host installation and exact retained DMA methods.
use super::*;
use crate::virgl_host::*;
use js_sys::{Function, Uint8Array};
use wasm_vm_core::dev::virtio::gpu::submit3d::{Submit3dCompletion, Submit3dMailbox};
#[wasm_bindgen]
impl WasmLinux {
    /// Fresh one-GiB, pure ICount/64 GPU session. Historical paced profiles do not enter here.
    /// This uses the production Linux platform assembly, including owned I/O providers.
    #[wasm_bindgen(js_name = newExactGpuSession)]
    pub fn new_exact_gpu_session(
        kernel: &[u8],
        manifest_json: &str,
        bootargs: String,
        output: Function,
        replay: bool,
    ) -> Result<WasmLinux, JsError> {
        Self::new_gpu_session_mode(
            kernel,
            manifest_json,
            bootargs,
            output,
            if replay {
                wasm_vm_core::session_profile::ExecutionMode::Replay
            } else {
                wasm_vm_core::session_profile::ExecutionMode::Record
            },
        )
    }

    /// Same one-GiB pure ICount/64 owned-provider profile without a recorder.
    #[wasm_bindgen(js_name = newUnrecordedGpuSession)]
    pub fn new_unrecorded_gpu_session(
        kernel: &[u8],
        manifest_json: &str,
        bootargs: String,
        output: Function,
    ) -> Result<WasmLinux, JsError> {
        Self::new_gpu_session_mode(
            kernel,
            manifest_json,
            bootargs,
            output,
            wasm_vm_core::session_profile::ExecutionMode::LiveUnrecorded,
        )
    }

    fn new_gpu_session_mode(
        kernel: &[u8],
        manifest_json: &str,
        bootargs: String,
        output: Function,
        mode: wasm_vm_core::session_profile::ExecutionMode,
    ) -> Result<WasmLinux, JsError> {
        if kernel.is_empty() || kernel.len() > 64 << 20 || bootargs.len() > 4096 {
            return Err(JsError::new("exact GPU boot asset bounds"));
        }
        let manifest = wasm_vm_storage::ImageManifest::from_json(manifest_json)
            .map_err(|e| JsError::new(&format!("exact GPU base manifest: {e:?}")))?;
        Self::assemble(
            1024,
            kernel,
            None,
            DiskChoice::ExactSession {
                manifest,
                mode,
                gpu: true,
            },
            &bootargs,
            output,
            false,
        )
    }

    #[wasm_bindgen(js_name = attachVirgl)]
    pub fn attach_virgl(
        &self,
        host_words: &[u32],
        format_roles: &[u32],
        renderer: &str,
        callback: Function,
    ) -> Result<(), JsError> {
        let caps = qualified_capabilities(host_words, format_roles, renderer)?;
        let mailbox = Submit3dMailbox::new();
        let mut inner = self.inner.try_borrow_mut().map_err(|_| reentrant())?;
        if inner.machine.live_unrecorded_work().is_some() && !inner.exact_gpu {
            return Err(JsError::new(
                "unrecorded software profile cannot attach an accelerated GPU",
            ));
        }
        if inner
            .machine
            .live_unrecorded_work()
            .is_some_and(|work| work.transitions != 0)
        {
            return Err(JsError::new(
                "unrecorded GPU transport must attach before execution",
            ));
        }
        inner
            .machine
            .attach_qualified_virgl(
                Box::new(JsControlSink(callback.clone())),
                Box::new(crate::virgl_host::scanout::JsScanoutSink(
                    JsSubmitSink::for_machine(
                        callback,
                        crate::virgl_session_transport::MachineGpuOwner {
                            machine: std::rc::Rc::downgrade(&self.inner),
                            stopped: self.gpu_session_stopped.clone(),
                        },
                    ),
                )),
                mailbox.clone(),
                caps,
            )
            .map_err(JsError::new)?;
        if inner.exact_gpu && inner.exact_session == Some(false) {
            inner
                .machine
                .enable_session_gpu_results(false)
                .map_err(|e| JsError::new(&format!("gpu_session_results: {e:?}")))?;
        }
        if inner.machine.live_unrecorded_work().is_some() {
            inner
                .machine
                .enable_live_unrecorded_gpu_transport()
                .map_err(transport_error)?;
        }
        // Only successful attachment stamps the ephemeral disk's checkpoint identity.
        // Ordinary software construction keeps its legacy behavior.
        if inner.resume_base.is_none()
            && let Some(fetch) = &inner.fetch
        {
            let base = fetch.manifest.base_hash();
            let generation = inner.machine.overlay_generation();
            inner.machine.set_snapshot_identity_with_generation(
                build_core_hash(),
                base,
                generation,
            );
            inner.resume_base = Some(base);
        }
        *self.gpu_mailbox.try_borrow_mut().map_err(|_| reentrant())? = Some(mailbox);
        Ok(())
    }
    /// Drain original queued GPU work while paused, without executing another guest instruction.
    #[wasm_bindgen(js_name = drainGpuCheckpointBoundary)]
    pub fn drain_gpu_checkpoint_boundary(&self) -> Result<bool, JsError> {
        self.inner
            .try_borrow_mut()
            .map_err(|_| reentrant())?
            .machine
            .drain_accelerated_checkpoint_boundary()
            .map_err(JsError::new)
    }

    /// Exact COW bytes from the same ephemeral disk backend used by the guest.
    /// Persistent and secondary-drive shapes explicitly remain outside this factory profile.
    #[wasm_bindgen(js_name = captureGpuDiskDelta)]
    pub fn capture_gpu_disk_delta(&self) -> Result<Uint8Array, JsError> {
        let mut inner = self.inner.try_borrow_mut().map_err(|_| reentrant())?;
        if inner.machine.live_unrecorded_work().is_some() {
            return Err(JsError::new("unrecorded control has no checkpoint history"));
        }
        inner
            .machine
            .quiesce()
            .map_err(|e| JsError::new(&format!("not_quiesced: {e:?}")))?;
        let disk = inner
            .checkpoint_disk
            .as_ref()
            .ok_or_else(|| JsError::new("gpu_checkpoint_unsupported_disk"))?;
        let delta = disk
            .snapshot_delta(inner.machine.overlay_generation())
            .map_err(|_| JsError::new("gpu_checkpoint_disk_busy_or_budget"))?;
        Ok(owned(&delta.to_bytes()))
    }

    #[wasm_bindgen(js_name = saveAcceleratedSnapshot)]
    pub fn save_accelerated_snapshot(&self, renderer_digest: &[u8]) -> Result<Uint8Array, JsError> {
        let witness: &[u8; 32] = renderer_digest
            .try_into()
            .map_err(|_| JsError::new("renderer digest must have32bytes"))?;
        let mut inner = self.inner.try_borrow_mut().map_err(|_| reentrant())?;
        inner.refuse_unrecorded_mutation()?;
        let blob = inner
            .machine
            .save_accelerated_resume(witness)
            .map_err(|e| JsError::new(&format!("gpu_checkpoint_save: {e:?}")))?;
        Ok(owned(&blob))
    }

    #[wasm_bindgen(js_name = loadAcceleratedSnapshotBlob)]
    pub fn load_accelerated_snapshot_blob(
        &self,
        blob: Vec<u8>,
        renderer_digest: &[u8],
    ) -> Result<JsValue, JsError> {
        let witness: &[u8; 32] = renderer_digest
            .try_into()
            .map_err(|_| JsError::new("renderer digest must have32bytes"))?;
        let mut inner = self.inner.try_borrow_mut().map_err(|_| reentrant())?;
        inner.refuse_unrecorded_mutation()?;
        let (saved, fresh) = inner
            .machine
            .load_accelerated_resume(&blob, witness)
            .map_err(|e| JsError::new(&format!("gpu_checkpoint_restore: {e:?}")))?;
        let result = js_sys::Object::new();
        set(&result, "savedEpoch", hex(saved))
            .map_err(|_| JsError::new("checkpoint epoch result"))?;
        set(&result, "freshEpoch", hex(fresh))
            .map_err(|_| JsError::new("checkpoint epoch result"))?;
        Ok(result.into())
    }

    #[wasm_bindgen(js_name = invalidateVirgl)]
    pub fn invalidate_virgl(&self) -> Result<(), JsError> {
        {
            let mut inner = self.inner.try_borrow_mut().map_err(|_| reentrant())?;
            if inner.exact_gpu {
                self.gpu_session_stopped.set(true);
                if let Some(capture) = &mut inner.input_capture {
                    capture.stopped = true;
                }
                inner.finished = Some("gpu_session_context_lost".into());
                return Err(JsError::new(
                    "gpu_session_context_lost: stopped before unrecorded guest mutation",
                ));
            }
        }
        {
            let inner = self.inner.try_borrow().map_err(|_| reentrant())?;
            let (_, gpu) = inner
                .machine
                .virtio_gpu()
                .ok_or_else(|| JsError::new("GPU unavailable"))?;
            gpu.try_borrow_mut()
                .map_err(|_| reentrant())?
                .invalidate_renderer_qualification();
        }
        if let Some(mailbox) = self
            .gpu_mailbox
            .try_borrow()
            .map_err(|_| reentrant())?
            .as_ref()
        {
            let snapshot = mailbox.inspect();
            if let Some(key) = snapshot.active.filter(|_| !snapshot.ready) {
                mailbox.post(Submit3dCompletion{key,exchange_sequence:snapshot.last_exchange,outcome:Err(wasm_vm_core::dev::virtio::gpu::control3d::Control3dError::BridgePoisoned),gpu_complete:false,applied_commands:0,draws:0}).map_err(transport_error)?;
            }
        }
        Ok(())
    }
    #[wasm_bindgen(js_name = enableGpuCommandTrace)]
    pub fn enable_gpu_command_trace(&self) -> Result<(), JsError> {
        let inner = self.inner.try_borrow().map_err(|_| reentrant())?;
        inner.refuse_unrecorded_mutation()?;
        let (_, gpu) = inner
            .machine
            .virtio_gpu()
            .ok_or_else(|| JsError::new("GPU unavailable"))?;
        gpu.try_borrow_mut()
            .map_err(|_| reentrant())?
            .enable_command_trace();
        Ok(())
    }
    #[wasm_bindgen(js_name = gpuCommandTrace)]
    pub fn gpu_command_trace(&self) -> Result<String, JsError> {
        let inner = self.inner.try_borrow().map_err(|_| reentrant())?;
        let (_, gpu) = inner
            .machine
            .virtio_gpu()
            .ok_or_else(|| JsError::new("GPU unavailable"))?;
        let state = gpu.try_borrow().map_err(|_| reentrant())?;
        let records = state.command_trace().iter().map(|r| format!("{{\"sequence\":{},\"type\":{},\"response\":{},\"responseLength\":{},\"avail\":{},\"used\":{},\"head\":{},\"resourceId\":{},\"backingEntries\":{},\"transferWords\":{}}}",r.sequence,r.command_type,r.response_type,r.response_len,r.avail_idx,r.used_idx,r.used_head,r.resource_id.map_or("null".into(),|v|v.to_string()),r.backing_entries.map_or("null".into(),|v|v.to_string()),r.transfer_words.map_or("null".into(),|words|format!("{:?}",words)))).collect::<Vec<_>>().join(",");
        Ok(format!(
            "{{\"dropped\":{},\"records\":[{}]}}",
            state.command_trace_dropped(),
            records
        ))
    }
    /// Exact identities and row arithmetic are validated by core before RAM access.
    #[allow(clippy::too_many_arguments)]
    #[wasm_bindgen(js_name = gatherInput)]
    pub fn gather_input(
        &self,
        epoch: &str,
        sequence: &str,
        exchange_sequence: &str,
        resource_id: u32,
        resource_generation: &str,
        backing_generation: &str,
        offset: &str,
        row_bytes: u32,
        row_stride: u32,
        row_count: u32,
    ) -> Result<Uint8Array, JsError> {
        let exchange = exchange(
            epoch,
            sequence,
            exchange_sequence,
            resource_id,
            resource_generation,
            backing_generation,
            offset,
            row_bytes,
            row_stride,
            row_count,
        )?;
        let mut inner = self
            .inner
            .try_borrow_mut()
            .map_err(|_| JsError::new("Reentrant GPU DMA access"))?;
        if inner.exact_gpu || inner.machine.live_unrecorded_work().is_some() {
            return Err(JsError::new("owned GPU request transport required"));
        }
        let bytes = inner
            .machine
            .submit3d_gather(&exchange)
            .map_err(transport_error)?;
        Ok(owned(&bytes))
    }

    #[allow(clippy::too_many_arguments)]
    #[wasm_bindgen(js_name = scatterOutput)]
    pub fn scatter_output(
        &self,
        epoch: &str,
        sequence: &str,
        exchange_sequence: &str,
        resource_id: u32,
        resource_generation: &str,
        backing_generation: &str,
        offset: &str,
        row_bytes: u32,
        row_stride: u32,
        row_count: u32,
        bytes: &[u8],
    ) -> Result<(), JsError> {
        let exchange = exchange(
            epoch,
            sequence,
            exchange_sequence,
            resource_id,
            resource_generation,
            backing_generation,
            offset,
            row_bytes,
            row_stride,
            row_count,
        )?;
        let mut inner = self
            .inner
            .try_borrow_mut()
            .map_err(|_| JsError::new("Reentrant GPU DMA access"))?;
        if inner.exact_gpu || inner.machine.live_unrecorded_work().is_some() {
            return Err(JsError::new("owned GPU request transport required"));
        }
        inner
            .machine
            .submit3d_scatter(&exchange, bytes)
            .map_err(transport_error)
    }

    #[allow(clippy::too_many_arguments)]
    #[wasm_bindgen(js_name = gatherLayeredInput)]
    pub fn gather_layered_input(
        &self,
        epoch: &str,
        sequence: &str,
        exchange_sequence: &str,
        resource_id: u32,
        resource_generation: &str,
        backing_generation: &str,
        offset: &str,
        row_bytes: u32,
        row_stride: u32,
        row_count: u32,
        layer_stride: u32,
        layer_count: u32,
    ) -> Result<Uint8Array, JsError> {
        let exchange = exchange(
            epoch,
            sequence,
            exchange_sequence,
            resource_id,
            resource_generation,
            backing_generation,
            offset,
            row_bytes,
            row_stride,
            row_count,
        )?;
        let mut inner = self
            .inner
            .try_borrow_mut()
            .map_err(|_| JsError::new("Reentrant GPU DMA access"))?;
        if inner.exact_gpu || inner.machine.live_unrecorded_work().is_some() {
            return Err(JsError::new("owned GPU request transport required"));
        }
        let bytes = inner
            .machine
            .submit3d_gather_layered(&exchange, layer_stride, layer_count)
            .map_err(transport_error)?;
        Ok(owned(&bytes))
    }

    #[allow(clippy::too_many_arguments)]
    #[wasm_bindgen(js_name = scatterLayeredOutput)]
    pub fn scatter_layered_output(
        &self,
        epoch: &str,
        sequence: &str,
        exchange_sequence: &str,
        resource_id: u32,
        resource_generation: &str,
        backing_generation: &str,
        offset: &str,
        row_bytes: u32,
        row_stride: u32,
        row_count: u32,
        layer_stride: u32,
        layer_count: u32,
        bytes: &[u8],
    ) -> Result<(), JsError> {
        let exchange = exchange(
            epoch,
            sequence,
            exchange_sequence,
            resource_id,
            resource_generation,
            backing_generation,
            offset,
            row_bytes,
            row_stride,
            row_count,
        )?;
        let mut inner = self
            .inner
            .try_borrow_mut()
            .map_err(|_| JsError::new("Reentrant GPU DMA access"))?;
        if inner.exact_gpu || inner.machine.live_unrecorded_work().is_some() {
            return Err(JsError::new("owned GPU request transport required"));
        }
        inner
            .machine
            .submit3d_scatter_layered(&exchange, layer_stride, layer_count, bytes)
            .map_err(transport_error)
    }

    /// This deliberately borrows only the independent mailbox. It can be called
    /// synchronously by begin_job while Machine/GpuState are already borrowed.
    #[allow(clippy::too_many_arguments)]
    pub fn complete(
        &self,
        epoch: &str,
        sequence: &str,
        exchange_sequence: &str,
        outcome_code: u32,
        gpu_complete: bool,
        applied_commands: u32,
        draws: u32,
    ) -> Result<(), JsError> {
        if outcome_code > 6 {
            return Err(JsError::new("Invalid completion outcome"));
        }
        self.gpu_mailbox
            .try_borrow()
            .map_err(|_| reentrant())?
            .as_ref()
            .ok_or_else(|| JsError::new("GPU renderer is not attached"))?
            .post(Submit3dCompletion {
                key: request_key(epoch, sequence)?,
                exchange_sequence: address(exchange_sequence)?,
                outcome: control_result(outcome_code),
                gpu_complete,
                applied_commands,
                draws,
            })
            .map_err(transport_error)
    }
}
