//! Poll-driven MagicDNS adapter over the active E3-T17 provider Worker. Name lookup happens inside
//! the browser IPN; the proven Rust DNS forwarder still owns query parsing, response construction,
//! TTL caching, AAAA policy, and SERVFAIL behavior.

use std::cell::{Cell, RefCell};
use std::collections::{BTreeMap, VecDeque};
use std::future::Future;
use std::net::Ipv4Addr;
use std::pin::Pin;
use std::rc::Rc;
use std::sync::{Arc, Mutex};
use std::task::{Context, Poll, Waker};

use wasm_bindgen::JsCast;
use wasm_bindgen::closure::Closure;
use wasm_bindgen::prelude::*;
use wasm_bindgen_futures::spawn_local;
use wasm_vm_slirp::{
    DnsCompletion, DnsForwarder, DnsRequest, DnsService, MAX_PENDING_DNS, Resolution, Resolver,
};
use web_sys::Worker;

const CACHE_ENTRIES: usize = 256;
const LOOKUP_TIMEOUT_MS: i32 = 4_000;

#[derive(Default)]
struct LookupFutureState {
    result: Option<Resolution>,
    waker: Option<Waker>,
}

struct LookupFuture {
    shared: Arc<Mutex<LookupFutureState>>,
}

impl Future for LookupFuture {
    type Output = Resolution;

    fn poll(self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<Self::Output> {
        let mut state = self.shared.lock().expect("MagicDNS future mutex");
        if let Some(result) = state.result.take() {
            Poll::Ready(result)
        } else {
            state.waker = Some(cx.waker().clone());
            Poll::Pending
        }
    }
}

pub(crate) struct LookupRegistry {
    pending: RefCell<BTreeMap<u32, Arc<Mutex<LookupFutureState>>>>,
    next_id: Cell<u32>,
}

impl LookupRegistry {
    fn complete(&self, id: u32, result: Resolution) {
        let Some(shared) = self.pending.borrow_mut().remove(&id) else {
            return;
        };
        let wake = {
            let mut state = shared.lock().expect("MagicDNS completion mutex");
            state.result = Some(result);
            state.waker.take()
        };
        if let Some(waker) = wake {
            waker.wake();
        }
    }

    fn fail_all(&self) {
        let ids: Vec<u32> = self.pending.borrow().keys().copied().collect();
        for id in ids {
            self.complete(id, Resolution::Failed);
        }
    }
}

#[derive(Clone)]
struct WorkerResolver {
    worker: Worker,
    registry: Rc<LookupRegistry>,
}

impl Resolver for WorkerResolver {
    fn resolve(&self, name: &str) -> impl Future<Output = Resolution> + Send {
        let id = self.registry.next_id.get();
        self.registry.next_id.set(id.wrapping_add(1));
        let shared = Arc::new(Mutex::new(LookupFutureState::default()));
        self.registry
            .pending
            .borrow_mut()
            .insert(id, shared.clone());

        let message = js_sys::Object::new();
        let built = js_sys::Reflect::set(
            &message,
            &JsValue::from_str("type"),
            &JsValue::from_str("lookup"),
        )
        .and_then(|_| {
            js_sys::Reflect::set(
                &message,
                &JsValue::from_str("id"),
                &JsValue::from_f64(id as f64),
            )
        })
        .and_then(|_| {
            js_sys::Reflect::set(
                &message,
                &JsValue::from_str("name"),
                &JsValue::from_str(name),
            )
        });
        if built.is_err() || self.worker.post_message(&message).is_err() {
            self.registry.complete(id, Resolution::Failed);
            return LookupFuture { shared };
        }

        let timeout_registry = Rc::clone(&self.registry);
        let timeout = Closure::once_into_js(move || {
            timeout_registry.complete(id, Resolution::Failed);
        });
        let function = timeout.unchecked_ref::<js_sys::Function>();
        let global = js_sys::global();
        let armed = global
            .dyn_ref::<web_sys::Window>()
            .and_then(|window| {
                window
                    .set_timeout_with_callback_and_timeout_and_arguments_0(
                        function,
                        LOOKUP_TIMEOUT_MS,
                    )
                    .ok()
            })
            .is_some();
        if !armed {
            self.registry.complete(id, Resolution::Failed);
        }
        LookupFuture { shared }
    }
}

pub(crate) struct BrowserTailscaleDnsService {
    shared: Rc<RefCell<ServiceState>>,
}

struct ServiceState {
    requests: VecDeque<DnsRequest>,
    completions: VecDeque<DnsCompletion>,
    forwarder: Option<DnsForwarder<WorkerResolver>>,
    running: bool,
}

impl BrowserTailscaleDnsService {
    pub(crate) fn new(worker: Worker, registry: Rc<LookupRegistry>) -> Self {
        let resolver = WorkerResolver { worker, registry };
        Self {
            shared: Rc::new(RefCell::new(ServiceState {
                requests: VecDeque::new(),
                completions: VecDeque::new(),
                forwarder: Some(DnsForwarder::new(resolver, CACHE_ENTRIES)),
                running: false,
            })),
        }
    }

