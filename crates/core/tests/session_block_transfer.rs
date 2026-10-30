//! The session block adapter assembles guest DMA locally. A guest write may
//! exceed one authenticated host completion without widening that envelope.
#![cfg(not(feature = "zicsr-stub"))]

use wasm_vm_core::block::SECTOR_SIZE;
use wasm_vm_core::bus::Bus;
use wasm_vm_core::platform::virt;
use wasm_vm_core::session_devices::{
    BaseDisk, CompletionStatus, DeviceError, DeviceIntent, MAX_BLOCK_TRANSFER, MAX_RESULT,
    PayloadRef,
};
use wasm_vm_core::{Machine, RunOutcome};

const BASE: u64 = virt::DRAM_BASE;
const SLOT: u64 = 0x1000_1000;
const DESC: u64 = BASE + 0x10_0000;
const AVAIL: u64 = BASE + 0x11_0000;
const USED: u64 = BASE + 0x12_0000;
const HDR: u64 = BASE + 0x13_0000;
const STATUS: u64 = BASE + 0x16_0000;
const DATA: u64 = BASE + 0x30_0000;
const READ: u64 = BASE + 0x50_0000;
const F_NEXT: u16 = 1;
const F_WRITE: u16 = 2;
const OBSERVED_COLD_WRITE: usize = 1_179_648;
const _: () = assert!(OBSERVED_COLD_WRITE > MAX_RESULT);

fn fixture() -> Machine {
    fixture_with_used(USED)
}

fn fixture_with_used(used: u64) -> Machine {
    let chunk = vec![0x63; 256 * 1024];
    let reference = PayloadRef::of(&chunk).unwrap();
    let mut machine = Machine::new(16 * 1024 * 1024);
    machine.enable_clint(1);
    machine.start_session_clock(1).unwrap();
    machine
        .enable_session_devices(
            Some(BaseDisk {
                identity: [0x37; 32],
                sectors: 32_768,
                chunk_bytes: chunk.len() as u32,
                chunks: vec![reference; 64],
            }),
            false,
            false,
            false,
        )
        .unwrap();
    machine.enable_builtin_sbi();
    machine.boot_supervisor(0, 0);
    machine
        .bus_mut()
        .store32(virt::KERNEL_BASE, 0x0000_006f)
        .unwrap();
    for status in [1, 3] {
        machine.bus_mut().store32(SLOT + 0x70, status).unwrap();
    }
    machine.bus_mut().store32(SLOT + 0x24, 0).unwrap();
    machine.bus_mut().store32(SLOT + 0x20, 0).unwrap();
    machine.bus_mut().store32(SLOT + 0x24, 1).unwrap();
    machine.bus_mut().store32(SLOT + 0x20, 1).unwrap();
    machine.bus_mut().store32(SLOT + 0x70, 11).unwrap();
    machine.bus_mut().store32(SLOT + 0x30, 0).unwrap();
    machine.bus_mut().store32(SLOT + 0x38, 8).unwrap();
    machine.bus_mut().store32(SLOT + 0x80, DESC as u32).unwrap();
    machine.bus_mut().store32(SLOT + 0x84, 0).unwrap();
    machine
        .bus_mut()
        .store32(SLOT + 0x90, AVAIL as u32)
        .unwrap();
    machine.bus_mut().store32(SLOT + 0x94, 0).unwrap();
    machine.bus_mut().store32(SLOT + 0xa0, used as u32).unwrap();
    machine
        .bus_mut()
        .store32(SLOT + 0xa4, (used >> 32) as u32)
        .unwrap();
    machine.bus_mut().store32(SLOT + 0x44, 1).unwrap();
    machine.bus_mut().store32(SLOT + 0x70, 15).unwrap();
    machine
}

fn descriptor(machine: &mut Machine, index: u64, addr: u64, len: u32, flags: u16, next: u16) {
    let at = DESC + index * 16;
    machine.bus_mut().store64(at, addr).unwrap();
    machine.bus_mut().store32(at + 8, len).unwrap();
    machine.bus_mut().store16(at + 12, flags).unwrap();
    machine.bus_mut().store16(at + 14, next).unwrap();
}

