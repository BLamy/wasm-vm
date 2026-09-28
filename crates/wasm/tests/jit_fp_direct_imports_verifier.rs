#![cfg(target_arch = "wasm32")]
//! Independent E5.5-T03ao import identity/type and lifetime critic.
//! Intercepts only module construction; no production hook or numerical oracle
//! is introduced. Literal outputs below do not call the implementation for their
//! expected values. Existing full numerical fixtures remain separate gates.

use wasm_bindgen::prelude::*;
use wasm_bindgen_test::*;
use wasm_vm_core::Machine;
use wasm_vm_core::bus::mmap::DRAM_BASE;
use wasm_vm_core::csr::{CsrOp, MSTATUS};
use wasm_vm_core::decode::decode;
use wasm_vm_core::dispatch::{DecodedBlock, MicroOp};
use wasm_vm_core::jit::{CompiledBlockExecutor, ExitCode};
use wasm_vm_wasm::BrowserExecutor;

#[wasm_bindgen(inline_js = r#"
let capture = null;
const names = ['fp_arith_s', 'fp_from_int_s', 'fp_to_word_s', 'fp_div_s', 'fp_fmadd_s'];
const i32 = 0x7f, i64 = 0x7e;
const signatures = [[i32,i32,i32,i32], [i64,i32,i32], [i32,i32,i32], [i32,i32,i32], [i32,i32,i32,i32]];
function check(ok, message) {
  if (!ok) throw new Error(message);
}
function identity(actual, exports) {
  for (const name of names) {
    check(actual[name] === exports['__jit_' + name], 'CRITIC_DIRECT_FP_IDENTITY ' + name);
  }
}
function signatureModule(params, result) {
  const type = [1,0x60,params.length,...params,1,result];
  // Import e.f with type 0 and re-export exactly that import as f.
  const imp = [1,1,0x65,1,0x66,0,0];
  const exp = [1,1,0x66,0,0];
  return new WebAssembly.Module(new Uint8Array([
    0,97,115,109,1,0,0,0,1,type.length,...type,2,imp.length,...imp,7,exp.length,...exp
  ]));
}
function callGoldens(functions) {
  const cases = [
    ['fp_arith_s', [0x3fc00000,0x40100000,0,0], 0x40700000n],
    ['fp_arith_s', [0xbfc00000,0x40100000,1,0], 0xc0580000n],
    ['fp_arith_s', [0x3f800000,0x33800000,0,3], 0x13f800001n],
    ['fp_arith_s', [0x7fc12345,0x3f800000,0,0], 0x7fc00000n],
    ['fp_from_int_s', [0x100000001n,2,0], 0x14f800000n],
    ['fp_from_int_s', [0x8000000000000001n,3,3], 0x15f000001n],
    ['fp_from_int_s', [0x8000000000000001n,2,0], 0x1df000000n],
    ['fp_from_int_s', [0xffffffffffffffffn,3,0], 0x15f800000n],
    ['fp_from_int_s', [0x7fffffffffffffffn,2,2], 0x15effffffn],
    ['fp_from_int_s', [0x98765432ffffffffn,0,0], 0xbf800000n],
    ['fp_from_int_s', [0x98765432ffffffffn,1,0], 0x14f800000n],
    ['fp_to_word_s', [0xbfc00000,0,0], 0x1fffffffen],
    ['fp_to_word_s', [0xbf800000,1,0], 0x1000000000n],
    ['fp_to_word_s', [0x4f000000,0,0], 0x107fffffffn],
    ['fp_to_word_s', [0x4f000000,1,0], 0x80000000n],
    ['fp_div_s', [0x3f800000,0,0], 0x87f800000n],
    ['fp_div_s', [0x3f800000,0x40400000,0], 0x13eaaaaabn],
    ['fp_div_s', [0x3f800000,0x40400000,1], 0x13eaaaaaan],
    ['fp_fmadd_s', [0x3f800001,0x3f7ffffe,0xbf800000,0], 0xa8800000n],
    ['fp_fmadd_s', [0x7f7fffff,0x40000000,0xff7fffff,0], 0x7f7fffffn],
    ['fp_fmadd_s', [0x00800000,0x3f7fffff,0,0], 0x300800000n],
    ['fp_fmadd_s', [0,0x7f800000,0x7fc00000,0], 0x107fc00000n],
  ];
  let digest = 0xcbf29ce484222325n;
  for (const [name,args,want] of cases) {
    const got = functions[name](...args);
    check(typeof got === 'bigint', 'CRITIC_DIRECT_FP_I64_RESULT ' + name);
    check(got === want, 'CRITIC_DIRECT_FP_LITERAL ' + name + ' got=' + got.toString(16) + ' want=' + want.toString(16));
    for (let shift=0n; shift<64n; shift+=8n) {
      digest = BigInt.asUintN(64, (digest ^ ((got >> shift) & 255n)) * 0x100000001b3n);
    }
  }
  return {cases:cases.length, digest:digest.toString(16)};
}
export function criticStartCapture() {
  check(capture === null, 'critic constructor already captured');
  const Native = WebAssembly.Instance;
  const rows = [];
  const proxy = new Proxy(Native, {
    construct(target, args) {
      const [module, imports] = args;
      const descriptors = WebAssembly.Module.imports(module);
      const used = descriptors.filter(x => x.module === 'env' && names.includes(x.name));
      if (used.length) {
        rows.push({
          used:used.map(x => x.name).sort(),
          shared:descriptors.some(x => x.module === 'env' && x.name === 'mem' && x.kind === 'memory'),
          actual:Object.fromEntries(names.map(name => [name,imports.env[name]])),
        });
      }
      return Reflect.construct(target, args, target);
    }
  });
  capture = {Native,rows,proxy};
  WebAssembly.Instance = proxy;
}
export function criticStopCapture() {
  if (capture !== null) {
    WebAssembly.Instance = capture.Native;
    capture = null;
  }
}
export function criticInspectCapture(exports, expectedRows, shared) {
  check(capture !== null, 'critic capture missing');
  const {Native,rows,proxy} = capture;
  check(WebAssembly.Instance === proxy, 'critic constructor changed unexpectedly');
  check(rows.length === expectedRows, 'CRITIC_DIRECT_FP_INSTANCE_COUNT got=' + rows.length + ' want=' + expectedRows);
  let literals = 0;
  const digests = [];
  for (const row of rows) {
    check(row.shared === shared, 'CRITIC_DIRECT_FP_MEMORY_MODEL');
    check(JSON.stringify(row.used) === JSON.stringify([...names].sort()), 'CRITIC_DIRECT_FP_ALL_FIVE_IMPORTS');
    identity(row.actual, exports);
    const result = callGoldens(row.actual);
    literals += result.cases;
    digests.push(result.digest);
  }
  const actual = rows[0].actual;
  let correctTypes = 0, rejectedTypes = 0;
  for (let f=0; f<names.length; f++) {
    const name = names[f], params = signatures[f], fn = actual[name];
    check(typeof fn === 'function', 'CRITIC_DIRECT_FP_CALLABLE ' + name);
    check(fn.length === params.length, 'CRITIC_DIRECT_FP_ARITY ' + name);
    const good = new Native(signatureModule(params,i64), {e:{f:fn}});
    check(good.exports.f === fn, 'CRITIC_DIRECT_FP_TYPED_REEXPORT ' + name);
    correctTypes++;
    const mutations = params.map((_,at) => [params.map((p,j) => j===at ? (p===i32 ? i64 : i32) : p),i64]);
    mutations.push([params,i32]);
    for (const [badParams,badResult] of mutations) {
      let rejected = false;
      try { new Native(signatureModule(badParams,badResult), {e:{f:fn}}); }
      catch (error) { check(error instanceof WebAssembly.LinkError, 'unexpected signature failure ' + error); rejected = true; }
      check(rejected, 'CRITIC_DIRECT_FP_RAW_TYPE ' + name);
      rejectedTypes++;
    }
  }
  // Isolated sabotage uses the real captured import, but changes only this local
  // dictionary to an equivalent JS trampoline. The same identity assertion must
  // reject it, even though the answer and the JS-callable type look correct.
  const trampoline = (...args) => actual.fp_from_int_s(...args);
  const sabotaged = {...actual,fp_from_int_s:trampoline};
  check(trampoline(0x100000001n,2,0) === 0x14f800000n, 'sabotage must retain arithmetic');
  let identitySabotageRejected = false;
  try { identity(sabotaged,exports); }
  catch (error) {
    check(error.message === 'CRITIC_DIRECT_FP_IDENTITY fp_from_int_s', 'wrong sabotage failure ' + error);
    identitySabotageRejected = true;
  }
  check(identitySabotageRejected, 'CRITIC_DIRECT_FP_SABOTAGE_NOT_CAUGHT');
  // A JS wrapper even links under the wrong i32 first parameter. The real raw
  // function above could not. Neither identity nor strict type is a print-only
  // assertion or a test of only the mathematical output.
  new Native(signatureModule([i32,i32,i32],i64), {e:{f:trampoline}});
  identity(actual,exports);
  return JSON.stringify({
    rows:rows.length,shared,helpers:5,literals,digests,correctTypes,rejectedTypes,
    identitySabotageRejected,wrongTypedTrampolineLinks:true,restoredIdentity:true,
    afterAllExecutorsDropped:true
  });
}
"#)]
extern "C" {
    #[wasm_bindgen(catch, js_name = criticStartCapture)]
    fn start_capture() -> Result<(), JsValue>;
    #[wasm_bindgen(js_name = criticStopCapture)]
    fn stop_capture();
    #[wasm_bindgen(catch, js_name = criticInspectCapture)]
    fn inspect_capture(
        exports: &JsValue,
        expected_rows: u32,
        shared: bool,
    ) -> Result<String, JsValue>;
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

const BOX: u64 = 0xffff_ffff_0000_0000;
const SENTINEL: u64 = 0x91a2_b3c4_d5e6_f708;

fn mixed_block(at: u64, increment: u32) -> DecodedBlock {
    let words = [
        0x0000_0053 | (2 << 20) | (1 << 15) | (8 << 7), // fadd.s f8,f1,f2,rne
        0x1000_0053 | (2 << 20) | (8 << 15) | (9 << 7), // fmul.s f9,f8,f2,rne
        0xd030_0053 | (5 << 15) | (3 << 12) | (10 << 7), // fcvt.s.lu f10,x5,rup
        0xc000_0053 | (9 << 15) | (1 << 12) | (11 << 7), // fcvt.w.s x11,f9,rtz
        0x1800_0053 | (1 << 20) | (9 << 15) | (12 << 7), // fdiv.s f12,f9,f1,rne
        0x43 | (12 << 27) | (2 << 20) | (1 << 15) | (13 << 7), // fmadd.s f13,f1,f2,f12,rne
        (increment << 20) | (7 << 15) | (7 << 7) | 0x13, // addi x7,x7,increment
    ];
    DecodedBlock::new(
        at,
        words
            .into_iter()
            .map(|raw| MicroOp {
                instr: decode(raw).expect("critic independent mixed FP encoding"),
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

fn exercise(
    e: &mut BrowserExecutor,
    m: &mut Machine,
    at: u64,
    second_guest: bool,
    increment: u64,
    shared: bool,
) {
    m.hart_mut()
        .csr
        .access(MSTATUS, CsrOp::Write, 1 << 13, false, false, 0)
        .unwrap();
    m.hart_mut().csr.frm = 2;
    m.hart_mut().csr.fflags = 8;
    m.hart_mut().regs.pc = at;
    for r in 1..32 {
        m.hart_mut()
            .regs
            .write(r, SENTINEL.wrapping_add(u64::from(r)));
    }
    m.hart_mut().regs.write(7, 100);
    m.hart_mut().regs.write(
        5,
        if second_guest {
            0x8000_0000_0000_0001
        } else {
            0x0000_0001_0000_0001
        },
    );
    for r in 0..32 {
        m.hart_mut()
            .fregs
            .write_raw(r, SENTINEL.wrapping_sub(u64::from(r)));
    }
    m.hart_mut().fregs.write_raw(
        1,
        BOX | if second_guest {
            0x4080_0000
        } else {
            0x4000_0000
        },
    );
    m.hart_mut().fregs.write_raw(
        2,
        BOX | if second_guest {
            0x40a0_0000
        } else {
            0x4040_0000
        },
    );
    let mut want_x: [u64; 32] = core::array::from_fn(|r| m.hart().regs.read(r as u8));
    let mut want_f: [u64; 32] = core::array::from_fn(|r| m.hart().fregs.read_raw(r as u8));
    want_x[7] = 100 + increment;
    want_x[11] = if second_guest { 45 } else { 15 };
    let results = if second_guest {
        [
            0x4110_0000,
            0x4234_0000,
            0x5f00_0001,
            0x4134_0000,
            0x41fa_0000,
        ]
    } else {
        [
            0x40a0_0000,
            0x4170_0000,
            0x4f80_0001,
            0x40f0_0000,
            0x4158_0000,
        ]
    };
    for (reg, value) in [8, 9, 10, 12, 13].into_iter().zip(results) {
        want_f[reg] = BOX | value;
    }
    let before = e.executed_blocks();
    let ptr: *mut Machine = m;
    // SAFETY: synchronous compiled call with disjoint live Machine components.
    let exit = unsafe { e.execute(at, (*ptr).hart_mut(), (*ptr).bus_mut()).unwrap() };
    assert_eq!(e.executed_blocks(), before + 1);
    assert_eq!(exit.code, ExitCode::Fallthrough);
    assert_eq!(exit.next_pc, at + 28);
    assert_eq!(exit.retired, if shared { 7 } else { 0 });
    assert_eq!(exit.trap, None);
    assert_eq!(
        core::array::from_fn::<_, 32, _>(|r| m.hart().regs.read(r as u8)),
        want_x
    );
    assert_eq!(
        core::array::from_fn::<_, 32, _>(|r| m.hart().fregs.read_raw(r as u8)),
        want_f
    );
    assert_eq!(m.hart().csr.fflags, 9);
    assert_eq!(m.hart().csr.frm, 2);
    assert_eq!(m.hart().csr.fs(), 3);
}

fn identity_types_lifetimes(shared: bool) {
    let _capture = Capture::start();
    let mut a = Machine::new(64 * 1024);
    let mut b = Machine::new(64 * 1024);
    let mut first = executor(&a, shared);
    let mut survivor = executor(&b, shared);
    let addresses = [DRAM_BASE, DRAM_BASE + 4096];
    let mut executions = 0;
    for (i, at) in addresses.into_iter().enumerate() {
        first.install(&mixed_block(at, 1 + i as u32));
        survivor.install(&mixed_block(at, 3 + i as u32));
        assert!(first.is_compiled(at) && survivor.is_compiled(at));
        exercise(&mut first, &mut a, at, false, 1 + i as u64, shared);
        exercise(&mut survivor, &mut b, at, true, 3 + i as u64, shared);
        executions += 2;
    }
    drop(first);
    drop(a);
    exercise(&mut survivor, &mut b, DRAM_BASE, true, 3, shared);
    executions += 1;
    survivor.invalidate_all();
    assert!(!survivor.is_compiled(DRAM_BASE));
    survivor.install(&mixed_block(DRAM_BASE, 7));
    assert!(survivor.is_compiled(DRAM_BASE));
    exercise(&mut survivor, &mut b, DRAM_BASE, true, 7, shared);
    executions += 1;
    let memory = wasm_bindgen::memory().unchecked_into::<js_sys::WebAssembly::Memory>();
    let before_bytes = js_sys::Uint8Array::new(&memory.buffer()).length();
    memory.grow(1);
    let after_bytes = js_sys::Uint8Array::new(&memory.buffer()).length();
    assert_eq!(after_bytes - before_bytes, 65_536);
    exercise(&mut survivor, &mut b, DRAM_BASE, true, 7, shared);
    executions += 1;
    let mut c = Machine::new(64 * 1024);
    let mut replacement = executor(&c, shared);
    replacement.install(&mixed_block(DRAM_BASE, 11));
    assert!(replacement.is_compiled(DRAM_BASE));
    exercise(&mut replacement, &mut c, DRAM_BASE, false, 11, shared);
    executions += 1;
    drop(survivor);
    drop(b);
    exercise(&mut replacement, &mut c, DRAM_BASE, false, 11, shared);
    executions += 1;
    drop(replacement);
    drop(c);
    // Probe all recorded raw functions after every executor and guest is gone.
    // A leaked guest context or dropped Closure cannot satisfy this boundary.
    let receipt = inspect_capture(&wasm_bindgen::exports(), 6, shared).unwrap();
    console_log!(
        "CRITIC_DIRECT_FP_IMPORTS shared={} compiled_executions={} memory_growth={} {}",
        shared,
        executions,
        after_bytes - before_bytes,
        receipt
    );
}

#[wasm_bindgen_test]
fn verifier_private_direct_fp_identity_types_lifetimes() {
    identity_types_lifetimes(false);
}

#[wasm_bindgen_test]
fn verifier_shared_direct_fp_identity_types_lifetimes() {
    identity_types_lifetimes(true);
}
