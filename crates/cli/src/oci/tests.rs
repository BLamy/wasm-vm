//! E3.5-T01: `oci unpack` over a synthetic OCI image-layout — no network, deterministic. Builds
//! a 2-layer riscv64 image (layer 2 whiteouts a layer-1 file and overrides another) on disk,
//! unpacks it, and asserts the merged rootfs + digest-mismatch refusal.
use super::*;
use flate2::{Compression, write::GzEncoder};
use sha2::{Digest, Sha256};
use std::path::Path;

fn hexd(b: &[u8]) -> String {
    b.iter().map(|x| format!("{x:02x}")).collect()
}

/// A tar member spec.
enum M<'a> {
    File(&'a str, &'a [u8]),
    Dir(&'a str),
    /// A `.wh.<name>` whiteout placed in `dir` deleting `name`.
    Whiteout(&'a str),
}

/// Build a gzipped layer tar from members, return its bytes.
fn layer(members: &[M]) -> Vec<u8> {
    let mut gz = GzEncoder::new(Vec::new(), Compression::fast());
    {
        let mut ar = tar::Builder::new(&mut gz);
        for m in members {
            match m {
                M::File(path, data) => {
                    let mut h = tar::Header::new_gnu();
                    h.set_size(data.len() as u64);
                    h.set_mode(0o644);
                    h.set_entry_type(tar::EntryType::Regular);
                    h.set_cksum();
                    ar.append_data(&mut h, path, *data).unwrap();
                }
                M::Dir(path) => {
                    let mut h = tar::Header::new_gnu();
                    h.set_size(0);
                    h.set_mode(0o755);
                    h.set_entry_type(tar::EntryType::Directory);
                    h.set_cksum();
                    ar.append_data(&mut h, path, &b""[..]).unwrap();
                }
                M::Whiteout(path) => {
                    // A 0-byte regular file named .wh.<name>.
                    let mut h = tar::Header::new_gnu();
                    h.set_size(0);
                    h.set_mode(0o644);
                    h.set_entry_type(tar::EntryType::Regular);
                    h.set_cksum();
                    ar.append_data(&mut h, path, &b""[..]).unwrap();
                }
            }
        }
        ar.finish().unwrap();
    }
    gz.finish().unwrap()
}

/// Write `bytes` as a blob and return its `sha256:<hex>` digest.
fn put_blob(layout: &Path, bytes: &[u8]) -> String {
    let hex = hexd(&Sha256::digest(bytes));
    let dir = layout.join("blobs/sha256");
    std::fs::create_dir_all(&dir).unwrap();
    std::fs::write(dir.join(&hex), bytes).unwrap();
    format!("sha256:{hex}")
}

/// Assemble a 2-layer riscv64 OCI layout in `layout`. Returns the manifest digest.
fn build_layout(layout: &Path) -> String {
    // Layer 1: /etc/motd=v1, /etc/gone=bye, /bin/ (dir), /bin/sh=ELF.
    let l1 = layer(&[
        M::Dir("etc/"),
        M::File("etc/motd", b"v1"),
        M::File("etc/gone", b"bye"),
        M::Dir("bin/"),
        M::File("bin/sh", b"ELF"),
    ]);
    // Layer 2: override /etc/motd=v2, whiteout /etc/gone.
    let l2 = layer(&[M::File("etc/motd", b"v2"), M::Whiteout("etc/.wh.gone")]);

    let d1 = put_blob(layout, &l1);
    let d2 = put_blob(layout, &l2);
    let config = put_blob(
        layout,
        br#"{"architecture":"riscv64","os":"linux","rootfs":{"type":"layers","diff_ids":[]}}"#,
    );

    let manifest = format!(
        r#"{{"schemaVersion":2,"mediaType":"application/vnd.oci.image.manifest.v1+json","config":{{"mediaType":"application/vnd.oci.image.config.v1+json","digest":"{config}","size":0}},"layers":[{{"mediaType":"application/vnd.oci.image.layer.v1.tar+gzip","digest":"{d1}","size":0}},{{"mediaType":"application/vnd.oci.image.layer.v1.tar+gzip","digest":"{d2}","size":0}}]}}"#
    );
    let mdig = put_blob(layout, manifest.as_bytes());
    let index = format!(
        r#"{{"schemaVersion":2,"manifests":[{{"mediaType":"application/vnd.oci.image.manifest.v1+json","digest":"{mdig}","size":0,"platform":{{"architecture":"riscv64","os":"linux"}}}}]}}"#
    );
    std::fs::write(layout.join("index.json"), index).unwrap();
    mdig
}

#[test]
fn unpack_merges_layers_with_override_and_whiteout() {
    let td = tempfile::tempdir().unwrap();
    build_layout(td.path());
    let tree = unpack_to_tree(td.path(), "riscv64").unwrap();

    // Override wins.
    assert_eq!(
        tree.get("etc/motd"),
        Some(&Node::File {
            mode: 0o644,
            data: b"v2".to_vec()
        })
    );
    // Whiteout removed the lower file and is not materialized.
    assert!(!tree.contains_key("etc/gone"));
    assert!(!tree.keys().any(|k| k.contains(".wh.")));
    // Untouched files carry through.
    assert_eq!(
        tree.get("bin/sh"),
        Some(&Node::File {
            mode: 0o644,
            data: b"ELF".to_vec()
        })
    );
    assert!(matches!(tree.get("bin"), Some(Node::Dir { .. })));
}

#[test]
fn corrupted_blob_is_refused_by_digest() {
    let td = tempfile::tempdir().unwrap();
    build_layout(td.path());
    // Flip a byte in the FIRST layer blob (still named by its original digest).
    let blobs = td.path().join("blobs/sha256");
    // The layer blobs are the largest files; corrupt one of them.
    let mut biggest: Option<std::path::PathBuf> = None;
    let mut max = 0u64;
    for e in std::fs::read_dir(&blobs).unwrap().flatten() {
        let len = e.metadata().unwrap().len();
        if len > max {
            max = len;
            biggest = Some(e.path());
        }
    }
    let p = biggest.unwrap();
    let mut data = std::fs::read(&p).unwrap();
    let mid = data.len() / 2;
    data[mid] ^= 0xFF;
    std::fs::write(&p, &data).unwrap();

    let err = unpack_to_tree(td.path(), "riscv64").unwrap_err();
    assert!(
        matches!(err, UnpackError::DigestMismatch { .. }),
        "got {err:?}"
    );
}

#[test]
fn missing_arch_is_a_typed_error() {
    let td = tempfile::tempdir().unwrap();
    build_layout(td.path());
    let err = unpack_to_tree(td.path(), "s390x").unwrap_err();
    assert!(matches!(err, UnpackError::NoArch(_)), "got {err:?}");
}
