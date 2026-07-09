//! E3-T02 pass 3: the browser `fetch` glue for lazy chunk loading. Deliberately THIN — every
//! decision (URL/Range, accept/retry/fail, hash verification, dedup, backoff schedule) is made by
//! the natively-tested `wasm-vm-storage` code; this module only performs the actual network I/O and
//! drives that logic. It exists solely on `wasm32`.
//!
//! Flow per pump tick: read the device's parked chunks (`pending_blk_chunks`), dedup against what is
//! resident or already in-flight (`plan_fetches`), fetch each missing chunk (per-chunk file for
//! `split`, `Range:` for `blob`), verify its hash on arrival (`ChunkStore::provide`), and populate
//! the shared store. A parked virtio-blk read then completes on the next `runChunk` boundary.

use std::cell::Cell;
use std::collections::BTreeSet;
use std::rc::Rc;

use js_sys::Uint8Array;
use wasm_bindgen::JsCast;
use wasm_bindgen::prelude::*;
use wasm_bindgen_futures::JsFuture;
use web_sys::{Request, RequestInit, Response};

use wasm_vm_storage::{
    BlockCache, FetchFailure, ImageManifest, ResponseAction, RetryPolicy, classify_response,
    plan_fetches,
};

use std::cell::RefCell;

/// Everything the fetch layer needs, shared (via `Rc`) so a `runChunk` between two `fetchPending`
/// calls never aliases a borrow held across an `await`. Interior mutability via `RefCell`/`Cell`.
pub struct FetchState {
    pub manifest: ImageManifest,
    /// Directory URL the manifest was loaded from (must end in `/`).
    pub base_url: String,
    /// The bounded cache (E3-T03), shared with the `ChunkedBackend` inside the machine — verified
    /// chunks are inserted here and read there.
    pub store: Rc<RefCell<BlockCache>>,
    /// Chunks with a fetch in progress (dedup: one fetch per chunk even under concurrent misses).
    pub in_flight: RefCell<BTreeSet<usize>>,
    /// Chunks pinned against eviction because a parked guest read still needs them (E3-T03). Unpinned
    /// once the read completes (the chunk drops out of `pending_blk_chunks`), reconciled each tick.
    pub pinned: RefCell<BTreeSet<usize>>,
    pub retry: RetryPolicy,
    /// Instrumentation for the pass-4 acceptance (< 40% of the image transferred to reach login).
    pub fetch_count: Cell<u32>,
    pub bytes_transferred: Cell<u64>,
    /// The first permanent fetch failure, surfaced to JS (the guest already saw an I/O error).
    pub last_error: RefCell<Option<String>>,
}

impl FetchState {
    pub fn new(
        manifest: ImageManifest,
        base_url: String,
        store: Rc<RefCell<BlockCache>>,
    ) -> FetchState {
        FetchState {
            manifest,
            base_url,
            store,
            in_flight: RefCell::new(BTreeSet::new()),
            pinned: RefCell::new(BTreeSet::new()),
            retry: RetryPolicy::DEFAULT,
            fetch_count: Cell::new(0),
            bytes_transferred: Cell::new(0),
            last_error: RefCell::new(None),
        }
    }
}

/// Fetch every not-yet-resident chunk in `pending` (deduped), verifying and caching each. Returns the
/// number of chunks newly made resident. Fetches are issued sequentially — correctness over latency;
/// each pump tick only surfaces the handful of chunks the guest just touched.
pub async fn fetch_pending(state: &Rc<FetchState>, pending: &[usize]) -> u32 {
    // Reconcile pins first: a chunk we pinned for an in-flight read that is no longer parked has been
    // consumed — release it so the cache can evict it under pressure (E3-T03 pinning lifecycle).
    {
        let mut pinned = state.pinned.borrow_mut();
        let completed: Vec<usize> = pinned
            .iter()
            .copied()
            .filter(|c| !pending.contains(c))
            .collect();
        for c in completed {
            state.store.borrow_mut().unpin(c);
            pinned.remove(&c);
        }
    }
    let plan = plan_fetches(
        pending,
        |c| state.store.borrow().contains(c),
        &state.in_flight.borrow(),
    );
    let mut done = 0u32;
    for chunk in plan {
        state.in_flight.borrow_mut().insert(chunk);
        let outcome = fetch_one(state, chunk).await;
        state.in_flight.borrow_mut().remove(&chunk);
        match outcome {
            Ok(()) => done += 1,
            Err(f) => {
                let msg = format!("chunk {chunk}: {f:?}");
                log::error!("lazy fetch failed — {msg}");
                let mut slot = state.last_error.borrow_mut();
                if slot.is_none() {
                    *slot = Some(msg);
                }
            }
        }
    }
    done
}

