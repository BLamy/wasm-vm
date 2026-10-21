#![cfg(not(feature = "zicsr-stub"))]
use sha2::{Digest, Sha256};
use std::{cell::Cell, rc::Rc};
use wasm_vm_core::{
    Machine, RunOutcome,
    block::MemBackend,
    bus::{Bus, mmap::DRAM_BASE as BASE},
    dev::{
        rtc::WallClock,
        virtio::rng::{EntropySource, EntropyUnavailable},
    },
    session_clock::{
        SessionDelivery, SessionEffect, SessionError, SessionPhase, SessionPosition,
        sources::{ObservationKind, ObservationRecord, ObservationTape, ObservationValue},
    },
    session_devices::{
        BaseDisk, CompletionStatus, DeviceCompletion, DeviceError, DeviceIntent, DeviceRequest,
        PayloadRef,
    },
    session_network::{LinkStatus, NetworkError, NetworkEvent, NetworkRequest, SendResult},
    session_replay::{ReplayDriver, ReplayPlan, ReplayReason, ReplayStatus, StateWitness},
};
use wasm_vm_storage::ImageManifest;

const END: u64 = 20;
const REPORT: u64 = BASE + 0x800;
const OBSERVATION_PROGRAM: &[u8] = include_bytes!("../../../web/assets/e9-time-entropy.bin");
const DEVICE_PROGRAM: &[u8] = include_bytes!("../../../web/assets/e9-device-completions.bin");
const NETWORK_PROGRAM: &[u8] = include_bytes!("../../../web/assets/e9-network-capture.bin");
const NETWORK_HEADER: [u8; 14] = [
    2, 0, 0, 0, 0, 1, 0x52, 0x54, 0, 0x12, 0x34, 0x56, 0x88, 0xb5,
];

fn network_fixture(replay: bool) -> Machine {
    let mut machine = Machine::new(1 << 20);
    machine.enable_clint(1);
    machine.start_session_clock(1).unwrap();
    machine.enable_session_network(replay).unwrap();
    machine
        .bus_mut()
        .write_ram_slice(BASE, NETWORK_PROGRAM)
        .unwrap();
    machine.hart_mut().regs.pc = BASE;
    machine
}
fn capture_network(machine: &mut Machine, event: NetworkEvent) -> SessionDelivery {
    let id = match &event {
        NetworkEvent::Send { request, .. } => Some(request.id),
        _ => None,
    };
    let lease = machine.lease_session_network(id).unwrap();
    machine.complete_session_network(&lease, event).unwrap();
    let mut deliveries = machine.take_session_deliveries().unwrap();
    assert_eq!(deliveries.len(), 1);
    deliveries.remove(0)
}

fn disk_payload(chunk: u32) -> Vec<u8> {
    (0..512)
        .map(|n| ((n * 13 + chunk as usize * 79 + 17) % 251) as u8)
        .collect()
}
fn device_fixture(replay: bool) -> Machine {
    let mut machine = Machine::new(1 << 20);
    machine.enable_clint(1);
    machine.enable_plic();
    machine.start_session_clock(1).unwrap();
    machine
        .enable_session_devices(
            Some(BaseDisk {
                identity: [37; 32],
                sectors: 2,
                chunk_bytes: 512,
                chunks: (0..2)
                    .map(|n| PayloadRef::of(&disk_payload(n)).unwrap())
                    .collect(),
            }),
            true,
            true,
            replay,
        )
        .unwrap();
    machine
        .bus_mut()
        .write_ram_slice(BASE, DEVICE_PROGRAM)
        .unwrap();
    machine.hart_mut().regs.pc = BASE;
    machine
}

#[test]
fn invalid_agent_slot_is_rejected_before_device_installation() {
    let mut machine = Machine::new(1 << 20);
    machine.start_session_clock(1).unwrap();
    assert_eq!(
        machine.enable_session_devices_at(
            None,
            true,
            false,
            true,
            wasm_vm_core::platform::virt::VIRTIO_COUNT as usize,
        ),
        Err(DeviceError::Unsupported)
    );
    machine
        .enable_session_devices_at(
            None,
            true,
            false,
            true,
            wasm_vm_core::dev::virtio::console::VIRTIO_CONSOLE_SLOT,
        )
        .unwrap();
}
fn run_to(machine: &mut Machine, transition: u64, quantum: u64) {
    while machine.session_position().unwrap().transition < transition {
        assert_eq!(
            machine.run_session_until(transition, quantum).unwrap(),
            RunOutcome::MaxInstrs
        );
    }
}

struct TestTime {
    calls: Rc<Cell<u32>>,
    hostile: bool,
}
impl WallClock for TestTime {
    fn now_ns(&self) -> u64 {
        assert!(!self.hostile, "replay called a live RTC provider");
        self.calls.set(self.calls.get() + 1);
        1_700_000_000_123_456_789 + u64::from(self.calls.get()) * 17
    }
}
struct TestEntropy {
    calls: Rc<Cell<u32>>,
    hostile: bool,
}
impl EntropySource for TestEntropy {
    fn fill(&mut self, out: &mut [u8]) {
        assert!(!self.hostile, "replay called a live entropy provider");
        self.calls.set(self.calls.get() + 1);
        for (i, byte) in out.iter_mut().enumerate() {
            *byte = (i as u8).wrapping_add(31);
        }
    }
    fn try_fill(&mut self, out: &mut [u8]) -> Result<(), EntropyUnavailable> {
        self.fill(out);
        Ok(())
    }
}

fn observed_fixture(hostile: bool, cache: bool) -> (Machine, Rc<Cell<u32>>, Rc<Cell<u32>>) {
    let mut machine = Machine::new(16 << 20);
    machine.enable_clint(5);
    machine.enable_plic();
    let time_calls = Rc::new(Cell::new(0));
    let entropy_calls = Rc::new(Cell::new(0));
    machine.enable_rtc(Box::new(TestTime {
        calls: time_calls.clone(),
        hostile,
    }));
    machine.enable_uart16550();
    machine.enable_virtio_slots(None);
    machine.enable_virtio_rng(Box::new(TestEntropy {
        calls: entropy_calls.clone(),
        hostile,
    }));
    machine
        .bus_mut()
        .write_ram_slice(BASE, OBSERVATION_PROGRAM)
        .unwrap();
    machine.hart_mut().regs.pc = BASE;
    machine.set_block_cache(cache);
    machine.set_interrupt_batching(cache);
    machine.start_session_clock(1).unwrap();
    (machine, time_calls, entropy_calls)
}

fn fixture() -> Machine {
    let mut machine = Machine::new(1 << 20);
    machine.enable_clint(1);
    // addi x1,x1,1: a real retired guest instruction at each position.
    let program: Vec<u8> = (0..128)
        .flat_map(|_| 0x0010_8093u32.to_le_bytes())
        .collect();
    machine.bus_mut().write_ram_slice(BASE, &program).unwrap();
    machine.hart_mut().regs.pc = BASE;
    machine.start_session_clock(1).unwrap();
    machine
}

fn witness(machine: &mut Machine) -> StateWitness {
    StateWitness {
        position: machine.session_position().unwrap(),
        resume_sha256: Sha256::digest(machine.save_session_resume().unwrap()).into(),
    }
}

#[test]
fn recorded_external_pending_is_applied_once_at_its_boundary() {
    let mut original = fixture();
    original
        .start_session_sources(original.source_policy(), None)
        .unwrap();
    let begin = original.session_position().unwrap();
    let initial_resume = original.save_session_resume().unwrap();
    let first = witness(&mut original);
    original
        .stage_session_effect(0, SessionEffect::ExternalPending(true))
        .unwrap();
    original.deliver_session_boundary().unwrap();
    let events = original.take_session_deliveries().unwrap();
    assert_eq!(events.len(), 1);
    let end = original.session_position().unwrap();
    let final_resume = original.save_session_resume().unwrap();
    let plan = ReplayPlan {
        begin,
        end,
        initial_resume,
        events,
        witnesses: vec![first, witness(&mut original)],
    };
    plan.validate().unwrap();
    let mut replay = fixture();
    let mut driver = ReplayDriver::start(&mut replay, plan).unwrap();
    driver
        .run_to_end(&mut replay, 1, |_, _, _| unreachable!())
        .unwrap();
    assert_eq!(driver.status(), ReplayStatus::Completed);
    assert_eq!(driver.event_cursor(), 1);
    assert_eq!(replay.save_session_resume().unwrap(), final_resume);
}

