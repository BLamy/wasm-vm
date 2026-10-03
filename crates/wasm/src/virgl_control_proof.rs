//! Proof-only control and submission marshalling. Tests write actual guest descriptors and
//! drive Machine::run; protocol decoding, ring service and DMA validation remain in core.
use core::cell::RefCell;
use std::rc::Rc;

use js_sys::{Array, Function, Object, Reflect, Uint8Array};
use wasm_bindgen::prelude::*;
use wasm_vm_core::Machine;
use wasm_vm_core::bus::Bus;
use wasm_vm_core::dev::virtio::gpu::control3d::{
    Control3dError, Control3dEvent, Control3dId, Control3dOperation, Control3dSink,
    Resource3dMetadata,
};
use wasm_vm_core::dev::virtio::gpu::submit3d::{
    Submit3dBacking, Submit3dCompletion, Submit3dExchange, Submit3dKey, Submit3dKind,
    Submit3dMailbox, Submit3dRequest, Submit3dRows, Submit3dSink,
};
use wasm_vm_core::dev::virtio::gpu::{GpuState, NullSink};
use wasm_vm_core::platform::{Platform, virt};

const RAM_BYTES: usize = 4 * 1024 * 1024;

#[wasm_bindgen(inline_js = r#"
// Do not invoke result accessors or assimilate promises. The Rust sink is synchronous.
export function invokeVirglControl(callback, event) {
  try {
    const result = callback(event);
    const data = (value, keys) => {
      if (!value || typeof value !== 'object' || Array.isArray(value) || 'then' in value) throw 0;
      const fields = Object.getOwnPropertyDescriptors(value);
      if (Reflect.ownKeys(fields).length !== keys.length) throw 0;
      const out = {};
      for (const key of keys) {
        if (!Object.hasOwn(fields, key) || !Object.hasOwn(fields[key], 'value')) throw 0;
        out[key] = fields[key].value;
      }
      return out;
    };
    const descriptors = Object.getOwnPropertyDescriptors(result);
    if (Object.hasOwn(descriptors, 'ok') && Object.hasOwn(descriptors.ok, 'value') && descriptors.ok.value === true) {
      data(result, ['ok']); return 0;
    }
    const failed = data(result, ['ok', 'error']);
    if (failed.ok !== false) return 6;
    const error = data(failed.error, ['code', 'message']);
    if (typeof error.message !== 'string') return 6;
    const code = ['invalid-context-id', 'invalid-resource-id', 'invalid-parameter', 'out-of-memory', 'unspecified', 'bridge-poisoned'].indexOf(error.code);
    return code < 0 ? 6 : code + 1;
  } catch { return 6; }
}
"#)]
extern "C" {
    #[wasm_bindgen(js_name = invokeVirglControl)]
    fn invoke(callback: &Function, event: &JsValue) -> u32;
}

