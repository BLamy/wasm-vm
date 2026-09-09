//! Shared exact core fixtures plus the real wasm-bindgen JsValue boundary.
#![cfg(all(target_arch = "wasm32", not(feature = "zicsr-stub")))]

#[path = "../../core/tests/icount_divider.rs"]
mod core_icount_divider;

use wasm_bindgen::JsValue;
use wasm_bindgen_test::wasm_bindgen_test;
use wasm_vm_core::resume::{SectionReader, section};
use wasm_vm_wasm::WasmLinux;

fn machine() -> WasmLinux {
    WasmLinux::new(
        8,
        &0x0000_006fu32.to_le_bytes(), // Real busy guest, not a Linux boot or WFI.
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

fn json(value: &JsValue) -> String {
    js_sys::JSON::stringify(value).unwrap().as_string().unwrap()
}

fn snapshot(m: &WasmLinux) -> Vec<u8> {
    js_sys::Uint8Array::new(&m.save_snapshot().unwrap()).to_vec()
}

fn clock(blob: &[u8]) -> (u64, u64) {
    let (_, sections) = SectionReader::new(blob).unwrap();
    let entry = sections
        .map(Result::unwrap)
        .find(|s| s.tag == section::CLOCK)
        .unwrap();
    assert_eq!(entry.payload.len(), 24);
    (
        u64::from_le_bytes(entry.payload[..8].try_into().unwrap()),
        u64::from_le_bytes(entry.payload[8..16].try_into().unwrap()),
    )
}

#[wasm_bindgen_test]
fn strict_js_values_reject_without_coercion_or_machine_mutation() {
    let m = machine();
    m.run_chunk(7, None).unwrap();
    let before = snapshot(&m);
    let before_state = json(&m.guest_clock_state().unwrap());
    let object = js_sys::Object::new();
    js_sys::Reflect::set(
        &object,
        &JsValue::from_str("valueOf"),
        &js_sys::Function::new_no_args("this.coerced = true; return 1;"),
    )
    .unwrap();
    let mut invalid = vec![
        JsValue::UNDEFINED,
        JsValue::NULL,
        JsValue::TRUE,
        JsValue::FALSE,
        JsValue::from_str("1"),
        JsValue::from_str("10"),
        JsValue::from_str(""),
        js_sys::Array::of1(&JsValue::from_f64(1.0)).into(),
        object.clone().into(),
        js_sys::BigInt::from(1u64).into(),
        js_sys::Symbol::for_("1").into(),
    ];
    invalid.extend(
        [
            f64::NAN,
            f64::INFINITY,
            f64::NEG_INFINITY,
            -1.0,
            -0.0,
            0.0,
            0.5,
            1.5,
            1_024.000_001,
            1025.0,
            u64::MAX as f64,
        ]
        .map(JsValue::from_f64),
    );
    for value in invalid {
        assert!(m.set_icount_divider(value).is_err());
        assert_eq!(snapshot(&m), before);
        assert_eq!(json(&m.guest_clock_state().unwrap()), before_state);
    }
    assert!(
        js_sys::Reflect::get(&object, &JsValue::from_str("coerced"))
            .unwrap()
            .is_undefined()
    );
}

#[wasm_bindgen_test]
fn numeric_boundaries_same_divider_and_resume_preserve_fractional_progress() {
    let m = machine();
    assert_eq!(
        field(&m.guest_clock_state().unwrap(), "clockDiv").as_f64(),
        Some(10.0)
    );
    assert_eq!(
        field(&m.run_chunk(7, None).unwrap(), "retired").as_f64(),
        Some(7.0)
    );
    let before = snapshot(&m);
    assert_eq!(clock(&before), (7, 10));
    m.set_icount_divider(JsValue::from_f64(10.0)).unwrap();
    assert_eq!(snapshot(&m), before);
    m.set_icount_divider(JsValue::from_f64(3.0)).unwrap();
    let selected = snapshot(&m);
    assert_eq!(clock(&selected), (2, 3));
    assert_eq!(
        field(&m.guest_clock_state().unwrap(), "mtime")
            .as_string()
            .as_deref(),
        Some("0")
    );
    let fresh = machine();
    fresh.set_icount_divider(JsValue::from_f64(1024.0)).unwrap();
    fresh.load_snapshot_blob(selected.clone()).unwrap();
    let restored = snapshot(&fresh);
    let (_, before_sections) = SectionReader::new(&selected).unwrap();
    let (_, after_sections) = SectionReader::new(&restored).unwrap();
    let before_sections: Vec<_> = before_sections.map(Result::unwrap).collect();
    let after_sections: Vec<_> = after_sections.map(Result::unwrap).collect();
    assert_eq!(before_sections.len(), after_sections.len());
    for (before, after) in before_sections.iter().zip(&after_sections) {
        assert_eq!(before.tag, after.tag);
        if before.tag == section::VIRTIO_CONSOLE {
            // H deliberately advances the host-session generation on restore;
            // do not require a stale application session to survive for equality.
            assert_eq!(before.payload.len(), after.payload.len());
            let generation_offset = before.payload.len() - 8;
            assert_eq!(
                before.payload[..generation_offset],
                after.payload[..generation_offset]
            );
            let old = u64::from_le_bytes(before.payload[generation_offset..].try_into().unwrap());
            let new = u64::from_le_bytes(after.payload[generation_offset..].try_into().unwrap());
            assert_eq!(new, old.wrapping_add(1));
            continue;
        }
        assert!(
            before.payload == after.payload,
            "fresh restore changed tag {} at {:?} (lengths {}/{})",
            before.tag,
            before
                .payload
                .iter()
                .zip(after.payload)
                .position(|(a, b)| a != b),
            before.payload.len(),
            after.payload.len(),
        );
    }
    fresh.run_chunk(1, None).unwrap();
    assert_eq!(
        field(&fresh.guest_clock_state().unwrap(), "mtime")
            .as_string()
            .as_deref(),
        Some("1")
    );
    for divider in [1.0, 1024.0] {
        fresh
            .set_icount_divider(JsValue::from_f64(divider))
            .unwrap();
        assert_eq!(
            field(&fresh.guest_clock_state().unwrap(), "clockDiv").as_f64(),
            Some(divider)
        );
    }
}

#[wasm_bindgen_test]
fn divider_preserves_live_compiled_executor_counters_policy_and_guest_memory() {
    let m = machine();
    m.enable_jit(512).unwrap();
    m.set_chaining(true).unwrap();
    m.set_dynamic_chaining(true).unwrap();
    m.run_chunk(20_000, None).unwrap();
    let before = m.jit_stats().unwrap();
    assert_eq!(field(&before, "hasExecutor").as_bool(), Some(true));
    assert!(field(&before, "retiredViaJit").as_f64().unwrap() > 0.0);
    assert!(field(&before, "compiledBlocks").as_f64().unwrap() > 0.0);
    let digest = m.state_digest().unwrap();
    let time = field(&m.guest_clock_state().unwrap(), "mtime");
    m.set_icount_divider(JsValue::from_f64(1.0)).unwrap();
    assert_eq!(json(&m.jit_stats().unwrap()), json(&before));
    assert_eq!(m.state_digest().unwrap(), digest);
    assert_eq!(field(&m.guest_clock_state().unwrap(), "mtime"), time);
    assert!(m.set_icount_divider(JsValue::from_f64(1025.0)).is_err());
    assert_eq!(json(&m.jit_stats().unwrap()), json(&before));
    m.run_chunk(1_000, None).unwrap();
    assert!(
        field(&m.jit_stats().unwrap(), "retiredViaJit")
            .as_f64()
            .unwrap()
            > field(&before, "retiredViaJit").as_f64().unwrap()
    );
}
