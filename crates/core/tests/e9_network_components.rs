//! Ordinary in-memory component proofs for owned network boundaries.
#![cfg(not(feature = "zicsr-stub"))]

use wasm_vm_core::{
    Machine, RunOutcome,
    bus::{Bus, mmap::DRAM_BASE as BASE},
    dev::virtio::net::LoopbackBackend,
    resume::{SectionReader, SnapshotError, SnapshotWriter, section},
    session_clock::{SessionDelivery, SessionEffect, SessionError, SessionPosition},
    session_network::{
        LinkStatus, MAX_ENTRIES, MAX_FRAME, MAX_OWNED, NetworkError as Error,
        NetworkEvent as Event, NetworkRequest, SendResult,
    },
    trace::{TraceRecord, TraceSink, fmt_canonical},
};

const PROGRAM: &[u8] = include_bytes!("../../../web/assets/e9-network-capture.bin");
const WFI: u64 = BASE + 0x60000;
const DEADLINE: u64 = 1_000_000;

#[derive(Default)]
struct Trace(String);
impl TraceSink for Trace {
    fn retire(&mut self, record: &TraceRecord) {
        self.0.push_str(&fmt_canonical(record).to_string());
        self.0.push('\n');
    }
}
fn fixture(replay: bool) -> Machine {
    let mut m = Machine::new(1 << 20);
    m.enable_clint(1);
    m.start_session_clock(1).unwrap();
    m.enable_session_network(replay).unwrap();
    m.bus_mut().write_ram_slice(BASE, PROGRAM).unwrap();
    m.hart_mut().regs.pc = BASE;
    m
}
fn artifact(name: &str, bytes: impl AsRef<[u8]>) {
    if let Some(dir) = std::env::var_os("E9_NETWORK_EVIDENCE") {
        let dir = std::path::PathBuf::from(dir).join("components");
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join(name), bytes).unwrap();
    }
}
fn capture(m: &mut Machine, event: Event) -> SessionDelivery {
    let id = match &event {
        Event::Send { request, .. } => Some(request.id),
        _ => None,
    };
    let lease = m.lease_session_network(id).unwrap();
    m.complete_session_network(&lease, event).unwrap();
    let rows = m.take_session_deliveries().unwrap();
    assert_eq!(rows.len(), 1);
    rows.into_iter().next().unwrap()
}
fn wfi(m: &mut Machine) {
    // wfi; addi x1,x1,1. An idle advance consumes a transition without retiring
    // the addi; outstanding owned work must instead allow that next instruction.
    m.bus_mut().store32(WFI, 0x1050_0073).unwrap();
    m.bus_mut().store32(WFI + 4, 0x0010_8093).unwrap();
    m.hart_mut().regs.pc = WFI;
    m.bus_mut().store64(0x0200_4000, DEADLINE).unwrap();
}
fn until(m: &mut Machine, target: u64, budget: u64, trace: &mut Trace) {
    while m.session_position().unwrap().transition < target {
        assert_eq!(
            m.run_session_until_traced(target, budget, trace),
            Ok(RunOutcome::MaxInstrs)
        );
    }
}
fn rewrite(frame: &[u8], mut edit: impl FnMut(u32, &mut Vec<u8>)) -> Vec<u8> {
    let (header, sections) = SectionReader::new(frame).unwrap();
    let mut writer = SnapshotWriter::new(
        &header.core_hash,
        &header.base_image_hash,
        header.overlay_generation,
    );
    for section in sections {
        let section = section.unwrap();
        let mut bytes = section.payload.to_vec();
        edit(section.tag, &mut bytes);
        writer.section(section.tag, &bytes);
    }
    writer.finish()
}
fn sequence(bytes: &mut [u8], value: u64) {
    assert_eq!(&bytes[..8], b"WVCLK001");
    bytes[36..44].copy_from_slice(&value.to_le_bytes());
    bytes[44..52].copy_from_slice(&value.to_le_bytes());
}
fn repost(m: &mut Machine, count: u16) {
    // The pinned guest owns a 16-entry TX ring. Reuse descriptor zero at each
    // newly published slot; each host setup action is explicit in this fixture.
    for slot in 0..16 {
        m.bus_mut().store16(BASE + 0x21004 + slot * 2, 0).unwrap();
    }
    let old = m.bus_mut().load16(BASE + 0x21002).unwrap();
    m.bus_mut().store16(BASE + 0x21002, old + count).unwrap();
    m.bus_mut().store32(0x1000_2050, 1).unwrap();
}
fn one(m: &mut Machine) {
    let target = m.session_position().unwrap().transition + 1;
    until(m, target, 1, &mut Trace::default());
}
fn fatal(m: &mut Machine, expected: Error, name: &str) {
    let position = m.session_position().unwrap();
    let cursor = m.session_network_cursor().unwrap();
    let pc = m.hart().regs.pc;
    let lease = m.lease_session_network(None).unwrap();
    let mut trace = Trace::default();
    assert_eq!(
        m.run_session_until_traced(position.transition + 1, 1, &mut trace),
        Err(SessionError::Network(expected))
    );
    assert_eq!(m.session_position(), Some(position));
    assert_eq!(m.hart().regs.pc, pc);
    assert_eq!(m.session_network_cursor(), Ok(cursor));
    assert!(trace.0.is_empty());
    assert_eq!(
        m.run(1),
        RunOutcome::SessionStopped(SessionError::Network(expected))
    );
    assert_eq!(
        m.complete_session_network(&lease, Event::Pending(false)),
        Err(expected)
    );
    assert_eq!(m.session_network_requests(), Err(expected));
    assert!(matches!(m.lease_session_network(None), Err(error) if error == expected));
    assert!(matches!(
        m.save_session_resume(),
        Err(SnapshotError::BadComponentState {
            tag: section::SESSION_NETWORK
        })
    ));
    assert!(matches!(
        m.save_resume(),
        Err(SnapshotError::BadComponentState {
            tag: section::SESSION_NETWORK
        })
    ));
    assert_eq!(m.session_position(), Some(position));
    artifact(
        &format!("{name}-stop.txt"),
        format!(
            "position={position:?} cursor={cursor} pc={pc:#x} error={expected:?} retired_after_refusal=0 snapshot_refused=true sticky=true\n"
        ),
    );
}

