#![cfg(test)]

use std::cell::RefCell;
use std::rc::Rc;

use wasm_vm_core::Machine;
use wasm_vm_core::desktop_restore::{
    DesktopRestoreCoordinator, DisplaySize, VirtioDesktopRestoreBackend,
};
use wasm_vm_core::desktop_snapshot::{DesktopSnapshotBuilder, FORMAT_VERSION, section};
use wasm_vm_core::dev::virtio::gpu::{FrameSink, Rect, VirtioGpu, protocol};
use wasm_vm_core::dev::virtio::input::{InputDeviceSpec, VirtioInput};
use wasm_vm_core::dev::virtio::snd::VirtioSnd;

#[derive(Debug, Default)]
struct SinkState {
    retained_frames: usize,
    clears: usize,
}

struct DirtySink(Rc<RefCell<SinkState>>);

impl FrameSink for DirtySink {
    fn flush(
        &mut self,
        _scanout: Option<u32>,
        _format: u32,
        _rect: Rect,
        _resource_width: u32,
        _resource_height: u32,
        _pixels: &[u32],
    ) {
        self.0.borrow_mut().retained_frames += 1;
    }

    fn clear(&mut self) {
        let mut state = self.0.borrow_mut();
        state.retained_frames = 0;
        state.clears += 1;
    }
}

fn composite_snapshot() -> Vec<u8> {
    let (_, gpu) = VirtioGpu::new_with_state();
    {
        let mut state = gpu.borrow_mut();
        state.set_display(1280, 720);
        let resource = state
            .resources
            .create(7, protocol::FORMAT_R8G8B8A8_UNORM, 4, 2)
            .unwrap();
        resource.host_pixels.fill(0xff00_aa55);
        state.scanout_resource = Some(7);
    }
    let gpu = gpu.borrow().to_snapshot().unwrap();
    let (_, input) = VirtioInput::new_with_state(InputDeviceSpec::default());
    let input = input.borrow().to_snapshot().unwrap();
    let (_, sound) = VirtioSnd::new_with_state();
    let sound = sound.borrow().to_snapshot().unwrap();
    let mut builder = DesktopSnapshotBuilder::new(0x26e0_0004);
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
    builder.finish().unwrap()
}

#[test]
fn missing_production_agent_must_clear_preexisting_host_frame() {
    let shared = Rc::new(RefCell::new(SinkState {
        retained_frames: 1,
        clears: 0,
    }));
    let mut machine = Machine::new(16 * 1024 * 1024);
    machine.enable_plic();
    machine.enable_virtio_slots(None);
    machine.enable_virtio_keyboard();
    machine.enable_virtio_snd();
    machine
        .enable_virtio_gpu(Box::new(DirtySink(Rc::clone(&shared))))
        .unwrap();
    assert!(machine.virtio_console().is_none());

    let error = machine
        .restore_desktop_snapshot(&composite_snapshot(), DisplaySize::new(1024, 768))
        .unwrap_err();
    eprintln!(
        "EARLY_AGENT_REFUSAL code={} sink={:?} host={:?}",
        error.code(),
        shared.borrow(),
        machine.desktop_restore_host_state(),
    );
    assert_eq!(error.code(), "commit_refused");
    assert_eq!(machine.desktop_restore_host_state(), Default::default());
    assert_eq!(
        shared.borrow().retained_frames,
        0,
        "cold fallback left a stale host frame"
    );
    assert!(
        shared.borrow().clears > 0,
        "cold fallback never called FrameSink::clear"
    );
}

#[test]
fn staged_agent_drop_uses_the_cold_fallback() {
    let shared = Rc::new(RefCell::new(SinkState {
        retained_frames: 1,
        clears: 0,
    }));
    let (_, gpu) = VirtioGpu::new_with_sink_state(Box::new(DirtySink(Rc::clone(&shared))));
    let (_, input) = VirtioInput::new_with_state(InputDeviceSpec::default());
    let (_, sound) = VirtioSnd::new_with_state();
    let mut backend = VirtioDesktopRestoreBackend::new(gpu, input, sound).unwrap();
    backend.set_agent_available(false);

    let error = DesktopRestoreCoordinator::new()
        .restore(
            &composite_snapshot(),
            DisplaySize::new(1024, 768),
            &mut backend,
        )
        .unwrap_err();
    eprintln!(
        "STAGED_AGENT_REFUSAL code={} sink={:?} host={:?}",
        error.code(),
        shared.borrow(),
        backend.host_state(),
    );
    assert_eq!(shared.borrow().retained_frames, 0);
    assert!(shared.borrow().clears > 0);
    assert_eq!(backend.host_state(), Default::default());
}
