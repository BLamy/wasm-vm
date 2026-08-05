//! E3.5-T01 pull verification against an in-memory mock registry — no network, fully deterministic.
//! Exercises the whole resolve→auth→verify→layout pipeline (and feeds the result to the real
//! `unpack_to_tree`, closing the loop pull→unpack), plus the digest-tamper refusal, the anonymous
//! Bearer 401→token→retry dance, reference parsing, and multi-arch index selection.

use std::cell::RefCell;
use std::collections::HashMap;

use flate2::{Compression, write::GzEncoder};
use sha2::{Digest, Sha256};

use super::{HttpResponse, ImageRef, PullError, Transport, pull_with};

fn digest(bytes: &[u8]) -> String {
    format!(
        "sha256:{}",
        Sha256::digest(bytes)
            .iter()
            .map(|b| format!("{b:02x}"))
            .collect::<String>()
    )
}

/// A gzip-compressed tar of `(path, contents)` entries — a real image layer the unpacker can apply.
fn gzip_layer(entries: &[(&str, &[u8])]) -> Vec<u8> {
    let mut tar = tar::Builder::new(Vec::new());
    for (path, contents) in entries {
        let mut header = tar::Header::new_gnu();
        header.set_size(contents.len() as u64);
        header.set_mode(0o644);
        header.set_cksum();
        tar.append_data(&mut header, path, *contents).unwrap();
    }
    let tar_bytes = tar.into_inner().unwrap();
    let mut gz = GzEncoder::new(Vec::new(), Compression::fast());
    std::io::Write::write_all(&mut gz, &tar_bytes).unwrap();
    gz.finish().unwrap()
}

/// A synthetic two-layer riscv64 image, plus (optionally) an amd64 sibling in the index.
struct Fixture {
    blobs: HashMap<String, Vec<u8>>,           // digest → bytes
    manifests_by_tag: HashMap<String, String>, // tag → digest
    riscv_manifest_digest: String,
}

fn build_fixture(with_amd64: bool) -> Fixture {
    let mut blobs = HashMap::new();
    let mut put = |bytes: Vec<u8>| {
        let d = digest(&bytes);
        blobs.insert(d.clone(), bytes);
        d
    };

    let layer1 = put(gzip_layer(&[
        ("etc/base", b"base\n"),
        ("bin/sh", b"#!fake\n"),
    ]));
    let layer2 = put(gzip_layer(&[("etc/added", b"added\n")]));
    let config = put(serde_json::to_vec(&serde_json::json!({
        "architecture": "riscv64",
        "os": "linux",
        "config": { "Cmd": ["/bin/sh"], "Env": ["PATH=/bin"] }
    }))
    .unwrap());
    let manifest = serde_json::to_vec(&serde_json::json!({
        "schemaVersion": 2,
        "mediaType": "application/vnd.oci.image.manifest.v1+json",
        "config": { "mediaType": "application/vnd.oci.image.config.v1+json", "digest": config, "size": 1 },
        "layers": [
            { "mediaType": "application/vnd.oci.image.layer.v1.tar+gzip", "digest": layer1, "size": 1 },
            { "mediaType": "application/vnd.oci.image.layer.v1.tar+gzip", "digest": layer2, "size": 1 }
        ]
    }))
    .unwrap();
    let riscv_manifest_digest = put(manifest);

    let mut index_manifests = vec![serde_json::json!({
        "mediaType": "application/vnd.oci.image.manifest.v1+json",
        "digest": riscv_manifest_digest,
        "size": 1,
        "platform": { "architecture": "riscv64", "os": "linux" }
    })];
    if with_amd64 {
        index_manifests.insert(
            0,
            serde_json::json!({
                "mediaType": "application/vnd.oci.image.manifest.v1+json",
                "digest": "sha256:0000000000000000000000000000000000000000000000000000000000000000",
                "size": 1,
                "platform": { "architecture": "amd64", "os": "linux" }
            }),
        );
    }
    let index = serde_json::to_vec(&serde_json::json!({
        "schemaVersion": 2,
        "mediaType": "application/vnd.oci.image.index.v1+json",
        "manifests": index_manifests
    }))
    .unwrap();
    let index_digest = put(index);

    let mut manifests_by_tag = HashMap::new();
    manifests_by_tag.insert("latest".to_string(), index_digest);
    Fixture {
        blobs,
        manifests_by_tag,
        riscv_manifest_digest,
    }
}

#[derive(Default)]
struct MockLog {
    saw_unauthenticated_manifest: bool,
    saw_token_request: bool,
    saw_bearer_request: bool,
}

struct MockRegistry {
    fx: Fixture,
    /// If set, the layer with this digest is served with corrupted bytes (tamper test).
    tamper: Option<String>,
    log: RefCell<MockLog>,
}

impl MockRegistry {
    fn new(fx: Fixture) -> Self {
        Self {
            fx,
            tamper: None,
            log: RefCell::new(MockLog::default()),
        }
    }
    fn challenge() -> HttpResponse {
        HttpResponse {
            status: 401,
            www_authenticate: Some(
                "Bearer realm=\"https://auth.mock/token\",service=\"mock\"".to_string(),
            ),
            body: Vec::new(),
        }
    }
}

