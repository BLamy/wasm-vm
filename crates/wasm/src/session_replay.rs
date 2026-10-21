//! Lossless browser seam for the shared core replay driver. JavaScript owns immutable receipts;
//! this module copies them before admission and never calls a live provider during replay.
use crate::{WasmLinux, event_clock, reentrant, session_input};
use sha2::{Digest, Sha256};
use wasm_bindgen::{JsCast, prelude::*};
use wasm_vm_core::{
    session_clock::{
        SessionDelivery, SessionEffect, SessionPhase, SessionPosition,
        sources::{ObservationKind, ObservationValue},
    },
    session_replay::{ReplayDriver, ReplayPlan, StateWitness},
};

fn get(value: &JsValue, key: &str) -> Result<JsValue, JsError> {
    js_sys::Reflect::get(value, &key.into()).map_err(|_| JsError::new("exact replay field"))
}
fn decimal(value: &JsValue, key: &str) -> Result<u64, JsError> {
    let text = get(value, key)?
        .as_string()
        .ok_or_else(|| JsError::new("exact replay decimal"))?;
    event_clock::exact_u64(&text).map_err(JsError::new)
}
fn integer(value: &JsValue, key: &str, max: u32) -> Result<u32, JsError> {
    let n = get(value, key)?
        .as_f64()
        .ok_or_else(|| JsError::new("exact replay integer"))?;
    if !n.is_finite() || n.fract() != 0.0 || n < 0.0 || n > f64::from(max) {
        return Err(JsError::new("exact replay integer"));
    }
    Ok(n as u32)
}
fn bytes(value: &JsValue, key: &str, limit: usize) -> Result<Vec<u8>, JsError> {
    let value = get(value, key)?;
    if !value.is_instance_of::<js_sys::Uint8Array>() {
        return Err(JsError::new("exact replay owned bytes"));
    }
    let view = js_sys::Uint8Array::new(&value);
    if view.length() as usize > limit {
        return Err(JsError::new("exact replay byte limit"));
    }
    Ok(view.to_vec())
}
fn branch_queue(value: &JsValue, key: &str) -> Result<Vec<u8>, JsError> {
    let v = get(value, key)?;
    if !v.is_instance_of::<js_sys::Uint8Array>() {
        return Err(JsError::new("branch queue must be owned bytes"));
    }
    let view = js_sys::Uint8Array::new(&v);
    if view.length() > 1 << 20 || !view.buffer().is_instance_of::<js_sys::ArrayBuffer>() {
        return Err(JsError::new("branch host queue bound"));
    }
    Ok(view.to_vec())
}
fn position(value: &JsValue) -> Result<SessionPosition, JsError> {
    let phase = match get(value, "phase")?.as_string().as_deref() {
        Some("before") => SessionPhase::Before,
        Some("observe") => SessionPhase::Observe,
        _ => return Err(JsError::new("exact replay phase")),
    };
    Ok(SessionPosition {
        transition: decimal(value, "transition")?,
        retired: decimal(value, "retired")?,
        sequence: decimal(value, "sequence")?,
        ordinal: integer(value, "ordinal", u32::MAX)?,
        phase,
    })
}
fn encode_position(p: SessionPosition) -> JsValue {
    event_clock::position_object(p).into()
}
fn event(value: JsValue) -> Result<SessionDelivery, JsError> {
    let p = position(&value)?;
    let ticket = decimal(&value, "ticket")?;
    let kind = get(&value, "kind")?
        .as_string()
        .ok_or_else(|| JsError::new("exact replay kind"))?;
    let effect = match kind.as_str() {
        "host" => SessionEffect::HostInput {
            channel: integer(&value, "channel", u16::MAX as u32)? as u16,
            bytes: bytes(&value, "bytes", 1 << 20)?,
        },
        "ram" => SessionEffect::WriteRam {
            address: decimal(&value, "address")?,
            bytes: bytes(&value, "bytes", 1 << 20)?,
        },
        "pending" => SessionEffect::ExternalPending(
            get(&value, "pending")?
                .as_bool()
                .ok_or_else(|| JsError::new("exact replay pending"))?,
        ),
        "observation" => {
            let source = match integer(&value, "sourceKind", 7)? {
                1 => ObservationKind::RtcRead,
                2 => ObservationKind::RtcSetLow,
                3 => ObservationKind::RtcSetHigh,
                4 => ObservationKind::RtcArm,
                5 => ObservationKind::RtcPoll,
                6 => ObservationKind::Entropy,
                7 => ObservationKind::GpuControl,
                _ => return Err(JsError::new("exact replay source kind")),
            };
            SessionEffect::Observation(ObservationValue {
                kind: source,
                requested: integer(&value, "requested", 1 << 20)?,
                status: integer(&value, "status", 1)? as u8,
                bytes: bytes(&value, "bytes", 1 << 20)?,
            })
        }
        _ => return Err(JsError::new("exact replay event kind")),
    };
    let host_result = if matches!(effect, SessionEffect::HostInput { .. }) {
        let outcome = get(&value, "outcome")?;
        if !js_sys::Array::is_array(&outcome) {
            return Err(JsError::new("exact replay outcome"));
        }
        let values: js_sys::Array = outcome.unchecked_into();
        if values.length() != 4 {
            return Err(JsError::new("exact replay outcome"));
        }
        let mut result = [0; 4];
        for (index, item) in result.iter_mut().enumerate() {
            let text = values
                .get(index as u32)
                .as_string()
                .ok_or_else(|| JsError::new("exact replay outcome"))?;
            *item = event_clock::exact_u64(&text).map_err(JsError::new)?;
        }
        Some(result)
    } else {
        None
    };
    Ok(SessionDelivery {
        position: p,
        ticket,
        effect,
        host_result,
    })
}
pub(crate) fn encode_event(row: SessionDelivery) -> JsValue {
    let object = event_clock::position_object(row.position);
    let out: JsValue = object.into();
    let set = |key: &str, value: JsValue| {
        let _ = js_sys::Reflect::set(&out, &key.into(), &value);
    };
    set("ticket", row.ticket.to_string().into());
    match row.effect {
        SessionEffect::HostInput { channel, bytes } => {
            set("kind", "host".into());
            set("channel", channel.into());
            set("bytes", js_sys::Uint8Array::from(bytes.as_slice()).into());
            let outcome = js_sys::Array::new();
            for n in row.host_result.unwrap_or([u64::MAX; 4]) {
                outcome.push(&n.to_string().into());
            }
            set("outcome", outcome.into());
        }
        SessionEffect::WriteRam { address, bytes } => {
            set("kind", "ram".into());
            set("address", address.to_string().into());
            set("bytes", js_sys::Uint8Array::from(bytes.as_slice()).into());
        }
        SessionEffect::ExternalPending(value) => {
            set("kind", "pending".into());
            set("pending", value.into());
        }
        SessionEffect::Observation(value) => {
            set("kind", "observation".into());
            set(
                "channel",
                (match value.kind {
                    ObservationKind::Entropy => 18u16,
                    ObservationKind::GpuControl => 23u16,
                    _ => 17u16,
                })
                .into(),
            );
            set("sourceKind", (value.kind as u8).into());
            set("requested", value.requested.into());
            set("status", value.status.into());
            set(
                "bytes",
                js_sys::Uint8Array::from(value.bytes.as_slice()).into(),
            );
            let outcome = js_sys::Array::new();
            for n in [
                u64::from(value.status),
                value.kind as u64,
                u64::from(value.requested),
                0,
            ] {
                outcome.push(&n.to_string().into());
            }
            set("outcome", outcome.into());
        }
    }
    out
}
fn witness(value: JsValue) -> Result<StateWitness, JsError> {
    let digest = bytes(&value, "digest", 32)?;
    let resume_sha256 = digest
        .try_into()
        .map_err(|_| JsError::new("exact replay digest"))?;
    Ok(StateWitness {
        position: position(&value)?,
        resume_sha256,
    })
}