    fn ensure_worker(&self) {
        {
            let mut state = self.shared.borrow_mut();
            if state.running || state.requests.is_empty() {
                return;
            }
            state.running = true;
        }
        let shared = Rc::clone(&self.shared);
        spawn_local(async move {
            loop {
                let (request, mut forwarder) = {
                    let mut state = shared.borrow_mut();
                    let Some(request) = state.requests.pop_front() else {
                        state.running = false;
                        break;
                    };
                    let forwarder = state
                        .forwarder
                        .take()
                        .expect("MagicDNS worker owns its forwarder");
                    (request, forwarder)
                };
                let message = forwarder.handle(&request.message, request.now_ms).await;
                let mut state = shared.borrow_mut();
                state.forwarder = Some(forwarder);
                state.completions.push_back(DnsCompletion {
                    id: request.id,
                    message,
                });
            }
        });
    }
}

impl DnsService for BrowserTailscaleDnsService {
    fn submit(&mut self, request: DnsRequest) -> Result<(), DnsRequest> {
        {
            let mut state = self.shared.borrow_mut();
            let in_flight = usize::from(state.running);
            if state.requests.len() + state.completions.len() + in_flight >= MAX_PENDING_DNS {
                return Err(request);
            }
            state.requests.push_back(request);
        }
        self.ensure_worker();
        Ok(())
    }

    fn poll(&mut self) -> Vec<DnsCompletion> {
        self.shared.borrow_mut().completions.drain(..).collect()
    }

    fn pending(&self) -> bool {
        let state = self.shared.borrow();
        state.running || !state.requests.is_empty() || !state.completions.is_empty()
    }
}

pub(crate) fn new_registry() -> Rc<LookupRegistry> {
    Rc::new(LookupRegistry {
        pending: RefCell::new(BTreeMap::new()),
        next_id: Cell::new(0),
    })
}

pub(crate) fn accept_lookup_result(registry: &LookupRegistry, data: &JsValue) {
    let id = js_sys::Reflect::get(data, &JsValue::from_str("id"))
        .ok()
        .and_then(|value| value.as_f64())
        .filter(|value| value.fract() == 0.0 && *value >= 0.0 && *value <= u32::MAX as f64)
        .map(|value| value as u32);
    let Some(id) = id else { return };
    let failed = js_sys::Reflect::get(data, &JsValue::from_str("failed"))
        .ok()
        .and_then(|value| value.as_bool())
        .unwrap_or(false);
    if failed {
        registry.complete(id, Resolution::Failed);
        return;
    }
    let addresses = js_sys::Reflect::get(data, &JsValue::from_str("addresses"))
        .ok()
        .map(|value| js_sys::Array::from(&value));
    let Some(addresses) = addresses else {
        registry.complete(id, Resolution::Failed);
        return;
    };
    let ips = addresses
        .iter()
        .filter_map(|value| value.as_string())
        .filter_map(|value| value.parse::<Ipv4Addr>().ok())
        .collect();
    registry.complete(id, Resolution::Resolved { ips, ttl_secs: 30 });
}

pub(crate) fn fail_all(registry: &LookupRegistry) {
    registry.fail_all();
}
