//! Shared production/proof marshalling for retained VirGL ownership.
use js_sys::{Array, Function, Object, Reflect, Uint8Array};
use wasm_bindgen::prelude::*;
use wasm_vm_core::dev::virtio::gpu::control3d::{
    Control3dError, Control3dEvent, Control3dId, Control3dOperation, Control3dSink,
    Resource3dMetadata,
};
use wasm_vm_core::dev::virtio::gpu::submit3d::{
    Submit3dBacking, Submit3dExchange, Submit3dKey, Submit3dKind, Submit3dRequest, Submit3dRows,
    Submit3dSink,
};
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
    pub(crate) fn invoke(callback: &Function, event: &JsValue) -> u32;
}

pub(crate) fn set(object: &Object, key: &str, value: impl Into<JsValue>) -> Result<(), JsValue> {
    if Reflect::set(object, &JsValue::from_str(key), &value.into())? {
        Ok(())
    } else {
        Err(JsValue::from_str("Cannot marshal control record"))
    }
}
pub(crate) fn hex(value: u64) -> String {
    format!("{value:016x}")
}
pub(crate) fn owned(bytes: &[u8]) -> Uint8Array {
    Uint8Array::from(bytes)
}
pub(crate) fn id(value: Control3dId) -> Result<Object, JsValue> {
    let out = Object::new();
    set(&out, "id", value.id)?;
    set(&out, "generation", hex(value.generation))?;
    Ok(out)
}
pub(crate) fn metadata(value: Resource3dMetadata) -> Result<Object, JsValue> {
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
pub(crate) struct JsControlSink(pub(crate) Function);
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

pub(crate) struct JsSubmitSink(pub(crate) Function);
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
pub(crate) fn address(value: &str) -> Result<u64, JsError> {
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
#[cfg(feature = "virgl-control-proof")]
pub(crate) fn js_error(value: JsValue) -> JsError {
    JsError::new(&format!("Control marshalling failed: {value:?}"))
}

pub(crate) fn control_result(value: u32) -> Result<(), Control3dError> {
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

pub(crate) fn transport_error(error: Control3dError) -> JsError {
    JsError::new(error.code())
}

pub(crate) fn request_key(epoch: &str, sequence: &str) -> Result<Submit3dKey, JsError> {
    Ok(Submit3dKey {
        epoch: address(epoch)?,
        sequence: address(sequence)?,
    })
}

#[allow(clippy::too_many_arguments)]
pub(crate) fn exchange(
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

pub(crate) mod scanout;

/// Shared typed host boundary for production and the separately built queue fixture.
pub(crate) fn qualified_capabilities(
    host_words: &[u32],
    format_roles: &[u32],
    renderer: &str,
) -> Result<wasm_vm_core::dev::virtio::gpu::capabilities::QualifiedCapabilities, JsError> {
    use wasm_vm_core::dev::virtio::gpu::capabilities::{
        FormatMask, HostLimits, QualifiedCapabilities,
    };
    if host_words.len() != 13 || !format_roles.len().is_multiple_of(2) || format_roles.len() > 512 {
        return Err(JsError::new("Invalid qualified host profile"));
    }
    let limits = HostLimits {
        texture_2d: host_words[0],
        texture_3d: host_words[1],
        texture_cube: host_words[2],
        array_layers: host_words[3],
        varying_vectors: host_words[4],
        vertex_attributes: host_words[5],
        uniform_block_bytes: host_words[6],
        uniform_alignment: host_words[7],
        vertex_samplers: host_words[8],
        fragment_samplers: host_words[9],
        vertex_constant_vectors: host_words[10],
        fragment_constant_vectors: host_words[11],
        feedback_components: host_words[12],
    };
    let (mut sampler, mut render, mut depth, mut vertex) = (
        FormatMask::default(),
        FormatMask::default(),
        FormatMask::default(),
        FormatMask::default(),
    );
    for pair in format_roles.chunks_exact(2) {
        let (format, roles) = (pair[0], pair[1]);
        if roles == 0 || roles & !15 != 0 {
            return Err(JsError::new("Invalid qualified format role"));
        }
        for (bit, mask) in [
            (1, &mut sampler),
            (2, &mut render),
            (4, &mut depth),
            (8, &mut vertex),
        ] {
            if roles & bit != 0 {
                mask.insert(format).map_err(JsError::new)?;
            }
        }
    }
    QualifiedCapabilities::new(limits, sampler, render, depth, vertex, renderer)
        .map_err(JsError::new)
}