#[wasm_bindgen]
impl WasmLinux {
    /// Synchronous owned copy of the selected replay. Callers never receive its mutable VM.
    #[wasm_bindgen(js_name = captureExactBranch)]
    pub fn capture_exact_branch(
        &self,
        renderer_digest: Option<js_sys::Uint8Array>,
    ) -> Result<JsValue, JsError> {
        let renderer_digest: Option<[u8; 32]> = renderer_digest
            .map(|v| {
                if v.length() != 32 || !v.buffer().is_instance_of::<js_sys::ArrayBuffer>() {
                    return Err(JsError::new("branch renderer digest"));
                }
                Ok(v.to_vec().try_into().unwrap())
            })
            .transpose()?;
        let (at, source_digest, native, pending, output, disk) = {
            let mut inner = self.inner.try_borrow_mut().map_err(|_| reentrant())?;
            if inner.exact_session != Some(true)
                || inner.exact_driver.is_none()
                || inner.exact_gpu != renderer_digest.is_some()
                || inner.pending.len() > 1 << 20
                || inner.out.borrow().len() > 1 << 20
            {
                return Err(JsError::new(
                    "select an admitted paused replay before continuing",
                ));
            }
            let at = inner.machine.session_position().unwrap();
            #[cfg(feature = "virgl-renderer")]
            let source_digest = if inner.exact_gpu {
                inner
                    .machine
                    .gpu_session_state_digest()
                    .map_err(|e| JsError::new(&format!("branch source: {e:?}")))?
            } else {
                Sha256::digest(
                    inner
                        .machine
                        .save_session_resume()
                        .map_err(|e| JsError::new(&format!("branch source: {e:?}")))?,
                )
                .into()
            };
            #[cfg(not(feature = "virgl-renderer"))]
            let source_digest: [u8; 32] = Sha256::digest(
                inner
                    .machine
                    .save_session_resume()
                    .map_err(|e| JsError::new(&format!("branch source: {e:?}")))?,
            )
            .into();
            let native = inner
                .machine
                .capture_recording_branch(renderer_digest.as_ref())
                .map_err(|e| {
                    JsError::new(&format!(
                        "branch capture (select a completed GPU point): {e:?}"
                    ))
                })?;
            if native.len() > wasm_vm_core::session_replay::MAX_INITIAL_BYTES {
                return Err(JsError::new(
                    "branch native state exceeds the supported size",
                ));
            }
            let generation = inner.machine.overlay_generation();
            let disk = inner
                .checkpoint_disk
                .as_ref()
                .ok_or_else(|| JsError::new("branch disk binding is unavailable"))?
                .snapshot_delta(generation)
                .map_err(|e| JsError::new(&format!("branch disk: {e:?}")))?
                .to_bytes();
            let pending: Vec<u8> = inner.pending.iter().copied().collect();
            let output = inner.out.borrow().clone();
            (at, source_digest, native, pending, output, disk)
        };
        // Creating JS values can execute embedding code; release the source borrow first.
        let result = encode_position(at);
        for (name, data) in [
            ("sourceDigest", source_digest.as_slice()),
            ("native", native.as_slice()),
            ("pending", pending.as_slice()),
            ("output", output.as_slice()),
            ("disk", disk.as_slice()),
        ] {
            js_sys::Reflect::set(
                &result,
                &name.into(),
                &js_sys::Uint8Array::from(data).into(),
            )
            .map_err(|_| JsError::new("branch owned result"))?;
        }
        Ok(result.into())
    }

