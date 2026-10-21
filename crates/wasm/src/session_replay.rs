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
            let source = match integer(&value, "sourceKind", 6)? {
                1 => ObservationKind::RtcRead,
                2 => ObservationKind::RtcSetLow,
                3 => ObservationKind::RtcSetHigh,
                4 => ObservationKind::RtcArm,
                5 => ObservationKind::RtcPoll,
                6 => ObservationKind::Entropy,
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
fn encode_event(row: SessionDelivery) -> JsValue {
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
                (if value.kind == ObservationKind::Entropy {
                    18u16
                } else {
                    17u16
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
        if inner.exact_session.is_none() {
            return Err(JsError::new("exact session inactive"));
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
        if inner.exact_session != Some(false) {
            return Err(JsError::new("exact recording inactive"));
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
        let driver = ReplayDriver::start(&mut inner.machine, plan)
            .map_err(|e| JsError::new(&format!("exact replay admission: {e:?}")))?;
        inner.pending.extend(pending_bytes);
        *inner.out.borrow_mut() = output_bytes;
        inner.exact_driver = Some(driver);
        Ok(())
    }

    #[wasm_bindgen(js_name = runExactReplayToEnd)]
    pub fn run_exact_replay_to_end(&self, quantum: u32) -> Result<JsValue, JsError> {
        let mut inner = self.inner.try_borrow_mut().map_err(|_| reentrant())?;
        if inner.exact_session != Some(true) {
            return Err(JsError::new("exact replay inactive"));
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
        if inner.exact_session != Some(true) {
            return Err(JsError::new("exact replay inactive"));
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
