//! The core acceptance bar: every module this crate emits is fed through `wasmparser`'s validator
//! (threads feature ON), and a representative add-function is executed under `wasmtime` to prove the
//! bytes are not merely well-formed but semantically what we intended. Covers the four required
//! shapes (trivial add; funcref table + call_indirect; loads/stores + locals + control flow; many
//! functions) plus the adversarial cases (deep nesting, 1000-target br_table, >50k locals, a body
//! whose length prefix crosses a LEB byte boundary), and a 10k-module property test.

use proptest::prelude::*;
use wasm_emit::*;

/// Validate `bytes` with all features (incl. threads) enabled; panic with detail on failure.
fn validate(bytes: &[u8]) {
    use wasmparser::{Validator, WasmFeatures};
    let mut v = Validator::new_with_features(WasmFeatures::all());
    if let Err(e) = v.validate_all(bytes) {
        panic!(
            "wasmparser rejected emitted module: {e}\nbytes: {} long",
            bytes.len()
        );
    }
}

// --------------------------------------------------------------------------------------------
// Required shape 1: a trivial add function, standalone (no imports) so it also runs under wasmtime.
// --------------------------------------------------------------------------------------------
fn build_add() -> Vec<u8> {
    let mut m = ModuleBuilder::new();
    let t = m.add_type(FuncType::new(
        &[ValType::I64, ValType::I64],
        &[ValType::I64],
    ));
    let f = m.add_function(t);
    m.export("add", ExportKind::Func, f);
    let mut b = FuncBuilder::new(&[ValType::I64, ValType::I64]);
    b.local_get(0);
    b.local_get(1);
    b.i64_add();
    m.add_code(b.finish());
    m.finish()
}

#[test]
fn add_validates() {
    validate(&build_add());
}

#[test]
fn add_executes_under_wasmtime() {
    use wasmtime::{Engine, Instance, Module, Store};
    let bytes = build_add();
    validate(&bytes);
    let engine = Engine::default();
    let module = Module::new(&engine, &bytes).expect("wasmtime compile");
    let mut store = Store::new(&engine, ());
    let instance = Instance::new(&mut store, &module, &[]).expect("instantiate");
    let add = instance
        .get_typed_func::<(i64, i64), i64>(&mut store, "add")
        .expect("get add");
    assert_eq!(add.call(&mut store, (2, 40)).unwrap(), 42);
    assert_eq!(add.call(&mut store, (i64::MAX, 1)).unwrap(), i64::MIN); // wrapping add
    assert_eq!(add.call(&mut store, (-5, 5)).unwrap(), 0);
}

// --------------------------------------------------------------------------------------------
// Required shape 2: an imported shared memory + imported funcref table + call_indirect — the JIT's
// block-chaining ABI (§3/§4.4). Also exercises shared-memory limits flag (0x03) and an element seg.
// --------------------------------------------------------------------------------------------
#[test]
fn funcref_table_call_indirect_validates() {
    let mut m = ModuleBuilder::new();
    // block signature the JIT uses: fn(state_base: i32) -> i32
    let block_ty = m.add_type(FuncType::new(&[ValType::I32], &[ValType::I32]));

    m.import_memory(
        "env",
        "memory",
        MemType {
            limits: Limits::shared(1, 16),
        },
    );
    let table = m.import_table(
        "env",
        "blocks",
        TableType {
            elem: RefType::FuncRef,
            limits: Limits::bounded(0, 1024),
        },
    );

    // A dispatcher: (state_base, slot) -> i32, does call_indirect through the imported table.
    let disp_ty = m.add_type(FuncType::new(
        &[ValType::I32, ValType::I32],
        &[ValType::I32],
    ));
    let disp = m.add_function(disp_ty);
    m.export("dispatch", ExportKind::Func, disp);

    // A trivial block body that returns FALLTHROUGH(0).
    let blk = m.add_function(block_ty);
    m.export("blk0", ExportKind::Func, blk);
    m.add_element(0, &[blk]);

    let mut d = FuncBuilder::new(&[ValType::I32, ValType::I32]);
    d.local_get(0); // state_base -> arg to the callee
    d.local_get(1); // slot -> table index
    d.call_indirect(block_ty, table);
    m.add_code(d.finish());

    let mut b = FuncBuilder::new(&[ValType::I32]);
    b.i32_const(0);
    m.add_code(b.finish());

    validate(&m.finish());
}

