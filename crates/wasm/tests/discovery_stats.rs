//! Read-only discovery projection through the real WASM wrappers and executor, not a desktop boot.
#![cfg(all(target_arch = "wasm32", not(feature = "zicsr-stub")))]

use wasm_bindgen::JsValue;
use wasm_bindgen_test::wasm_bindgen_test;
use wasm_vm_wasm::{WasmLinux, WasmMachine};

#[path = "../../cli/tests/common/mod.rs"]
mod guest_forge;

const COUNTERS: [&str; 6] = [
    "nominated",
    "deduped",
    "droppedStale",
    "droppedOverflow",
    "countsDropped",
    "excluded",
];

fn field(object: &JsValue, key: &str) -> JsValue {
    js_sys::Reflect::get(object, &JsValue::from_str(key)).unwrap()
}

fn number(object: &JsValue, key: &str) -> f64 {
    let value = field(object, key).as_f64().unwrap();
    assert!(value.is_finite() && value >= 0.0 && value.fract() == 0.0);
    assert!(value <= 9_007_199_254_740_991.0);
    value
}

fn json(value: &JsValue) -> String {
    js_sys::JSON::stringify(value).unwrap().as_string().unwrap()
}

fn discovery(stats: &JsValue) -> JsValue {
    let value = field(stats, "discovery");
    let keys = js_sys::Object::keys(&js_sys::Object::from(value.clone()));
    assert_eq!(keys.length(), 10, "exact public field set");
    for key in
        COUNTERS
            .into_iter()
            .chain(["queueDepth", "queueHighWater", "candidates", "generation"])
    {
        number(&value, key);
    }
    assert_eq!(
        number(&value, "generation"),
        number(stats, "discoveryGeneration")
    );
    value
}

fn linux(words: &[u32]) -> WasmLinux {
    let kernel: Vec<u8> = words.iter().flat_map(|word| word.to_le_bytes()).collect();
    WasmLinux::new(
        8,
        &kernel,
        &[],
        String::new(),
        js_sys::Function::new_no_args(""),
        false,
    )
    .unwrap()
}

fn snapshot(machine: &WasmLinux) -> Vec<u8> {
    js_sys::Uint8Array::new(&machine.save_snapshot().unwrap()).to_vec()
}

fn run(machine: &WasmLinux, instructions: u32) {
    let result = machine.run_chunk(instructions, None).unwrap();
    assert_eq!(number(&result, "retired"), f64::from(instructions));
}

#[wasm_bindgen_test]
fn initial_shape_is_actual_and_shared_by_both_wrappers() {
    let linux = linux(&[0x0000_006f]); // jal x0, 0
    let bare = WasmMachine::new(1).unwrap();
    for stats in [linux.jit_stats().unwrap(), bare.jit_stats().unwrap()] {
        let d = discovery(&stats);
        for key in COUNTERS
            .into_iter()
            .chain(["queueDepth", "queueHighWater", "candidates"])
        {
            assert_eq!(number(&d, key), 0.0, "initial {key}");
        }
        assert_eq!(number(&d, "generation"), 1.0);
        assert_eq!(field(&stats, "hasExecutor").as_bool(), Some(false));
    }
}

#[wasm_bindgen_test]
fn real_candidates_nomination_dedup_and_compiled_progress_are_observed_without_mutation() {
    let m = linux(&[0x0000_006f]);
    m.set_fast_interpreter(true).unwrap();
    run(&m, 7);
    let cold = discovery(&m.jit_stats().unwrap());
    assert_eq!(number(&cold, "candidates"), 1.0);
    assert_eq!(number(&cold, "nominated"), 0.0);
    m.enable_jit(1).unwrap();
    // A fresh physical loop under the changed threshold starts with fresh discovery.
    m.set_fast_interpreter(false).unwrap();
    m.set_fast_interpreter(true).unwrap();
    run(&m, 20);
    let stats = m.jit_stats().unwrap();
    let d = discovery(&stats);
    assert_eq!(number(&d, "nominated"), 1.0);
    assert_eq!(number(&d, "deduped"), 19.0);
    assert_eq!(number(&d, "candidates"), 0.0);
    assert_eq!(number(&d, "queueDepth"), 0.0);
    assert_eq!(number(&d, "queueHighWater"), 1.0);
    assert_eq!(number(&stats, "compiledBlocks"), 1.0);
    run(&m, 1_000);
    let before_stats = json(&m.jit_stats().unwrap());
    let before_snapshot = snapshot(&m);
    let before_digest = m.state_digest().unwrap();
    let before_clock = json(&m.guest_clock_state().unwrap());
    for _ in 0..16 {
        assert_eq!(json(&m.jit_stats().unwrap()), before_stats);
    }
    // Returned objects are detached observations, never writable aliases to live counters.
    js_sys::Reflect::set(&d, &"nominated".into(), &JsValue::from_f64(999.0)).unwrap();
    assert_eq!(json(&m.jit_stats().unwrap()), before_stats);
    assert_eq!(snapshot(&m), before_snapshot);
    assert_eq!(m.state_digest().unwrap(), before_digest);
    assert_eq!(json(&m.guest_clock_state().unwrap()), before_clock);
    let before = m.jit_stats().unwrap();
    run(&m, 1_000);
    let after = m.jit_stats().unwrap();
    assert_eq!(number(&after, "compiledBlocks"), 1.0);
    assert_eq!(
        number(&after, "jitCacheInstalls"),
        number(&before, "jitCacheInstalls")
    );
    assert_eq!(
        number(&after, "retiredViaJit") - number(&before, "retiredViaJit"),
        1_000.0
    );
}

