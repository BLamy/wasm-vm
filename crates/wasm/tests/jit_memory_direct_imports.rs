#![cfg(target_arch = "wasm32")]
//! E5.5-T03bg: actual import identity/types, inactive-context guards and literal
//! memory/atomic outcomes. Every matrix entry uses a fresh executor, so InlineTLB
//! accesses start cold and exercise the raw imported helper before any inline hit.

use sha2::{Digest, Sha256};
use wasm_bindgen::prelude::*;
use wasm_bindgen_test::*;
use wasm_vm_core::Machine;
use wasm_vm_core::bus::{Bus, mmap::DRAM_BASE};
use wasm_vm_core::decode::decode;
use wasm_vm_core::dispatch::{DecodedBlock, MicroOp};
use wasm_vm_core::hart::{Exception, Trap};
use wasm_vm_core::jit::{CompiledBlockExecutor, ExitCode};
use wasm_vm_core::resume::ComponentSnapshot;
use wasm_vm_wasm::BrowserExecutor;

#[wasm_bindgen(inline_js = r#"
let capture = null;
const names = ['load','store','amo','lr','sc'];
const i32 = 0x7f, i64 = 0x7e;
const params = [[i64,i32],[i64,i64,i32],[i64,i64,i32,i32],[i64,i32],[i64,i64,i32]];
const results = [i64,null,i64,i64,i64];
function check(ok, message) { if (!ok) throw new Error(message); }
function signatureModule(p, result) {
  const type = [1,0x60,p.length,...p,...(result === null ? [0] : [1,result])];
  const imp = [1,1,0x65,1,0x66,0,0], exp = [1,1,0x66,0,0];
  return new WebAssembly.Module(new Uint8Array([
    0,97,115,109,1,0,0,0,1,type.length,...type,2,imp.length,...imp,7,exp.length,...exp
  ]));
}
export function memoryInactive(exports) {
  const args = [[0xfffffffffffffff8n,3], [0xfffffffffffffff8n,0x8877665580008180n,8],
    [0xfffffffffffffff8n,0x8877665580008180n,1,8], [0xfffffffffffffff8n,8],
    [0xfffffffffffffff8n,0x8877665580008180n,8]];
  for (let i=0; i<names.length; i++) {
    let threw = false;
    try { exports['__jit_'+names[i]](...args[i]); }
    catch (error) { check(error === null, 'MEMORY_INACTIVE_SENTINEL '+names[i]); threw = true; }
    check(threw, 'MEMORY_INACTIVE_DID_NOT_THROW '+names[i]);
  }
  return names.length;
}
export function memoryStartCapture() {
  check(capture === null, 'capture already active');
  const Native = WebAssembly.Instance, rows = [];
  const proxy = new Proxy(Native, {construct(target,args) {
    const [module,imports] = args;
    const descriptors = WebAssembly.Module.imports(module);
    if (descriptors.some(x => x.module === 'env' && names.includes(x.name))) {
      rows.push({descriptors,env:imports.env});
    }
    return Reflect.construct(target,args,target);
  }});
  capture = {Native,rows,proxy};
  WebAssembly.Instance = proxy;
}
export function memoryStopCapture() {
  if (capture !== null) { WebAssembly.Instance = capture.Native; capture = null; }
}
function identity(env,exports,shared) {
  for (const name of names) check(env[name] === exports['__jit_'+name], 'MEMORY_RAW_IDENTITY '+name);
  if (shared) {
    check(env.softmmu_load === exports.__jit_load, 'MEMORY_RAW_IDENTITY softmmu_load');
    check(env.softmmu_store === exports.__jit_store, 'MEMORY_RAW_IDENTITY softmmu_store');
  }
}
export function memoryInspectCapture(exports,shared) {
  check(capture !== null && WebAssembly.Instance === capture.proxy, 'capture missing');
  const {Native,rows} = capture;
  check(rows.length === 1, 'MEMORY_INSTANCE_COUNT '+rows.length);
  const {descriptors,env} = rows[0];
  const importedNames = shared ? ['softmmu_load','softmmu_store','amo','lr','sc'] : names;
  const used = descriptors.filter(x => x.module === 'env' && importedNames.includes(x.name));
  check(used.length === 5 && used.every(x => x.kind === 'function'), 'MEMORY_ALL_FIVE_IMPORTS');
  check(descriptors.some(x => x.module === 'env' && x.name === 'mem' && x.kind === 'memory') === shared,
    'MEMORY_MODEL');
  identity(env,exports,shared);
  let rejectedTypes = 0;
  for (let i=0; i<names.length; i++) {
    const fn = env[names[i]], p = params[i], result = results[i];
    check(fn.length === p.length, 'MEMORY_ARITY '+names[i]);
    check(new Native(signatureModule(p,result), {e:{f:fn}}).exports.f === fn, 'MEMORY_TYPED_REEXPORT');
    const mutations = p.map((_,at) => [p.map((v,j) => j===at ? (v===i32 ? i64 : i32) : v),result]);
    mutations.push([p,result === null ? i64 : i32]);
    for (const [badParams,badResult] of mutations) {
      let rejected = false;
      try { new Native(signatureModule(badParams,badResult), {e:{f:fn}}); }
      catch (error) { check(error instanceof WebAssembly.LinkError, 'MEMORY_UNEXPECTED_LINK_ERROR'); rejected = true; }
      check(rejected, 'MEMORY_RAW_SIGNATURE '+names[i]);
      rejectedTypes++;
    }
  }
  // Same assertion, isolated local substitution: an otherwise compatible JS
  // trampoline must fail identity, and (unlike a raw wasm import) links under a
  // wrong scalar signature. Nothing in the executor is modified by this check.
  const trampoline = (...args) => env.load(...args);
  let sabotageRejected = false;
  try { identity({...env,load:trampoline},exports,shared); }
  catch (error) { check(error.message === 'MEMORY_RAW_IDENTITY load', 'wrong sabotage failure'); sabotageRejected = true; }
  check(sabotageRejected, 'MEMORY_TRAMPOLINE_NOT_DETECTED');
  new Native(signatureModule([i32,i32],i64), {e:{f:trampoline}});
  identity(env,exports,shared);
  return JSON.stringify({shared,rows:rows.length,helpers:5,correctTypes:5,rejectedTypes,sabotageRejected});
}
"#)]
extern "C" {
    #[wasm_bindgen(catch, js_name = memoryInactive)]
    fn inactive(exports: &JsValue) -> Result<u32, JsValue>;
    #[wasm_bindgen(catch, js_name = memoryStartCapture)]
    fn start_capture() -> Result<(), JsValue>;
    #[wasm_bindgen(js_name = memoryStopCapture)]
    fn stop_capture();
    #[wasm_bindgen(catch, js_name = memoryInspectCapture)]
    fn inspect_capture(exports: &JsValue, shared: bool) -> Result<String, JsValue>;
}

