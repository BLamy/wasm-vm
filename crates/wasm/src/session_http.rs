//! One fixed, synchronous provider owned by the VM. JavaScript cannot retain a
//! separate live backend or supply frames/ports/callbacks through this API.
use crate::{LinuxInner, WasmLinux, reentrant};
use wasm_bindgen::prelude::*;
use wasm_vm_slirp::session_http::{OwnedHttpError, OwnedSessionHttp, PumpProgress};

fn error(error: OwnedHttpError) -> JsError {
    JsError::new(&format!("owned local HTTP: {error:?}"))
}
fn progress(value: PumpProgress) -> Result<JsValue, JsError> {
    js_sys::JSON::parse(
        &serde_json::json!({
            "blocked":value.blocked,"more":value.more,"closed":value.closed,
            "networkCursor":value.network_cursor.to_string(),
        })
        .to_string(),
    )
    .map_err(|_| JsError::new("owned local HTTP progress"))
}

#[wasm_bindgen]
impl WasmLinux {
    /// Opt into only 10.0.2.2:9191/e9/1..10, once for this VM's lifetime.
    /// The core refuses replay/offline construction before entering the factory.
    #[wasm_bindgen(js_name = openOwnedLocalHttp)]
    pub fn open_owned_local_http(&self) -> Result<(), JsError> {
        let mut inner = self.inner.try_borrow_mut().map_err(|_| reentrant())?;
        if inner.owned_http.is_some() {
            return Err(JsError::new("owned local HTTP already opened"));
        }
        let provider = OwnedSessionHttp::open(&inner.machine).map_err(error)?;
        inner.owned_http = Some(provider);
        Ok(())
    }

    /// Fixed 64-step work budget. Drain `more` before executing another CPU chunk;
    /// `blocked` requires capturing observations or letting the guest consume RX.
    #[wasm_bindgen(js_name = pumpOwnedLocalHttp)]
    pub fn pump_owned_local_http(&self) -> Result<JsValue, JsError> {
        let mut inner = self.inner.try_borrow_mut().map_err(|_| reentrant())?;
        let LinuxInner {
            machine,
            owned_http,
            ..
        } = &mut *inner;
        let provider = owned_http
            .as_mut()
            .ok_or_else(|| JsError::new("owned local HTTP not opened"))?;
        progress(provider.pump(machine).map_err(error)?)
    }

    #[wasm_bindgen(js_name = cancelOwnedLocalHttp)]
    pub fn cancel_owned_local_http(&self) -> Result<JsValue, JsError> {
        let mut inner = self.inner.try_borrow_mut().map_err(|_| reentrant())?;
        let LinuxInner {
            machine,
            owned_http,
            ..
        } = &mut *inner;
        let provider = owned_http
            .as_mut()
            .ok_or_else(|| JsError::new("owned local HTTP not opened"))?;
        progress(provider.cancel(machine).map_err(error)?)
    }

    /// Aggregate counters only; no additional frame, request or observation history.
    #[wasm_bindgen(js_name = ownedLocalHttpState)]
    pub fn owned_local_http_state(&self) -> Result<JsValue, JsError> {
        let inner = self.inner.try_borrow().map_err(|_| reentrant())?;
        let provider = inner
            .owned_http
            .as_ref()
            .ok_or_else(|| JsError::new("owned local HTTP not opened"))?;
        let pump = provider.stats();
        let http = provider.observer().snapshot();
        js_sys::JSON::parse(&serde_json::json!({
            "version":1,"closed":provider.closed(),
            "polls":pump.polls.to_string(),"clockMs":pump.clock_ms.to_string(),
            "txInjected":pump.tx_injected.to_string(),"txCommitted":pump.tx_committed.to_string(),
            "txCancelled":pump.tx_cancelled.to_string(),"rxCalls":pump.rx_calls.to_string(),
            "rxDequeued":pump.rx_dequeued.to_string(),"rxCommitted":pump.rx_committed.to_string(),
            "rxCancelled":pump.rx_cancelled.to_string(),"events":pump.events.to_string(),
            "server":{
                "connections":http.accepted_connections,"requests":http.requests,
                "responsesQueued":http.responses_queued,"bodyBytesQueued":http.body_bytes_queued,
                "invalid":http.invalid_requests,"timeouts":http.timed_out,
                "cancelled":http.cancelled_connections,"closed":http.closed,
                "failure":http.failure.map(|e| format!("{e:?}")),
            },
        }).to_string()).map_err(|_| JsError::new("owned local HTTP diagnostics"))
    }

    /// Independent payload-free tripwire. No replay VM or snapshot owns this value.
    #[wasm_bindgen(js_name = ownedLocalHttpFactoryEntries)]
    pub fn owned_local_http_factory_entries() -> String {
        wasm_vm_slirp::session_http::local_http_factory_entries().to_string()
    }
}
