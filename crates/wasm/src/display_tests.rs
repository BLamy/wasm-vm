//! E5-T22a: exercise the actual WasmLinux API, including states unavailable to ordinary JS.
use super::*;
use wasm_bindgen_test::wasm_bindgen_test;
use wasm_vm_core::dev::virtio::gpu::protocol::FORMAT_B8G8R8A8_UNORM;

fn machine() -> WasmLinux {
    WasmLinux::new(
        16,
        &[0x13, 0x05, 0x10, 0x00, 0x6f, 0, 0, 0],
        &[],
        String::new(),
        js_sys::Function::new_no_args(""),
        false,
    )
    .unwrap()
}

fn field(stats: &JsValue, key: &str) -> JsValue {
    js_sys::Reflect::get(stats, &key.into()).unwrap()
}

fn number(stats: &JsValue, key: &str) -> f64 {
    field(stats, key).as_f64().unwrap()
}

fn stats_json(vm: &WasmLinux) -> String {
    js_sys::JSON::stringify(&vm.display_stats().unwrap())
        .unwrap()
        .as_string()
        .unwrap()
}

#[wasm_bindgen_test]
fn display_hotplug_strict_validation_is_atomic() {
    let vm = machine();
    let before = stats_json(&vm);
    let invalid = [
        JsValue::UNDEFINED,
        JsValue::NULL,
        true.into(),
        false.into(),
        "640".into(),
        js_sys::Object::new().into(),
        js_sys::Array::new().into(),
        f64::NAN.into(),
        f64::INFINITY.into(),
        f64::NEG_INFINITY.into(),
        (-1.0).into(),
        0.into(),
        0.5.into(),
        4095.5.into(),
        4096.into(),
        4_294_967_297_f64.into(),
    ];
    for value in invalid {
        assert!(vm.set_display(value.clone(), 480.into()).is_err());
        assert_eq!(stats_json(&vm), before);
        assert!(vm.set_display(641.into(), value).is_err());
        assert_eq!(stats_json(&vm), before);
    }
    for (width, height) in [(1, 1), (4095, 4095), (1367, 901)] {
        assert!(vm.set_display(width.into(), height.into()).unwrap());
        let stats = vm.display_stats().unwrap();
        let edid = js_sys::Uint8Array::new(&field(&stats, "edid")).to_vec();
        assert_eq!(edid.len(), 128);
        assert_eq!(edid.iter().fold(0u8, |sum, b| sum.wrapping_add(*b)), 0);
        assert_eq!(
            u32::from(edid[56]) | (u32::from(edid[58] & 0xf0) << 4),
            width
        );
        assert_eq!(
            u32::from(edid[59]) | (u32::from(edid[61] & 0xf0) << 4),
            height
        );
        assert_eq!(number(&stats, "advertisedWidth"), f64::from(width));
        assert_eq!(number(&stats, "advertisedHeight"), f64::from(height));
        assert_eq!(number(&stats, "pendingEvents"), 1.0);
        assert!(field(&stats, "scanoutResource").is_null());
    }
    // The returned EDID must not alias internal state.
    let stats = vm.display_stats().unwrap();
    js_sys::Uint8Array::new(&field(&stats, "edid")).fill(0, 0, 128);
    let fresh = vm.display_stats().unwrap();
    assert_eq!(
        js_sys::Uint8Array::new(&field(&fresh, "edid")).get_index(1),
        255
    );
}

#[wasm_bindgen_test]
fn display_hotplug_storm_preserves_actual_old_resource() {
    let vm = machine();
    let (_, gpu) = vm.inner.borrow().machine.virtio_gpu().unwrap();
    {
        let mut state = gpu.borrow_mut();
        let resource = state
            .resources
            .create(17, FORMAT_B8G8R8A8_UNORM, 7, 5)
            .unwrap();
        for (index, pixel) in resource.host_pixels.iter_mut().enumerate() {
            *pixel = 0xff00_0000 | (index as u32 * 7919);
        }
        state.scanout_resource = Some(17);
    }
    let original = gpu.borrow().resources.get(17).unwrap().host_pixels.clone();
    for index in 0..1000 {
        assert!(
            vm.set_display((640 + index % 127).into(), (480 + index % 79).into())
                .unwrap()
        );
    }
    let stats = vm.display_stats().unwrap();
    assert_eq!(number(&stats, "advertisedWidth"), 750.0);
    assert_eq!(number(&stats, "advertisedHeight"), 531.0);
    assert_eq!(number(&stats, "resourceCount"), 1.0);
    assert_eq!(number(&stats, "resourceBytes"), 140.0);
    assert_eq!(number(&stats, "scanoutResource"), 17.0);
    assert_eq!(number(&stats, "scanoutWidth"), 7.0);
    assert_eq!(number(&stats, "scanoutHeight"), 5.0);
    assert_eq!(
        gpu.borrow().resources.get(17).unwrap().host_pixels,
        original
    );
    gpu.borrow_mut().resources.remove(17).unwrap();
    let empty = vm.display_stats().unwrap();
    assert_eq!(number(&empty, "resourceCount"), 0.0);
    assert_eq!(number(&empty, "resourceBytes"), 0.0);
    assert!(field(&empty, "scanoutResource").is_null());
    wasm_bindgen_test::console_log!("E5-T22a actual-device storm stats: {}", stats_json(&vm));
}