#[test]
fn pending_tx_capacity_refuses_without_advancing_and_latches_the_error() {
    let mut m = fixture(false);
    until(&mut m, 1024, 31, &mut Trace::default());
    for _ in 0..15 {
        repost(&mut m, 16);
        one(&mut m);
    }
    repost(&mut m, 15);
    one(&mut m);
    let requests = m.session_network_requests().unwrap();
    assert_eq!(requests.len(), MAX_ENTRIES);
    assert_eq!(requests.first().unwrap().id, 1);
    assert_eq!(requests.last().unwrap().id, 256);
    assert_eq!(m.session_network_cursor(), Ok(0));
    assert_eq!(m.bus_mut().load16(BASE + 0x22002), Ok(256));
    artifact("tx-capacity-valid.resume", m.save_session_resume().unwrap());
    // Two more intents cover both the originating limit and forwarding an
    // already latched error during the same bounded device-service turn.
    repost(&mut m, 2);
    fatal(&mut m, Error::Limit, "tx-capacity");
}

#[test]
fn allocator_and_cursor_exhaustion_are_explicit_and_nonwrapping() {
    for replay in [false, true] {
        let mut m = fixture(replay);
        let initial = m.save_session_resume().unwrap();
        let exhausted = rewrite(&initial, |tag, bytes| {
            if tag == section::SESSION_NETWORK {
                bytes[8..16].copy_from_slice(&u64::MAX.to_le_bytes());
            }
        });
        m.load_session_resume(&exhausted).unwrap();
        let mut trace = Trace::default();
        assert_eq!(
            m.run_session_until_traced(1024, 1024, &mut trace),
            Err(SessionError::Network(Error::Exhausted))
        );
        let stopped = m.session_position().unwrap();
        // The first queue notification is the store at guest PC 0x80000600;
        // its service turn handles TX first, before the explicit TX kick.
        assert_eq!(
            u32::from_le_bytes(PROGRAM[0x600..0x604].try_into().unwrap()),
            0x0451_a823
        );
        assert_eq!((stopped.transition, stopped.retired), (385, 385));
        assert_eq!(m.hart().regs.pc, BASE + 0x604);
        assert_eq!(m.session_network_cursor(), Ok(0));
        assert_eq!(
            m.run(8),
            RunOutcome::SessionStopped(SessionError::Network(Error::Exhausted))
        );
        if replay {
            assert_eq!(m.finish_session_network_replay(0), Err(Error::Exhausted));
        }
        assert!(m.save_session_resume().is_err());
        artifact(&format!("allocator-mode{replay}-before.resume"), &exhausted);
        artifact(&format!("allocator-mode{replay}.trace"), trace.0);
    }
    let mut m = fixture(false);
    let initial = m.save_session_resume().unwrap();
    let exhausted = rewrite(&initial, |tag, bytes| match tag {
        section::SESSION_CLOCK => sequence(bytes, u64::MAX),
        section::SESSION_NETWORK => bytes[16..24].copy_from_slice(&u64::MAX.to_le_bytes()),
        _ => {}
    });
    m.load_session_resume(&exhausted).unwrap();
    let lease = m.lease_session_network(None).unwrap();
    assert_eq!(
        m.complete_session_network(&lease, Event::Pending(false)),
        Err(Error::Exhausted)
    );
    assert!(m.save_session_resume().unwrap() == exhausted);
    artifact("cursor-u64-max.resume", &exhausted);
}

