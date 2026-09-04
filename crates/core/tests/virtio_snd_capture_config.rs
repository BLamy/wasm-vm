//! E5-T21b: creation-time virtio-snd capture advertisement and configuration truth.

use std::cell::RefCell;
use std::rc::Rc;

use wasm_vm_core::Machine;
use wasm_vm_core::block::MemBackend;
use wasm_vm_core::bus::Bus;
use wasm_vm_core::dev::virtio::input::pointer::FIRST_FREE_VIRTIO_SLOT;
use wasm_vm_core::dev::virtio::net::LoopbackBackend;
use wasm_vm_core::dev::virtio::snd::{
    self, AudioSink, AudioSinkError, PcmInfo, PcmParams, PcmState, QueryInfo,
    SUPPORTED_CAPTURE_PCM_RATE_MASK, SUPPORTED_PCM_RATE_MASK, SndState, VIRTIO_SND_D_INPUT,
    VIRTIO_SND_D_OUTPUT, VIRTIO_SND_PCM_FMT_S16, VIRTIO_SND_PCM_RATE_44100, VIRTIO_SND_R_PCM_INFO,
    VIRTIO_SND_S_BAD_MSG, VIRTIO_SND_S_OK,
};
use wasm_vm_core::mmio::{MmioDevice, Width};
use wasm_vm_core::platform::Platform;

const RAM_BYTES: usize = 8 * 1024 * 1024;

#[derive(Debug, Default)]
struct NoopSink;

impl AudioSink for NoopSink {
    fn push(&mut self, _frames: &[i16], _sample_rate_hz: u32) -> Result<(), AudioSinkError> {
        Ok(())
    }
}

struct Rig {
    machine: Machine,
    slot: Rc<RefCell<wasm_vm_core::dev::virtio::mmio::VirtioMmio>>,
    state: Rc<RefCell<SndState>>,
}

impl Rig {
    fn new(enable_mic: bool) -> Self {
        let mut machine = Machine::new(RAM_BYTES);
        machine.enable_clint(10);
        machine.enable_plic();
        let _ = machine.enable_virtio_blk(Box::new(MemBackend::new(vec![0u8; 512 * 64])));
        let _ = machine.enable_virtio_net(Box::new(LoopbackBackend::new()));
        let _ = machine.enable_virtio_keyboard();
        let _ = machine.enable_virtio_pointer();

        let (slot, state) = machine.enable_virtio_snd_with_audio_and_capture(
            Rc::new(snd::ManualAudioClock::new()),
            Box::new(NoopSink),
            enable_mic,
        );
        let (slot_index, state_again) = machine.virtio_snd().expect("sound was attached");
        assert_eq!(slot_index, snd::VIRTIO_SND_SLOT);
        assert!(Rc::ptr_eq(&state, &state_again));
        assert_eq!(slot.borrow().device_id(), snd::VIRTIO_SND_DEVICE_ID);

        Self {
            machine,
            slot,
            state,
        }
    }

    fn config_stream_count(&mut self) -> u32 {
        self.slot
            .borrow_mut()
            .read(0x100 + 4, Width::B4)
            .expect("sound config read") as u32
    }

    fn control(&mut self, request: &[u8]) -> Vec<u8> {
        self.state.borrow_mut().handle_control(request)
    }
}

fn status(response: &[u8]) -> u32 {
    u32::from_le_bytes(response[..4].try_into().expect("status header"))
}

fn query(start_id: u32, count: u32, size: u32) -> [u8; snd::QUERY_INFO_SIZE] {
    QueryInfo {
        code: VIRTIO_SND_R_PCM_INFO,
        start_id,
        count,
        size,
    }
    .to_bytes()
}

fn info_payload(response: &[u8], index: usize) -> &[u8] {
    let start = 4 + index * snd::PCM_INFO_SIZE;
    &response[start..start + snd::PCM_INFO_SIZE]
}

