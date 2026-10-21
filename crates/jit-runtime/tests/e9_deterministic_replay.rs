//! Full software-session replay across a UART timeout with real Wasmtime execution.
use jit_runtime::WasmtimeExecutor;
use sha2::{Digest, Sha256};
use std::{cell::RefCell, fmt::Write, path::Path, rc::Rc};
use wasm_vm_core::{
    Machine, RunOutcome,
    bus::{Bus, mmap::DRAM_BASE as BASE},
    dev::{
        rtc::WallClock,
        uart16550::Uart16550,
        virtio::rng::{EntropySource, EntropyUnavailable},
    },
    session_clock::SessionEffect,
    session_devices::{BaseDisk, PayloadRef},
    session_replay::{ReplayDriver, ReplayPlan, ReplayStatus, StateWitness},
    trace::{TraceRecord, TraceSink, fmt_canonical},
};
use wasm_vm_storage::ImageManifest;

struct Time;
impl WallClock for Time {
    fn now_ns(&self) -> u64 {
        1_700_000_000_123_456_789
    }
}
struct Entropy;
impl EntropySource for Entropy {
    fn fill(&mut self, output: &mut [u8]) {
        output.fill(31);
    }
    fn try_fill(&mut self, output: &mut [u8]) -> Result<(), EntropyUnavailable> {
        self.fill(output);
        Ok(())
    }
}

fn base_disk() -> BaseDisk {
    let path = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../web/session-alpine-image.json");
    let manifest = ImageManifest::from_json(&std::fs::read_to_string(path).unwrap()).unwrap();
    BaseDisk {
        identity: manifest.base_hash(),
        sectors: manifest.image_len / 512,
        chunk_bytes: manifest.chunk_size,
        chunks: manifest
            .chunks
            .iter()
            .enumerate()
            .map(|(index, hash)| PayloadRef {
                sha256: std::array::from_fn(|i| {
                    u8::from_str_radix(&hash[i * 2..i * 2 + 2], 16).unwrap()
                }),
                length: (manifest.image_len - index as u64 * u64::from(manifest.chunk_size))
                    .min(u64::from(manifest.chunk_size)) as u32,
            })
            .collect(),
    }
}

fn addi(rd: u32, rs: u32, immediate: i32) -> u32 {
    ((immediate as u32) << 20) | (rs << 15) | (rd << 7) | 0x13
}

fn machine(jit: bool, replay: bool) -> (Machine, Rc<RefCell<Uart16550>>) {
    let mut machine = Machine::new(wasm_vm_core::session_profile::RAM_BYTES);
    let uart = machine
        .install_full_software_session(
            base_disk(),
            Box::new(Time),
            Box::new(Entropy),
            [9; 32],
            replay,
        )
        .unwrap();
    for (index, word) in [
        addi(1, 1, 1),
        addi(2, 2, 3),
        addi(3, 3, 5),
        addi(4, 4, 7),
        addi(5, 5, 11),
        0xfedff06f, // jal x0,-20
    ]
    .into_iter()
    .enumerate()
    {
        machine
            .bus_mut()
            .store32(BASE + index as u64 * 4, word)
            .unwrap();
    }
    machine.hart_mut().regs.pc = BASE;
    machine.set_block_cache(jit);
    machine.set_interrupt_batching(jit);
    if jit {
        machine.set_executor(Box::new(WasmtimeExecutor::new()));
        machine.set_hotness_threshold(1);
        machine.set_jit(true);
    }
    (machine, uart)
}

fn run_to(machine: &mut Machine, target: u64, quantum: u64) {
    while machine.session_position().unwrap().transition < target {
        assert_eq!(
            machine.run_session_until(target, quantum),
            Ok(RunOutcome::MaxInstrs)
        );
    }
}

#[derive(Default)]
struct GuestTrace(String);
impl TraceSink for GuestTrace {
    fn retire(&mut self, record: &TraceRecord) {
        writeln!(self.0, "{}", fmt_canonical(record)).unwrap();
    }
}

fn run_to_traced(machine: &mut Machine, target: u64, quantum: u64, trace: &mut GuestTrace) {
    while machine.session_position().unwrap().transition < target {
        let remaining = target - machine.session_position().unwrap().transition;
        assert_eq!(
            machine.run_traced(quantum.min(remaining), trace),
            RunOutcome::MaxInstrs
        );
    }
}

fn witness(machine: &mut Machine) -> StateWitness {
    StateWitness {
        position: machine.session_position().unwrap(),
        resume_sha256: Sha256::digest(machine.save_session_resume().unwrap()).into(),
    }
}

#[test]
fn full_profile_real_jit_replay_matches_interpreter_at_uart_timeout_for_all_quanta() {
    let trace_dir = std::env::var_os("E9_T14_GUEST_TRACE_DIR");
    let mut trace = trace_dir.as_ref().map(|_| GuestTrace::default());
    let (mut original, uart) = machine(false, false);
    original
        .start_session_sources(original.source_policy(), None)
        .unwrap();
    let begin = original.session_position().unwrap();
    let initial_resume = original.save_session_resume().unwrap();
    let mut witnesses = vec![witness(&mut original)];
    if let Some(trace) = trace.as_mut() {
        run_to_traced(&mut original, 64, 17, trace);
    } else {
        run_to(&mut original, 64, 17);
    }
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
    if let Some(trace) = trace.as_mut() {
        run_to_traced(&mut original, 4096, 103, trace);
    } else {
        run_to(&mut original, 4096, 103);
    }
    events.extend(original.take_session_deliveries().unwrap());
    witnesses.push(witness(&mut original));
    let expected = original.save_session_resume().unwrap();
    if let (Some(dir), Some(trace)) = (trace_dir, trace) {
        let dir = std::path::PathBuf::from(dir);
        std::fs::create_dir_all(&dir).unwrap();
        assert_eq!(trace.0.lines().count(), 4096);
        std::fs::write(dir.join("guest-instructions.trace"), trace.0).unwrap();
        std::fs::write(
            dir.join("complete-resume.sha256"),
            Sha256::digest(&expected),
        )
        .unwrap();
    }
    let plan = ReplayPlan {
        begin,
        end: original.session_position().unwrap(),
        initial_resume,
        events,
        witnesses,
    };
    plan.validate().unwrap();

    for quantum in [1, 7, 173, 4096] {
        let (mut replay, uart) = machine(true, true);
        let mut driver = ReplayDriver::start(&mut replay, plan.clone()).unwrap();
        driver
            .run_to_end(&mut replay, quantum, |_, channel, bytes| {
                assert_eq!(channel, 2);
                uart.borrow_mut().push_input(bytes);
                [0, bytes.len() as u64, 0, 0]
            })
            .unwrap();
        assert_eq!(driver.status(), ReplayStatus::Completed);
        assert_eq!(
            replay.save_session_resume().unwrap(),
            expected,
            "quantum={quantum}"
        );
        let retired_via_jit = replay.executor().unwrap().retired_via_jit();
        if quantum >= 7 {
            assert!(retired_via_jit > 0, "quantum={quantum} never ran Wasmtime");
        }
        println!("quantum={quantum} retired_via_jit={retired_via_jit}");
    }
}