fn request(machine: &mut Machine, rtype: u32, sector: u64, data: u64, len: usize) {
    machine.bus_mut().store32(HDR, rtype).unwrap();
    machine.bus_mut().store32(HDR + 4, 0).unwrap();
    machine.bus_mut().store64(HDR + 8, sector).unwrap();
    descriptor(machine, 0, HDR, 16, F_NEXT, 1);
    let split = (len / 2 / SECTOR_SIZE) * SECTOR_SIZE;
    assert!(split > 0 && split < len);
    let data_flags = if rtype == 0 { F_WRITE | F_NEXT } else { F_NEXT };
    descriptor(machine, 1, data, split as u32, data_flags, 2);
    descriptor(
        machine,
        2,
        data + split as u64,
        (len - split) as u32,
        data_flags,
        3,
    );
    descriptor(machine, 3, STATUS, 1, F_WRITE, 0);
    machine.bus_mut().store8(STATUS, 0xa5).unwrap();
}

fn kick(machine: &mut Machine, sequence: u16) {
    machine
        .bus_mut()
        .store16(AVAIL + 4 + u64::from((sequence - 1) % 8) * 2, 0)
        .unwrap();
    machine.bus_mut().store16(AVAIL + 2, sequence).unwrap();
    machine.bus_mut().store32(SLOT + 0x50, 0).unwrap();
    assert_eq!(machine.run(4), RunOutcome::MaxInstrs);
}

fn submit(machine: &mut Machine, sequence: u16) -> u8 {
    kick(machine, sequence);
    assert_eq!(machine.bus_mut().load16(USED + 2).unwrap(), sequence);
    machine.bus_mut().load8(STATUS).unwrap()
}

#[test]
fn multichunk_read_parks_atomically_then_combines_base_and_overlay() {
    let mut machine = fixture();
    request(&mut machine, 0, 511, READ, 1024);
    kick(&mut machine, 1);
    assert_eq!(machine.bus_mut().load8(STATUS).unwrap(), 0xa5);
    assert_eq!(machine.bus_mut().load16(USED + 2).unwrap(), 0);
    let requests = machine.session_device_requests().unwrap();
    assert_eq!(requests.len(), 2);
    assert!(
        requests
            .iter()
            .any(|r| matches!(r.intent, DeviceIntent::BaseBlock { chunk: 0, .. }))
    );
    assert!(
        requests
            .iter()
            .any(|r| matches!(r.intent, DeviceIntent::BaseBlock { chunk: 1, .. }))
    );

    for chunk in [1, 0] {
        let request = requests
            .iter()
            .find(|r| matches!(r.intent, DeviceIntent::BaseBlock { chunk: c, .. } if c == chunk))
            .unwrap();
        let lease = machine.lease_session_device(request.id).unwrap();
        machine
            .complete_session_device(
                &lease,
                CompletionStatus::Supplied,
                0,
                vec![0x63; 256 * 1024],
            )
            .unwrap();
        assert_eq!(machine.take_session_deliveries().unwrap().len(), 1);
        assert_eq!(machine.run(4), RunOutcome::MaxInstrs);
        if chunk == 1 {
            assert_eq!(machine.bus_mut().load8(STATUS).unwrap(), 0xa5);
            assert_eq!(machine.bus_mut().load16(USED + 2).unwrap(), 0);
        }
    }
    assert_eq!(machine.bus_mut().load8(STATUS).unwrap(), 0);
    assert_eq!(machine.bus_mut().load16(USED + 2).unwrap(), 1);
    let mut result = vec![0; 1024];
    machine
        .bus_mut()
        .ram()
        .read_slice(READ, &mut result)
        .unwrap();
    assert_eq!(result, vec![0x63; 1024]);

    machine
        .bus_mut()
        .write_ram_slice(DATA, &vec![0xa7; 1024])
        .unwrap();
    request(&mut machine, 1, 510, DATA, 1024);
    assert_eq!(submit(&mut machine, 2), 0);
    let saved = machine.save_session_resume().unwrap();
    let mut restored = fixture();
    restored.load_session_resume(&saved).unwrap();
    for machine in [&mut machine, &mut restored] {
        request(machine, 0, 510, READ, 1536);
        assert_eq!(submit(machine, 3), 0);
        let mut result = vec![0; 1536];
        machine
            .bus_mut()
            .ram()
            .read_slice(READ, &mut result)
            .unwrap();
        assert_eq!(&result[..1024], &[0xa7; 1024]);
        assert_eq!(&result[1024..], &[0x63; 512]);
        assert!(machine.session_device_requests().unwrap().is_empty());
    }
    assert_eq!(
        machine.save_session_resume().unwrap(),
        restored.save_session_resume().unwrap()
    );
}

