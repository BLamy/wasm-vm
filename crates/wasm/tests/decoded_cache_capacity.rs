//! Real JsValue selection and real in-WASM compiled cache; no browser boot or latency claim.
#![cfg(all(target_arch = "wasm32", not(feature = "zicsr-stub")))]

use wasm_bindgen::JsValue;
use wasm_bindgen_test::wasm_bindgen_test;
use wasm_vm_wasm::WasmLinux;

fn machine() -> WasmLinux {
    WasmLinux::new(
        8,
        &0x0000_006fu32.to_le_bytes(),
        &[],
        String::new(),
        js_sys::Function::new_no_args(""),
        false,
    )
    .unwrap()
}

fn field(object: &JsValue, key: &str) -> JsValue {
    js_sys::Reflect::get(object, &JsValue::from_str(key)).unwrap()
}

fn number(object: &JsValue, key: &str) -> f64 {
    field(object, key).as_f64().unwrap()
}

fn json(value: &JsValue) -> String {
    js_sys::JSON::stringify(value).unwrap().as_string().unwrap()
}

fn snapshot(m: &WasmLinux) -> Vec<u8> {
    js_sys::Uint8Array::new(&m.save_snapshot().unwrap()).to_vec()
}

fn warm(m: &WasmLinux) {
    m.run_chunk(20_000, None).unwrap();
    let stats = m.jit_stats().unwrap();
    assert!(number(&stats, "compiledBlocks") > 0.0);
    assert!(number(&stats, "retiredViaJit") > 0.0);
}

#[wasm_bindgen_test]
fn strict_numeric_boundary_rejects_before_any_architectural_or_live_cache_mutation() {
    let m = machine();
    assert_eq!(
        number(&m.jit_stats().unwrap(), "decodedCacheEntries"),
        4096.0
    );
    m.enable_jit(512).unwrap();
    warm(&m);
    let blob = snapshot(&m);
    let stats = json(&m.jit_stats().unwrap());
    let object = js_sys::Object::new();
    js_sys::Reflect::set(
        &object,
        &JsValue::from_str("valueOf"),
        &js_sys::Function::new_no_args("this.coerced = true; return 16384;"),
    )
    .unwrap();
    let mut invalid = vec![
        JsValue::UNDEFINED,
        JsValue::NULL,
        JsValue::TRUE,
        JsValue::FALSE,
        JsValue::from_str("4096"),
        JsValue::from_str("16384"),
        JsValue::from_str(""),
        js_sys::Array::of1(&JsValue::from_f64(16384.0)).into(),
        object.clone().into(),
        js_sys::BigInt::from(16384u64).into(),
        js_sys::Symbol::for_("16384").into(),
    ];
    invalid.extend(
        [
            f64::NAN,
            f64::INFINITY,
            f64::NEG_INFINITY,
            -1.0,
            -0.0,
            0.0,
            1.0,
            4095.0,
            4096.5,
            8192.0,
            16383.0,
            16_384.000_001,
            16385.0,
            u64::MAX as f64,
        ]
        .map(JsValue::from_f64),
    );
    for value in invalid {
        assert!(m.set_decoded_cache_entries(value).is_err());
        assert_eq!(json(&m.jit_stats().unwrap()), stats);
        assert_eq!(snapshot(&m), blob);
    }
    assert!(field(&object, "coerced").is_undefined());
    m.set_decoded_cache_entries(JsValue::from_f64(4096.0))
        .unwrap();
    assert_eq!(
        json(&m.jit_stats().unwrap()),
        stats,
        "same size invalidated real compiled handles"
    );
    assert_eq!(snapshot(&m), blob);
}

#[wasm_bindgen_test]
fn resize_clears_real_compiled_and_discovery_state_preserving_guest_bytes_and_policy() {
    let m = machine();
    m.enable_jit(512).unwrap();
    m.set_chaining(true).unwrap();
    m.set_dynamic_chaining(true).unwrap();
    for entries in [16384.0, 4096.0] {
        warm(&m);
        let before = m.jit_stats().unwrap();
        let blob = snapshot(&m);
        let digest = m.state_digest().unwrap();
        let clock = json(&m.guest_clock_state().unwrap());
        let sound = json(&m.virtio_snd_config().unwrap());
        m.set_decoded_cache_entries(JsValue::from_f64(entries))
            .unwrap();
        let after = m.jit_stats().unwrap();
        assert_eq!(number(&after, "decodedCacheEntries"), entries);
        assert_eq!(number(&after, "compiledBlocks"), 0.0);
        assert_eq!(number(&after, "blockBuilds"), 0.0);
        assert_eq!(number(&after, "blockEntryHits"), 0.0);
        assert_eq!(
            number(&after, "discoveryGeneration"),
            number(&before, "discoveryGeneration") + 1.0
        );
        for key in [
            "hasExecutor",
            "jitResidencyPolicy",
            "jitResidencyCap",
            "jitRegionChaining",
            "jitDynamicChaining",
        ] {
            assert_eq!(
                field(&after, key),
                field(&before, key),
                "changed executor policy {key}"
            );
        }
        assert_eq!(
            snapshot(&m),
            blob,
            "resize changed CPU/RAM/clock/device snapshot bytes"
        );
        assert_eq!(m.state_digest().unwrap(), digest);
        assert_eq!(json(&m.guest_clock_state().unwrap()), clock);
        assert_eq!(json(&m.virtio_snd_config().unwrap()), sound);
        warm(&m);
        let live = json(&m.jit_stats().unwrap());
        m.set_decoded_cache_entries(JsValue::from_f64(entries))
            .unwrap();
        assert_eq!(
            json(&m.jit_stats().unwrap()),
            live,
            "same-size selection was not an exact no-op"
        );
    }
}

#[wasm_bindgen_test]
fn whole_machine_restore_retains_selected_host_capacity_and_flushes_real_compiled_state() {
    let source = machine();
    source.run_chunk(7, None).unwrap();
    let blob = snapshot(&source);
    source
        .set_decoded_cache_entries(JsValue::from_f64(16384.0))
        .unwrap();
    assert_eq!(
        snapshot(&source),
        blob,
        "capacity must not add/change snapshot fields"
    );
    let digest = source.state_digest().unwrap();
    let clock = json(&source.guest_clock_state().unwrap());
    for entries in [4096.0, 16384.0] {
        let restored = machine();
        restored
            .set_decoded_cache_entries(JsValue::from_f64(entries))
            .unwrap();
        restored.enable_jit(512).unwrap();
        warm(&restored);
        restored.load_snapshot_blob(blob.clone()).unwrap();
        let stats = restored.jit_stats().unwrap();
        assert_eq!(number(&stats, "decodedCacheEntries"), entries);
        assert_eq!(number(&stats, "compiledBlocks"), 0.0);
        assert_eq!(restored.state_digest().unwrap(), digest);
        assert_eq!(json(&restored.guest_clock_state().unwrap()), clock);
        warm(&restored);
        assert_eq!(
            number(&restored.jit_stats().unwrap(), "decodedCacheEntries"),
            entries
        );
    }
}
