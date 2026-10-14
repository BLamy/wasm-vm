//! Production host installation and exact retained DMA methods.
use super::*;
use crate::virgl_host::*;
use js_sys::{Function, Uint8Array};
use wasm_vm_core::dev::virtio::gpu::submit3d::{Submit3dCompletion, Submit3dMailbox};
#[wasm_bindgen]
impl WasmLinux {
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
        inner
            .machine
            .attach_qualified_virgl(
                Box::new(JsControlSink(callback.clone())),
                Box::new(crate::virgl_host::scanout::JsScanoutSink(JsSubmitSink(
                    callback,
                ))),
                mailbox.clone(),
                caps,
            )
            .map_err(JsError::new)?;
        *self.gpu_mailbox.try_borrow_mut().map_err(|_| reentrant())? = Some(mailbox);
        Ok(())
    }
    #[wasm_bindgen(js_name = invalidateVirgl)]
    pub fn invalidate_virgl(&self) -> Result<(), JsError> {
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
        let records = state.command_trace().iter().map(|r| format!("{{\"sequence\":{},\"type\":{},\"response\":{},\"responseLength\":{},\"avail\":{},\"used\":{},\"head\":{},\"resourceId\":{},\"backingEntries\":{}}}",r.sequence,r.command_type,r.response_type,r.response_len,r.avail_idx,r.used_idx,r.used_head,r.resource_id.map_or("null".into(),|v|v.to_string()),r.backing_entries.map_or("null".into(),|v|v.to_string()))).collect::<Vec<_>>().join(",");
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