    #[wasm_bindgen(js_name = beginExactBranch)]
    pub fn begin_exact_branch(
        &self,
        native: js_sys::Uint8Array,
        queues: JsValue,
        renderer_digest: Option<js_sys::Uint8Array>,
    ) -> Result<(), JsError> {
        if native.length() as usize > wasm_vm_core::session_replay::MAX_INITIAL_BYTES
            || !native.buffer().is_instance_of::<js_sys::ArrayBuffer>()
        {
            return Err(JsError::new("branch native state bound"));
        }
        let native = native.to_vec();
        let pending = branch_queue(&queues, "pending")?;
        let output = branch_queue(&queues, "output")?;
        let digest: Option<[u8; 32]> = renderer_digest
            .map(|v| {
                if v.length() != 32 || !v.buffer().is_instance_of::<js_sys::ArrayBuffer>() {
                    return Err(JsError::new("branch renderer digest"));
                }
                Ok(v.to_vec().try_into().unwrap())
            })
            .transpose()?;
        let mut inner = self.inner.try_borrow_mut().map_err(|_| reentrant())?;
        if inner.exact_session != Some(false)
            || inner.exact_driver.is_some()
            || inner.finished.is_some()
            || inner.exact_gpu != digest.is_some()
            || inner.audio_attached
            || inner.capture_attached
            || inner.session_has_mic
            || !inner.pending.is_empty()
            || !inner.out.borrow().is_empty()
        {
            return Err(JsError::new(
                "a continuation requires a fresh recording owner",
            ));
        }
        inner
            .machine
            .restore_recording_branch(&native, digest.as_ref())
            .map_err(|e| JsError::new(&format!("branch restore: {e:?}")))?;
        inner.pending.extend(pending);
        *inner.out.borrow_mut() = output;
        Ok(())
    }

