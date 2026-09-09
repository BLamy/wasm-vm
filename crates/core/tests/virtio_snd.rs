//! E5-T19a: virtio-snd identity, control responses, parameter validation, and transition oracle.

use wasm_vm_core::dev::virtio::VirtioDevice;
use wasm_vm_core::dev::virtio::snd::{
    CHMAP_INFO_SIZE, ChmapInfo, JACK_INFO_SIZE, JackInfo, PCM_CONTROL_COUNT, PCM_INFO_SIZE,
    PCM_SET_PARAMS_SIZE, PCM_STATE_COUNT, PCM_TRANSITION_ORACLE, PcmControl, PcmInfo, PcmParams,
    PcmState, QueryInfo, TRANSITION_ORACLE, VIRTIO_SND_CHMAP_FL, VIRTIO_SND_CHMAP_FR,
    VIRTIO_SND_D_OUTPUT, VIRTIO_SND_PCM_F_EVT_XRUNS, VIRTIO_SND_PCM_FMT_S16,
    VIRTIO_SND_PCM_RATE_44100, VIRTIO_SND_PCM_RATE_48000, VIRTIO_SND_PCM_RATE_96000,
    VIRTIO_SND_R_CHMAP_INFO, VIRTIO_SND_R_JACK_INFO, VIRTIO_SND_R_JACK_REMAP,
    VIRTIO_SND_R_PCM_INFO, VIRTIO_SND_R_PCM_PREPARE, VIRTIO_SND_R_PCM_RELEASE,
    VIRTIO_SND_R_PCM_START, VIRTIO_SND_R_PCM_STOP, VIRTIO_SND_S_BAD_MSG, VIRTIO_SND_S_NOT_SUPP,
    VIRTIO_SND_S_OK, VirtioSnd, new, transition,
};

const EXPECTED_JACK_INFO: [u8; JACK_INFO_SIZE] = [
    0, 0, 0, 0, // hda_fn_nid
    0, 0, 0, 0, // features
    0, 0, 0, 0, // hda_reg_defconf
    0, 0, 0, 0, // hda_reg_caps
    1, 0, 0, 0, 0, 0, 0, 0, // connected + reserved
];

const EXPECTED_PCM_INFO: [u8; PCM_INFO_SIZE] = [
    0, 0, 0, 0, // hda_fn_nid
    0x10, 0, 0, 0, // features: VIRTIO_SND_PCM_F_EVT_XRUNS
    0x20, 0, 0, 0, 0, 0, 0, 0, // formats: S16
    0xc0, 0, 0, 0, 0, 0, 0, 0, // rates: 44.1 kHz + 48 kHz
    0, 2, 2, 0, 0, 0, 0, 0, // direction, channel range, reserved
];

const EXPECTED_CHMAP_INFO: [u8; CHMAP_INFO_SIZE] = [
    0, 0, 0, 0, // hda_fn_nid
    0, 2, 3, 4, // direction, channels, FL, FR
    0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, // reserved positions
];

fn status(response: &[u8]) -> u32 {
    u32::from_le_bytes(response[..4].try_into().unwrap())
}

fn pcm_command(code: u32) -> [u8; 8] {
    let mut out = [0u8; 8];
    out[..4].copy_from_slice(&code.to_le_bytes());
    out
}

fn query(code: u32, size: usize) -> [u8; 16] {
    QueryInfo {
        code,
        start_id: 0,
        count: 1,
        size: size as u32,
    }
    .to_bytes()
}

