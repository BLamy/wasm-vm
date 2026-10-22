//! Request-owned host capability. Numeric identities never grant DMA authority.
use crate::{LinuxInner, virgl_host::*};
use std::{cell::RefCell, rc::Weak};
use wasm_bindgen::prelude::*;
use wasm_vm_core::{
    dev::virtio::gpu::submit3d::{Submit3dCompletion, Submit3dCompletionLease, Submit3dExchange},
    session_gpu::GpuError,
};

/// Minted only by the original native submission. It cannot be constructed from JS,
/// retargeted to another VM, or serialized into a session checkpoint.
#[derive(Clone)]
pub(crate) struct MachineGpuOwner {
    pub machine: Weak<RefCell<LinuxInner>>,
    pub stopped: std::rc::Rc<core::cell::Cell<bool>>,
}
#[wasm_bindgen]
pub struct WasmGpuTransport {
    owner: MachineGpuOwner,
    lease: Submit3dCompletionLease,
}
impl WasmGpuTransport {
    pub(crate) fn new(owner: MachineGpuOwner, lease: Submit3dCompletionLease) -> Self {
        Self { owner, lease }
    }
    fn dma(
        &self,
        exchange: &Submit3dExchange,
        output: Option<&[u8]>,
        layers: Option<(u32, u32)>,
    ) -> Result<JsValue, JsError> {
        if self.owner.stopped.get() {
            return Err(JsError::new("gpu_session_context_lost"));
        }
        self.lease.authorize_transport().map_err(transport_error)?;
        if exchange.key != self.lease.key() {
            return Err(JsError::new("stale GPU request owner"));
        }
        let owner = self
            .owner
            .machine
            .upgrade()
            .ok_or_else(|| JsError::new("GPU request owner was disposed"))?;
        let mut inner = owner
            .try_borrow_mut()
            .map_err(|_| JsError::new("Reentrant GPU DMA access"))?;
        if inner.machine.live_unrecorded_work().is_some() {
            let bytes = inner
                .machine
                .live_unrecorded_gpu_dma(exchange, output, layers)
                .map_err(transport_error)?;
            return if output.is_some() {
                Ok(JsValue::UNDEFINED)
            } else {
                Ok(owned(&bytes).into())
            };
        }
        let replay = inner.machine.session_gpu_replay().map_err(gpu_error)?;
        let result = if replay {
            inner
                .machine
                .replay_session_gpu_transport(exchange, output, layers)
        } else {
            inner.machine.session_gpu_dma(exchange, output, layers)
        };
        match result {
            // Only this owned transport has a retry result; no legacy error becomes success.
            Err(GpuError::PhysicalPending) if replay => Ok(JsValue::NULL),
            Err(error) => Err(gpu_error(error)),
            Ok(_) if output.is_some() => Ok(JsValue::UNDEFINED),
            Ok(bytes) => Ok(owned(&bytes).into()),
        }
    }
}
fn gpu_error(error: GpuError) -> JsError {
    JsError::new(&format!("gpu_session_transport: {error:?}"))
}

#[wasm_bindgen]
impl WasmGpuTransport {
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
    ) -> Result<JsValue, JsError> {
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
        self.dma(&exchange, None, None)
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
    ) -> Result<JsValue, JsError> {
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
        self.dma(&exchange, Some(bytes), None)
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
    ) -> Result<JsValue, JsError> {
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
        self.dma(&exchange, None, Some((layer_stride, layer_count)))
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
    ) -> Result<JsValue, JsError> {
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
        self.dma(&exchange, Some(bytes), Some((layer_stride, layer_count)))
    }

    /// Does not borrow Machine: a sink may complete synchronously during dispatch.
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
        if outcome_code > 6 || request_key(epoch, sequence)? != self.lease.key() {
            return Err(JsError::new("Invalid owned GPU completion"));
        }
        if self.owner.stopped.get() || self.owner.machine.upgrade().is_none() {
            return Err(JsError::new("GPU request owner was disposed"));
        }
        self.lease
            .post(Submit3dCompletion {
                key: self.lease.key(),
                exchange_sequence: address(exchange_sequence)?,
                outcome: control_result(outcome_code),
                gpu_complete,
                applied_commands,
                draws,
            })
            .map_err(transport_error)
    }
}