fn set(object: &Object, key: &str, value: impl Into<JsValue>) -> Result<(), JsValue> {
    if Reflect::set(object, &JsValue::from_str(key), &value.into())? {
        Ok(())
    } else {
        Err(JsValue::from_str("Cannot marshal control record"))
    }
}
fn hex(value: u64) -> String {
    format!("{value:016x}")
}
fn owned(bytes: &[u8]) -> Uint8Array {
    Uint8Array::from(bytes)
}
fn id(value: Control3dId) -> Result<Object, JsValue> {
    let out = Object::new();
    set(&out, "id", value.id)?;
    set(&out, "generation", hex(value.generation))?;
    Ok(out)
}
fn metadata(value: Resource3dMetadata) -> Result<Object, JsValue> {
    let out = Object::new();
    for (key, number) in [
        ("id", value.resource_id),
        ("target", value.target),
        ("format", value.format),
        ("bind", value.bind),
        ("width", value.width),
        ("height", value.height),
        ("depth", value.depth),
        ("arraySize", value.array_size),
        ("lastLevel", value.last_level),
        ("nrSamples", value.nr_samples),
        ("flags", value.flags),
    ] {
        set(&out, key, number)?;
    }
    Ok(out)
}
fn marshal(event: &Control3dEvent) -> Result<Object, JsValue> {
    let out = Object::new();
    set(&out, "epoch", hex(event.epoch))?;
    let name = match &event.operation {
        Control3dOperation::CreateContext {
            context,
            debug_name,
        } => {
            set(&out, "context", id(*context)?)?;
            set(&out, "debugName", owned(debug_name))?;
            "createContext"
        }
        Control3dOperation::DestroyContext { context } => {
            set(&out, "context", id(*context)?)?;
            "destroyContext"
        }
        Control3dOperation::CreateResource {
            resource,
            metadata: meta,
        } => {
            set(&out, "resource", id(*resource)?)?;
            set(&out, "metadata", metadata(*meta)?)?;
            "createResource"
        }
        Control3dOperation::AttachResource { context, resource }
        | Control3dOperation::DetachResource { context, resource } => {
            set(&out, "context", id(*context)?)?;
            set(&out, "resource", id(*resource)?)?;
            if matches!(event.operation, Control3dOperation::AttachResource { .. }) {
                "attachResource"
            } else {
                "detachResource"
            }
        }
        Control3dOperation::AttachBacking {
            resource,
            segments,
            backing_generation,
        } => {
            set(&out, "resource", id(*resource)?)?;
            set(&out, "backingGeneration", hex(*backing_generation))?;
            let entries = Array::new();
            for segment in segments {
                let entry = Object::new();
                set(&entry, "address", hex(segment.addr))?;
                set(&entry, "length", segment.length)?;
                set(&entry, "data", owned(&segment.bytes))?;
                entries.push(&entry);
            }
            set(&out, "segments", entries)?;
            "attachBacking"
        }
        Control3dOperation::DetachBacking {
            resource,
            backing_generation,
        } => {
            set(&out, "resource", id(*resource)?)?;
            set(&out, "backingGeneration", hex(*backing_generation))?;
            "detachBacking"
        }
        Control3dOperation::UnrefResource { resource } => {
            set(&out, "resource", id(*resource)?)?;
            "unrefResource"
        }
        Control3dOperation::Reset => "reset",
    };
    set(&out, "type", name)?;
    Ok(out)
}
struct JsControlSink(Function);
impl Control3dSink for JsControlSink {
    fn apply(&mut self, event: &Control3dEvent) -> Result<(), Control3dError> {
        let event = marshal(event).map_err(|_| Control3dError::BridgePoisoned)?;
        control_result(invoke(&self.0, &event))
    }
}

fn marshal_submission(request: &Submit3dRequest) -> Result<Object, JsValue> {
    let out = Object::new();
    set(&out, "type", "beginJob")?;
    set(&out, "epoch", hex(request.key.epoch))?;
    set(&out, "sequence", hex(request.key.sequence))?;
    set(&out, "context", id(request.context)?)?;
    let header = Object::new();
    set(&header, "type", request.header.ty)?;
    set(&header, "flags", request.header.flags)?;
    set(&header, "fenceId", hex(request.header.fence_id))?;
    set(&header, "contextId", request.header.ctx_id)?;
    set(&header, "ringIndex", request.header.ring_idx as u32)?;
    set(&out, "header", header)?;
    let resources = Array::new();
    for resource in &request.resources {
        let entry = Object::new();
        set(&entry, "identity", id(resource.identity)?)?;
        set(&entry, "metadata", metadata(resource.metadata)?)?;
        let backing = if let Some(backing) = &resource.backing {
            let value = Object::new();
            set(&value, "generation", hex(backing.generation))?;
            set(&value, "byteLength", backing.byte_length as f64)?;
            value.into()
        } else {
            JsValue::NULL
        };
        set(&entry, "backing", backing)?;
        resources.push(&entry);
    }
    set(&out, "resources", resources)?;
    match &request.kind {
        Submit3dKind::Commands(bytes) => {
            set(&out, "kind", "commands")?;
            set(&out, "commands", owned(bytes))?;
        }
        Submit3dKind::Transfer(value) => {
            set(&out, "kind", "transfer")?;
            let transfer = Object::new();
            let box_ = Object::new();
            for (key, number) in [
                ("x", value.box_.x),
                ("y", value.box_.y),
                ("z", value.box_.z),
                ("width", value.box_.width),
                ("height", value.box_.height),
                ("depth", value.box_.depth),
            ] {
                set(&box_, key, number)?;
            }
            set(&transfer, "box", box_)?;
            set(&transfer, "offset", hex(value.offset))?;
            for (key, number) in [
                ("resourceId", value.resource_id),
                ("level", value.level),
                ("stride", value.stride),
                ("layerStride", value.layer_stride),
                ("direction", value.direction),
            ] {
                set(&transfer, key, number)?;
            }
            set(&out, "transfer", transfer)?;
        }
    }
    Ok(out)
}

