//! E3.5-T01: `oci unpack` over a synthetic OCI image-layout — no network, deterministic. Builds
//! a 2-layer riscv64 image (layer 2 whiteouts a layer-1 file and overrides another) on disk,
//! unpacks it, and asserts the merged rootfs + digest-mismatch refusal.
use super::*;
use flate2::{Compression, write::GzEncoder};
use sha2::{Digest, Sha256};
use std::io::Write;
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

/// Build a raw (uncompressed) tar from members.
fn tar_of(members: &[M]) -> Vec<u8> {
    let mut buf = Vec::new();
    {
        let mut ar = tar::Builder::new(&mut buf);
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
    buf
}

/// Build a gzipped layer tar from members, return its bytes.
fn layer(members: &[M]) -> Vec<u8> {
    let mut gz = GzEncoder::new(Vec::new(), Compression::fast());
    gz.write_all(&tar_of(members)).unwrap();
    gz.finish().unwrap()
}

/// Build a zstd-compressed layer tar (E3.5-T04c — modern buildkit ships these).
fn layer_zstd(members: &[M]) -> Vec<u8> {
    zstd::stream::encode_all(&tar_of(members)[..], 3).unwrap()
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
    build_layout_cfg(
        layout,
        br#"{"architecture":"riscv64","os":"linux","rootfs":{"type":"layers","diff_ids":[]}}"#,
    )
}

/// Like [`build_layout`] but with a caller-supplied image config blob (so tests can drive the
/// Entrypoint/Cmd/Env/WorkingDir/User translation).
fn build_layout_cfg(layout: &Path, config_json: &[u8]) -> String {
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
    let config = put_blob(layout, config_json);

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

// ── Critic-adopted (E3.5-T01): the escape is BLOCKED, the bomb is CAPPED ──

/// Build an OCI layout whose single layer contains `evil -> <target>` then `evil/passwd`.
fn escape_layout(layout: &Path, symlink_target: &str) {
    let mut gz = flate2::write::GzEncoder::new(Vec::new(), flate2::Compression::fast());
    {
        let mut ar = tar::Builder::new(&mut gz);
        let mut h = tar::Header::new_gnu();
        h.set_entry_type(tar::EntryType::Symlink);
        h.set_size(0);
        h.set_mode(0o777);
        h.set_cksum();
        ar.append_link(&mut h, "evil", symlink_target).unwrap();
        let data = b"PWNED";
        let mut hf = tar::Header::new_gnu();
        hf.set_entry_type(tar::EntryType::Regular);
        hf.set_size(data.len() as u64);
        hf.set_mode(0o644);
        hf.set_cksum();
        ar.append_data(&mut hf, "evil/passwd", &data[..]).unwrap();
        ar.finish().unwrap();
    }
    let blob = gz.finish().unwrap();
    let d = put_blob(layout, &blob);
    let manifest = format!(
        r#"{{"schemaVersion":2,"mediaType":"application/vnd.oci.image.manifest.v1+json","config":{{"digest":"{c}","size":0}},"layers":[{{"mediaType":"application/vnd.oci.image.layer.v1.tar+gzip","digest":"{d}","size":0}}]}}"#,
        c = put_blob(layout, b"{}"),
    );
    let mdig = put_blob(layout, manifest.as_bytes());
    let index = format!(
        r#"{{"schemaVersion":2,"manifests":[{{"digest":"{mdig}","size":0,"platform":{{"architecture":"riscv64","os":"linux"}}}}]}}"#
    );
    std::fs::write(layout.join("index.json"), index).unwrap();
}

#[test]
fn symlink_traversal_escape_is_blocked() {
    for target in [
        "/tmp/wasmvm-oci-victim",
        "../../../../../../tmp/wasmvm-oci-victim",
    ] {
        let td = tempfile::tempdir().unwrap();
        escape_layout(td.path(), target);
        let out = td.path().join("root");
        // Unpack must FAIL (SymlinkTraversal), and NOTHING may be written outside `out`.
        let victim = std::path::Path::new("/tmp/wasmvm-oci-victim/passwd");
        let _ = std::fs::remove_dir_all("/tmp/wasmvm-oci-victim");
        let tree = unpack_to_tree(td.path(), "riscv64");
        // The applier rejects the descent; if it somehow produced a tree, write must also refuse.
        if let Ok(t) = tree {
            let _ = write_tree(&t, &out);
        }
        assert!(
            !victim.exists(),
            "CONTAINER ESCAPE: {} was created outside the root",
            victim.display()
        );
    }
}

/// Regression (found by sideloading the REAL busybox riscv64 image): every real image tarball
/// carries a `./` (and sometimes `.`) root-directory member. It normalizes to the empty path, which
/// `safe_path` correctly rejects — so unpack used to FAIL with `UnsafePath("./")`. The root entry
/// must be SKIPPED, not rejected, while `..`/absolute paths stay rejected.
#[test]
fn tar_root_dir_entry_is_skipped_not_rejected() {
    let mut gz = GzEncoder::new(Vec::new(), Compression::fast());
    {
        let mut ar = tar::Builder::new(&mut gz);
        // Root entries "./" and "." must be skipped; "./etc" is a real dir (its `./` prefix strips
        // to "etc").
        for p in ["./", ".", "./etc"] {
            let mut h = tar::Header::new_gnu();
            h.set_size(0);
            h.set_mode(0o755);
            h.set_entry_type(tar::EntryType::Directory);
            h.set_cksum();
            ar.append_data(&mut h, p, &b""[..]).unwrap();
        }
        // A real member under the root, with the `./` prefix real tars use.
        let data = b"hi";
        let mut h = tar::Header::new_gnu();
        h.set_size(data.len() as u64);
        h.set_mode(0o644);
        h.set_entry_type(tar::EntryType::Regular);
        h.set_cksum();
        ar.append_data(&mut h, "./etc/motd", &data[..]).unwrap();
        ar.finish().unwrap();
    }
    let blob = gz.finish().unwrap();
    let mut tree = Tree::new();
    apply_layer_tar(&mut tree, &blob).expect("root './' entry must be skipped, not rejected");
    assert_eq!(
        tree.get("etc/motd"),
        Some(&Node::File {
            mode: 0o644,
            data: b"hi".to_vec()
        })
    );
    assert!(tree.contains_key("etc"));
    assert!(!tree.contains_key(""), "no empty-path node");
    assert!(!tree.contains_key("."), "no '.' node");
}

// ── E3.5-T03: image-config → runtime-config translation + runnable bundle emission ──

#[test]
fn runtime_config_merges_entrypoint_and_cmd() {
    let td = tempfile::tempdir().unwrap();
    // A postgres-shaped config: Entrypoint + Cmd + Env + WorkingDir + User.
    build_layout_cfg(
        td.path(),
        br#"{"architecture":"riscv64","os":"linux","config":{
            "Env":["PATH=/usr/local/bin:/usr/bin","POSTGRES_DB=app"],
            "Entrypoint":["docker-entrypoint.sh"],
            "Cmd":["postgres","-c","max_connections=100"],
            "WorkingDir":"/var/lib/postgresql",
            "User":"postgres"}}"#,
    );
    let cfg = resolve_runtime_config(td.path(), "riscv64").unwrap();
    // OCI runtime semantics: final argv = Entrypoint ++ Cmd.
    assert_eq!(
        cfg.argv,
        vec![
            "docker-entrypoint.sh",
            "postgres",
            "-c",
            "max_connections=100"
        ]
    );
    assert_eq!(
        cfg.env,
        vec!["PATH=/usr/local/bin:/usr/bin", "POSTGRES_DB=app"]
    );
    assert_eq!(cfg.cwd, "/var/lib/postgresql");
    assert_eq!(cfg.user, "postgres");
}

