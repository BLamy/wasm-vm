//! Proof-only control and submission marshalling. Tests write actual guest descriptors and
//! drive Machine::run; protocol decoding, ring service and DMA validation remain in core.
use core::cell::RefCell;
use std::rc::Rc;

use js_sys::{Array, Function, Object, Uint8Array};
use wasm_bindgen::prelude::*;
use wasm_vm_core::Machine;
use wasm_vm_core::bus::Bus;
use wasm_vm_core::dev::virtio::gpu::control3d::Control3dError;
use wasm_vm_core::dev::virtio::gpu::submit3d::{Submit3dCompletion, Submit3dMailbox};
use wasm_vm_core::dev::virtio::gpu::{GpuState, NullSink};
use wasm_vm_core::platform::{Platform, virt};

const RAM_BYTES: usize = 4 * 1024 * 1024;

mod scanout;
use crate::virgl_host::*;

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
        Self::assemble(callback, proof_enabled, false, false, false, false)
    }

    /// Explicit selected desktop fixture; ordinary WasmLinux remains unchanged.
    #[wasm_bindgen(js_name = standardDesktop)]
    pub fn standard_desktop(callback: Function) -> Result<WasmVirglSubmitProof, JsError> {
        Self::assemble(callback, true, true, false, false, false)
    }

    /// Isolated original layered allocation/DMA fixture; no production capability.
    #[wasm_bindgen(js_name = standardDimensional)]
    pub fn standard_dimensional(callback: Function) -> Result<WasmVirglSubmitProof, JsError> {
        Self::assemble(callback, true, true, true, false, false)
    }

    /// Selected cube/array depth allocation and DMA; no positive production caps.
    #[wasm_bindgen(js_name = standardDimensionalDepth)]
    pub fn standard_dimensional_depth(callback: Function) -> Result<WasmVirglSubmitProof, JsError> {
        Self::assemble(callback, true, true, true, true, false)
    }

    /// Selected original stream-output buffer admission and layered transfers.
    #[wasm_bindgen(js_name = standardStreamOutput)]
    pub fn standard_stream_output(callback: Function) -> Result<WasmVirglSubmitProof, JsError> {
        Self::assemble(callback, true, true, true, true, true)
    }

    /// Explicitly compiled fixture of the actual qualified constructor. Never shipped.
    pub fn qualified(
        callback: Function,
        host_words: &[u32],
        format_roles: &[u32],
        renderer: &str,
    ) -> Result<WasmVirglSubmitProof, JsError> {
        let mut fixture = Self::assemble(callback.clone(), false, false, false, false, false)?;
        let caps = qualified_capabilities(host_words, format_roles, renderer)?;
        {
            let mut machine = fixture
                .inner
                .machine
                .try_borrow_mut()
                .map_err(|_| JsError::new("Reentrant fixture assembly"))?;
            machine
                .attach_qualified_virgl(
                    Box::new(JsControlSink(callback.clone())),
                    Box::new(crate::virgl_host::scanout::JsScanoutSink(
                        JsSubmitSink::legacy(callback),
                    )),
                    fixture.mailbox.clone(),
                    caps,
                )
                .map_err(JsError::new)?;
            fixture.inner.gpu = machine.virtio_gpu().expect("qualified GPU").1.clone();
            fixture.inner.gpu.borrow_mut().enable_command_trace();
        }
        Ok(fixture)
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
        let mut machine = self
            .inner
            .machine
            .try_borrow_mut()
            .map_err(|_| JsError::new("Reentrant proof access"))?;
        let bytes = machine
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
        let mut machine = self
            .inner
            .machine
            .try_borrow_mut()
            .map_err(|_| JsError::new("Reentrant proof access"))?;
        machine
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
            let context = p
                .context
                .map(id)
                .transpose()
                .map_err(js_error)?
                .map_or(JsValue::NULL, JsValue::from);
            set(&value, "context", context).map_err(js_error)?;
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

impl WasmVirglSubmitProof {
    fn assemble(
        callback: Function,
        proof_enabled: bool,
        desktop: bool,
        dimensional: bool,
        dimensional_depth: bool,
        stream_output: bool,
    ) -> Result<Self, JsError> {
        let mut machine = Machine::new(RAM_BYTES);
        machine.enable_plic();
        machine.enable_virtio_slots(None);
        let mailbox = Submit3dMailbox::new();
        let (_, gpu) = if stream_output {
            machine.enable_virtio_gpu_standard_stream_output_submit3d_proof(
                Box::new(NullSink),
                Box::new(JsControlSink(callback.clone())),
                Box::new(JsSubmitSink::legacy(callback)),
                mailbox.clone(),
            )
        } else if dimensional_depth {
            machine.enable_virtio_gpu_standard_dimensional_depth_submit3d_proof(
                Box::new(NullSink),
                Box::new(JsControlSink(callback.clone())),
                Box::new(JsSubmitSink::legacy(callback)),
                mailbox.clone(),
            )
        } else if dimensional {
            machine.enable_virtio_gpu_standard_dimensional_submit3d_proof(
                Box::new(NullSink),
                Box::new(JsControlSink(callback.clone())),
                Box::new(JsSubmitSink::legacy(callback)),
                mailbox.clone(),
            )
        } else if desktop {
            machine.enable_virtio_gpu_standard_desktop_submit3d_proof(
                Box::new(NullSink),
                Box::new(JsControlSink(callback.clone())),
                Box::new(JsSubmitSink::legacy(callback)),
                mailbox.clone(),
            )
        } else if proof_enabled {
            machine.enable_virtio_gpu_submit3d_proof(
                Box::new(NullSink),
                Box::new(JsControlSink(callback.clone())),
                Box::new(JsSubmitSink::legacy(callback)),
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
}