#[test]
fn read_at_dma_bound_fits_authenticated_pinned_cache() {
    let mut machine = fixture();
    request(&mut machine, 0, 1, READ, MAX_BLOCK_TRANSFER);
    kick(&mut machine, 1);
    assert_eq!(machine.bus_mut().load8(STATUS).unwrap(), 0xa5);
    assert_eq!(machine.bus_mut().load16(USED + 2).unwrap(), 0);
    let requests = machine.session_device_requests().unwrap();
    assert_eq!(requests.len(), 33, "unaligned start spans 33 base chunks");
    for request in requests {
        let lease = machine.lease_session_device(request.id).unwrap();
        machine
            .complete_session_device(
                &lease,
                CompletionStatus::Supplied,
                0,
                vec![0x63; 256 * 1024],
            )
            .unwrap();
        assert_eq!(machine.take_session_deliveries().unwrap().len(), 1);
        assert_eq!(machine.run(4), RunOutcome::MaxInstrs);
    }
    assert_eq!(machine.bus_mut().load8(STATUS).unwrap(), 0);
    assert_eq!(machine.bus_mut().load16(USED + 2).unwrap(), 1);
    let mut actual = vec![0; MAX_BLOCK_TRANSFER];
    machine
        .bus_mut()
        .ram()
        .read_slice(READ, &mut actual)
        .unwrap();
    assert!(actual.iter().all(|byte| *byte == 0x63));
    assert!(machine.session_device_requests().unwrap().is_empty());
}

#[test]
fn exact_write_bound_is_inclusive_and_roundtrips() {
    let mut machine = fixture();
    let payload: Vec<u8> = (0..MAX_BLOCK_TRANSFER)
        .map(|index| ((index / SECTOR_SIZE + index * 7) % 251) as u8)
        .collect();
    machine.bus_mut().write_ram_slice(DATA, &payload).unwrap();
    request(&mut machine, 1, 0, DATA, payload.len());
    assert_eq!(submit(&mut machine, 1), 0, "exact DMA ceiling is accepted");
    assert!(machine.session_device_requests().unwrap().is_empty());

    request(&mut machine, 0, 0, READ, payload.len());
    assert_eq!(submit(&mut machine, 2), 0, "COW bytes read back");
    let mut actual = vec![0; payload.len()];
    machine
        .bus_mut()
        .ram()
        .read_slice(READ, &mut actual)
        .unwrap();
    assert_eq!(actual, payload);
    assert!(machine.session_device_requests().unwrap().is_empty());
}

