//! Proof-only global display ownership. A successful capture completion means
//! GPU-ready pixels accepted by the bounded host presenter, never actual paint.
use alloc::{string::String, vec::Vec};
use sha2::{Digest, Sha256};

use super::{
    GpuState, Rect,
    control3d::{Control3dError as E, Control3dId, Resource3dMetadata},
    protocol::{self as p, CtrlHeader},
    submit3d::{PendingRequest, PendingSubmit3d, Submit3dKey},
};
use crate::{bus::Bus, dev::virtio::queue::DescriptorChain, mmio::SystemBus};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Scanout3dTarget {
    Disabled,
    TwoD {
        resource_id: u32,
        format: u32,
        width: u32,
        height: u32,
    },
    Renderer {
        resource: Control3dId,
        metadata: Resource3dMetadata,
    },
}
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Scanout3dBinding {
    pub generation: u64,
    pub rect: Rect,
    pub target: Scanout3dTarget,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Scanout3dEvent {
    pub epoch: u64,
    pub binding: Scanout3dBinding,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Scanout3dRequest {
    pub key: Submit3dKey,
    pub header: CtrlHeader,
    pub binding: Scanout3dBinding,
}
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct Scanout3dCounters {
    pub bindings: u64,
    pub captures_admitted: u64,
    pub captures_completed: u64,
    pub captures_failed: u64,
    pub accepted_bytes: u64,
    pub completed_bytes: u64,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Scanout3dSnapshot {
    pub next_generation: u64,
    /// Last accepted binding. A 2D public unref separately clears the live
    /// GpuState.scanout_resource; already owned presentation pixels may retire.
    pub binding: Option<Scanout3dBinding>,
    pub counters: Scanout3dCounters,
}
impl Scanout3dSnapshot {
    pub fn canonical_bytes(&self) -> Vec<u8> {
        let mut out = Vec::new();
        out.extend_from_slice(b"WV3DSCN1");
        let c = self.counters;
        for v in [
            self.next_generation,
            c.bindings,
            c.captures_admitted,
            c.captures_completed,
            c.captures_failed,
            c.accepted_bytes,
            c.completed_bytes,
        ] {
            out.extend_from_slice(&v.to_le_bytes());
        }
        out.push(u8::from(self.binding.is_some()));
        if let Some(b) = self.binding {
            out.extend_from_slice(&b.generation.to_le_bytes());
            for v in [b.rect.x, b.rect.y, b.rect.width, b.rect.height] {
                out.extend_from_slice(&v.to_le_bytes());
            }
            match b.target {
                Scanout3dTarget::Disabled => out.push(0),
                Scanout3dTarget::TwoD {
                    resource_id,
                    format,
                    width,
                    height,
                } => {
                    out.push(1);
                    for v in [resource_id, format, width, height] {
                        out.extend_from_slice(&v.to_le_bytes());
                    }
                }
                Scanout3dTarget::Renderer {
                    resource,
                    metadata: m,
                } => {
                    out.push(2);
                    out.extend_from_slice(&resource.generation.to_le_bytes());
                    for v in [
                        resource.id,
                        m.resource_id,
                        m.target,
                        m.format,
                        m.bind,
                        m.width,
                        m.height,
                        m.depth,
                        m.array_size,
                        m.last_level,
                        m.nr_samples,
                        m.flags,
                    ] {
                        out.extend_from_slice(&v.to_le_bytes());
                    }
                }
            }
        }
        out
    }
    pub fn hex_digest(&self) -> String {
        use core::fmt::Write;
        let mut out = String::with_capacity(64);
        for byte in Sha256::digest(self.canonical_bytes()) {
            let _ = write!(&mut out, "{byte:02x}");
        }
        out
    }
}
pub(crate) struct Scanout3dState {
    snapshot: Scanout3dSnapshot,
}
impl Scanout3dState {
    pub fn new() -> Self {
        Self {
            snapshot: Scanout3dSnapshot {
                next_generation: 1,
                binding: None,
                counters: Scanout3dCounters::default(),
            },
        }
    }
    pub fn snapshot(&self) -> Scanout3dSnapshot {
        self.snapshot
    }
    pub fn reset(&mut self) {
        self.snapshot.binding = None;
    }
    fn bind(&mut self, binding: Scanout3dBinding) {
        self.snapshot.binding = Some(binding);
        self.snapshot.next_generation += 1;
        self.snapshot.counters.bindings = self.snapshot.counters.bindings.saturating_add(1);
    }
    pub fn admitted(&mut self, request: &Scanout3dRequest) {
        let c = &mut self.snapshot.counters;
        c.captures_admitted = c.captures_admitted.saturating_add(1);
        c.accepted_bytes = c.accepted_bytes.saturating_add(capture_bytes(request));
    }
    pub fn completed(&mut self, request: &Scanout3dRequest, success: bool) {
        let c = &mut self.snapshot.counters;
        if success {
            c.captures_completed = c.captures_completed.saturating_add(1);
            c.completed_bytes = c.completed_bytes.saturating_add(capture_bytes(request));
        } else {
            c.captures_failed = c.captures_failed.saturating_add(1);
        }
    }
}
fn capture_bytes(r: &Scanout3dRequest) -> u64 {
    u64::from(r.binding.rect.width) * u64::from(r.binding.rect.height) * 4
}
fn response_preflight(chain: &DescriptorChain, bus: &SystemBus, state: &GpuState) -> Result<(), E> {
    if state
        .control3d
        .as_ref()
        .expect("scanout control")
        .snapshot()
        .poisoned
    {
        return Err(E::BridgePoisoned);
    }
    if chain.writable_len() < 24
        || chain
            .writable()
            .any(|s| !bus.ram().ram_contains(s.addr, u64::from(s.len)))
    {
        return Err(E::InvalidParameter);
    }
    Ok(())
}
fn preflight(
    chain: &DescriptorChain,
    bus: &SystemBus,
    state: &GpuState,
    header: CtrlHeader,
    negotiated: bool,
) -> Result<(), E> {
    response_preflight(chain, bus, state)?;
    if !negotiated {
        return Err(E::Unspecified);
    }
    if super::readable_len(chain) != Some(48)
        || header.ctx_id != 0
        || header.flags & !p::FLAG_FENCE != 0
        || header.ring_idx != 0
        || header.padding != [0; 3]
    {
        return Err(E::InvalidParameter);
    }
    Ok(())
}
fn full_rect(rect: Rect, m: Resource3dMetadata) -> bool {
    m.target == 2
        && m.format == 67
        && m.bind == 10
        && m.depth == 1
        && m.array_size == 1
        && m.last_level == 0
        && m.nr_samples == 0
        && m.flags == 0
        && rect
            == (Rect {
                x: 0,
                y: 0,
                width: m.width,
                height: m.height,
            })
}
pub(crate) fn bind(
    chain: &DescriptorChain,
    bus: &mut SystemBus,
    state: &mut GpuState,
    header: CtrlHeader,
    negotiated: bool,
) -> Result<(), E> {
    // The shared proof sink does not tighten ordinary 2D/disable header or
    // trailing-byte semantics. All host mutations still require a full response.
    response_preflight(chain, bus, state)?;
    let bytes = super::read_request::<48>(chain, bus).ok_or(E::InvalidParameter)?;
    let request = p::SetScanout::from_bytes(&bytes).ok_or(E::InvalidParameter)?;
    if request.scanout_id != 0 {
        return Err(E::InvalidParameter);
    }
    let control = state
        .control3d
        .as_ref()
        .expect("scanout control")
        .snapshot();
    let (target, rect) = if request.resource_id == 0 {
        (
            Scanout3dTarget::Disabled,
            Rect {
                x: 0,
                y: 0,
                width: 0,
                height: 0,
            },
        )
    } else if let Some(r) = state.resources.get(request.resource_id) {
        if !super::rect_within(request.rect, r.width, r.height) {
            return Err(E::InvalidParameter);
        }
        (
            Scanout3dTarget::TwoD {
                resource_id: request.resource_id,
                format: r.format,
                width: r.width,
                height: r.height,
            },
            request.rect,
        )
    } else {
        preflight(chain, bus, state, header, negotiated)?;
        let r = control
            .resources
            .iter()
            .find(|r| r.identity.id == request.resource_id)
            .ok_or(E::InvalidResourceId)?;
        if !full_rect(request.rect, r.metadata) {
            return Err(E::InvalidParameter);
        }
        (
            Scanout3dTarget::Renderer {
                resource: r.identity,
                metadata: r.metadata,
            },
            request.rect,
        )
    };
    let generation = state
        .scanout3d
        .as_ref()
        .expect("scanout proof")
        .snapshot
        .next_generation;
    generation.checked_add(1).ok_or(E::OutOfMemory)?;
    let binding = Scanout3dBinding {
        generation,
        rect,
        target,
    };
    let result = state
        .submit3d
        .as_mut()
        .expect("scanout submit")
        .bind_scanout(&Scanout3dEvent {
            epoch: control.epoch,
            binding,
        });
    if result == Err(E::BridgePoisoned) {
        state.control3d.as_mut().expect("scanout control").poison();
    }
    result?;
    state.scanout_resource = match target {
        Scanout3dTarget::TwoD { resource_id, .. } => Some(resource_id),
        _ => None,
    };
    state
        .scanout3d
        .as_mut()
        .expect("scanout proof")
        .bind(binding);
    Ok(())
}
/// A missing/retired renderer id is still routed to strict global validation.
/// Existing 2D resources keep their original flush behavior.
pub(crate) fn is_capture(
    chain: &DescriptorChain,
    bus: &mut SystemBus,
    state: &GpuState,
    header: CtrlHeader,
) -> bool {
    if state.scanout3d.is_none() || header.ty != p::CMD_RESOURCE_FLUSH {
        return false;
    }
    let Some(bytes) = super::read_readable_at::<44>(chain, bus, 0) else {
        return true;
    };
    let id = u32::from_le_bytes(bytes[40..44].try_into().expect("resource id"));
    state.resources.get(id).is_none()
}
pub(crate) fn admit(
    state: &GpuState,
    chain: DescriptorChain,
    bus: &mut SystemBus,
    header: CtrlHeader,
    negotiated: bool,
    queue_generation: Option<u64>,
) -> Result<PendingSubmit3d, E> {
    preflight(&chain, bus, state, header, negotiated)?;
    let bytes = super::read_request::<48>(&chain, bus).ok_or(E::InvalidParameter)?;
    if bytes[44..48] != [0; 4] {
        return Err(E::InvalidParameter);
    }
    let request = p::ResourceFlush::from_bytes(&bytes).ok_or(E::InvalidParameter)?;
    let control = state
        .control3d
        .as_ref()
        .expect("scanout control")
        .snapshot();
    let resource = control
        .resources
        .iter()
        .find(|r| r.identity.id == request.resource_id)
        .ok_or(E::InvalidResourceId)?;
    let binding = state
        .scanout3d
        .as_ref()
        .expect("scanout proof")
        .snapshot
        .binding
        .ok_or(E::InvalidParameter)?;
    if binding.target
        != (Scanout3dTarget::Renderer {
            resource: resource.identity,
            metadata: resource.metadata,
        })
        || !full_rect(request.rect, resource.metadata)
    {
        return Err(E::InvalidParameter);
    }
    let key = state
        .submit3d
        .as_ref()
        .expect("scanout submit")
        .next_key(control.epoch)?;
    Ok(PendingSubmit3d {
        request: PendingRequest::Scanout(Scanout3dRequest {
            key,
            header,
            binding,
        }),
        chain,
        queue_generation: queue_generation.ok_or(E::BridgePoisoned)?,
        accepted: control,
        #[cfg(feature = "gpu-trace")]
        trace: super::CommandTraceMeta::default(),
    })
}