fn configured_device(target: PcmState) -> VirtioSnd {
    let mut device = VirtioSnd::new();
    assert_eq!(
        status(&device.handle_control(&PcmParams::default().to_bytes())),
        VIRTIO_SND_S_OK
    );
    if target != PcmState::SetParams {
        assert_eq!(
            status(&device.handle_control(&pcm_command(VIRTIO_SND_R_PCM_PREPARE))),
            VIRTIO_SND_S_OK
        );
    }
    if matches!(target, PcmState::Running | PcmState::Stopped) {
        assert_eq!(
            status(&device.handle_control(&pcm_command(VIRTIO_SND_R_PCM_START))),
            VIRTIO_SND_S_OK
        );
    }
    if target == PcmState::Stopped {
        assert_eq!(
            status(&device.handle_control(&pcm_command(VIRTIO_SND_R_PCM_STOP))),
            VIRTIO_SND_S_OK
        );
    }
    if target == PcmState::Released {
        assert_eq!(
            status(&device.handle_control(&pcm_command(VIRTIO_SND_R_PCM_RELEASE))),
            VIRTIO_SND_S_OK
        );
    }
    assert_eq!(device.stream_state(), target);
    device
}

#[test]
fn exhaustive_six_request_five_state_oracle_is_stable() {
    let states = [
        PcmState::Released,
        PcmState::SetParams,
        PcmState::Prepared,
        PcmState::Running,
        PcmState::Stopped,
    ];
    let requests = [
        PcmControl::Info,
        PcmControl::SetParams,
        PcmControl::Prepare,
        PcmControl::Start,
        PcmControl::Stop,
        PcmControl::Release,
    ];
    // Independently transcribed from OASIS Virtio 1.3 §5.14.6.6.1 (not the exported
    // implementation oracle). RELEASE is the configured state; power-on is tested separately.
    // https://docs.oasis-open.org/virtio/virtio/v1.3/virtio-v1.3.html
    let expected = [
        [
            VIRTIO_SND_S_OK,
            VIRTIO_SND_S_OK,
            VIRTIO_SND_S_OK,
            VIRTIO_SND_S_BAD_MSG,
            VIRTIO_SND_S_BAD_MSG,
            VIRTIO_SND_S_BAD_MSG,
        ],
        [
            VIRTIO_SND_S_OK,
            VIRTIO_SND_S_OK,
            VIRTIO_SND_S_OK,
            VIRTIO_SND_S_BAD_MSG,
            VIRTIO_SND_S_BAD_MSG,
            VIRTIO_SND_S_BAD_MSG,
        ],
        [
            VIRTIO_SND_S_OK,
            VIRTIO_SND_S_OK,
            VIRTIO_SND_S_OK,
            VIRTIO_SND_S_OK,
            VIRTIO_SND_S_BAD_MSG,
            VIRTIO_SND_S_OK,
        ],
        [
            VIRTIO_SND_S_OK,
            VIRTIO_SND_S_BAD_MSG,
            VIRTIO_SND_S_BAD_MSG,
            VIRTIO_SND_S_BAD_MSG,
            VIRTIO_SND_S_OK,
            VIRTIO_SND_S_BAD_MSG,
        ],
        [
            VIRTIO_SND_S_OK,
            VIRTIO_SND_S_BAD_MSG,
            VIRTIO_SND_S_BAD_MSG,
            VIRTIO_SND_S_OK,
            VIRTIO_SND_S_BAD_MSG,
            VIRTIO_SND_S_OK,
        ],
    ];
    assert_eq!(PCM_STATE_COUNT, states.len());
    assert_eq!(PCM_CONTROL_COUNT, requests.len());
    assert_eq!(TRANSITION_ORACLE, PCM_TRANSITION_ORACLE);

    for (state_index, state) in states.into_iter().enumerate() {
        for (request_index, request) in requests.into_iter().enumerate() {
            let result = transition(state, request);
            assert_eq!(result.status.code(), expected[state_index][request_index]);
            assert_eq!(
                result.status,
                PCM_TRANSITION_ORACLE[state_index][request_index]
            );
            let expected_status = expected[state_index][request_index];
            let expected_next = if expected_status == VIRTIO_SND_S_OK {
                match request {
                    PcmControl::Info => state,
                    PcmControl::SetParams => PcmState::SetParams,
                    PcmControl::Prepare => PcmState::Prepared,
                    PcmControl::Start => PcmState::Running,
                    PcmControl::Stop => PcmState::Stopped,
                    PcmControl::Release => PcmState::Released,
                }
            } else {
                state
            };
            assert_eq!(result.next, expected_next);
            // Exercise the real request handler from a legally established state, including
            // parameter replacement and byte-for-byte non-mutation for every rejected cell.
            let mut device = configured_device(state);
            let before = device.to_snapshot().unwrap();
            let replacement = PcmParams {
                period_bytes: 1920,
                buffer_bytes: 3840,
                ..PcmParams::default()
            };
            let bytes = match request {
                PcmControl::Info => query(VIRTIO_SND_R_PCM_INFO, PCM_INFO_SIZE).to_vec(),
                PcmControl::SetParams => replacement.to_bytes().to_vec(),
                PcmControl::Prepare => pcm_command(VIRTIO_SND_R_PCM_PREPARE).to_vec(),
                PcmControl::Start => pcm_command(VIRTIO_SND_R_PCM_START).to_vec(),
                PcmControl::Stop => pcm_command(VIRTIO_SND_R_PCM_STOP).to_vec(),
                PcmControl::Release => pcm_command(VIRTIO_SND_R_PCM_RELEASE).to_vec(),
            };
            assert_eq!(
                status(&device.handle_control(&bytes)),
                expected_status,
                "{state:?} {request:?}"
            );
            assert_eq!(device.stream_state(), expected_next);
            assert_eq!(
                device.stream_params(),
                Some(
                    if request == PcmControl::SetParams && expected_status == VIRTIO_SND_S_OK {
                        replacement
                    } else {
                        PcmParams::default()
                    }
                )
            );
            if expected_status != VIRTIO_SND_S_OK || request == PcmControl::Info {
                assert_eq!(device.to_snapshot().unwrap(), before);
            }
        }
    }
}

