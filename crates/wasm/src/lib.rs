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
use wasm_vm_core::bus::mmap::{UART0_BASE, UART0_LEN};
use wasm_vm_core::dev::console::{ConsoleSink, Uart0Stub};
use wasm_vm_core::trace::{TraceRecord, TraceSink, fmt_canonical};
use wasm_vm_core::{Machine, RunOutcome};

// E3-net: browser-only (the boot site that consumes these is wasm+non-zicsr-gated), so gate the whole
// toggle to the same cfg — otherwise the const/fn are dead code on the native `-D warnings` clippy job.
#[cfg(all(target_arch = "wasm32", not(feature = "zicsr-stub")))]
mod slirp_net {
    use core::cell::RefCell;
    use core::sync::atomic::{AtomicBool, Ordering};
    use wasm_bindgen::prelude::*;

    /// Gateway MAC for the browser slirp local stack (distinct from the guest's virtio-net MAC
    /// 52:54:00:12:34:56). The guest learns it via ARP for the gateway 10.0.2.2.
    pub(crate) const SLIRP_GATEWAY_MAC: [u8; 6] = [0x52, 0x54, 0x00, 0x12, 0x34, 0x02];

    /// When set, boots wire virtio-net to the slirp LOCAL stack (DHCP/ARP/ICMP) instead of loopback.
    /// Single-threaded browser → a plain atomic suffices. Set via `setSlirpNet` BEFORE booting.
    static SLIRP_NET: AtomicBool = AtomicBool::new(false);
    std::thread_local! {
        static SLIRP_RELAY_URL: RefCell<Option<String>> = const { RefCell::new(None) };
    }

    pub(crate) fn slirp_net_enabled() -> bool {
        SLIRP_NET.load(Ordering::Relaxed)
    }

    pub(crate) fn slirp_relay_url() -> Option<String> {
        SLIRP_RELAY_URL.with(|url| url.borrow().clone())
    }