    #[wasm_bindgen(js_name = exactBranchNetworkOffline)]
    pub fn exact_branch_network_offline(&self) -> Result<bool, JsError> {
        self.inner
            .try_borrow()
            .map_err(|_| reentrant())?
            .machine
            .session_branch_offline()
            .map_err(|e| JsError::new(&format!("branch network: {e:?}")))
    }

    #[wasm_bindgen(js_name = requestExactBranchGoLive)]
    pub fn request_exact_branch_go_live(&self) -> Result<(), JsError> {
        self.inner
            .try_borrow()
            .map_err(|_| reentrant())?
            .machine
            .go_live_session_branch()
            .map_err(|_| {
                JsError::new("Historical connections stay offline. Start a fresh guest to go live.")
            })
    }

    #[wasm_bindgen(js_name = exactSessionHostQueues)]
    pub fn exact_session_host_queues(&self) -> Result<JsValue, JsError> {
        let inner = self.inner.try_borrow().map_err(|_| reentrant())?;
        if inner.exact_session.is_none() {
            return Err(JsError::new("exact session inactive"));
        }
        let pending: Vec<u8> = inner.pending.iter().copied().collect();
        let output = inner.out.borrow();
        if pending.len() > 1 << 20 || output.len() > 1 << 20 {
            return Err(JsError::new("exact session host queue bound"));
        }
        let queues = js_sys::Object::new();
        js_sys::Reflect::set(
            &queues,
            &"pending".into(),
            &js_sys::Uint8Array::from(pending.as_slice()).into(),
        )
        .map_err(|_| JsError::new("exact session host queues"))?;
        js_sys::Reflect::set(
            &queues,
            &"output".into(),
            &js_sys::Uint8Array::from(output.as_slice()).into(),
        )
        .map_err(|_| JsError::new("exact session host queues"))?;
        Ok(queues.into())
    }

