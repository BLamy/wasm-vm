//! Exact, owned network ABI. Live transports are constructed only by the recording host.
#[cfg(all(target_arch = "wasm32", not(feature = "zicsr-stub")))]
use super::WasmLinux;
use super::{WasmMachine, event_clock, reentrant};
use wasm_bindgen::{JsCast, prelude::*};
use wasm_vm_core::{
    session_clock::{SessionPhase, SessionPosition},
    session_network::{MAX_FRAME, NetworkError, NetworkEvent, NetworkLease},
};
fn error(e: NetworkError) -> JsError {
    JsError::new(&format!("session_network: {e:?}"))
}
fn bytes(input: js_sys::Uint8Array) -> Result<Vec<u8>, JsError> {
    if input.length() as usize > MAX_FRAME + 64
        || !input.buffer().is_instance_of::<js_sys::ArrayBuffer>()
    {
        return Err(error(NetworkError::Payload));
    }
    Ok(input.to_vec())
}
#[wasm_bindgen]
pub struct SessionNetworkLease {
    lease: NetworkLease,
}
#[cfg(all(target_arch = "wasm32", not(feature = "zicsr-stub")))]
#[wasm_bindgen]
impl WasmLinux {
    #[wasm_bindgen(js_name = exactNetworkRequests)]
    pub fn exact_network_requests(&self) -> Result<JsValue, JsError> {
        let inner = self.inner.try_borrow().map_err(|_| reentrant())?;
        if inner.owned_http.is_some() {
            return Err(JsError::new(
                "network callbacks owned by local HTTP provider",
            ));
        }
        if inner.exact_session != Some(false) && inner.machine.live_unrecorded_work().is_none() {
            return Err(error(NetworkError::ReplayIngress));
        }
        let out = js_sys::Array::new();
        for request in inner.machine.session_network_requests().map_err(error)? {
            let object = js_sys::Object::new();
            js_sys::Reflect::set(&object, &"id".into(), &request.id.to_string().into()).unwrap();
            js_sys::Reflect::set(
                &object,
                &"frame".into(),
                &js_sys::Uint8Array::from(request.frame.as_slice()).into(),
            )
            .unwrap();
            out.push(&object);
        }
        Ok(out.into())
    }
    #[wasm_bindgen(js_name = exactLeaseNetworkRequest)]
    pub fn exact_lease_network_request(&self, id: &str) -> Result<SessionNetworkLease, JsError> {
        let inner = self.inner.try_borrow().map_err(|_| reentrant())?;
        if inner.owned_http.is_some() {
            return Err(JsError::new(
                "network callbacks owned by local HTTP provider",
            ));
        }
        if inner.exact_session != Some(false) && inner.machine.live_unrecorded_work().is_none() {
            return Err(error(NetworkError::ReplayIngress));
        }
        let id = if id.is_empty() {
            None
        } else {
            Some(event_clock::exact_u64(id).map_err(JsError::new)?)
        };
        Ok(SessionNetworkLease {
            lease: inner.machine.lease_session_network(id).map_err(error)?,
        })
    }
    #[wasm_bindgen(js_name = exactCompleteNetworkEvent)]
    pub fn exact_complete_network_event(
        &self,
        lease: &SessionNetworkLease,
        input: js_sys::Uint8Array,
    ) -> Result<(), JsError> {
        let mut inner = self.inner.try_borrow_mut().map_err(|_| reentrant())?;
        if inner.owned_http.is_some() {
            return Err(JsError::new(
                "network callbacks owned by local HTTP provider",
            ));
        }
        if inner.exact_session != Some(false) && inner.machine.live_unrecorded_work().is_none() {
            return Err(error(NetworkError::ReplayIngress));
        }
        let event = NetworkEvent::decode(&bytes(input)?).map_err(error)?;
        inner
            .machine
            .complete_session_network(&lease.lease, event)
            .map_err(error)
    }
}
#[wasm_bindgen]
impl WasmMachine {
    #[wasm_bindgen(js_name=installNetworkSession)]
    pub fn install_network_session(&self, replay: JsValue) -> Result<(), JsError> {
        let replay = replay
            .as_bool()
            .ok_or_else(|| error(NetworkError::Payload))?;
        self.inner
            .try_borrow_mut()
            .map_err(|_| reentrant())?
            .machine
            .enable_session_network(replay)
            .map_err(error)
    }
    #[wasm_bindgen(js_name=networkSessionReplay)]
    pub fn network_session_replay(&self) -> Result<bool, JsError> {
        self.inner
            .try_borrow()
            .map_err(|_| reentrant())?
            .machine
            .session_network_replay()
            .map_err(error)
    }
    #[wasm_bindgen(js_name=networkCursor)]
    pub fn network_cursor(&self) -> Result<String, JsError> {
        self.inner
            .try_borrow()
            .map_err(|_| reentrant())?
            .machine
            .session_network_cursor()
            .map(|n| n.to_string())
            .map_err(error)
    }
    #[wasm_bindgen(js_name=networkRequests)]
    pub fn network_requests(&self) -> Result<JsValue, JsError> {
        let inner = self.inner.try_borrow().map_err(|_| reentrant())?;
        let out = js_sys::Array::new();
        for r in inner.machine.session_network_requests().map_err(error)? {
            let object = js_sys::Object::new();
            js_sys::Reflect::set(&object, &"id".into(), &r.id.to_string().into()).unwrap();
            js_sys::Reflect::set(
                &object,
                &"frame".into(),
                &js_sys::Uint8Array::from(r.frame.as_slice()),
            )
            .unwrap();
            out.push(&object);
        }
        Ok(out.into())
    }
    #[wasm_bindgen(js_name=leaseNetworkRequest)]
    pub fn lease_network_request(&self, id: &str) -> Result<SessionNetworkLease, JsError> {
        let id = if id.is_empty() {
            None
        } else {
            Some(event_clock::exact_u64(id).map_err(JsError::new)?)
        };
        Ok(SessionNetworkLease {
            lease: self
                .inner
                .try_borrow()
                .map_err(|_| reentrant())?
                .machine
                .lease_session_network(id)
                .map_err(error)?,
        })
    }
    #[wasm_bindgen(js_name=completeNetworkEvent)]
    pub fn complete_network_event(
        &self,
        lease: &SessionNetworkLease,
        input: js_sys::Uint8Array,
    ) -> Result<(), JsError> {
        let event = NetworkEvent::decode(&bytes(input)?).map_err(error)?;
        self.inner
            .try_borrow_mut()
            .map_err(|_| reentrant())?
            .machine
            .complete_session_network(&lease.lease, event)
            .map_err(error)
    }
    #[wasm_bindgen(js_name=replayNetworkEvent)]
    pub fn replay_network_event(
        &self,
        transition: &str,
        retired: &str,
        sequence: &str,
        ordinal: JsValue,
        input: js_sys::Uint8Array,
    ) -> Result<(), JsError> {
        let ordinal = ordinal
            .as_f64()
            .filter(|n| n.is_finite() && n.fract() == 0.0 && *n > 0.0 && *n <= u32::MAX as f64)
            .ok_or_else(|| error(NetworkError::Position))? as u32;
        let position = SessionPosition {
            transition: event_clock::exact_u64(transition).map_err(JsError::new)?,
            retired: event_clock::exact_u64(retired).map_err(JsError::new)?,
            sequence: event_clock::exact_u64(sequence).map_err(JsError::new)?,
            phase: SessionPhase::Before,
            ordinal,
        };
        let event = NetworkEvent::decode(&bytes(input)?).map_err(error)?;
        self.inner
            .try_borrow_mut()
            .map_err(|_| reentrant())?
            .machine
            .replay_session_network(position, event)
            .map_err(error)
    }
    #[wasm_bindgen(js_name=finishNetworkReplay)]
    pub fn finish_network_replay(&self, cursor: &str) -> Result<(), JsError> {
        let cursor = event_clock::exact_u64(cursor).map_err(JsError::new)?;
        self.inner
            .try_borrow()
            .map_err(|_| reentrant())?
            .machine
            .finish_session_network_replay(cursor)
            .map_err(error)
    }
    // Host-input deliveries share one event clock; this is the same owned receipt ABI as T12.
    #[wasm_bindgen(js_name=takeNetworkDeliveries)]
    pub fn take_network_deliveries(&self) -> Result<JsValue, JsError> {
        self.take_device_deliveries()
    }
}