struct Capture;
impl Capture {
    fn start() -> Self {
        start_capture().unwrap();
        Self
    }
}
impl Drop for Capture {
    fn drop(&mut self) {
        stop_capture();
    }
}

const DATA: u64 = DRAM_BASE + 0x4000;
const INITIAL: u64 = 0x8877_6655_8000_8180;
const NEXT: u64 = 0x1020_3040_5060_70aa;
const VALUE: u64 = 0xfedc_ba98_7654_3210;
const RD_SENTINEL: u64 = 0xa123_b456_c789_def0;

fn addi(rd: u32) -> u32 {
    (1 << 20) | (rd << 15) | (rd << 7) | 0x13
}
fn load(kind: u32) -> u32 {
    (1 << 15) | (kind << 12) | (3 << 7) | 0x03
}
fn store(width: u32) -> u32 {
    (2 << 20) | (1 << 15) | (width << 12) | 0x23
}
fn atomic(funct5: u32, width: u32) -> u32 {
    (funct5 << 27)
        | (if funct5 == 2 { 0 } else { 2 << 20 })
        | (1 << 15)
        | (width << 12)
        | (3 << 7)
        | 0x2f
}
fn block(at: u64, words: &[u32]) -> DecodedBlock {
    DecodedBlock::new(
        at,
        words
            .iter()
            .map(|&raw| MicroOp {
                instr: decode(raw).unwrap(),
                len: 4,
                raw,
            })
            .collect(),
        words.len() as u64 * 4,
    )
}
fn executor(machine: &Machine, shared: bool) -> BrowserExecutor {
    if shared {
        BrowserExecutor::new_inline(machine).unwrap()
    } else {
        BrowserExecutor::new()
    }
}
fn machine(address: u64, reservation: Option<(u64, u8)>) -> Machine {
    let mut m = Machine::new(64 * 1024);
    m.hart_mut().regs.pc = DRAM_BASE;
    m.hart_mut().regs.write(1, address);
    m.hart_mut().regs.write(2, VALUE);
    m.hart_mut().regs.write(3, RD_SENTINEL);
    m.hart_mut().regs.write(20, 40);
    m.hart_mut().regs.write(21, 80);
    m.hart_mut().resv = reservation;
    m.bus_mut().store64(DATA, INITIAL).unwrap();
    m.bus_mut().store64(DATA + 8, NEXT).unwrap();
    m
}
fn state_digest(m: &Machine) -> String {
    let mut hash = Sha256::new();
    hash.update(m.hart().to_snapshot());
    hash.update(m.snapshot().mem_digest);
    format!("{:x}", hash.finalize())
}

