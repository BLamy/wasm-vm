//! Independent literal sparse-wire probes for the in-place RAM restore boundary.
use wasm_vm_core::{
    ram::Ram,
    resume::{ComponentSnapshot, SnapshotError},
};

const BASE: u64 = 0x8123_4000;
const LEN: usize = 8197;

fn run(out: &mut Vec<u8>, kind: u8, len: u32, bytes: &[u8]) {
    out.push(kind);
    out.extend_from_slice(&len.to_le_bytes());
    out.extend_from_slice(bytes);
}

fn literal_image() -> (Vec<u8>, Vec<u8>) {
    // Do not use encode_sparse to derive the oracle or the input framing.
    let mut wire = Vec::new();
    let mut expected = vec![0; LEN];
    let first: Vec<_> = (0..513).map(|i| ((i * 37 + 11) % 256) as u8).collect();
    let last = [0x19, 0x00, 0x87, 0xfe, 0x55, 0x33, 0xa1];
    run(&mut wire, 1, first.len() as u32, &first);
    run(&mut wire, 0, (LEN - first.len() - last.len()) as u32, &[]);
    run(&mut wire, 1, last.len() as u32, &last);
    expected[..first.len()].copy_from_slice(&first);
    expected[LEN - last.len()..].copy_from_slice(&last);
    (wire, expected)
}

fn nonzero_ram() -> Ram {
    let mut ram = Ram::with_base(BASE, LEN).unwrap();
    ram.write_slice(BASE, &vec![0xa7; LEN]).unwrap();
    ram
}

#[test]
fn every_sparse_wire_prefix_refuses_without_mutating_nonzero_ram() {
    let (wire, expected) = literal_image();
    let mut target = nonzero_ram();
    let original = target.as_bytes().to_vec();
    let allocation = target.as_bytes().as_ptr();
    for end in 0..wire.len() {
        assert!(target.restore(&wire[..end]).is_err(), "prefix {end}");
        assert_eq!(target.as_bytes(), original, "prefix {end} changed RAM");
        assert_eq!(target.as_bytes().as_ptr(), allocation);
    }
    target.restore(&wire).unwrap();
    assert_eq!(target.as_bytes(), expected);
    assert_eq!(target.as_bytes().as_ptr(), allocation);
    assert_eq!(target.base(), BASE);
    eprintln!(
        "SPARSE_CRITIC prefixes={} exact_bytes={} retained_allocation=true",
        wire.len(),
        LEN
    );
}

#[test]
fn late_invalid_runs_and_overflow_refuse_atomically_then_valid_zeros_replace_old_ram() {
    let (wire, expected) = literal_image();
    let mut cases = Vec::new();
    for suffix in [
        vec![0xff, 0, 0, 0, 0],
        vec![0, 1, 0, 0, 0],
        vec![1, 1, 0, 0, 0, 9],
        vec![0, 0xff, 0xff, 0xff, 0xff],
        vec![0],
        vec![1, 0, 0, 0],
    ] {
        let mut malformed = wire.clone();
        malformed.extend_from_slice(&suffix);
        cases.push(malformed);
    }
    // A late literal claims bytes that are not present, after an otherwise valid early prefix.
    let mut truncated = wire[..wire.len() - 1].to_vec();
    let last_header = wire.len() - 7 - 5;
    truncated[last_header + 1..last_header + 5].copy_from_slice(&8u32.to_le_bytes());
    cases.push(truncated);
    // Appending another entire image cannot overwrite the first decoded target.
    cases.push([wire.clone(), wire.clone()].concat());
    let mut ram = nonzero_ram();
    let original = ram.as_bytes().to_vec();
    for (index, bad) in cases.iter().enumerate() {
        assert!(ram.restore(bad).is_err(), "case {index}");
        assert_eq!(ram.as_bytes(), original, "case {index} partially applied");
    }
    ram.restore(&wire).unwrap();
    assert_eq!(ram.as_bytes(), expected);
    let mut zeros = Vec::new();
    run(&mut zeros, 0, LEN as u32, &[]);
    ram.restore(&zeros).unwrap();
    assert_eq!(ram.as_bytes(), vec![0; LEN]);
    eprintln!(
        "SPARSE_CRITIC late_invalid={} valid_zero_bytes={LEN}",
        cases.len()
    );
}

#[test]
fn unchanged_sequential_wire_accepts_zero_length_runs_and_exact_empty_boundary() {
    let (wire, expected) = literal_image();
    let mut with_empty = Vec::new();
    run(&mut with_empty, 0, 0, &[]);
    run(&mut with_empty, 1, 0, &[]);
    with_empty.extend_from_slice(&wire);
    run(&mut with_empty, 0, 0, &[]);
    let mut ram = nonzero_ram();
    ram.restore(&with_empty).unwrap();
    assert_eq!(ram.as_bytes(), expected);
    let mut empty = Ram::with_base(BASE, 0).unwrap();
    empty.restore(&[]).unwrap();
    empty.restore(&[0, 0, 0, 0, 0]).unwrap();
    assert_eq!(
        empty.restore(&[0, 1, 0, 0, 0]),
        Err(SnapshotError::SparseRunExceedsTotal)
    );
    assert_eq!(
        empty.restore(&[1, 0, 0, 0]),
        Err(SnapshotError::BadSparseEncoding)
    );
    assert!(empty.as_bytes().is_empty());
}
