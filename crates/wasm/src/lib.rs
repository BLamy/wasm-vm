//! wasm-vm-wasm: the thin `wasm-bindgen` boundary over `wasm-vm-core`.
//!
//! Rule of the house (architectural bet #2): this crate adapts types and marshals calls —
//! `Vec<u8>` ↔ `Uint8Array`, `u64` registers ↔ `BigUint64Array`, `Result` → thrown
//! `JsError`. Emulator logic that sneaks in here can't be tested natively and doesn't
//! survive review.
//!
//! Re-entrancy is real and handled: a JS console callback that calls back into the machine
//! (`step`/`run`) would alias the borrow. The whole machine lives behind one `RefCell`, and
//! every entry point takes `&self` + `try_borrow_mut`, so a re-entrant call throws a
//! catchable `JsError` — never a wasm `unreachable` abort.

use core::cell::RefCell;
use core::fmt::Write as _;
use core::sync::atomic::{AtomicBool, Ordering};

use wasm_bindgen::prelude::*;
// E4-T29 Phase 2: the in-wasm (browser) compiled-block executor.
mod jit_browser;
pub use jit_browser::{BROWSER_MAX_BATCHES, BrowserExecutor};
use wasm_vm_core::bus::mmap::{UART0_BASE, UART0_LEN};
use wasm_vm_core::dev::console::{ConsoleSink, Uart0Stub};
use wasm_vm_core::trace::{TraceRecord, TraceSink, fmt_canonical};
use wasm_vm_core::{Machine, RunOutcome};
// E3-T12d: the resume-snapshot format + coherence/restore-decision types (browser persistence glue).
#[cfg(all(target_arch = "wasm32", not(feature = "zicsr-stub")))]
use sha2::{Digest, Sha256};
#[cfg(all(target_arch = "wasm32", not(feature = "zicsr-stub")))]
use wasm_vm_core::resume;

// E3-net: browser-only (the boot site that consumes these is wasm+non-zicsr-gated), so gate the whole
// toggle to the same cfg — otherwise the const/fn are dead code on the native `-D warnings` clippy job.
#[cfg(all(target_arch = "wasm32", not(feature = "zicsr-stub")))]
mod slirp_net {
    use core::cell::RefCell;
    use core::sync::atomic::{AtomicBool, AtomicU32, Ordering};
    use wasm_bindgen::JsCast;
    use wasm_bindgen::prelude::*;

    /// Gateway MAC for the browser slirp local stack (distinct from the guest's virtio-net MAC
    /// 52:54:00:12:34:56). The guest learns it via ARP for the gateway 10.0.2.2.
    pub(crate) const SLIRP_GATEWAY_MAC: [u8; 6] = [0x52, 0x54, 0x00, 0x12, 0x34, 0x02];

    /// When set, boots wire virtio-net to the slirp LOCAL stack (DHCP/ARP/ICMP) instead of loopback.
    /// Single-threaded browser → a plain atomic suffices. Set via `setSlirpNet` BEFORE booting.
    static SLIRP_NET: AtomicBool = AtomicBool::new(false);
    static SLIRP_LEASE_SECS: AtomicU32 = AtomicU32::new(wasm_vm_slirp::dhcp::DEFAULT_LEASE_SECS);
    static SLIRP_MTU: AtomicU32 = AtomicU32::new(wasm_vm_slirp::dhcp::DEFAULT_MTU as u32);
    std::thread_local! {
        static SLIRP_RELAY_URL: RefCell<Option<String>> = const { RefCell::new(None) };
        static SLIRP_RELAY_TOKEN: RefCell<Option<String>> = const { RefCell::new(None) };
        static SLIRP_TAILSCALE_WORKER: RefCell<Option<(String, JsValue)>> = const { RefCell::new(None) };
        static SLIRP_TAILSCALE_CONTROL: RefCell<Option<JsValue>> = const { RefCell::new(None) };
        static SLIRP_DOH_ENDPOINT: RefCell<Option<String>> = const { RefCell::new(None) };
        static SLIRP_DHCP_STATS: RefCell<Option<wasm_vm_slirp::DhcpStatsHandle>> = const { RefCell::new(None) };
    }

    pub(crate) fn slirp_net_enabled() -> bool {
        SLIRP_NET.load(Ordering::Relaxed)
    }

    pub(crate) fn slirp_relay_url() -> Option<String> {
        SLIRP_RELAY_URL.with(|url| url.borrow().clone())
    }

    pub(crate) fn take_slirp_relay_token() -> Vec<u8> {
        SLIRP_RELAY_TOKEN.with(|token| token.borrow_mut().take().unwrap_or_default().into_bytes())
    }

    pub(crate) fn take_slirp_tailscale_worker() -> Option<(String, JsValue)> {
        SLIRP_TAILSCALE_WORKER.with(|slot| slot.borrow_mut().take())
    }

    pub(crate) fn set_slirp_tailscale_control(worker: Option<JsValue>) {
        SLIRP_TAILSCALE_CONTROL.with(|slot| *slot.borrow_mut() = worker);
    }

    pub(crate) fn slirp_doh_endpoint() -> String {
        SLIRP_DOH_ENDPOINT.with(|endpoint| {
            endpoint
                .borrow()
                .clone()
                .unwrap_or_else(|| crate::doh_fetch::DEFAULT_DOH_ENDPOINT.to_owned())
        })
    }

    pub(crate) fn slirp_lease_secs() -> u32 {
        SLIRP_LEASE_SECS.load(Ordering::Relaxed).max(1)
    }

    pub(crate) fn slirp_mtu() -> u16 {
        SLIRP_MTU.load(Ordering::Relaxed).clamp(576, 1500) as u16
    }

    pub(crate) fn set_slirp_dhcp_stats(stats: wasm_vm_slirp::DhcpStatsHandle) {
        SLIRP_DHCP_STATS.with(|slot| *slot.borrow_mut() = Some(stats));
    }

    /// Choose the slirp local network stack (vs the default loopback) for subsequent boots.
    #[wasm_bindgen(js_name = setSlirpNet)]
    pub fn set_slirp_net(on: bool) {
        SLIRP_NET.store(on, Ordering::Relaxed);
        SLIRP_DHCP_STATS.with(|slot| *slot.borrow_mut() = None);
    }

    /// Configure the WebSocket relay used for outbound TCP on subsequent slirp boots. An empty URL
    /// keeps the local-only DHCP/ARP/ICMP stack.
    #[wasm_bindgen(js_name = setSlirpRelay)]
    pub fn set_slirp_relay(url: String) {
        SLIRP_RELAY_URL.with(|slot| {
            *slot.borrow_mut() = if url.trim().is_empty() {
                None
            } else {
                Some(url)
            };
        });
    }

    /// Stage a short-lived relay credential for exactly the next boot. It is kept out of URLs and
    /// consumed when the connector is constructed, so a later boot cannot silently replay it.
    #[wasm_bindgen(js_name = setSlirpRelayToken)]
    pub fn set_slirp_relay_token(token: String) {
        SLIRP_RELAY_TOKEN.with(|slot| {
            *slot.borrow_mut() = if token.is_empty() { None } else { Some(token) };
        });
    }

    /// Configure the dedicated Tailscale provider Worker for the next slirp boot. The structured
    /// config is consumed when the Worker starts; credentials are never placed in the Worker URL.
    /// Empty `url` selects no Tailscale provider and drops any previously staged config.
    #[wasm_bindgen(js_name = setSlirpTailscaleWorker)]
    pub fn set_slirp_tailscale_worker(url: String, config: JsValue) {
        SLIRP_TAILSCALE_WORKER.with(|slot| {
            *slot.borrow_mut() = if url.trim().is_empty() {
                None
            } else {
                Some((url, config))
            };
        });
    }

    /// Send a credential-free lifecycle command to the active provider Worker. Returns false when
    /// no Tailscale provider owns this boot (relay/offline selection never creates a Worker).
    #[wasm_bindgen(js_name = slirpTailscaleCommand)]
    pub fn slirp_tailscale_command(command: String) -> bool {
        if !matches!(command.as_str(), "login" | "logout" | "dispose") {
            return false;
        }
        SLIRP_TAILSCALE_CONTROL.with(|slot| {
            let Some(worker) = slot.borrow().as_ref().cloned() else {
                return false;
            };
            let Ok(post) = js_sys::Reflect::get(&worker, &JsValue::from_str("postMessage")) else {
                return false;
            };
            let Some(post) = post.dyn_ref::<js_sys::Function>() else {
                return false;
            };
            let message = js_sys::Object::new();
            if js_sys::Reflect::set(
                &message,
                &JsValue::from_str("type"),
                &JsValue::from_str(&command),
            )
            .is_err()
            {
                return false;
            }
            post.call1(&worker, &message).is_ok()
        })
    }

    /// Configure the RFC 8484 wire-format DoH endpoint. Empty restores the production default.
    #[wasm_bindgen(js_name = setSlirpDohEndpoint)]
    pub fn set_slirp_doh_endpoint(endpoint: String) {
        SLIRP_DOH_ENDPOINT.with(|slot| {
            *slot.borrow_mut() = if endpoint.trim().is_empty() {
                None
            } else {
                Some(endpoint)
            };
        });
    }

    /// Configure the DHCP lease duration for subsequent boots (used by the renewal acceptance).
    #[wasm_bindgen(js_name = setSlirpDhcpLeaseSeconds)]
    pub fn set_slirp_dhcp_lease_seconds(seconds: u32) {
        SLIRP_LEASE_SECS.store(seconds.max(1), Ordering::Relaxed);
    }

    /// Configure the DHCP-advertised link MTU for subsequent boots.
    #[wasm_bindgen(js_name = setSlirpMtu)]
    pub fn set_slirp_mtu(mtu: u32) {
        SLIRP_MTU.store(mtu.clamp(576, 1500), Ordering::Relaxed);
    }

    /// Snapshot the current boot's production DHCP exchanges for evidence and diagnostics.
    #[wasm_bindgen(js_name = slirpDhcpStats)]
    pub fn slirp_dhcp_stats() -> String {
        SLIRP_DHCP_STATS.with(|slot| {
            let Some(handle) = slot.borrow().as_ref().cloned() else {
                return "null".to_owned();
            };
            let stats = handle.snapshot();
            format!(
                "{{\"discovers\":{},\"offers\":{},\"requests\":{},\"acks\":{},\"renewRequests\":{},\"renewAcks\":{},\"naks\":{}}}",
                stats.discovers,
                stats.offers,
                stats.requests,
                stats.acks,
                stats.renew_requests,
                stats.renew_acks,
                stats.naks,
            )
        })
    }
}
#[cfg(all(target_arch = "wasm32", not(feature = "zicsr-stub")))]
use slirp_net::{
    SLIRP_GATEWAY_MAC, set_slirp_dhcp_stats, slirp_doh_endpoint, slirp_lease_secs, slirp_mtu,
    slirp_net_enabled, slirp_relay_url, take_slirp_relay_token, take_slirp_tailscale_worker,
};

// E3-T02 lazy-fetch backend. Compiled where it is actually used: the normal wasm build (behind
// `newChunkedDisk`) and native unit tests. Excluded from the zicsr-stub wasm build and the native
// lib build so it is never dead code under `-D warnings`.
#[cfg(any(all(target_arch = "wasm32", not(feature = "zicsr-stub")), test))]
mod chunked;
#[cfg(all(test, not(feature = "zicsr-stub")))]
mod critic_flush_reset;
// E3-T10 storage-error classification — pure string logic, native-tested.
#[cfg(any(all(target_arch = "wasm32", not(feature = "zicsr-stub")), test))]
mod storage_err;
// The web-sys `fetch` glue is browser-only.
#[cfg(all(target_arch = "wasm32", not(feature = "zicsr-stub")))]
mod http_fetch;
// E3-T15: browser DoH fetch transport + bounded poll-driven DNS worker.
#[cfg(all(target_arch = "wasm32", not(feature = "zicsr-stub")))]
mod doh_fetch;
// The web-sys IndexedDB durable-overlay store is browser-only.
#[cfg(all(target_arch = "wasm32", not(feature = "zicsr-stub")))]
mod idb_store;
// E3-T12d: the web-sys IndexedDB durable resume-snapshot store (chunked blob) is browser-only.
#[cfg(all(target_arch = "wasm32", not(feature = "zicsr-stub")))]
mod snapshot_store;
// E3-net: JS WebSocket callbacks ↔ synchronous ws-proxy connector queues.
#[cfg(all(target_arch = "wasm32", not(feature = "zicsr-stub")))]
mod ws_transport;
#[cfg(any(all(target_arch = "wasm32", not(feature = "zicsr-stub")), test))]
mod ws_transport_state;
// virtio-rng entropy source backed by the browser CSPRNG (`crypto.getRandomValues`).
#[cfg(all(target_arch = "wasm32", not(feature = "zicsr-stub")))]
mod crypto_entropy;
// E3-T21c: browser producer/consumer queues over the VM-private WVFT agent sockets.
#[cfg(all(target_arch = "wasm32", not(feature = "zicsr-stub")))]
mod browser_file_transfer;
#[cfg(all(target_arch = "wasm32", not(feature = "zicsr-stub")))]
mod tailscale_dns;
#[cfg(all(target_arch = "wasm32", not(feature = "zicsr-stub")))]
mod worker_transport;

/// Incremental SHA-256 for browser `File.stream()` inputs. The UI hashes in bounded chunks before
/// offering a WVFT upload, avoiding `File.arrayBuffer()` and its whole-file heap spike.
#[cfg(all(target_arch = "wasm32", not(feature = "zicsr-stub")))]
#[wasm_bindgen]
pub struct FileSha256(Option<browser_file_transfer::IncrementalSha256>);

#[cfg(all(target_arch = "wasm32", not(feature = "zicsr-stub")))]
impl Default for FileSha256 {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(all(target_arch = "wasm32", not(feature = "zicsr-stub")))]
#[wasm_bindgen]
impl FileSha256 {
    #[wasm_bindgen(constructor)]
    pub fn new() -> Self {
        Self(Some(browser_file_transfer::IncrementalSha256::new()))
    }

