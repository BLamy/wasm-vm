//! Browser ABI for the core owned-completion adapters. Complete Linux replay is admitted by T14;
//! this API also supports independently loaded bare-metal guests without test-only core behavior.
#[cfg(all(target_arch = "wasm32", not(feature = "zicsr-stub")))]
use super::WasmLinux;
use super::{WasmMachine, event_clock, reentrant};
use serde::Deserialize;
use wasm_bindgen::JsCast;
use wasm_bindgen::prelude::*;
use wasm_vm_core::{
    bus::Bus,
    session_clock::{SessionPhase, SessionPosition},
    session_devices::{
        BaseDisk, CompletionLease, CompletionStatus, DeviceCompletion, DeviceError, MAX_RESULT,
        PayloadRef,
    },
};

fn error(error: DeviceError) -> JsError {
    JsError::new(&format!("session_devices: {error:?}"))
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Reference {
    sha256: String,
    length: u32,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Base {
    identity: String,
    sectors: String,
    chunk_bytes: u32,
    chunks: Vec<Reference>,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Configuration {
    version: u32,
    base: Option<Base>,
    agent: bool,
    capture: bool,
}
fn hash(text: &str) -> Result<[u8; 32], DeviceError> {
    if text.len() != 64
        || !text
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
    {
        return Err(DeviceError::Payload);
    }
    let mut out = [0; 32];
    for (i, byte) in out.iter_mut().enumerate() {
        *byte =
            u8::from_str_radix(&text[i * 2..i * 2 + 2], 16).map_err(|_| DeviceError::Payload)?;
    }
    Ok(out)
}
fn parse(text: &str) -> Result<(Option<BaseDisk>, bool, bool), DeviceError> {
    if text.len() > (8 << 20) {
        return Err(DeviceError::Limit);
    }
    let c: Configuration = serde_json::from_str(text).map_err(|_| DeviceError::Payload)?;
    if c.version != 1 {
        return Err(DeviceError::Unsupported);
    }
    let base = c
        .base
        .map(|b| {
            let sectors = event_clock::exact_u64(&b.sectors).map_err(|_| DeviceError::Payload)?;
            let chunks = b
                .chunks
                .into_iter()
                .map(|r| {
                    Ok(PayloadRef {
                        sha256: hash(&r.sha256)?,
                        length: r.length,
                    })
                })
                .collect::<Result<Vec<_>, DeviceError>>()?;
            let base = BaseDisk {
                identity: hash(&b.identity)?,
                sectors,
                chunk_bytes: b.chunk_bytes,
                chunks,
            };
            base.validate()?;
            Ok(base)
        })
        .transpose()?;
    Ok((base, c.agent, c.capture))
}
fn exact(value: JsValue, max: u32) -> Result<u32, JsError> {
    value
        .as_f64()
        .filter(|n| n.is_finite() && n.fract() == 0.0 && *n >= 0.0 && *n <= f64::from(max))
        .map(|n| n as u32)
        .ok_or_else(|| error(DeviceError::Payload))
}
#[wasm_bindgen]
pub struct SessionDeviceLease {
    lease: CompletionLease,
}
#[cfg(all(target_arch = "wasm32", not(feature = "zicsr-stub")))]
#[wasm_bindgen]
impl WasmLinux {
    #[wasm_bindgen(js_name = exactDeviceRequests)]
    pub fn exact_device_requests(&self) -> Result<JsValue, JsError> {
        use wasm_vm_core::session_devices::DeviceIntent;
        let inner = self.inner.try_borrow().map_err(|_| reentrant())?;
        if inner.exact_session != Some(false) {
            return Err(error(DeviceError::ReplayIngress));
        }
        let out = js_sys::Array::new();
        for request in inner.machine.session_device_requests().map_err(error)? {
            let intent = match request.intent {
                DeviceIntent::BaseBlock { chunk, content } => {
                    serde_json::json!({"kind":"block","chunk":chunk,"content":{"sha256":content.sha256.iter().map(|b|format!("{b:02x}")).collect::<String>(),"length":content.length}})
                }
                DeviceIntent::Agent {
                    generation,
                    maximum,
                } => {
                    serde_json::json!({"kind":"agent","generation":generation.to_string(),"maximum":maximum})
                }
                DeviceIntent::Capture {
                    samples,
                    rate,
                    channels,
                } => {
                    serde_json::json!({"kind":"capture","samples":samples,"rate":rate,"channels":channels})
                }
            };
            out.push(
                &js_sys::JSON::parse(
                    &serde_json::json!({"id":request.id.to_string(),"intent":intent}).to_string(),
                )
                .map_err(|_| error(DeviceError::Payload))?,
            );
        }
        Ok(out.into())
    }
    #[wasm_bindgen(js_name = exactLeaseDeviceRequest)]
    pub fn exact_lease_device_request(&self, id: &str) -> Result<SessionDeviceLease, JsError> {
        let inner = self.inner.try_borrow().map_err(|_| reentrant())?;
        if inner.exact_session != Some(false) {
            return Err(error(DeviceError::ReplayIngress));
        }
        let id = event_clock::exact_u64(id).map_err(JsError::new)?;
        Ok(SessionDeviceLease {
            lease: inner.machine.lease_session_device(id).map_err(error)?,
        })
    }
    #[wasm_bindgen(js_name = exactCompleteDeviceRequest)]
    pub fn exact_complete_device_request(
        &self,
        lease: &SessionDeviceLease,
        status: JsValue,
        frames: JsValue,
        bytes: js_sys::Uint8Array,
    ) -> Result<(), JsError> {
        let mut inner = self.inner.try_borrow_mut().map_err(|_| reentrant())?;
        if inner.exact_session != Some(false) {
            return Err(error(DeviceError::ReplayIngress));
        }
        let status = match exact(status, 2)? {
            0 => CompletionStatus::Supplied,
            1 => CompletionStatus::Failed,
            _ => CompletionStatus::Cancelled,
        };
        let frames = exact(frames, u32::MAX)?;
        if bytes.length() as usize > MAX_RESULT
            || !bytes.buffer().is_instance_of::<js_sys::ArrayBuffer>()
        {
            return Err(error(DeviceError::Payload));
        }
        inner
            .machine
            .complete_session_device(&lease.lease, status, frames, bytes.to_vec())
            .map_err(error)
    }
}
#[wasm_bindgen]
impl WasmMachine {
    #[wasm_bindgen(js_name=installDeviceSession)]
    pub fn install_device_session(
        &self,
        configuration: &str,
        replay: JsValue,
    ) -> Result<(), JsError> {
        let replay = replay
            .as_bool()
            .ok_or_else(|| error(DeviceError::Payload))?;
        let (base, agent, capture) = parse(configuration).map_err(error)?;
        self.inner
            .try_borrow_mut()
            .map_err(|_| reentrant())?
            .machine
            .enable_session_devices(base, agent, capture, replay)
            .map_err(error)
    }
    #[wasm_bindgen(js_name=deviceRequests)]
    pub fn device_requests(&self) -> Result<JsValue, JsError> {
        use wasm_vm_core::session_devices::DeviceIntent;
        let inner = self.inner.try_borrow().map_err(|_| reentrant())?;
        let requests = js_sys::Array::new();
        for request in inner.machine.session_device_requests().map_err(error)? {
            let intent = match request.intent {
                DeviceIntent::BaseBlock { chunk, content } => {
                    serde_json::json!({"kind":"block","chunk":chunk,"content":{"sha256":content.sha256.iter().map(|b|format!("{b:02x}")).collect::<String>(),"length":content.length}})
                }
                DeviceIntent::Agent {
                    generation,
                    maximum,
                } => {
                    serde_json::json!({"kind":"agent","generation":generation.to_string(),"maximum":maximum})
                }
                DeviceIntent::Capture {
                    samples,
                    rate,
                    channels,
                } => {
                    serde_json::json!({"kind":"capture","samples":samples,"rate":rate,"channels":channels})
                }
            };
            requests.push(
                &js_sys::JSON::parse(
                    &serde_json::json!({"id":request.id.to_string(),"intent":intent}).to_string(),
                )
                .map_err(|_| error(DeviceError::Payload))?,
            );
        }
        Ok(requests.into())
    }
    #[wasm_bindgen(js_name=leaseDeviceRequest)]
    pub fn lease_device_request(&self, id: &str) -> Result<SessionDeviceLease, JsError> {
        let id = event_clock::exact_u64(id).map_err(JsError::new)?;
        Ok(SessionDeviceLease {
            lease: self
                .inner
                .try_borrow()
                .map_err(|_| reentrant())?
                .machine
                .lease_session_device(id)
                .map_err(error)?,
        })
    }
    #[wasm_bindgen(js_name=completeDeviceRequest)]
    pub fn complete_device_request(
        &self,
        lease: &SessionDeviceLease,
        status: JsValue,
        frames: JsValue,
        bytes: js_sys::Uint8Array,
    ) -> Result<(), JsError> {
        let status = match exact(status, 2)? {
            0 => CompletionStatus::Supplied,
            1 => CompletionStatus::Failed,
            _ => CompletionStatus::Cancelled,
        };
        let frames = exact(frames, u32::MAX)?;
        if bytes.length() as usize > MAX_RESULT
            || !bytes.buffer().is_instance_of::<js_sys::ArrayBuffer>()
        {
            return Err(error(DeviceError::Payload));
        }
        self.inner
            .try_borrow_mut()
            .map_err(|_| reentrant())?
            .machine
            .complete_session_device(&lease.lease, status, frames, bytes.to_vec())
            .map_err(error)
    }
    #[wasm_bindgen(js_name=replayDeviceCompletion)]
    pub fn replay_device_completion(
        &self,
        transition: &str,
        retired: &str,
        sequence: &str,
        ordinal: JsValue,
        bytes: js_sys::Uint8Array,
    ) -> Result<(), JsError> {
        let mut inner = self.inner.try_borrow_mut().map_err(|_| reentrant())?;
        let position = SessionPosition {
            transition: event_clock::exact_u64(transition).map_err(JsError::new)?,
            retired: event_clock::exact_u64(retired).map_err(JsError::new)?,
            sequence: event_clock::exact_u64(sequence).map_err(JsError::new)?,
            phase: SessionPhase::Before,
            ordinal: exact(ordinal, u32::MAX)?,
        };
        if bytes.length() as usize > MAX_RESULT + 128
            || !bytes.buffer().is_instance_of::<js_sys::ArrayBuffer>()
        {
            return Err(error(DeviceError::Payload));
        }
        inner
            .machine
            .replay_session_device(
                position,
                DeviceCompletion::decode(&bytes.to_vec()).map_err(error)?,
            )
            .map_err(error)
    }
    #[wasm_bindgen(js_name=takeDeviceDeliveries)]
    pub fn take_device_deliveries(&self) -> Result<JsValue, JsError> {
        let mut inner = self.inner.try_borrow_mut().map_err(|_| reentrant())?;
        let out = js_sys::Array::new();
        for delivery in inner
            .machine
            .take_session_deliveries()
            .map_err(|e| JsError::new(&format!("session_devices: {e:?}")))?
        {
            let object = event_clock::position_object(delivery.position);
            let wasm_vm_core::session_clock::SessionEffect::HostInput { channel, bytes } =
                delivery.effect
            else {
                return Err(error(DeviceError::Unsupported));
            };
            let outcome = delivery
                .host_result
                .ok_or_else(|| error(DeviceError::Payload))?;
            let values = js_sys::Array::new();
            for value in outcome {
                values.push(&value.to_string().into());
            }
            let _ = js_sys::Reflect::set(&object, &"channel".into(), &channel.into());
            let _ = js_sys::Reflect::set(
                &object,
                &"bytes".into(),
                &js_sys::Uint8Array::from(bytes.as_slice()).into(),
            );
            let _ = js_sys::Reflect::set(&object, &"outcome".into(), &values.into());
            out.push(&object.into());
        }
        Ok(out.into())
    }
    #[wasm_bindgen(js_name=readDeviceMemory)]
    pub fn read_device_memory(&self, address: &str, length: JsValue) -> Result<Vec<u8>, JsError> {
        let address = event_clock::exact_u64(address).map_err(JsError::new)?;
        let length = exact(length, 1048576)?;
        let mut inner = self.inner.try_borrow_mut().map_err(|_| reentrant())?;
        let base = inner.machine.ram_base();
        let end = base + inner.machine.ram_len() as u64;
        if address < base
            || address
                .checked_add(u64::from(length))
                .is_none_or(|n| n > end)
        {
            return Err(error(DeviceError::Payload));
        }
        (0..length)
            .map(|i| {
                inner
                    .machine
                    .bus_mut()
                    .load8(address + u64::from(i))
                    .map_err(|_| error(DeviceError::Payload))
            })
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn configuration_rejects_unknown_versions_fields_and_wrapping_numbers() {
        assert!(parse(r#"{"version":1,"base":null,"agent":true,"capture":true}"#).is_ok());
        for text in [
            r#"{"version":2,"base":null,"agent":true,"capture":true}"#,
            r#"{"version":1,"base":null,"agent":true,"capture":true,"live":true}"#,
            r#"{"version":1,"base":null,"agent":true,"capture":1}"#,
        ] {
            assert!(parse(text).is_err());
        }
        assert!(hash(&"A".repeat(64)).is_err());
        assert!(hash(&"0".repeat(63)).is_err());
    }
}