#[test]
fn device_identity_config_and_queue_markers_are_spec_shaped() {
    let (mut device, state) = new();
    assert_eq!(device.device_id(), 25);
    assert_eq!(device.num_queues(), 4);
    assert_eq!(device.config_read(0, 4), 1);
    assert_eq!(device.config_read(4, 4), 1);
    assert_eq!(device.config_read(8, 4), 1);
    assert_eq!(device.config_read(12, 8), 0);

    device.queue_notify(0);
    device.queue_notify(3);
    assert!(state.borrow_mut().take_queue_kick(0));
    assert!(state.borrow_mut().take_queue_kick(3));
    assert!(!state.borrow_mut().take_queue_kick(4));
    device.reset();
    assert!(state.borrow_mut().take_reset_pending());
    assert_eq!(device.stream_state(), PcmState::Released);
    assert_eq!(device.stream_params(), None);
}

#[test]
fn info_queries_return_exact_one_item_capabilities_and_zero_padding() {
    let mut device = VirtioSnd::new();

    let jack = device.handle_control(&query(VIRTIO_SND_R_JACK_INFO, JACK_INFO_SIZE));
    assert_eq!(status(&jack), VIRTIO_SND_S_OK);
    assert_eq!(&jack[4..], &EXPECTED_JACK_INFO);
    assert_eq!(JackInfo::output().to_bytes(), EXPECTED_JACK_INFO);
    assert_eq!(jack.len(), 4 + JACK_INFO_SIZE);

    let pcm = device.handle_control(&query(VIRTIO_SND_R_PCM_INFO, PCM_INFO_SIZE));
    assert_eq!(status(&pcm), VIRTIO_SND_S_OK);
    assert_eq!(&pcm[4..], &EXPECTED_PCM_INFO);
    assert_eq!(PcmInfo::output().to_bytes(), EXPECTED_PCM_INFO);
    assert_eq!(PcmInfo::output().direction, VIRTIO_SND_D_OUTPUT);
    assert_eq!(PcmInfo::output().formats, 1u64 << VIRTIO_SND_PCM_FMT_S16);
    assert_eq!(
        PcmInfo::output().rates,
        (1u64 << VIRTIO_SND_PCM_RATE_44100) | (1u64 << VIRTIO_SND_PCM_RATE_48000)
    );
    assert_eq!(pcm.len(), 4 + PCM_INFO_SIZE);

    let chmap = device.handle_control(&query(VIRTIO_SND_R_CHMAP_INFO, CHMAP_INFO_SIZE));
    assert_eq!(status(&chmap), VIRTIO_SND_S_OK);
    assert_eq!(&chmap[4..], &EXPECTED_CHMAP_INFO);
    assert_eq!(ChmapInfo::output().to_bytes(), EXPECTED_CHMAP_INFO);
    assert_eq!(
        ChmapInfo::output().positions[..2],
        [VIRTIO_SND_CHMAP_FL, VIRTIO_SND_CHMAP_FR]
    );
    assert!(
        ChmapInfo::output().positions[2..]
            .iter()
            .all(|position| *position == 0)
    );
    assert_eq!(chmap.len(), 4 + CHMAP_INFO_SIZE);
}