#[test]
fn ordinary_installation_refusals_preserve_the_complete_original_machine() {
    let mut owned = fixture(false);
    let before = owned.save_session_resume().unwrap();
    assert_eq!(owned.enable_session_network(true), Err(Error::Unsupported));
    assert!(owned.save_session_resume().unwrap() == before);
    assert_eq!(owned.session_network_replay(), Ok(false));
    artifact("install-duplicate-unchanged.resume", &before);

    let mut live = Machine::new(1 << 20);
    live.enable_clint(1);
    live.enable_plic();
    live.enable_virtio_slots(None);
    live.enable_virtio_net(Box::new(LoopbackBackend::new()));
    live.start_session_clock(1).unwrap();
    let before = live.save_session_resume().unwrap();
    assert_eq!(live.enable_session_network(false), Err(Error::Unsupported));
    assert!(live.save_session_resume().unwrap() == before);
    artifact("install-live-nic-unchanged.resume", &before);

    let mut running = Machine::new(1 << 20);
    running.enable_clint(1);
    running.start_session_clock(1).unwrap();
    running.bus_mut().store32(BASE, 0x0010_8093).unwrap();
    running.hart_mut().regs.pc = BASE;
    one(&mut running);
    let before = running.save_session_resume().unwrap();
    assert_eq!(
        running.enable_session_network(false),
        Err(Error::Unsupported)
    );
    assert!(running.save_session_resume().unwrap() == before);
    artifact("install-after-execution-unchanged.resume", &before);
}