    pub fn update(&mut self, bytes: &[u8]) -> Result<(), JsError> {
        self.0
            .as_mut()
            .ok_or_else(|| JsError::new("SHA-256 already finished"))?
            .update(bytes);
        Ok(())
    }

    pub fn finish(&mut self) -> Result<String, JsError> {
        self.0
            .take()
            .map(browser_file_transfer::IncrementalSha256::finish)
            .ok_or_else(|| JsError::new("SHA-256 already finished"))
    }
}

/// One-time browser diagnostics setup: route `log` to the JS console and install the
/// panic hook that turns Rust panics into readable console errors. Idempotent.
fn init_diagnostics() {
    static DONE: AtomicBool = AtomicBool::new(false);
    if DONE.swap(true, Ordering::SeqCst) {
        return;
    }
    console_error_panic_hook::set_once();
    let _ = console_log::init_with_level(log::Level::Debug);
}

#[wasm_bindgen(js_name = initLogging)]
pub fn init_logging() {
    init_diagnostics();
}

#[cfg(all(target_arch = "wasm32", not(feature = "zicsr-stub")))]
fn parse_overlay_seed_identity(identity: Option<String>) -> Result<Option<[u8; 32]>, JsError> {
    identity
        .map(|hex| {
            browser_file_transfer::parse_sha256(&hex).map_err(|_| {
                JsError::new("overlay seed identity must be exactly 64 hex characters")
            })
        })
        .transpose()
}

/// The core crate version, exposed to JS.
#[wasm_bindgen]
pub fn version() -> String {
    wasm_vm_core::version().into()
}

/// E3-T10: the IndexedDB database name that holds a given image's durable overlay — so the
/// "reset disk" flow can `indexedDB.deleteDatabase(name)` for THIS image only (a second image's
/// overlay, in a different DB, survives). Same derivation the durable store uses
/// (`overlay_store_name(base_hash)` for legacy boots, or the exact shipped RAM+delta pair's
/// independent seed namespace), so it always matches. Omitting `seed_identity` preserves the
/// legacy name.
#[cfg(all(target_arch = "wasm32", not(feature = "zicsr-stub")))]
#[wasm_bindgen(js_name = overlayDbName)]
pub fn overlay_db_name(
    manifest_json: &str,
    seed_identity: Option<String>,
) -> Result<String, JsError> {
    let manifest = wasm_vm_storage::ImageManifest::from_json(manifest_json)
        .map_err(|e| JsError::new(&format!("bad image manifest: {e:?}")))?;
    let base_binding = manifest.base_hash();
    Ok(match parse_overlay_seed_identity(seed_identity)? {
        Some(identity) => wasm_vm_storage::overlay_seed_store_name(&base_binding, &identity),
        None => wasm_vm_storage::overlay_store_name(&base_binding),
    })
}

/// E4 Alpine restore-on-load: seed the IndexedDB copy-on-write overlay for this chunked image with the
/// shipped `WVOD1` overlay-delta (the ~1 MB set of post-boot-dirtied 4 KiB blocks) BEFORE constructing
/// the persistent machine, so a subsequent [`WasmLinux::new_chunked_disk_persistent`]'s `load_blocks()`
/// picks them up and the restored guest's cache-miss disk reads return the *post-boot* block content.
///
/// Coherence is bound, not bypassed:
/// * the delta's `base_binding`/`image_len` must match this manifest's `base_hash`/`image_len`
///   (`delta_base_mismatch` otherwise) — a delta for a different chunked base is rejected;
/// * a brand-new (no meta, no blocks) store is seeded, while an existing store is accepted only when
///   its valid meta and complete block-index/value set exactly equal the delta. Any changed, added, or
///   removed user block is left untouched and returns `false`, forcing the paired RAM snapshot to be
///   skipped and the normal cold boot to continue over that existing overlay.
///
/// Returns `true` iff the delta was freshly seeded or the existing overlay is byte-exact, `false` for
/// any other existing state. Returning `false` never writes to the store.
/// The paired RAM snapshot rides the same overlay generation (0 for a fresh store); the restore's
/// `restoreDecisionCode` guard enforces the core-hash + base + generation triple before `loadSnapshotBlob`.
#[cfg(all(target_arch = "wasm32", not(feature = "zicsr-stub")))]
#[wasm_bindgen(js_name = seedOverlayDelta)]
pub async fn seed_overlay_delta(
    manifest_json: String,
    delta_bytes: Vec<u8>,
    seed_identity: Option<String>,
) -> Result<bool, JsError> {
    let manifest = wasm_vm_storage::ImageManifest::from_json(&manifest_json)
        .map_err(|e| JsError::new(&format!("bad image manifest: {e:?}")))?;
    let base_binding = manifest.base_hash();
    let delta = wasm_vm_storage::OverlayDelta::from_bytes(&delta_bytes)
        .map_err(|e| JsError::new(&format!("overlay delta parse: {e:?}")))?;
    if delta.base_binding != base_binding || delta.image_len != manifest.image_len {
        return Err(JsError::new("delta_base_mismatch"));
    }

    let seed_identity = parse_overlay_seed_identity(seed_identity)?;
    let idb = idb_store::IdbStore::open(&base_binding, seed_identity.as_ref())
        .await
        .map_err(|e| JsError::new(&format!("IndexedDB open: {e:?}")))?;
    let meta = idb
        .read_meta()
        .await
        .map_err(|e| JsError::new(&format!("IndexedDB read meta: {e:?}")))?;
    let stored_blocks = idb
        .load_blocks()
        .await
        .map_err(|e| JsError::new(&format!("IndexedDB load blocks: {e:?}")))?;
    match delta.seed_decision(&manifest, meta.as_deref(), &stored_blocks) {
        wasm_vm_storage::OverlaySeedDecision::ReuseExact => return Ok(true),
        wasm_vm_storage::OverlaySeedDecision::PreserveExisting => return Ok(false),
        wasm_vm_storage::OverlaySeedDecision::SeedFresh => {}
    }
    idb.write_meta(&wasm_vm_storage::OverlayMeta::new(&manifest).to_bytes())
        .await
        .map_err(|e| JsError::new(&format!("IndexedDB write meta: {e:?}")))?;
    // Persist the delta blocks in bounded batches so a single strict txn is never the whole delta.
    for batch in delta.blocks.chunks(64) {
        idb.persist(batch)
            .await
            .map_err(|e| JsError::new(&format!("IndexedDB seed persist: {e:?}")))?;
    }
    Ok(true)
}

/// The E0-T14 golden `loops.elf` (the pinned benchmark workload) and its retired count.
const BENCH_ELF: &[u8] = include_bytes!("../../../guest/prebuilt/loops.elf");
const BENCH_RETIRED_PER_RUN: u64 = 48;

/// Instructions-per-second baseline (E0-T24), node + browser side. Runs `loops.elf` on the
/// trace-off (`run`) path repeatedly until at least `target_instrs` instructions have
/// retired (`≥ 10^7` keeps JS↔wasm boundary chatter out of the measurement), and returns a
/// `{ retired, ms }` object timed with `Date.now()`. MIPS = `retired / ms / 1000`. Each run
/// retires exactly the golden count (a reload is a clean reset), so `retired` is exact.
#[wasm_bindgen]
pub fn bench(target_instrs: u32) -> Result<JsValue, JsError> {
    let mut machine =
        Machine::try_new(1024 * 1024).map_err(|_| JsError::new("cannot allocate bench RAM"))?;
    let target = target_instrs as u64;
    let start = js_sys::Date::now();
    let mut retired = 0u64;
    while retired < target {
        machine
            .load_elf(BENCH_ELF)
            .map_err(|e| JsError::new(&format!("bench load_elf: {e:?}")))?;
        // trace-off path; each run retires exactly the golden count (verified natively).
        let _ = machine.run(1000);
        retired += BENCH_RETIRED_PER_RUN;
    }
    let ms = js_sys::Date::now() - start;

    let obj = js_sys::Object::new();
    let _ = js_sys::Reflect::set(&obj, &"retired".into(), &JsValue::from_f64(retired as f64));
    let _ = js_sys::Reflect::set(&obj, &"ms".into(), &JsValue::from_f64(ms));
    Ok(obj.into())
}

/// A console sink that forwards each byte to a JS callback stored in a shared slot. The
/// slot is `Rc`-shared with [`WasmMachine`] so `set_console` can swap the callback without
/// re-attaching the device. The callback is cloned out before invocation, so no borrow of
/// the slot is held across the call into JS.
struct JsConsole {
    slot: std::rc::Rc<RefCell<Option<js_sys::Function>>>,
}

impl ConsoleSink for JsConsole {
    fn put_byte(&mut self, b: u8) {
        let cb = self.slot.borrow().clone();
        if let Some(f) = cb {
            // Ignore JS-side throws: a misbehaving callback must not corrupt the run.
            let _ = f.call1(&JsValue::NULL, &JsValue::from(b));
        }
    }
}

/// An observing sink that appends one canonical line for every interpreted retirement.
struct RunSink<'a> {
    trace: &'a mut String,
}

impl TraceSink for RunSink<'_> {
    fn retire(&mut self, r: &TraceRecord) {
        let _ = writeln!(self.trace, "{}", fmt_canonical(r));
    }
}

/// Everything the machine owns, behind one `RefCell` (see the re-entrancy note above).
struct Inner {
    machine: Machine,
    console: std::rc::Rc<RefCell<Option<js_sys::Function>>>,
    loaded: bool,
    exited: bool,
    trace_on: bool,
    trace: String,
}

/// JS-facing handle over [`wasm_vm_core::Machine`].
#[wasm_bindgen]
pub struct WasmMachine {
    inner: RefCell<Inner>,
}

/// Maps a failed re-entrant borrow to a catchable JsError.
fn reentrant() -> JsError {
    JsError::new("re-entrant call into WasmMachine (a console callback cannot drive the machine)")
}

/// Shared JS shape for both bare-metal and Linux wrappers' proof that translated code actually ran.
fn jit_stats_object(machine: &Machine) -> JsValue {
    let obj = js_sys::Object::new();
    let set = |k: &str, v: &JsValue| {
        let _ = js_sys::Reflect::set(&obj, &JsValue::from_str(k), v);
    };
    match machine.executor() {
        Some(e) => {
            set("hasExecutor", &JsValue::from_bool(true));
            set(
                "compiledBlocks",
                &JsValue::from_f64(e.compiled_count() as f64),
            );
            set(
                "executedBlocks",
                &JsValue::from_f64(e.executed_blocks() as f64),
            );
            set(
                "retiredViaJit",
                &JsValue::from_f64(e.retired_via_jit() as f64),
            );
            set(
                "directChainEntries",
                &JsValue::from_f64(e.direct_chain_entries() as f64),
            );
            set(
                "directChainLinks",
                &JsValue::from_f64(e.direct_chain_links() as f64),
            );
            let dynamic = e.dynamic_link_stats();
            set(
                "dynamicLinkAttempts",
                &JsValue::from_f64(dynamic.attempts as f64),
            );
            set("dynamicLinkHits", &JsValue::from_f64(dynamic.hits as f64));
            set(
                "dynamicLinkRefusals",
                &JsValue::from_f64(dynamic.refusals as f64),
            );
            set(
                "dynamicLinkRetargets",
                &JsValue::from_f64(dynamic.retargets as f64),
            );
            set(
                "dynamicLinkLiveEntries",
                &JsValue::from_f64(dynamic.live_entries as f64),
            );
            set(
                "dynamicLinkInstalls",
                &JsValue::from_f64(dynamic.installs as f64),
            );
        }
        None => {
            set("hasExecutor", &JsValue::from_bool(false));
            set("compiledBlocks", &JsValue::from_f64(0.0));
            set("executedBlocks", &JsValue::from_f64(0.0));
            set("retiredViaJit", &JsValue::from_f64(0.0));
            set("directChainEntries", &JsValue::from_f64(0.0));
            set("directChainLinks", &JsValue::from_f64(0.0));
            set("dynamicLinkAttempts", &JsValue::from_f64(0.0));
            set("dynamicLinkHits", &JsValue::from_f64(0.0));
            set("dynamicLinkRefusals", &JsValue::from_f64(0.0));
            set("dynamicLinkRetargets", &JsValue::from_f64(0.0));
            set("dynamicLinkLiveEntries", &JsValue::from_f64(0.0));
            set("dynamicLinkInstalls", &JsValue::from_f64(0.0));
        }
    }
    // Keep the original proof counters above stable while exposing the cumulative mechanics that
    // explain a browser benchmark: how often the outer dispatch loop was re-entered, how many
    // links a compiled chain actually followed, whether the compiled cache is churning, and how
    // often the physical predecode cache was reused. These are diagnostics only; none participates
    // in execution or acceptance decisions.
    let chain = machine.chain_stats();
    set(
        "chainLinksMade",
        &JsValue::from_f64(chain.links_made as f64),
    );
    set("chainLinksCut", &JsValue::from_f64(chain.links_cut as f64));
    set(
        "chainDispatchEntries",
        &JsValue::from_f64(chain.dispatch_entries as f64),
    );
    set(
        "chainMaxDepth",
        &JsValue::from_f64(chain.max_chain_depth as f64),
    );
    set(
        "chainLinksFollowed",
        &JsValue::from_f64(chain.total_links_followed() as f64),
    );
    let cache = machine.jit_cache_stats();
    set(
        "jitCacheInstalls",
        &JsValue::from_f64(cache.installs as f64),
    );
    set(
        "jitCacheRetranslations",
        &JsValue::from_f64(cache.retranslations as f64),
    );
    set(
        "jitCacheEvictions",
        &JsValue::from_f64(cache.evictions as f64),
    );
    set("jitCacheBatches", &JsValue::from_f64(cache.batches as f64));
    set(
        "jitCacheCodeBytes",
        &JsValue::from_f64(cache.code_bytes as f64),
    );
    let discovery = machine.discovery_stats();
    set(
        "decodedBlocksDiscarded",
        &JsValue::from_f64(discovery.blocks_discarded as f64),
    );
    set(
        "decodedCacheFlushes",
        &JsValue::from_f64(discovery.cache_flushes as f64),
    );
    set(
        "discoveryGeneration",
        &JsValue::from_f64(discovery.generation as f64),
    );
    let (entry_hits, builds) = machine.block_cache_entry_stats();
    set("blockEntryHits", &JsValue::from_f64(entry_hits as f64));
    set("blockBuilds", &JsValue::from_f64(builds as f64));
    obj.into()
}