struct JsSubmitSink(Function);
impl Submit3dSink for JsSubmitSink {
    fn begin_job(&mut self, request: &Submit3dRequest) -> Result<(), Control3dError> {
        let event = marshal_submission(request).map_err(|_| Control3dError::BridgePoisoned)?;
        control_result(invoke(&self.0, &event))
    }

    fn cancel_job(&mut self, key: Submit3dKey) -> Result<(), Control3dError> {
        let event = Object::new();
        (|| {
            set(&event, "type", "cancelJob")?;
            set(&event, "epoch", hex(key.epoch))?;
            set(&event, "sequence", hex(key.sequence))
        })()
        .map_err(|_| Control3dError::BridgePoisoned)?;
        control_result(invoke(&self.0, &event))
    }
}
fn address(value: &str) -> Result<u64, JsError> {
    if value.len() != 16
        || !value
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
    {
        return Err(JsError::new(
            "Expected a 16-digit lowercase hexadecimal address",
        ));
    }
    u64::from_str_radix(value, 16).map_err(|_| JsError::new("Invalid u64 address"))
}
fn js_error(value: JsValue) -> JsError {
    JsError::new(&format!("Control marshalling failed: {value:?}"))
}

fn control_result(value: u32) -> Result<(), Control3dError> {
    match value {
        0 => Ok(()),
        1 => Err(Control3dError::InvalidContextId),
        2 => Err(Control3dError::InvalidResourceId),
        3 => Err(Control3dError::InvalidParameter),
        4 => Err(Control3dError::OutOfMemory),
        5 => Err(Control3dError::Unspecified),
        _ => Err(Control3dError::BridgePoisoned),
    }
}

fn transport_error(error: Control3dError) -> JsError {
    JsError::new(error.code())
}

fn request_key(epoch: &str, sequence: &str) -> Result<Submit3dKey, JsError> {
    Ok(Submit3dKey {
        epoch: address(epoch)?,
        sequence: address(sequence)?,
    })
}

#[allow(clippy::too_many_arguments)]
fn exchange(
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
) -> Result<Submit3dExchange, JsError> {
    Ok(Submit3dExchange {
        key: request_key(epoch, sequence)?,
        exchange_sequence: address(exchange_sequence)?,
        backing: Submit3dBacking {
            resource: Control3dId {
                id: resource_id,
                generation: address(resource_generation)?,
            },
            generation: address(backing_generation)?,
        },
        rows: Submit3dRows {
            offset: address(offset)?,
            row_bytes,
            row_stride,
            row_count,
        },
    })
}

