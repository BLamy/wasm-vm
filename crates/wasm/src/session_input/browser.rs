use super::*;
use crate::{LinuxInner, WasmLinux, event_clock, reentrant};
use wasm_bindgen::prelude::*;

impl LinuxInner {
    pub(crate) fn capture_input(
        &mut self,
        channel: u16,
        bytes: &[u8],
        recorded: bool,
    ) -> Result<Outcome, JsError> {
        let Self {
            machine,
            pending,
            uart,
            file_transfers,
            input_capture,
            ..
        } = self;
        let capture = input_capture
            .as_mut()
            .ok_or_else(|| JsError::new("input capture is inactive"))?;
        let result = capture.apply(
            InputContext {
                machine,
                pending,
                uart,
                transfers: file_transfers.as_mut(),
            },
            channel,
            bytes,
            recorded,
        );
        if result.is_err() {
            capture.paused = true;
        }
        result.map_err(|e| JsError::new(&e))
    }
    pub(crate) fn refuse_capture_mutation(&self) -> Result<(), JsError> {
        if self.input_capture.is_some() {
            Err(JsError::new(
                "input prefix: unsupported mutation; stop and start a fresh machine",
            ))
        } else {
            Ok(())
        }
    }
}
fn exact_number(value: JsValue, max: u32) -> Result<u32, JsError> {
    value
        .as_f64()
        .filter(|n| n.is_finite() && n.fract() == 0.0 && *n >= 0.0 && *n <= f64::from(max))
        .map(|n| n as u32)
        .ok_or_else(|| JsError::new("input wire integer required"))
}
#[wasm_bindgen]
impl WasmLinux {
    /// Begin an input-only prefix at the caller's paused initial checkpoint. Provider completeness
    /// is deliberately not asserted here. Replay mode installs an ingress firewall, not a runner.
    #[wasm_bindgen(js_name=startInputCapture)]
    pub fn start_input_capture(&self, replay: bool) -> Result<(), JsError> {
        let mut inner = self.inner.try_borrow_mut().map_err(|_| reentrant())?;
        #[cfg(feature = "virgl-renderer")]
        let accelerated = inner.machine.control3d_proof_installed();
        #[cfg(not(feature = "virgl-renderer"))]
        let accelerated = false;
        if inner.input_capture.is_some()
            || inner.finished.is_some()
            || inner.pending.len() > MAX_UART_PENDING
            || inner.session_has_mic
            || inner.audio_attached
            || inner.capture_attached
            || accelerated
            || inner
                .file_transfers
                .as_ref()
                .is_some_and(|t| !t.input_prefix_ready())
        {
            return Err(JsError::new(
                "input capture requires fresh, quiescent software ICount input adapters",
            ));
        }
        inner
            .machine
            .start_session_clock(1)
            .map_err(|e| JsError::new(&format!("input clock: {e:?}")))?;
        inner.input_capture = Some(InputCapture::new(replay));
        Ok(())
    }
    /// Native witness only, deliberately not an admitted full provider checkpoint.
    #[wasm_bindgen(js_name=captureInputWitness)]
    pub fn capture_input_witness(&self) -> Result<JsValue, JsError> {
        let mut inner = self.inner.try_borrow_mut().map_err(|_| reentrant())?;
        inner.refuse_capture_mutation()?;
        if inner.session_has_initrd
            || inner.session_has_mic
            || inner.audio_attached
            || inner.capture_attached
            || inner.checkpoint_disk.is_none()
            || inner.machine.ram_len() > 256 << 20
            || inner.out.borrow().len() > MAX_UART_PENDING
            || inner.pending.len() > MAX_UART_PENDING
            || inner
                .file_transfers
                .as_ref()
                .is_some_and(|t| !t.input_prefix_ready())
        {
            return Err(JsError::new("input witness profile"));
        }
        let native = inner
            .machine
            .save_session_resume()
            .map_err(|e| JsError::new(&format!("input witness: {e:?}")))?;
        let disk = inner
            .checkpoint_disk
            .as_ref()
            .unwrap()
            .snapshot_delta(inner.machine.overlay_generation())
            .map_err(|e| JsError::new(&format!("input witness disk: {e:?}")))?
            .to_bytes();
        let object = js_sys::Object::new();
        let _ = js_sys::Reflect::set(
            &object,
            &"native".into(),
            &js_sys::Uint8Array::from(native.as_slice()),
        );
        let _ = js_sys::Reflect::set(
            &object,
            &"disk".into(),
            &js_sys::Uint8Array::from(disk.as_slice()),
        );
        let pending: Vec<u8> = inner.pending.iter().copied().collect();
        let _ = js_sys::Reflect::set(
            &object,
            &"pending".into(),
            &js_sys::Uint8Array::from(pending.as_slice()),
        );
        let _ = js_sys::Reflect::set(
            &object,
            &"output".into(),
            &js_sys::Uint8Array::from(inner.out.borrow().as_slice()),
        );
        Ok(object.into())
    }
    #[wasm_bindgen(js_name=inputPosition)]
    pub fn input_position(&self) -> Result<JsValue, JsError> {
        let inner = self.inner.try_borrow().map_err(|_| reentrant())?;
        let capture = inner
            .input_capture
            .as_ref()
            .ok_or_else(|| JsError::new("input capture is inactive"))?;
        let object = event_clock::position_object(inner.machine.session_position().unwrap());
        for (key, value) in [
            ("replay", capture.replay),
            ("paused", capture.paused),
            ("stopped", capture.stopped),
        ] {
            let _ = js_sys::Reflect::set(&object, &key.into(), &value.into());
        }
        Ok(object.into())
    }
    /// Pause=0, resume=1, stop=2. These controls consume the same ordered before-boundary keys.
    #[wasm_bindgen(js_name=inputLifecycle)]
    pub fn input_lifecycle(&self, control: JsValue) -> Result<(), JsError> {
        let control = exact_number(control, 2)? as u8;
        self.inner
            .try_borrow_mut()
            .map_err(|_| reentrant())?
            .capture_input(LIFECYCLE, &[control], false)?;
        Ok(())
    }
    #[wasm_bindgen(js_name=setInputPointerMode)]
    pub fn set_input_pointer_mode(&self, relative: bool) -> Result<(), JsError> {
        self.inner
            .try_borrow_mut()
            .map_err(|_| reentrant())?
            .capture_input(POINTER_MODE, &[u8::from(relative)], false)?;
        Ok(())
    }
    #[wasm_bindgen(js_name=takeInputDeliveries)]
    pub fn take_input_deliveries(&self) -> Result<JsValue, JsError> {
        let mut inner = self.inner.try_borrow_mut().map_err(|_| reentrant())?;
        if inner.input_capture.is_none() {
            return Err(JsError::new("input capture is inactive"));
        }
        let deliveries = inner
            .machine
            .take_session_deliveries()
            .map_err(|e| JsError::new(&format!("input receipts: {e:?}")))?;
        let out = js_sys::Array::new();
        for delivery in deliveries {
            let SessionEffect::HostInput { channel, bytes } = delivery.effect else {
                return Err(JsError::new("mixed diagnostic mailbox in input capture"));
            };
            let object = event_clock::position_object(delivery.position);
            let _ = js_sys::Reflect::set(&object, &"channel".into(), &channel.into());
            let _ = js_sys::Reflect::set(
                &object,
                &"bytes".into(),
                &js_sys::Uint8Array::from(bytes.as_slice()),
            );
            let values = js_sys::Array::new();
            for v in delivery.host_result.unwrap() {
                values.push(&v.to_string().into());
            }
            let _ = js_sys::Reflect::set(&object, &"outcome".into(), &values);
            out.push(&object);
        }
        Ok(out.into())
    }
    /// Trusted replay adapter seam. Every supplied key and outcome is checked; ordinary input
    /// methods cannot reach it. T14 will own authenticated cursor admission and execution.
    #[allow(clippy::too_many_arguments)] // Lossless wire coordinates are separate from owned payload bytes.
    #[wasm_bindgen(js_name=applyRecordedInput)]
    pub fn apply_recorded_input(
        &self,
        channel: JsValue,
        transition: &str,
        sequence: &str,
        ordinal: JsValue,
        retired: &str,
        bytes: js_sys::Uint8Array,
        expected: js_sys::Array,
    ) -> Result<(), JsError> {
        let channel = exact_number(channel, u16::MAX.into())? as u16;
        let transition = event_clock::exact_u64(transition).map_err(JsError::new)?;
        let sequence = event_clock::exact_u64(sequence).map_err(JsError::new)?;
        let retired = event_clock::exact_u64(retired).map_err(JsError::new)?;
        let ordinal = exact_number(ordinal, u32::MAX)?;
        if bytes.length() as usize > MAX_PAYLOAD || expected.length() != 4 {
            return Err(JsError::new("input replay bound"));
        }
        let mut outcome = [0; 4];
        for (i, value) in outcome.iter_mut().enumerate() {
            *value = event_clock::exact_u64(
                &expected
                    .get(i as u32)
                    .as_string()
                    .ok_or_else(|| JsError::new("input outcome must be an exact string"))?,
            )
            .map_err(JsError::new)?;
        }
        let mut inner = self.inner.try_borrow_mut().map_err(|_| reentrant())?;
        let position = inner
            .machine
            .session_position()
            .ok_or_else(|| JsError::new("input clock inactive"))?;
        if transition != position.transition
            || retired != position.retired
            || Some(sequence) != position.sequence.checked_add(1)
            || Some(ordinal) != position.ordinal.checked_add(1)
        {
            return Err(JsError::new("input replay cursor mismatch"));
        }
        let observed = inner.capture_input(channel, &bytes.to_vec(), true)?;
        if observed != outcome {
            let capture = inner.input_capture.as_mut().unwrap();
            capture.paused = true;
            capture.stopped = true;
            return Err(JsError::new(
                "input replay outcome mismatch; prefix stopped",
            ));
        }
        Ok(())
    }
}
