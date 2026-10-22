#![cfg(all(feature = "std", not(feature = "zicsr-stub")))]
//! Real guest named-agent DMA with the recorder disabled. This bounded device fixture is not
//! the pinned Linux performance workload. The test's external trace sink is evidence only.
use sha2::{Digest, Sha256};
use std::fmt::Write;
use wasm_vm_core::{
    Machine, RunOutcome,
    bus::{Bus, mmap::DRAM_BASE as BASE},
    dev::{rtc::FixedClock, virtio::rng::EntropySource},
    session_clock::SessionError,
    session_devices::{BaseDisk, CompletionStatus, DeviceError, DeviceIntent, PayloadRef},
    session_profile::ExecutionMode,
    trace::{TraceRecord, TraceSink, fmt_canonical},
};

const ORIGINAL: &[u8] = include_bytes!("../../../web/assets/e9-device-completions.bin");
const PAYLOAD: &[u8] = b"off-owned-agent-receive";

struct Entropy;
impl EntropySource for Entropy {
    fn fill(&mut self, bytes: &mut [u8]) {
        bytes.fill(17);
    }
}
#[derive(Default)]
struct Evidence {
    text: String,
    retired: u64,
}
impl TraceSink for Evidence {
    fn retire(&mut self, record: &TraceRecord) {
        writeln!(self.text, "{}", fmt_canonical(record)).unwrap();
        self.retired += 1;
    }
}

#[test]
fn unrecorded_original_agent_receive_reaches_guest_dma_and_refuses_bad_or_duplicate_results() {
    assert_eq!(
        format!("{:x}", Sha256::digest(ORIGINAL)),
        "7a1a40c2c4ed19b83e4b0d2a85b71a394dceb674f1c691125cddd2d67ef25092"
    );
    // T12's console is in slot 7; the full production profile reserves slot 8 for the agent.
    // Change only its LUI address materializations, leaving block/sound and guest assertions intact.
    let mut guest = ORIGINAL.to_vec();
    let mut patches = 0;
    for bytes in guest.chunks_exact_mut(4) {
        let word = u32::from_le_bytes(bytes.try_into().unwrap());
        if word & 0x7f == 0x37 && word & 0xffff_f000 == 0x1000_8000 {
            bytes.copy_from_slice(&((word & 0xfff) | 0x1000_9000).to_le_bytes());
            patches += 1;
        }
    }
    assert_eq!(patches, 13);
    let data = vec![0x5a; 512];
    let base = BaseDisk {
        identity: [37; 32],
        sectors: 2,
        chunk_bytes: 512,
        chunks: vec![PayloadRef::of(&data).unwrap(); 2],
    };
    let mut machine = Machine::new(256 << 20);
    machine
        .install_full_software_mode(
            base,
            Box::new(FixedClock(123)),
            Box::new(Entropy),
            [9; 32],
            ExecutionMode::LiveUnrecorded,
        )
        .unwrap();
    machine.bus_mut().write_ram_slice(BASE, &guest).unwrap();
    machine.hart_mut().regs.pc = BASE;
    let mut trace = Evidence::default();
    assert_eq!(machine.run_traced(4096, &mut trace), RunOutcome::MaxInstrs);
    let requests = machine.session_device_requests().unwrap();
    assert_eq!(
        requests.len(),
        3,
        "two block reads and original agent receive"
    );
    let request = requests
        .iter()
        .find(|request| matches!(request.intent, DeviceIntent::Agent { .. }))
        .unwrap();
    let lease = machine.lease_session_device(request.id).unwrap();
    let before = machine.snapshot();
    assert_eq!(machine.session_device_cursor(), Ok(0));
    assert_eq!(
        machine.complete_session_device(&lease, CompletionStatus::Supplied, 0, vec![0xee; 257]),
        Err(DeviceError::Payload)
    );
    assert_eq!(machine.snapshot(), before);
    assert_eq!(machine.session_device_cursor(), Ok(0));
    machine
        .complete_session_device(&lease, CompletionStatus::Supplied, 0, PAYLOAD.to_vec())
        .unwrap();
    let supplied = machine.snapshot();
    assert_eq!(
        machine.complete_session_device(&lease, CompletionStatus::Supplied, 0, PAYLOAD.to_vec()),
        Err(DeviceError::UnknownRequest)
    );
    assert_eq!(machine.snapshot(), supplied);
    assert_eq!(machine.session_device_cursor(), Ok(1));
    assert_eq!(machine.run_traced(5000, &mut trace), RunOutcome::MaxInstrs);
    let observed: Vec<u8> = (0..PAYLOAD.len())
        .map(|index| {
            machine
                .bus_mut()
                .load8(BASE + 0x24000 + index as u64)
                .unwrap()
        })
        .collect();
    assert_eq!(observed, PAYLOAD);
    let used = machine.bus_mut().load16(BASE + 0x22402).unwrap();
    assert_eq!(used, 1);
    assert_eq!(machine.session_position(), None);
    assert!(!machine.session_sources_active());
    assert!(!machine.recorder_dirty_tracking());
    assert_eq!(
        machine.take_session_deliveries(),
        Err(SessionError::Inactive)
    );
    let work = machine.live_unrecorded_work().unwrap();
    assert_eq!(
        (work.transitions, work.retired, work.idle_transitions),
        (9096, 9096, 0)
    );
    assert_eq!(trace.retired, 9096);
    let summary = format!(
        "transitions={}\nretired={}\nidle={}\nprovider_cursor={}\nused_idx={}\nsession_clock={}\nsource_capture={}\nrecorder_dirty={}\n",
        work.transitions,
        work.retired,
        work.idle_transitions,
        machine.session_device_cursor().unwrap(),
        used,
        machine.session_position().is_some(),
        machine.session_sources_active(),
        machine.recorder_dirty_tracking()
    );
    println!(
        "HELD original-agent DMA: {summary}digest={}",
        machine.snapshot().hex_digest()
    );
    if let Some(directory) = std::env::var_os("E9_UNRECORDED_AGENT_EVIDENCE") {
        let directory = std::path::PathBuf::from(directory);
        std::fs::create_dir_all(&directory).unwrap();
        std::fs::write(directory.join("guest.bin"), guest).unwrap();
        std::fs::write(directory.join("guest.trace"), trace.text).unwrap();
        std::fs::write(directory.join("agent-dma.bin"), observed).unwrap();
        std::fs::write(directory.join("summary.txt"), summary).unwrap();
        std::fs::write(
            directory.join("state-digest.txt"),
            machine.snapshot().hex_digest(),
        )
        .unwrap();
    }
}
