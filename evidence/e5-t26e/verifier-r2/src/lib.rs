#![cfg(test)]

use std::cell::RefCell;
use std::rc::Rc;

use wasm_vm_core::Machine;
use wasm_vm_core::desktop_restore::{
    DesktopRestoreCoordinator, DisplaySize, VirtioDesktopRestoreBackend,
};
use wasm_vm_core::desktop_snapshot::{DesktopSnapshotBuilder, FORMAT_VERSION, section};
use wasm_vm_core::dev::virtio::gpu::{FrameSink, Rect, VirtioGpu, protocol};
use wasm_vm_core::dev::virtio::input::{EV_KEY, InputDeviceSpec, VirtioInput, keyboard};
use wasm_vm_core::dev::virtio::snd::{PcmControl, PcmParams, PcmState, VirtioSnd};

#[derive(Default)]
struct SinkState {
    frames: u32,
    last_resource: Option<(u32, u32)>,
}

struct RecordingSink(Rc<RefCell<SinkState>>);

impl FrameSink for RecordingSink {
    fn flush(
        &mut self,
        _scanout: Option<u32>,
        _format: u32,
        _rect: Rect,
        resource_width: u32,
        resource_height: u32,
        _pixels: &[u32],
    ) {
        let mut state = self.0.borrow_mut();
        state.frames += 1;
        state.last_resource = Some((resource_width, resource_height));
    }
}

struct ActualSnapshot {
    blob: Vec<u8>,
    gpu: Vec<u8>,
    input: Vec<u8>,
    sound: Vec<u8>,
}

fn actual_snapshot() -> ActualSnapshot {
    let (_, source_gpu) = VirtioGpu::new_with_state();
    {
        let mut state = source_gpu.borrow_mut();
        state.set_display(1280, 720);
        let resource = state
            .resources
            .create(7, protocol::FORMAT_R8G8B8A8_UNORM, 4, 2)
            .unwrap();
        for (index, pixel) in resource.host_pixels.iter_mut().enumerate() {
            *pixel = 0x7700_0000 | index as u32;
        }
        state.scanout_resource = Some(7);
    }
    let gpu = source_gpu.borrow().to_snapshot().unwrap();

    let (_, source_input) = VirtioInput::new_with_state(keyboard::keyboard_spec());
    assert!(source_input.borrow_mut().inject_event(EV_KEY, 30, 1));
    source_input.borrow_mut().sync();
    let input = source_input.borrow().to_snapshot().unwrap();

    let (_, source_sound) = VirtioSnd::new_with_state();
    {
        let mut sound = source_sound.borrow_mut();
        assert_eq!(sound.stream.set_params(PcmParams::default()).code(), 0x8000);
        assert_eq!(sound.stream.apply(PcmControl::Prepare).code(), 0x8000);
        assert_eq!(sound.stream.apply(PcmControl::Start).code(), 0x8000);
        assert_eq!(sound.stream.state(), PcmState::Running);
    }
    let sound = source_sound.borrow().to_snapshot().unwrap();

    let mut builder = DesktopSnapshotBuilder::new(0x26e0_0002);
    builder.section(section::GPU, FORMAT_VERSION, &gpu).unwrap();
    builder
        .section(section::INPUT, FORMAT_VERSION, &input)
        .unwrap();
    builder
        .section(section::SOUND, FORMAT_VERSION, &sound)
        .unwrap();
    builder
        .section(section::AGENT, FORMAT_VERSION, &17u64.to_le_bytes())
        .unwrap();
    ActualSnapshot {
        blob: builder.finish().unwrap(),
        gpu,
        input,
        sound,
    }
}

fn envelope(gpu: &[u8], input: &[u8], sound: &[u8], agent: &[u8]) -> Vec<u8> {
    let mut builder = DesktopSnapshotBuilder::new(0x26e0_0002);
    builder.section(section::GPU, FORMAT_VERSION, gpu).unwrap();
    builder
        .section(section::INPUT, FORMAT_VERSION, input)
        .unwrap();
    builder
        .section(section::SOUND, FORMAT_VERSION, sound)
        .unwrap();
    builder
        .section(section::AGENT, FORMAT_VERSION, agent)
        .unwrap();
    builder.finish().unwrap()
}