fn identity_and_guards(shared: bool) {
    let exports = wasm_bindgen::exports();
    assert_eq!(inactive(&exports).unwrap(), 5, "before a machine exists");
    let capture = Capture::start();
    let mut m = machine(DATA, None);
    let mut e = executor(&m, shared);
    let words = [load(3), store(3), atomic(0, 3), atomic(2, 3), atomic(3, 3)];
    e.install(&block(DRAM_BASE, &words));
    assert!(e.is_compiled(DRAM_BASE));
    let before = state_digest(&m);
    assert_eq!(
        inactive(&exports).unwrap(),
        5,
        "allocated but inactive machine"
    );
    assert_eq!(
        state_digest(&m),
        before,
        "inactive exports cannot mutate the guest"
    );
    let ptr: *mut Machine = &mut m;
    // SAFETY: synchronous call with the Machine's disjoint live components.
    let exit = unsafe {
        e.execute(DRAM_BASE, (*ptr).hart_mut(), (*ptr).bus_mut())
            .unwrap()
    };
    assert_eq!(exit.code, ExitCode::Fallthrough);
    assert_eq!(exit.next_pc, DRAM_BASE + 20);
    assert_eq!(exit.trap, None);
    assert_eq!(m.hart().regs.read(3), 0);
    assert_eq!(m.bus_mut().load64(DATA), Ok(VALUE));
    assert_eq!(m.hart().resv, None);
    let after = state_digest(&m);
    assert_eq!(
        inactive(&exports).unwrap(),
        5,
        "after a completed compiled call"
    );
    assert_eq!(state_digest(&m), after);
    drop(e);
    drop(m);
    assert_eq!(
        inactive(&exports).unwrap(),
        5,
        "after executor and machine drop"
    );
    let receipt = inspect_capture(&exports, shared);
    drop(capture);
    console_log!("MEMORY_IMPORT_ABI {} inactive_calls=20", receipt.unwrap());
}

#[wasm_bindgen_test]
fn private_import_identity_signatures_and_inactive_guards() {
    identity_and_guards(false);
}
#[wasm_bindgen_test]
fn shared_import_identity_signatures_and_inactive_guards() {
    identity_and_guards(true);
}

struct Case {
    name: String,
    word: u32,
    address: u64,
    before_reservation: Option<(u64, u8)>,
    rd: u64,
    memory: [u64; 2],
    reservation: Option<(u64, u8)>,
    trap: Option<Trap>,
}
impl Case {
    fn new(name: impl Into<String>, word: u32, rd: u64, memory: u64) -> Self {
        Self {
            name: name.into(),
            word,
            address: DATA,
            before_reservation: Some((DATA, 8)),
            rd,
            memory: [memory, NEXT],
            reservation: Some((DATA, 8)),
            trap: None,
        }
    }
}