#[test]
fn externally_skipped_receipt_cannot_be_hidden_at_the_declared_end() {
    let mut original = fixture();
    original
        .start_session_sources(original.source_policy(), None)
        .unwrap();
    let begin = original.session_position().unwrap();
    let initial_resume = original.save_session_resume().unwrap();
    let first = witness(&mut original);
    let expected = SessionPosition {
        ordinal: 1,
        sequence: 1,
        ..begin
    };
    let end = SessionPosition {
        transition: 1,
        retired: 1,
        ordinal: 0,
        sequence: 1,
        ..begin
    };
    let plan = ReplayPlan {
        begin,
        end,
        initial_resume,
        events: vec![SessionDelivery {
            position: expected,
            ticket: 0,
            effect: SessionEffect::ExternalPending(false),
            host_result: None,
        }],
        witnesses: vec![
            first,
            StateWitness {
                position: end,
                resume_sha256: [0; 32],
            },
        ],
    };
    plan.validate().unwrap();
    let mut replay = fixture();
    let mut driver = ReplayDriver::start(&mut replay, plan).unwrap();
    // Bypass the driver using a public guest runner. The replay limit still fences
    // instruction execution, but the missing sequence must stop completion.
    assert_eq!(
        replay.run_session_until(1, 1).unwrap(),
        RunOutcome::MaxInstrs
    );
    let failure = driver
        .run_to_end(&mut replay, 1, |_, _, _| unreachable!())
        .unwrap_err();
    assert_eq!(failure.reason, ReplayReason::Exhausted);
    assert_eq!(failure.position.transition, 1);
    assert_eq!(failure.event_index, 0);
    assert_eq!(failure.detail, "end coordinate differs");
}

fn alpine_base() -> BaseDisk {
    let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../web/session-alpine-image.json");
    let manifest = ImageManifest::from_json(&std::fs::read_to_string(path).unwrap()).unwrap();
    let chunks = manifest
        .chunks
        .iter()
        .map(|hash| PayloadRef {
            sha256: std::array::from_fn(|i| {
                u8::from_str_radix(&hash[i * 2..i * 2 + 2], 16).unwrap()
            }),
            length: manifest.chunk_size,
        })
        .collect();
    BaseDisk {
        identity: manifest.base_hash(),
        sectors: manifest.image_len / 512,
        chunk_bytes: manifest.chunk_size,
        chunks,
    }
}

fn alpine_kernel() -> Vec<u8> {
    let path =
        std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../releases/kernel/6.6.63/Image");
    std::fs::read(path).unwrap()
}

type AlpineFixture = (
    Machine,
    Rc<std::cell::RefCell<wasm_vm_core::dev::uart16550::Uart16550>>,
    Rc<Cell<u32>>,
    Rc<Cell<u32>>,
);

fn alpine_machine(replay: bool, kernel: &[u8], cache: bool) -> AlpineFixture {
    let mut machine = Machine::new(wasm_vm_core::session_profile::RAM_BYTES);
    let time_calls = Rc::new(Cell::new(0));
    let entropy_calls = Rc::new(Cell::new(0));
    let uart = machine
        .install_full_software_session(
            alpine_base(),
            Box::new(TestTime {
                calls: time_calls.clone(),
                hostile: replay,
            }),
            Box::new(TestEntropy {
                calls: entropy_calls.clone(),
                hostile: replay,
            }),
            [9; 32],
            replay,
        )
        .unwrap();
    machine
        .place_and_boot(
            kernel,
            None,
            "root=/dev/vda rw console=ttyS0 earlycon=sbi init=/bin/sh -- +i",
        )
        .unwrap();
    machine.set_block_cache(cache);
    machine.set_interrupt_batching(cache);
    (machine, uart, time_calls, entropy_calls)
}

#[test]
fn pinned_linux_full_software_profile_replays_exact_cpu_ram_device_disk_digest() {
    let kernel = alpine_kernel();
    let (mut original, uart, _, _) = alpine_machine(false, &kernel, false);
    original
        .start_session_sources(original.source_policy(), None)
        .unwrap();
    let initial = original.save_session_resume().unwrap();
    let begin = original.session_position().unwrap();
    let mut witnesses = vec![witness(&mut original)];
    run_to(&mut original, 64, 17);
    original
        .stage_session_effect(
            64,
            SessionEffect::HostInput {
                channel: 2,
                bytes: b"x".to_vec(),
            },
        )
        .unwrap();
    original
        .deliver_session_host_boundary(|_, channel, bytes| {
            assert_eq!(channel, 2);
            uart.borrow_mut().push_input(bytes);
            [0, bytes.len() as u64, 0, 0]
        })
        .unwrap();
    let mut events = original.take_session_deliveries().unwrap();
    witnesses.push(witness(&mut original));
    run_to(&mut original, 4096, 103);
    events.extend(original.take_session_deliveries().unwrap());
    witnesses.push(witness(&mut original));
    let final_frame = original.save_session_resume().unwrap();
    let plan = ReplayPlan {
        begin,
        end: original.session_position().unwrap(),
        initial_resume: initial,
        events,
        witnesses,
    };
    plan.validate().unwrap();
    for cache in [false, true] {
        let (mut replay, uart, time_calls, entropy_calls) = alpine_machine(true, &kernel, cache);
        let rx_free = uart.borrow().rx_free();
        assert!(rx_free > 0);
        uart.borrow_mut().push_input(b"unrecorded");
        assert_eq!(uart.borrow().rx_free(), rx_free);
        let mut driver = ReplayDriver::start(&mut replay, plan.clone()).unwrap();
        driver
            .run_to_end(
                &mut replay,
                if cache { 1024 } else { 7 },
                |_, channel, bytes| {
                    assert_eq!(channel, 2);
                    uart.borrow_mut().push_input(bytes);
                    [0, bytes.len() as u64, 0, 0]
                },
            )
            .unwrap();
        assert_eq!(driver.status(), ReplayStatus::Completed);
        assert_eq!(replay.save_session_resume().unwrap(), final_frame);
        assert_eq!(time_calls.get(), 0);
        assert_eq!(entropy_calls.get(), 0);
    }
}

fn record() -> (ReplayPlan, Vec<u8>) {
    let mut machine = fixture();
    let policy = machine.source_policy();
    machine.start_session_sources(policy, None).unwrap();
    let initial_resume = machine.save_session_resume().unwrap();
    let mut witnesses = vec![witness(&mut machine)];
    machine
        .stage_session_effect(
            0,
            SessionEffect::HostInput {
                channel: 16,
                bytes: vec![1],
            },
        )
        .unwrap();
    machine
        .deliver_session_host_boundary(|_, channel, bytes| {
            assert_eq!((channel, bytes), (16, &[1][..]));
            [0, 1, 0, 0]
        })
        .unwrap();
    let mut events: Vec<SessionDelivery> = machine.take_session_deliveries().unwrap();
    witnesses.push(witness(&mut machine));
    while machine.session_position().unwrap().transition < 10 {
        assert_eq!(
            machine.run_session_until(10, 7).unwrap(),
            RunOutcome::MaxInstrs
        );
        assert!(machine.take_session_deliveries().unwrap().is_empty());
    }
    machine
        .stage_session_effect(
            10,
            SessionEffect::WriteRam {
                address: REPORT,
                bytes: vec![0x51, 0x52, 0x53, 0x54],
            },
        )
        .unwrap();
    machine.deliver_session_boundary().unwrap();
    events.extend(machine.take_session_deliveries().unwrap());
    witnesses.push(witness(&mut machine));
    while machine.session_position().unwrap().transition < END {
        assert_eq!(
            machine.run_session_until(END, 9).unwrap(),
            RunOutcome::MaxInstrs
        );
        assert!(machine.take_session_deliveries().unwrap().is_empty());
    }
    let final_resume = machine.save_session_resume().unwrap();
    witnesses.push(witness(&mut machine));
    let plan = ReplayPlan {
        begin: SessionPosition::default(),
        end: machine.session_position().unwrap(),
        initial_resume,
        events,
        witnesses,
    };
    plan.validate().unwrap();
    (plan, final_resume)
}