#[wasm_bindgen]
impl WasmMachine {
    /// Construct a machine with `ram_mib` MiB of zeroed guest RAM and a UART0 console
    /// wired to a (initially unset) JS callback. A `ram_mib` too large to allocate throws
    /// a catchable `JsError` — never a wasm `unreachable` abort that would poison the
    /// module (the allocation goes through `try_reserve_exact`).
    #[wasm_bindgen(constructor)]
    pub fn new(ram_mib: u32) -> Result<WasmMachine, JsError> {
        init_diagnostics();
        let bytes = (ram_mib as usize).saturating_mul(1024 * 1024);
        let mut machine = Machine::try_new(bytes)
            .map_err(|_| JsError::new(&format!("cannot allocate {ram_mib} MiB of guest RAM")))?;
        let console = std::rc::Rc::new(RefCell::new(None));
        // The console device is always attached: guests store to UART0 to print, and an
        // unmapped store would trap. Until set_console runs, bytes are simply dropped.
        machine
            .bus_mut()
            .attach(
                UART0_BASE,
                UART0_LEN,
                Box::new(Uart0Stub::new(JsConsole {
                    slot: console.clone(),
                })),
            )
            .expect("UART0 sits in a fixed, un-contended MMIO slot");
        Ok(WasmMachine {
            inner: RefCell::new(Inner {
                machine,
                console,
                loaded: false,
                exited: false,
                trace_on: false,
                trace: String::new(),
            }),
        })
    }

    /// Size of guest RAM in bytes.
    #[wasm_bindgen(js_name = ramLen)]
    pub fn ram_len(&self) -> Result<usize, JsError> {
        Ok(self
            .inner
            .try_borrow()
            .map_err(|_| reentrant())?
            .machine
            .ram_len())
    }

    /// Install (or replace) the per-byte console callback: `fn(byte: number)`.
    #[wasm_bindgen(js_name = setConsole)]
    pub fn set_console(&self, cb: js_sys::Function) -> Result<(), JsError> {
        let inner = self.inner.try_borrow().map_err(|_| reentrant())?;
        *inner.console.borrow_mut() = Some(cb);
        Ok(())
    }

    /// Load a bare-metal rv64 ELF. A malformed image throws a `JsError` naming the
    /// `ElfError` variant and leaves the machine usable (RAM is validated before it is
    /// written).
    #[wasm_bindgen(js_name = loadElf)]
    pub fn load_elf(&self, bytes: &[u8]) -> Result<(), JsError> {
        let mut inner = self.inner.try_borrow_mut().map_err(|_| reentrant())?;
        inner
            .machine
            .load_elf(bytes)
            .map_err(|e| JsError::new(&format!("load_elf failed: {e:?}")))?;
        inner.loaded = true;
        inner.exited = false;
        Ok(())
    }

    /// E4-T29 Phase 2: attach the in-wasm (browser) JIT executor to this machine and arm tier-up.
    /// Mirrors the native CLI `--jit` wiring (constructs the executor, calls `set_executor`, turns on
    /// the block cache + interrupt batching + hotness discovery) so a booted browser guest executes
    /// translated blocks. The interpreter stays the oracle: with the JIT off (this never called) the
    /// run loop is byte-identical to the pre-T29 path. `threshold` is the hotness count before a block
    /// is nominated for compilation (1 = eager, for tests). The caller is responsible for gating this
    /// on `crossOriginIsolated` (E4-T22 `selectJitBackend`) — see `web/cpu-isolation.js`.
    #[wasm_bindgen(js_name = enableJit)]
    pub fn enable_jit(&self, threshold: u32) -> Result<(), JsError> {
        let mut inner = self.inner.try_borrow_mut().map_err(|_| reentrant())?;
        let executor =
            jit_browser::BrowserExecutor::new_inline(&inner.machine).map_err(JsError::new)?;
        inner.machine.set_executor(Box::new(executor));
        inner.machine.set_block_cache(true);
        inner.machine.set_interrupt_batching(true);
        inner.machine.set_hotness_threshold(threshold.max(1));
        inner.machine.set_jit(true);
        Ok(())
    }

    /// Enable or disable canonical instruction tracing (appended to an internal buffer;
    /// drain it with `takeTrace`).
    #[wasm_bindgen(js_name = setTrace)]
    pub fn set_trace(&self, on: bool) -> Result<(), JsError> {
        self.inner
            .try_borrow_mut()
            .map_err(|_| reentrant())?
            .trace_on = on;
        Ok(())
    }

    /// Take and clear the accumulated canonical trace.
    #[wasm_bindgen(js_name = takeTrace)]
    pub fn take_trace(&self) -> Result<String, JsError> {
        let mut inner = self.inner.try_borrow_mut().map_err(|_| reentrant())?;
        Ok(core::mem::take(&mut inner.trace))
    }

    /// Run up to `max_instrs` instructions, returning a status object:
    /// `{ kind: "exited"|"trapped"|"max", code?, cause?, tval?, retired }`.
    pub fn run(&self, max_instrs: u32) -> Result<JsValue, JsError> {
        let mut inner = self.inner.try_borrow_mut().map_err(|_| reentrant())?;
        Self::guard_runnable(&inner)?;
        let (outcome, retired) = Self::drive(&mut inner, max_instrs as u64);
        Self::status_object(&mut inner, outcome, retired)
    }

    /// Step up to `n` instructions, returning how many retired. Same engine as `run`
    /// (HTIF is consulted), but the caller reads a plain count instead of a status object.
    pub fn step(&self, n: u32) -> Result<u32, JsError> {
        let mut inner = self.inner.try_borrow_mut().map_err(|_| reentrant())?;
        Self::guard_runnable(&inner)?;
        let (outcome, retired) = Self::drive(&mut inner, n as u64);
        if let RunOutcome::Exited(_) = outcome {
            inner.exited = true;
        }
        Ok(retired as u32)
    }

    /// The 33 architectural registers as a `BigUint64Array`: `[pc, x0, x1, …, x31]`.
    pub fn registers(&self) -> Result<js_sys::BigUint64Array, JsError> {
        let inner = self.inner.try_borrow().map_err(|_| reentrant())?;
        let snap = inner.machine.snapshot();
        let out = js_sys::BigUint64Array::new_with_length(33);
        out.set_index(0, snap.pc);
        for (i, v) in snap.xregs.iter().enumerate() {
            out.set_index(i as u32 + 1, *v);
        }
        Ok(out)
    }

    /// SHA-256 of guest RAM as 64 lowercase hex chars (matches the CLI `--dump-state`).
    #[wasm_bindgen(js_name = stateDigest)]
    pub fn state_digest(&self) -> Result<String, JsError> {
        let inner = self.inner.try_borrow().map_err(|_| reentrant())?;
        Ok(inner.machine.snapshot().hex_digest())
    }

    /// E2-T20: the interrupt/trap counters + storm/WFI diagnosis as a JS object
    /// `{ retired, wfi, exceptions:[16], interrupts:[16], claims:[32], storm:bool, wfiReport:string|null }`.
    /// E2-T26's UI surfaces these so a browser boot that death-spirals shows a diagnosis instead
    /// of a silently-pinned tab.
    #[wasm_bindgen(js_name = getStats)]
    pub fn get_stats(&self) -> Result<JsValue, JsError> {
        let inner = self.inner.try_borrow().map_err(|_| reentrant())?;
        let s = inner.machine.irq_stats();
        let obj = js_sys::Object::new();
        let set = |k: &str, v: &JsValue| {
            let _ = js_sys::Reflect::set(&obj, &JsValue::from_str(k), v);
        };
        let u64_arr = |a: &[u64]| {
            let arr = js_sys::Array::new();
            for &x in a {
                arr.push(&JsValue::from_f64(x as f64));
            }
            arr
        };
        set("retired", &JsValue::from_f64(s.retired as f64));
        set("wfi", &JsValue::from_f64(s.wfi as f64));
        set("exceptions", &u64_arr(&s.exc));
        set("interrupts", &u64_arr(&s.int));
        set("claims", &u64_arr(&s.claims));
        set("storm", &JsValue::from_bool(s.last_storm.is_some()));
        match &s.last_wfi_report {
            Some(r) => set("wfiReport", &JsValue::from_str(r)),
            None => set("wfiReport", &JsValue::NULL),
        }
        Ok(obj.into())
    }

    /// E4-T31: the bare-metal wrapper's authoritative compiled-tier counters. This mirrors the
    /// Linux wrapper and lets hosts distinguish a bounded JIT run from an interpreted trace run.
    #[wasm_bindgen(js_name = jitStats)]
    pub fn jit_stats(&self) -> Result<JsValue, JsError> {
        let inner = self.inner.try_borrow().map_err(|_| reentrant())?;
        Ok(jit_stats_object(&inner.machine))
    }
}

impl WasmMachine {
    fn guard_runnable(inner: &Inner) -> Result<(), JsError> {
        if !inner.loaded {
            return Err(JsError::new("run/step called before load_elf()"));
        }
        if inner.exited {
            return Err(JsError::new(
                "machine already exited; load a fresh ELF to continue",
            ));
        }
        Ok(())
    }

    /// Run the engine for `budget` work slots, splitting the `Inner` borrow so the trace buffer and
    /// machine are disjoint. Tracing forces one-record-per-retire interpretation; otherwise the
    /// zero-record path keeps an armed JIT active. The core retirement delta is authoritative for
    /// both modes (a sink cannot count the interior of a compiled block).
    fn drive(inner: &mut Inner, budget: u64) -> (RunOutcome, u64) {
        let Inner {
            machine,
            trace,
            trace_on,
            ..
        } = inner;
        let retired_before = machine.irq_stats().retired;
        let outcome = if *trace_on {
            let mut sink = RunSink { trace };
            machine.run_traced(budget, &mut sink)
        } else {
            machine.run(budget)
        };
        let retired = machine.irq_stats().retired.wrapping_sub(retired_before);
        (outcome, retired)
    }

    fn status_object(
        inner: &mut Inner,
        outcome: RunOutcome,
        retired: u64,
    ) -> Result<JsValue, JsError> {
        let obj = js_sys::Object::new();
        let set = |k: &str, v: &JsValue| {
            let _ = js_sys::Reflect::set(&obj, &JsValue::from_str(k), v);
        };
        set("retired", &JsValue::from_f64(retired as f64));
        match outcome {
            RunOutcome::Exited(code) => {
                inner.exited = true;
                set("kind", &JsValue::from_str("exited"));
                set("code", &JsValue::from_f64(code as f64));
            }
            RunOutcome::Trapped(t) => {
                set("kind", &JsValue::from_str("trapped"));
                set("cause", &JsValue::from_str(&format!("{:?}", t.cause)));
                set("tval", &JsValue::from_f64(t.tval as f64));
            }
            RunOutcome::MaxInstrs => {
                set("kind", &JsValue::from_str("max"));
            }
            // E2-T17: syscon/SBI reset surfaced as an event kind for the JS host (E2-T21/T26
            // consume it — poweroff closes the tab/worker, reboot re-inits the machine).
            RunOutcome::Reset(r) => {
                inner.exited = matches!(
                    r,
                    wasm_vm_core::ExitReason::PowerOff | wasm_vm_core::ExitReason::Fail(_)
                );
                set("kind", &JsValue::from_str("reset"));
                let (reason, code) = match r {
                    wasm_vm_core::ExitReason::PowerOff => ("poweroff", 0u16),
                    wasm_vm_core::ExitReason::Reboot => ("reboot", 0),
                    wasm_vm_core::ExitReason::Fail(c) => ("fail", c),
                };
                set("reason", &JsValue::from_str(reason));
                set("code", &JsValue::from_f64(code as f64));
            }
        }
        Ok(obj.into())
    }
}

/// E2-T16: the browser wall clock for the goldfish RTC — `Date.now()` (ms since the Unix
/// epoch) scaled to nanoseconds. Kept here (not `crates/core`) because core bans host time
/// sources for determinism. This is the minimal "wire the trait" shim; E2-T23 owns the real
/// browser timekeeping policy (drift, throttling, suspend/resume recovery) that will build on
/// it. wasm-only: `js_sys::Date::now` links nowhere else.
#[cfg(all(target_arch = "wasm32", not(feature = "zicsr-stub")))]
pub struct JsWallClock;

#[cfg(all(target_arch = "wasm32", not(feature = "zicsr-stub")))]
impl wasm_vm_core::dev::rtc::WallClock for JsWallClock {
    fn now_ns(&self) -> u64 {
        // Date.now() is f64 milliseconds; ×1e6 → ns. Negative (pre-1970) reads back as 0.
        let ms = js_sys::Date::now();
        if ms <= 0.0 {
            0
        } else {
            (ms * 1_000_000.0) as u64
        }
    }
}

/// E4-T01: the monotonic host timer the profiler samples on its cold paths, browser side —
/// `performance.now()` (high-resolution + monotonic within the realm), unlike the wall-clock
/// `JsWallClock`. Works in a Window OR a Worker (the emulator runs in a Web Worker). wasm-only.
#[cfg(all(target_arch = "wasm32", not(feature = "zicsr-stub")))]
pub struct JsHostTimer {
    perf: web_sys::Performance,
}

#[cfg(all(target_arch = "wasm32", not(feature = "zicsr-stub")))]
impl JsHostTimer {
    /// `None` if no global exposes a `performance` object (then profiling can't be armed here).
    fn new() -> Option<JsHostTimer> {
        use wasm_bindgen::JsCast;
        let global = js_sys::global();
        let perf = if let Some(w) = global.dyn_ref::<web_sys::Window>() {
            w.performance()
        } else if let Some(s) = global.dyn_ref::<web_sys::WorkerGlobalScope>() {
            s.performance()
        } else {
            None
        }?;
        Some(JsHostTimer { perf })
    }
}

