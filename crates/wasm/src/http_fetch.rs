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
    BlockCache, FetchFailure, ImageManifest, Readahead, ResponseAction, RetryPolicy, boot_prefetch,
    classify_response, plan_fetches,
};

use std::cell::RefCell;

/// Sequential readahead depth (chunks ahead of a detected forward run).
const READAHEAD_WINDOW: usize = 4;
/// Max speculative (readahead + boot-profile) fetches issued per pump tick — the concurrency cap,
/// bounding the extra work a tick does on top of the demand chunks the guest is parked on.
const PREFETCH_CAP: usize = 8;

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
    /// Sequential-readahead detector (E3-T03): a forward run of demand misses prefetches ahead.
    pub readahead: RefCell<Readahead>,
    /// The ordered first-touch demand-access list — the recording that becomes `boot-profile.json`.
    pub access_log: RefCell<Vec<usize>>,
    access_seen: RefCell<BTreeSet<usize>>,
    /// An input boot profile (ordered chunks to prefetch at boot); empty if none supplied.
    pub boot_profile: Vec<usize>,
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
        boot_profile: Vec<usize>,
    ) -> FetchState {
        FetchState {
            manifest,
            base_url,
            store,
            in_flight: RefCell::new(BTreeSet::new()),
            pinned: RefCell::new(BTreeSet::new()),
            retry: RetryPolicy::DEFAULT,
            readahead: RefCell::new(Readahead::new(READAHEAD_WINDOW)),
            access_log: RefCell::new(Vec::new()),
            access_seen: RefCell::new(BTreeSet::new()),
            boot_profile,
            fetch_count: Cell::new(0),
            bytes_transferred: Cell::new(0),
            last_error: RefCell::new(None),
        }
    }

    /// The recorded boot access profile as a JSON array of chunk indices (dev-mode recorder →
    /// `boot-profile.json`).
    pub fn boot_profile_json(&self) -> String {
        let log = self.access_log.borrow();
        let mut s = String::with_capacity(log.len() * 6 + 2);
        s.push('[');
        for (i, c) in log.iter().enumerate() {
            if i > 0 {
                s.push(',');
            }
            s.push_str(&c.to_string());
        }
        s.push(']');
        s
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
    // Record demand accesses (the boot profile), note prefetch hits, and detect sequential runs. Done
    // in one scoped borrow block so nothing is held across the awaits below.
    let mut readahead_targets: Vec<usize> = Vec::new();
    {
        let mut ra = state.readahead.borrow_mut();
        let mut log = state.access_log.borrow_mut();
        let mut seen = state.access_seen.borrow_mut();
        for &c in pending {
            if seen.insert(c) {
                log.push(c); // first-touch order → the recorded boot profile
            }
            readahead_targets.extend(ra.observe(c));
        }
    }

    // 1) DEMAND: fetch the chunks the guest is parked on FIRST (lowest latency), pinning each so a
    //    tight budget can't evict it before the parked read re-executes.
    let demand = plan_fetches(
        pending,
        |c| state.store.borrow().contains(c),
        &state.in_flight.borrow(),
    );
    let mut done = 0u32;
    for chunk in demand {
        state.in_flight.borrow_mut().insert(chunk);
        let outcome = fetch_one(state, chunk).await;
        state.in_flight.borrow_mut().remove(&chunk);
        match outcome {
            Ok(()) => {
                state.store.borrow_mut().pin(chunk);
                state.pinned.borrow_mut().insert(chunk);
                done += 1;
            }
            Err(f) => record_error(state, chunk, f),
        }
    }

    // 2) PREFETCH: readahead targets + the next boot-profile batch, deduped against resident/in-flight,
    //    clamped to the image, capped at PREFETCH_CAP. Best-effort — NOT pinned (no parked read needs
    //    them), so eviction under pressure is harmless; counted for accuracy.
    let chunk_count = state.manifest.index().chunk_count() as usize;
    let profile_batch = boot_prefetch(&state.boot_profile, PREFETCH_CAP, |c| {
        !state.store.borrow().contains(c) && !state.in_flight.borrow().contains(&c)
    });
    let mut candidates: Vec<usize> = readahead_targets
        .into_iter()
        .chain(profile_batch)
        .filter(|&c| c < chunk_count)
        .collect();
    candidates = plan_fetches(
        &candidates,
        |c| state.store.borrow().contains(c),
        &state.in_flight.borrow(),
    );
    candidates.truncate(PREFETCH_CAP);
    for chunk in candidates {
        state.in_flight.borrow_mut().insert(chunk);
        let outcome = fetch_one(state, chunk).await;
        state.in_flight.borrow_mut().remove(&chunk);
        // Speculative: flag it in the cache (a later read HIT counts it as a paid-off prefetch), do
        // NOT pin. A prefetch failure is silent (the guest never asked for it); only demand errors
        // surface.
        if outcome.is_ok() {
            state.store.borrow_mut().note_prefetch(chunk);
        }
    }
    done
}

/// Record the first permanent fetch failure (the guest already saw an I/O error for it).
fn record_error(state: &Rc<FetchState>, chunk: usize, f: FetchFailure) {
    let msg = format!("chunk {chunk}: {f:?}");
    log::error!("lazy fetch failed — {msg}");
    let mut slot = state.last_error.borrow_mut();
    if slot.is_none() {
        *slot = Some(msg);
    }
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
                            // Insert only; the caller pins DEMAND chunks (a prefetched chunk is not
                            // pinned — nothing is parked on it). Pinning stays a caller decision so a
                            // tiny budget can't evict a demand chunk before its parked read re-executes.
                            Ok(()) => {
                                state.store.borrow_mut().insert(chunk, body);
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
