//! E3-T04 overlay tests: base passthrough, partial-block merge, base binding, range errors, and a
//! ≥10^4-case proptest pinning `OverlayDisk` over a fully-resident base against a flat `Vec<u8>` model.
use super::*;
use crate::{ImageManifest, Layout};
use alloc::vec;
use alloc::vec::Vec;

/// A fully-resident base `ChunkSource` over a flat image, chunked at `chunk_size`. `get` returns the
/// chunk slice (short for the tail), matching what `ChunkIndex::read` expects.
struct FlatBase {
    data: Vec<u8>,
    chunk_size: usize,
}
impl ChunkSource for FlatBase {
    fn get(&self, chunk: usize) -> Option<&[u8]> {
        let lo = chunk.checked_mul(self.chunk_size)?;
        if lo >= self.data.len() {
            return None;
        }
        let hi = (lo + self.chunk_size).min(self.data.len());
        Some(&self.data[lo..hi])
    }
}

/// Build (manifest, base source) for `data` chunked at `chunk_size`.
fn base(data: &[u8], chunk_size: u32) -> (ImageManifest, FlatBase) {
    let m = ImageManifest::from_image(data, chunk_size, Layout::Blob).unwrap();
    (
        m,
        FlatBase {
            data: data.to_vec(),
            chunk_size: chunk_size as usize,
        },
    )
}

fn read_done<B: OverlayBackend>(d: &OverlayDisk<B>, b: &FlatBase, off: u64, len: u64) -> Vec<u8> {
    match d.read(b, off, len).unwrap() {
        OverlayOutcome::Done(v) => v,
        OverlayOutcome::NeedChunk(c) => panic!("unexpected NeedChunk({c}) over a resident base"),
    }
}

#[test]
fn unwritten_reads_hit_the_base_exactly() {
    let data: Vec<u8> = (0..10_000u32).map(|i| (i % 251) as u8).collect();
    let (m, b) = base(&data, 131072); // 128 KiB chunks
    let disk = OverlayDisk::attach(MemOverlay::new(&m), &m).unwrap();
    // Whole image, a cross-block slice, and the tail all equal the base.
    assert_eq!(read_done(&disk, &b, 0, 10_000), data);
    assert_eq!(read_done(&disk, &b, 4090, 20), data[4090..4110]);
    assert_eq!(read_done(&disk, &b, 9990, 10), data[9990..10_000]);
}

#[test]
fn partial_block_write_merges_over_base() {
    // Acceptance: a 100-byte write at offset 4090 spans the tail of block 0 and the head of block 1.
    let data: Vec<u8> = (0..20_000u32).map(|i| (i % 251) as u8).collect();
    let (m, b) = base(&data, 131072);
    let mut disk = OverlayDisk::attach(MemOverlay::new(&m), &m).unwrap();

    let payload: Vec<u8> = (0..100).map(|i| 0xA0 ^ i as u8).collect();
    assert_eq!(
        disk.write(&b, 4090, &payload).unwrap(),
        OverlayOutcome::Done(())
    );

    // A model: base with the payload overlaid.
    let mut model = data.clone();
    model[4090..4190].copy_from_slice(&payload);

    // The written region reads back the payload; bytes just before/after read base; a big surrounding
    // slice matches the merged model exactly (proves no stale base in the written blocks, no clobber
    // of the unwritten remainder of those blocks).
    assert_eq!(read_done(&disk, &b, 4090, 100), payload);
    assert_eq!(read_done(&disk, &b, 4089, 1), data[4089..4090]);
    assert_eq!(read_done(&disk, &b, 4190, 1), data[4190..4191]);
    assert_eq!(read_done(&disk, &b, 0, 20_000), model);
    // Only the two touched 4 KiB blocks are dirty.
}

#[test]
fn repeated_rewrite_never_leaks_stale_base() {
    // Adversarial: write/read/write the same region many times — no stale base or prior write reappears.
    let data: Vec<u8> = (0..8192u32).map(|i| (i % 251) as u8).collect();
    let (m, b) = base(&data, 4096);
    let mut disk = OverlayDisk::attach(MemOverlay::new(&m), &m).unwrap();
    let mut model = data.clone();
    for k in 0u32..500 {
        let off = (k as u64 * 37) % 8000;
        let payload: Vec<u8> = (0..64).map(|i| (k as u8).wrapping_add(i as u8)).collect();
        disk.write(&b, off, &payload).unwrap();
        model[off as usize..off as usize + 64].copy_from_slice(&payload);
        assert_eq!(read_done(&disk, &b, 0, 8192), model, "iter {k}");
    }
}