#[test]
fn runtime_config_defaults_when_fields_absent() {
    let td = tempfile::tempdir().unwrap();
    // Only a Cmd (no Entrypoint/WorkingDir/User/Env) — the common single-arch base-image shape.
    build_layout_cfg(
        td.path(),
        br#"{"architecture":"riscv64","os":"linux","config":{"Cmd":["/bin/sh"]}}"#,
    );
    let cfg = resolve_runtime_config(td.path(), "riscv64").unwrap();
    assert_eq!(cfg.argv, vec!["/bin/sh"]);
    assert!(cfg.env.is_empty());
    assert_eq!(cfg.cwd, "/", "blank WorkingDir defaults to /");
    assert_eq!(cfg.user, "");
}

#[test]
fn unpack_emits_runnable_bundle() {
    let td = tempfile::tempdir().unwrap();
    build_layout_cfg(
        td.path(),
        br#"{"architecture":"riscv64","os":"linux","config":{
            "Env":["PATH=/usr/bin"],"Entrypoint":["/bin/sh"],"Cmd":["-c","echo hi"],
            "WorkingDir":"/srv","User":"1000:1000"}}"#,
    );
    let out = td.path().join("bundle");
    let tree = unpack_to_tree(td.path(), "riscv64").unwrap();
    let cfg = resolve_runtime_config(td.path(), "riscv64").unwrap();
    write_bundle(&tree, &cfg, &out).unwrap();

    // rootfs/ holds the merged tree.
    assert_eq!(std::fs::read(out.join("rootfs/etc/motd")).unwrap(), b"v2");
    assert!(out.join("rootfs/bin/sh").exists());
    assert!(!out.join("rootfs/etc/gone").exists(), "whiteout applied");

    // Flat shell-readable config the runner consumes (no JSON parser in the guest).
    assert_eq!(
        std::fs::read_to_string(out.join("config/argv")).unwrap(),
        "/bin/sh\n-c\necho hi\n"
    );
    assert_eq!(
        std::fs::read_to_string(out.join("config/env")).unwrap(),
        "PATH=/usr/bin\n"
    );
    assert_eq!(
        std::fs::read_to_string(out.join("config/cwd")).unwrap(),
        "/srv\n"
    );
    assert_eq!(
        std::fs::read_to_string(out.join("config/user")).unwrap(),
        "1000:1000\n"
    );

    // run.json is canonical + re-parseable.
    let rj = std::fs::read_to_string(out.join("run.json")).unwrap();
    assert!(rj.contains("\"argv\""));
    assert!(rj.contains("/bin/sh"));
}

