//! Explicit scanout fixture. Rendering and DMA still use the core's owned queue;
//! the browser separately records acceptance and actual canvas presentation.

use super::*;
use js_sys::Uint32Array;
use wasm_vm_core::dev::virtio::gpu::scanout3d::{
    Scanout3dBinding, Scanout3dEvent, Scanout3dRequest, Scanout3dTarget,
};
use wasm_vm_core::dev::virtio::gpu::{FrameSink, Rect};

fn rectangle(rect: Rect) -> Result<Object, JsValue> {
    let out = Object::new();
    for (key, value) in [
        ("x", rect.x),
        ("y", rect.y),
        ("width", rect.width),
        ("height", rect.height),
    ] {
        set(&out, key, value)?;
    }
    Ok(out)
}

fn binding(value: &Scanout3dBinding) -> Result<Object, JsValue> {
    let out = Object::new();
    set(&out, "generation", hex(value.generation))?;
    set(&out, "rect", rectangle(value.rect)?)?;
    let target = Object::new();
    match &value.target {
        Scanout3dTarget::Disabled => set(&target, "kind", "disabled")?,
        Scanout3dTarget::TwoD {
            resource_id,
            format,
            width,
            height,
        } => {
            set(&target, "kind", "2d")?;
            for (key, value) in [
                ("resourceId", *resource_id),
                ("format", *format),
                ("width", *width),
                ("height", *height),
            ] {
                set(&target, key, value)?;
            }
        }
        Scanout3dTarget::Renderer {
            resource,
            metadata: meta,
        } => {
            set(&target, "kind", "renderer")?;
            set(&target, "resource", id(*resource)?)?;
            set(&target, "metadata", metadata(*meta)?)?;
        }
    }
    set(&out, "target", target)?;
    Ok(out)
}

struct JsScanoutSink(JsSubmitSink);

impl Submit3dSink for JsScanoutSink {
    fn begin_job(&mut self, request: &Submit3dRequest) -> Result<(), Control3dError> {
        self.0.begin_job(request)
    }

    fn cancel_job(&mut self, key: Submit3dKey) -> Result<(), Control3dError> {
        self.0.cancel_job(key)
    }

    fn bind_scanout(&mut self, event: &Scanout3dEvent) -> Result<(), Control3dError> {
        let out = (|| {
            let out = Object::new();
            set(&out, "type", "bindScanout")?;
            set(&out, "epoch", hex(event.epoch))?;
            set(&out, "binding", binding(&event.binding)?)?;
            Ok::<_, JsValue>(out)
        })()
        .map_err(|_| Control3dError::BridgePoisoned)?;
        control_result(invoke(&self.0.0, &out))
    }

    fn begin_scanout(&mut self, request: &Scanout3dRequest) -> Result<(), Control3dError> {
        let out = (|| {
            let out = Object::new();
            set(&out, "type", "beginScanout")?;
            set(&out, "epoch", hex(request.key.epoch))?;
            set(&out, "sequence", hex(request.key.sequence))?;
            set(&out, "binding", binding(&request.binding)?)?;
            let header = Object::new();
            set(&header, "type", request.header.ty)?;
            set(&header, "flags", request.header.flags)?;
            set(&header, "fenceId", hex(request.header.fence_id))?;
            set(&header, "contextId", request.header.ctx_id)?;
            set(&header, "ringIndex", u32::from(request.header.ring_idx))?;
            set(&out, "header", header)?;
            Ok::<_, JsValue>(out)
        })()
        .map_err(|_| Control3dError::BridgePoisoned)?;
        control_result(invoke(&self.0.0, &out))
    }
}

#[derive(Default)]
struct FrameDiagnostics {
    accepted: u64,
    rejected: u64,
    last_error: Option<Control3dError>,
}

struct ProofFrameSink {
    callback: Function,
    diagnostics: Rc<RefCell<FrameDiagnostics>>,
}