#[test]
fn exact_replay_stops_at_declared_end_under_varied_quanta() {
    let (plan, final_resume) = record();
    for quantum in [1, 3, 31, 4096] {
        let mut machine = fixture();
        machine.set_block_cache(quantum > 3);
        machine.set_interrupt_batching(quantum > 3);
        let mut driver = ReplayDriver::start(&mut machine, plan.clone()).unwrap();
        let initial_frame = machine.save_session_resume().unwrap();
        assert_eq!(
            machine.stage_session_effect(
                plan.begin.transition,
                SessionEffect::WriteRam {
                    address: REPORT + 8,
                    bytes: vec![0xaa, 0xbb, 0xcc, 0xdd],
                },
            ),
            Err(SessionError::ReplayActive)
        );
        assert_eq!(
            machine.deliver_session_boundary(),
            Err(SessionError::ReplayActive)
        );
        assert_eq!(machine.save_session_resume().unwrap(), initial_frame);
        driver
            .run_to_end(&mut machine, quantum, |_, channel, bytes| {
                assert_eq!((channel, bytes), (16, &[1][..]));
                [0, 1, 0, 0]
            })
            .unwrap();
        assert_eq!(driver.status(), ReplayStatus::Completed);
        assert_eq!(driver.event_cursor(), plan.events.len());
        assert_eq!(machine.save_session_resume().unwrap(), final_resume);
        assert_eq!(machine.bus_mut().load32(REPORT).unwrap(), 0x5453_5251);
        let stopped = machine.session_position().unwrap();
        assert_eq!(
            machine.stage_session_effect(
                stopped.transition,
                SessionEffect::WriteRam {
                    address: REPORT + 8,
                    bytes: vec![0x12, 0x34, 0x56, 0x78],
                },
            ),
            Err(SessionError::ReplayActive)
        );
        assert_eq!(
            machine.deliver_session_boundary(),
            Err(SessionError::ReplayActive)
        );
        assert_eq!(
            machine.deliver_session_host_boundary(|_, _, _| panic!("live callback after replay")),
            Err(SessionError::ReplayActive)
        );
        let extra_observation = ObservationTape {
            policy: machine.source_policy(),
            records: vec![ObservationRecord {
                position: SessionPosition {
                    transition: stopped.transition + 1,
                    retired: stopped.retired,
                    phase: SessionPhase::Observe,
                    ordinal: 1,
                    sequence: stopped.sequence + 1,
                },
                value: ObservationValue {
                    kind: ObservationKind::RtcPoll,
                    requested: 8,
                    status: 0,
                    bytes: vec![0; 8],
                },
            }],
        };
        assert_eq!(
            machine.append_session_source_replay(extra_observation),
            Err(SessionError::ReplayActive)
        );
        assert_eq!(machine.session_pending_events(), 0);
        assert_eq!(machine.bus_mut().load32(REPORT + 8).unwrap(), 0);
        assert_eq!(machine.save_session_resume().unwrap(), final_resume);
        assert_eq!(machine.run(128), RunOutcome::MaxInstrs);
        assert_eq!(machine.session_position().unwrap(), stopped);
        assert_eq!(
            driver
                .run_to_end(&mut machine, 1, |_, _, _| unreachable!())
                .unwrap_err()
                .reason,
            ReplayReason::Exhausted
        );
    }
}

#[test]
fn replay_refuses_live_or_malformed_adapter_events_at_the_recorded_coordinate() {
    let (base, _) = record();
    for (channel, bytes) in [
        (99, vec![1]),
        (wasm_vm_core::session_network::CHANNEL, vec![0xff]),
        (wasm_vm_core::session_devices::CHANNEL, vec![0xff]),
    ] {
        let mut plan = base.clone();
        plan.events[0].effect = SessionEffect::HostInput { channel, bytes };
        plan.validate().unwrap();
        let mut machine = fixture();
        let mut driver = ReplayDriver::start(&mut machine, plan).unwrap();
        let before = machine.save_session_resume().unwrap();
        let failure = driver
            .run_to_end(&mut machine, 17, |_, _, _| {
                panic!("malformed adapter reached host")
            })
            .unwrap_err();
        assert_eq!(failure.reason, ReplayReason::Adapter);
        assert_eq!((failure.position.transition, failure.event_index), (0, 0));
        assert_eq!(driver.first_failure(), Some(&failure));
        assert_eq!(machine.save_session_resume().unwrap(), before);
    }
}

#[test]
fn decoded_adapter_intent_and_ram_failures_leave_the_first_frame_unchanged() {
    let (mut ram_plan, _) = record();
    ram_plan.events[0].effect = SessionEffect::WriteRam {
        address: BASE + (1 << 20),
        bytes: vec![0x5a],
    };
    ram_plan.validate().unwrap();
    let mut ram_replay = fixture();
    let mut ram_driver = ReplayDriver::start(&mut ram_replay, ram_plan).unwrap();
    let before = ram_replay.save_session_resume().unwrap();
    let error = ram_driver
        .run_to_end(&mut ram_replay, 7, |_, _, _| unreachable!())
        .unwrap_err();
    assert_eq!(
        (error.reason, error.event_index),
        (ReplayReason::Adapter, 0)
    );
    assert!(error.detail.starts_with("RAM delivery:"));
    assert_eq!(ram_replay.save_session_resume().unwrap(), before);

    let no_request_device = DeviceCompletion {
        request: DeviceRequest {
            id: 1,
            intent: DeviceIntent::Agent {
                generation: 1,
                maximum: 1,
            },
        },
        status: CompletionStatus::Failed,
        frames: 0,
        bytes: vec![],
    };
    let no_request_network = NetworkEvent::Send {
        request: NetworkRequest {
            id: 1,
            frame: NETWORK_HEADER.to_vec(),
        },
        result: SendResult::Failed,
    };
    for (mut original, mut replay, channel, bytes, detail) in [
        (
            device_fixture(true),
            device_fixture(true),
            wasm_vm_core::session_devices::CHANNEL,
            no_request_device.encode().unwrap(),
            "device intent:",
        ),
        (
            network_fixture(true),
            network_fixture(true),
            wasm_vm_core::session_network::CHANNEL,
            no_request_network.encode().unwrap(),
            "network intent:",
        ),
    ] {
        original
            .start_session_sources(original.source_policy(), None)
            .unwrap();
        let initial_resume = original.save_session_resume().unwrap();
        let first = witness(&mut original);
        let end = SessionPosition {
            transition: 1,
            retired: 1,
            sequence: 1,
            ..SessionPosition::default()
        };
        let plan = ReplayPlan {
            begin: first.position,
            end,
            initial_resume,
            events: vec![SessionDelivery {
                position: SessionPosition {
                    ordinal: 1,
                    sequence: 1,
                    ..first.position
                },
                ticket: 1,
                effect: SessionEffect::HostInput { channel, bytes },
                host_result: None,
            }],
            witnesses: vec![
                first,
                StateWitness {
                    position: end,
                    resume_sha256: [0; 32],
                },
            ],
        };
        plan.validate().unwrap();
        let mut driver = ReplayDriver::start(&mut replay, plan).unwrap();
        let before = replay.save_session_resume().unwrap();
        let error = driver
            .run_to_end(&mut replay, 7, |_, _, _| unreachable!())
            .unwrap_err();
        assert_eq!(
            (error.reason, error.event_index),
            (ReplayReason::Adapter, 0)
        );
        assert!(error.detail.starts_with(detail), "{error:?}");
        assert_eq!(replay.save_session_resume().unwrap(), before);
        assert_eq!(driver.first_failure(), Some(&error));
    }
}

#[test]
fn zero_quantum_and_nonfresh_start_fail_without_guest_progress() {
    let (plan, _) = record();
    let mut nonfresh = fixture();
    assert_eq!(nonfresh.run(1), RunOutcome::MaxInstrs);
    let position = nonfresh.session_position().unwrap();
    let refusal = ReplayDriver::start(&mut nonfresh, plan.clone())
        .err()
        .expect("nonfresh start must refuse");
    assert_eq!(refusal.reason, ReplayReason::InitialCheckpoint);
    assert_eq!(nonfresh.session_position(), Some(position));

    let mut machine = fixture();
    let mut driver = ReplayDriver::start(&mut machine, plan).unwrap();
    let before = machine.save_session_resume().unwrap();
    let failure = driver
        .run_to_end(&mut machine, 0, |_, _, _| unreachable!())
        .unwrap_err();
    assert_eq!(failure.reason, ReplayReason::Exhausted);
    assert_eq!(failure.detail, "budget is zero");
    assert_eq!(driver.status(), ReplayStatus::Diverged);
    assert_eq!(machine.save_session_resume().unwrap(), before);
    assert_eq!(
        driver
            .run_to_end(&mut machine, 7, |_, _, _| unreachable!())
            .unwrap_err(),
        failure
    );
}