    #[wasm_bindgen(js_name = exactSessionWitness)]
    pub fn exact_session_witness(&self, include_resume: bool) -> Result<JsValue, JsError> {
        let mut inner = self.inner.try_borrow_mut().map_err(|_| reentrant())?;
        if inner.exact_session.is_none() || inner.exact_gpu {
            return Err(JsError::new(
                "exact software session required; GPU uses its logical witness",
            ));
        }
        let frame = inner
            .machine
            .save_session_resume()
            .map_err(|e| JsError::new(&format!("exact session frame: {e:?}")))?;
        let p = inner.machine.session_position().unwrap();
        let out = encode_position(p);
        let digest: [u8; 32] = Sha256::digest(&frame).into();
        js_sys::Reflect::set(
            &out,
            &"digest".into(),
            &js_sys::Uint8Array::from(digest.as_slice()).into(),
        )
        .map_err(|_| JsError::new("exact witness"))?;
        if include_resume {
            js_sys::Reflect::set(
                &out,
                &"resume".into(),
                &js_sys::Uint8Array::from(frame.as_slice()).into(),
            )
            .map_err(|_| JsError::new("exact witness"))?;
        }
        Ok(out)
    }

    #[wasm_bindgen(js_name = takeExactSessionDeliveries)]
    pub fn take_exact_session_deliveries(&self) -> Result<JsValue, JsError> {
        let mut inner = self.inner.try_borrow_mut().map_err(|_| reentrant())?;
        if inner.exact_session != Some(false) || inner.exact_gpu {
            return Err(JsError::new(
                "exact software recording required; GPU receipts and bodies drain atomically",
            ));
        }
        let rows = inner
            .machine
            .take_session_deliveries()
            .map_err(|e| JsError::new(&format!("exact deliveries: {e:?}")))?;
        let out = js_sys::Array::new();
        for row in rows {
            out.push(&encode_event(row));
        }
        Ok(out.into())
    }