impl FrameSink for ProofFrameSink {
    fn flush(
        &mut self,
        scanout: Option<u32>,
        format: u32,
        rect: Rect,
        resource_width: u32,
        resource_height: u32,
        pixels: &[u32],
    ) {
        let result = (|| {
            let frame = Object::new();
            set(
                &frame,
                "scanout",
                scanout.map_or(JsValue::NULL, JsValue::from),
            )?;
            set(&frame, "format", format)?;
            set(&frame, "rect", rectangle(rect)?)?;
            set(&frame, "resourceWidth", resource_width)?;
            set(&frame, "resourceHeight", resource_height)?;
            // The callback is synchronous and copies before returning. Never retain this view
            // in a queued frame; the bridge owns the epoch/binding stamp at this call boundary.
            set(&frame, "pixels", unsafe { Uint32Array::view(pixels) })?;
            Ok::<_, JsValue>(control_result(invoke(&self.callback, &frame)))
        })()
        .unwrap_or(Err(Control3dError::BridgePoisoned));
        let mut diagnostics = self.diagnostics.borrow_mut();
        match result {
            Ok(()) => diagnostics.accepted = diagnostics.accepted.saturating_add(1),
            Err(error) => {
                diagnostics.rejected = diagnostics.rejected.saturating_add(1);
                diagnostics.last_error = Some(error);
            }
        }
    }

    fn clear(&mut self) {
        // Proof snapshots cannot be restored. Device reset is delivered through the typed
        // control bridge, which revokes the presenter and its retained recovery frame.
    }
}

/// Exported only by explicit proof builds. Production constructors remain unchanged.
#[wasm_bindgen]
pub struct WasmVirglScanoutProof {
    submit: WasmVirglSubmitProof,
    frames: Rc<RefCell<FrameDiagnostics>>,
}

#[wasm_bindgen]
impl WasmVirglScanoutProof {
    #[wasm_bindgen(constructor)]
    pub fn new(
        callback: Function,
        frame_callback: Function,
        proof_enabled: bool,
    ) -> Result<WasmVirglScanoutProof, JsError> {
        let mut machine = Machine::new(RAM_BYTES);
        machine.enable_plic();
        machine.enable_virtio_slots(None);
        let mailbox = Submit3dMailbox::new();
        let frames = Rc::new(RefCell::new(FrameDiagnostics::default()));
        let frame_sink = Box::new(ProofFrameSink {
            callback: frame_callback,
            diagnostics: frames.clone(),
        });
        let (_, gpu) = if proof_enabled {
            machine.enable_virtio_gpu_scanout3d_proof(
                frame_sink,
                Box::new(JsControlSink(callback.clone())),
                Box::new(JsScanoutSink(JsSubmitSink(callback))),
                mailbox.clone(),
            )
        } else {
            machine.enable_virtio_gpu(frame_sink)
        }
        .ok_or_else(|| JsError::new("No GPU slot available"))?;
        gpu.borrow_mut().enable_command_trace();
        let base = Platform::virtio_base(machine.virtio_gpu().expect("GPU installed").0 as u64);
        machine
            .bus_mut()
            .store32(virt::KERNEL_BASE, 0x0000_006f)
            .map_err(|_| JsError::new("Cannot seed proof hart"))?;
        machine.hart_mut().regs.pc = virt::KERNEL_BASE;
        Ok(Self {
            submit: WasmVirglSubmitProof {
                inner: WasmVirglControlProof {
                    machine: RefCell::new(machine),
                    gpu,
                    base,
                },
                mailbox,
            },
            frames,
        })
    }

    pub fn layout(&self) -> Result<JsValue, JsError> {
        self.submit.layout()
    }

    #[wasm_bindgen(js_name = writeRam)]
    pub fn write_ram(&self, addr: &str, bytes: &[u8]) -> Result<(), JsError> {
        self.submit.write_ram(addr, bytes)
    }

    #[wasm_bindgen(js_name = readRam)]
    pub fn read_ram(&self, addr: &str, length: u32) -> Result<Uint8Array, JsError> {
        self.submit.read_ram(addr, length)
    }

