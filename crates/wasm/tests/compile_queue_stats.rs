//! Actual WASM wrappers, guest execution and compile accounting; not desktop performance evidence.
#![cfg(all(target_arch = "wasm32", not(feature = "zicsr-stub")))]

use wasm_bindgen::JsValue;
use wasm_bindgen_test::wasm_bindgen_test;
use wasm_vm_wasm::{WasmLinux, WasmMachine};

#[path = "../../cli/tests/common/mod.rs"]
mod guest_forge;

const KEYS: [&str; 7] = [
    "admitted",
    "droppedBackpressure",
    "cancelledStale",
    "popped",
    "queueHighWater",
    "queueDepth",
    "capacity",
];

fn field(object: &JsValue, key: &str) -> JsValue {
    js_sys::Reflect::get(object, &JsValue::from_str(key)).unwrap()
}

fn number(object: &JsValue, key: &str) -> f64 {
    let n = field(object, key).as_f64().unwrap();
    assert!(n.is_finite() && n >= 0.0 && n.fract() == 0.0);
    n
}

fn json(value: &JsValue) -> String {
    js_sys::JSON::stringify(value).unwrap().as_string().unwrap()
}

fn queue(stats: &JsValue) -> JsValue {
    let q = field(stats, "compileQueue");
    let mut keys = js_sys::Object::keys(&js_sys::Object::from(q.clone()))
        .iter()
        .map(|key| key.as_string().unwrap())
        .collect::<Vec<_>>();
    keys.sort();
    let mut expected = KEYS.map(str::to_owned);
    expected.sort();
    assert_eq!(keys, expected);
    for key in KEYS {
        number(&q, key);
    }
    assert!(number(&q, "queueDepth") <= number(&q, "queueHighWater"));
    assert!(number(&q, "queueHighWater") <= number(&q, "capacity"));
    q
}