    #[wasm_bindgen(js_name = beginExactReplay)]
    pub fn begin_exact_replay(
        &self,
        initial_resume: js_sys::Uint8Array,
        events: js_sys::Array,
        witnesses: js_sys::Array,
        end: JsValue,
        initial_queues: Option<JsValue>,
        gpu_options: Option<JsValue>,
    ) -> Result<(), JsError> {
        let (pending_bytes, output_bytes) = if let Some(queues) = initial_queues {
            (
                bytes(&queues, "pending", 1 << 20)?,
                bytes(&queues, "output", 1 << 20)?,
            )
        } else {
            (Vec::new(), Vec::new())
        };
        if events.length() > wasm_vm_core::session_replay::MAX_REPLAY_EVENTS as u32
            || witnesses.length() == 0
            || witnesses.length() > wasm_vm_core::session_replay::MAX_REPLAY_EVENTS as u32
            || initial_resume.length() as usize > wasm_vm_core::session_replay::MAX_INITIAL_BYTES
        {
            return Err(JsError::new("exact replay plan limit"));
        }
        let mut rows = Vec::with_capacity(events.length() as usize);
        for value in events.iter() {
            rows.push(event(value)?);
        }
        let mut states = Vec::with_capacity(witnesses.length() as usize);
        for value in witnesses.iter() {
            states.push(witness(value)?);
        }
        let plan = ReplayPlan {
            begin: states[0].position,
            end: position(&end)?,
            initial_resume: initial_resume.to_vec(),
            events: rows,
            witnesses: states,
        };
        #[cfg(feature = "virgl-renderer")]
        let gpu = gpu_options
            .as_ref()
            .map(
                |options| -> Result<wasm_vm_core::session_replay::GpuReplayConfig, JsError> {
                    if integer(options, "version", 1)? != 1 {
                        return Err(JsError::new("GPU replay adapter version"));
                    }
                    let renderer_digest = bytes(options, "rendererDigest", 32)?
                        .try_into()
                        .map_err(|_| JsError::new("GPU renderer digest"))?;
                    let ram_value = get(options, "ramDigest")?;
                    let ram_digest = if ram_value.is_null() || ram_value.is_undefined() {
                        None
                    } else {
                        Some(
                            bytes(options, "ramDigest", 32)?
                                .try_into()
                                .map_err(|_| JsError::new("GPU RAM digest"))?,
                        )
                    };
                    let values = get(options, "payloads")?;
                    if !js_sys::Array::is_array(&values) {
                        return Err(JsError::new("GPU payload array"));
                    }
                    let values = js_sys::Array::from(&values);
                    if values.length() as usize > wasm_vm_core::session_gpu::MAX_OBJECTS {
                        return Err(JsError::new("GPU payload object bound"));
                    }
                    let mut payloads = Vec::new();
                    let mut total = 0usize;
                    for value in values.iter() {
                        let data = bytes(&value, "bytes", wasm_vm_core::session_gpu::MAX_PAYLOAD)?;
                        total = total
                            .checked_add(data.len())
                            .ok_or_else(|| JsError::new("GPU payload overflow"))?;
                        if total > wasm_vm_core::session_gpu::MAX_RESIDENT_BYTES {
                            return Err(JsError::new("GPU interval payload budget"));
                        }
                        let sha256 = bytes(&value, "sha256", 32)?
                            .try_into()
                            .map_err(|_| JsError::new("GPU payload digest"))?;
                        let length = integer(
                            &value,
                            "length",
                            wasm_vm_core::session_gpu::MAX_PAYLOAD as u32,
                        )?;
                        payloads.push(wasm_vm_core::session_gpu::Payload {
                            reference: wasm_vm_core::session_gpu::PayloadRef { sha256, length },
                            bytes: data,
                        });
                    }
                    Ok(wasm_vm_core::session_replay::GpuReplayConfig {
                        renderer_digest,
                        ram_digest,
                        payloads,
                    })
                },
            )
            .transpose()?;
        #[cfg(not(feature = "virgl-renderer"))]
        if gpu_options.is_some() {
            return Err(JsError::new("GPU replay is unavailable in this build"));
        }
        // Receipts are untrusted JS values. Their getters (and malformed Array fields) can
        // throw while the parser runs, so do not hold the Machine's mutable borrow until all
        // of them have been copied into owned Rust values.
        let mut inner = self.inner.try_borrow_mut().map_err(|_| reentrant())?;
        if inner.exact_session != Some(true)
            || inner.exact_driver.is_some()
            || !inner.pending.is_empty()
            || !inner.out.borrow().is_empty()
        {
            return Err(JsError::new(
                "exact replay requires fresh, empty host queues",
            ));
        }
        if inner.exact_gpu != gpu_options.is_some() {
            return Err(JsError::new("exact replay profile/adapter mismatch"));
        }
        #[cfg(feature = "virgl-renderer")]
        let admitted = if let Some(gpu) = gpu {
            ReplayDriver::start_gpu(&mut inner.machine, plan, gpu)
        } else {
            ReplayDriver::start(&mut inner.machine, plan)
        };
        #[cfg(not(feature = "virgl-renderer"))]
        let admitted = ReplayDriver::start(&mut inner.machine, plan);
        let driver =
            admitted.map_err(|e| JsError::new(&format!("exact replay admission: {e:?}")))?;
        inner.pending.extend(pending_bytes);
        *inner.out.borrow_mut() = output_bytes;
        inner.exact_driver = Some(driver);
        Ok(())
    }