// --------------------------------------------------------------------------------------------
// Required shape 3: loads/stores (partial widths) + locals + structured control flow.
// --------------------------------------------------------------------------------------------
#[test]
fn loads_stores_control_flow_validates() {
    let mut m = ModuleBuilder::new();
    m.import_memory(
        "env",
        "memory",
        MemType {
            limits: Limits::shared(1, 16),
        },
    );
    let t = m.add_type(FuncType::new(&[ValType::I32], &[ValType::I64]));
    let f = m.add_function(t);
    m.export("f", ExportKind::Func, f);

    let mut b = FuncBuilder::new(&[ValType::I32]);
    let acc = b.local(ValType::I64);
    let i = b.local(ValType::I32);
    b.i64_const(0);
    b.local_set(acc);
    b.i32_const(0);
    b.local_set(i);
    // block { loop { if (i >= arg) br 2; acc += mem[i*8]; i++; br 0 } }
    b.block(BlockType::Empty);
    b.loop_(BlockType::Empty);
    b.local_get(i);
    b.local_get(0);
    b.i32_ge_s();
    b.br_if(1); // exit the loop's enclosing block
    // acc += i64.load8_u(i)
    b.local_get(acc);
    b.local_get(i);
    b.i64_load8_u(0, 0);
    b.i64_add();
    b.local_set(acc);
    // also a store to exercise store path
    b.local_get(i);
    b.i32_const(7);
    b.i32_store8(0, 0);
    // i++
    b.local_get(i);
    b.i32_const(1);
    b.i32_add();
    b.local_set(i);
    b.br(0);
    b.end(); // loop
    b.end(); // block
    b.local_get(acc);
    m.add_code(b.finish());

    validate(&m.finish());
}

// --------------------------------------------------------------------------------------------
// Required shape 4: a module with many functions (batch of 64, the JIT's module granularity).
// --------------------------------------------------------------------------------------------
#[test]
fn many_functions_validates() {
    let mut m = ModuleBuilder::new();
    let t = m.add_type(FuncType::new(&[ValType::I64], &[ValType::I64]));
    for k in 0..64u32 {
        let f = m.add_function(t);
        m.export(&format!("f{k}"), ExportKind::Func, f);
        let mut b = FuncBuilder::new(&[ValType::I64]);
        b.local_get(0);
        b.i64_const(k as i64);
        b.i64_add();
        m.add_code(b.finish());
    }
    validate(&m.finish());
}

// --------------------------------------------------------------------------------------------
// Adversarial #1: control nesting >= 32 deep; a br_table with 1000 targets; a body with >50k
// locals; and a body sized so its LEB length prefix is multi-byte (crosses the 1-byte boundary).
// --------------------------------------------------------------------------------------------
#[test]
fn adversarial_deep_nesting() {
    let mut m = ModuleBuilder::new();
    let t = m.add_type(FuncType::new(&[], &[]));
    let f = m.add_function(t);
    let mut b = FuncBuilder::new(&[]);
    for _ in 0..40 {
        b.block(BlockType::Empty);
    }
    b.br(39); // jump all the way out
    for _ in 0..40 {
        b.end();
    }
    m.add_code(b.finish());
    let _ = f;
    validate(&m.finish());
}

#[test]
fn adversarial_big_br_table() {
    let mut m = ModuleBuilder::new();
    let t = m.add_type(FuncType::new(&[ValType::I32], &[]));
    let f = m.add_function(t);
    let _ = f;
    let mut b = FuncBuilder::new(&[ValType::I32]);
    // one enclosing block so target 0 is valid
    b.block(BlockType::Empty);
    b.local_get(0);
    let targets: Vec<u32> = (0..1000).map(|_| 0).collect();
    b.br_table(&targets, 0);
    b.end();
    m.add_code(b.finish());
    validate(&m.finish());
}

#[test]
fn adversarial_many_locals() {
    let mut m = ModuleBuilder::new();
    let t = m.add_type(FuncType::new(&[], &[]));
    let _f = m.add_function(t);
    let mut b = FuncBuilder::new(&[]);
    // The spec's implementation limit is 50_000 locals per function (wasmparser enforces it), so we
    // stress the RLE header at that ceiling: 50_000 same-typed locals must compress to a single run
    // (a 4-byte header: run-count=1, count=50000 LEB, type byte) — not 50_000 entries.
    for _ in 0..50_000 {
        b.local(ValType::I64);
    }
    let body = b.finish();
    // header = write_u32(1) + write_u32(50000) + 1 type byte = 1 + 3 + 1 = 5 bytes, then no instrs
    assert!(
        body.len() < 16,
        "locals header not RLE-compressed: {} bytes",
        body.len()
    );
    m.add_code(body);
    validate(&m.finish());
}

