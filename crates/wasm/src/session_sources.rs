//! Browser proof board and Linux recorder wiring for the real core source adapters.
//! This tiny board has RTC/RNG/UART/CLINT only; complete Linux replay remains T14's gate.
use crate::{JsWallClock, WasmLinux, crypto_entropy::CryptoEntropy, event_clock, reentrant};
use std::{
    cell::{Cell, RefCell},
    rc::Rc,
};
use wasm_bindgen::prelude::*;
use wasm_vm_core::{
    Machine, RunOutcome,
    bus::mmap::DRAM_BASE as BASE,
    dev::{
        rtc::{ClockSample, ClockUnavailable, WallClock},
        uart16550::Uart16550,
        virtio::rng::{EntropySource, EntropyUnavailable},
    },
    session_clock::{
        MAX_EVENTS, MAX_OWNED_BYTES, SessionDelivery, SessionEffect, SessionError, SessionPhase,
        sources::{ObservationKind, ObservationRecord, ObservationTape, SourcePolicy},
    },
    trace::{TraceRecord, TraceSink, fmt_canonical},
};
const PROGRAM: &[u8] = include_bytes!("../../../web/assets/e9-time-entropy.bin");
fn set(object: &JsValue, key: &str, value: impl Into<JsValue>) {
    let _ = js_sys::Reflect::set(object, &key.into(), &value.into());
}
pub(crate) fn diagnostic(error: SessionError) -> js_sys::Object {
    let object = js_sys::Object::new();
    let code = match error {
        SessionError::SourceDivergence(d) => format!("{:?}", d.reason),
        SessionError::ClockPolicyMismatch => "ClockPolicyMismatch".into(),
        SessionError::MalformedObservation | SessionError::MalformedSnapshot => {
            "MalformedObservation".into()
        }
        other => format!("{other:?}"),
    };
    set(&object, "name", "SessionDivergence");
    set(&object, "code", code);
    set(&object, "message", format!("session_sources: {error:?}"));
    if let SessionError::SourceDivergence(d) = error {
        set(
            &object,
            "position",
            event_clock::position_object(d.position),
        );
        set(&object, "expected", d.expected.to_string());
        set(&object, "observed", d.observed.to_string());
    }
    object
}
pub(crate) fn error(error: SessionError) -> JsError {
    let details = diagnostic(error);
    let result = JsError::new(&format!("session_sources: {error:?}"));
    let value: JsValue = result.clone().into();
    for key in js_sys::Object::keys(&details) {
        if let Ok(v) = js_sys::Reflect::get(&details, &key) {
            let _ = js_sys::Reflect::set(&value, &key, &v);
        }
    }
    result
}

fn exact(value: JsValue, max: u32) -> Result<u32, JsError> {
    value
        .as_f64()
        .filter(|n| n.is_finite() && n.fract() == 0.0 && *n >= 0.0 && *n <= f64::from(max))
        .map(|n| n as u32)
        .ok_or_else(|| error(SessionError::MalformedObservation))
}
fn policy_object(policy: SourcePolicy) -> js_sys::Object {
    let out = js_sys::Object::new();
    set(&out, "version", policy.version);
    set(&out, "divider", policy.divider);
    set(&out, "timebase_hz", policy.timebase_hz.to_string());
    set(&out, "rtc", "external-nanoseconds-v1");
    set(&out, "entropy", "exact-fill-bytes-v1");
    out
}
pub(crate) fn receipt_object(delivery: SessionDelivery) -> Result<js_sys::Object, JsError> {
    let object = event_clock::position_object(delivery.position);
    let (channel, bytes, outcome) = match delivery.effect {
        SessionEffect::HostInput { channel, bytes } => (
            channel,
            bytes,
            delivery
                .host_result
                .ok_or_else(|| error(SessionError::MalformedObservation))?,
        ),
        SessionEffect::Observation(value) => (
            match value.kind {
                ObservationKind::Entropy => 18,
                ObservationKind::GpuControl => 23,
                _ => 17,
            },
            value.bytes,
            [
                u64::from(value.status),
                value.kind as u64,
                u64::from(value.requested),
                0,
            ],
        ),
        _ => return Err(error(SessionError::ObservationOrder)),
    };
    set(&object, "channel", channel);
    set(&object, "bytes", js_sys::Uint8Array::from(bytes.as_slice()));
    let result = js_sys::Array::new();
    for n in outcome {
        result.push(&n.to_string().into());
    }
    set(&object, "outcome", result);
    Ok(object)
}
#[wasm_bindgen]
impl WasmLinux {
    #[wasm_bindgen(js_name=startInputSourceCapture)]
    pub fn start_input_source_capture(&self) -> Result<(), JsError> {
        self.inner
            .try_borrow_mut()
            .map_err(|_| reentrant())?
            .begin_input_capture(false, true)
    }
    #[wasm_bindgen(js_name=sessionSourcePolicy)]
    pub fn session_source_policy(&self) -> Result<JsValue, JsError> {
        let inner = self.inner.try_borrow().map_err(|_| reentrant())?;
        Ok(policy_object(inner.machine.source_policy()).into())
    }
}