#[cfg(all(target_arch = "wasm32", not(feature = "zicsr-stub")))]
impl wasm_vm_core::prof::HostTimer for JsHostTimer {
    fn now_ns(&self) -> u64 {
        // performance.now() is f64 milliseconds; ×1e6 → ns. Guard the (impossible) negative.
        let ms = self.perf.now();
        if ms <= 0.0 {
            0
        } else {
            (ms * 1_000_000.0) as u64
        }
    }
}

/// E2-T21: a browser-side unmodified-Linux boot. Unlike [`WasmMachine`] (bare-metal ELF + a
/// Uart0 stub), this assembles the full `virt` platform (CLINT/PLIC/16550/virtio/goldfish-RTC/
/// syscon/built-in SBI) via the SHARED [`Machine::place_and_boot`] and boots a kernel `Image`
/// + optional initramfs. Console is chunked: all guest output (SBI `earlycon` + the 16550
/// `ttyS0`) accumulates in a buffer that each `runChunk` flushes to a JS callback as one
/// `Uint8Array`; host keystrokes queued via `sendInput` feed the 16550 RX. The JS host drives
/// the machine off `requestAnimationFrame`/`setTimeout` (workers/SAB are Epic 4).
#[cfg(all(target_arch = "wasm32", not(feature = "zicsr-stub")))]
#[wasm_bindgen]
pub struct WasmLinux {
    inner: RefCell<LinuxInner>,
}

/// E3-T12d build-stable snapshot identity: the crate version zero-padded into 32 bytes. Changes across
/// releases so a snapshot taken by a different build fails the coherence guard (a `CoreHashMismatch`
/// cold boot). A semantic change WITHIN one published version is out of scope (documented); a git-hash
/// identity is a future refinement.
#[cfg(all(target_arch = "wasm32", not(feature = "zicsr-stub")))]
fn build_core_hash() -> [u8; 32] {
    let v = env!("CARGO_PKG_VERSION").as_bytes();
    let mut h = [0u8; 32];
    let n = v.len().min(32);
    h[..n].copy_from_slice(&v[..n]);
    h
}

#[cfg(all(target_arch = "wasm32", not(feature = "zicsr-stub")))]
struct LinuxInner {
    machine: Machine,
    uart: std::rc::Rc<RefCell<wasm_vm_core::dev::uart16550::Uart16550>>,
    out: std::rc::Rc<RefCell<Vec<u8>>>,
    output: js_sys::Function,
    pending: std::collections::VecDeque<u8>,
    finished: Option<String>,
    /// E3-T02 lazy-fetch state, present only for a `newChunkedDisk` boot (`None` otherwise). Held in
    /// an `Rc` so `fetchPending` can clone it out and `await` without keeping the inner borrow.
    fetch: Option<std::rc::Rc<http_fetch::FetchState>>,
    /// E3-T05 durable-persistence state, present only for a `newChunkedDiskPersistent` boot: the
    /// IndexedDB store (`Clone`), the shared persist queue the overlay records writes into, and the
    /// immutable metadata identity used to stamp the next durable generation.
    persist: Option<(
        idb_store::IdbStore,
        wasm_vm_storage::SharedPersistQueue,
        wasm_vm_storage::OverlayMeta,
    )>,
    /// E3-T10: the chunked backend's shared read-only flag, so `setDiskReadOnly` can flip the
    /// disk live (the "continue read-only" choice after a storage-quota hit). `None` off the
    /// persistent path.
    disk_ro: Option<std::rc::Rc<std::cell::Cell<bool>>>,
    /// E3-T21c: bounded browser producer/consumer queues plus the shared slirp backend handle.
    /// Present only for slirp boots; the emulator still owns the sole `NetBackend` adapter.
    file_transfers: Option<browser_file_transfer::BrowserFileTransfers>,
    /// E3-T12d: the base-image binding for the durable resume-snapshot store, present only for a
    /// `newChunkedDiskPersistent` boot (`None` otherwise). The snapshot DB is namespaced by it, and
    /// the restore-decision guard needs it as the expected `base_image_hash`. Off the persistent path
    /// there is no snapshot store, so the decision is always `"missing"`.
    snapshot_base: Option<[u8; 32]>,
    /// E3-T12d: the persistent tab's Web Lock ownership. Read-only contenders may inspect the
    /// snapshot store, but must never save or import into the writer's namespace.
    snapshot_read_only: bool,
    /// E3-T12d: storage writes that passed the ownership check and are still awaiting IndexedDB.
    /// Lease relinquishment fences new operations, then waits for this counter before releasing
    /// the Web Lock so an already-started save cannot outlive its writer.
    snapshot_write_count: std::rc::Rc<std::cell::Cell<u32>>,
}

#[cfg(all(target_arch = "wasm32", not(feature = "zicsr-stub")))]
fn finish_snapshot_write(count: &std::rc::Rc<std::cell::Cell<u32>>) {
    count.set(count.get().saturating_sub(1));
}

#[cfg(all(target_arch = "wasm32", not(feature = "zicsr-stub")))]
async fn wait_for_snapshot_writes(count: std::rc::Rc<std::cell::Cell<u32>>) {
    use wasm_bindgen::JsCast;
    use wasm_bindgen_futures::JsFuture;

    while count.get() != 0 {
        // A timer yield lets the IndexedDB task that owns the in-flight transaction run. A
        // Promise.resolve loop would remain in the microtask queue and could starve that event.
        let promise = js_sys::Promise::new(&mut |resolve, _reject| {
            let global = js_sys::global();
            let callback = resolve.unchecked_ref::<js_sys::Function>();
            let scheduled = if let Some(window) = global.dyn_ref::<web_sys::Window>() {
                window
                    .set_timeout_with_callback_and_timeout_and_arguments_0(callback, 0)
                    .is_ok()
            } else if let Some(scope) = global.dyn_ref::<web_sys::WorkerGlobalScope>() {
                scope
                    .set_timeout_with_callback_and_timeout_and_arguments_0(callback, 0)
                    .is_ok()
            } else {
                false
            };
            if !scheduled {
                let _ = resolve.call0(&JsValue::UNDEFINED);
            }
        });
        let _ = JsFuture::from(promise).await;
    }
}

/// Which block device (if any) backs the boot: none (initramfs), an in-memory image, or a lazily
/// fetched chunked image (E3-T02).
#[cfg(all(target_arch = "wasm32", not(feature = "zicsr-stub")))]
enum DiskChoice {
    None,
    Mem(Vec<u8>),
    Chunked {
        manifest: wasm_vm_storage::ImageManifest,
        base_url: String,
        /// E3-T03 cache byte budget.
        budget: u64,
        /// E3-T03 boot profile: ordered chunks to prefetch (empty if none).
        profile: Vec<usize>,
    },
    /// E3-T05: like `Chunked`, but the overlay is a `WriteBackOverlay` (loaded from IndexedDB, sharing
    /// a persist queue) so guest writes survive a reload.
    ChunkedPersistent {
        manifest: wasm_vm_storage::ImageManifest,
        base_url: String,
        budget: u64,
        profile: Vec<usize>,
        /// Blocks loaded from the durable store on reopen (already persisted).
        loaded: alloc_map::BlockMap,
        idb: idb_store::IdbStore,
        queue: wasm_vm_storage::SharedPersistQueue,
        /// Generation read from the durable overlay metadata on reopen.
        generation: u64,
        /// E3-T09: another tab holds the writer Web Lock — reject writes at the backend seam,
        /// advertise VIRTIO_BLK_F_RO, and register NO persist pump.
        read_only: bool,
    },
}

/// A small alias module so the enum variant's type reads cleanly.
#[cfg(all(target_arch = "wasm32", not(feature = "zicsr-stub")))]
mod alloc_map {
    pub type BlockMap = std::collections::BTreeMap<u64, [u8; wasm_vm_storage::OVERLAY_BLOCK]>;
}

/// Console sink that accumulates guest bytes into a shared buffer (drained per `runChunk`).
#[cfg(all(target_arch = "wasm32", not(feature = "zicsr-stub")))]
struct BufSink {
    buf: std::rc::Rc<RefCell<Vec<u8>>>,
}
#[cfg(all(target_arch = "wasm32", not(feature = "zicsr-stub")))]
impl ConsoleSink for BufSink {
    fn put_byte(&mut self, b: u8) {
        self.buf.borrow_mut().push(b);
    }
}

#[cfg(all(target_arch = "wasm32", not(feature = "zicsr-stub")))]
#[wasm_bindgen]
impl WasmLinux {
    /// Assemble the platform and boot. `initrd` empty = none; `bootargs` empty = the default
    /// `console=ttyS0 earlycon=sbi`. `output(bytes: Uint8Array)` receives console output.
    #[wasm_bindgen(constructor)]
    pub fn new(
        ram_mib: u32,
        kernel: &[u8],
        initrd: &[u8],
        bootargs: String,
        output: js_sys::Function,
    ) -> Result<WasmLinux, JsError> {
        let initrd_opt = if initrd.is_empty() {
            None
        } else {
            Some(initrd)
        };
        let args = if bootargs.is_empty() {
            "console=ttyS0 earlycon=sbi".to_string()
        } else {
            bootargs
        };
        Self::assemble(ram_mib, kernel, initrd_opt, DiskChoice::None, &args, output)
    }

    /// E2-T26 capstone: boot from a virtio-blk DISK image (e.g. the Alpine ext4 rootfs) instead of
    /// an initramfs. `disk` is MOVED into an in-memory `BlockBackend` (one wasm-side copy — the T21
    /// single-copy discipline; a `&[u8]` + `.to_vec()` would double-allocate 512 MB). Default
    /// bootargs mount `/dev/vda` as root.
    #[wasm_bindgen(js_name = newDisk)]
    pub fn new_disk(
        ram_mib: u32,
        kernel: &[u8],
        disk: Vec<u8>,
        bootargs: String,
        output: js_sys::Function,
    ) -> Result<WasmLinux, JsError> {
        let args = if bootargs.is_empty() {
            "root=/dev/vda rw console=ttyS0 earlycon=sbi".to_string()
        } else {
            bootargs
        };
        Self::assemble(ram_mib, kernel, None, DiskChoice::Mem(disk), &args, output)
    }

    /// E3-T02: boot from a CHUNKED image fetched lazily over HTTP. Instead of a full disk `Vec`, take
    /// the image `manifest` JSON and the `base_url` its chunks live under (must end in `/`). A guest
    /// disk read of an absent chunk parks (deferred virtio-blk completion) until `fetchPending`
    /// retrieves and hash-verifies that chunk. No full-image download ever happens.
    #[wasm_bindgen(js_name = newChunkedDisk)]
    #[allow(clippy::too_many_arguments)]
    pub fn new_chunked_disk(
        ram_mib: u32,
        kernel: &[u8],
        manifest_json: &str,
        base_url: String,
        cache_budget_mib: u32,
        boot_profile: Vec<u32>,
        bootargs: String,
        output: js_sys::Function,
    ) -> Result<WasmLinux, JsError> {
        let manifest = wasm_vm_storage::ImageManifest::from_json(manifest_json)
            .map_err(|e| JsError::new(&format!("bad image manifest: {e:?}")))?;
        let args = if bootargs.is_empty() {
            "root=/dev/vda rw console=ttyS0 earlycon=sbi".to_string()
        } else {
            bootargs
        };
        // E3-T03 cache budget: `cache_budget_mib` MiB (0 → 256 MiB default).
        let budget = if cache_budget_mib == 0 {
            256
        } else {
            cache_budget_mib
        } as u64
            * 1024
            * 1024;
        // The boot profile (a JSON array parsed JS-side) prefetches boot-critical chunks up front.
        let profile: Vec<usize> = boot_profile.into_iter().map(|c| c as usize).collect();
        Self::assemble(
            ram_mib,
            kernel,
            None,
            DiskChoice::Chunked {
                manifest,
                base_url,
                budget,
                profile,
            },
            &args,
            output,
        )
    }