#[test]
fn host_rate_selection_narrows_info_and_rejects_the_other_rate() {
    let (mut device, state) = new();
    assert!(state.borrow_mut().set_output_sample_rate(44_100));

    let pcm = device.handle_control(&query(VIRTIO_SND_R_PCM_INFO, PCM_INFO_SIZE));
    assert_eq!(status(&pcm), VIRTIO_SND_S_OK);
    assert_eq!(
        u64::from_le_bytes(pcm[20..28].try_into().unwrap()),
        1u64 << VIRTIO_SND_PCM_RATE_44100
    );

    let rejected = PcmParams {
        rate: VIRTIO_SND_PCM_RATE_48000,
        ..PcmParams::default()
    };
    assert_eq!(
        status(&device.handle_control(&rejected.to_bytes())),
        VIRTIO_SND_S_BAD_MSG
    );
    let accepted = PcmParams {
        rate: VIRTIO_SND_PCM_RATE_44100,
        ..PcmParams::default()
    };
    assert_eq!(
        status(&device.handle_control(&accepted.to_bytes())),
        VIRTIO_SND_S_OK
    );
    assert!(!state.borrow_mut().set_output_sample_rate(96_000));
}

#[test]
fn set_params_accepts_advertised_xrun_feature_selected_by_linux() {
    let mut device = VirtioSnd::new();
    let params = PcmParams {
        features: VIRTIO_SND_PCM_F_EVT_XRUNS,
        ..PcmParams::default()
    };
    assert_eq!(
        status(&device.handle_control(&params.to_bytes())),
        VIRTIO_SND_S_OK
    );
}

#[test]
fn malformed_and_unsupported_queries_are_deterministic_and_non_mutating() {
    let mut device = VirtioSnd::new();
    let before = device.stream_state();

    assert_eq!(status(&device.handle_control(&[])), VIRTIO_SND_S_BAD_MSG);
    assert_eq!(
        status(&device.handle_control(&[VIRTIO_SND_R_JACK_INFO as u8])),
        VIRTIO_SND_S_BAD_MSG
    );

    let mut bad_start = query(VIRTIO_SND_R_PCM_INFO, PCM_INFO_SIZE);
    bad_start[4..8].copy_from_slice(&1u32.to_le_bytes());
    assert_eq!(
        status(&device.handle_control(&bad_start)),
        VIRTIO_SND_S_BAD_MSG
    );

    let mut bad_size = query(VIRTIO_SND_R_CHMAP_INFO, CHMAP_INFO_SIZE);
    bad_size[12..16].copy_from_slice(&1u32.to_le_bytes());
    assert_eq!(
        status(&device.handle_control(&bad_size)),
        VIRTIO_SND_S_BAD_MSG
    );

    let unsupported = query(0x7fff, PCM_INFO_SIZE);
    assert_eq!(
        status(&device.handle_control(&unsupported)),
        VIRTIO_SND_S_NOT_SUPP
    );
    assert_eq!(
        status(&device.handle_control(&VIRTIO_SND_R_JACK_REMAP.to_le_bytes())),
        VIRTIO_SND_S_NOT_SUPP
    );
    assert_eq!(device.stream_state(), before);
    assert_eq!(device.stream_params(), None);
}