struct CountedClock {
    reads: Rc<Cell<u32>>,
    refuse: bool,
}
impl WallClock for CountedClock {
    fn now_ns(&self) -> u64 {
        self.sample_ns(ClockSample::Read).unwrap_or(0)
    }
    fn sample_ns(&self, intent: ClockSample) -> Result<u64, ClockUnavailable> {
        self.reads.set(self.reads.get() + 1);
        if self.refuse {
            Err(ClockUnavailable)
        } else {
            JsWallClock.sample_ns(intent)
        }
    }
}
struct CountedEntropy {
    reads: Rc<Cell<u32>>,
    refuse: bool,
}
impl EntropySource for CountedEntropy {
    fn fill(&mut self, out: &mut [u8]) {
        self.try_fill(out).expect("probe host entropy unavailable")
    }
    fn validate_len(&self, _: usize) -> Result<(), EntropyUnavailable> {
        if self.refuse {
            Err(EntropyUnavailable)
        } else {
            Ok(())
        }
    }
    fn try_fill(&mut self, out: &mut [u8]) -> Result<(), EntropyUnavailable> {
        self.reads.set(self.reads.get() + 1);
        if self.refuse {
            Err(EntropyUnavailable)
        } else {
            CryptoEntropy.try_fill(out)
        }
    }
}
#[derive(Default)]
struct Lines(String);
impl TraceSink for Lines {
    fn retire(&mut self, r: &TraceRecord) {
        use std::fmt::Write;
        writeln!(self.0, "{}", fmt_canonical(r)).unwrap();
    }
}
/// Bounded, fixed real RV64 workload used by the public time/entropy check. This proof board
/// cannot load a Linux session, acquire network/media adapters, or execute past its declared end.
#[wasm_bindgen]
pub struct SessionSourceProbe {
    machine: RefCell<Machine>,
    uart: Rc<RefCell<Uart16550>>,
    policy: SourcePolicy,
    replay: bool,
    paused: Cell<bool>,
    stopped: Cell<bool>,
    rtc_reads: Rc<Cell<u32>>,
    entropy_reads: Rc<Cell<u32>>,
    receipts: RefCell<Vec<SessionDelivery>>,
    observations: RefCell<Vec<ObservationRecord>>,
    trace: RefCell<Lines>,
}
impl SessionSourceProbe {
    fn collect(&self, machine: &mut Machine) -> Result<(), JsError> {
        let rows = machine.take_session_deliveries().map_err(error)?;
        let mut history = self.receipts.borrow_mut();
        if history.len() + rows.len() > MAX_EVENTS {
            return Err(error(SessionError::QueueFull));
        }
        for r in &rows {
            if let SessionEffect::Observation(value) = &r.effect {
                let mut log = self.observations.borrow_mut();
                if log.len() == MAX_EVENTS {
                    return Err(error(SessionError::QueueFull));
                }
                log.push(ObservationRecord {
                    position: r.position,
                    value: value.clone(),
                });
            }
        }
        history.extend(rows);
        Ok(())
    }
    fn apply_control(&self, code: u32) -> Result<(), JsError> {
        if self.stopped.get() || self.receipts.borrow().len() == MAX_EVENTS {
            return Err(error(SessionError::QueueFull));
        }
        let mut machine = self.machine.try_borrow_mut().map_err(|_| reentrant())?;
        let position = machine
            .session_position()
            .ok_or_else(|| error(SessionError::Inactive))?;
        machine
            .stage_session_effect(
                position.transition,
                SessionEffect::HostInput {
                    channel: 16,
                    bytes: vec![code as u8],
                },
            )
            .map_err(error)?;
        machine
            .deliver_session_host_boundary(|_, _, _| [0, 0, 0, 0])
            .map_err(error)?;
        self.collect(&mut machine)?;
        self.paused.set(code != 1);
        self.stopped.set(code == 2);
        Ok(())
    }
}
#[wasm_bindgen]
impl SessionSourceProbe {
    #[wasm_bindgen(constructor)]
    pub fn new(
        divider: JsValue,
        tape: Option<js_sys::Uint8Array>,
        host_mode: JsValue,
    ) -> Result<SessionSourceProbe, JsError> {
        let host_mode = exact(host_mode, 3)?;
        let divider = exact(divider, 1024)?;
        if divider == 0 {
            return Err(error(SessionError::ClockPolicyMismatch));
        }
        let replay = tape.is_some();
        let tape = tape
            .map(|b| {
                if b.length() as usize > MAX_OWNED_BYTES + MAX_EVENTS * 48 + 32 {
                    return Err(error(SessionError::PayloadTooLarge));
                }
                ObservationTape::decode(&b.to_vec()).map_err(error)
            })
            .transpose()?;
        let mut machine = Machine::new(16 << 20);
        machine.enable_clint(u64::from(divider));
        machine.enable_plic();
        let rtc_reads = Rc::new(Cell::new(0));
        let entropy_reads = Rc::new(Cell::new(0));
        machine.enable_rtc(Box::new(CountedClock {
            reads: rtc_reads.clone(),
            refuse: host_mode & 1 != 0,
        }));
        let uart = machine.enable_uart16550();
        machine.enable_virtio_slots(None);
        machine.enable_virtio_rng(Box::new(CountedEntropy {
            reads: entropy_reads.clone(),
            refuse: host_mode & 2 != 0,
        }));
        machine
            .bus_mut()
            .write_ram_slice(BASE, PROGRAM)
            .map_err(|_| error(SessionError::InvalidAddress))?;
        machine.hart_mut().regs.pc = BASE;
        machine.start_session_clock(1).map_err(error)?;
        let policy = machine.source_policy();
        machine.start_session_sources(policy, tape).map_err(error)?;
        Ok(Self {
            machine: RefCell::new(machine),
            uart,
            policy,
            replay,
            paused: Cell::new(true),
            stopped: Cell::new(false),
            rtc_reads,
            entropy_reads,
            receipts: RefCell::new(Vec::new()),
            observations: RefCell::new(Vec::new()),
            trace: RefCell::new(Lines::default()),
        })
    }
    #[wasm_bindgen(js_name=policy)]
    pub fn get_policy(&self) -> JsValue {
        policy_object(self.policy).into()
    }
    #[wasm_bindgen(js_name=position)]
    pub fn position(&self) -> Result<JsValue, JsError> {
        let machine = self.machine.try_borrow().map_err(|_| reentrant())?;
        let object = event_clock::position_object(machine.session_position().unwrap());
        set(&object, "mtime", machine.clint_mtime().to_string());
        set(&object, "paused", self.paused.get());
        set(&object, "stopped", self.stopped.get());
        set(&object, "replay", self.replay);
        Ok(object.into())
    }
    #[wasm_bindgen(js_name=hostReads)]
    pub fn host_reads(&self) -> JsValue {
        let object = js_sys::Object::new();
        set(&object, "rtc", self.rtc_reads.get());
        set(&object, "entropy", self.entropy_reads.get());
        object.into()
    }
    #[wasm_bindgen(js_name=control)]
    pub fn control(&self, code: JsValue) -> Result<(), JsError> {
        if self.replay {
            return Err(JsError::new(
                "live lifecycle input is forbidden during source replay",
            ));
        }
        self.apply_control(exact(code, 2)?)
    }
    #[wasm_bindgen(js_name=applyRecordedLifecycle)]
    pub fn replay_control(
        &self,
        code: JsValue,
        transition: &str,
        sequence: &str,
        ordinal: JsValue,
        retired: &str,
    ) -> Result<(), JsError> {
        if !self.replay {
            return Err(error(SessionError::Inactive));
        }
        let code = exact(code, 2)?;
        let ordinal = exact(ordinal, u32::MAX)?;
        let transition = event_clock::exact_u64(transition).map_err(JsError::new)?;
        let sequence = event_clock::exact_u64(sequence).map_err(JsError::new)?;
        let retired = event_clock::exact_u64(retired).map_err(JsError::new)?;
        {
            let machine = self.machine.try_borrow().map_err(|_| reentrant())?;
            let p = machine.session_position().unwrap();
            if p.phase != SessionPhase::Before
                || p.transition != transition
                || p.retired != retired
                || p.sequence.checked_add(1) != Some(sequence)
                || p.ordinal.checked_add(1) != Some(ordinal)
            {
                return Err(error(SessionError::ObservationOrder));
            }
        }
        self.apply_control(code)
    }
    #[wasm_bindgen(js_name=runUntil)]
    pub fn run_until(&self, target: &str, quantum: JsValue) -> Result<JsValue, JsError> {
        let target = event_clock::exact_u64(target).map_err(JsError::new)?;
        let quantum = exact(quantum, 64)?;
        if quantum == 0
            || target > PROGRAM.len() as u64 / 4
            || self.paused.get()
            || self.stopped.get()
        {
            return Err(error(SessionError::ObservationOrder));
        }
        if self.receipts.borrow().len() + 128 > MAX_EVENTS {
            return Err(error(SessionError::QueueFull));
        }
        let mut machine = self.machine.try_borrow_mut().map_err(|_| reentrant())?;
        let result = machine.run_session_until_traced(
            target,
            u64::from(quantum),
            &mut *self.trace.borrow_mut(),
        );
        self.collect(&mut machine)?;
        match result {
            Ok(RunOutcome::MaxInstrs) => {}
            Ok(_) => {
                self.stopped.set(true);
                return Err(error(SessionError::ObservationOrder));
            }
            Err(e) => {
                self.stopped.set(true);
                return Err(error(e));
            }
        }
        let object = event_clock::position_object(machine.session_position().unwrap());
        set(&object, "mtime", machine.clint_mtime().to_string());
        Ok(object.into())
    }
    #[wasm_bindgen(js_name=takeDeliveries)]
    pub fn take_deliveries(&self) -> Result<JsValue, JsError> {
        let out = js_sys::Array::new();
        for r in self.receipts.borrow_mut().drain(..) {
            out.push(&receipt_object(r)?.into());
        }
        Ok(out.into())
    }
    #[wasm_bindgen(js_name=observationTape)]
    pub fn tape(&self) -> Result<js_sys::Uint8Array, JsError> {
        let tape = ObservationTape {
            policy: self.policy,
            records: self.observations.borrow().clone(),
        };
        Ok(js_sys::Uint8Array::from(
            tape.encode().map_err(error)?.as_slice(),
        ))
    }
    #[wasm_bindgen(js_name=frame)]
    pub fn frame(&self) -> Result<js_sys::Uint8Array, JsError> {
        let bytes = self
            .machine
            .try_borrow_mut()
            .map_err(|_| reentrant())?
            .save_session_resume()
            .map_err(|e| JsError::new(&format!("source frame: {e:?}")))?;
        Ok(js_sys::Uint8Array::from(bytes.as_slice()))
    }
    #[wasm_bindgen(js_name=guestBytes)]
    pub fn guest_bytes(&self) -> js_sys::Uint8Array {
        js_sys::Uint8Array::from(self.uart.borrow_mut().take_output().as_slice())
    }
    #[wasm_bindgen(js_name=traceText)]
    pub fn trace_text(&self) -> String {
        self.trace.borrow().0.clone()
    }
    #[wasm_bindgen(js_name=finishReplay)]
    pub fn finish(&self) -> Result<(), JsError> {
        self.machine
            .try_borrow_mut()
            .map_err(|_| reentrant())?
            .finish_session_source_replay()
            .map_err(error)
    }
}