    #[wasm_bindgen(js_name = runExactReplayToEnd)]
    pub fn run_exact_replay_to_end(&self, quantum: u32) -> Result<JsValue, JsError> {
        let mut inner = self.inner.try_borrow_mut().map_err(|_| reentrant())?;
        if inner.exact_session != Some(true) || inner.finished.is_some() {
            return Err(JsError::new("exact replay inactive or stopped"));
        }
        if inner.exact_gpu {
            return Err(JsError::new(
                "GPU replay requires cancellable chunks and physical pumping",
            ));
        }
        let mut driver = inner
            .exact_driver
            .take()
            .ok_or_else(|| JsError::new("exact replay not admitted"))?;
        let result = {
            let crate::LinuxInner {
                machine,
                pending,
                uart,
                out,
                ..
            } = &mut *inner;
            driver.run_to_end(machine, u64::from(quantum), |machine, channel, bytes| {
                if channel == wasm_vm_core::session_replay::OUTPUT_DRAIN_CHANNEL {
                    let mut actual = std::mem::take(&mut *out.borrow_mut());
                    actual.extend_from_slice(&uart.borrow_mut().take_output());
                    [u64::from(actual != bytes), actual.len() as u64, 0, 0]
                } else {
                    session_input::apply(machine, pending, uart, None, channel, bytes)
                }
            })
        };
        let cursor = driver.event_cursor();
        let status = driver.status();
        inner.exact_driver = Some(driver);
        if let Err(error) = result {
            return Err(JsError::new(&format!("exact replay divergence: {error:?}")));
        }
        let out = encode_position(inner.machine.session_position().unwrap());
        let _ = js_sys::Reflect::set(&out, &"eventCursor".into(), &cursor.into());
        let _ = js_sys::Reflect::set(&out, &"status".into(), &format!("{status:?}").into());
        Ok(out)
    }

    /// One cancellable browser replay quantum. The caller owns the candidate until `reached`
    /// and can discard it between calls without publishing any partial machine state.
    #[wasm_bindgen(js_name = runExactReplayChunkTo)]
    pub fn run_exact_replay_chunk_to(
        &self,
        target: JsValue,
        quantum: u32,
    ) -> Result<JsValue, JsError> {
        let transition_only = get(&target, "transitionOnly")?.as_bool() == Some(true);
        let target = if transition_only {
            SessionPosition {
                transition: decimal(&target, "transition")?,
                ..SessionPosition::default()
            }
        } else {
            position(&target)?
        };
        let mut inner = self.inner.try_borrow_mut().map_err(|_| reentrant())?;
        if inner.exact_session != Some(true) || inner.finished.is_some() {
            return Err(JsError::new("exact replay inactive or stopped"));
        }
        let mut driver = inner
            .exact_driver
            .take()
            .ok_or_else(|| JsError::new("exact replay not admitted"))?;
        let result = {
            let crate::LinuxInner {
                machine,
                pending,
                uart,
                out,
                ..
            } = &mut *inner;
            let mut apply = |machine: &mut wasm_vm_core::Machine, channel, bytes: &[u8]| {
                if channel == wasm_vm_core::session_replay::OUTPUT_DRAIN_CHANNEL {
                    let mut actual = std::mem::take(&mut *out.borrow_mut());
                    actual.extend_from_slice(&uart.borrow_mut().take_output());
                    [u64::from(actual != bytes), actual.len() as u64, 0, 0]
                } else {
                    session_input::apply(machine, pending, uart, None, channel, bytes)
                }
            };
            if transition_only {
                driver.run_chunk_to_transition(
                    machine,
                    target.transition,
                    u64::from(quantum),
                    &mut apply,
                )
            } else {
                driver.run_chunk_to(machine, target, u64::from(quantum), &mut apply)
            }
        };
        let cursor = driver.event_cursor();
        let status = driver.status();
        inner.exact_driver = Some(driver);
        let reached =
            result.map_err(|error| JsError::new(&format!("exact replay divergence: {error:?}")))?;
        let out = encode_position(inner.machine.session_position().unwrap());
        js_sys::Reflect::set(&out, &"eventCursor".into(), &cursor.into())
            .map_err(|_| JsError::new("exact replay result"))?;
        js_sys::Reflect::set(&out, &"status".into(), &format!("{status:?}").into())
            .map_err(|_| JsError::new("exact replay result"))?;
        js_sys::Reflect::set(&out, &"reached".into(), &reached.into())
            .map_err(|_| JsError::new("exact replay result"))?;
        Ok(out)
    }
}