    /// E3-T05: like [`Self::new_chunked_disk`], but the copy-on-write overlay is persisted to
    /// IndexedDB — guest writes survive a tab reload. Async: opens the image-namespaced DB (checking
    /// its recorded base binding against the manifest — a mismatch/older-version is a typed error, not
    /// silent reuse), loads any previously persisted blocks, and boots over them. Call `persistPending`
    /// to flush new writes durably (its Promise resolves on the IndexedDB transaction `complete`).
    #[wasm_bindgen(js_name = newChunkedDiskPersistent)]
    #[allow(clippy::too_many_arguments)]
    pub async fn new_chunked_disk_persistent(
        ram_mib: u32,
        kernel: Vec<u8>,
        manifest_json: String,
        base_url: String,
        cache_budget_mib: u32,
        boot_profile: Vec<u32>,
        bootargs: String,
        read_only: bool,
        output: js_sys::Function,
        seed_identity: Option<String>,
    ) -> Result<WasmLinux, JsError> {
        let manifest = wasm_vm_storage::ImageManifest::from_json(&manifest_json)
            .map_err(|e| JsError::new(&format!("bad image manifest: {e:?}")))?;
        let base_binding = manifest.base_hash();

        // Open the durable store and reconcile its meta record with this base.
        let seed_identity = parse_overlay_seed_identity(seed_identity)?;
        let idb = idb_store::IdbStore::open(&base_binding, seed_identity.as_ref())
            .await
            .map_err(|e| JsError::new(&format!("IndexedDB open: {e:?}")))?;
        let overlay_generation = match idb
            .read_meta()
            .await
            .map_err(|e| JsError::new(&format!("IndexedDB read meta: {e:?}")))?
        {
            Some(bytes) => {
                let meta = wasm_vm_storage::OverlayMeta::from_bytes(&bytes)
                    .map_err(|e| JsError::new(&format!("overlay meta: {e:?}")))?;
                meta.check(&manifest)
                    .map_err(|e| JsError::new(&format!("overlay/base mismatch: {e:?}")))?;
                meta.generation
            }
            None => {
                // E3-T09: an RO tab must not write ANYTHING — not even the meta record of a
                // brand-new DB (that's the writer's job; an empty DB simply reads as no blocks).
                if !read_only {
                    idb.write_meta(&wasm_vm_storage::OverlayMeta::new(&manifest).to_bytes())
                        .await
                        .map_err(|e| JsError::new(&format!("IndexedDB write meta: {e:?}")))?;
                }
                0
            }
        };
        let loaded = idb
            .load_blocks()
            .await
            .map_err(|e| JsError::new(&format!("IndexedDB load: {e:?}")))?;

        let queue = std::rc::Rc::new(RefCell::new(wasm_vm_storage::PersistQueue::new()));
        let args = if bootargs.is_empty() {
            // E3-T09: an RO boot asks the kernel for an ro root up front — mounting rw on a
            // VIRTIO_BLK_F_RO device would fail. `norecovery`: the overlay snapshot an RO tab
            // loads may carry a dirty journal (the writer tab replays it in ITS memory only);
            // ext4 refuses a ro mount that needs recovery ("unable to mount root fs" panic —
            // seen in the first dual-boot run), and norecovery mounts it read-only anyway.
            // Caveat (documented): the RO view may be slightly stale w.r.t. unreplayed journal
            // entries — exactly the right trade for a browse-only tab.
            if read_only {
                "root=/dev/vda ro rootflags=norecovery console=ttyS0 earlycon=sbi".to_string()
            } else {
                "root=/dev/vda rw console=ttyS0 earlycon=sbi".to_string()
            }
        } else {
            bootargs
        };
        let budget = if cache_budget_mib == 0 {
            256
        } else {
            cache_budget_mib
        } as u64
            * 1024
            * 1024;
        let profile: Vec<usize> = boot_profile.into_iter().map(|c| c as usize).collect();
        Self::assemble(
            ram_mib,
            &kernel,
            None,
            DiskChoice::ChunkedPersistent {
                manifest,
                base_url,
                budget,
                profile,
                loaded,
                idb,
                queue,
                generation: overlay_generation,
                read_only,
            },
            &args,
            output,
        )
    }

    /// Shared platform assembly for the initramfs (`new`), in-memory disk (`newDisk`), and lazy
    /// chunked-disk (`newChunkedDisk`) boot paths.
    fn assemble(
        ram_mib: u32,
        kernel: &[u8],
        initrd: Option<&[u8]>,
        disk: DiskChoice,
        bootargs: &str,
        output: js_sys::Function,
    ) -> Result<WasmLinux, JsError> {
        init_diagnostics();
        let bytes = (ram_mib as usize).saturating_mul(1024 * 1024);
        let mut machine = Machine::try_new(bytes)
            .map_err(|_| JsError::new(&format!("cannot allocate {ram_mib} MiB of guest RAM")))?;
        // Devices in dependency order (PLIC before its consumers).
        machine.enable_clint(10);
        machine.enable_plic();
        machine.enable_rtc(Box::new(JsWallClock));
        machine.enable_syscon();
        let uart = machine.enable_uart16550();
        let mut fetch = None;
        let mut persist = None;
        let mut disk_ro: Option<std::rc::Rc<std::cell::Cell<bool>>> = None;
        let mut file_transfers = None;
        // E3-T12d: the base binding for the durable resume-snapshot store — stamped only on the
        // persistent path (where a snapshot can be taken and restored). `None` elsewhere.
        let mut snapshot_base: Option<[u8; 32]> = None;
        let mut snapshot_read_only = false;
        match disk {
            // Alpine over virtio-blk: the image is owned by an in-memory BlockBackend in slot 0.
            DiskChoice::Mem(image) => {
                machine.enable_virtio_blk(Box::new(wasm_vm_core::block::MemBackend::new(image)));
            }
            // Lazy chunked image: a ChunkedBackend over a bounded BlockCache the fetch layer fills.
            DiskChoice::Chunked {
                manifest,
                base_url,
                budget,
                profile,
            } => {
                let store =
                    std::rc::Rc::new(RefCell::new(wasm_vm_storage::BlockCache::new(budget)));
                let backend = chunked::ChunkedBackend::new(&manifest, store.clone());
                machine.enable_virtio_blk(Box::new(backend));
                fetch = Some(std::rc::Rc::new(http_fetch::FetchState::new(
                    manifest, base_url, store, profile,
                )));
            }
            // E3-T05 durable chunked image: the overlay is a WriteBackOverlay (reopened blocks +
            // shared persist queue) so guest writes survive a reload; base chunks still lazily fetched.
            DiskChoice::ChunkedPersistent {
                manifest,
                base_url,
                budget,
                profile,
                loaded,
                idb,
                queue,
                generation,
                read_only,
            } => {
                // E3-T12d: bind the resume snapshot to this base image + stamp the machine's coherence
                // header, so a snapshot taken here fails the guard if reloaded against a foreign build
                // or a foreign base image. `base_hash()` is the same binding the snapshot store is
                // namespaced by. Reconstruct the generation committed with the durable blocks so a
                // resume snapshot cannot silently ride over writes made before this boot.
                let base_binding = manifest.base_hash();
                machine.set_snapshot_identity_with_generation(
                    build_core_hash(),
                    base_binding,
                    generation,
                );
                snapshot_base = Some(base_binding);
                snapshot_read_only = read_only;
                let store =
                    std::rc::Rc::new(RefCell::new(wasm_vm_storage::BlockCache::new(budget)));
                let overlay = wasm_vm_storage::WriteBackOverlay::with_shared_queue(
                    &manifest,
                    queue.clone(),
                    loaded,
                );
                let disk = wasm_vm_storage::OverlayDisk::attach(overlay, &manifest)
                    .map_err(|e| JsError::new(&format!("overlay attach: {e:?}")))?;
                let overlay_meta = wasm_vm_storage::OverlayMeta::new(&manifest);
                let mut backend =
                    chunked::ChunkedBackend::from_persistent_disk(disk, store.clone());
                if read_only {
                    // E3-T09: writes refused at this seam; the device advertises F_RO; and no
                    // persist pump exists (`persist` stays None), so an RO tab cannot touch
                    // the writer's IndexedDB store even by accident.
                    backend.set_read_only();
                }
                // E3-T10: keep the shared RO flag so `setDiskReadOnly` can flip it live after a
                // storage-quota hit (only meaningful for a writer boot).
                disk_ro = if read_only {
                    None
                } else {
                    Some(backend.read_only_flag())
                };
                machine.enable_virtio_blk(Box::new(backend));
                fetch = Some(std::rc::Rc::new(http_fetch::FetchState::new(
                    manifest, base_url, store, profile,
                )));
                if !read_only {
                    persist = Some((idb, queue, overlay_meta));
                }
            }
            // Busybox initramfs: the 8 empty virtio slots the DTB advertises.
            DiskChoice::None => {
                let _ = machine.enable_virtio_slots(None);
            }
        }
        // virtio-net in slot 1 on every boot shape — the guest sees eth0 (MAC 52:54:00:12:34:56).
        // Default: E3-T13 loopback (frames echo back). With `setSlirpNet(true)`, E3-net swaps in the
        // synchronous slirp LOCAL stack so the guest can DHCP a real IP (10.0.2.15) and reach the
        // gateway (10.0.2.2) — no tokio, no outbound yet (that's the WebSocket-relay slice).
        if slirp_net_enabled() {
            let start = js_sys::Date::now();
            let clock = Box::new(move || (js_sys::Date::now() - start) as i64);
            let (backend, dns): (_, Box<dyn wasm_vm_slirp::DnsService>) =
                if let Some((url, config)) = take_slirp_tailscale_worker() {
                    let transport =
                        worker_transport::BrowserWorkerTransport::connect(&url, &config)?;
                    let dns = Box::new(transport.dns_service());
                    let connector = wasm_vm_slirp::WsConnector::new(transport, Vec::new());
                    (
                        wasm_vm_slirp::SlirpLocalBackend::with_connector(
                            SLIRP_GATEWAY_MAC,
                            clock,
                            Box::new(connector),
                        ),
                        dns,
                    )
                } else if let Some(url) = slirp_relay_url() {
                    let transport = ws_transport::BrowserWebSocketTransport::connect(&url)?;
                    let connector =
                        wasm_vm_slirp::WsConnector::new(transport, take_slirp_relay_token());
                    (
                        wasm_vm_slirp::SlirpLocalBackend::with_connector(
                            SLIRP_GATEWAY_MAC,
                            clock,
                            Box::new(connector),
                        ),
                        Box::new(doh_fetch::BrowserDnsService::new(slirp_doh_endpoint())),
                    )
                } else {
                    (
                        wasm_vm_slirp::SlirpLocalBackend::new(SLIRP_GATEWAY_MAC, clock),
                        Box::new(doh_fetch::BrowserDnsService::new(slirp_doh_endpoint())),
                    )
                };
            let dhcp = wasm_vm_slirp::DhcpServer::new()
                .with_lease_secs(slirp_lease_secs())
                .with_mtu(slirp_mtu());
            set_slirp_dhcp_stats(dhcp.stats_handle());
            let backend = backend.with_dhcp_server(dhcp).with_dns_service(dns);
            let (transfers, shared) = browser_file_transfer::BrowserFileTransfers::new(backend);
            let _ = machine
                .enable_virtio_net(Box::new(browser_file_transfer::SharedSlirpBackend(shared)));
            file_transfers = Some(transfers);
        } else {
            let _ = machine.enable_virtio_net(Box::new(
                wasm_vm_core::dev::virtio::net::LoopbackBackend::new(),
            ));
        }
        // virtio-rng in slot 2 on every boot, backed by the browser CSPRNG
        // (`crypto.getRandomValues`). The guest binds it as `/dev/hwrng` and seeds its CRNG from
        // it, so `getrandom(2)`/`/dev/urandom` are ready early — without it the interpreted guest
        // scavenges entropy from interrupt jitter for many seconds, long enough that the first TLS
        // ClientHello's `RAND_bytes` stalls or fails (the E3-T19 guest-HTTPS flakiness).
        let _ = machine.enable_virtio_rng(Box::new(crypto_entropy::CryptoEntropy));
        machine.enable_builtin_sbi();
        let out = std::rc::Rc::new(RefCell::new(Vec::new()));
        machine.sbi_set_console(Box::new(BufSink { buf: out.clone() }));
        machine
            .place_and_boot(kernel, initrd, bootargs)
            .map_err(|e| JsError::new(&format!("boot layout failed: {e:?}")))?;
        Ok(WasmLinux {
            inner: RefCell::new(LinuxInner {
                machine,
                uart,
                out,
                output,
                pending: std::collections::VecDeque::new(),
                finished: None,
                fetch,
                persist,
                disk_ro,
                file_transfers,
                snapshot_base,
                snapshot_read_only,
                snapshot_write_count: std::rc::Rc::new(std::cell::Cell::new(0)),
            }),
        })
    }

    /// E4-T30: select the production interpreter fast path for a browser Linux guest. It combines
    /// physical-entry predecode reuse with the proven <=128-retire interrupt/device batching. The
    /// caller can turn it off for a byte-identical legacy A/B; enabling JIT later turns it back on
    /// because the compiled tier consumes the same block-discovery front end.
    #[wasm_bindgen(js_name = setFastInterpreter)]
    pub fn set_fast_interpreter(&self, on: bool) -> Result<(), JsError> {
        let mut inner = self.inner.try_borrow_mut().map_err(|_| reentrant())?;
        inner.machine.set_block_cache(on);
        inner.machine.set_interrupt_batching(on);
        Ok(())
    }

    /// E4-T29 Phase 2 (browser Linux path): attach the in-wasm JIT executor to THIS Linux guest and
    /// arm tier-up. The accelerated interpreter remains the fallback for cold/untranslatable blocks;
    /// the caller gates this on `crossOriginIsolated`.
    #[wasm_bindgen(js_name = enableJit)]
    pub fn enable_jit(&self, threshold: u32) -> Result<(), JsError> {
        let mut inner = self.inner.try_borrow_mut().map_err(|_| reentrant())?;
        let executor =
            jit_browser::BrowserExecutor::new_inline(&inner.machine).map_err(JsError::new)?;
        inner.machine.set_executor(Box::new(executor));
        inner.machine.set_block_cache(true);
        inner.machine.set_interrupt_batching(true);
        inner.machine.set_hotness_threshold(threshold.max(1));
        inner.machine.set_jit(true);
        Ok(())
    }

    /// E4-T29: the "JIT actually ran" proof for the browser Linux guest. Returns
    /// `{hasExecutor, compiledBlocks, executedBlocks, retiredViaJit}` read straight from the installed
    /// executor — `executedBlocks > 0` is the definitive evidence translated code executed (not merely
    /// that `enableJit` was called). `hasExecutor:false` means no JIT is attached at all.
    #[wasm_bindgen(js_name = jitStats)]
    pub fn jit_stats(&self) -> Result<JsValue, JsError> {
        let inner = self.inner.try_borrow().map_err(|_| reentrant())?;
        Ok(jit_stats_object(&inner.machine))
    }

