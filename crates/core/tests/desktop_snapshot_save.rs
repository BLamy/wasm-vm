//! E5-T26f verifier coverage for the machine-level desktop snapshot save boundary.
//!
//! These tests deliberately exercise the refusal branches that the browser happy path cannot
//! reach: each required desktop participant can be absent, and a malformed live GPU shadow must
//! be rejected instead of producing an envelope that cannot be restored.

use std::boxed::Box;

use wasm_vm_core::Machine;
use wasm_vm_core::desktop_snapshot::{DesktopSnapshotSaveError, section};
use wasm_vm_core::dev::virtio::gpu::NullSink;

fn base_machine() -> Machine {
    let mut machine = Machine::new(16 * 1024 * 1024);
    machine.enable_plic();
    machine.enable_virtio_slots(None);
    machine
}

fn machine_with_gpu() -> (
    Machine,
    std::rc::Rc<std::cell::RefCell<wasm_vm_core::dev::virtio::gpu::GpuState>>,
) {
    let mut machine = base_machine();
    machine.enable_virtio_keyboard();
    machine.enable_virtio_snd();
    let (_, gpu) = machine
        .enable_virtio_gpu(Box::new(NullSink))
        .expect("GPU slot is available");
    (machine, gpu)
}

#[test]
fn save_reports_each_missing_desktop_participant() {
    let mut missing_gpu = base_machine();
    missing_gpu.enable_virtio_keyboard();
    missing_gpu.enable_virtio_snd();
    missing_gpu.enable_virtio_console_at(8);
    assert_eq!(
        missing_gpu.save_desktop_snapshot(),
        Err(DesktopSnapshotSaveError::MissingComponent { tag: section::GPU })
    );

    let mut missing_input = base_machine();
    missing_input.enable_virtio_snd();
    missing_input
        .enable_virtio_gpu(Box::new(NullSink))
        .expect("GPU slot is available");
    missing_input.enable_virtio_console_at(8);
    assert_eq!(
        missing_input.save_desktop_snapshot(),
        Err(DesktopSnapshotSaveError::MissingComponent {
            tag: section::INPUT
        })
    );

    let mut missing_sound = base_machine();
    missing_sound.enable_virtio_keyboard();
    missing_sound
        .enable_virtio_gpu(Box::new(NullSink))
        .expect("GPU slot is available");
    missing_sound.enable_virtio_console_at(8);
    assert_eq!(
        missing_sound.save_desktop_snapshot(),
        Err(DesktopSnapshotSaveError::MissingComponent {
            tag: section::SOUND
        })
    );

    let mut missing_agent = base_machine();
    missing_agent.enable_virtio_keyboard();
    missing_agent.enable_virtio_snd();
    missing_agent
        .enable_virtio_gpu(Box::new(NullSink))
        .expect("GPU slot is available");
    assert_eq!(
        missing_agent.save_desktop_snapshot(),
        Err(DesktopSnapshotSaveError::MissingComponent {
            tag: section::AGENT
        })
    );
}

#[test]
fn save_refuses_a_malformed_live_input_component() {
    let (mut machine, _gpu) = machine_with_gpu();
    machine.enable_virtio_console_at(8);
    let keyboard = machine.keyboard_input().expect("keyboard is assembled");
    keyboard.borrow_mut().set_pending_event_budget(1 << 21);

    assert_eq!(
        machine.save_desktop_snapshot(),
        Err(DesktopSnapshotSaveError::ComponentRefused {
            tag: section::INPUT
        })
    );
}
