//! Proof-only marshalling surface. Tests write actual guest descriptors and drive Machine::run;
//! no protocol decoder, ring service or renderer semantics are duplicated here.
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
        Control3dOperation::AttachBacking { resource, segments } => {
            set(&out, "resource", id(*resource)?)?;
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
        Control3dOperation::DetachBacking { resource } => {
            set(&out, "resource", id(*resource)?)?;
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
        match invoke(&self.0, &event) {
            0 => Ok(()),
            1 => Err(Control3dError::InvalidContextId),
            2 => Err(Control3dError::InvalidResourceId),
            3 => Err(Control3dError::InvalidParameter),
            4 => Err(Control3dError::OutOfMemory),
            5 => Err(Control3dError::Unspecified),
            _ => Err(Control3dError::BridgePoisoned),
        }
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
