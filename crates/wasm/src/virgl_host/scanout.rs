use super::*;
use wasm_vm_core::dev::virtio::gpu::Rect;
use wasm_vm_core::dev::virtio::gpu::scanout3d::{
    Scanout3dBinding, Scanout3dEvent, Scanout3dRequest, Scanout3dTarget,
};
pub(crate) fn rectangle(rect: Rect) -> Result<Object, JsValue> {
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

pub(crate) fn binding(value: &Scanout3dBinding) -> Result<Object, JsValue> {
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

pub(crate) struct JsScanoutSink(pub(crate) JsSubmitSink);

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