    /// Run up to `max_instrs`, drain console output to the JS callback, feed queued input to the
    /// 16550 RX, and return `{ done: bool, state: string|null, retired: number }`. A persistent caller may pass
    /// `persist_max_dirty_bytes`; execution then yields as soon as the write-back queue reaches
    /// that limit so JS can durably drain it before the guest can race arbitrarily far ahead.
    /// `state` is `"poweroff"`, `"reboot"`, `"fail:<code>"`, `"exited:<code>"`, or
    /// `"trap:<cause>"` once terminal.
    #[wasm_bindgen(js_name = runChunk)]
    pub fn run_chunk(
        &self,
        max_instrs: u32,
        persist_max_dirty_bytes: Option<u32>,
    ) -> Result<JsValue, JsError> {
        let mut inner = self.inner.try_borrow_mut().map_err(|_| reentrant())?;
        let retired_before = inner.machine.irq_stats().retired;
        if inner.finished.is_none() {
            let mut sink = wasm_vm_core::trace::NullSink;
            // Interleave RX refills with execution. The 16550 RX FIFO is 16 bytes; feeding it only
            // once per budget caps host→guest throughput at ~16 bytes per chunk and wastes the rest
            // of the budget on a near-empty FIFO. Instead, when input is queued, run in short slices
            // and top up the FIFO between them so the guest drains it many times within one budget
            // (bulk paste / held-key autorepeat throughput ~ slices × FIFO depth). When nothing is
            // queued this collapses to a single full-budget run — unless persistent-disk pressure
            // also needs a boundary. Without that boundary one 2M-instruction slice can complete an
            // 80 MiB `dd` before IndexedDB reports quota exhaustion, falsely returning success to
            // the guest before the UI can pause it (E3-T10 acceptance finding).
            const INPUT_SLICE: u64 = 16_384;
            const PERSIST_SLICE: u64 = 16_384;
            let mut remaining = max_instrs as u64;
            // All internal UART/persistence sub-runs are one JS-visible cooperative Worker slice.
            // Share one browser-executor submission budget across them; otherwise each 16,384-op
            // refill boundary would reset the budget and one runChunk could still compile hundreds
            // of blocks synchronously before input/RPC tasks regain the event loop.
            inner.machine.begin_cooperative_run();
            let outcome = loop {
                // Feed queued host input into the RX FIFO, up to its free space (no overrun).
                if !inner.pending.is_empty() {
                    let free = inner.uart.borrow().rx_free();
                    let n = free.min(inner.pending.len());
                    if n > 0 {
                        let batch: Vec<u8> = inner.pending.drain(..n).collect();
                        inner.uart.borrow_mut().push_input(&batch);
                    }
                }
                let persistence_bounded =
                    persist_max_dirty_bytes.is_some() && inner.persist.is_some();
                let step = if !inner.pending.is_empty() {
                    INPUT_SLICE.min(remaining)
                } else if persistence_bounded {
                    PERSIST_SLICE.min(remaining)
                } else {
                    remaining
                };
                let oc = inner.machine.run_traced(step, &mut sink);
                remaining -= step;
                let persistence_due = persistence_bounded
                    && (inner.machine.blk_write_waiting()
                        || persist_max_dirty_bytes.is_some_and(|limit| {
                            limit > 0
                                && inner.persist.as_ref().is_some_and(|(_, queue, _)| {
                                    queue
                                        .borrow()
                                        .unpersisted_count()
                                        .saturating_mul(wasm_vm_storage::OVERLAY_BLOCK)
                                        >= limit as usize
                                })
                        }));
                if remaining == 0 || persistence_due || !matches!(oc, RunOutcome::MaxInstrs) {
                    break oc;
                }
            };
            inner.machine.end_cooperative_run(outcome);
            // Drain the 16550 TX into the console buffer.
            let uart_out = inner.uart.borrow_mut().take_output();
            inner.out.borrow_mut().extend_from_slice(&uart_out);
            inner.finished = match outcome {
                RunOutcome::Reset(wasm_vm_core::ExitReason::PowerOff) => Some("poweroff".into()),
                RunOutcome::Reset(wasm_vm_core::ExitReason::Reboot) => Some("reboot".into()),
                RunOutcome::Reset(wasm_vm_core::ExitReason::Fail(c)) => Some(format!("fail:{c}")),
                RunOutcome::Exited(code) => Some(format!("exited:{code}")),
                RunOutcome::Trapped(t) => Some(format!("trap:{:?}", t.cause)),
                RunOutcome::MaxInstrs => None, // keep going
            };
        }
        // Flush accumulated console output to JS as one chunk.
        let bytes = std::mem::take(&mut *inner.out.borrow_mut());
        if !bytes.is_empty() {
            let arr = js_sys::Uint8Array::from(&bytes[..]);
            let _ = inner.output.call1(&JsValue::NULL, &arr);
        }
        let obj = js_sys::Object::new();
        let _ = js_sys::Reflect::set(
            &obj,
            &"done".into(),
            &JsValue::from_bool(inner.finished.is_some()),
        );
        match &inner.finished {
            Some(s) => {
                let _ = js_sys::Reflect::set(&obj, &"state".into(), &JsValue::from_str(s));
            }
            None => {
                let _ = js_sys::Reflect::set(&obj, &"state".into(), &JsValue::NULL);
            }
        }
        let retired = inner
            .machine
            .irq_stats()
            .retired
            .wrapping_sub(retired_before);
        let _ = js_sys::Reflect::set(&obj, &"retired".into(), &JsValue::from_f64(retired as f64));
        Ok(obj.into())
    }

    /// Final/current guest-RAM SHA-256 for browser evidence. This is the `mem_digest` portion of the
    /// native snapshot contract; registers and device state are intentionally not encoded here.
    #[wasm_bindgen(js_name = stateDigest)]
    pub fn state_digest(&self) -> Result<String, JsError> {
        let inner = self.inner.try_borrow().map_err(|_| reentrant())?;
        Ok(inner.machine.snapshot().hex_digest())
    }

    /// E4-T01: arm/disarm the hot-PC + subsystem-time profiler for this boot. Arming injects a
    /// `performance.now()`-backed [`JsHostTimer`]; sampling is 1-in-~1024 retires + cold-path-only
    /// timing (~0 overhead). Returns `false` if no `performance` object is available to arm it.
    #[wasm_bindgen(js_name = setProfiling)]
    pub fn set_profiling(&self, on: bool) -> Result<bool, JsError> {
        let mut inner = self.inner.try_borrow_mut().map_err(|_| reentrant())?;
        if on {
            match JsHostTimer::new() {
                Some(timer) => {
                    inner.machine.set_host_timer(std::rc::Rc::new(timer));
                    Ok(true)
                }
                None => Ok(false),
            }
        } else {
            inner.machine.set_profiling(false);
            Ok(true)
        }
    }

    /// E4-T01: the accumulated profile as a plain JS object — `{ totalNs, sampleCount, walkCount,
    /// collisions, regions: [{ pc, samples, pct }], subsystems: [{ name, ns }] }` — mirroring the
    /// `getStats` surface the UI already consumes. `pc` is a hex string (a guest PC exceeds 2^53).
    #[wasm_bindgen(js_name = getProfile)]
    pub fn get_profile(&self) -> Result<JsValue, JsError> {
        let inner = self.inner.try_borrow().map_err(|_| reentrant())?;
        let report = inner.machine.prof_report(inner.machine.prof_total_ns(), 10);
        let obj = js_sys::Object::new();
        let set = |k: &str, v: &JsValue| {
            let _ = js_sys::Reflect::set(&obj, &JsValue::from_str(k), v);
        };
        set("totalNs", &JsValue::from_f64(report.total_ns as f64));
        set(
            "sampleCount",
            &JsValue::from_f64(report.sample_count as f64),
        );
        set("walkCount", &JsValue::from_f64(report.walk_count as f64));
        set("collisions", &JsValue::from_f64(report.collisions as f64));
        let regions = js_sys::Array::new();
        for r in &report.top_regions {
            let o = js_sys::Object::new();
            let _ = js_sys::Reflect::set(
                &o,
                &JsValue::from_str("pc"),
                &JsValue::from_str(&format!("0x{:016x}", r.phys_pc)),
            );
            let _ = js_sys::Reflect::set(
                &o,
                &JsValue::from_str("samples"),
                &JsValue::from_f64(r.samples as f64),
            );
            let _ = js_sys::Reflect::set(&o, &JsValue::from_str("pct"), &JsValue::from_f64(r.pct));
            regions.push(&o);
        }
        set("regions", &regions);
        let subsystems = js_sys::Array::new();
        for (sub, ns) in &report.subsystem_ns {
            let o = js_sys::Object::new();
            let _ = js_sys::Reflect::set(
                &o,
                &JsValue::from_str("name"),
                &JsValue::from_str(sub.name()),
            );
            let _ =
                js_sys::Reflect::set(&o, &JsValue::from_str("ns"), &JsValue::from_f64(*ns as f64));
            subsystems.push(&o);
        }
        set("subsystems", &subsystems);
        let pause = report.jit_pause;
        let jit_pause = js_sys::Object::new();
        let set_pause = |k: &str, v: u64| {
            let _ = js_sys::Reflect::set(
                &jit_pause,
                &JsValue::from_str(k),
                &JsValue::from_f64(v as f64),
            );
        };
        set_pause("count", pause.count);
        set_pause("maxNs", pause.max_ns);
        set_pause("sumNs", pause.sum_ns);
        set_pause("overTarget", pause.over_target);
        set_pause("maxAttemptedBlocks", pause.max_attempted_blocks);
        set_pause("totalAttemptedBlocks", pause.total_attempted_blocks);
        set_pause("maxSubmittedBlocks", pause.max_submitted_blocks);
        set_pause("maxSubmittedBytes", pause.max_submitted_bytes);
        set_pause("totalSubmittedBlocks", pause.total_submitted_blocks);
        set_pause("runCount", pause.run_count);
        set_pause("lastRunAttemptedBlocks", pause.last_run_attempted_blocks);
        set_pause("maxRunAttemptedBlocks", pause.max_run_attempted_blocks);
        set_pause("lastRunSubmittedBlocks", pause.last_run_submitted_blocks);
        set_pause("maxRunSubmittedBlocks", pause.max_run_submitted_blocks);
        set_pause(
            "lastRunStagedNominations",
            pause.last_run_staged_nominations,
        );
        set_pause("maxRunStagedNominations", pause.max_run_staged_nominations);
        set_pause("lastFinalPumps", pause.last_final_pumps);
        set_pause("maxFinalPumps", pause.max_final_pumps);
        set_pause(
            "lastFinalAttemptedBlocks",
            pause.last_final_attempted_blocks,
        );
        set_pause("maxFinalAttemptedBlocks", pause.max_final_attempted_blocks);
        set_pause(
            "lastFinalSubmittedBlocks",
            pause.last_final_submitted_blocks,
        );
        set_pause("maxFinalSubmittedBlocks", pause.max_final_submitted_blocks);
        set("jitPause", &jit_pause);
        Ok(obj.into())
    }

    /// Queue host keystrokes for the guest's `ttyS0` (fed to the RX FIFO across `runChunk`s).
    #[wasm_bindgen(js_name = sendInput)]
    pub fn send_input(&self, bytes: &[u8]) -> Result<(), JsError> {
        let mut inner = self.inner.try_borrow_mut().map_err(|_| reentrant())?;
        inner.pending.extend(bytes.iter().copied());
        Ok(())
    }

    #[wasm_bindgen(js_name = fileTransferReady)]
    pub fn file_transfer_ready(&self, slot: u32) -> Result<bool, JsError> {
        let inner = self.inner.try_borrow().map_err(|_| reentrant())?;
        Ok(inner
            .file_transfers
            .as_ref()
            .is_some_and(|transfers| transfers.ready(slot as usize)))
    }

    #[wasm_bindgen(js_name = setFileDownloadReady)]
    pub fn set_file_download_ready(&self, ready: bool) -> Result<(), JsError> {
        let mut inner = self.inner.try_borrow_mut().map_err(|_| reentrant())?;
        inner
            .file_transfers
            .as_mut()
            .ok_or_else(|| JsError::new("file transfer requires a slirp boot"))?
            .set_download_ready(ready);
        Ok(())
    }

    #[wasm_bindgen(js_name = beginFileUpload)]
    pub fn begin_file_upload(
        &self,
        slot: u32,
        name: String,
        total: u32,
        sha256_hex: String,
    ) -> Result<u32, JsError> {
        let sha256 = browser_file_transfer::parse_sha256(&sha256_hex)
            .map_err(|error| JsError::new(&format!("file upload SHA-256: {error:?}")))?;
        let mut inner = self.inner.try_borrow_mut().map_err(|_| reentrant())?;
        inner
            .file_transfers
            .as_mut()
            .ok_or_else(|| JsError::new("file transfer requires a slirp boot"))?
            .begin_upload(slot as usize, name, total as u64, sha256)
            .map_err(|error| JsError::new(&format!("begin file upload: {error:?}")))
    }

    #[wasm_bindgen(js_name = pushFileUpload)]
    pub fn push_file_upload(
        &self,
        stream: u32,
        bytes: &[u8],
        finished: bool,
    ) -> Result<u32, JsError> {
        let mut inner = self.inner.try_borrow_mut().map_err(|_| reentrant())?;
        let buffered = inner
            .file_transfers
            .as_mut()
            .ok_or_else(|| JsError::new("file transfer requires a slirp boot"))?
            .push_upload(stream, bytes, finished)
            .map_err(|error| JsError::new(&format!("push file upload: {error:?}")))?;
        Ok(buffered as u32)
    }

    #[wasm_bindgen(js_name = cancelFileUpload)]
    pub fn cancel_file_upload(&self, stream: u32) -> Result<(), JsError> {
        let mut inner = self.inner.try_borrow_mut().map_err(|_| reentrant())?;
        inner
            .file_transfers
            .as_mut()
            .ok_or_else(|| JsError::new("file transfer requires a slirp boot"))?
            .cancel(stream)
            .map_err(|error| JsError::new(&format!("cancel file upload: {error:?}")))
    }

    #[wasm_bindgen(js_name = dismissFileUpload)]
    pub fn dismiss_file_upload(&self, stream: u32) -> Result<bool, JsError> {
        let mut inner = self.inner.try_borrow_mut().map_err(|_| reentrant())?;
        Ok(inner
            .file_transfers
            .as_mut()
            .is_some_and(|transfers| transfers.dismiss_upload(stream)))
    }

    #[wasm_bindgen(js_name = cancelFileDownload)]
    pub fn cancel_file_download(&self, id: u32) -> Result<(), JsError> {
        let mut inner = self.inner.try_borrow_mut().map_err(|_| reentrant())?;
        inner
            .file_transfers
            .as_mut()
            .ok_or_else(|| JsError::new("file transfer requires a slirp boot"))?
            .cancel_download(id)
            .map_err(|error| JsError::new(&format!("cancel file download: {error:?}")))
    }