#[test]
fn production_machine_reports_agent_handshake_without_an_agent_device() {
    let snapshot = actual_snapshot();
    let sink = Rc::new(RefCell::new(SinkState::default()));
    let mut machine = Machine::new(16 * 1024 * 1024);
    machine.enable_plic();
    machine.enable_virtio_slots(None);
    let (_, input, _) = machine.enable_virtio_keyboard();
    let (_, sound) = machine.enable_virtio_snd();
    machine
        .enable_virtio_gpu(Box::new(RecordingSink(Rc::clone(&sink))))
        .unwrap();

    assert!(machine.virtio_console().is_none());
    let report = machine
        .restore_desktop_snapshot(&snapshot.blob, DisplaySize::new(1024, 768))
        .expect("production composition accepted a complete snapshot");

    eprintln!(
        "PRODUCTION_WITHOUT_AGENT ok={} agent_rehandshake={} viewport={:?} frames={} input_pending={} sound_state={:?} sound_xruns={}",
        true,
        report.agent_rehandshake,
        report.viewport,
        sink.borrow().frames,
        input.borrow().pending_events(),
        sound.borrow().stream.state(),
        report.sound_xrun_events,
    );
    assert!(report.agent_rehandshake);
    assert!(machine.virtio_console().is_none());
    assert_eq!(input.borrow().to_snapshot().unwrap(), snapshot.input);
    assert_eq!(sound.borrow().stream.state(), PcmState::Running);
    assert_eq!(report.sound_xrun_events, 1);
}

#[test]
fn post_gpu_commit_failure_leaves_a_stale_host_frame_after_cold_fallback() {
    let snapshot = actual_snapshot();
    let sink = Rc::new(RefCell::new(SinkState::default()));
    let (_, gpu) = VirtioGpu::new_with_sink_state(Box::new(RecordingSink(Rc::clone(&sink))));
    let (_, input) = VirtioInput::new_with_state(InputDeviceSpec::default());
    let (_, sound) = VirtioSnd::new_with_state();
    let cold_gpu = gpu.borrow().to_snapshot().unwrap();
    let cold_input = input.borrow().to_snapshot().unwrap();
    let cold_sound = sound.borrow().to_snapshot().unwrap();

    let mut backend =
        VirtioDesktopRestoreBackend::new(Rc::clone(&gpu), Rc::clone(&input), Rc::clone(&sound))
            .unwrap();
    backend.set_fail_commit_after_gpu(true);
    let error = DesktopRestoreCoordinator::new()
        .restore(&snapshot.blob, DisplaySize::new(1280, 720), &mut backend)
        .unwrap_err();

    eprintln!(
        "POST_GPU_FAILURE code={} frames={} last_resource={:?} gpu_cold={} input_cold={} sound_cold={} host={:?}",
        error.code(),
        sink.borrow().frames,
        sink.borrow().last_resource,
        gpu.borrow().to_snapshot().unwrap() == cold_gpu,
        input.borrow().to_snapshot().unwrap() == cold_input,
        sound.borrow().to_snapshot().unwrap() == cold_sound,
        backend.host_state(),
    );
    assert_eq!(error.code(), "commit_refused");
    assert_eq!(gpu.borrow().to_snapshot().unwrap(), cold_gpu);
    assert_eq!(input.borrow().to_snapshot().unwrap(), cold_input);
    assert_eq!(sound.borrow().to_snapshot().unwrap(), cold_sound);
    assert_eq!(sink.borrow().frames, 1, "restored frame was never cleared");
    assert_eq!(sink.borrow().last_resource, Some((4, 2)));
}