#[test]
fn start_refuses_active_sources_bad_restore_wrong_coordinate_and_live_adapters() {
    let (recorded, _) = record();
    let mut active_sources = fixture();
    active_sources
        .start_session_sources(active_sources.source_policy(), None)
        .unwrap();
    let error = ReplayDriver::start(&mut active_sources, recorded.clone())
        .err()
        .unwrap();
    assert_eq!(error.reason, ReplayReason::InitialCheckpoint);
    assert_eq!(error.detail, "replay machine is not fresh");
    assert_eq!(active_sources.session_position().unwrap().transition, 0);

    let mut malformed = recorded.clone();
    malformed.initial_resume = vec![1];
    let mut replay = fixture();
    let error = ReplayDriver::start(&mut replay, malformed).err().unwrap();
    assert_eq!(error.reason, ReplayReason::InitialCheckpoint);
    assert!(error.detail.contains("initial restore:"));
    assert_eq!(replay.session_position().unwrap().transition, 0);

    let begin = SessionPosition {
        transition: 1,
        retired: 1,
        ..SessionPosition::default()
    };
    let wrong_coordinate = ReplayPlan {
        begin,
        end: begin,
        initial_resume: recorded.initial_resume,
        events: vec![],
        witnesses: vec![StateWitness {
            position: begin,
            resume_sha256: [0; 32],
        }],
    };
    wrong_coordinate.validate().unwrap();
    let mut replay = fixture();
    let error = ReplayDriver::start(&mut replay, wrong_coordinate)
        .err()
        .unwrap();
    assert_eq!(error.reason, ReplayReason::InitialCheckpoint);
    assert_eq!(error.detail, "initial coordinate differs");
    assert_eq!(replay.session_position().unwrap().transition, 0);

    for (mut original, mut replay, expected) in [
        (
            device_fixture(false),
            device_fixture(false),
            "device adapter is live",
        ),
        (
            network_fixture(false),
            network_fixture(false),
            "network adapter is live",
        ),
    ] {
        original
            .start_session_sources(original.source_policy(), None)
            .unwrap();
        let initial_resume = original.save_session_resume().unwrap();
        let start = witness(&mut original);
        let plan = ReplayPlan {
            begin: start.position,
            end: start.position,
            initial_resume,
            events: vec![],
            witnesses: vec![start],
        };
        plan.validate().unwrap();
        let error = ReplayDriver::start(&mut replay, plan).err().unwrap();
        assert_eq!(error.reason, ReplayReason::InitialCheckpoint);
        assert_eq!(error.detail, expected);
        assert_eq!(replay.session_position().unwrap().transition, 0);
    }
}

#[test]
fn unhandled_guest_trap_stops_replay_before_the_declared_end() {
    let mut original = Machine::new(1 << 20);
    original.enable_clint(1);
    original.bus_mut().store32(BASE, 0x0000_0073).unwrap(); // ecall, no handler
    original.hart_mut().regs.pc = BASE;
    original.start_session_clock(1).unwrap();
    original
        .start_session_sources(original.source_policy(), None)
        .unwrap();
    let initial_resume = original.save_session_resume().unwrap();
    let begin = witness(&mut original);
    let mut end = begin;
    end.position.transition = 1;
    end.position.retired = 1;
    let plan = ReplayPlan {
        begin: begin.position,
        end: end.position,
        initial_resume,
        events: vec![],
        witnesses: vec![begin, end],
    };
    plan.validate().unwrap();
    let mut replay = Machine::new(1 << 20);
    replay.enable_clint(1);
    replay.bus_mut().store32(BASE, 0x0000_0073).unwrap();
    replay.hart_mut().regs.pc = BASE;
    replay.start_session_clock(1).unwrap();
    let mut driver = ReplayDriver::start(&mut replay, plan).unwrap();
    let failure = driver
        .run_to_end(&mut replay, 16, |_, _, _| unreachable!())
        .unwrap_err();
    assert_eq!(failure.reason, ReplayReason::Runtime);
    assert!(failure.detail.contains("guest ended early"));
    assert_eq!(failure.position.transition, 0);
    assert_eq!(driver.first_failure(), Some(&failure));
}

fn ordinary_input_fixture() -> (
    Machine,
    Rc<std::cell::RefCell<wasm_vm_core::dev::uart16550::Uart16550>>,
) {
    let mut machine = Machine::new(1 << 20);
    machine.enable_clint(1);
    machine.enable_plic();
    let uart = machine.enable_uart16550();
    machine.enable_virtio_slots(None);
    machine.enable_virtio_keyboard();
    machine.enable_virtio_pointer();
    machine.enable_builtin_sbi();
    // A pending TX byte makes a forbidden output drain observable, too.
    machine
        .bus_mut()
        .store8(wasm_vm_core::bus::mmap::UART0_BASE, b'X')
        .unwrap();
    let program: Vec<u8> = (0..16).flat_map(|_| 0x0012_0213u32.to_le_bytes()).collect();
    machine.bus_mut().write_ram_slice(BASE, &program).unwrap();
    machine.hart_mut().regs.pc = BASE;
    machine.start_session_clock(1).unwrap();
    (machine, uart)
}

fn assert_ordinary_input_blocked(
    machine: &mut Machine,
    uart: &Rc<std::cell::RefCell<wasm_vm_core::dev::uart16550::Uart16550>>,
) {
    use wasm_vm_core::dev::virtio::input::{EV_ABS, EV_KEY, EV_REL, InputEvent, keyboard, pointer};
    use wasm_vm_core::resume::{ComponentSnapshot, SnapshotError};

    let position = machine.session_position();
    let before = machine.save_session_resume().unwrap();
    assert_eq!(
        machine.load_session_resume(&before),
        Err(SnapshotError::ReplayActive)
    );
    assert_eq!(
        machine.load_resume(&before),
        Err(SnapshotError::ReplayActive)
    );
    assert_eq!(
        machine.restore_desktop_snapshot(
            &before,
            wasm_vm_core::desktop_restore::DisplaySize::new(640, 480),
        ),
        Err(
            wasm_vm_core::desktop_restore::DesktopRestoreError::CommitRefused {
                code: "replay_active",
            }
        )
    );
    #[cfg(feature = "virgl-renderer")]
    assert_eq!(
        machine.load_accelerated_resume(&before, &[0; 32]),
        Err(SnapshotError::ReplayActive)
    );
    let uart_snapshot = uart.borrow().to_snapshot();
    assert_eq!(
        uart.borrow_mut().restore(&uart_snapshot),
        Err(SnapshotError::ReplayActive)
    );
    uart.borrow_mut().push_input(b"Q");
    assert!(uart.borrow_mut().take_output().is_empty());
    let keyboard = machine.keyboard_input().unwrap();
    let mut keyboard = keyboard.borrow_mut();
    let exact_snapshot = keyboard.to_session_snapshot().unwrap();
    let desktop_snapshot = keyboard.to_snapshot().unwrap();
    assert_eq!(
        keyboard.restore_session_snapshot(&exact_snapshot),
        Err(wasm_vm_core::dev::virtio::input::InputSnapshotError::ReplayIngress)
    );
    assert!(matches!(
        keyboard.restore_snapshot(&desktop_snapshot),
        Err(wasm_vm_core::dev::virtio::input::InputSnapshotError::ReplayIngress)
    ));
    assert!(!keyboard.inject_event(EV_KEY, keyboard::KEY_A, 1));
    keyboard.sync();
    keyboard.enqueue_event(InputEvent::new(EV_KEY, keyboard::KEY_A, 1));
    assert!(!keyboard.release_all().host_held_set_discarded);
    let budget = keyboard.pending_event_budget();
    keyboard.set_pending_event_budget(0);
    assert_eq!(keyboard.pending_event_budget(), budget);
    drop(keyboard);
    let tablet = machine.tablet_input().unwrap();
    assert!(
        !tablet
            .borrow_mut()
            .inject_event(EV_ABS, pointer::ABS_X, 123)
    );
    tablet.borrow_mut().sync();
    let mouse = machine.mouse_input().unwrap();
    assert!(!mouse.borrow_mut().inject_event(EV_REL, pointer::REL_X, 3));
    mouse.borrow_mut().sync();
    machine.sbi_push_input(b"R");
    assert_eq!(machine.session_position(), position);
    assert_eq!(machine.save_session_resume().unwrap(), before);
}

#[test]
fn ordinary_host_handles_cannot_mutate_ready_or_completed_replay() {
    let (mut original, original_uart) = ordinary_input_fixture();
    original
        .start_session_sources(original.source_policy(), None)
        .unwrap();
    let begin = original.session_position().unwrap();
    let initial_resume = original.save_session_resume().unwrap();
    let first = witness(&mut original);
    run_to(&mut original, 4, 4);
    let end = original.session_position().unwrap();
    let events = original.take_session_deliveries().unwrap();
    let final_resume = original.save_session_resume().unwrap();
    let plan = ReplayPlan {
        begin,
        end,
        initial_resume,
        events,
        witnesses: vec![first, witness(&mut original)],
    };
    plan.validate().unwrap();

    // These really are live host controls outside replay; the guard is not an inert test.
    original_uart.borrow_mut().push_input(b"Q");
    assert_ne!(original.save_session_resume().unwrap(), final_resume);

    let (mut replay, uart) = ordinary_input_fixture();
    let mut driver = ReplayDriver::start(&mut replay, plan).unwrap();
    assert_ordinary_input_blocked(&mut replay, &uart);
    driver
        .run_to_end(&mut replay, 3, |_, _, _| unreachable!())
        .unwrap();
    assert_eq!(driver.status(), ReplayStatus::Completed);
    assert_eq!(replay.save_session_resume().unwrap(), final_resume);
    assert_ordinary_input_blocked(&mut replay, &uart);
}

