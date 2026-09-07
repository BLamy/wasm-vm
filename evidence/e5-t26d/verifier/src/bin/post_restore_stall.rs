use wasm_vm_core::dev::virtio::mmio::QueueState;
use wasm_vm_core::dev::virtio::queue::Virtqueue;
use wasm_vm_core::dev::virtio::snd::{
    ManualAudioClock, NullSink, PcmParams, SndSnapshotError, SndState, VIRTIO_SND_R_PCM_PREPARE,
    VIRTIO_SND_R_PCM_START, VIRTIO_SND_S_OK,
};
use wasm_vm_core::mmio::SystemBus;
use wasm_vm_core::platform::virt::DRAM_BASE;
use wasm_vm_core::ram::Ram;

const HEADER_LEN: usize = 184;
const EVENT_COUNT: usize = 164;

fn status(response: &[u8]) -> u32 {
    u32::from_le_bytes(response[..4].try_into().unwrap())
}

fn lifecycle(code: u32) -> [u8; 8] {
    let mut request = [0; 8];
    request[..4].copy_from_slice(&code.to_le_bytes());
    request
}

fn running_state() -> SndState {
    let mut state = SndState::new();
    assert_eq!(
        status(&state.handle_control(&PcmParams::default().to_bytes())),
        VIRTIO_SND_S_OK
    );
    assert_eq!(
        status(&state.handle_control(&lifecycle(VIRTIO_SND_R_PCM_PREPARE))),
        VIRTIO_SND_S_OK
    );
    assert_eq!(
        status(&state.handle_control(&lifecycle(VIRTIO_SND_R_PCM_START))),
        VIRTIO_SND_S_OK
    );
    state
}

fn main() {
    let pristine = SndState::new().to_snapshot().unwrap();
    assert_eq!(pristine.len(), HEADER_LEN);
    for length in 0..HEADER_LEN {
        let mut target = running_state();
        let before = target.to_snapshot().unwrap();
        assert_eq!(
            target.restore_snapshot(&pristine[..length]),
            Err(SndSnapshotError::Truncated),
            "strict prefix {length}"
        );
        assert_eq!(
            target.to_snapshot().unwrap(),
            before,
            "prefix mutation {length}"
        );
    }

    let mut excessive_events = pristine.clone();
    excessive_events[EVENT_COUNT..EVENT_COUNT + 4].copy_from_slice(&257u32.to_le_bytes());
    let mut target = running_state();
    let before = target.to_snapshot().unwrap();
    assert_eq!(
        target.restore_snapshot(&excessive_events),
        Err(SndSnapshotError::TooManyEvents {
            found: 257,
            maximum: 256,
        })
    );
    assert_eq!(target.to_snapshot().unwrap(), before);

    let payload = running_state().to_snapshot().unwrap();
    let mut restored = SndState::new();
    assert_eq!(restored.restore_snapshot(&payload).unwrap().xrun_events, 1);
    let queue_state = QueueState {
        num: 8,
        ready: true,
        desc: DRAM_BASE,
        driver: DRAM_BASE + 0x400,
        device: DRAM_BASE + 0x800,
    };
    let mut queue = Virtqueue::new(&queue_state, 256).unwrap();
    let mut bus = SystemBus::new(Ram::new(0x2000).unwrap());
    let clock = ManualAudioClock::new();
    let mut sink = NullSink::new();
    assert_eq!(
        restored
            .service_playback(&mut queue, &mut bus, &clock, &mut sink)
            .unwrap()
            .xrun_events,
        0
    );
    clock.set_now_ns(500_000_000);
    let report = restored
        .service_playback(&mut queue, &mut bus, &clock, &mut sink)
        .unwrap();
    assert_eq!(report.xrun_events, 23);
    assert_eq!(restored.pending_event_count(), 24);
    assert_eq!(restored.playback_pending_count(), 0);
    assert_eq!(restored.dropped_xrun_events(), 0);

    println!(
        "RESULT pass strict_prefixes=184 direct_event_cap=257 stall_ns=500000000 elapsed_xruns=23 pending_events=24"
    );
}