    #[wasm_bindgen(js_name = finishFileDownload)]
    pub fn finish_file_download(&self, id: u32, success: bool) -> Result<(), JsError> {
        let mut inner = self.inner.try_borrow_mut().map_err(|_| reentrant())?;
        inner
            .file_transfers
            .as_mut()
            .ok_or_else(|| JsError::new("file transfer requires a slirp boot"))?
            .finish_download(id, success)
            .map_err(|error| JsError::new(&format!("finish file download: {error:?}")))
    }

    #[wasm_bindgen(js_name = fileTransferStatus)]
    pub fn file_transfer_status(&self) -> Result<String, JsError> {
        let inner = self.inner.try_borrow().map_err(|_| reentrant())?;
        Ok(inner.file_transfers.as_ref().map_or_else(
            || "{\"maxBuffered\":0,\"uploads\":[],\"downloads\":[]}".into(),
            |t| t.status_json(),
        ))
    }

    /// E3-T21d: the persistent driver calls this right after `persistPending` so a durable IndexedDB
    /// flush pause — during which the guest is frozen and cannot ACK or heartbeat an in-flight file
    /// transfer — does not accrue against the WVFT idle-timeout budget. No-op when nothing is
    /// transferring or off the slirp path.
    #[wasm_bindgen(js_name = noteFileTransferPersist)]
    pub fn note_file_transfer_persist(&self) -> Result<(), JsError> {
        let mut inner = self.inner.try_borrow_mut().map_err(|_| reentrant())?;
        if let Some(transfers) = inner.file_transfers.as_mut() {
            transfers.note_persist();
        }
        Ok(())
    }

    #[wasm_bindgen(js_name = takeFileDownloadChunk)]
    pub fn take_file_download_chunk(&self, id: u32) -> Result<js_sys::Uint8Array, JsError> {
        let mut inner = self.inner.try_borrow_mut().map_err(|_| reentrant())?;
        let bytes = inner
            .file_transfers
            .as_mut()
            .and_then(|transfers| transfers.take_download_chunk(id))
            .unwrap_or_default();
        Ok(js_sys::Uint8Array::from(bytes.as_slice()))
    }

    #[wasm_bindgen(js_name = dismissFileDownload)]
    pub fn dismiss_file_download(&self, id: u32) -> Result<bool, JsError> {
        let mut inner = self.inner.try_borrow_mut().map_err(|_| reentrant())?;
        Ok(inner
            .file_transfers
            .as_mut()
            .is_some_and(|transfers| transfers.dismiss_download(id)))
    }

    /// E3-T02: the chunk indices the virtio-blk device is currently parked on (guest reads awaiting a
    /// lazy fetch). Empty for a non-chunked boot or when nothing is parked. The JS driver calls this
    /// after each `runChunk` and, if non-empty, awaits `fetchPending` before the next `runChunk`.
    #[wasm_bindgen(js_name = pendingChunks)]
    pub fn pending_chunks(&self) -> Result<Vec<u32>, JsError> {
        let inner = self.inner.try_borrow().map_err(|_| reentrant())?;
        Ok(inner
            .machine
            .pending_blk_chunks()
            .into_iter()
            .map(|c| c as u32)
            .collect())
    }

    /// E3-T02: fetch (and hash-verify) every chunk the device is parked on, populating the store so
    /// the next `runChunk` completes the parked reads. Resolves to the number of chunks newly made
    /// resident. No-op (0) for a non-chunked boot. Must not run concurrently with `runChunk` (both
    /// borrow the machine); the JS driver alternates them.
    #[wasm_bindgen(js_name = fetchPending)]
    pub async fn fetch_pending(&self) -> Result<u32, JsError> {
        // Clone the fetch handle and snapshot the parked chunks under a brief borrow, then release it
        // BEFORE awaiting — an `await` while holding `inner` would alias the borrow on re-entry.
        let (state, pending) = {
            let inner = self.inner.try_borrow().map_err(|_| reentrant())?;
            match &inner.fetch {
                Some(s) => (s.clone(), inner.machine.pending_blk_chunks()),
                None => return Ok(0),
            }
        };
        Ok(http_fetch::fetch_pending(&state, &pending).await)
    }

    /// E3-T05: durably flush the overlay's pending writes to IndexedDB. Resolves to the number of
    /// blocks persisted; its Promise resolves only after the IndexedDB transaction `complete` event
    /// (`durability` per the store), so a caller that awaits it knows the writes survive a reload. A
    /// block re-written during the flush is NOT marked persisted (generation guard) and is flushed
    /// next call — never lost. No-op (0) for a non-persistent boot. Must not run concurrently with
    /// `runChunk` (both borrow the machine); the JS driver alternates them.
    #[wasm_bindgen(js_name = persistPending)]
    pub async fn persist_pending(&self) -> Result<u32, JsError> {
        // Clone the store handle + shared queue out under a brief borrow; never hold it across await.
        let (idb, queue, overlay_meta, current_generation) = {
            let inner = self.inner.try_borrow().map_err(|_| reentrant())?;
            match &inner.persist {
                Some((idb, q, meta)) => (
                    idb.clone(),
                    q.clone(),
                    *meta,
                    inner.machine.overlay_generation(),
                ),
                None => return Ok(0),
            }
        };
        let batch = queue.borrow().pending_flush(); // (block, generation, bytes)
        if batch.is_empty() {
            return Ok(0);
        }
        let blocks: Vec<(u64, [u8; wasm_vm_storage::OVERLAY_BLOCK])> =
            batch.iter().map(|(b, _, bytes)| (*b, *bytes)).collect();
        let next_generation = current_generation.saturating_add(1);
        let next_meta = overlay_meta.with_generation(next_generation);
        if let Err(e) = idb
            .persist_overlay_batch(&blocks, &next_meta.to_bytes())
            .await
        {
            // E3-T10: classify the failure. On QuotaExceeded we DELIBERATELY do NOT
            // mark_persisted — the dirty blocks stay pending and the persistent virtio WRITE that
            // produced them remains outside the used ring. Freeing space + retry may complete it;
            // Continue read-only resolves it with IOERR. The error is tagged so the loader can
            // pause + show the quota dialog (vs a generic failure).
            let name = e.as_string().unwrap_or_else(|| format!("{e:?}"));
            let kind = storage_err::StorageError::classify(&name);
            if kind.is_quota() {
                return Err(JsError::new(&format!("StorageFull: {name}")));
            }
            return Err(JsError::new(&format!("IndexedDB persist: {name}")));
        }
        // Mark exactly what was flushed (generation-guarded) — a mid-flush re-write stays pending.
        let pairs: Vec<(u64, u64)> = batch.iter().map(|(b, g, _)| (*b, *g)).collect();
        queue.borrow_mut().mark_persisted(&pairs);
        // The IndexedDB transaction committed both the blocks and this generation. Advance the
        // machine only after that strict durability barrier; a reload can therefore never observe
        // a newer in-memory generation whose disk bytes did not commit.
        let mut inner = self.inner.try_borrow_mut().map_err(|_| reentrant())?;
        if inner.machine.overlay_generation() == current_generation {
            inner.machine.advance_overlay_generation();
        }
        Ok(batch.len() as u32)
    }

    // ── E3-T12d: browser resume-snapshot persistence + restore selection ──────────────────────────

    /// Take a whole-machine resume snapshot and return its bytes as a `Uint8Array`. NOT async and NOT
    /// persisting — kept synchronous so the `RefCell` borrow is never held across an `await` (the JS
    /// caller may drive persistence itself, or use [`Self::persist_snapshot`]). `save_resume` quiesces
    /// virtio-blk first; if the in-flight set cannot drain, the error message starts with
    /// `"not_quiesced"` so the caller can retry rather than treat it as a hard failure; any other error
    /// starts with `"save_error"`.
    #[wasm_bindgen(js_name = saveSnapshot)]
    pub fn save_snapshot(&self) -> Result<JsValue, JsError> {
        let mut inner = self.inner.try_borrow_mut().map_err(|_| reentrant())?;
        let blob = inner.machine.save_resume().map_err(|e| match e {
            resume::SnapshotError::NotQuiesced { reason, in_flight } => {
                JsError::new(&format!("not_quiesced: {reason:?} in_flight={in_flight}"))
            }
            other => JsError::new(&format!("save_error: {other:?}")),
        })?;
        Ok(js_sys::Uint8Array::from(&blob[..]).into())
    }

    /// Convenience: take a resume snapshot AND durably persist it to the snapshot IndexedDB store in one
    /// call. The `RefCell` borrow is scoped to `save_resume` + reading `snapshot_base`; the store I/O
    /// runs after it is dropped, never across the borrow. The write counter keeps a lease release
    /// from handing the namespace to another tab until this async operation has committed. No-op
    /// error `"not_persistent"` off the persistent path (there is no snapshot store to write to).
    #[wasm_bindgen(js_name = persistSnapshot)]
    pub async fn persist_snapshot(&self) -> Result<(), JsError> {
        let (blob, base, write_count) = {
            let mut inner = self.inner.try_borrow_mut().map_err(|_| reentrant())?;
            let Some(base) = inner.snapshot_base else {
                return Err(JsError::new("not_persistent"));
            };
            if inner.snapshot_read_only {
                return Err(JsError::new("read_only"));
            }
            let blob = inner.machine.save_resume().map_err(|e| match e {
                resume::SnapshotError::NotQuiesced { reason, in_flight } => {
                    JsError::new(&format!("not_quiesced: {reason:?} in_flight={in_flight}"))
                }
                other => JsError::new(&format!("save_error: {other:?}")),
            })?;
            let write_count = inner.snapshot_write_count.clone();
            write_count.set(write_count.get().saturating_add(1));
            (blob, base, write_count)
        };
        let result = async {
            let store = snapshot_store::SnapshotStore::open(&base)
                .await
                .map_err(|e| JsError::new(&format!("snapshot open: {e:?}")))?;
            store
                .save(&blob, &base)
                .await
                .map_err(|e| JsError::new(&format!("snapshot save: {e:?}")))?;
            Ok(())
        }
        .await;
        finish_snapshot_write(&write_count);
        result
    }

    /// Permanently relinquish this machine's snapshot-writer role. Web Locks releases are dynamic:
    /// another tab may acquire the same namespace while this controller is still alive, so the
    /// construction-time read-only bit alone is not a sufficient fence for a stale controller. New
    /// writes are fenced immediately, while writes that already passed the check are allowed to
    /// finish before this method resolves. There is intentionally no inverse operation; a new
    /// machine must acquire the writer lock before it can save or import snapshots.
    #[wasm_bindgen(js_name = relinquishSnapshotWriter)]
    pub async fn relinquish_snapshot_writer(&self) -> Result<(), JsError> {
        let write_count = {
            let mut inner = self.inner.try_borrow_mut().map_err(|_| reentrant())?;
            inner.snapshot_read_only = true;
            inner.snapshot_write_count.clone()
        };
        wait_for_snapshot_writes(write_count).await;
        Ok(())
    }

    /// Read the persisted snapshot blob back (reassembled), or `null` if none is stored / not on the
    /// persistent path. Async (IndexedDB). This is the export/debug surface; production restore uses
    /// [`Self::restore_stored_snapshot`] so the blob never crosses the wasm/JS boundary as a second
    /// whole-payload copy.
    #[wasm_bindgen(js_name = readStoredSnapshot)]
    pub async fn read_stored_snapshot(&self) -> Result<JsValue, JsError> {
        let base = {
            let inner = self.inner.try_borrow().map_err(|_| reentrant())?;
            match inner.snapshot_base {
                Some(base) => base,
                None => return Ok(JsValue::NULL),
            }
        };
        let store = snapshot_store::SnapshotStore::open(&base)
            .await
            .map_err(|e| JsError::new(&format!("snapshot open: {e:?}")))?;
        match store
            .load()
            .await
            .map_err(|e| JsError::new(&format!("snapshot load: {e:?}")))?
        {
            Some(blob) => Ok(js_sys::Uint8Array::from(&blob[..]).into()),
            None => Ok(JsValue::NULL),
        }
    }

    /// Load and, only when coherent, apply the persisted snapshot directly inside wasm. The stored
    /// blob is held by one Rust allocation while the coherence header is checked and the machine is
    /// restored; unlike `readStoredSnapshot` this path does not create a JS `Uint8Array` boundary copy.
    /// Returns the same typed decision code as `restoreDecisionCode`, with no machine mutation for a
    /// missing, corrupt, foreign, or stale snapshot.
    #[wasm_bindgen(js_name = restoreStoredSnapshot)]
    pub async fn restore_stored_snapshot(&self) -> Result<String, JsError> {
        let base = {
            let inner = self.inner.try_borrow().map_err(|_| reentrant())?;
            match inner.snapshot_base {
                Some(base) => base,
                None => return Ok("missing".to_string()),
            }
        };
        let store = snapshot_store::SnapshotStore::open(&base)
            .await
            .map_err(|e| JsError::new(&format!("snapshot open: {e:?}")))?;
        let Some(blob) = store
            .load()
            .await
            .map_err(|e| JsError::new(&format!("snapshot load: {e:?}")))?
        else {
            return Ok("missing".to_string());
        };

        let mut inner = self.inner.try_borrow_mut().map_err(|_| reentrant())?;
        // The identity is immutable for the lifetime of a machine, but re-check it at the commit
        // point so an unusual concurrent host callback cannot restore into a different namespace.
        let Some(current_base) = inner.snapshot_base else {
            return Ok("missing".to_string());
        };
        if current_base != base {
            return Ok("foreign_image".to_string());
        }
        let decision = resume::RestoreDecision::decide(
            Some(&blob),
            &build_core_hash(),
            &base,
            inner.machine.overlay_generation(),
        );
        if decision.is_resume() {
            inner.machine.load_resume(&blob).map_err(|e| {
                JsError::new(resume::ColdBootReason::from_snapshot_error(&e).code())
            })?;
        }
        Ok(decision.code().to_string())
    }