fn cases() -> Vec<Case> {
    let mut cases = Vec::new();
    for (kind, expected) in [
        0xffff_ffff_ffff_ff80,
        0xffff_ffff_ffff_8180,
        0xffff_ffff_8000_8180,
        INITIAL,
        0x80,
        0x8180,
        0x8000_8180,
    ]
    .into_iter()
    .enumerate()
    {
        cases.push(Case::new(
            format!("load-kind-{kind}"),
            load(kind as u32),
            expected,
            INITIAL,
        ));
    }
    let stored = [
        0x8877_6655_8000_8110,
        0x8877_6655_8000_3210,
        0x8877_6655_7654_3210,
        VALUE,
    ];
    for (width, expected) in stored.into_iter().enumerate() {
        let mut c = Case::new(
            format!("store-width-{}", 1 << width),
            store(width as u32),
            RD_SENTINEL,
            expected,
        );
        c.reservation = None;
        cases.push(c);
    }
    let mut c = Case::new("misaligned-ld", load(3), 0xaa88_7766_5580_0081, INITIAL);
    c.address += 1;
    cases.push(c);
    let mut c = Case::new(
        "misaligned-sd",
        store(3),
        RD_SENTINEL,
        0xdcba_9876_5432_1080,
    );
    c.address += 1;
    c.memory[1] = 0x1020_3040_5060_70fe;
    c.reservation = None;
    cases.push(c);
    let mut c = Case::new(
        "nonoverlapping-store-keeps-reservation",
        store(3),
        RD_SENTINEL,
        VALUE,
    );
    c.before_reservation = Some((DATA + 8, 8));
    c.reservation = c.before_reservation;
    cases.push(c);

    // Literal RMW results in ISA funct5 order: swap/add/xor/and/or/min/max/minu/maxu.
    let selectors = [1, 0, 4, 12, 8, 16, 20, 24, 28];
    let word_results = [
        0x8877_6655_7654_3210,
        0x8877_6655_f654_b390,
        0x8877_6655_f654_b390,
        0x8877_6655_0000_0000,
        0x8877_6655_f654_b390,
        INITIAL,
        0x8877_6655_7654_3210,
        0x8877_6655_7654_3210,
        INITIAL,
    ];
    let double_results = [
        VALUE,
        0x8754_20ed_f654_b390,
        0x76ab_dccd_f654_b390,
        0x8854_2210_0000_0000,
        0xfeff_fedd_f654_b390,
        INITIAL,
        VALUE,
        INITIAL,
        VALUE,
    ];
    for (width, results, old) in [
        (2, word_results, 0xffff_ffff_8000_8180),
        (3, double_results, INITIAL),
    ] {
        for (selector, expected) in selectors.into_iter().zip(results) {
            let mut c = Case::new(
                format!("amo-{selector}-width-{}", 1 << width),
                atomic(selector, width),
                old,
                expected,
            );
            c.reservation = None;
            cases.push(c);
        }
        let bytes = (1 << width) as u8;
        let mut c = Case::new(format!("lr-width-{bytes}"), atomic(2, width), old, INITIAL);
        c.before_reservation = None;
        c.reservation = Some((DATA, bytes));
        cases.push(c);
        let mut c = Case::new(
            format!("sc-success-width-{bytes}"),
            atomic(3, width),
            0,
            stored[width as usize],
        );
        c.before_reservation = Some((DATA, bytes));
        c.reservation = None;
        cases.push(c);
        for (label, reservation) in [
            ("absent", None),
            ("address", Some((DATA + 8, bytes))),
            ("width", Some((DATA, if bytes == 8 { 4 } else { 8 }))),
        ] {
            let mut c = Case::new(
                format!("sc-failure-{label}-width-{bytes}"),
                atomic(3, width),
                1,
                INITIAL,
            );
            c.before_reservation = reservation;
            c.reservation = None;
            cases.push(c);
        }
    }
    // High bits must survive the i64 ABI all the way into tval. Each helper faults
    // after an observable prefix, leaving rd and the following instruction intact.
    for (name, word, cause) in [
        ("load", load(3), Exception::LoadAccessFault),
        ("store", store(3), Exception::StoreAccessFault),
        ("amo", atomic(0, 3), Exception::StoreAccessFault),
        ("lr", atomic(2, 3), Exception::LoadAccessFault),
        ("sc", atomic(3, 3), Exception::StoreAccessFault),
    ] {
        let mut c = Case::new(
            format!("high-address-{name}-fault"),
            word,
            RD_SENTINEL,
            INITIAL,
        );
        c.address = 0xffff_ffff_8000_4000;
        c.trap = Some(Trap {
            cause,
            tval: c.address,
        });
        if name == "sc" {
            c.before_reservation = Some((c.address, 8));
            c.reservation = None;
        }
        cases.push(c);
    }
    for (name, selector, cause) in [
        ("amo", 0, Exception::StoreAddrMisaligned),
        ("lr", 2, Exception::LoadAddrMisaligned),
        ("sc", 3, Exception::StoreAddrMisaligned),
    ] {
        let mut c = Case::new(
            format!("misaligned-{name}-fault"),
            atomic(selector, 3),
            RD_SENTINEL,
            INITIAL,
        );
        c.address += 1;
        c.trap = Some(Trap {
            cause,
            tval: c.address,
        });
        cases.push(c);
    }
    cases
}