#[test]
fn large_split_session_write_roundtrips_and_restores_below_finite_dma_bound() {
    assert_eq!(MAX_BLOCK_TRANSFER, 8 << 20);
    assert_eq!(MAX_BLOCK_TRANSFER % SECTOR_SIZE, 0);
    let payload: Vec<u8> = (0..OBSERVED_COLD_WRITE)
        .map(|n| ((n * 17 + n / 512 * 3) % 251) as u8)
        .collect();
    let mut machine = fixture();
    #[cfg(feature = "cold-block-diagnostic")]
    {
        machine.enable_first_blk_failure_diagnostic();
        machine.enable_blk_log();
    }
    machine.bus_mut().write_ram_slice(DATA, &payload).unwrap();
    request(&mut machine, 1, 20_000, DATA, payload.len());
    assert_eq!(submit(&mut machine, 1), 0, "cold write reaches COW backend");
    #[cfg(feature = "cold-block-diagnostic")]
    {
        let log = machine.drain_blk_log();
        assert_eq!(log.len(), 1);
        assert_eq!(log[0].rtype, 1);
        assert_eq!(log[0].requested_bytes, OBSERVED_COLD_WRITE as u64);
        assert_eq!(log[0].len, 0, "OUT returns no guest payload");
        assert_eq!(log[0].status, 0);
        assert_eq!(log[0].head, 0);
        assert!(log[0].event_position.is_some());
        assert!(log[0].status_dma_written);
        assert!(log[0].used_ring_committed);
    }
    assert!(machine.session_device_requests().unwrap().is_empty());

    let frame = machine.save_session_resume().unwrap();
    let mut restored = fixture();
    restored.load_session_resume(&frame).unwrap();
    assert_eq!(restored.save_session_resume().unwrap(), frame);
    for machine in [&mut machine, &mut restored] {
        request(machine, 0, 20_000, READ, payload.len());
        assert_eq!(
            submit(machine, 2),
            0,
            "COW read completes without host input"
        );
        let mut actual = vec![0; payload.len()];
        machine
            .bus_mut()
            .ram()
            .read_slice(READ, &mut actual)
            .unwrap();
        assert_eq!(actual, payload);
        assert!(machine.session_device_requests().unwrap().is_empty());
    }
    assert_eq!(
        machine.save_session_resume().unwrap(),
        restored.save_session_resume().unwrap()
    );

    let mut above = fixture();
    request(&mut above, 1, 0, DATA, MAX_BLOCK_TRANSFER + SECTOR_SIZE);
    assert_eq!(submit(&mut above, 1), 1, "one sector above DMA cap");
    assert!(above.session_device_requests().unwrap().is_empty());
    let mut outside = fixture();
    request(&mut outside, 1, 32_767, DATA, 1024);
    assert_eq!(submit(&mut outside, 1), 1, "range past disk capacity");
    assert!(outside.session_device_requests().unwrap().is_empty());
    assert!(matches!(
        PayloadRef::of(&vec![0; MAX_RESULT + 1]),
        Err(DeviceError::Limit)
    ));
}

#[cfg(feature = "cold-block-diagnostic")]
#[test]
fn diagnostic_backend_success_requires_a_real_status_dma_and_used_commit() {
    for invalid_status in [true, false] {
        let mut machine = if invalid_status {
            fixture()
        } else {
            fixture_with_used(BASE + 16 * 1024 * 1024 - 8)
        };
        machine.enable_first_blk_failure_diagnostic();
        machine.enable_blk_log();
        let payload = vec![0x39; OBSERVED_COLD_WRITE];
        machine.bus_mut().write_ram_slice(DATA, &payload).unwrap();
        request(&mut machine, 1, 20_000, DATA, payload.len());
        if invalid_status {
            descriptor(&mut machine, 3, u64::MAX - 1, 1, F_WRITE, 0);
        }
        kick(&mut machine, 1);
        let log = machine.drain_blk_log();
        if invalid_status {
            assert!(
                log.is_empty(),
                "an invalid status descriptor is rejected before execution"
            );
            assert_eq!(machine.bus_mut().load16(USED + 2).unwrap(), 0);
            continue;
        }
        assert_eq!(log.len(), 1, "the valid request reaches the backend");
        assert_eq!(log[0].status, 0, "the backend accepted the write");
        assert_eq!(log[0].requested_bytes, OBSERVED_COLD_WRITE as u64);
        assert!(log[0].status_dma_written);
        assert!(!log[0].used_ring_committed);
        assert!(machine.first_blk_failure().is_none());
    }
}