#[test]
fn wrong_mode_queued_common_work_and_unfinished_replays_refuse_atomically() {
    let mut recording = fixture(false);
    let mut replayed = fixture(true);
    let before = recording.save_session_resume().unwrap();
    assert_eq!(
        recording.finish_session_network_replay(0),
        Err(Error::ReplayIngress)
    );
    assert_eq!(
        recording.replay_session_network(SessionPosition::default(), Event::Pending(false)),
        Err(Error::ReplayIngress)
    );
    assert!(recording.save_session_resume().unwrap() == before);
    let lease = recording.lease_session_network(None).unwrap();
    let before = replayed.save_session_resume().unwrap();
    assert_eq!(
        replayed.complete_session_network(&lease, Event::Pending(false)),
        Err(Error::ReplayIngress)
    );
    assert!(replayed.save_session_resume().unwrap() == before);

    recording
        .stage_session_effect(0, SessionEffect::ExternalPending(false))
        .unwrap();
    let before = recording.save_session_resume().unwrap();
    assert_eq!(
        recording.complete_session_network(&lease, Event::Pending(false)),
        Err(Error::Position)
    );
    assert!(recording.save_session_resume().unwrap() == before);
    assert_eq!(recording.session_pending_events(), 1);
    recording.deliver_session_boundary().unwrap();
    recording.take_session_deliveries().unwrap();
    recording
        .complete_session_network(&lease, Event::Pending(false))
        .unwrap();
    recording.take_session_deliveries().unwrap();
    artifact("queued-common-refusal-unchanged.resume", &before);

    for kind in ["tx", "rx", "external"] {
        let mut m = fixture(false);
        match kind {
            "tx" => until(&mut m, 1024, 31, &mut Trace::default()),
            "rx" => {
                capture(&mut m, Event::Receive(vec![0x4e, 0x49, 0x43]));
            }
            "external" => {
                capture(&mut m, Event::Pending(true));
            }
            _ => unreachable!(),
        }
        let cursor = m.session_network_cursor().unwrap();
        let frame = m.save_session_resume().unwrap();
        let mut r = fixture(true);
        r.load_session_resume(&frame).unwrap();
        assert_eq!(
            r.finish_session_network_replay(cursor),
            Err(Error::Exhausted),
            "unfinished {kind}"
        );
        assert!(r.save_session_resume().unwrap() == frame);
        artifact(
            &format!("finish-{kind}-correct-cursor-refused.resume"),
            &frame,
        );
    }
}

#[test]
fn exact_owned_byte_budget_roundtrips_and_one_more_byte_is_atomic_or_fatal_by_origin() {
    let mut m = fixture(false);
    until(&mut m, 1024, 31, &mut Trace::default());
    let request = m.session_network_requests().unwrap().remove(0);
    capture(
        &mut m,
        Event::Send {
            request,
            result: SendResult::Sent,
        },
    );
    // Consume the sole RX descriptor first, so later owned receives stay queued.
    capture(&mut m, Event::Receive(vec![]));
    one(&mut m);
    assert_eq!(m.bus_mut().load16(BASE + 0x12002), Ok(1));
    for _ in 0..64 {
        capture(&mut m, Event::Receive(vec![0x61; MAX_FRAME]));
    }
    capture(&mut m, Event::Receive(vec![0x62; 64]));
    assert_eq!(64 * MAX_FRAME + 64, MAX_OWNED);
    let before = m.save_session_resume().unwrap();
    for replay in [false, true] {
        let mut r = fixture(replay);
        r.load_session_resume(&before).unwrap();
        assert!(r.save_session_resume().unwrap() == before);
    }
    artifact("owned-four-mebibytes-valid.resume", &before);

    let lease = m.lease_session_network(None).unwrap();
    let position = m.session_position();
    assert_eq!(
        m.complete_session_network(&lease, Event::Receive(vec![0x63])),
        Err(Error::Limit)
    );
    assert_eq!(m.session_position(), position);
    assert!(m.save_session_resume().unwrap() == before);
    // The outer checkpoint is within its byte cap, but decoded TX+RX ownership
    // exceeds the joint cap. The pre-existing callback remains usable on refusal.
    let too_owned = rewrite(&before, |tag, bytes| {
        if tag == section::SESSION_NETWORK {
            assert_eq!(&bytes[40..44], &0u32.to_le_bytes());
            assert_eq!(&bytes[44..48], &65u32.to_le_bytes());
            bytes[44..48].copy_from_slice(&66u32.to_le_bytes());
            bytes.extend_from_slice(&1u32.to_le_bytes());
            bytes.push(0x63);
        }
    });
    assert!(matches!(
        m.load_session_resume(&too_owned),
        Err(SnapshotError::BadComponentState {
            tag: section::SESSION_NETWORK
        })
    ));
    assert!(m.save_session_resume().unwrap() == before);
    m.complete_session_network(&lease, Event::Pending(false))
        .unwrap();
    m.take_session_deliveries().unwrap();
    artifact("owned-one-byte-over-invalid.resume", &too_owned);

    // A real guest-derived extra TX instead latches a fatal broker limit. Its
    // descriptor contains the 12-byte virtio header plus one Ethernet byte.
    m.bus_mut().store32(BASE + 0x20008, 13).unwrap();
    repost(&mut m, 1);
    artifact(
        "owned-full-before-tx-refusal.resume",
        m.save_session_resume().unwrap(),
    );
    fatal(&mut m, Error::Limit, "owned-byte-budget");
}