fn apply_recorded_ordinary_input(
    machine: &mut Machine,
    uart: &Rc<std::cell::RefCell<wasm_vm_core::dev::uart16550::Uart16550>>,
    channel: u16,
    bytes: &[u8],
) -> [u64; 4] {
    use wasm_vm_core::dev::virtio::input::{EV_ABS, EV_KEY, EV_REL, keyboard, pointer};

    match channel {
        2 => {
            assert_eq!(bytes, b"Q");
            uart.borrow_mut().push_input(bytes);
        }
        3 => {
            assert_eq!(bytes, b"K");
            let state = machine.keyboard_input().unwrap();
            assert!(state.borrow_mut().inject_event(EV_KEY, keyboard::KEY_A, 1));
            state.borrow_mut().sync();
        }
        4 => {
            assert_eq!(bytes, b"T");
            let state = machine.tablet_input().unwrap();
            assert!(state.borrow_mut().inject_event(EV_ABS, pointer::ABS_X, 123));
            state.borrow_mut().sync();
        }
        5 => {
            assert_eq!(bytes, b"M");
            let state = machine.mouse_input().unwrap();
            assert!(state.borrow_mut().inject_event(EV_REL, pointer::REL_X, 3));
            state.borrow_mut().sync();
        }
        wasm_vm_core::session_replay::OUTPUT_DRAIN_CHANNEL => {
            assert_eq!(bytes, b"X");
            assert_eq!(uart.borrow_mut().take_output(), bytes);
        }
        _ => panic!("unexpected host channel"),
    }
    [0, bytes.len() as u64, 0, 0]
}

#[test]
fn recorded_host_callbacks_can_reach_uart_keyboard_and_pointer_during_replay() {
    use wasm_vm_core::session_replay::OUTPUT_DRAIN_CHANNEL;

    let (mut original, original_uart) = ordinary_input_fixture();
    original
        .start_session_sources(original.source_policy(), None)
        .unwrap();
    let begin = original.session_position().unwrap();
    let initial_resume = original.save_session_resume().unwrap();
    let first = witness(&mut original);
    run_to(&mut original, 4, 4);
    for (channel, bytes) in [
        (2, &b"Q"[..]),
        (3, &b"K"[..]),
        (4, &b"T"[..]),
        (5, &b"M"[..]),
        (OUTPUT_DRAIN_CHANNEL, &b"X"[..]),
    ] {
        original
            .stage_session_effect(
                4,
                SessionEffect::HostInput {
                    channel,
                    bytes: bytes.to_vec(),
                },
            )
            .unwrap();
        original
            .deliver_session_host_boundary(|machine, channel, bytes| {
                apply_recorded_ordinary_input(machine, &original_uart, channel, bytes)
            })
            .unwrap();
    }
    let events = original.take_session_deliveries().unwrap();
    let final_resume = original.save_session_resume().unwrap();
    let plan = ReplayPlan {
        begin,
        end: original.session_position().unwrap(),
        initial_resume,
        events,
        witnesses: vec![first, witness(&mut original)],
    };
    plan.validate().unwrap();

    let (mut replay, uart) = ordinary_input_fixture();
    let mut driver = ReplayDriver::start(&mut replay, plan.clone()).unwrap();
    driver
        .run_to_end(&mut replay, 3, |machine, channel, bytes| {
            apply_recorded_ordinary_input(machine, &uart, channel, bytes)
        })
        .unwrap();
    assert_eq!(driver.event_cursor(), plan.events.len());
    assert_eq!(driver.status(), ReplayStatus::Completed);
    assert_eq!(replay.save_session_resume().unwrap(), final_resume);
    assert_ordinary_input_blocked(&mut replay, &uart);
}

#[test]
fn missing_dma_bytes_and_changed_input_report_first_exact_mismatch() {
    let (plan, _) = record();
    let mut missing_dma = plan.clone();
    let SessionEffect::WriteRam { bytes, .. } = &mut missing_dma.events[1].effect else {
        panic!()
    };
    bytes.clear();
    let mut machine = fixture();
    let mut driver = ReplayDriver::start(&mut machine, missing_dma).unwrap();
    let failure = driver
        .run_to_end(&mut machine, 13, |_, _, _| [0, 1, 0, 0])
        .unwrap_err();
    assert_eq!(failure.reason, ReplayReason::StateDigest);
    assert_eq!(failure.position.transition, 10);
    assert_eq!(failure.position.sequence, 2);
    assert_eq!(driver.status(), ReplayStatus::Diverged);
    assert_eq!(driver.first_failure(), Some(&failure));

    let mut machine = fixture();
    let mut driver = ReplayDriver::start(&mut machine, plan).unwrap();
    let failure = driver
        .run_to_end(&mut machine, 7, |_, _, _| [1, 0, 0, 0])
        .unwrap_err();
    assert_eq!(failure.reason, ReplayReason::EventPayload);
    assert_eq!((failure.position.transition, failure.event_index), (0, 0));
}

#[test]
fn skipped_state_witness_reports_the_witness_coordinate_and_stays_poisoned() {
    let mut original = fixture();
    original
        .start_session_sources(original.source_policy(), None)
        .unwrap();
    let initial_resume = original.save_session_resume().unwrap();
    let first = witness(&mut original);
    run_to(&mut original, 5, 5);
    let skipped = witness(&mut original);
    run_to(&mut original, 20, 7);
    let plan = ReplayPlan {
        begin: first.position,
        end: original.session_position().unwrap(),
        initial_resume,
        events: vec![],
        witnesses: vec![first, skipped, witness(&mut original)],
    };
    plan.validate().unwrap();
    let mut replay = fixture();
    let mut driver = ReplayDriver::start(&mut replay, plan).unwrap();
    assert_eq!(
        replay.run_session_until(6, 6).unwrap(),
        RunOutcome::MaxInstrs
    );
    let failure = driver
        .run_to_end(&mut replay, 2, |_, _, _| unreachable!())
        .unwrap_err();
    assert_eq!(failure.reason, ReplayReason::StateDigest);
    assert_eq!(failure.position, skipped.position);
    assert_eq!(failure.detail, "missed exact state witness");
    assert_eq!(driver.first_failure(), Some(&failure));
    assert_eq!(
        driver.run_to_end(&mut replay, 3, |_, _, _| unreachable!()),
        Err(failure)
    );
}

#[test]
fn component_snapshot_failure_is_reported_at_the_exact_witness() {
    let machine = || {
        let mut machine = Machine::new(1 << 20);
        machine.enable_clint(1);
        machine.enable_plic();
        machine.enable_virtio_slots(None);
        machine.bus_mut().store32(BASE, 0x0010_8093).unwrap();
        machine.hart_mut().regs.pc = BASE;
        machine.start_session_clock(1).unwrap();
        machine
    };
    let mut original = machine();
    original
        .start_session_sources(original.source_policy(), None)
        .unwrap();
    let initial_resume = original.save_session_resume().unwrap();
    let first = witness(&mut original);
    run_to(&mut original, 1, 1);
    let last = witness(&mut original);
    let plan = ReplayPlan {
        begin: first.position,
        end: last.position,
        initial_resume,
        events: vec![],
        witnesses: vec![first, last],
    };
    plan.validate().unwrap();

    let mut replay = machine();
    let mut driver = ReplayDriver::start(&mut replay, plan).unwrap();
    // An extra drive cannot be represented by the exact session resume format. Injecting
    // it after admission makes the next witness serialization fail deterministically.
    replay.enable_virtio_blk_at(1, Box::new(MemBackend::new_read_only(vec![0; 512 * 4])));
    let failure = driver
        .run_to_end(&mut replay, 1, |_, _, _| unreachable!())
        .unwrap_err();
    assert_eq!(failure.reason, ReplayReason::Runtime);
    assert_eq!(failure.position, last.position);
    assert_eq!(failure.event_index, 0);
    assert!(
        failure
            .detail
            .contains("witness snapshot: BadComponentState")
    );
    assert_eq!(driver.first_failure(), Some(&failure));
}