fn assert_standard_slots(rig: &mut Rig) {
    let expected = [2, 1, 0, 18, 18, 18, snd::VIRTIO_SND_DEVICE_ID, 0];
    for (index, expected_id) in expected.into_iter().enumerate() {
        assert_eq!(
            rig.machine
                .bus_mut()
                .load32(Platform::virtio_base(index as u64) + 8),
            Ok(expected_id),
            "virtio slot {index} shifted or changed"
        );
    }
    assert_eq!(FIRST_FREE_VIRTIO_SLOT, 6);
}

#[test]
fn flag_off_keeps_playback_only_config_and_existing_slot_numbering() {
    let mut rig = Rig::new(false);
    assert_eq!(rig.config_stream_count(), snd::PCM_STREAM_COUNT);
    assert_standard_slots(&mut rig);

    let output = rig.control(&query(0, 1, snd::PCM_INFO_SIZE as u32));
    assert_eq!(status(&output), VIRTIO_SND_S_OK);
    assert_eq!(info_payload(&output, 0), &PcmInfo::output().to_bytes());
    assert_eq!(info_payload(&output, 0)[24], VIRTIO_SND_D_OUTPUT);

    assert_eq!(
        status(&rig.control(&query(1, 1, snd::PCM_INFO_SIZE as u32))),
        VIRTIO_SND_S_BAD_MSG
    );
    assert_eq!(
        status(&rig.control(&query(0, 2, snd::PCM_INFO_SIZE as u32))),
        VIRTIO_SND_S_BAD_MSG
    );

    // The existing stream still accepts both output rates when no host-rate narrowing is selected.
    let playback = PcmParams {
        rate: VIRTIO_SND_PCM_RATE_44100,
        ..PcmParams::default()
    };
    assert_eq!(status(&rig.control(&playback.to_bytes())), VIRTIO_SND_S_OK);
    assert_eq!(rig.state.borrow().stream.state(), PcmState::SetParams);
    assert!(!rig.state.borrow().capture_enabled());
}

#[test]
fn flag_on_exposes_one_fixed_input_stream_in_any_query_order() {
    let mut rig = Rig::new(true);
    assert_eq!(
        rig.config_stream_count(),
        snd::PCM_STREAM_COUNT_WITH_CAPTURE
    );
    assert_standard_slots(&mut rig);

    let input_first = rig.control(&query(1, 1, snd::PCM_INFO_SIZE as u32));
    assert_eq!(status(&input_first), VIRTIO_SND_S_OK);
    assert_eq!(info_payload(&input_first, 0), &PcmInfo::input().to_bytes());
    assert_eq!(info_payload(&input_first, 0)[24], VIRTIO_SND_D_INPUT);
    assert_eq!(info_payload(&input_first, 0)[25..27], [1, 2]);
    assert_eq!(
        u64::from_le_bytes(info_payload(&input_first, 0)[16..24].try_into().unwrap()),
        SUPPORTED_CAPTURE_PCM_RATE_MASK
    );
    assert_eq!(
        u64::from_le_bytes(info_payload(&input_first, 0)[8..16].try_into().unwrap()),
        1u64 << VIRTIO_SND_PCM_FMT_S16
    );

    let both = rig.control(&query(0, 2, snd::PCM_INFO_SIZE as u32));
    assert_eq!(status(&both), VIRTIO_SND_S_OK);
    assert_eq!(both.len(), 4 + 2 * snd::PCM_INFO_SIZE);
    assert_eq!(info_payload(&both, 0), &PcmInfo::output().to_bytes());
    assert_eq!(info_payload(&both, 1), &PcmInfo::input().to_bytes());

    let output_last = rig.control(&query(0, 1, snd::PCM_INFO_SIZE as u32));
    assert_eq!(status(&output_last), VIRTIO_SND_S_OK);
    assert_eq!(info_payload(&output_last, 0), &PcmInfo::output().to_bytes());
    assert_eq!(
        rig.state.borrow().capture_stream_state(),
        PcmState::Released
    );
    assert_eq!(rig.state.borrow().capture_stream_params(), None);
}