#[test]
fn adversarial_body_length_crosses_leb_boundary() {
    // Emit a function body whose length is > 127 bytes so its code-entry size prefix is 2 LEB bytes.
    // The classic bug is computing the prefix before the body grows; we always measure the final
    // bytes, so this must validate for bodies straddling 127/128 and 16383/16384.
    for n in [120u32, 126, 127, 128, 129, 200, 16380, 16390] {
        let mut m = ModuleBuilder::new();
        let t = m.add_type(FuncType::new(&[ValType::I64], &[ValType::I64]));
        m.add_function(t);
        let mut b = FuncBuilder::new(&[ValType::I64]);
        b.local_get(0);
        for _ in 0..n {
            b.i64_const(1);
            b.i64_add();
        }
        m.add_code(b.finish());
        validate(&m.finish());
    }
}

// --------------------------------------------------------------------------------------------
// Adversarial #3: API misuse must panic at build time, not emit garbage.
// --------------------------------------------------------------------------------------------
#[test]
#[should_panic(expected = "control frame")]
fn misuse_unbalanced_end_panics() {
    let mut b = FuncBuilder::new(&[]);
    b.block(BlockType::Empty);
    // forgot the matching end
    let _ = b.finish();
}

#[test]
#[should_panic(expected = "no open block")]
fn misuse_extra_end_panics() {
    let mut b = FuncBuilder::new(&[]);
    b.end();
}

#[test]
#[should_panic(expected = "out of range")]
fn misuse_bad_local_panics() {
    let mut b = FuncBuilder::new(&[ValType::I32]);
    b.local_get(5);
}

// --------------------------------------------------------------------------------------------
// Property test (AC 3b): 10k randomized straight-line function modules, all must validate.
// The generator maintains an abstract i64 operand stack and only emits arity-correct ops, then
// drains the stack so the (params)->() signature is satisfied.
// --------------------------------------------------------------------------------------------
fn gen_straightline(seed: &[u8], n_params: u32) -> Vec<u8> {
    let mut m = ModuleBuilder::new();
    let t = m.add_type(FuncType::new(&vec![ValType::I64; n_params as usize], &[]));
    let _f = m.add_function(t);
    let mut b = FuncBuilder::new(&vec![ValType::I64; n_params as usize]);

    let n_locals = 1 + (seed.first().copied().unwrap_or(0) as u32 % 4);
    for _ in 0..n_locals {
        b.local(ValType::I64);
    }
    let total_locals = n_params + n_locals;

    let mut stack: u32 = 0;
    for &byte in seed {
        match byte % 8 {
            0 => {
                b.i64_const((byte as i64) * 3 - 100);
                stack += 1;
            }
            1 => {
                b.local_get(byte as u32 % total_locals);
                stack += 1;
            }
            2 if stack >= 2 => {
                b.i64_add();
                stack -= 1;
            }
            3 if stack >= 2 => {
                b.i64_mul();
                stack -= 1;
            }
            4 if stack >= 2 => {
                b.i64_or();
                stack -= 1;
            }
            5 if stack >= 1 => {
                b.local_set(byte as u32 % total_locals);
                stack -= 1;
            }
            6 if stack >= 1 => {
                b.local_tee(byte as u32 % total_locals);
            }
            _ if stack >= 1 => {
                b.drop();
                stack -= 1;
            }
            _ => {
                b.i64_const(0);
                stack += 1;
            }
        }
    }
    // drain to empty (signature has no results)
    for _ in 0..stack {
        b.drop();
    }
    m.add_code(b.finish());
    m.finish()
}

proptest! {
    #![proptest_config(ProptestConfig::with_cases(10_000))]
    #[test]
    fn ten_thousand_straightline_modules_validate(
        seed in proptest::collection::vec(any::<u8>(), 0..80),
        n_params in 1u32..4,
    ) {
        let bytes = gen_straightline(&seed, n_params);
        use wasmparser::{Validator, WasmFeatures};
        let mut v = Validator::new_with_features(WasmFeatures::all());
        prop_assert!(v.validate_all(&bytes).is_ok(), "generated module failed validation");
    }
}