#[test]
fn malformed_order_and_exhaustion_are_rejected_before_guest_run() {
    let (mut plan, _) = record();
    plan.events.swap(0, 1);
    let failure = plan.validate().unwrap_err();
    assert_eq!(failure.reason, ReplayReason::InvalidPlan);
    assert_eq!(failure.event_index, 0);
    let (mut plan, _) = record();
    let missing_position = plan.events.last().unwrap().position;
    plan.events.pop();
    let failure = plan.validate().unwrap_err();
    assert_eq!(failure.reason, ReplayReason::MissingEvent);
    assert_eq!(failure.position, missing_position);
    assert_eq!(failure.event_index, 1);
    assert!(failure.detail.contains("missing event sequence 2"));

    let mut without_exact_witness = plan.clone();
    without_exact_witness.witnesses.remove(2);
    let failure = without_exact_witness.validate().unwrap_err();
    assert_eq!(failure.reason, ReplayReason::MissingEvent);
    assert_eq!(failure.position, without_exact_witness.end);
    assert!(failure.detail.contains("declared end boundary"));

    let (mut extra, _) = record();
    extra.end.sequence -= 1;
    extra.witnesses.last_mut().unwrap().position = extra.end;
    let failure = extra.validate().unwrap_err();
    assert_eq!(failure.reason, ReplayReason::ExtraEvent);
    assert_eq!(failure.position, missing_position);
    assert_eq!(failure.event_index, 1);
}

#[test]
fn guest_rtc_entropy_observations_are_consumed_without_host_calls() {
    let (mut original, original_time, original_entropy) = observed_fixture(false, false);
    let policy = original.source_policy();
    original.start_session_sources(policy, None).unwrap();
    let initial_resume = original.save_session_resume().unwrap();
    let initial_witness = witness(&mut original);
    let end = OBSERVATION_PROGRAM.len() as u64 / 4;
    let mut events = Vec::new();
    while original.session_position().unwrap().transition < end {
        assert_eq!(
            original.run_session_until(end, 23).unwrap(),
            RunOutcome::MaxInstrs
        );
        events.extend(original.take_session_deliveries().unwrap());
    }
    assert!(original_time.get() > 0 && original_entropy.get() > 0);
    assert!(
        events
            .iter()
            .any(|event| matches!(event.effect, SessionEffect::Observation(_)))
    );
    let final_resume = original.save_session_resume().unwrap();
    let plan = ReplayPlan {
        begin: SessionPosition::default(),
        end: original.session_position().unwrap(),
        initial_resume,
        events,
        witnesses: vec![initial_witness, witness(&mut original)],
    };
    plan.validate().unwrap();
    for quantum in [1, 17, 128] {
        let (mut replay, time_calls, entropy_calls) = observed_fixture(true, quantum > 1);
        let mut driver = ReplayDriver::start(&mut replay, plan.clone()).unwrap();
        driver
            .run_to_end(&mut replay, quantum, |_, _, _| unreachable!())
            .unwrap();
        assert_eq!(replay.save_session_resume().unwrap(), final_resume);
        assert_eq!((time_calls.get(), entropy_calls.get()), (0, 0));
    }

    let mut wrong_ticket = plan.clone();
    let event_index = wrong_ticket
        .events
        .iter()
        .position(|event| matches!(event.effect, SessionEffect::Observation(_)))
        .unwrap();
    let first_observation = wrong_ticket.events[event_index].position;
    wrong_ticket.events[event_index].ticket ^= 1;
    wrong_ticket.validate().unwrap();
    for quantum in [1, 3, 19] {
        let (mut replay, time_calls, entropy_calls) = observed_fixture(true, quantum > 1);
        let mut driver = ReplayDriver::start(&mut replay, wrong_ticket.clone()).unwrap();
        let failure = driver
            .run_to_end(&mut replay, quantum, |_, _, _| unreachable!())
            .unwrap_err();
        assert_eq!(failure.reason, ReplayReason::EventPayload);
        assert_eq!(failure.position, first_observation);
        assert_eq!(failure.event_index, event_index);
        assert_eq!(driver.first_failure(), Some(&failure));
        assert_eq!((time_calls.get(), entropy_calls.get()), (0, 0));
    }

    let mut wrong_kind = plan.clone();
    let SessionEffect::Observation(value) = &mut wrong_kind.events[event_index].effect else {
        unreachable!()
    };
    value.kind = ObservationKind::Entropy;
    wrong_kind.validate().unwrap();
    for quantum in [1, 3, 19] {
        let (mut replay, time_calls, entropy_calls) = observed_fixture(true, quantum > 1);
        let mut driver = ReplayDriver::start(&mut replay, wrong_kind.clone()).unwrap();
        let failure = driver
            .run_to_end(&mut replay, quantum, |_, _, _| unreachable!())
            .unwrap_err();
        assert_eq!(failure.reason, ReplayReason::EventPayload);
        assert_eq!(failure.position, first_observation);
        assert_eq!(failure.event_index, event_index);
        assert_eq!((time_calls.get(), entropy_calls.get()), (0, 0));
    }

    let entropy_index = plan
        .events
        .iter()
        .position(|event| {
            matches!(&event.effect, SessionEffect::Observation(value)
                if value.kind == ObservationKind::Entropy && value.status == 0)
        })
        .expect("fixture records a supplied entropy request");
    let mut wrong_length = plan.clone();
    let SessionEffect::Observation(value) = &mut wrong_length.events[entropy_index].effect else {
        unreachable!()
    };
    value.requested += 1;
    value.bytes.push(0);
    wrong_length.validate().unwrap();
    let (mut replay, _, _) = observed_fixture(true, false);
    let mut driver = ReplayDriver::start(&mut replay, wrong_length).unwrap();
    let failure = driver
        .run_to_end(&mut replay, 19, |_, _, _| unreachable!())
        .unwrap_err();
    assert_eq!(failure.reason, ReplayReason::EventPayload);
    assert_eq!(failure.position, plan.events[entropy_index].position);
    assert_eq!(failure.event_index, entropy_index);
    assert!(failure.detail.contains("reason: Length"));

    let mut unavailable = plan.clone();
    let SessionEffect::Observation(value) = &mut unavailable.events[event_index].effect else {
        unreachable!()
    };
    value.status = 1;
    value.bytes.clear();
    unavailable.validate().unwrap();
    let (mut replay, time_calls, entropy_calls) = observed_fixture(true, false);
    let mut driver = ReplayDriver::start(&mut replay, unavailable).unwrap();
    let failure = driver
        .run_to_end(&mut replay, 19, |_, _, _| unreachable!())
        .unwrap_err();
    assert_eq!(failure.reason, ReplayReason::EventPayload);
    assert_eq!(failure.position, first_observation);
    // The unavailable observation itself is committed as a matching receipt; the
    // terminal provider failure therefore names the next expected event index.
    assert_eq!(failure.event_index, event_index + 1);
    assert!(failure.detail.contains("reason: ProviderUnavailable"));
    assert_eq!((time_calls.get(), entropy_calls.get()), (0, 0));

    let second_index = plan
        .events
        .iter()
        .enumerate()
        .filter(|(_, event)| {
            matches!(&event.effect, SessionEffect::Observation(value) if value.requested == 8)
        })
        .nth(1)
        .map(|(index, _)| index)
        .expect("fixture records multiple guest observations");
    let mut later_kind = plan.clone();
    let SessionEffect::Observation(value) = &mut later_kind.events[second_index].effect else {
        unreachable!()
    };
    value.kind = if value.kind == ObservationKind::RtcRead {
        ObservationKind::RtcPoll
    } else {
        ObservationKind::RtcRead
    };
    later_kind.validate().unwrap();
    let (mut replay, _, _) = observed_fixture(true, true);
    let mut driver = ReplayDriver::start(&mut replay, later_kind).unwrap();
    let failure = driver
        .run_to_end(&mut replay, 128, |_, _, _| unreachable!())
        .unwrap_err();
    assert_eq!(failure.reason, ReplayReason::EventPayload);
    assert_eq!(failure.position, plan.events[second_index].position);
    assert_eq!(failure.event_index, second_index);

    let mut wrong_position = plan.clone();
    let misordered_index = wrong_position
        .events
        .iter()
        .enumerate()
        .position(|(index, event)| {
            matches!(event.effect, SessionEffect::Observation(_))
                && event.position.ordinal == 1
                && event.position.transition + 1 < wrong_position.end.transition
                && (index == 0
                    || wrong_position.events[index - 1].position.transition
                        < event.position.transition)
                && wrong_position
                    .events
                    .get(index + 1)
                    .is_none_or(|next| next.position.transition > event.position.transition + 1)
        })
        .expect("fixture has an isolated observation before its declared end");
    let actual_position = wrong_position.events[misordered_index].position;
    wrong_position.events[misordered_index].position.transition += 1;
    wrong_position.validate().unwrap();
    let (mut replay, _, _) = observed_fixture(true, false);
    let mut driver = ReplayDriver::start(&mut replay, wrong_position).unwrap();
    let failure = driver
        .run_to_end(&mut replay, 19, |_, _, _| unreachable!())
        .unwrap_err();
    assert_eq!(failure.reason, ReplayReason::MisorderedEvent);
    assert_eq!(failure.position, actual_position);
    assert_eq!(failure.event_index, misordered_index);

    let earlier_index = plan
        .events
        .iter()
        .enumerate()
        .position(|(index, event)| {
            matches!(event.effect, SessionEffect::Observation(_))
                && event.position.ordinal == 1
                && event.position.transition >= 2
                && (index == 0
                    || plan.events[index - 1].position.transition + 1 < event.position.transition)
        })
        .expect("fixture has a movable observation coordinate");
    let mut expected_earlier = plan.clone();
    expected_earlier.events[earlier_index].position.transition -= 1;
    expected_earlier.events[earlier_index].position.retired -= 1;
    let first_expected = expected_earlier.events[earlier_index].position;
    expected_earlier.validate().unwrap();
    let (mut replay, _, _) = observed_fixture(true, false);
    let mut driver = ReplayDriver::start(&mut replay, expected_earlier).unwrap();
    let failure = driver
        .run_to_end(&mut replay, 19, |_, _, _| unreachable!())
        .unwrap_err();
    assert_eq!(failure.reason, ReplayReason::MisorderedEvent);
    assert_eq!(failure.position, first_expected);
    assert_eq!(failure.event_index, earlier_index);

    let mut missing_source = plan.clone();
    missing_source.events.clear();
    missing_source.end.sequence = missing_source.begin.sequence;
    missing_source.witnesses.last_mut().unwrap().position = missing_source.end;
    missing_source.validate().unwrap();
    let (mut replay, _, _) = observed_fixture(true, false);
    let mut driver = ReplayDriver::start(&mut replay, missing_source).unwrap();
    let failure = driver
        .run_to_end(&mut replay, 19, |_, _, _| unreachable!())
        .unwrap_err();
    assert_eq!(failure.reason, ReplayReason::MissingEvent);
    assert_eq!(failure.position, first_observation);
    assert_eq!(failure.event_index, 0);
}

