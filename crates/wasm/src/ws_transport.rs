//! Browser WebSocket transport for the synchronous slirp `WsConnector`.
//!
//! JavaScript delivers WebSocket messages between `runChunk` calls. The transport queues decoded
//! protocol frames in callbacks; the machine's `NetBackend::poll` hook drains them on the next run
//! boundary. Outbound protocol frames are sent immediately once the socket is open, or queued while
//! the opening handshake is still in progress. Both queues have hard byte caps so a stalled or
//! hostile relay cannot grow the wasm heap without bound.

use std::cell::RefCell;
use std::rc::Rc;

use crate::ws_transport_state::TransportState;
use wasm_bindgen::JsCast;
use wasm_bindgen::closure::Closure;
use wasm_bindgen::prelude::*;
use wasm_vm_slirp::FrameTransport;
use wasm_vm_slirp::ws_proxy::Frame;
use web_sys::{BinaryType, Event, MessageEvent, WebSocket};

/// A non-blocking `FrameTransport` backed by the browser's native `WebSocket`.
pub(crate) struct BrowserWebSocketTransport {
    socket: WebSocket,
    state: Rc<RefCell<TransportState>>,
    _on_message: Closure<dyn FnMut(MessageEvent)>,
    _on_close: Closure<dyn FnMut(Event)>,
    _on_error: Closure<dyn FnMut(Event)>,
}

impl BrowserWebSocketTransport {
    pub(crate) fn connect(url: &str) -> Result<Self, JsError> {
        let socket = WebSocket::new(url)
            .map_err(|e| JsError::new(&format!("cannot open slirp relay {url:?}: {e:?}")))?;
        socket.set_binary_type(BinaryType::Arraybuffer);
        let state = Rc::new(RefCell::new(TransportState::default()));

        let message_state = state.clone();
        let on_message = Closure::wrap(Box::new(move |event: MessageEvent| {
            let Ok(buffer) = event.data().dyn_into::<js_sys::ArrayBuffer>() else {
                message_state.borrow_mut().mark_failed();
                return;
            };
            let bytes = js_sys::Uint8Array::new(&buffer).to_vec();
            message_state.borrow_mut().accept_inbound(&bytes);
        }) as Box<dyn FnMut(MessageEvent)>);
        socket.set_onmessage(Some(on_message.as_ref().unchecked_ref()));

        let close_state = state.clone();
        let on_close = Closure::wrap(Box::new(move |_event: Event| {
            close_state.borrow_mut().mark_failed();
        }) as Box<dyn FnMut(Event)>);
        socket.set_onclose(Some(on_close.as_ref().unchecked_ref()));

        let error_state = state.clone();
        let on_error = Closure::wrap(Box::new(move |_event: Event| {
            error_state.borrow_mut().mark_failed();
        }) as Box<dyn FnMut(Event)>);
        socket.set_onerror(Some(on_error.as_ref().unchecked_ref()));

        Ok(Self {
            socket,
            state,
            _on_message: on_message,
            _on_close: on_close,
            _on_error: on_error,
        })
    }

    fn flush_outbound(&mut self) {
        if self.socket.ready_state() != WebSocket::OPEN {
            return;
        }
        loop {
            let bytes = {
                let mut state = self.state.borrow_mut();
                let Some(bytes) = state.pop_outbound() else {
                    break;
                };
                bytes
            };
            if self.socket.send_with_u8_array(&bytes).is_err() {
                self.state.borrow_mut().mark_failed();
                break;
            }
        }
    }
}

impl FrameTransport for BrowserWebSocketTransport {
    fn send(&mut self, frame: Frame) {
        self.state.borrow_mut().queue_outbound(frame);
        self.flush_outbound();
    }

    fn poll(&mut self) -> Vec<Frame> {
        self.flush_outbound();
        self.state.borrow_mut().drain_inbound()
    }

    fn is_open(&self) -> bool {
        if self.state.borrow().failed() {
            return false;
        }
        matches!(
            self.socket.ready_state(),
            WebSocket::CONNECTING | WebSocket::OPEN
        )
    }
}

impl Drop for BrowserWebSocketTransport {
    fn drop(&mut self) {
        self.socket.set_onmessage(None);
        self.socket.set_onclose(None);
        self.socket.set_onerror(None);
        let _ = self.socket.close();
    }
}