#[test]
fn base_binding_refuses_the_wrong_base() {
    let data: Vec<u8> = (0..5000u32).map(|i| i as u8).collect();
    let (m, _b) = base(&data, 4096);
    let overlay = MemOverlay::new(&m);

    // A DIFFERENT base — same bytes but re-chunked at a different size → different manifest hash.
    let (m_rechunked, _) = base(&data, 2048);
    assert_eq!(
        OverlayDisk::attach(overlay.clone(), &m_rechunked).err(),
        Some(OverlayError::BaseMismatch),
        "an overlay must not attach to a re-chunked base"
    );
    // A totally different image also refuses.
    let (m_other, _) = base(&[1u8; 5000], 4096);
    assert_eq!(
        OverlayDisk::attach(overlay, &m_other).err(),
        Some(OverlayError::BaseMismatch)
    );
    // The correct base attaches.
    assert!(OverlayDisk::attach(MemOverlay::new(&m), &m).is_ok());
}

#[test]
fn out_of_range_io_is_a_typed_error() {
    let data = vec![7u8; 5000];
    let (m, b) = base(&data, 4096);
    let mut disk = OverlayDisk::attach(MemOverlay::new(&m), &m).unwrap();
    assert!(matches!(
        disk.read(&b, 4999, 2),
        Err(OverlayError::OutOfRange { .. })
    ));
    assert!(matches!(
        disk.write(&b, 4999, &[0u8; 2]),
        Err(OverlayError::OutOfRange { .. })
    ));
    // A zero-length read at the very end is valid and empty.
    assert_eq!(read_done(&disk, &b, 5000, 0), Vec::<u8>::new());
}

// ── proptest: OverlayDisk over a resident base == a flat Vec model ─────────────────────────────
use proptest::prelude::*;

proptest! {
    #![proptest_config(ProptestConfig::with_cases(10_000))]
    #[test]
    fn overlay_is_observationally_identical_to_a_flat_model(
        // Image length deliberately NOT a multiple of the 4 KiB block, to exercise the tail.
        image_len in 1usize..9000,
        chunk_size_log in 9u32..14,          // 512 .. 8192-byte base chunks
        seed in any::<u64>(),
        ops_raw in prop::collection::vec((0u64..9000, 0usize..300, 0u8..2, any::<u8>()), 0..40),
    ) {
        let data: Vec<u8> = (0..image_len).map(|i| (i.wrapping_mul(31).wrapping_add(seed as usize)) as u8).collect();
        let chunk_size = 1u32 << chunk_size_log;
        let (m, b) = base(&data, chunk_size);
        let mut disk = OverlayDisk::attach(MemOverlay::new(&m), &m).unwrap();
        let mut model = data.clone();

        for (off, len, kind, fill) in ops_raw {
            let off = if image_len == 0 { 0 } else { off % image_len as u64 };
            match kind {
                0 => {
                    // Write: clamp the length so [off, off+len) stays in range.
                    let max = image_len as u64 - off;
                    let l = (len as u64).min(max);
                    let payload: Vec<u8> = (0..l).map(|i| fill.wrapping_add(i as u8)).collect();
                    prop_assert_eq!(disk.write(&b, off, &payload).unwrap(), OverlayOutcome::Done(()));
                    model[off as usize..off as usize + l as usize].copy_from_slice(&payload);
                }
                _ => {
                    // Read: clamp likewise and compare to the model.
                    let max = image_len as u64 - off;
                    let l = (len as u64).min(max);
                    let got = read_done(&disk, &b, off, l);
                    prop_assert_eq!(&got, &model[off as usize..off as usize + l as usize]);
                }
            }
        }
        // A final full read must equal the model regardless of the interleaving.
        prop_assert_eq!(read_done(&disk, &b, 0, image_len as u64), model.clone());
        disk.commit().unwrap();
        prop_assert_eq!(read_done(&disk, &b, 0, image_len as u64), model);
    }
}