#[test]
fn supported_embedding_and_end_guards_report_first_divergence() {
    let (mut original, _, _) = observed_fixture(false, false);
    original
        .start_session_sources(original.source_policy(), None)
        .unwrap();
    let initial_resume = original.save_session_resume().unwrap();
    let first = witness(&mut original);
    // Stop after the first observation cluster so every replay record is installed in the
    // initial source window; this attack is about bypassing the driver, not window rollover.
    let end_transition = 64;
    let mut events = Vec::new();
    while original.session_position().unwrap().transition < end_transition {
        assert_eq!(
            original.run_session_until(end_transition, 23).unwrap(),
            RunOutcome::MaxInstrs
        );
        events.extend(original.take_session_deliveries().unwrap());
    }
    assert!(!events.is_empty());
    let final_witness = witness(&mut original);
    let plan = ReplayPlan {
        begin: first.position,
        end: final_witness.position,
        initial_resume,
        events,
        witnesses: vec![first, final_witness],
    };
    plan.validate().unwrap();

    // `Machine::run_session_until` and `take_session_deliveries` are public embedding APIs.
    // If an embedding bypasses the driver with both, the driver must not mistake the matching
    // guest state for completed replay: its own event cursor still names the first receipt.
    let (mut bypassed, _, _) = observed_fixture(true, false);
    let mut bypass_driver = ReplayDriver::start(&mut bypassed, plan.clone()).unwrap();
    while bypassed.session_position().unwrap().transition < plan.end.transition {
        assert_eq!(
            bypassed.run_session_until(plan.end.transition, 19).unwrap(),
            RunOutcome::MaxInstrs
        );
    }
    assert_eq!(
        bypassed.take_session_deliveries().unwrap().len(),
        plan.events.len()
    );
    let failure = bypass_driver
        .run_to_end(&mut bypassed, 19, |_, _, _| unreachable!())
        .unwrap_err();
    assert_eq!(failure.reason, ReplayReason::MissingEvent);
    assert_eq!(failure.position, plan.events[0].position);
    assert_eq!(failure.event_index, 0);
    assert_eq!(failure.detail, "declared end retains unconsumed event");

    // Direct host MMIO is also a public embedding surface. An RTC source read outside a guest
    // run poisons the source scope and must surface as the first runtime divergence.
    let (mut outside, _, _) = observed_fixture(true, false);
    let mut outside_driver = ReplayDriver::start(&mut outside, plan).unwrap();
    assert!(
        outside
            .bus_mut()
            .load32(wasm_vm_core::platform::virt::RTC_BASE)
            .is_err()
    );
    let failure = outside_driver
        .run_to_end(&mut outside, 19, |_, _, _| unreachable!())
        .unwrap_err();
    assert_eq!(failure.reason, ReplayReason::Runtime);
    assert!(failure.detail.contains("OutsideRun"));
    assert_eq!(outside_driver.first_failure(), Some(&failure));

    // The same supported out-of-run source call can poison a replay immediately before a
    // recorded pending effect. That reaches the pending-delivery failure arm and must report the
    // recorded effect coordinate without applying it.
    let (mut pending_original, _, _) = observed_fixture(false, false);
    pending_original
        .start_session_sources(pending_original.source_policy(), None)
        .unwrap();
    let initial_resume = pending_original.save_session_resume().unwrap();
    let first = witness(&mut pending_original);
    pending_original
        .stage_session_effect(0, SessionEffect::ExternalPending(true))
        .unwrap();
    pending_original.deliver_session_boundary().unwrap();
    let event = pending_original
        .take_session_deliveries()
        .unwrap()
        .remove(0);
    let final_witness = witness(&mut pending_original);
    let plan = ReplayPlan {
        begin: first.position,
        end: final_witness.position,
        initial_resume,
        events: vec![event],
        witnesses: vec![first, final_witness],
    };
    plan.validate().unwrap();
    let (mut poisoned_pending, _, _) = observed_fixture(true, false);
    let mut pending_driver = ReplayDriver::start(&mut poisoned_pending, plan.clone()).unwrap();
    assert!(
        poisoned_pending
            .bus_mut()
            .load32(wasm_vm_core::platform::virt::RTC_BASE)
            .is_err()
    );
    let failure = pending_driver
        .run_to_end(&mut poisoned_pending, 19, |_, _, _| unreachable!())
        .unwrap_err();
    assert_eq!(failure.reason, ReplayReason::Adapter);
    assert_eq!(failure.position, plan.events[0].position);
    assert_eq!(failure.event_index, 0);
    assert!(failure.detail.contains("pending delivery"));
    assert!(failure.detail.contains("OutsideRun"));
    assert_eq!(pending_driver.first_failure(), Some(&failure));

    // A valid replayed receive at the declared end can leave the offline network queue
    // nonempty without any private-state tampering. Completion must therefore fail closed at
    // the end fence instead of publishing a Completed replay with unread recorded ingress.
    let mut network_original = network_fixture(false);
    network_original
        .start_session_sources(network_original.source_policy(), None)
        .unwrap();
    let initial_resume = network_original.save_session_resume().unwrap();
    let first = witness(&mut network_original);
    let event = capture_network(
        &mut network_original,
        NetworkEvent::Receive(vec![0x52, 0x58]),
    );
    let final_witness = witness(&mut network_original);
    let plan = ReplayPlan {
        begin: first.position,
        end: final_witness.position,
        initial_resume,
        events: vec![event],
        witnesses: vec![first, final_witness],
    };
    plan.validate().unwrap();
    let mut network_replay = network_fixture(true);
    let mut network_driver = ReplayDriver::start(&mut network_replay, plan.clone()).unwrap();
    let failure = network_driver
        .run_to_end(&mut network_replay, 19, |_, _, _| unreachable!())
        .unwrap_err();
    assert_eq!(failure.reason, ReplayReason::Exhausted);
    assert_eq!(failure.position, plan.end);
    assert_eq!(failure.event_index, 1);
    assert!(failure.detail.contains("network exhaustion: Exhausted"));
    assert_eq!(network_driver.first_failure(), Some(&failure));
}