/// Only emitted in explicit proof builds; ordinary construction still leaves VIRGL disabled.
#[wasm_bindgen]
pub struct WasmVirglControlProof {
    machine: RefCell<Machine>,
    gpu: Rc<RefCell<GpuState>>,
    base: u64,
}
#[wasm_bindgen]
impl WasmVirglControlProof {
    #[wasm_bindgen(constructor)]
    pub fn new(callback: Function, proof_enabled: bool) -> Result<WasmVirglControlProof, JsError> {
        let mut machine = Machine::new(RAM_BYTES);
        machine.enable_plic();
        machine.enable_virtio_slots(None);
        let (_, gpu) = if proof_enabled {
            machine.enable_virtio_gpu_control3d_proof(
                Box::new(NullSink),
                Box::new(JsControlSink(callback)),
            )
        } else {
            machine.enable_virtio_gpu(Box::new(NullSink))
        }
        .ok_or_else(|| JsError::new("No GPU slot available"))?;
        let base = Platform::virtio_base(machine.virtio_gpu().expect("GPU installed").0 as u64);
        machine
            .bus_mut()
            .store32(virt::KERNEL_BASE, 0x0000_006f)
            .map_err(|_| JsError::new("Cannot seed proof hart"))?;
        machine.hart_mut().regs.pc = virt::KERNEL_BASE;
        Ok(Self {
            machine: RefCell::new(machine),
            gpu,
            base,
        })
    }
    pub fn layout(&self) -> Result<JsValue, JsError> {
        let out = Object::new();
        set(&out, "ramBase", hex(virt::DRAM_BASE)).map_err(js_error)?;
        set(&out, "ramBytes", RAM_BYTES as u32).map_err(js_error)?;
        set(&out, "gpuBase", hex(self.base)).map_err(js_error)?;
        Ok(out.into())
    }
    #[wasm_bindgen(js_name = writeRam)]
    pub fn write_ram(&self, addr: &str, bytes: &[u8]) -> Result<(), JsError> {
        let mut machine = self
            .machine
            .try_borrow_mut()
            .map_err(|_| JsError::new("Reentrant proof access"))?;
        if bytes.len() > RAM_BYTES {
            return Err(JsError::new("RAM write exceeds fixture bounds"));
        }
        machine
            .bus_mut()
            .ram_mut()
            .write_slice(address(addr)?, bytes)
            .map_err(|_| JsError::new("RAM write outside fixture"))
    }
    #[wasm_bindgen(js_name = readRam)]
    pub fn read_ram(&self, addr: &str, length: u32) -> Result<Uint8Array, JsError> {
        let mut machine = self
            .machine
            .try_borrow_mut()
            .map_err(|_| JsError::new("Reentrant proof access"))?;
        if length as usize > RAM_BYTES {
            return Err(JsError::new("RAM read exceeds fixture bounds"));
        }
        let mut bytes = vec![0; length as usize];
        machine
            .bus_mut()
            .ram()
            .read_slice(address(addr)?, &mut bytes)
            .map_err(|_| JsError::new("RAM read outside fixture"))?;
        Ok(owned(&bytes))
    }
    #[wasm_bindgen(js_name = writeMmio)]
    pub fn write_mmio(&self, offset: u32, value: u32) -> Result<(), JsError> {
        let mut machine = self
            .machine
            .try_borrow_mut()
            .map_err(|_| JsError::new("Reentrant proof access"))?;
        if offset >= 0x1000 || !offset.is_multiple_of(4) {
            return Err(JsError::new("Invalid MMIO offset"));
        }
        machine
            .bus_mut()
            .store32(self.base + u64::from(offset), value)
            .map_err(|_| JsError::new("MMIO write fault"))
    }
    #[wasm_bindgen(js_name = readMmio)]
    pub fn read_mmio(&self, offset: u32) -> Result<u32, JsError> {
        let mut machine = self
            .machine
            .try_borrow_mut()
            .map_err(|_| JsError::new("Reentrant proof access"))?;
        if offset >= 0x1000 || !offset.is_multiple_of(4) {
            return Err(JsError::new("Invalid MMIO offset"));
        }
        machine
            .bus_mut()
            .load32(self.base + u64::from(offset))
            .map_err(|_| JsError::new("MMIO read fault"))
    }
    pub fn run1(&self) -> Result<JsValue, JsError> {
        let mut machine = self
            .machine
            .try_borrow_mut()
            .map_err(|_| JsError::new("Reentrant proof access"))?;
        let outcome = machine.run(1);
        let out = Object::new();
        set(&out, "outcome", format!("{outcome:?}")).map_err(js_error)?;
        set(&out, "machineDigest", machine.snapshot().hex_digest()).map_err(js_error)?;
        Ok(out.into())
    }
    pub fn inspect(&self) -> Result<JsValue, JsError> {
        // Holding the Machine borrow also rejects introspection during a sink callback.
        let _machine = self
            .machine
            .try_borrow_mut()
            .map_err(|_| JsError::new("Reentrant proof access"))?;
        let gpu = self
            .gpu
            .try_borrow()
            .map_err(|_| JsError::new("Reentrant GPU access"))?;
        let Some(snapshot) = gpu.control3d_snapshot() else {
            return Ok(JsValue::NULL);
        };
        let out = Object::new();
        set(&out, "canonicalBytes", owned(&snapshot.canonical_bytes())).map_err(js_error)?;
        set(&out, "digest", snapshot.hex_digest()).map_err(js_error)?;
        set(&out, "epoch", hex(snapshot.epoch)).map_err(js_error)?;
        set(&out, "nextGeneration", hex(snapshot.next_generation)).map_err(js_error)?;
        set(
            &out,
            "nextBackingGeneration",
            hex(snapshot.next_backing_generation),
        )
        .map_err(js_error)?;
        set(&out, "poisoned", snapshot.poisoned).map_err(js_error)?;
        // These bounded totals are <= 64 MiB, unlike guest addresses and generations.
        for (key, value) in [
            ("logicalBytes", snapshot.logical_bytes),
            ("gpuBytes", snapshot.gpu_bytes),
            ("backingBytes", snapshot.backing_bytes),
        ] {
            set(&out, key, value as f64).map_err(js_error)?;
        }
        let contexts = Array::new();
        for context in snapshot.contexts {
            let entry = Object::new();
            set(&entry, "identity", id(context.identity).map_err(js_error)?).map_err(js_error)?;
            set(&entry, "debugName", owned(&context.debug_name)).map_err(js_error)?;
            let members = Array::new();
            for member in context.resources {
                members.push(&id(member).map_err(js_error)?.into());
            }
            set(&entry, "resources", members).map_err(js_error)?;
            contexts.push(&entry);
        }
        set(&out, "contexts", contexts).map_err(js_error)?;
        let resources = Array::new();
        for resource in snapshot.resources {
            let entry = Object::new();
            set(&entry, "identity", id(resource.identity).map_err(js_error)?).map_err(js_error)?;
            set(
                &entry,
                "backingGeneration",
                resource
                    .backing_generation
                    .map_or(JsValue::NULL, |value| JsValue::from_str(&hex(value))),
            )
            .map_err(js_error)?;
            set(
                &entry,
                "metadata",
                metadata(resource.metadata).map_err(js_error)?,
            )
            .map_err(js_error)?;
            let backing = if let Some(backing) = resource.backing {
                let segments = Array::new();
                for segment in backing {
                    let segment_out = Object::new();
                    set(&segment_out, "address", hex(segment.addr)).map_err(js_error)?;
                    set(&segment_out, "length", segment.length).map_err(js_error)?;
                    segments.push(&segment_out);
                }
                segments.into()
            } else {
                JsValue::NULL
            };
            set(&entry, "backing", backing).map_err(js_error)?;
            resources.push(&entry);
        }
        set(&out, "resources", resources).map_err(js_error)?;
        Ok(out.into())
    }
}