fn network_payload(next: u64, cursor: u64, sent: u64, pending: &[u64], receive: usize) -> Vec<u8> {
    // Independent fixture assembly from the declared little-endian wire format;
    // the implementation's checkpoint encoder does not manufacture these inputs.
    let mut bytes = b"WVNETS01".to_vec();
    for value in [next, cursor, sent] {
        bytes.extend_from_slice(&value.to_le_bytes());
    }
    bytes.extend_from_slice(&[0; 8]); // link/pending/kick/reset and code
    bytes.extend_from_slice(&(pending.len() as u32).to_le_bytes());
    for id in pending {
        bytes.extend_from_slice(&id.to_le_bytes());
        bytes.extend_from_slice(&1u32.to_le_bytes());
        bytes.push(0x41);
    }
    bytes.extend_from_slice(&(receive as u32).to_le_bytes());
    for _ in 0..receive {
        bytes.extend_from_slice(&1u32.to_le_bytes());
        bytes.push(0x52);
    }
    bytes
}

#[test]
fn remaining_codec_forms_and_joint_counter_limits_refuse_before_mutation() {
    let send = Event::Send {
        request: NetworkRequest {
            id: 1,
            frame: vec![],
        },
        result: SendResult::Sent,
    }
    .encode()
    .unwrap();
    let link = Event::Link {
        status: LinkStatus::Closed,
        code: 0,
    }
    .encode()
    .unwrap();
    let mut magic = Event::Pending(false).encode().unwrap();
    magic[0] ^= 1;
    let mut send_reserved = send;
    send_reserved[9] = 3;
    let mut link_reserved = link;
    link_reserved[9] = 4;
    let mut kind_reserved = Event::Pending(false).encode().unwrap();
    kind_reserved[8] = 255;
    for (name, bytes, error) in [
        ("outer-event-cap", vec![0; MAX_FRAME + 65], Error::Limit),
        ("event-magic", magic, Error::Payload),
        ("send-result-reserved", send_reserved, Error::Payload),
        ("link-status-reserved", link_reserved, Error::Payload),
        ("event-kind-reserved", kind_reserved, Error::Payload),
    ] {
        assert_eq!(Event::decode(&bytes), Err(error), "{name}");
        artifact(&format!("codec-{name}.bin"), bytes);
    }

    let mut m = fixture(false);
    until(&mut m, 1024, 31, &mut Trace::default());
    repost(&mut m, 1);
    one(&mut m);
    assert_eq!(m.session_network_requests().unwrap().len(), 2);
    let before = m.save_session_resume().unwrap();
    let cases = [
        ("duplicate-id", 0, network_payload(2, 0, 0, &[1, 1], 0)),
        (
            "sent-exceeds-allocator",
            2,
            network_payload(1, 2, 2, &[], 0),
        ),
        (
            "joint-allocator-limit",
            2,
            network_payload(2, 2, 2, &[1], 0),
        ),
        (
            "joint-allocator-overflow",
            u64::MAX,
            network_payload(u64::MAX, u64::MAX, u64::MAX, &[1], 0),
        ),
        (
            "represented-overflow",
            u64::MAX,
            network_payload(u64::MAX, u64::MAX, u64::MAX, &[], 1),
        ),
        ("outer-checkpoint-cap", 0, vec![0; MAX_OWNED + 16385]),
    ];
    for (name, counter, payload) in cases {
        m.load_session_resume(&before).unwrap();
        let lease = m.lease_session_network(None).unwrap();
        let invalid = rewrite(&before, |tag, bytes| match tag {
            section::SESSION_CLOCK => sequence(bytes, counter),
            section::SESSION_NETWORK => *bytes = payload.clone(),
            _ => {}
        });
        assert!(
            matches!(
                m.load_session_resume(&invalid),
                Err(SnapshotError::BadComponentState {
                    tag: section::SESSION_NETWORK
                })
            ),
            "{name}"
        );
        assert!(
            m.save_session_resume().unwrap() == before,
            "partial mutation {name}"
        );
        m.complete_session_network(&lease, Event::Pending(false))
            .unwrap();
        m.take_session_deliveries().unwrap();
        artifact(&format!("codec-{name}-invalid.resume"), &invalid);
    }
    artifact("codec-valid-two-pending-control.resume", &before);
}