impl Transport for MockRegistry {
    fn get(
        &self,
        url: &str,
        _accept: &[&str],
        bearer: Option<&str>,
    ) -> Result<HttpResponse, PullError> {
        // Token endpoint: always 200 with a token (records the request).
        if url.starts_with("https://auth.mock/token") {
            self.log.borrow_mut().saw_token_request = true;
            return Ok(HttpResponse {
                status: 200,
                www_authenticate: None,
                body: br#"{"token":"MOCKTOKEN"}"#.to_vec(),
            });
        }
        // Everything else requires the bearer; a first, unauthenticated hit gets the 401 challenge.
        if bearer.is_none() {
            if url.contains("/manifests/") {
                self.log.borrow_mut().saw_unauthenticated_manifest = true;
            }
            return Ok(Self::challenge());
        }
        self.log.borrow_mut().saw_bearer_request = true;

        if let Some(rest) = url.split("/manifests/").nth(1) {
            // Reference is a tag or a digest.
            let digest = self
                .fx
                .manifests_by_tag
                .get(rest)
                .cloned()
                .unwrap_or_else(|| rest.to_string());
            return match self.fx.blobs.get(&digest) {
                Some(bytes) => Ok(HttpResponse {
                    status: 200,
                    www_authenticate: None,
                    body: bytes.clone(),
                }),
                None => Ok(HttpResponse {
                    status: 404,
                    www_authenticate: None,
                    body: Vec::new(),
                }),
            };
        }
        if let Some(digest) = url.split("/blobs/").nth(1) {
            if self.tamper.as_deref() == Some(digest) {
                return Ok(HttpResponse {
                    status: 200,
                    www_authenticate: None,
                    body: b"corrupted".to_vec(),
                });
            }
            return match self.fx.blobs.get(digest) {
                Some(bytes) => Ok(HttpResponse {
                    status: 200,
                    www_authenticate: None,
                    body: bytes.clone(),
                }),
                None => Ok(HttpResponse {
                    status: 404,
                    www_authenticate: None,
                    body: Vec::new(),
                }),
            };
        }
        Err(PullError::Transport(format!("mock: unhandled url {url}")))
    }
}

#[test]
fn parses_docker_hub_and_registry_qualified_and_digest_references() {
    let a = ImageRef::parse("alpine", None).unwrap();
    assert_eq!(a.registry, "registry-1.docker.io");
    assert_eq!(a.repository, "library/alpine");
    assert_eq!(a.reference, "latest");

    let b = ImageRef::parse("alpine:3.20", None).unwrap();
    assert_eq!(b.repository, "library/alpine");
    assert_eq!(b.reference, "3.20");

    let c = ImageRef::parse("ghcr.io/owner/img:tag", None).unwrap();
    assert_eq!(c.registry, "ghcr.io");
    assert_eq!(c.repository, "owner/img");
    assert_eq!(c.reference, "tag");

    let d = ImageRef::parse("alpine@sha256:abc", None).unwrap();
    assert_eq!(d.reference, "sha256:abc");

    assert!(matches!(
        ImageRef::parse("", None),
        Err(PullError::BadRef(_))
    ));
}

#[test]
fn pull_resolves_auth_verifies_and_writes_a_layout_that_unpacks() {
    let tmp = tempfile::tempdir().unwrap();
    let out = tmp.path().join("layout");
    let reg = MockRegistry::new(build_fixture(true));
    let image = ImageRef::parse("library/alpine:latest", None).unwrap();

    let pulled = pull_with(&reg, &image, "riscv64", false, &out).unwrap();
    assert_eq!(pulled.layer_count, 2);
    assert_eq!(pulled.manifest_digest, reg.fx.riscv_manifest_digest);

    // The anonymous Bearer dance actually happened.
    let log = reg.log.borrow();
    assert!(
        log.saw_unauthenticated_manifest,
        "first manifest GET was challenged"
    );
    assert!(log.saw_token_request, "token endpoint was hit");
    assert!(log.saw_bearer_request, "authenticated GET followed");
    drop(log);

    // index.json + every blob is on disk and the manifest blob verifies.
    assert!(out.join("index.json").exists());
    let hex = pulled.manifest_digest.strip_prefix("sha256:").unwrap();
    assert!(out.join("blobs").join("sha256").join(hex).exists());

    // Close the loop: the real unpacker flattens the pulled layout into a rootfs with both layers.
    let tree = crate::oci::unpack_to_tree(&out, "riscv64").unwrap();
    assert!(tree.contains_key("etc/base"), "layer 1 file present");
    assert!(tree.contains_key("etc/added"), "layer 2 file present");
    assert!(tree.contains_key("bin/sh"));
}

#[test]
fn a_tampered_layer_blob_is_refused_with_a_digest_mismatch() {
    let tmp = tempfile::tempdir().unwrap();
    let out = tmp.path().join("layout");
    let fx = build_fixture(false);
    // Pick a layer digest to corrupt: any blob that isn't the manifest/config/index.
    let manifest = fx.riscv_manifest_digest.clone();
    let victim = fx.blobs.keys().find(|d| **d != manifest).cloned().unwrap();
    let mut reg = MockRegistry::new(fx);
    reg.tamper = Some(victim);
    let image = ImageRef::parse("library/alpine:latest", None).unwrap();

    let err = pull_with(&reg, &image, "riscv64", false, &out).unwrap_err();
    assert!(
        matches!(err, PullError::DigestMismatch { .. }),
        "tampered blob must be refused, got {err:?}"
    );
}

#[test]
fn a_missing_target_architecture_is_a_typed_no_arch_error() {
    let tmp = tempfile::tempdir().unwrap();
    let out = tmp.path().join("layout");
    let reg = MockRegistry::new(build_fixture(false)); // riscv64 only
    let image = ImageRef::parse("library/alpine:latest", None).unwrap();

    let err = pull_with(&reg, &image, "s390x", false, &out).unwrap_err();
    assert!(
        matches!(err, PullError::NoArch(a) if a == "s390x"),
        "wanted NoArch"
    );
}