fn linux() -> WasmLinux {
    // 512 distinct supported JAL entries, then a self-loop. Just 2 KiB of guest code and 8 MiB RAM.
    let words = vec![0x0040_006fu32; 512];
    let kernel: Vec<u8> = words
        .into_iter()
        .chain([0x0000_006f])
        .flat_map(u32::to_le_bytes)
        .collect();
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

fn run(m: &WasmLinux, work: u32) {
    assert_eq!(
        number(&m.run_chunk(work, None).unwrap(), "retired"),
        f64::from(work)
    );
}

fn snapshot(m: &WasmLinux) -> Vec<u8> {
    js_sys::Uint8Array::new(&m.save_snapshot().unwrap()).to_vec()
}

fn pause(m: &WasmLinux) -> JsValue {
    field(&m.get_profile().unwrap(), "jitPause")
}

fn conservation(m: &WasmLinux, total_staged: f64) {
    let stats = m.jit_stats().unwrap();
    let q = queue(&stats);
    let d = field(&stats, "discovery");
    let p = pause(m);
    assert_eq!(
        total_staged,
        number(&q, "queueDepth")
            + number(&q, "droppedBackpressure")
            + number(&q, "cancelledStale")
            + number(&q, "popped"),
        "actual staging = pending + all backpressure losses + cancellation + pops"
    );
    assert_eq!(number(&q, "popped"), number(&p, "totalAttemptedBlocks"));
    assert_eq!(
        number(&stats, "jitSubmittedMembers"),
        number(&p, "totalSubmittedBlocks")
    );
    assert!(number(&q, "popped") >= number(&stats, "jitSubmittedMembers"));
    assert!(number(&q, "admitted") <= total_staged);
    // Incoming rejects are not admitted; replacements are. Never use admitted - all drops as depth.
    assert!(number(&q, "droppedBackpressure") >= total_staged - number(&q, "admitted"));
    assert_eq!(
        number(&d, "nominated"),
        total_staged + number(&d, "queueDepth")
    );
    assert_eq!(number(&d, "droppedOverflow"), 0.0);
    assert_eq!(number(&d, "droppedStale"), 0.0);
    assert_eq!(number(&d, "countsDropped"), 0.0);
    assert!(number(&p, "lastRunAttemptedBlocks") <= 8.0);
    assert!(number(&p, "lastRunStagedNominations") <= 64.0);
    assert_eq!(
        field(&field(&stats, "entryCost"), "timingEnabled").as_bool(),
        Some(false)
    );
}

#[wasm_bindgen_test]
fn initial_exact_shape_and_capacity_are_shared_by_both_wrappers_without_executor() {
    let m = linux();
    let bare = WasmMachine::new(1).unwrap();
    for stats in [m.jit_stats().unwrap(), bare.jit_stats().unwrap()] {
        let q = queue(&stats);
        for key in KEYS {
            assert_eq!(number(&q, key), if key == "capacity" { 256.0 } else { 0.0 });
        }
        assert_eq!(field(&stats, "hasExecutor").as_bool(), Some(false));
    }
}

#[wasm_bindgen_test]
fn real_backlog_backpressure_and_pop_obey_conservation_and_browser_run_budgets() {
    let m = linux();
    m.enable_jit(1).unwrap();
    let generation = number(&field(&m.jit_stats().unwrap(), "discovery"), "generation");
    run(&m, 512);
    let mut staged = number(&pause(&m), "lastRunStagedNominations");
    assert_eq!(staged, 32.0);
    let first = queue(&m.jit_stats().unwrap());
    assert_eq!(number(&first, "admitted"), 32.0);
    assert_eq!(number(&first, "queueDepth"), 24.0);
    assert_eq!(number(&first, "queueHighWater"), 32.0);
    assert_eq!(number(&first, "popped"), 8.0);
    conservation(&m, staged);
    for _ in 0..5 {
        run(&m, 1);
        let p = pause(&m);
        assert_eq!(number(&p, "lastRunStagedNominations"), 64.0);
        assert_eq!(number(&p, "lastRunAttemptedBlocks"), 8.0);
        staged += number(&p, "lastRunStagedNominations");
        conservation(&m, staged);
    }
    let stats = m.jit_stats().unwrap();
    let q = queue(&stats);
    assert_eq!(staged, 352.0);
    assert_eq!(number(&q, "queueDepth"), 248.0);
    assert_eq!(number(&q, "queueHighWater"), 256.0);
    assert_eq!(number(&q, "droppedBackpressure"), 56.0);
    assert_eq!(number(&q, "popped"), 48.0);
    assert_eq!(number(&q, "cancelledStale"), 0.0);
    assert_eq!(
        number(&field(&stats, "discovery"), "generation"),
        generation
    );
    assert!(number(&stats, "compiledBlocks") > 0.0);
}

#[wasm_bindgen_test]
fn repeated_reads_and_detached_object_mutation_preserve_backlog_guest_and_all_stats() {
    let m = linux();
    m.enable_jit(1).unwrap();
    run(&m, 512);
    let stats = m.jit_stats().unwrap();
    let q = queue(&stats);
    assert_eq!(number(&q, "queueDepth"), 24.0);
    let original_stats = json(&stats);
    let original_pause = json(&pause(&m));
    let original_snapshot = snapshot(&m);
    let original_digest = m.state_digest().unwrap();
    let original_clock = json(&m.guest_clock_state().unwrap());
    for _ in 0..16 {
        assert_eq!(json(&m.jit_stats().unwrap()), original_stats);
    }
    for key in KEYS {
        js_sys::Reflect::set(&q, &key.into(), &JsValue::from_f64(999.0)).unwrap();
    }
    assert_eq!(json(&m.jit_stats().unwrap()), original_stats);
    assert_eq!(json(&pause(&m)), original_pause);
    assert_eq!(snapshot(&m), original_snapshot);
    assert_eq!(m.state_digest().unwrap(), original_digest);
    assert_eq!(json(&m.guest_clock_state().unwrap()), original_clock);
    // Queries cannot consume queued work or alter the next real pump's accounting.
    run(&m, 1);
    conservation(&m, 96.0);
    assert_eq!(number(&queue(&m.jit_stats().unwrap()), "queueDepth"), 80.0);
}

#[wasm_bindgen_test]
fn restore_keeps_lifetime_queue_counters_then_actual_pump_cancels_old_generation() {
    let m = linux();
    m.enable_jit(1).unwrap();
    let saved = snapshot(&m);
    let initial_digest = m.state_digest().unwrap();
    let initial_clock = json(&m.guest_clock_state().unwrap());
    run(&m, 512);
    let before = m.jit_stats().unwrap();
    let before_queue = queue(&before);
    assert_eq!(number(&before_queue, "queueDepth"), 24.0);
    assert_eq!(number(&field(&before, "discovery"), "queueDepth"), 480.0);
    m.load_snapshot_blob(saved).unwrap();
    let restored = m.jit_stats().unwrap();
    assert_eq!(
        json(&queue(&restored)),
        json(&before_queue),
        "discovery reset must not reset queue observations"
    );
    let restored_discovery = field(&restored, "discovery");
    assert_eq!(number(&restored_discovery, "nominated"), 0.0);
    assert_eq!(number(&restored_discovery, "queueDepth"), 0.0);
    assert_eq!(
        number(&restored_discovery, "generation"),
        number(&field(&before, "discovery"), "generation") + 1.0
    );
    assert_eq!(number(&restored, "compiledBlocks"), 0.0);
    assert_eq!(m.state_digest().unwrap(), initial_digest);
    assert_eq!(json(&m.guest_clock_state().unwrap()), initial_clock);
    run(&m, 1);
    let after = m.jit_stats().unwrap();
    let q = queue(&after);
    assert_eq!(number(&q, "admitted"), 33.0);
    assert_eq!(number(&q, "cancelledStale"), 24.0);
    assert_eq!(number(&q, "popped"), 9.0);
    assert_eq!(number(&q, "queueDepth"), 0.0);
    assert_eq!(number(&q, "queueHighWater"), 32.0);
    assert_eq!(number(&q, "droppedBackpressure"), 0.0);
    // Queue conservation is lifetime-based, not the reset discovery nomination count of one.
    assert_eq!(
        33.0,
        number(&q, "queueDepth")
            + number(&q, "droppedBackpressure")
            + number(&q, "cancelledStale")
            + number(&q, "popped")
    );
    assert_eq!(number(&field(&after, "discovery"), "nominated"), 1.0);
    assert_eq!(number(&pause(&m), "lastRunStagedNominations"), 1.0);
    assert_eq!(number(&after, "compiledBlocks"), 1.0);
    let oracle = linux();
    run(&oracle, 1);
    assert_eq!(m.state_digest().unwrap(), oracle.state_digest().unwrap());
    assert_eq!(
        json(&m.guest_clock_state().unwrap()),
        json(&oracle.guest_clock_state().unwrap())
    );
}

#[wasm_bindgen_test]
fn bare_metal_shared_projection_reports_real_compilation_and_is_read_only() {
    let m = WasmMachine::new(8).unwrap();
    m.load_elf(&guest_forge::guest_hot_loop()).unwrap();
    m.enable_jit(1).unwrap();
    m.run(1000).unwrap();
    let stats = m.jit_stats().unwrap();
    let q = queue(&stats);
    assert!(number(&q, "admitted") > 0.0);
    assert!(number(&q, "popped") > 0.0);
    assert!(number(&stats, "compiledBlocks") > 0.0);
    assert!(number(&stats, "retiredViaJit") > 0.0);
    let original = json(&stats);
    let digest = m.state_digest().unwrap();
    for _ in 0..16 {
        assert_eq!(json(&m.jit_stats().unwrap()), original);
        assert_eq!(m.state_digest().unwrap(), digest);
    }
    js_sys::Reflect::set(&q, &"popped".into(), &JsValue::from_f64(999.0)).unwrap();
    assert_eq!(json(&m.jit_stats().unwrap()), original);
}