#[test]
fn replay_coordinate_exhaustion_refuses_without_wrapping() {
    for ordinal in [0, u32::MAX] {
        let mut r = fixture(true);
        let before = r.save_session_resume().unwrap();
        let exhausted = rewrite(&before, |tag, bytes| {
            if tag == section::SESSION_CLOCK {
                sequence(bytes, u64::MAX);
                bytes[28..36].copy_from_slice(&u64::from(ordinal).to_le_bytes());
            }
        });
        r.load_session_resume(&exhausted).unwrap();
        let position = r.session_position().unwrap();
        assert_eq!(
            r.replay_session_network(position, Event::Pending(false)),
            Err(Error::Exhausted)
        );
        assert!(r.save_session_resume().unwrap() == exhausted);
        artifact(
            &format!("replay-exhausted-ordinal{ordinal}.resume"),
            &exhausted,
        );
    }
}

#[test]
fn owned_external_pending_and_guest_tx_gate_wfi_idle_advance() {
    let mut summary = String::new();
    for guest_tx in [false, true] {
        for pending in [false, true] {
            let mut m = fixture(false);
            if guest_tx {
                assert_eq!(m.run_session_until(1024, 1024), Ok(RunOutcome::MaxInstrs));
                if !pending {
                    let request = m.session_network_requests().unwrap().remove(0);
                    capture(
                        &mut m,
                        Event::Send {
                            request,
                            result: SendResult::Sent,
                        },
                    );
                }
            } else {
                capture(&mut m, Event::Pending(pending));
            }
            wfi(&mut m);
            let begin = m.session_position().unwrap();
            let frame = m.save_session_resume().unwrap();
            let mut trace = Trace::default();
            until(&mut m, begin.transition + 2, 8, &mut trace);
            let end = m.session_position().unwrap();
            artifact(
                &format!("wfi-tx{guest_tx}-pending{pending}-before.resume"),
                &frame,
            );
            artifact(
                &format!("wfi-tx{guest_tx}-pending{pending}-after.resume"),
                m.save_session_resume().unwrap(),
            );
            artifact(
                &format!("wfi-tx{guest_tx}-pending{pending}.trace"),
                &trace.0,
            );
            summary.push_str(&format!(
                "tx={guest_tx} pending={pending} begin={begin:?} end={end:?} mtime={} x1={}\n",
                m.clint_mtime(),
                m.hart().regs.read(1)
            ));
            artifact("wfi-summary.txt", &summary);
            assert_eq!(
                end.retired - begin.retired,
                if pending { 2 } else { 1 },
                "owned work skipped at tx={guest_tx} pending={pending}"
            );
            assert_eq!(
                m.clint_mtime(),
                if pending { begin.retired + 2 } else { DEADLINE }
            );
            assert_eq!(trace.0.lines().count(), if pending { 2 } else { 1 });
            assert_eq!(m.hart().regs.read(1), u64::from(pending));
            let mut r = fixture(true);
            r.load_session_resume(&frame).unwrap();
            let mut replay_trace = Trace::default();
            until(&mut r, begin.transition + 2, 1, &mut replay_trace);
            let replay_frame = r.save_session_resume().unwrap();
            artifact(
                &format!("wfi-tx{guest_tx}-pending{pending}-replayed.resume"),
                &replay_frame,
            );
            artifact(
                &format!("wfi-tx{guest_tx}-pending{pending}-replayed.trace"),
                &replay_trace.0,
            );
            assert!(
                replay_frame == m.save_session_resume().unwrap(),
                "WFI replay frame drift"
            );
            assert_eq!(replay_trace.0, trace.0);
        }
    }
}