#[test]
fn corrupted_config_blob_is_refused_by_digest() {
    let td = tempfile::tempdir().unwrap();
    // A config blob big enough to be the largest? No — corrupt the config specifically by name.
    build_layout_cfg(
        td.path(),
        br#"{"architecture":"riscv64","os":"linux","config":{"Cmd":["/bin/sh"],"Env":["A=1","B=2","C=3","D=4","E=5"]}}"#,
    );
    // Find the config blob (the JSON one that parses as an image config with a "config" key) and
    // flip a byte; resolve_runtime_config must refuse it on digest.
    let blobs = td.path().join("blobs/sha256");
    let has = |data: &[u8], needle: &[u8]| data.windows(needle.len()).any(|w| w == needle);
    for e in std::fs::read_dir(&blobs).unwrap().flatten() {
        let data = std::fs::read(e.path()).unwrap();
        // The image config uniquely has "architecture" but no "schemaVersion" (the manifest has the
        // reverse) — corrupt ONLY it, so the failure exercises the config-blob verify path.
        if has(&data, b"architecture") && !has(&data, b"schemaVersion") {
            let mut d = data.clone();
            let m = d.len() / 2;
            d[m] ^= 0xFF;
            std::fs::write(e.path(), &d).unwrap();
        }
    }
    let err = resolve_runtime_config(td.path(), "riscv64").unwrap_err();
    assert!(
        matches!(err, UnpackError::DigestMismatch { .. }),
        "got {err:?}"
    );
}