    /// Choose the slirp local network stack (vs the default loopback) for subsequent boots.
    #[wasm_bindgen(js_name = setSlirpNet)]
    pub fn set_slirp_net(on: bool) {
        SLIRP_NET.store(on, Ordering::Relaxed);
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
}
#[cfg(all(target_arch = "wasm32", not(feature = "zicsr-stub")))]
use slirp_net::{SLIRP_GATEWAY_MAC, slirp_net_enabled, slirp_relay_url};

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
// The web-sys IndexedDB durable-overlay store is browser-only.
#[cfg(all(target_arch = "wasm32", not(feature = "zicsr-stub")))]
mod idb_store;
// E3-net: JS WebSocket callbacks ↔ synchronous ws-proxy connector queues.
#[cfg(all(target_arch = "wasm32", not(feature = "zicsr-stub")))]
mod ws_transport;
#[cfg(any(all(target_arch = "wasm32", not(feature = "zicsr-stub")), test))]
mod ws_transport_state;

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

/// The core crate version, exposed to JS.
#[wasm_bindgen]
pub fn version() -> String {
    wasm_vm_core::version().into()
}

/// E3-T10: the IndexedDB database name that holds a given image's durable overlay — so the
/// "reset disk" flow can `indexedDB.deleteDatabase(name)` for THIS image only (a second image's
/// overlay, in a different DB, survives). Same derivation the durable store uses
/// (`overlay_store_name(base_hash)`), so it always matches.
#[cfg(all(target_arch = "wasm32", not(feature = "zicsr-stub")))]
#[wasm_bindgen(js_name = overlayDbName)]
pub fn overlay_db_name(manifest_json: &str) -> Result<String, JsError> {
    let manifest = wasm_vm_storage::ImageManifest::from_json(manifest_json)
        .map_err(|e| JsError::new(&format!("bad image manifest: {e:?}")))?;
    Ok(wasm_vm_storage::overlay_store_name(&manifest.base_hash()))
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

/// A trace sink that counts retirements and, when tracing is on, appends canonical lines.
struct RunSink<'a> {
    retired: u64,
    trace: Option<&'a mut String>,
}

impl TraceSink for RunSink<'_> {
    fn retire(&mut self, r: &TraceRecord) {
        self.retired += 1;
        if let Some(buf) = self.trace.as_mut() {
            let _ = writeln!(buf, "{}", fmt_canonical(r));
        }
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

    /// Run the engine for `budget` instructions with the counting/tracing sink, splitting
    /// the `Inner` borrow so the trace buffer and the machine are borrowed disjointly.
    fn drive(inner: &mut Inner, budget: u64) -> (RunOutcome, u64) {
        let Inner {
            machine,
            trace,
            trace_on,
            ..
        } = inner;
        let mut sink = RunSink {
            retired: 0,
            trace: if *trace_on { Some(trace) } else { None },
        };
        let outcome = machine.run_traced(budget, &mut sink);
        (outcome, sink.retired)
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
    /// IndexedDB store (`Clone`) + the shared persist queue the overlay records writes into.
    persist: Option<(idb_store::IdbStore, wasm_vm_storage::SharedPersistQueue)>,
    /// E3-T10: the chunked backend's shared read-only flag, so `setDiskReadOnly` can flip the
    /// disk live (the "continue read-only" choice after a storage-quota hit). `None` off the
    /// persistent path.
    disk_ro: Option<std::rc::Rc<std::cell::Cell<bool>>>,
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
    ) -> Result<WasmLinux, JsError> {
        let manifest = wasm_vm_storage::ImageManifest::from_json(&manifest_json)
            .map_err(|e| JsError::new(&format!("bad image manifest: {e:?}")))?;
        let base_binding = manifest.base_hash();

        // Open the durable store and reconcile its meta record with this base.
        let idb = idb_store::IdbStore::open(&base_binding)
            .await
            .map_err(|e| JsError::new(&format!("IndexedDB open: {e:?}")))?;
        match idb
            .read_meta()
            .await
            .map_err(|e| JsError::new(&format!("IndexedDB read meta: {e:?}")))?
        {
            Some(bytes) => {
                let meta = wasm_vm_storage::OverlayMeta::from_bytes(&bytes)
                    .map_err(|e| JsError::new(&format!("overlay meta: {e:?}")))?;
                meta.check(&manifest)
                    .map_err(|e| JsError::new(&format!("overlay/base mismatch: {e:?}")))?;
            }
            None => {
                // E3-T09: an RO tab must not write ANYTHING — not even the meta record of a
                // brand-new DB (that's the writer's job; an empty DB simply reads as no blocks).
                if !read_only {
                    idb.write_meta(&wasm_vm_storage::OverlayMeta::new(&manifest).to_bytes())
                        .await
                        .map_err(|e| JsError::new(&format!("IndexedDB write meta: {e:?}")))?;
                }
            }
        }
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
                read_only,
            } => {
                let store =
                    std::rc::Rc::new(RefCell::new(wasm_vm_storage::BlockCache::new(budget)));
                let overlay = wasm_vm_storage::WriteBackOverlay::with_shared_queue(
                    &manifest,
                    queue.clone(),
                    loaded,
                );
                let disk = wasm_vm_storage::OverlayDisk::attach(overlay, &manifest)
                    .map_err(|e| JsError::new(&format!("overlay attach: {e:?}")))?;
                let mut backend = chunked::ChunkedBackend::from_disk(disk, store.clone());
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
                    persist = Some((idb, queue));
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
            if let Some(url) = slirp_relay_url() {
                let transport = ws_transport::BrowserWebSocketTransport::connect(&url)?;
                let connector = wasm_vm_slirp::WsConnector::new(transport, Vec::new());
                let _ = machine.enable_virtio_net(Box::new(
                    wasm_vm_slirp::SlirpLocalBackend::with_connector(
                        SLIRP_GATEWAY_MAC,
                        clock,
                        Box::new(connector),
                    ),
                ));
            } else {
                let _ = machine.enable_virtio_net(Box::new(wasm_vm_slirp::SlirpLocalBackend::new(
                    SLIRP_GATEWAY_MAC,
                    clock,
                )));
            }
        } else {
            let _ = machine.enable_virtio_net(Box::new(
                wasm_vm_core::dev::virtio::net::LoopbackBackend::new(),
            ));
        }
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
            }),
        })
    }

    /// Run up to `max_instrs`, drain console output to the JS callback, feed queued input to the
    /// 16550 RX, and return `{ done: bool, state: string|null }`. `state` is `"poweroff"`,
    /// `"reboot"`, `"fail:<code>"`, `"exited:<code>"`, or `"trap:<cause>"` once terminal.
    #[wasm_bindgen(js_name = runChunk)]
    pub fn run_chunk(&self, max_instrs: u32) -> Result<JsValue, JsError> {
        let mut inner = self.inner.try_borrow_mut().map_err(|_| reentrant())?;
        if inner.finished.is_none() {
            let mut sink = wasm_vm_core::trace::NullSink;
            // Interleave RX refills with execution. The 16550 RX FIFO is 16 bytes; feeding it only
            // once per budget caps host→guest throughput at ~16 bytes per chunk and wastes the rest
            // of the budget on a near-empty FIFO. Instead, when input is queued, run in short slices
            // and top up the FIFO between them so the guest drains it many times within one budget
            // (bulk paste / held-key autorepeat throughput ~ slices × FIFO depth). When nothing is
            // queued this collapses to a single full-budget run — the quiet path pays nothing.
            const INPUT_SLICE: u64 = 16_384;
            let mut remaining = max_instrs as u64;
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
                let step = if inner.pending.is_empty() {
                    remaining
                } else {
                    INPUT_SLICE.min(remaining)
                };
                let oc = inner.machine.run_traced(step, &mut sink);
                remaining -= step;
                if remaining == 0 || !matches!(oc, RunOutcome::MaxInstrs) {
                    break oc;
                }
            };
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
        Ok(obj.into())
    }

    /// Final/current architectural-state SHA-256 for browser evidence. This covers registers, CSRs,
    /// devices, and RAM through the same snapshot contract as native `--dump-state` / boot evidence.
    #[wasm_bindgen(js_name = stateDigest)]
    pub fn state_digest(&self) -> Result<String, JsError> {
        let inner = self.inner.try_borrow().map_err(|_| reentrant())?;
        Ok(inner.machine.snapshot().hex_digest())
    }

    /// Queue host keystrokes for the guest's `ttyS0` (fed to the RX FIFO across `runChunk`s).
    #[wasm_bindgen(js_name = sendInput)]
    pub fn send_input(&self, bytes: &[u8]) -> Result<(), JsError> {
        let mut inner = self.inner.try_borrow_mut().map_err(|_| reentrant())?;
        inner.pending.extend(bytes.iter().copied());
        Ok(())
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
        let (idb, queue) = {
            let inner = self.inner.try_borrow().map_err(|_| reentrant())?;
            match &inner.persist {
                Some((idb, q)) => (idb.clone(), q.clone()),
                None => return Ok(0),
            }
        };
        let batch = queue.borrow().pending_flush(); // (block, generation, bytes)
        if batch.is_empty() {
            return Ok(0);
        }
        let blocks: Vec<(u64, [u8; wasm_vm_storage::OVERLAY_BLOCK])> =
            batch.iter().map(|(b, _, bytes)| (*b, *bytes)).collect();
        if let Err(e) = idb.persist(&blocks).await {
            // E3-T10: classify the failure. On QuotaExceeded we DELIBERATELY do NOT
            // mark_persisted — the dirty blocks stay pending, so no write is lost: freeing space
            // and retrying, or flipping the disk read-only, keeps the filesystem consistent. The
            // error is tagged so the loader can pause + show the quota dialog (vs a generic fail).
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
        Ok(batch.len() as u32)
    }

    /// E3-T08: persistence pressure — `{ pendingBlocks, pendingBytes, flushWaiting }`. The JS pump
    /// reads this each tick: `flushWaiting` (a guest FLUSH is parked awaiting the durable commit)
    /// means persist IMMEDIATELY — the guest's `sync` is blocked on it; `pendingBytes` over the
    /// driver's dirty-bytes threshold means apply backpressure (persist before the next run slice)
    /// so an unflushed session cannot accumulate unbounded dirty state. Zeros for non-persistent
    /// boots.
    /// E3-T10 (critic BUG-4): close the IndexedDB connection so a `deleteDatabase` (reset-disk)
    /// can proceed instead of blocking on our open handle. Call before wiping; the machine must
    /// not persist afterward. No-op off the persistent path.
    #[wasm_bindgen(js_name = closeStorage)]
    pub fn close_storage(&self) -> Result<(), JsError> {
        let inner = self.inner.try_borrow().map_err(|_| reentrant())?;
        if let Some((idb, _)) = &inner.persist {
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

    /// E3-T10: whether the overlay has unpersisted (dirty) blocks — after a quota hit the caller
    /// checks this to decide whether flipping read-only is enough (pending writes will retry once
    /// space is freed) vs. data that can never become durable.
    #[wasm_bindgen(js_name = hasUnpersisted)]
    pub fn has_unpersisted(&self) -> Result<bool, JsError> {
        let inner = self.inner.try_borrow().map_err(|_| reentrant())?;
        Ok(inner
            .persist
            .as_ref()
            .is_some_and(|(_, q)| !q.borrow().is_empty()))
    }

    #[wasm_bindgen(js_name = persistStats)]
    pub fn persist_stats(&self) -> Result<JsValue, JsError> {
        let inner = self.inner.try_borrow().map_err(|_| reentrant())?;
        let obj = js_sys::Object::new();
        let (blocks, waiting) = match &inner.persist {
            Some((_, q)) => {
                let n = q.borrow().unpersisted_count();
                let w = inner.machine.blk_flush_waiting();
                (n, w)
            }
            None => (0, false),
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
        let _ = js_sys::Reflect::set(&obj, &"flushWaiting".into(), &JsValue::from_bool(waiting));
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
