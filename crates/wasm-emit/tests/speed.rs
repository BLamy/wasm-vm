//! Emit-speed sanity (AC 5): a 200-function module with ~1000 instructions each must serialize in
//! well under 10 ms natively — the emitter is on the JIT's hot path (§7), so pathological slowness
//! (e.g. an accidental per-instruction allocation or O(n^2) section rebuild) must fail the build.
//! Also reports throughput so the README number can be refreshed.

use std::time::Instant;
use wasm_emit::*;

fn build_200x1000() -> (Vec<u8>, usize) {
    let mut m = ModuleBuilder::new();
    let t = m.add_type(FuncType::new(&[ValType::I64], &[ValType::I64]));
    let mut instrs = 0usize;
    for _ in 0..200 {
        let f = m.add_function(t);
        let _ = f;
        let mut b = FuncBuilder::new(&[ValType::I64]);
        b.local_get(0);
        for _ in 0..1000 {
            b.i64_const(3);
            b.i64_add();
            instrs += 2;
        }
        m.add_code(b.finish());
    }
    (m.finish(), instrs)
}

#[test]
fn emit_200_functions_under_10ms() {
    // warm once (allocator, code paths), then time the build.
    let _ = build_200x1000();
    let start = Instant::now();
    let (bytes, instrs) = build_200x1000();
    let elapsed = start.elapsed();

    let mbps = bytes.len() as f64 / 1e6 / elapsed.as_secs_f64();
    eprintln!(
        "emit 200 fns / {instrs} instrs -> {} bytes in {:?} ({:.1} MB/s, {:.1}M instr/s)",
        bytes.len(),
        elapsed,
        mbps,
        instrs as f64 / 1e6 / elapsed.as_secs_f64()
    );

    // Validate once so "fast" never means "fast garbage".
    use wasmparser::{Validator, WasmFeatures};
    let mut v = Validator::new_with_features(WasmFeatures::all());
    v.validate_all(&bytes).expect("200-fn module valid");

    assert!(
        elapsed.as_millis() < 10,
        "emitting 200x1000 took {elapsed:?}, budget is <10ms"
    );
}