#[wasm_bindgen_test]
fn display_hotplug_absence_and_reentrancy_fail_boundedly() {
    let vm = machine();
    {
        let _borrow = vm.inner.borrow_mut();
        assert!(vm.set_display(641.into(), 481.into()).is_err());
        assert!(vm.display_stats().is_err());
    }
    let (_, gpu) = vm.inner.borrow().machine.virtio_gpu().unwrap();
    {
        let _borrow = gpu.borrow_mut();
        assert!(vm.set_display(641.into(), 481.into()).is_err());
        assert!(vm.display_stats().is_err());
    }
    vm.inner.borrow_mut().machine = Machine::new(16 * 1024 * 1024);
    assert!(!vm.set_display(641.into(), 481.into()).unwrap());
    assert!(vm.display_stats().unwrap().is_null());
}

#[wasm_bindgen_test]
fn display_hotplug_guest_trace_reads_event_after_request() {
    // The assembled virt platform places the GPU in slot 7 at 0x10008000.
    // LUI t0,0x10008; LW a0,256(t0) reads GPU events_read; JAL zero,0.
    let words = [0x1000_82b7u32, 0x1002_a503, 0x0000_006f];
    let kernel: Vec<u8> = words.iter().flat_map(|word| word.to_le_bytes()).collect();
    let vm = WasmLinux::new(
        16,
        &kernel,
        &[],
        String::new(),
        js_sys::Function::new_no_args(""),
        false,
    )
    .unwrap();
    assert_eq!(vm.inner.borrow().machine.virtio_gpu().unwrap().0, 7);
    assert!(vm.set_display(1371.into(), 903.into()).unwrap());
    let mut trace = wasm_vm_core::trace::VecSink::new();
    vm.inner.borrow_mut().machine.run_traced(2, &mut trace);
    assert_eq!(trace.records.len(), 2);
    assert_eq!(trace.records[0].insn, words[0]);
    assert_eq!(trace.records[1].insn, words[1]);
    assert_eq!(trace.records[1].rd, Some((10, 1)));
    assert_eq!(trace.records[1].mem.unwrap().addr, 0x1000_8100);
    wasm_bindgen_test::console_log!(
        "E5-T22a guest event trace:\n{}state digest={}",
        trace.canonical(),
        vm.state_digest().unwrap()
    );
}

#[wasm_bindgen_test]
fn display_reset_guest_trace_preserves_monitor_and_releases_resources() {
    // LUI t0,0x10008; SW zero,112(t0) resets device status; LW a0,256(t0).
    let words = [0x1000_82b7u32, 0x0602_a823, 0x1002_a503, 0x0000_006f];
    let kernel: Vec<u8> = words.iter().flat_map(|word| word.to_le_bytes()).collect();
    for (width, height) in [(1, 1), (4095, 4095), (901, 701)] {
        let vm = WasmLinux::new(
            16,
            &kernel,
            &[],
            String::new(),
            js_sys::Function::new_no_args(""),
            false,
        )
        .unwrap();
        assert!(vm.set_display(width.into(), height.into()).unwrap());
        let (_, gpu) = vm.inner.borrow().machine.virtio_gpu().unwrap();
        gpu.borrow_mut()
            .resources
            .create(17, FORMAT_B8G8R8A8_UNORM, 7, 5)
            .unwrap();
        gpu.borrow_mut().scanout_resource = Some(17);
        let edid = js_sys::Uint8Array::new(&field(&vm.display_stats().unwrap(), "edid")).to_vec();
        let mut trace = wasm_vm_core::trace::VecSink::new();
        vm.inner.borrow_mut().machine.run_traced(3, &mut trace);
        assert_eq!(trace.records.len(), 3);
        assert_eq!(trace.records[1].insn, words[1]);
        assert_eq!(trace.records[1].mem.unwrap().addr, 0x1000_8070);
        assert_eq!(trace.records[2].rd, Some((10, 0)));
        let stats = vm.display_stats().unwrap();
        assert_eq!(number(&stats, "advertisedWidth"), f64::from(width));
        assert_eq!(number(&stats, "advertisedHeight"), f64::from(height));
        assert_eq!(
            js_sys::Uint8Array::new(&field(&stats, "edid")).to_vec(),
            edid
        );
        assert_eq!(number(&stats, "pendingEvents"), 0.0);
        assert_eq!(number(&stats, "resourceCount"), 0.0);
        assert_eq!(number(&stats, "resourceBytes"), 0.0);
        assert!(field(&stats, "scanoutResource").is_null());
        wasm_bindgen_test::console_log!(
            "E5-T22e reset {width}x{height}:\n{}state digest={}\nstats={}",
            trace.canonical(),
            vm.state_digest().unwrap(),
            stats_json(&vm)
        );
    }
}