#[test]
fn set_params_rejects_96khz_without_poisoning_the_next_legal_setup() {
    let mut device = VirtioSnd::new();
    let rejected = PcmParams {
        rate: VIRTIO_SND_PCM_RATE_96000,
        ..PcmParams::default()
    };
    assert_eq!(rejected.to_bytes().len(), PCM_SET_PARAMS_SIZE);
    assert_eq!(
        status(&device.handle_control(&rejected.to_bytes())),
        VIRTIO_SND_S_BAD_MSG
    );
    assert_eq!(device.stream_state(), PcmState::Released);
    assert_eq!(device.stream_params(), None);

    let legal = PcmParams {
        rate: VIRTIO_SND_PCM_RATE_48000,
        ..PcmParams::default()
    };
    assert_eq!(
        status(&device.handle_control(&legal.to_bytes())),
        VIRTIO_SND_S_OK
    );
    assert_eq!(device.stream_state(), PcmState::SetParams);
    assert_eq!(device.stream_params(), Some(legal));

    assert_eq!(
        status(&device.handle_control(&pcm_command(VIRTIO_SND_R_PCM_PREPARE))),
        VIRTIO_SND_S_OK
    );
    assert_eq!(
        status(&device.handle_control(&pcm_command(VIRTIO_SND_R_PCM_START))),
        VIRTIO_SND_S_OK
    );
    assert_eq!(
        status(&device.handle_control(&pcm_command(VIRTIO_SND_R_PCM_STOP))),
        VIRTIO_SND_S_OK
    );
    assert_eq!(
        status(&device.handle_control(&pcm_command(VIRTIO_SND_R_PCM_START))),
        VIRTIO_SND_S_OK
    );
    assert_eq!(
        status(&device.handle_control(&pcm_command(VIRTIO_SND_R_PCM_STOP))),
        VIRTIO_SND_S_OK
    );
    assert_eq!(
        status(&device.handle_control(&pcm_command(VIRTIO_SND_R_PCM_RELEASE))),
        VIRTIO_SND_S_OK
    );
    assert_eq!(device.stream_state(), PcmState::Released);
    assert_eq!(device.stream_params(), Some(legal));
}

#[test]
fn invalid_params_cover_ids_sizes_alignment_features_and_caps() {
    let mut invalid = Vec::new();
    invalid.extend([
        PcmParams {
            stream_id: 1,
            ..PcmParams::default()
        },
        PcmParams {
            buffer_bytes: 0,
            ..PcmParams::default()
        },
        PcmParams {
            period_bytes: 0,
            ..PcmParams::default()
        },
        PcmParams {
            buffer_bytes: 16 * 1024,
            period_bytes: 16 * 1024 + 4,
            ..PcmParams::default()
        },
        PcmParams {
            buffer_bytes: 4098,
            ..PcmParams::default()
        },
        PcmParams {
            period_bytes: 1026,
            ..PcmParams::default()
        },
        PcmParams {
            features: 1,
            ..PcmParams::default()
        },
        PcmParams {
            channels: 1,
            ..PcmParams::default()
        },
        PcmParams {
            format: 0,
            ..PcmParams::default()
        },
        PcmParams {
            rate: 0,
            ..PcmParams::default()
        },
        PcmParams {
            padding: 1,
            ..PcmParams::default()
        },
        PcmParams {
            buffer_bytes: 16 * 1024 * 1024 + 4,
            ..PcmParams::default()
        },
    ]);

    for configured in [
        None,
        Some(PcmState::Released),
        Some(PcmState::SetParams),
        Some(PcmState::Prepared),
        Some(PcmState::Running),
        Some(PcmState::Stopped),
    ] {
        let mut device = configured.map(configured_device).unwrap_or_default();
        let before = device.to_snapshot().unwrap();
        for params in &invalid {
            assert!(!params.is_valid());
            assert_eq!(
                status(&device.handle_control(&params.to_bytes())),
                VIRTIO_SND_S_BAD_MSG
            );
            assert_eq!(
                device.to_snapshot().unwrap(),
                before,
                "{configured:?} {params:?}"
            );
        }
    }
}

