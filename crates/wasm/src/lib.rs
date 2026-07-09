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

// E3-T02 lazy-fetch backend. Compiled where it is actually used: the normal wasm build (behind
// `newChunkedDisk`) and native unit tests. Excluded from the zicsr-stub wasm build and the native
// lib build so it is never dead code under `-D warnings`.
#[cfg(any(all(target_arch = "wasm32", not(feature = "zicsr-stub")), test))]
mod chunked;
// The web-sys `fetch` glue is browser-only.
#[cfg(all(target_arch = "wasm32", not(feature = "zicsr-stub")))]
mod http_fetch;

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
            // Busybox initramfs: the 8 empty virtio slots the DTB advertises.
            DiskChoice::None => {
                let _ = machine.enable_virtio_slots(None);
            }
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
