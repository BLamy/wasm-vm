//! E3-T05 durable-overlay meta tests: serialization round-trip, version/base/geometry checks (typed
//! errors, never silent reuse), and DB-name namespacing by base binding.
use super::*;
use crate::{ImageManifest, Layout, OVERLAY_FORMAT_VERSION, OverlayError};
use alloc::vec;

fn manifest(bytes: &[u8]) -> ImageManifest {
    ImageManifest::from_image(bytes, 4096, Layout::Blob).unwrap()
}

#[test]
fn meta_round_trips_and_binds_to_the_base() {
    let m = manifest(&vec![7u8; 10_000]);
    let meta = OverlayMeta::new(&m);
    assert_eq!(meta.base_binding, m.base_hash());
    assert_eq!(meta.image_len, 10_000);
    assert_eq!(meta.block_size, OVERLAY_BLOCK as u32);
    // Serialize → parse is faithful.
    let parsed = OverlayMeta::from_bytes(&meta.to_bytes()).unwrap();
    assert_eq!(parsed, meta);
    // And it checks OK against its own manifest.
    assert_eq!(meta.check(&m), Ok(()));
}

#[test]
fn check_rejects_a_different_or_rechunked_base() {
    let m = manifest(&vec![1u8; 8192]);
    let meta = OverlayMeta::new(&m);
    // Different bytes → different binding → BaseMismatch.
    assert_eq!(
        meta.check(&manifest(&vec![2u8; 8192])),
        Err(OverlayError::BaseMismatch)
    );
    // Same bytes re-chunked at a different size → different base_hash → BaseMismatch.
    let rechunked = ImageManifest::from_image(&vec![1u8; 8192], 2048, Layout::Blob).unwrap();
    assert_eq!(meta.check(&rechunked), Err(OverlayError::BaseMismatch));
    // A different image length → geometry mismatch (BadMeta) before the base check.
    assert_eq!(
        meta.check(&manifest(&vec![1u8; 4096])),
        Err(OverlayError::BadMeta)
    );
}

#[test]
fn from_bytes_rejects_bad_magic_length_and_unknown_version() {
    let m = manifest(&vec![0u8; 4096]);
    let good = OverlayMeta::new(&m).to_bytes();
    // Truncated.
    assert_eq!(
        OverlayMeta::from_bytes(&good[..40]),
        Err(OverlayError::BadMeta)
    );
    // Bad magic.
    let mut bad_magic = good.clone();
    bad_magic[0] = b'X';
    assert_eq!(
        OverlayMeta::from_bytes(&bad_magic),
        Err(OverlayError::BadMeta)
    );
    // An unknown (future) format version must be refused, not reinterpreted (acceptance #5).
    let mut future = good.clone();
    future[4..8].copy_from_slice(&(OVERLAY_FORMAT_VERSION + 9).to_le_bytes());
    assert_eq!(
        OverlayMeta::from_bytes(&future),
        Err(OverlayError::UnsupportedFormat {
            found: OVERLAY_FORMAT_VERSION + 9
        })
    );
    // A garbage/empty buffer is BadMeta, never a panic.
    assert_eq!(OverlayMeta::from_bytes(&[]), Err(OverlayError::BadMeta));
}

#[test]
fn store_name_is_namespaced_by_base_binding() {
    let a = manifest(&vec![1u8; 4096]);
    let b = manifest(&vec![2u8; 4096]);
    let na = overlay_store_name(&a.base_hash());
    let nb = overlay_store_name(&b.base_hash());
    // Different images → different, independent store names (E3-T05 acceptance #4).
    assert_ne!(na, nb);
    // Well-formed: `wvov-` + 64 lowercase hex chars.
    assert!(na.starts_with("wvov-"));
    assert_eq!(na.len(), 5 + 64);
    assert!(na[5..].bytes().all(|c| c.is_ascii_hexdigit()));
    // Deterministic for the same base.
    assert_eq!(na, overlay_store_name(&a.base_hash()));
}