#[test]
fn missing_observation_before_source_window_fence_reports_its_recorded_position() {
    const READS: usize = 600;
    const KEPT_READS: usize = 255;
    let program = |kept: usize| {
        std::iter::once(0x0010_1137u32)
            .chain(std::iter::repeat_n(0x0001_2183, kept))
            .chain(std::iter::repeat_n(0x0000_0013, READS - kept))
            .chain(std::iter::once(0x0000_0013))
            .flat_map(u32::to_le_bytes)
            .collect::<Vec<u8>>()
    };
    let (mut original, time_calls, _) = observed_fixture(false, false);
    original
        .bus_mut()
        .write_ram_slice(BASE, &program(READS))
        .unwrap();
    original
        .start_session_sources(original.source_policy(), None)
        .unwrap();
    let initial_resume = original.save_session_resume().unwrap();
    let initial_witness = witness(&mut original);
    let mut events = Vec::new();
    for transition in 1..=READS as u64 + 2 {
        original.run_session_until(transition, 1).unwrap();
        events.extend(original.take_session_deliveries().unwrap());
    }
    assert_eq!(events.len(), READS);
    assert_eq!(time_calls.get(), READS as u32);
    let plan = ReplayPlan {
        begin: SessionPosition::default(),
        end: original.session_position().unwrap(),
        initial_resume,
        events,
        witnesses: vec![initial_witness, witness(&mut original)],
    };
    plan.validate().unwrap();

    let (mut altered, _, _) = observed_fixture(false, false);
    altered
        .bus_mut()
        .write_ram_slice(BASE, &program(KEPT_READS))
        .unwrap();
    altered
        .start_session_sources(altered.source_policy(), None)
        .unwrap();
    let mut missing = plan.clone();
    missing.initial_resume = altered.save_session_resume().unwrap();
    missing.witnesses[0] = witness(&mut altered);
    let expected = missing.events[KEPT_READS].position;
    missing.validate().unwrap();

    let (mut replay, replay_time_calls, _) = observed_fixture(true, false);
    let mut driver = ReplayDriver::start(&mut replay, missing).unwrap();
    let failure = driver
        .run_to_end(&mut replay, 4096, |_, _, _| unreachable!())
        .unwrap_err();
    assert_eq!(failure.reason, ReplayReason::MissingEvent);
    assert_eq!(failure.position, expected);
    assert_eq!(failure.event_index, KEPT_READS);
    assert!(replay.session_position().unwrap().transition > expected.transition);
    assert_eq!(replay_time_calls.get(), 0);
}

#[test]
fn reordered_device_completions_replay_with_cpu_ram_and_disk_digest() {
    const START: u64 = 4096;
    const END_DEVICE: u64 = START + 5000;
    let mut original = device_fixture(false);
    original
        .start_session_sources(original.source_policy(), None)
        .unwrap();
    let initial_resume = original.save_session_resume().unwrap();
    let initial_witness = witness(&mut original);
    run_to(&mut original, START, 37);
    let requests = original.session_device_requests().unwrap();
    assert_eq!(requests.len(), 4);
    let pending_witness = witness(&mut original);
    let agent = requests
        .iter()
        .find(|r| matches!(r.intent, DeviceIntent::Agent { .. }))
        .unwrap();
    let audio = requests
        .iter()
        .find(|r| matches!(r.intent, DeviceIntent::Capture { .. }))
        .unwrap();
    let order = [
        requests[1].clone(),
        agent.clone(),
        audio.clone(),
        requests[0].clone(),
    ];
    let mut events = Vec::new();
    for (index, request) in order.iter().enumerate() {
        run_to(&mut original, START + index as u64 * 173, 29);
        let (bytes, frames) = match request.intent {
            DeviceIntent::BaseBlock { chunk, .. } => (disk_payload(chunk), 0),
            DeviceIntent::Agent { .. } => (b"file-agent-owned-result".to_vec(), 0),
            DeviceIntent::Capture { .. } => (vec![0x34, 0x12, 0xcd, 0xab], 2),
        };
        let lease = original.lease_session_device(request.id).unwrap();
        original
            .complete_session_device(&lease, CompletionStatus::Supplied, frames, bytes)
            .unwrap();
        events.extend(original.take_session_deliveries().unwrap());
    }
    run_to(&mut original, END_DEVICE, 101);
    let final_resume = original.save_session_resume().unwrap();
    let plan = ReplayPlan {
        begin: SessionPosition::default(),
        end: original.session_position().unwrap(),
        initial_resume,
        events,
        witnesses: vec![initial_witness, pending_witness, witness(&mut original)],
    };
    plan.validate().unwrap();
    for quantum in [1, 7, 4096] {
        let mut replay = device_fixture(true);
        replay.set_block_cache(quantum > 7);
        replay.set_interrupt_batching(quantum > 7);
        let mut driver = ReplayDriver::start(&mut replay, plan.clone()).unwrap();
        let SessionEffect::HostInput { bytes, .. } = &plan.events[0].effect else {
            panic!()
        };
        assert_eq!(
            replay.replay_session_device(
                plan.events[0].position,
                DeviceCompletion::decode(bytes).unwrap(),
            ),
            Err(DeviceError::ReplayIngress)
        );
        driver
            .run_to_end(&mut replay, quantum, |_, _, _| unreachable!())
            .unwrap();
        assert_eq!(replay.save_session_resume().unwrap(), final_resume);
        assert_eq!(replay.session_device_cursor().unwrap(), 4);
        assert_eq!(replay.bus_mut().load16(BASE + 0x12002).unwrap(), 2);
    }
    let mut omitted_dma = plan.clone();
    let SessionEffect::HostInput { bytes, .. } = &mut omitted_dma.events[0].effect else {
        panic!()
    };
    bytes.pop();
    let mut replay = device_fixture(true);
    let mut driver = ReplayDriver::start(&mut replay, omitted_dma).unwrap();
    let failure = driver
        .run_to_end(&mut replay, 67, |_, _, _| unreachable!())
        .unwrap_err();
    assert_eq!(failure.reason, ReplayReason::Adapter);
    assert_eq!(failure.position.transition, START);
    assert_eq!(failure.event_index, 0);
}

#[test]
fn network_events_replay_offline_with_exact_guest_frame() {
    const START_NET: u64 = 1024;
    const END_NET: u64 = START_NET + 8192;
    let mut original = network_fixture(false);
    original
        .start_session_sources(original.source_policy(), None)
        .unwrap();
    let initial_resume = original.save_session_resume().unwrap();
    let initial_witness = witness(&mut original);
    let mut events = vec![capture_network(
        &mut original,
        NetworkEvent::Link {
            status: LinkStatus::Open,
            code: 0,
        },
    )];
    run_to(&mut original, START_NET, 37);
    let request = original.session_network_requests().unwrap().remove(0);
    let pending_witness = witness(&mut original);
    events.push(capture_network(
        &mut original,
        NetworkEvent::Send {
            request,
            result: SendResult::Sent,
        },
    ));
    events.push(capture_network(&mut original, NetworkEvent::Pending(true)));
    let body = b"{\"count\":1,\"source\":\"recorded\"}\n";
    let response = format!(
        "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
        body.len()
    );
    let mut received = NETWORK_HEADER.to_vec();
    received[..6].copy_from_slice(&NETWORK_HEADER[6..12]);
    received[6..12].copy_from_slice(&NETWORK_HEADER[..6]);
    received.extend(response.as_bytes());
    received.extend(body);
    run_to(&mut original, START_NET + 97, 29);
    events.push(capture_network(
        &mut original,
        NetworkEvent::Receive(received.clone()),
    ));
    run_to(&mut original, START_NET + 113, 29);
    events.push(capture_network(
        &mut original,
        NetworkEvent::Link {
            status: LinkStatus::Closed,
            code: 0,
        },
    ));
    run_to(&mut original, END_NET, 101);
    let final_resume = original.save_session_resume().unwrap();
    let plan = ReplayPlan {
        begin: SessionPosition::default(),
        end: original.session_position().unwrap(),
        initial_resume,
        events,
        witnesses: vec![initial_witness, pending_witness, witness(&mut original)],
    };
    plan.validate().unwrap();
    for quantum in [1, 7, 4096] {
        let mut replay = network_fixture(true);
        replay.set_block_cache(quantum > 7);
        replay.set_interrupt_batching(quantum > 7);
        let mut driver = ReplayDriver::start(&mut replay, plan.clone()).unwrap();
        let SessionEffect::HostInput { bytes, .. } = &plan.events[0].effect else {
            panic!()
        };
        assert_eq!(
            replay.replay_session_network(
                plan.events[0].position,
                NetworkEvent::decode(bytes).unwrap(),
            ),
            Err(NetworkError::ReplayIngress)
        );
        assert!(matches!(
            replay.open_session_network_provider(|| panic!("live network factory")),
            Err(NetworkError::ReplayIngress)
        ));
        driver
            .run_to_end(&mut replay, quantum, |_, _, _| unreachable!())
            .unwrap();
        assert_eq!(replay.save_session_resume().unwrap(), final_resume);
        assert_eq!(replay.session_network_cursor().unwrap(), 5);
        for (i, byte) in received.iter().enumerate() {
            assert_eq!(
                replay.bus_mut().load8(BASE + 0x14000 + 12 + i as u64),
                Ok(*byte)
            );
        }
    }
}