#[test]
fn dirty_constructor_baseline_is_not_a_cold_boot_baseline() {
    let snapshot = actual_snapshot();
    let (_, gpu) = VirtioGpu::new_with_state();
    {
        let mut state = gpu.borrow_mut();
        state.set_display(640, 480);
        let resource = state
            .resources
            .create(99, protocol::FORMAT_R8G8B8A8_UNORM, 1, 1)
            .unwrap();
        resource.host_pixels[0] = 0xdead_beef;
        state.scanout_resource = Some(99);
    }
    let (_, input) = VirtioInput::new_with_state(InputDeviceSpec::default());
    let (_, sound) = VirtioSnd::new_with_state();
    let dirty_gpu = gpu.borrow().to_snapshot().unwrap();

    let mut backend =
        VirtioDesktopRestoreBackend::new(Rc::clone(&gpu), Rc::clone(&input), Rc::clone(&sound))
            .unwrap();
    backend.set_fail_commit_after_gpu(true);
    let _ = DesktopRestoreCoordinator::new().restore(
        &snapshot.blob,
        DisplaySize::new(1280, 720),
        &mut backend,
    );

    eprintln!(
        "DIRTY_FALLBACK scanout={:?} display={:?} equals_dirty={}",
        gpu.borrow().scanout_resource,
        gpu.borrow().display_size(),
        gpu.borrow().to_snapshot().unwrap() == dirty_gpu,
    );
    assert_eq!(gpu.borrow().to_snapshot().unwrap(), dirty_gpu);
    assert_eq!(gpu.borrow().scanout_resource, Some(99));
}

#[test]
fn concrete_backend_rejects_forward_and_trailing_component_payloads() {
    let snapshot = actual_snapshot();
    for (name, index) in [("gpu", 0usize), ("input", 1), ("sound", 2)] {
        for mutation in ["forward", "trailing"] {
            let mut payloads = [
                snapshot.gpu.clone(),
                snapshot.input.clone(),
                snapshot.sound.clone(),
            ];
            if mutation == "forward" {
                payloads[index][8..10].copy_from_slice(&2u16.to_le_bytes());
            } else {
                payloads[index].push(0xa5);
            }
            let blob = envelope(
                &payloads[0],
                &payloads[1],
                &payloads[2],
                &17u64.to_le_bytes(),
            );
            let (_, gpu) = VirtioGpu::new_with_state();
            let (_, input) = VirtioInput::new_with_state(InputDeviceSpec::default());
            let (_, sound) = VirtioSnd::new_with_state();
            let cold_gpu = gpu.borrow().to_snapshot().unwrap();
            let cold_input = input.borrow().to_snapshot().unwrap();
            let cold_sound = sound.borrow().to_snapshot().unwrap();
            let mut backend = VirtioDesktopRestoreBackend::new(
                Rc::clone(&gpu),
                Rc::clone(&input),
                Rc::clone(&sound),
            )
            .unwrap();
            let result = DesktopRestoreCoordinator::new().restore(
                &blob,
                DisplaySize::new(1280, 720),
                &mut backend,
            );
            eprintln!(
                "COMPONENT_ATTACK component={name} mutation={mutation} error={}",
                result.unwrap_err().code()
            );
            assert_eq!(gpu.borrow().to_snapshot().unwrap(), cold_gpu);
            assert_eq!(input.borrow().to_snapshot().unwrap(), cold_input);
            assert_eq!(sound.borrow().to_snapshot().unwrap(), cold_sound);
        }
    }
}

#[test]
fn production_composition_missing_device_branches_are_typed() {
    let snapshot = actual_snapshot();

    let mut no_gpu = Machine::new(16 * 1024 * 1024);
    assert_eq!(
        no_gpu
            .restore_desktop_snapshot(&snapshot.blob, DisplaySize::new(1280, 720))
            .unwrap_err()
            .code(),
        "commit_refused"
    );

    let mut no_input = Machine::new(16 * 1024 * 1024);
    no_input.enable_plic();
    no_input.enable_virtio_slots(None);
    no_input.enable_virtio_gpu(Box::new(wasm_vm_core::dev::virtio::gpu::NullSink));
    assert_eq!(
        no_input
            .restore_desktop_snapshot(&snapshot.blob, DisplaySize::new(1280, 720))
            .unwrap_err()
            .code(),
        "commit_refused"
    );

    let mut no_sound = Machine::new(16 * 1024 * 1024);
    no_sound.enable_plic();
    no_sound.enable_virtio_slots(None);
    no_sound.enable_virtio_keyboard();
    no_sound.enable_virtio_gpu(Box::new(wasm_vm_core::dev::virtio::gpu::NullSink));
    assert_eq!(
        no_sound
            .restore_desktop_snapshot(&snapshot.blob, DisplaySize::new(1280, 720))
            .unwrap_err()
            .code(),
        "commit_refused"
    );
}
