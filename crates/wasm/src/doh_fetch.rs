//! Browser DNS reactor: RFC 8484 wire-format DoH over `fetch`, adapted to slirp's synchronous
//! poll-driven [`wasm_vm_slirp::DnsService`] seam.

use std::cell::RefCell;
use std::collections::VecDeque;
use std::future::Future;
use std::pin::Pin;
use std::rc::Rc;
use std::sync::{Arc, Mutex};
use std::task::{Context, Poll, Waker};

use js_sys::Uint8Array;
use wasm_bindgen::JsCast;
use wasm_bindgen::closure::Closure;
use wasm_bindgen_futures::{JsFuture, spawn_local};
use web_sys::{AbortController, Request, RequestInit, Response};

use wasm_vm_slirp::{
    DnsCompletion, DnsForwarder, DnsRequest, DnsService, DohResolver, DohTransport, MAX_PENDING_DNS,
};

pub const DEFAULT_DOH_ENDPOINT: &str = "https://cloudflare-dns.com/dns-query";
// BusyBox may retry one DNS question three times. Keep the per-fetch ceiling low enough that an
// unreachable endpoint still yields guest-visible SERVFAIL within the task's five-second budget.
const DEFAULT_DOH_TIMEOUT_MS: i32 = 1_000;
const DNS_CACHE_ENTRIES: usize = 256;
const MAX_DOH_RESPONSE: u32 = u16::MAX as u32;

#[derive(Clone)]
struct FetchDohTransport {
    endpoint: String,
    timeout_ms: i32,
}

impl DohTransport for FetchDohTransport {
    fn post(&self, query: &[u8]) -> impl Future<Output = Option<Vec<u8>>> + Send {
        let shared = Arc::new(Mutex::new(FetchFutureState::default()));
        let completion = Arc::clone(&shared);
        let endpoint = self.endpoint.clone();
        let query = query.to_vec();
        let timeout_ms = self.timeout_ms;
        // JsFuture is intentionally confined to this browser-local task. The returned future only
        // contains Arc<Mutex<plain Rust state>>, so it upholds DohTransport's Send contract while
        // remaining valid on today's single-threaded wasm event loop.
        spawn_local(async move {
            let result = post_dns_message(&endpoint, &query, timeout_ms).await;
            let wake = {
                let mut state = completion.lock().expect("DoH completion mutex");
                state.result = Some(result);
                state.waker.take()
            };
            if let Some(waker) = wake {
                waker.wake();
            }
        });
        FetchDohFuture { shared }
    }
}

#[derive(Default)]
struct FetchFutureState {
    /// Outer None = pending; Some(None) = transport failure; Some(Some(bytes)) = success.
    result: Option<Option<Vec<u8>>>,
    waker: Option<Waker>,
}

struct FetchDohFuture {
    shared: Arc<Mutex<FetchFutureState>>,
}

impl Future for FetchDohFuture {
    type Output = Option<Vec<u8>>;

    fn poll(self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<Self::Output> {
        let mut state = self.shared.lock().expect("DoH future mutex");
        if let Some(result) = state.result.take() {
            Poll::Ready(result)
        } else {
            state.waker = Some(cx.waker().clone());
            Poll::Pending
        }
    }
}

pub struct BrowserDnsService {
    shared: Rc<RefCell<BrowserDnsState>>,
}

struct BrowserDnsState {
    requests: VecDeque<DnsRequest>,
    completions: VecDeque<DnsCompletion>,
    forwarder: Option<DnsForwarder<DohResolver<FetchDohTransport>>>,
    running: bool,
}

impl BrowserDnsService {
    pub fn new(endpoint: String) -> Self {
        let transport = FetchDohTransport {
            endpoint,
            timeout_ms: DEFAULT_DOH_TIMEOUT_MS,
        };
        Self {
            shared: Rc::new(RefCell::new(BrowserDnsState {
                requests: VecDeque::new(),
                completions: VecDeque::new(),
                forwarder: Some(DnsForwarder::new(
                    DohResolver::new(transport),
                    DNS_CACHE_ENTRIES,
                )),
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
                        .expect("the one browser DNS worker owns the forwarder");
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

impl DnsService for BrowserDnsService {
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

async fn post_dns_message(endpoint: &str, query: &[u8], timeout_ms: i32) -> Option<Vec<u8>> {
    let controller = AbortController::new().ok()?;
    arm_abort_timeout(controller.clone(), timeout_ms)?;

    let options = RequestInit::new();
    options.set_method("POST");
    options.set_signal(Some(&controller.signal()));
    let body = Uint8Array::from(query);
    options.set_body(&body.into());
    let request = Request::new_with_str_and_init(endpoint, &options).ok()?;
    request
        .headers()
        .set("Content-Type", "application/dns-message")
        .ok()?;
    request
        .headers()
        .set("Accept", "application/dns-message")
        .ok()?;

    let response: Response = JsFuture::from(fetch(&request).ok()?)
        .await
        .ok()?
        .dyn_into()
        .ok()?;
    if response.status() != 200 {
        return None;
    }
    let buffer = JsFuture::from(response.array_buffer().ok()?).await.ok()?;
    let bytes = Uint8Array::new(&buffer);
    if bytes.length() > MAX_DOH_RESPONSE {
        return None;
    }
    Some(bytes.to_vec())
}

fn fetch(request: &Request) -> Result<js_sys::Promise, wasm_bindgen::JsValue> {
    let global = js_sys::global();
    if let Some(window) = global.dyn_ref::<web_sys::Window>() {
        Ok(window.fetch_with_request(request))
    } else if let Some(scope) = global.dyn_ref::<web_sys::WorkerGlobalScope>() {
        Ok(scope.fetch_with_request(request))
    } else {
        Err(wasm_bindgen::JsValue::from_str(
            "no fetch-capable global (Window/Worker)",
        ))
    }
}

fn arm_abort_timeout(controller: AbortController, timeout_ms: i32) -> Option<()> {
    let callback = Closure::once_into_js(move || controller.abort());
    let function = callback.unchecked_ref::<js_sys::Function>();
    let global = js_sys::global();
    if let Some(window) = global.dyn_ref::<web_sys::Window>() {
        window
            .set_timeout_with_callback_and_timeout_and_arguments_0(function, timeout_ms)
            .ok()?;
    } else if let Some(scope) = global.dyn_ref::<web_sys::WorkerGlobalScope>() {
        scope
            .set_timeout_with_callback_and_timeout_and_arguments_0(function, timeout_ms)
            .ok()?;
    } else {
        return None;
    }
    Some(())
}