/// Explicit isolated submission fixture. The ordinary VM never exports or enables it.
/// The host pumps the renderer between calls; GPU polling cannot occur in these methods.
#[wasm_bindgen]
pub struct WasmVirglSubmitProof {
    inner: WasmVirglControlProof,
    mailbox: Submit3dMailbox,
}

#[wasm_bindgen]
impl WasmVirglSubmitProof {
    #[wasm_bindgen(constructor)]
    pub fn new(callback: Function, proof_enabled: bool) -> Result<WasmVirglSubmitProof, JsError> {
        let mut machine = Machine::new(RAM_BYTES);
        machine.enable_plic();
        machine.enable_virtio_slots(None);
        let mailbox = Submit3dMailbox::new();
        let (_, gpu) = if proof_enabled {
            machine.enable_virtio_gpu_submit3d_proof(
                Box::new(NullSink),
                Box::new(JsControlSink(callback.clone())),
                Box::new(JsSubmitSink(callback)),
                mailbox.clone(),
            )
        } else {
            machine.enable_virtio_gpu(Box::new(NullSink))
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
            inner: WasmVirglControlProof {
                machine: RefCell::new(machine),
                gpu,
                base,
            },
            mailbox,
        })
    }

    pub fn layout(&self) -> Result<JsValue, JsError> {
        self.inner.layout()
    }

    #[wasm_bindgen(js_name = writeRam)]
    pub fn write_ram(&self, addr: &str, bytes: &[u8]) -> Result<(), JsError> {
        self.inner.write_ram(addr, bytes)
    }

    #[wasm_bindgen(js_name = readRam)]
    pub fn read_ram(&self, addr: &str, length: u32) -> Result<Uint8Array, JsError> {
        self.inner.read_ram(addr, length)
    }

    #[wasm_bindgen(js_name = writeMmio)]
    pub fn write_mmio(&self, offset: u32, value: u32) -> Result<(), JsError> {
        self.inner.write_mmio(offset, value)
    }

    #[wasm_bindgen(js_name = readMmio)]
    pub fn read_mmio(&self, offset: u32) -> Result<u32, JsError> {
        self.inner.read_mmio(offset)
    }

    pub fn run1(&self) -> Result<JsValue, JsError> {
        let mut machine = self
            .inner
            .machine
            .try_borrow_mut()
            .map_err(|_| JsError::new("Reentrant proof access"))?;
        let outcome = machine.run(1);
        let out = Object::new();
        set(&out, "outcome", format!("{outcome:?}")).map_err(js_error)?;
        Ok(out.into())
    }

    /// Explicit checkpoint: hashing all proof RAM on every GPU poll would make
    /// observer work dominate the event-loop scheduling under test.
    #[wasm_bindgen(js_name = machineDigest)]
    pub fn machine_digest(&self) -> Result<String, JsError> {
        let machine = self
            .inner
            .machine
            .try_borrow_mut()
            .map_err(|_| JsError::new("Reentrant proof access"))?;
        Ok(machine.snapshot().hex_digest())
    }

    pub fn inspect(&self) -> Result<JsValue, JsError> {
        self.inner.inspect()
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
        let mut machine = self
            .inner
            .machine
            .try_borrow_mut()
            .map_err(|_| JsError::new("Reentrant proof access"))?;
        let bytes = machine
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
        let mut machine = self
            .inner
            .machine
            .try_borrow_mut()
            .map_err(|_| JsError::new("Reentrant proof access"))?;
        machine
            .submit3d_scatter(&exchange, bytes)
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
        self.mailbox
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

    #[wasm_bindgen(js_name = submitInspect)]
    pub fn submit_inspect(&self) -> Result<JsValue, JsError> {
        let snapshot = self.mailbox.inspect();
        let out = Object::new();
        let active = if let Some(key) = snapshot.active {
            let value = Object::new();
            set(&value, "epoch", hex(key.epoch)).map_err(js_error)?;
            set(&value, "sequence", hex(key.sequence)).map_err(js_error)?;
            value.into()
        } else {
            JsValue::NULL
        };
        set(&out, "active", active).map_err(js_error)?;
        set(&out, "lastExchange", hex(snapshot.last_exchange)).map_err(js_error)?;
        set(&out, "ready", snapshot.ready).map_err(js_error)?;
        Ok(out.into())
    }

    #[wasm_bindgen(js_name = submitState)]
    pub fn submit_state(&self) -> Result<JsValue, JsError> {
        let _machine = self
            .inner
            .machine
            .try_borrow_mut()
            .map_err(|_| JsError::new("Reentrant proof access"))?;
        let state = self
            .inner
            .gpu
            .try_borrow()
            .map_err(|_| JsError::new("Reentrant GPU access"))?;
        let Some(snapshot) = state.submit3d_snapshot() else {
            return Ok(JsValue::NULL);
        };
        let out = Object::new();
        set(&out, "canonicalBytes", owned(&snapshot.canonical_bytes())).map_err(js_error)?;
        set(&out, "digest", snapshot.hex_digest()).map_err(js_error)?;
        set(&out, "nextSequence", hex(snapshot.next_sequence)).map_err(js_error)?;
        let counters = Object::new();
        let c = snapshot.counters;
        for (key, value) in [
            ("admitted", c.admitted),
            ("completed", c.completed),
            ("cancelled", c.cancelled),
            ("fenced", c.fenced),
            ("submissionBytes", c.submission_bytes),
            ("inputBytes", c.input_bytes),
            ("outputBytes", c.output_bytes),
            ("exchanges", c.exchanges),
            ("appliedCommands", c.applied_commands),
            ("draws", c.draws),
        ] {
            set(&counters, key, hex(value)).map_err(js_error)?;
        }
        set(&out, "counters", counters).map_err(js_error)?;
        let pending = if let Some(p) = snapshot.pending {
            let value = Object::new();
            for (key, number) in [
                ("epoch", p.key.epoch),
                ("sequence", p.key.sequence),
                ("fenceId", p.fence_id),
                ("byteLength", p.byte_length),
                ("lastExchange", p.last_exchange),
            ] {
                set(&value, key, hex(number)).map_err(js_error)?;
            }
            set(&value, "context", id(p.context).map_err(js_error)?).map_err(js_error)?;
            for (key, number) in [
                ("commandType", p.command_type),
                ("flags", p.flags),
                ("backingEntries", p.backing_entries),
            ] {
                set(&value, key, number).map_err(js_error)?;
            }
            set(&value, "completionReady", p.completion_ready).map_err(js_error)?;
            value.into()
        } else {
            JsValue::NULL
        };
        set(&out, "pending", pending).map_err(js_error)?;
        Ok(out.into())
    }

    #[wasm_bindgen(js_name = commandTrace)]
    pub fn command_trace(&self) -> Result<JsValue, JsError> {
        let _machine = self
            .inner
            .machine
            .try_borrow_mut()
            .map_err(|_| JsError::new("Reentrant proof access"))?;
        let state = self
            .inner
            .gpu
            .try_borrow()
            .map_err(|_| JsError::new("Reentrant GPU access"))?;
        let out = Object::new();
        let records = Array::new();
        for record in state.command_trace() {
            let entry = Object::new();
            set(&entry, "sequence", hex(record.sequence)).map_err(js_error)?;
            for (key, value) in [
                ("submitSequence", record.submit_sequence),
                ("fenceId", record.fence_id),
            ] {
                set(
                    &entry,
                    key,
                    value.map_or(JsValue::NULL, |number| JsValue::from_str(&hex(number))),
                )
                .map_err(js_error)?;
            }
            for (key, value) in [
                ("commandType", record.command_type),
                ("responseType", record.response_type),
                ("availIndex", u32::from(record.avail_idx)),
                ("usedIndex", u32::from(record.used_idx)),
                ("usedHead", u32::from(record.used_head)),
                ("responseLength", record.response_len),
            ] {
                set(&entry, key, value).map_err(js_error)?;
            }
            for (key, value) in [
                ("resourceId", record.resource_id),
                ("resourceWidth", record.resource_width),
                ("resourceHeight", record.resource_height),
                ("scanout", record.scanout),
            ] {
                set(&entry, key, value.map_or(JsValue::NULL, JsValue::from)).map_err(js_error)?;
            }
            records.push(&entry);
        }
        set(&out, "records", records).map_err(js_error)?;
        set(&out, "dropped", hex(state.command_trace_dropped())).map_err(js_error)?;
        set(&out, "cursorCommands", hex(state.cursorq_commands())).map_err(js_error)?;
        Ok(out.into())
    }
}
