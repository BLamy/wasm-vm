//! E3-T12d snapshot-store schema + chunking codec tests (native, browser-agnostic).

use super::*;
use alloc::collections::BTreeMap;
use alloc::vec;
use alloc::vec::Vec;

const BASE: [u8; 32] = [0xAB; 32];
const DIGEST: [u8; 32] = [0xD1; 32];

fn split(blob: &[u8]) -> BTreeMap<u64, Vec<u8>> {
    blob.chunks(SNAPSHOT_CHUNK)
        .enumerate()
        .map(|(i, c)| (i as u64, c.to_vec()))
        .collect()
}

#[test]
fn store_name_is_namespaced_hex() {
    let name = snapshot_store_name(&BASE);
    assert_eq!(name.len(), 5 + 64);
    assert!(name.starts_with("wvsn-"));
    assert!(name.ends_with(&"ab".repeat(32)));
    // Different base → different store (no cross-contamination).
    assert_ne!(snapshot_store_name(&[0x00; 32]), name);
}

#[test]
fn chunk_count_math() {
    assert_eq!(chunk_count_for(0, SNAPSHOT_CHUNK as u64), 0);
    assert_eq!(chunk_count_for(1, SNAPSHOT_CHUNK as u64), 1);
    assert_eq!(
        chunk_count_for(SNAPSHOT_CHUNK as u64, SNAPSHOT_CHUNK as u64),
        1
    );
    assert_eq!(
        chunk_count_for(SNAPSHOT_CHUNK as u64 + 1, SNAPSHOT_CHUNK as u64),
        2
    );
    assert_eq!(chunk_count_for(100, 0), 0); // div-by-zero safe
}

#[test]
fn meta_round_trips() {
    let m = SnapshotMeta::new(3 * SNAPSHOT_CHUNK as u64 + 123, BASE, DIGEST);
    assert_eq!(m.chunk_count, 4);
    let parsed = SnapshotMeta::from_bytes(&m.to_bytes()).unwrap();
    assert_eq!(parsed, m);
}

#[test]
fn meta_rejects_bad_magic_and_length() {
    let mut b = SnapshotMeta::new(10, BASE, DIGEST).to_bytes();
    assert!(SnapshotMeta::from_bytes(&b[..b.len() - 1]).is_err());
    b[0] ^= 0xFF;
    assert_eq!(
        SnapshotMeta::from_bytes(&b),
        Err(SnapshotStoreError::BadMeta)
    );
}

#[test]
fn meta_rejects_inconsistent_chunk_count() {
    // A hand-doctored meta whose chunk_count disagrees with total_len ÷ chunk_size is refused, so it
    // can never be trusted to bound a reassembly read.
    let mut b = SnapshotMeta::new(2 * SNAPSHOT_CHUNK as u64, BASE, DIGEST).to_bytes();
    // chunk_count is the u64 at offset 20; bump it.
    b[20] = b[20].wrapping_add(5);
    assert_eq!(
        SnapshotMeta::from_bytes(&b),
        Err(SnapshotStoreError::BadMeta)
    );
}

#[test]
fn expected_chunk_len_last_is_remainder() {
    let m = SnapshotMeta::new(SNAPSHOT_CHUNK as u64 + 17, BASE, DIGEST);
    assert_eq!(m.chunk_count, 2);
    assert_eq!(m.expected_chunk_len(0), Some(SNAPSHOT_CHUNK));
    assert_eq!(m.expected_chunk_len(1), Some(17));
    assert_eq!(m.expected_chunk_len(2), None);
}

#[test]
fn reassemble_round_trips_multi_chunk() {
    // A blob spanning >2 chunks with a short final chunk, byte-identical after split→reassemble.
    let blob: Vec<u8> = (0..(2 * SNAPSHOT_CHUNK + 500))
        .map(|i| (i * 31 + 7) as u8)
        .collect();
    let m = SnapshotMeta::new(blob.len() as u64, BASE, DIGEST);
    assert_eq!(m.chunk_count, 3);
    let back = reassemble(&m, split(&blob)).unwrap();
    assert_eq!(back, blob);
}

#[test]
fn reassemble_empty_blob() {
    let m = SnapshotMeta::new(0, BASE, DIGEST);
    assert_eq!(m.chunk_count, 0);
    assert_eq!(reassemble(&m, BTreeMap::new()).unwrap(), Vec::<u8>::new());
}

#[test]
fn reassemble_detects_missing_chunk() {
    let blob = vec![9u8; 2 * SNAPSHOT_CHUNK + 4];
    let m = SnapshotMeta::new(blob.len() as u64, BASE, DIGEST);
    let mut chunks = split(&blob);
    chunks.remove(&1); // drop the middle chunk — a torn store
    assert_eq!(
        reassemble(&m, chunks),
        Err(SnapshotStoreError::TornChunk { index: 1 })
    );
}

#[test]
fn reassemble_detects_short_chunk() {
    let blob = vec![3u8; SNAPSHOT_CHUNK + 10];
    let m = SnapshotMeta::new(blob.len() as u64, BASE, DIGEST);
    let mut chunks = split(&blob);
    // Truncate chunk 0 (a partially-written / corrupt chunk).
    chunks.get_mut(&0).unwrap().truncate(SNAPSHOT_CHUNK - 1);
    assert_eq!(
        reassemble(&m, chunks),
        Err(SnapshotStoreError::TornChunk { index: 0 })
    );
}

#[test]
fn reassemble_detects_oversized_final_chunk() {
    let blob = vec![1u8; SNAPSHOT_CHUNK + 5];
    let m = SnapshotMeta::new(blob.len() as u64, BASE, DIGEST);
    let mut chunks = split(&blob);
    chunks.get_mut(&1).unwrap().extend_from_slice(&[0, 0, 0]); // last chunk too long
    assert_eq!(
        reassemble(&m, chunks),
        Err(SnapshotStoreError::TornChunk { index: 1 })
    );
}