fn literal_matrix(shared: bool) {
    let mut aggregate = Sha256::new();
    let cases = cases();
    for c in &cases {
        let mut m = machine(c.address, c.before_reservation);
        let mut oracle = machine(c.address, c.before_reservation);
        let words = [addi(20), c.word, addi(21)];
        let mut oracle_trap = None;
        let mut retired = 0;
        // Canonical reference instruction-state trace: PC, raw word, complete
        // before/after state digests and trap cause/tval, all little-endian.
        // This records the oracle path; equality below proves the compiled
        // boundary returns its same final architectural state and RAM.
        let mut reference_trace = Sha256::new();
        for raw in words {
            reference_trace.update(oracle.hart().regs.pc.to_le_bytes());
            reference_trace.update(raw.to_le_bytes());
            reference_trace.update(state_digest(&oracle).as_bytes());
            let ptr: *mut Machine = &mut oracle;
            // SAFETY: oracle consumes disjoint components synchronously.
            let outcome = unsafe {
                (*ptr).hart_mut().exec_oracle(
                    (*ptr).bus_mut(),
                    decode(raw).unwrap(),
                    4,
                    u64::from(raw),
                )
            };
            reference_trace.update(state_digest(&oracle).as_bytes());
            match outcome {
                Ok(()) => retired += 1,
                Err(trap) => {
                    reference_trace.update((trap.cause as u64).to_le_bytes());
                    reference_trace.update(trap.tval.to_le_bytes());
                    oracle_trap = Some(trap);
                    break;
                }
            }
        }
        assert_eq!(oracle_trap, c.trap, "{} oracle trap", c.name);
        let mut e = executor(&m, shared);
        e.install(&block(DRAM_BASE, &words));
        assert!(e.is_compiled(DRAM_BASE), "{} compiled", c.name);
        let ptr: *mut Machine = &mut m;
        // SAFETY: synchronous compiled call with disjoint live components.
        let exit = unsafe {
            e.execute(DRAM_BASE, (*ptr).hart_mut(), (*ptr).bus_mut())
                .unwrap()
        };
        assert_eq!(e.executed_blocks(), 1, "{} execution count", c.name);
        assert_eq!(exit.trap, c.trap, "{} compiled trap", c.name);
        assert_eq!(
            exit.code,
            if c.trap.is_some() {
                ExitCode::Trap
            } else {
                ExitCode::Fallthrough
            },
            "{} exit",
            c.name
        );
        assert_eq!(
            exit.next_pc,
            DRAM_BASE + retired * 4,
            "{} prefix PC",
            c.name
        );
        assert_eq!(
            exit.retired,
            if shared { retired } else { 0 },
            "{} reported retirement",
            c.name
        );
        if let Some(trap) = c.trap {
            assert_eq!(exit.exit_info, trap.cause as u64, "{} cause", c.name);
        }
        assert_eq!(m.hart().regs.read(3), c.rd, "{} literal rd", c.name);
        assert_eq!(
            m.hart().regs.read(20),
            41,
            "{} prefix executes once",
            c.name
        );
        assert_eq!(
            m.hart().regs.read(21),
            if c.trap.is_some() { 80 } else { 81 },
            "{} suffix",
            c.name
        );
        assert_eq!(
            m.hart().resv,
            c.reservation,
            "{} literal reservation",
            c.name
        );
        assert_eq!(
            [
                m.bus_mut().load64(DATA).unwrap(),
                m.bus_mut().load64(DATA + 8).unwrap()
            ],
            c.memory,
            "{} literal memory",
            c.name
        );
        // The caller, not execute(), commits the returned PC. Neither direct path
        // advances cycle/instret counters; full serialized architectural state is
        // therefore comparable after this one explicit PC commit.
        m.hart_mut().regs.pc = exit.next_pc;
        assert_eq!(
            m.hart().to_snapshot(),
            oracle.hart().to_snapshot(),
            "{} complete hart parity",
            c.name
        );
        assert_eq!(m.snapshot(), oracle.snapshot(), "{} RAM parity", c.name);
        let digest = state_digest(&m);
        aggregate.update(c.name.as_bytes());
        aggregate.update(digest.as_bytes());
        let reference_trace = format!("{:x}", reference_trace.finalize());
        aggregate.update(reference_trace.as_bytes());
        console_log!(
            "MEMORY_STATE shared={} case={} retired={} digest={} reference_trace={}",
            shared,
            c.name,
            retired,
            digest,
            reference_trace
        );
    }
    console_log!(
        "MEMORY_LITERAL_MATRIX shared={} cases={} aggregate={:x}",
        shared,
        cases.len(),
        aggregate.finalize()
    );
}