#[test]
fn recovery_reset_and_disabled_capture_do_not_inherit_configuration() {
    let mut device = VirtioSnd::new();
    for reset in [false, true] {
        if reset {
            device = configured_device(PcmState::Released);
            assert_eq!(device.stream_params(), Some(PcmParams::default()));
            device.reset();
        }
        let before = device.to_snapshot().unwrap();
        assert_eq!(
            status(&device.handle_control(&pcm_command(VIRTIO_SND_R_PCM_PREPARE))),
            VIRTIO_SND_S_BAD_MSG
        );
        assert_eq!(device.stream_state(), PcmState::Released);
        assert_eq!(device.stream_params(), None);
        assert_eq!(device.to_snapshot().unwrap(), before);
    }
    device = configured_device(PcmState::Released);
    let before = device.to_snapshot().unwrap();
    for stream_id in [1u32, 2, u32::MAX] {
        for code in [
            VIRTIO_SND_R_PCM_PREPARE,
            VIRTIO_SND_R_PCM_START,
            VIRTIO_SND_R_PCM_STOP,
            VIRTIO_SND_R_PCM_RELEASE,
        ] {
            let mut request = pcm_command(code);
            request[4..].copy_from_slice(&stream_id.to_le_bytes());
            assert_eq!(
                status(&device.handle_control(&request)),
                VIRTIO_SND_S_BAD_MSG
            );
            assert_eq!(device.to_snapshot().unwrap(), before);
        }
    }
    for len in 0..PCM_SET_PARAMS_SIZE {
        assert_eq!(
            status(&device.handle_control(&PcmParams::default().to_bytes()[..len])),
            VIRTIO_SND_S_BAD_MSG
        );
        assert_eq!(device.to_snapshot().unwrap(), before);
    }
    assert_eq!(
        status(&device.handle_control(&pcm_command(VIRTIO_SND_R_PCM_PREPARE))),
        VIRTIO_SND_S_OK
    );
    assert_eq!(device.stream_params(), Some(PcmParams::default()));
}

#[test]
fn repeated_setup_validates_boundaries_and_host_rate_atomically() {
    for initial in [PcmState::Released, PcmState::SetParams, PcmState::Prepared] {
        let mut device = configured_device(initial);
        for (buffer_bytes, period_bytes) in [
            (4, 4),
            (16 * 1024 * 1024, 4),
            (16 * 1024 * 1024, 16 * 1024 * 1024),
        ] {
            let params = PcmParams {
                buffer_bytes,
                period_bytes,
                ..PcmParams::default()
            };
            assert_eq!(
                status(&device.handle_control(&params.to_bytes())),
                VIRTIO_SND_S_OK
            );
            assert_eq!(device.stream_params(), Some(params));
            assert_eq!(device.stream_state(), PcmState::SetParams);
            for _ in 0..2 {
                assert_eq!(
                    status(&device.handle_control(&pcm_command(VIRTIO_SND_R_PCM_PREPARE))),
                    VIRTIO_SND_S_OK
                );
                assert_eq!(device.stream_state(), PcmState::Prepared);
                assert_eq!(device.stream_params(), Some(params));
            }
        }
        assert!(
            device
                .state_handle()
                .borrow_mut()
                .set_output_sample_rate(48_000)
        );
        let before = device.to_snapshot().unwrap();
        for rate in [VIRTIO_SND_PCM_RATE_44100, VIRTIO_SND_PCM_RATE_96000, 255] {
            let params = PcmParams {
                rate,
                ..PcmParams::default()
            };
            assert_eq!(
                status(&device.handle_control(&params.to_bytes())),
                VIRTIO_SND_S_BAD_MSG
            );
            assert_eq!(device.to_snapshot().unwrap(), before);
        }
    }
}