    /// Persist an externally supplied snapshot blob (AC3 import) into the snapshot store for THIS boot's
    /// base image. The blob is bound to this base's namespace; a foreign blob imported here still fails
    /// the coherence guard on restore. Framing-corrupt input is replaced by a corrupt marker, and a
    /// same-size payload mutation is checked against the digest of the previously published snapshot;
    /// both paths make the next decision typed `"corrupt"` rather than falsely `"resume"`. The live
    /// machine and overlay are not mutated. The write counter keeps lease release behind this full
    /// namespace mutation. Error `"not_persistent"` off the persistent path.
    #[wasm_bindgen(js_name = importStoredSnapshot)]
    pub async fn import_stored_snapshot(&self, blob: Vec<u8>) -> Result<(), JsError> {
        let (base, current_generation, write_count) = {
            let inner = self.inner.try_borrow().map_err(|_| reentrant())?;
            if inner.snapshot_read_only {
                return Err(JsError::new("read_only"));
            }
            let base = match inner.snapshot_base {
                Some(base) => base,
                None => return Err(JsError::new("not_persistent")),
            };
            let write_count = inner.snapshot_write_count.clone();
            write_count.set(write_count.get().saturating_add(1));
            (base, inner.machine.overlay_generation(), write_count)
        };
        let result = async {
            let store = snapshot_store::SnapshotStore::open(&base)
                .await
                .map_err(|e| JsError::new(&format!("snapshot open: {e:?}")))?;
            let previous = store
                .read_meta()
                .await
                .map_err(|e| JsError::new(&format!("snapshot metadata: {e:?}")))?
                .and_then(|bytes| wasm_vm_storage::SnapshotMeta::from_bytes(&bytes).ok())
                .filter(|meta| meta.base_binding == base && meta.total_len > 0);
            if resume::validate_container(&blob).is_err() {
                store
                    .mark_corrupt(&base)
                    .await
                    .map_err(|e| JsError::new(&format!("snapshot corrupt marker: {e:?}")))?;
                return Ok(());
            }
            let imported_digest: [u8; 32] = Sha256::digest(&blob).into();
            let decision = resume::RestoreDecision::decide(
                Some(&blob),
                &build_core_hash(),
                &base,
                current_generation,
            );
            if decision.is_resume()
                && previous.is_some_and(|meta| {
                    meta.total_len != blob.len() as u64 || meta.blob_sha256 != imported_digest
                })
            {
                store
                    .mark_corrupt(&base)
                    .await
                    .map_err(|e| JsError::new(&format!("snapshot corrupt marker: {e:?}")))?;
                return Ok(());
            }
            store
                .save(&blob, &base)
                .await
                .map_err(|e| JsError::new(&format!("snapshot import: {e:?}")))?;
            Ok(())
        }
        .await;
        finish_snapshot_write(&write_count);
        result
    }

    /// The current overlay commit generation (the snapshot coherence's third binding). `u64` fits
    /// exactly in an `f64` for every realistic generation count.
    #[wasm_bindgen(js_name = overlayGeneration)]
    pub fn overlay_generation(&self) -> Result<f64, JsError> {
        let inner = self.inner.try_borrow().map_err(|_| reentrant())?;
        Ok(inner.machine.overlay_generation() as f64)
    }

    /// Advance the overlay commit generation and return the new value. A stored snapshot taken before
    /// the advance now fails the coherence guard (`"stale"`) — this is how a durable overlay commit
    /// invalidates a now-inconsistent CPU/RAM snapshot.
    #[wasm_bindgen(js_name = advanceOverlayGeneration)]
    pub fn advance_overlay_generation(&self) -> Result<f64, JsError> {
        let mut inner = self.inner.try_borrow_mut().map_err(|_| reentrant())?;
        Ok(inner.machine.advance_overlay_generation() as f64)
    }

    /// The header-level resume-vs-cold-boot verdict for `stored` (the reassembled blob, or `None`),
    /// against THIS boot's build identity + base binding + `current_generation`. Returns the stable
    /// code (`"resume"`/`"missing"`/`"corrupt"`/`"foreign_build"`/`"foreign_image"`/`"stale"`). Off the
    /// persistent path (no base binding) there is no snapshot to resume: always `"missing"`.
    #[wasm_bindgen(js_name = restoreDecisionCode)]
    pub fn restore_decision_code(
        &self,
        stored: Option<Vec<u8>>,
        current_generation: f64,
    ) -> Result<String, JsError> {
        let inner = self.inner.try_borrow().map_err(|_| reentrant())?;
        let Some(base) = inner.snapshot_base else {
            return Ok("missing".to_string());
        };
        let core = build_core_hash();
        let decision = resume::RestoreDecision::decide(
            stored.as_deref(),
            &core,
            &base,
            current_generation as u64,
        );
        Ok(decision.code().to_string())
    }

    /// Restore machine state from a resume blob (all-or-nothing; the coherence header is validated
    /// FIRST). A rejected blob is mapped through [`resume::ColdBootReason`] so the JS boundary gets the
    /// typed reason (`"missing"`/`"corrupt"`/`"foreign_build"`/`"foreign_image"`/`"stale"`) in the error
    /// message rather than a device-internal string. NOT async (pure state application).
    #[wasm_bindgen(js_name = loadSnapshotBlob)]
    pub fn load_snapshot_blob(&self, blob: Vec<u8>) -> Result<(), JsError> {
        let mut inner = self.inner.try_borrow_mut().map_err(|_| reentrant())?;
        inner
            .machine
            .load_resume(&blob)
            .map_err(|e| JsError::new(resume::ColdBootReason::from_snapshot_error(&e).code()))
    }

    /// E4 restore-on-first-load (busybox boot-snapshot): stamp THIS machine's coherence identity so a
    /// shipped, build-time boot snapshot can be restored on the initramfs path (which otherwise sets no
    /// snapshot identity — `snapshot_base` stays `None` and every restore verdict is `"missing"`).
    ///
    /// The core identity is [`build_core_hash`] (the crate version), so a snapshot produced by a
    /// DIFFERENT build fails the `CoreHashMismatch` guard and the caller falls back to a cold boot —
    /// the guard is bound, never bypassed. `base_id` (32 bytes) binds the snapshot to a specific
    /// kernel+initramfs pair (the JS caller derives it from the boot manifest's artifact hashes); a
    /// snapshot for a different kernel/initramfs fails `BaseImageMismatch`. Overlay generation stays 0
    /// (the initramfs path has no durable overlay to invalidate against).
    #[wasm_bindgen(js_name = stampBootSnapshotIdentity)]
    pub fn stamp_boot_snapshot_identity(&self, base_id: &[u8]) -> Result<(), JsError> {
        if base_id.len() != 32 {
            return Err(JsError::new(
                "stampBootSnapshotIdentity: base_id must be 32 bytes",
            ));
        }
        let mut base = [0u8; 32];
        base.copy_from_slice(base_id);
        let mut inner = self.inner.try_borrow_mut().map_err(|_| reentrant())?;
        inner.machine.set_snapshot_identity(build_core_hash(), base);
        inner.snapshot_base = Some(base);
        Ok(())
    }

    /// E3-T10 (critic BUG-4): close the IndexedDB connection so a `deleteDatabase` (reset-disk)
    /// can proceed instead of blocking on our open handle. Call before wiping; the machine must
    /// not persist afterward. No-op off the persistent path.
    #[wasm_bindgen(js_name = closeStorage)]
    pub fn close_storage(&self) -> Result<(), JsError> {
        let inner = self.inner.try_borrow().map_err(|_| reentrant())?;
        if let Some((idb, _, _)) = &inner.persist {
            idb.close();
        }
        Ok(())
    }

    /// E3-T10: flip the disk to read-only at runtime — the "continue read-only" choice after a
    /// storage-quota hit. Subsequent guest writes get EIO (VIRTIO_BLK_F_RO / BlockError::ReadOnly)
    /// so the guest sees an honest I/O error instead of a silently-undurable write. No-op off the
    /// persistent path. Returns true if a disk flag was flipped.
    #[wasm_bindgen(js_name = setDiskReadOnly)]
    pub fn set_disk_read_only(&self) -> Result<bool, JsError> {
        let inner = self.inner.try_borrow().map_err(|_| reentrant())?;
        match &inner.disk_ro {
            Some(cell) => {
                cell.set(true);
                Ok(true)
            }
            None => Ok(false),
        }
    }

    /// E3-T10: whether the overlay has unpersisted (dirty) blocks. In persistent writer mode these
    /// belong to a virtio WRITE that has not been acknowledged; the quota dialog uses this to say
    /// Retry may still complete it, while Continue returns IOERR.
    #[wasm_bindgen(js_name = hasUnpersisted)]
    pub fn has_unpersisted(&self) -> Result<bool, JsError> {
        let inner = self.inner.try_borrow().map_err(|_| reentrant())?;
        Ok(inner
            .persist
            .as_ref()
            .is_some_and(|(_, q, _)| !q.borrow().is_empty()))
    }

    /// E3-T08/E3-T10 persistence pressure —
    /// `{ pendingBlocks, pendingBytes, flushWaiting, writeWaiting }`. The JS pump persists
    /// immediately when a guest WRITE or FLUSH is parked awaiting durable commit; pending bytes
    /// over the configured threshold remain the generic write-back backpressure signal. Zeros for
    /// non-persistent boots.
    #[wasm_bindgen(js_name = persistStats)]
    pub fn persist_stats(&self) -> Result<JsValue, JsError> {
        let inner = self.inner.try_borrow().map_err(|_| reentrant())?;
        let obj = js_sys::Object::new();
        let (blocks, flush_waiting, write_waiting) = match &inner.persist {
            Some((_, q, _)) => {
                let n = q.borrow().unpersisted_count();
                (
                    n,
                    inner.machine.blk_flush_waiting(),
                    inner.machine.blk_write_waiting(),
                )
            }
            None => (0, false, false),
        };
        let _ = js_sys::Reflect::set(
            &obj,
            &"pendingBlocks".into(),
            &JsValue::from_f64(blocks as f64),
        );
        let _ = js_sys::Reflect::set(
            &obj,
            &"pendingBytes".into(),
            &JsValue::from_f64((blocks * wasm_vm_storage::OVERLAY_BLOCK) as f64),
        );
        let _ = js_sys::Reflect::set(
            &obj,
            &"flushWaiting".into(),
            &JsValue::from_bool(flush_waiting),
        );
        let _ = js_sys::Reflect::set(
            &obj,
            &"writeWaiting".into(),
            &JsValue::from_bool(write_waiting),
        );
        Ok(obj.into())
    }

    /// E3-T02/T03 instrumentation: `{ fetches, bytes, error, cache }` — chunk fetches + bytes
    /// transferred (pass-4 acceptance), the first fetch error (or null), and the E3-T03 cache metrics
    /// `{ hits, misses, evictions, residentBytes, budgetBytes }`. A non-chunked boot reports zeros.
    #[wasm_bindgen(js_name = fetchStats)]
    pub fn fetch_stats(&self) -> Result<JsValue, JsError> {
        let inner = self.inner.try_borrow().map_err(|_| reentrant())?;
        let obj = js_sys::Object::new();
        let set_num = |o: &js_sys::Object, k: &str, v: f64| {
            let _ = js_sys::Reflect::set(o, &k.into(), &JsValue::from_f64(v));
        };
        match &inner.fetch {
            Some(s) => {
                set_num(&obj, "fetches", s.fetch_count.get() as f64);
                set_num(&obj, "bytes", s.bytes_transferred.get() as f64);
                let _ = js_sys::Reflect::set(
                    &obj,
                    &"error".into(),
                    &match s.last_error.borrow().clone() {
                        Some(e) => JsValue::from_str(&e),
                        None => JsValue::NULL,
                    },
                );
                let m = s.store.borrow().metrics();
                let budget = s.store.borrow().budget_bytes();
                let cache = js_sys::Object::new();
                set_num(&cache, "hits", m.hits as f64);
                set_num(&cache, "misses", m.misses as f64);
                set_num(&cache, "evictions", m.evictions as f64);
                set_num(&cache, "residentBytes", m.bytes_resident as f64);
                set_num(&cache, "budgetBytes", budget as f64);
                let _ = js_sys::Reflect::set(&obj, &"cache".into(), &cache.into());
                // E3-T03 prefetch accuracy: prefetched chunks later HIT by a guest read / prefetched.
                let prefetch = js_sys::Object::new();
                set_num(&prefetch, "issued", m.prefetch_issued as f64);
                set_num(&prefetch, "used", m.prefetch_used as f64);
                set_num(&prefetch, "profileEntries", s.boot_profile.len() as f64);
                let acc = m
                    .prefetch_used
                    .saturating_mul(100)
                    .checked_div(m.prefetch_issued)
                    .unwrap_or(0);
                set_num(&prefetch, "accuracyPct", acc as f64);
                let _ = js_sys::Reflect::set(&obj, &"prefetch".into(), &prefetch.into());
            }
            None => {
                set_num(&obj, "fetches", 0.0);
                set_num(&obj, "bytes", 0.0);
                let _ = js_sys::Reflect::set(&obj, &"error".into(), &JsValue::NULL);
                let _ = js_sys::Reflect::set(&obj, &"cache".into(), &JsValue::NULL);
                let _ = js_sys::Reflect::set(&obj, &"prefetch".into(), &JsValue::NULL);
            }
        }
        Ok(obj.into())
    }

    /// E3-T03 dev-mode recorder: the ordered first-touch chunk-access list of this boot as a JSON
    /// array — write it to `boot-profile.json` next to the manifest to enable boot-profile prefetch.
    /// Empty `[]` for a non-chunked boot.
    #[wasm_bindgen(js_name = bootProfile)]
    pub fn boot_profile(&self) -> Result<String, JsError> {
        let inner = self.inner.try_borrow().map_err(|_| reentrant())?;
        Ok(match &inner.fetch {
            Some(s) => s.boot_profile_json(),
            None => "[]".to_string(),
        })
    }
}
