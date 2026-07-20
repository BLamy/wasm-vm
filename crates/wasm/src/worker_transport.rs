//! Browser Worker transport for provider-neutral ws-proxy frames.
//!
//! E3-T17's Tailscale runtime lives in a dedicated Worker, but the slirp side deliberately keeps
//! speaking E3-T16's `FrameTransport` protocol. The Worker receives `{type:"configure", config}`
//! once, then `{type:"frame", bytes}` messages in both directions. Configuration is passed as a
//! structured-clone value (never in a URL); the Rust boot slot is consumed when the Worker starts,
//! so one-time auth keys are not retained by wasm-vm after provisioning.

use std::cell::RefCell;
use std::rc::Rc;

use crate::ws_transport_state::TransportState;
use wasm_bindgen::JsCast;
use wasm_bindgen::closure::Closure;
use wasm_bindgen::prelude::*;
use wasm_vm_slirp::FrameTransport;
use wasm_vm_slirp::ws_proxy::Frame;
use web_sys::{ErrorEvent, MessageEvent, Worker, WorkerOptions, WorkerType};

pub(crate) struct BrowserWorkerTransport {
    worker: Worker,
    state: Rc<RefCell<TransportState>>,
    dns_registry: Rc<crate::tailscale_dns::LookupRegistry>,
    _on_message: Closure<dyn FnMut(MessageEvent)>,
    _on_error: Closure<dyn FnMut(ErrorEvent)>,
}

impl BrowserWorkerTransport {
    pub(crate) fn connect(url: &str, config: &JsValue) -> Result<Self, JsError> {
        let options = WorkerOptions::new();
        options.set_type(WorkerType::Module);
        options.set_name("wasm-vm-tailscale");
        let worker = Worker::new_with_options(url, &options)
            .map_err(|e| JsError::new(&format!("cannot start Tailscale worker {url:?}: {e:?}")))?;
        let state = Rc::new(RefCell::new(TransportState::default()));
        let dns_registry = crate::tailscale_dns::new_registry();

        let message_state = state.clone();
        let message_dns = Rc::clone(&dns_registry);
        let on_message = Closure::wrap(Box::new(move |event: MessageEvent| {
            let data = event.data();
            let kind = js_sys::Reflect::get(&data, &JsValue::from_str("type"))
                .ok()
                .and_then(|value| value.as_string());
            match kind.as_deref() {
                Some("frame") => {
                    let Ok(bytes) = js_sys::Reflect::get(&data, &JsValue::from_str("bytes")) else {
                        message_state.borrow_mut().mark_failed();
                        return;
                    };
                    let bytes = if bytes.is_instance_of::<js_sys::ArrayBuffer>() {
                        js_sys::Uint8Array::new(&bytes).to_vec()
                    } else if bytes.is_instance_of::<js_sys::Uint8Array>() {
                        bytes.unchecked_into::<js_sys::Uint8Array>().to_vec()
                    } else {
                        message_state.borrow_mut().mark_failed();
                        return;
                    };
                    message_state.borrow_mut().accept_inbound(&bytes);
                }
                Some("failed") => {
                    forward_control_event(&data);
                    crate::tailscale_dns::fail_all(&message_dns);
                    message_state.borrow_mut().mark_failed();
                }
                // Status/diagnostic messages are intentionally outside FrameTransport. The UI-side
                // controller consumes them; the guest data path ignores them.
                Some("status") | Some("storageUpdate") => forward_control_event(&data),
                Some("lookupResult") => {
                    crate::tailscale_dns::accept_lookup_result(&message_dns, &data)
                }
                _ => {
                    crate::tailscale_dns::fail_all(&message_dns);
                    message_state.borrow_mut().mark_failed();
                }
            }
        }) as Box<dyn FnMut(MessageEvent)>);
        worker.set_onmessage(Some(on_message.as_ref().unchecked_ref()));

        let error_state = state.clone();
        let error_dns = Rc::clone(&dns_registry);
        let on_error = Closure::wrap(Box::new(move |_event: ErrorEvent| {
            crate::tailscale_dns::fail_all(&error_dns);
            error_state.borrow_mut().mark_failed();
        }) as Box<dyn FnMut(ErrorEvent)>);
        worker.set_onerror(Some(on_error.as_ref().unchecked_ref()));

        let configure = js_sys::Object::new();
        js_sys::Reflect::set(
            &configure,
            &JsValue::from_str("type"),
            &JsValue::from_str("configure"),
        )
        .map_err(|e| JsError::new(&format!("cannot build Worker configure message: {e:?}")))?;
        js_sys::Reflect::set(&configure, &JsValue::from_str("config"), config)
            .map_err(|e| JsError::new(&format!("cannot attach Worker config: {e:?}")))?;
        worker
            .post_message(&configure)
            .map_err(|e| JsError::new(&format!("cannot configure Tailscale worker: {e:?}")))?;
        crate::slirp_net::set_slirp_tailscale_control(Some(worker.clone().into()));

        Ok(Self {
            worker,
            state,
            dns_registry,
            _on_message: on_message,
            _on_error: on_error,
        })
    }

    pub(crate) fn dns_service(&self) -> crate::tailscale_dns::BrowserTailscaleDnsService {
        crate::tailscale_dns::BrowserTailscaleDnsService::new(
            self.worker.clone(),
            Rc::clone(&self.dns_registry),
        )
    }
}

impl FrameTransport for BrowserWorkerTransport {
    fn send(&mut self, frame: Frame) {
        self.state.borrow_mut().queue_outbound(frame);
        let Some(bytes) = self.state.borrow_mut().pop_outbound() else {
            return;
        };
        let message = js_sys::Object::new();
        let array = js_sys::Uint8Array::from(bytes.as_slice());
        let set = js_sys::Reflect::set(
            &message,
            &JsValue::from_str("type"),
            &JsValue::from_str("frame"),
        )
        .and_then(|_| js_sys::Reflect::set(&message, &JsValue::from_str("bytes"), array.as_ref()));
        if set.is_err() || self.worker.post_message(&message).is_err() {
            self.state.borrow_mut().mark_failed();
        }
    }

    fn poll(&mut self) -> Vec<Frame> {
        self.state.borrow_mut().drain_inbound()
    }

    fn is_open(&self) -> bool {
        !self.state.borrow().failed()
    }
}

impl Drop for BrowserWorkerTransport {
    fn drop(&mut self) {
        crate::tailscale_dns::fail_all(&self.dns_registry);
        crate::slirp_net::set_slirp_tailscale_control(None);
        self.worker.set_onmessage(None);
        self.worker.set_onerror(None);
        self.worker.terminate();
    }
}

fn forward_control_event(data: &JsValue) {
    let global = js_sys::global();
    let Ok(handler) = js_sys::Reflect::get(&global, &JsValue::from_str("__wasmVmTailscaleEvent"))
    else {
        return;
    };
    if let Some(handler) = handler.dyn_ref::<js_sys::Function>() {
        let _ = handler.call1(&global, data);
    }
}