/// Fetch, verify, and cache a single chunk with bounded retry + backoff. A transient failure
/// (network error, 5xx/408/429, or a hash mismatch) is retried per [`RetryPolicy`]; a permanent one
/// (a non-retryable status, or `blob`-layout 200-instead-of-206) fails immediately; exhausting the
/// retries yields [`FetchFailure::RetriesExhausted`]. Never buffers a full-image 200 body.
async fn fetch_one(state: &Rc<FetchState>, chunk: usize) -> Result<(), FetchFailure> {
    let req = state
        .manifest
        .chunk_request(&state.base_url, chunk)
        // A malformed manifest here is a hard bug, not a transient — treat as permanent.
        .map_err(|_| FetchFailure::HttpStatus { status: 0 })?;

    let mut attempt = 0u32;
    loop {
        // CRITICAL (critic pass-3 FINDING 1): classify on the RESPONSE STATUS first and read the body
        // ONLY on Accept. The body is not downloaded until we read it, so a `blob`-layout server that
        // ignored Range and returned 200 (a full-image body) is refused WITHOUT buffering it — never
        // stream/copy 400 MB just to throw it away.
        match http_send(&req.url, req.range).await {
            Ok(resp) => match classify_response(state.manifest.layout, resp.status()) {
                ResponseAction::Accept => match read_body(&resp).await {
                    Ok(body) => {
                        state.fetch_count.set(state.fetch_count.get() + 1);
                        state
                            .bytes_transferred
                            .set(state.bytes_transferred.get() + body.len() as u64);
                        // Verify BEFORE caching — the bounded cache is raw bytes, so the hash check
                        // that ChunkStore.provide used to do lives here now. A mismatch/truncation is
                        // a corrupt delivery: retry, never cache or serve the bad bytes.
                        match state.manifest.verify_chunk(chunk, &body) {
                            Ok(()) => {
                                state.store.borrow_mut().insert(chunk, body);
                                // Pin against eviction until the parked guest read completes (E3-T03):
                                // a tiny budget could otherwise evict this chunk before the read that
                                // asked for it re-executes, livelocking the boot. Reconciled next tick.
                                state.store.borrow_mut().pin(chunk);
                                state.pinned.borrow_mut().insert(chunk);
                                return Ok(());
                            }
                            Err(_) if state.retry.should_retry(attempt) => {}
                            Err(_) => return Err(FetchFailure::RetriesExhausted { chunk }),
                        }
                    }
                    // The body stream faulted mid-download (truncated) — retryable.
                    Err(_) if state.retry.should_retry(attempt) => {}
                    Err(_) => return Err(FetchFailure::RetriesExhausted { chunk }),
                },
                // A server that ignored Range, or a 4xx — permanent, surface at once (body unread).
                ResponseAction::Fail(f) => return Err(f),
                // 5xx/408/429 — retryable.
                ResponseAction::Retry if state.retry.should_retry(attempt) => {}
                ResponseAction::Retry => return Err(FetchFailure::RetriesExhausted { chunk }),
            },
            // A network-level error (offline, CORS, DNS) — retryable.
            Err(_) if state.retry.should_retry(attempt) => {}
            Err(_) => return Err(FetchFailure::RetriesExhausted { chunk }),
        }
        sleep_ms(state.retry.backoff_ms(attempt)).await;
        attempt += 1;
    }
}

/// Send a GET for `url` (optionally with an inclusive `Range`) and await the RESPONSE HEADERS only —
/// the status is available, but the body is NOT read (so it is not downloaded). A rejected promise
/// (network/CORS) is `Err`. The caller inspects the status and reads the body via [`read_body`] only
/// if it decides to accept — this is what makes the 200-not-206 refusal free of a full-body buffer.
async fn http_send(url: &str, range: Option<(u64, u64)>) -> Result<Response, JsValue> {
    let opts = RequestInit::new();
    opts.set_method("GET");
    let req = Request::new_with_str_and_init(url, &opts)?;
    if let Some((first, last)) = range {
        req.headers()
            .set("Range", &format!("bytes={first}-{last}"))?;
    }
    let resp_val = JsFuture::from(fetch(&req)?).await?;
    resp_val.dyn_into()
}

/// Read the (accepted) response body as bytes. For a `206` this is exactly the requested slice; we
/// only ever call this after [`classify_response`] returned `Accept`, so a full-image `200` body is
/// never read here.
async fn read_body(resp: &Response) -> Result<Vec<u8>, JsValue> {
    let buf = JsFuture::from(resp.array_buffer()?).await?;
    Ok(Uint8Array::new(&buf).to_vec())
}

/// `fetch(req)` against whichever global is present (a Window on the main thread, or a
/// WorkerGlobalScope). Returns the promise (or an error if no fetch-capable global exists).
fn fetch(req: &Request) -> Result<js_sys::Promise, JsValue> {
    let global = js_sys::global();
    if let Some(window) = global.dyn_ref::<web_sys::Window>() {
        Ok(window.fetch_with_request(req))
    } else if let Some(scope) = global.dyn_ref::<web_sys::WorkerGlobalScope>() {
        Ok(scope.fetch_with_request(req))
    } else {
        Err(JsValue::from_str("no fetch-capable global (Window/Worker)"))
    }
}

/// Resolve after `ms` milliseconds, via `setTimeout` on the current global. Used for retry backoff.
/// A `0` delay resolves on the next microtask turn without arming a timer.
async fn sleep_ms(ms: u64) {
    if ms == 0 {
        return;
    }
    let promise = js_sys::Promise::new(&mut |resolve, _reject| {
        let global = js_sys::global();
        let cb = resolve.unchecked_ref::<js_sys::Function>();
        let ms = ms as i32;
        if let Some(window) = global.dyn_ref::<web_sys::Window>() {
            let _ = window.set_timeout_with_callback_and_timeout_and_arguments_0(cb, ms);
        } else if let Some(scope) = global.dyn_ref::<web_sys::WorkerGlobalScope>() {
            let _ = scope.set_timeout_with_callback_and_timeout_and_arguments_0(cb, ms);
        }
    });
    let _ = JsFuture::from(promise).await;
}