#[wasm_bindgen_test]
fn real_csr_terminator_is_excluded_while_supported_jump_is_nominated() {
    // csrrs x5, sstatus, x0; jal x0, -4. Linux starts in S mode; neither op traps.
    let m = linux(&[0x1000_22f3, 0xffdf_f06f]);
    m.enable_jit(1).unwrap();
    run(&m, 20);
    let d = discovery(&m.jit_stats().unwrap());
    assert_eq!(number(&d, "excluded"), 1.0);
    assert_eq!(number(&d, "nominated"), 1.0);
    assert_eq!(number(&d, "deduped"), 18.0);
    assert_eq!(number(&d, "candidates"), 0.0);
    assert_eq!(number(&d, "droppedStale"), 0.0);
}

#[wasm_bindgen_test]
fn one_bounded_real_jal_stream_overflows_queue_and_restore_resets_live_gauges() {
    const ENTRIES: u32 = 5_000;
    let mut words = vec![0x0040_006f; ENTRIES as usize]; // distinct jal x0, +4 blocks
    words.push(0x0000_006f);
    let m = linux(&words);
    m.enable_jit(1).unwrap();
    let saved = snapshot(&m);
    let saved_digest = m.state_digest().unwrap();
    let saved_clock = json(&m.guest_clock_state().unwrap());
    run(&m, ENTRIES);
    let stats = m.jit_stats().unwrap();
    let d = discovery(&stats);
    assert_eq!(number(&d, "queueDepth"), 4096.0);
    assert_eq!(number(&d, "queueHighWater"), 4096.0);
    assert!(number(&d, "droppedOverflow") > 0.0);
    assert_eq!(
        number(&d, "nominated") + number(&d, "droppedOverflow"),
        f64::from(ENTRIES)
    );
    assert_eq!(number(&d, "countsDropped"), 0.0);
    assert_eq!(number(&d, "candidates"), 0.0);
    assert!(number(&stats, "compiledBlocks") > 0.0);
    let frozen = json(&stats);
    for _ in 0..4 {
        assert_eq!(json(&m.jit_stats().unwrap()), frozen, "read drained queue");
    }
    run(&m, 1);
    let progressed = discovery(&m.jit_stats().unwrap());
    assert!(number(&progressed, "queueDepth") < 4096.0);
    assert_eq!(number(&progressed, "queueHighWater"), 4096.0);
    assert_eq!(
        number(&progressed, "droppedOverflow"),
        number(&d, "droppedOverflow")
    );
    m.load_snapshot_blob(saved).unwrap();
    let restored_stats = m.jit_stats().unwrap();
    let restored = discovery(&restored_stats);
    for key in COUNTERS.into_iter().chain(["queueDepth", "candidates"]) {
        assert_eq!(number(&restored, key), 0.0, "restore {key}");
    }
    assert_eq!(
        number(&restored, "generation"),
        number(&progressed, "generation") + 1.0
    );
    // Core intentionally preserves the lifetime queue high-water mark across reset.
    assert_eq!(number(&restored, "queueHighWater"), 4096.0);
    assert_eq!(number(&restored_stats, "compiledBlocks"), 0.0);
    assert_eq!(m.state_digest().unwrap(), saved_digest);
    assert_eq!(json(&m.guest_clock_state().unwrap()), saved_clock);
    run(&m, 20);
    assert_eq!(
        number(&discovery(&m.jit_stats().unwrap()), "nominated"),
        20.0
    );
}

#[wasm_bindgen_test]
fn bounded_cold_flood_reports_actual_counter_map_exhaustion_without_jit() {
    const ENTRIES: u32 = 65_537;
    let m = linux(&vec![0x0040_006f; ENTRIES as usize]);
    m.set_fast_interpreter(true).unwrap();
    run(&m, ENTRIES);
    let stats = m.jit_stats().unwrap();
    let d = discovery(&stats);
    assert_eq!(number(&d, "candidates"), 65_536.0);
    assert_eq!(number(&d, "countsDropped"), 1.0);
    for key in [
        "nominated",
        "deduped",
        "droppedOverflow",
        "excluded",
        "queueDepth",
    ] {
        assert_eq!(number(&d, key), 0.0);
    }
    assert_eq!(field(&stats, "hasExecutor").as_bool(), Some(false));
}

#[wasm_bindgen_test]
fn bare_metal_shared_projection_tracks_real_jit_without_changing_guest_or_stats() {
    let m = WasmMachine::new(8).unwrap();
    m.load_elf(&guest_forge::guest_hot_loop()).unwrap();
    m.enable_jit(1).unwrap();
    m.run(1_000).unwrap();
    let stats = m.jit_stats().unwrap();
    let d = discovery(&stats);
    assert!(number(&d, "nominated") > 0.0);
    assert!(number(&d, "deduped") > 0.0);
    assert!(number(&stats, "retiredViaJit") > 0.0);
    assert!(number(&stats, "compiledBlocks") > 0.0);
    let digest = m.state_digest().unwrap();
    for _ in 0..16 {
        assert_eq!(json(&m.jit_stats().unwrap()), json(&stats));
        assert_eq!(m.state_digest().unwrap(), digest);
    }
}
