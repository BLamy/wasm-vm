use wasm_vm_core::dev::virtio::snd::{
    CAPTURE_STREAM_ID, PcmParams, PcmState, SndSnapshotError, SndState, VIRTIO_SND_PCM_RATE_44100,
    VIRTIO_SND_PCM_RATE_48000, VIRTIO_SND_R_PCM_PREPARE, VIRTIO_SND_R_PCM_START, VIRTIO_SND_S_OK,
};

const PLAYBACK_COUNT: usize = 104;
const PLAYBACK_BYTES: usize = 108;
const CAPTURE_COUNT: usize = 144;
const CAPTURE_BYTES: usize = 148;

fn status(response: &[u8]) -> u32 {
    u32::from_le_bytes(response[..4].try_into().unwrap())
}

fn lifecycle(code: u32, stream_id: u32) -> [u8; 8] {
    let mut request = [0; 8];
    request[..4].copy_from_slice(&code.to_le_bytes());
    request[4..].copy_from_slice(&stream_id.to_le_bytes());
    request
}

fn configure(state: &mut SndState, stream_id: u32, rate: u8, running: bool) -> PcmParams {
    let params = PcmParams {
        stream_id,
        channels: if stream_id == CAPTURE_STREAM_ID { 1 } else { 2 },
        rate,
        ..PcmParams::default()
    };
    assert_eq!(
        status(&state.handle_control(&params.to_bytes())),
        VIRTIO_SND_S_OK
    );
    assert_eq!(
        status(&state.handle_control(&lifecycle(VIRTIO_SND_R_PCM_PREPARE, stream_id))),
        VIRTIO_SND_S_OK
    );
    if running {
        assert_eq!(
            status(&state.handle_control(&lifecycle(VIRTIO_SND_R_PCM_START, stream_id))),
            VIRTIO_SND_S_OK
        );
    }
    params
}

fn distinctive_target() -> SndState {
    let mut target = SndState::new();
    assert!(target.set_output_sample_rate(44_100));
    target.set_capture_enabled(true);
    configure(&mut target, 0, VIRTIO_SND_PCM_RATE_44100, true);
    configure(
        &mut target,
        CAPTURE_STREAM_ID,
        VIRTIO_SND_PCM_RATE_48000,
        true,
    );
    target
}

fn require_atomic_refusal(payload: &[u8], stream: u32) {
    let mut target = distinctive_target();
    let before = target.to_snapshot().unwrap();
    assert_eq!(
        target.restore_snapshot(payload),
        Err(SndSnapshotError::InvalidPendingMetadata { stream })
    );
    assert_eq!(target.to_snapshot().unwrap(), before);
}

fn main() {
    let mut source = SndState::new();
    source.set_capture_enabled(true);
    let output = configure(&mut source, 0, VIRTIO_SND_PCM_RATE_48000, false);
    let capture = configure(
        &mut source,
        CAPTURE_STREAM_ID,
        VIRTIO_SND_PCM_RATE_48000,
        false,
    );
    assert_eq!(source.stream.state(), PcmState::Prepared);
    assert_eq!(source.capture_stream_state(), PcmState::Prepared);
    let good = source.to_snapshot().unwrap();

    let mut output_short = good.clone();
    output_short[PLAYBACK_COUNT..PLAYBACK_COUNT + 4].copy_from_slice(&2u32.to_le_bytes());
    output_short[PLAYBACK_BYTES..PLAYBACK_BYTES + 4]
        .copy_from_slice(&output.period_bytes.to_le_bytes());
    require_atomic_refusal(&output_short, 0);

    let mut capture_short = good;
    capture_short[CAPTURE_COUNT..CAPTURE_COUNT + 4].copy_from_slice(&2u32.to_le_bytes());
    capture_short[CAPTURE_BYTES..CAPTURE_BYTES + 4]
        .copy_from_slice(&capture.period_bytes.to_le_bytes());
    require_atomic_refusal(&capture_short, CAPTURE_STREAM_ID);

    println!(
        "RESULT pass mutation_family=count_two_bytes_one_period directions=2 atomic_refusals=2"
    );
}
