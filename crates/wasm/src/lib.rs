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
    /// wired to a (initially unset) JS callback.
    #[wasm_bindgen(constructor)]
    pub fn new(ram_mib: u32) -> WasmMachine {
        init_diagnostics();
        let mut machine = Machine::new(ram_mib as usize * 1024 * 1024);
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
        WasmMachine {
            inner: RefCell::new(Inner {
                machine,
                console,
                loaded: false,
                exited: false,
                trace_on: false,
                trace: String::new(),
            }),
        }
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
        }
        Ok(obj.into())
    }
}
