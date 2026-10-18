//! Lossless ABI for the common event-clock mechanism on the bare-metal machine.
//! The Linux session library continues to offer checkpoints until its provider adapters land.
use super::*;
use wasm_vm_core::session_clock::{MAX_PAYLOAD, SessionEffect, SessionPosition};

pub(crate) fn exact_u64(text: &str) -> Result<u64, &'static str> {
    if text.is_empty()
        || text.len() > 20
        || (text.len() > 1 && text.starts_with('0'))
        || !text.bytes().all(|b| b.is_ascii_digit())
    {
        return Err("expected a canonical unsigned decimal u64 string");
    }
    text.parse().map_err(|_| "unsigned counter exceeds u64")
}

pub(crate) fn position_object(position: SessionPosition) -> js_sys::Object {
    let object = js_sys::Object::new();
    for (key, value) in [
        ("transition", position.transition.to_string()),
        ("retired", position.retired.to_string()),
        ("phase", position.phase.label().into()),
        ("sequence", position.sequence.to_string()),
    ] {
        let _ = js_sys::Reflect::set(&object, &key.into(), &value.into());
    }
    let _ = js_sys::Reflect::set(&object, &"ordinal".into(), &position.ordinal.into());
    object
}

#[wasm_bindgen]
impl WasmMachine {
    /// Select a single-hart deterministic board and begin a fresh exact coordinate. Validate
    /// host numbers before wasm integer coercion; wide event positions always use strings.
    #[wasm_bindgen(js_name=startEventClock)]
    pub fn start_event_clock(&self, harts: JsValue, divider: JsValue) -> Result<(), JsError> {
        let mut inner = self.inner.try_borrow_mut().map_err(|_| reentrant())?;
        Self::guard_runnable(&inner)?;
        let divider = divider
            .as_f64()
            .filter(|v| v.is_finite() && v.fract() == 0.0 && (1.0..=1024.0).contains(v))
            .ok_or_else(|| JsError::new("session_clock: UnsupportedScheduling (ICount divider)"))?;
        if cfg!(feature = "zicsr-stub") || harts.as_f64() != Some(1.0) {
            return Err(JsError::new(
                "session_clock: UnsupportedScheduling (single hart required)",
            ));
        }
        if inner.machine.session_position().is_some() {
            return Err(JsError::new("session_clock: AlreadyActive"));
        }
        inner
            .machine
            .start_session_clock(1)
            .map_err(|e| JsError::new(&format!("session_clock: {e:?}")))?;
        inner.machine.enable_clint(divider as u64);
        Ok(())
    }

    #[wasm_bindgen(js_name=eventPosition)]
    pub fn event_position(&self) -> Result<JsValue, JsError> {
        let inner = self.inner.try_borrow().map_err(|_| reentrant())?;
        let position = inner
            .machine
            .session_position()
            .ok_or_else(|| JsError::new("session_clock: Inactive"))?;
        let object = position_object(position);
        let _ = js_sys::Reflect::set(
            &object,
            &"pending".into(),
            &(inner.machine.session_pending_events() as u32).into(),
        );
        let _ = js_sys::Reflect::set(
            &object,
            &"mtime".into(),
            &inner.machine.clint_mtime().to_string().into(),
        );
        Ok(object.into())
    }

    /// Own a RAM payload now; apply it only at the named before-transition boundary. This is the
    /// common effect path used by forthcoming provider adapters, not a live browser callback.
    #[wasm_bindgen(js_name=stageEventWrite)]
    pub fn stage_event_write(
        &self,
        transition: &str,
        address: &str,
        bytes: js_sys::Uint8Array,
    ) -> Result<String, JsError> {
        let transition = exact_u64(transition).map_err(JsError::new)?;
        let address = exact_u64(address).map_err(JsError::new)?;
        if bytes.length() as usize > MAX_PAYLOAD {
            return Err(JsError::new("session_clock: PayloadTooLarge"));
        }
        let mut inner = self.inner.try_borrow_mut().map_err(|_| reentrant())?;
        let ticket = inner
            .machine
            .stage_session_effect(
                transition,
                SessionEffect::WriteRam {
                    address,
                    bytes: bytes.to_vec(),
                },
            )
            .map_err(|e| JsError::new(&format!("session_clock: {e:?}")))?;
        Ok(ticket.to_string())
    }

    #[wasm_bindgen(js_name=stageEventPending)]
    pub fn stage_event_pending(&self, transition: &str, pending: bool) -> Result<String, JsError> {
        let transition = exact_u64(transition).map_err(JsError::new)?;
        let mut inner = self.inner.try_borrow_mut().map_err(|_| reentrant())?;
        let ticket = inner
            .machine
            .stage_session_effect(transition, SessionEffect::ExternalPending(pending))
            .map_err(|e| JsError::new(&format!("session_clock: {e:?}")))?;
        Ok(ticket.to_string())
    }

