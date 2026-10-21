use wasm_vm_core::{Machine, bus::Bus, ram::KEYFRAME_PAGE_BYTES, resume::SnapshotError};

const RAM_BYTES: usize = 2 << 20;
const BASE: u64 = 0x8000_0000;

fn machine() -> Machine {
    let mut machine = Machine::new(RAM_BYTES);
    machine.start_session_clock(1).unwrap();
    machine
}

fn frozen_chunks(machine: &mut Machine) -> Vec<Vec<u8>> {
    let ram = machine.bus_mut().ram();
    let mut cursor = 0;
    let mut chunks = Vec::new();
    while let Some((next, bytes)) = ram.next_pending_delta_chunk(cursor).unwrap() {
        assert!(next > cursor);
        cursor = next;
        chunks.push(bytes);
    }
    chunks
}

#[test]
fn full_base_and_two_deltas_reconstruct_exact_machine_state() {
    let mut source = machine();
    source.bus_mut().store32(BASE, 0x1122_3344).unwrap();
    let full = source.save_session_resume().unwrap();
    source.bus_mut().ram_mut().begin_dirty_epoch().unwrap();
    source.bus_mut().ram_mut().finish_dirty_epoch(true).unwrap();

    // One CPU store and one device-style DMA crossing two physical RAM pages.
    source
        .bus_mut()
        .store64(BASE + 16, 0x1234_5678_9abc_def0)
        .unwrap();
    source
        .bus_mut()
        .write_ram_slice(BASE + KEYFRAME_PAGE_BYTES as u64 - 2, &[1, 2, 3, 4])
        .unwrap();
    source.hart_mut().regs.pc = BASE + 4;
    source.bus_mut().ram_mut().begin_dirty_epoch().unwrap();
    let first_state = source.save_session_state_without_ram().unwrap();
    let first_chunks = frozen_chunks(&mut source);
    let first_digest = source.snapshot().mem_digest;
    source.bus_mut().ram_mut().finish_dirty_epoch(true).unwrap();

    // Revert an earlier byte; it must still be represented by the later delta.
    source.bus_mut().store32(BASE, 0x1122_3344).unwrap();
    source.bus_mut().store8(BASE + 16, 0).unwrap();
    source.hart_mut().regs.pc = BASE + 8;
    source.bus_mut().ram_mut().begin_dirty_epoch().unwrap();
    let second_state = source.save_session_state_without_ram().unwrap();
    let second_chunks = frozen_chunks(&mut source);
    let second_digest = source.snapshot().mem_digest;
    source.bus_mut().ram_mut().finish_dirty_epoch(true).unwrap();
    let independent_full = source.save_session_resume().unwrap();

    let mut restored = machine();
    restored.seed_session_ram_from_full_resume(&full).unwrap();
    for chunk in &first_chunks {
        restored.apply_session_ram_delta_chunk(chunk).unwrap();
    }
    assert_eq!(restored.snapshot().mem_digest, first_digest);
    for chunk in &second_chunks {
        restored.apply_session_ram_delta_chunk(chunk).unwrap();
    }
    restored
        .load_session_state_without_ram(&second_state, &second_digest)
        .unwrap();
    assert_eq!(restored.save_session_resume().unwrap(), independent_full);
    assert!(!first_state.is_empty());
}

#[test]
fn omitted_ancestor_refuses_state_commit_at_ram_digest_gate() {
    let mut source = machine();
    let full = source.save_session_resume().unwrap();
    source.bus_mut().store32(BASE + 4096, 0xaabb_ccdd).unwrap();
    source.bus_mut().ram_mut().begin_dirty_epoch().unwrap();
    let state = source.save_session_state_without_ram().unwrap();
    let expected = source.snapshot().mem_digest;
    let mut candidate = machine();
    candidate.seed_session_ram_from_full_resume(&full).unwrap();
    let before = candidate.save_session_resume().unwrap();
    assert_eq!(
        candidate.load_session_state_without_ram(&state, &expected),
        Err(SnapshotError::RamDigestMismatch)
    );
    assert_eq!(candidate.save_session_resume().unwrap(), before);
}
