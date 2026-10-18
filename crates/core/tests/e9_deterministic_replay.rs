#![cfg(not(feature = "zicsr-stub"))]
use sha2::{Digest, Sha256};
use std::{cell::Cell, rc::Rc};
use wasm_vm_core::{
    Machine, RunOutcome,
    bus::{Bus, mmap::DRAM_BASE as BASE},
    dev::{
        rtc::WallClock,
        virtio::rng::{EntropySource, EntropyUnavailable},
    },
    session_clock::{SessionDelivery, SessionEffect, SessionPosition},
    session_devices::{BaseDisk, CompletionStatus, DeviceIntent, PayloadRef},
    session_network::{LinkStatus, NetworkError, NetworkEvent, SendResult},
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
fn malformed_order_and_exhaustion_are_rejected_before_guest_run() {
    let (mut plan, _) = record();
    plan.events.swap(0, 1);
    let failure = plan.validate().unwrap_err();
    assert_eq!(failure.reason, ReplayReason::InvalidPlan);
    assert_eq!(failure.event_index, 0);
    let (mut plan, _) = record();
    plan.events.pop();
    assert_eq!(
        plan.validate().unwrap_err().reason,
        ReplayReason::InvalidPlan
    );
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