    #[wasm_bindgen(js_name=runEventUntil)]
    pub fn run_event_until(&self, transition: &str, max_work: u32) -> Result<JsValue, JsError> {
        let transition = exact_u64(transition).map_err(JsError::new)?;
        let mut inner = self.inner.try_borrow_mut().map_err(|_| reentrant())?;
        Self::guard_runnable(&inner)?;
        let before = inner.machine.irq_stats().retired;
        let outcome = if inner.trace_on {
            let Inner { machine, trace, .. } = &mut *inner;
            machine.run_session_until_traced(
                transition,
                u64::from(max_work),
                &mut RunSink { trace },
            )
        } else {
            inner
                .machine
                .run_session_until(transition, u64::from(max_work))
        }
        .map_err(|e| JsError::new(&format!("session_clock: {e:?}")))?;
        let retired = inner.machine.irq_stats().retired.wrapping_sub(before);
        Self::status_object(&mut inner, outcome, retired)
    }

    #[wasm_bindgen(js_name=deliverEventBoundary)]
    pub fn deliver_event_boundary(&self) -> Result<(), JsError> {
        self.inner
            .try_borrow_mut()
            .map_err(|_| reentrant())?
            .machine
            .deliver_session_boundary()
            .map_err(|e| JsError::new(&format!("session_clock: {e:?}")))
    }

    #[wasm_bindgen(js_name=takeEventDeliveries)]
    pub fn take_event_deliveries(&self) -> Result<JsValue, JsError> {
        let mut inner = self.inner.try_borrow_mut().map_err(|_| reentrant())?;
        let deliveries = inner
            .machine
            .take_session_deliveries()
            .map_err(|e| JsError::new(&format!("session_clock: {e:?}")))?;
        let out = js_sys::Array::new();
        for delivery in deliveries {
            let object = position_object(delivery.position);
            let _ = js_sys::Reflect::set(
                &object,
                &"ticket".into(),
                &delivery.ticket.to_string().into(),
            );
            let (kind, address, bytes) = match delivery.effect {
                SessionEffect::WriteRam { address, bytes } => ("ram", address, bytes),
                SessionEffect::ExternalPending(value) => {
                    ("external-pending", 0, vec![u8::from(value)])
                }
                SessionEffect::HostInput { channel, bytes } => {
                    ("host-input", u64::from(channel), bytes)
                }
                SessionEffect::Observation(value) => {
                    ("observation", value.kind as u64, value.bytes)
                }
            };
            let _ = js_sys::Reflect::set(&object, &"kind".into(), &kind.into());
            let _ = js_sys::Reflect::set(&object, &"address".into(), &address.to_string().into());
            let _ = js_sys::Reflect::set(
                &object,
                &"bytes".into(),
                &js_sys::Uint8Array::from(bytes.as_slice()),
            );
            out.push(&object);
        }
        Ok(out.into())
    }

    #[wasm_bindgen(js_name=saveEventCheckpoint)]
    pub fn save_event_checkpoint(&self) -> Result<Vec<u8>, JsError> {
        let mut inner = self.inner.try_borrow_mut().map_err(|_| reentrant())?;
        if inner.machine.session_position().is_none() {
            return Err(JsError::new("session_clock: Inactive"));
        }
        inner
            .machine
            .save_session_resume()
            .map_err(|e| JsError::new(&format!("session_checkpoint: {e:?}")))
    }

    #[wasm_bindgen(js_name=restoreEventCheckpoint)]
    pub fn restore_event_checkpoint(&self, bytes: &[u8]) -> Result<(), JsError> {
        let mut inner = self.inner.try_borrow_mut().map_err(|_| reentrant())?;
        if inner.machine.session_position().is_none() {
            return Err(JsError::new("session_clock: Inactive"));
        }
        inner
            .machine
            .load_session_resume(bytes)
            .map_err(|e| JsError::new(&format!("session_checkpoint: {e:?}")))?;
        inner.exited = false;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::exact_u64;
    #[test]
    fn exact_counter_strings_reject_coercion_and_overflow() {
        for text in ["0", "9007199254740993", "18446744073709551615"] {
            assert_eq!(exact_u64(text).unwrap().to_string(), text)
        }
        for text in [
            "",
            "00",
            "01",
            "-1",
            "+1",
            "1.0",
            "1e3",
            " 1",
            "18446744073709551616",
        ] {
            assert!(exact_u64(text).is_err(), "{text}")
        }
    }
}