    #[wasm_bindgen(js_name = writeMmio)]
    pub fn write_mmio(&self, offset: u32, value: u32) -> Result<(), JsError> {
        self.submit.write_mmio(offset, value)
    }

    #[wasm_bindgen(js_name = readMmio)]
    pub fn read_mmio(&self, offset: u32) -> Result<u32, JsError> {
        self.submit.read_mmio(offset)
    }

    pub fn run1(&self) -> Result<JsValue, JsError> {
        self.submit.run1()
    }

    pub fn inspect(&self) -> Result<JsValue, JsError> {
        self.submit.inspect()
    }

    #[wasm_bindgen(js_name = machineDigest)]
    pub fn machine_digest(&self) -> Result<String, JsError> {
        self.submit.machine_digest()
    }

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
        self.submit.gather_input(
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
        )
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
        self.submit.scatter_output(
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
            bytes,
        )
    }

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
        self.submit.complete(
            epoch,
            sequence,
            exchange_sequence,
            outcome_code,
            gpu_complete,
            applied_commands,
            draws,
        )
    }

    #[wasm_bindgen(js_name = submitInspect)]
    pub fn submit_inspect(&self) -> Result<JsValue, JsError> {
        self.submit.submit_inspect()
    }

    #[wasm_bindgen(js_name = submitState)]
    pub fn submit_state(&self) -> Result<JsValue, JsError> {
        self.submit.submit_state()
    }

    #[wasm_bindgen(js_name = commandTrace)]
    pub fn command_trace(&self) -> Result<JsValue, JsError> {
        self.submit.command_trace()
    }

    #[wasm_bindgen(js_name = scanoutState)]
    pub fn scanout_state(&self) -> Result<JsValue, JsError> {
        let _machine = self
            .submit
            .inner
            .machine
            .try_borrow_mut()
            .map_err(|_| JsError::new("Reentrant proof access"))?;
        let state = self
            .submit
            .inner
            .gpu
            .try_borrow()
            .map_err(|_| JsError::new("Reentrant GPU access"))?;
        let Some(snapshot) = state.scanout3d_snapshot() else {
            return Ok(JsValue::NULL);
        };
        let out = Object::new();
        set(&out, "canonicalBytes", owned(&snapshot.canonical_bytes())).map_err(js_error)?;
        set(&out, "digest", snapshot.hex_digest()).map_err(js_error)?;
        set(&out, "nextGeneration", hex(snapshot.next_generation)).map_err(js_error)?;
        let current = snapshot
            .binding
            .as_ref()
            .map(binding)
            .transpose()
            .map_err(js_error)?
            .map_or(JsValue::NULL, JsValue::from);
        set(&out, "binding", current).map_err(js_error)?;
        let counters = Object::new();
        let c = snapshot.counters;
        for (key, value) in [
            ("bindings", c.bindings),
            ("capturesAdmitted", c.captures_admitted),
            ("capturesCompleted", c.captures_completed),
            ("capturesFailed", c.captures_failed),
            ("acceptedBytes", c.accepted_bytes),
            ("completedBytes", c.completed_bytes),
        ] {
            set(&counters, key, hex(value)).map_err(js_error)?;
        }
        set(&out, "counters", counters).map_err(js_error)?;
        Ok(out.into())
    }

    #[wasm_bindgen(js_name = frameDiagnostics)]
    pub fn frame_diagnostics(&self) -> Result<JsValue, JsError> {
        let value = self
            .frames
            .try_borrow()
            .map_err(|_| JsError::new("Reentrant frame diagnostics"))?;
        let out = Object::new();
        set(&out, "accepted", hex(value.accepted)).map_err(js_error)?;
        set(&out, "rejected", hex(value.rejected)).map_err(js_error)?;
        set(
            &out,
            "lastError",
            value
                .last_error
                .map_or(JsValue::NULL, |error| JsValue::from_str(error.code())),
        )
        .map_err(js_error)?;
        Ok(out.into())
    }
}
