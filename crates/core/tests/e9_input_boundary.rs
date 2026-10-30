#![cfg(not(feature = "zicsr-stub"))]
use wasm_vm_core::{
    Machine, RunOutcome,
    bus::{Bus, mmap::DRAM_BASE as BASE},
    session_clock::{MAX_EVENTS, SessionEffect, SessionError},
};
fn fixture() -> Machine {
    let mut m = Machine::new(16384);
    m.enable_clint(1);
    m.bus_mut().store32(BASE, 0x00108093).unwrap();
    m.bus_mut().store32(BASE + 4, 0xffdff06f).unwrap();
    m.hart_mut().regs.pc = BASE;
    m.start_session_clock(1).unwrap();
    m
}
#[test]
fn owned_host_input_stops_execution_and_survives_snapshot_before_acknowledgement() {
    let mut m = fixture();
    let input = vec![7, 8, 9];
    m.stage_session_effect(
        7,
        SessionEffect::HostInput {
            channel: 3,
            bytes: input.clone(),
        },
    )
    .unwrap();
    assert_eq!(
        m.run(100),
        RunOutcome::SessionStopped(SessionError::HostInputPending)
    );
    assert_eq!(m.session_position().unwrap().transition, 7);
    assert_eq!(m.session_position().unwrap().sequence, 0);
    let frame = m.save_session_resume().unwrap();
    if let Some(dir) = std::env::var_os("E9_INPUT_EVIDENCE") {
        let dir = std::path::PathBuf::from(dir);
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("host-mailbox-pending.resume"), &frame).unwrap();
    }
    let mut restored = fixture();
    restored.load_session_resume(&frame).unwrap();
    let mut calls = 0;
    restored
        .deliver_session_host_boundary(|machine, channel, bytes| {
            assert_eq!((channel, bytes), (3, input.as_slice()));
            assert_eq!(machine.session_position().unwrap().transition, 7);
            calls += 1;
            [0, 3, 0, 0]
        })
        .unwrap();
    assert_eq!(calls, 1);
    let receipts = restored.take_session_deliveries().unwrap();
    assert_eq!(receipts.len(), 1);
    assert_eq!(receipts[0].host_result, Some([0, 3, 0, 0]));
    assert_eq!(receipts[0].position.sequence, 1);
    assert_eq!(restored.run(5), RunOutcome::MaxInstrs);
    assert_eq!(restored.session_position().unwrap().transition, 12);
}
#[test]
fn reserve_before_effect_and_refuse_undrained_receipts() {
    let mut m = fixture();
    for i in 0..MAX_EVENTS {
        m.stage_session_effect(
            0,
            SessionEffect::HostInput {
                channel: 16,
                bytes: vec![i as u8],
            },
        )
        .unwrap();
    }
    assert_eq!(
        m.stage_session_effect(
            0,
            SessionEffect::HostInput {
                channel: 16,
                bytes: vec![]
            }
        ),
        Err(SessionError::QueueFull)
    );
    let mut seen = vec![];
    m.deliver_session_host_boundary(|_, _, bytes| {
        seen.push(bytes[0]);
        [1, 0, 0, 0]
    })
    .unwrap();
    assert_eq!(seen, (0..MAX_EVENTS).map(|i| i as u8).collect::<Vec<_>>());
    assert!(m.save_session_resume().is_err());
    for (i, receipt) in m.take_session_deliveries().unwrap().iter().enumerate() {
        assert_eq!(receipt.position.transition, 0);
        assert_eq!(receipt.position.ordinal, i as u32 + 1);
        assert_eq!(receipt.position.sequence, i as u64 + 1);
        assert_eq!(receipt.host_result, Some([1, 0, 0, 0]));
    }
    assert!(m.save_session_resume().is_ok());
    assert_eq!(
        m.stage_session_effect(
            0,
            SessionEffect::HostInput {
                channel: 0,
                bytes: vec![]
            }
        ),
        Err(SessionError::MalformedSnapshot)
    );
}

#[test]
fn malformed_host_mailbox_never_mutates_a_restore_destination() {
    use wasm_vm_core::resume::{SectionReader, SnapshotWriter, section};
    let mut source = fixture();
    source
        .stage_session_effect(
            0,
            SessionEffect::HostInput {
                channel: 3,
                bytes: vec![7, 8, 9],
            },
        )
        .unwrap();
    let frame = source.save_session_resume().unwrap();
    for attack in 0..4 {
        let (header, sections) = SectionReader::new(&frame).unwrap();
        let mut writer = SnapshotWriter::new(
            &header.core_hash,
            &header.base_image_hash,
            header.overlay_generation,
        );
        for sec in sections {
            let sec = sec.unwrap();
            let mut bytes = sec.payload.to_vec();
            if sec.tag == section::SESSION_CLOCK {
                match attack {
                    0 => bytes[75..77].fill(0),
                    1 => bytes[77..81].copy_from_slice(&1048577u32.to_le_bytes()),
                    2 => bytes[74] = 255,
                    3 => bytes.push(0),
                    _ => unreachable!(),
                }
            }
            writer.section(sec.tag, &bytes);
        }
        let mut destination = fixture();
        let before = destination.snapshot().hex_digest();
        let position = destination.session_position();
        assert!(destination.load_session_resume(&writer.finish()).is_err());
        assert_eq!(destination.snapshot().hex_digest(), before);
        assert_eq!(destination.session_position(), position);
    }
}