#[test]
fn unsupported_capture_values_and_malformed_selectors_do_not_mutate_state() {
    let mut rig = Rig::new(true);
    let before = (
        rig.state.borrow().capture_stream_state(),
        rig.state.borrow().capture_stream_params(),
        rig.state.borrow().stream.state(),
        rig.state.borrow().stream.params(),
    );

    let unsupported_rate = PcmParams {
        stream_id: snd::CAPTURE_STREAM_ID,
        rate: VIRTIO_SND_PCM_RATE_44100,
        ..PcmParams::default()
    };
    assert_eq!(
        status(&rig.control(&unsupported_rate.to_bytes())),
        VIRTIO_SND_S_BAD_MSG
    );

    let unsupported_channels = PcmParams {
        stream_id: snd::CAPTURE_STREAM_ID,
        channels: 3,
        ..PcmParams::default()
    };
    assert_eq!(
        status(&rig.control(&unsupported_channels.to_bytes())),
        VIRTIO_SND_S_BAD_MSG
    );

    for malformed in [
        query(2, 1, snd::PCM_INFO_SIZE as u32),
        query(1, 2, snd::PCM_INFO_SIZE as u32),
        query(0, 0, snd::PCM_INFO_SIZE as u32),
        query(0, 1, (snd::PCM_INFO_SIZE - 1) as u32),
    ] {
        assert_eq!(status(&rig.control(&malformed)), VIRTIO_SND_S_BAD_MSG);
    }

    let after = (
        rig.state.borrow().capture_stream_state(),
        rig.state.borrow().capture_stream_params(),
        rig.state.borrow().stream.state(),
        rig.state.borrow().stream.params(),
    );
    assert_eq!(after, before);

    // A valid mono capture request is accepted at the only advertised rate, while playback keeps
    // its independent two-rate capability.
    let valid_capture = PcmParams {
        stream_id: snd::CAPTURE_STREAM_ID,
        channels: 1,
        ..PcmParams::default()
    };
    assert_eq!(
        status(&rig.control(&valid_capture.to_bytes())),
        VIRTIO_SND_S_OK
    );
    assert_eq!(
        rig.state.borrow().capture_stream_params(),
        Some(valid_capture)
    );
    let playback_info = rig.control(&query(0, 1, snd::PCM_INFO_SIZE as u32));
    assert_eq!(
        u64::from_le_bytes(info_payload(&playback_info, 0)[16..24].try_into().unwrap()),
        SUPPORTED_PCM_RATE_MASK
    );
}

#[test]
fn reset_and_repeated_creation_preserve_the_selected_gate_without_host_capture() {
    let mut enabled = Rig::new(true);
    let input = enabled.control(&query(1, 1, snd::PCM_INFO_SIZE as u32));
    assert_eq!(status(&input), VIRTIO_SND_S_OK);
    enabled
        .slot
        .borrow_mut()
        .write(0x070, Width::B4, 0)
        .expect("device reset");
    assert_eq!(
        enabled.config_stream_count(),
        snd::PCM_STREAM_COUNT_WITH_CAPTURE
    );
    assert!(enabled.state.borrow().capture_enabled());
    assert_eq!(
        enabled.state.borrow().capture_stream_state(),
        PcmState::Released
    );
    assert_eq!(enabled.state.borrow().capture_stream_params(), None);
    let input_after_reset = enabled.control(&query(1, 1, snd::PCM_INFO_SIZE as u32));
    assert_eq!(status(&input_after_reset), VIRTIO_SND_S_OK);
    assert_eq!(
        info_payload(&input_after_reset, 0),
        &PcmInfo::input().to_bytes()
    );

    let mut disabled = Rig::new(false);
    assert_eq!(disabled.config_stream_count(), snd::PCM_STREAM_COUNT);
    assert!(!disabled.state.borrow().capture_enabled());
    assert_standard_slots(&mut disabled);

    let mut enabled_again = Rig::new(true);
    assert_eq!(
        enabled_again.config_stream_count(),
        snd::PCM_STREAM_COUNT_WITH_CAPTURE
    );
    assert!(enabled_again.state.borrow().capture_enabled());
    assert_standard_slots(&mut enabled_again);
}