// ── E3.5-T04c: zstd-compressed layers (modern buildkit / `--compression=zstd`) ──

#[test]
fn zstd_compressed_layer_unpacks() {
    // A zstd layer (magic 28 b5 2f fd) must unpack exactly like gzip.
    let l = layer_zstd(&[M::Dir("etc/"), M::File("etc/motd", b"zstd-works")]);
    assert_eq!(&l[..4], &[0x28, 0xb5, 0x2f, 0xfd], "sanity: zstd magic");
    let mut tree = Tree::new();
    apply_layer_tar(&mut tree, &l).unwrap();
    assert_eq!(
        tree.get("etc/motd"),
        Some(&Node::File {
            mode: 0o644,
            data: b"zstd-works".to_vec()
        })
    );
    assert!(matches!(tree.get("etc"), Some(Node::Dir { .. })));
}

#[test]
fn zstd_bomb_is_capped() {
    // A 128 MiB-logical bomb, built by STREAMING the zeros through a zstd encoder — the plaintext is
    // never materialized (compresses to a few KB). This proves the important property (critic LOW-3):
    // the decode path (`read::Decoder` + `take(budget+1)`) bounds DELIVERED bytes and never
    // preallocates to the logical/frame size — swapping it for a buffering `decode_all` would regress
    // loudly here. (The critic separately verified a 10 GiB bomb stays bounded in 1.5 ms.) Same guard
    // as the gzip bomb; decompression is bounded regardless of codec.
    let size: u64 = 128 * 1024 * 1024;
    let mut ar = tar::Builder::new(zstd::stream::write::Encoder::new(Vec::new(), 3).unwrap());
    let mut h = tar::Header::new_gnu();
    h.set_entry_type(tar::EntryType::Regular);
    h.set_size(size);
    h.set_mode(0o644);
    h.set_cksum();
    ar.append_data(&mut h, "big", std::io::repeat(0u8).take(size))
        .unwrap();
    let blob = ar.into_inner().unwrap().finish().unwrap();
    assert_eq!(&blob[..4], &[0x28, 0xb5, 0x2f, 0xfd]);
    assert!(
        (blob.len() as u64) < size / 1000,
        "sanity: the bomb blob is tiny vs its logical size ({} bytes)",
        blob.len()
    );
    let mut tree = Tree::new();
    let err = apply_layer_tar_capped(&mut tree, &blob, 1024 * 1024).unwrap_err();
    assert!(
        matches!(err, UnpackError::Io(m) if m.contains("cap")),
        "expected a cap error for the zstd bomb"
    );
}

#[test]
fn gzip_bomb_is_capped() {
    // A highly-compressible member far larger than a small budget → the streaming cap errors
    // instead of buffering it. Uses the capped inner fn with a 1 MiB budget so the test is fast.
    let mut gz = flate2::write::GzEncoder::new(Vec::new(), flate2::Compression::best());
    {
        let mut ar = tar::Builder::new(&mut gz);
        let size: u64 = 64 * 1024 * 1024; // 64 MiB of zeros → ~KB compressed, past the 1 MiB budget
        let mut h = tar::Header::new_gnu();
        h.set_entry_type(tar::EntryType::Regular);
        h.set_size(size);
        h.set_mode(0o644);
        h.set_cksum();
        ar.append_data(&mut h, "big", std::io::repeat(0u8).take(size))
            .unwrap();
        ar.finish().unwrap();
    }
    let blob = gz.finish().unwrap();
    let mut tree = Tree::new();
    let err = apply_layer_tar_capped(&mut tree, &blob, 1024 * 1024).unwrap_err();
    assert!(
        matches!(err, UnpackError::Io(m) if m.contains("cap")),
        "expected a cap error, got other"
    );
}