#[wasm_bindgen_test]
fn private_literal_width_atomic_fault_matrix() {
    literal_matrix(false);
}
#[wasm_bindgen_test]
fn shared_literal_width_atomic_fault_matrix() {
    literal_matrix(true);
}

#[wasm_bindgen_test]
fn successful_atomic_imports_abort_before_linked_successor() {
    for selector in [None, Some(0), Some(2), Some(3)] {
        let mut m = machine(DATA, Some((DATA, 8)));
        let mut e = executor(&m, true);
        let first = selector.map_or_else(|| addi(20), |selector| atomic(selector, 3));
        let caller = block(DRAM_BASE, &[first, 0x0040_006f]);
        let target = block(DRAM_BASE + 8, &[addi(21), 0x0040_006f]);
        e.install_batch(&[caller, target], &[[Some(1), None], [None, None]]);
        let ptr: *mut Machine = &mut m;
        // SAFETY: synchronous compiled call with disjoint live components.
        let exit = unsafe {
            e.execute_with_budget(DRAM_BASE, (*ptr).hart_mut(), (*ptr).bus_mut(), 16, 16, true)
                .unwrap()
        };
        assert_eq!(
            exit.code,
            ExitCode::BranchTaken,
            "atomic selector {selector:?}"
        );
        let Some(selector) = selector else {
            assert_eq!(exit.next_pc, DRAM_BASE + 16);
            assert_eq!(exit.retired, 4, "control must traverse the installed edge");
            assert_eq!(m.hart().regs.read(21), 81);
            continue;
        };
        assert_eq!(exit.next_pc, DRAM_BASE + 8);
        assert_eq!(exit.retired, 2);
        assert_eq!(exit.trap, None);
        assert_eq!(
            m.hart().regs.read(21),
            80,
            "successor cannot execute across atomic boundary"
        );
        let (rd, memory, reservation) = match selector {
            0 => (INITIAL, 0x8754_20ed_f654_b390, None),
            2 => (INITIAL, INITIAL, Some((DATA, 8))),
            3 => (0, VALUE, None),
            _ => unreachable!(),
        };
        assert_eq!(m.hart().regs.read(3), rd);
        assert_eq!(m.bus_mut().load64(DATA).unwrap(), memory);
        assert_eq!(m.hart().resv, reservation);
        console_log!(
            "MEMORY_ATOMIC_CHAIN_ABORT selector={} retired={} digest={}",
            selector,
            exit.retired,
            state_digest(&m)
        );
    }
}
