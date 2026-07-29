//! E3.5-T01: OCI **registry pull**. Resolve an image reference (`[registry/]repo[:tag|@digest]`)
//! through the OCI Distribution protocol — anonymous Bearer token auth, multi-arch index → the
//! requested platform manifest — fetch the config + layer blobs, **verify every content digest**,
//! and write a local OCI image-layout (`index.json` + `blobs/sha256/…`) that `oci unpack` consumes.
//!
//! The protocol is **transport-agnostic**: it drives a [`Transport`] (a single authenticated GET),
//! so the whole resolve→verify→layout pipeline is unit-tested against an in-memory mock registry with
//! no network, while the live [`UreqTransport`] backs `wasm-vm oci pull` against real registries and a
//! browser `fetch` transport (crates/wasm) can reuse the identical protocol. Digest verification is
//! NON-OPTIONAL — a blob whose bytes do not hash to its descriptor digest is refused, never written.

use std::io::Read;
use std::path::{Path, PathBuf};

use clap::Args;
use serde::Deserialize;
use sha2::{Digest, Sha256};

/// The registry the Docker Hub short-names resolve to.
const DEFAULT_REGISTRY: &str = "registry-1.docker.io";
/// Every manifest media type we ask for (index + image, OCI + Docker schema2).
const MANIFEST_ACCEPT: &[&str] = &[
    "application/vnd.oci.image.index.v1+json",
    "application/vnd.oci.image.manifest.v1+json",
    "application/vnd.docker.distribution.manifest.list.v2+json",
    "application/vnd.docker.distribution.manifest.v2+json",
];
/// Cap a single blob/manifest body so a hostile `Content-Length`-less response can't exhaust memory.
const MAX_BLOB_BYTES: u64 = 1 << 30; // 1 GiB

#[derive(Args)]
pub struct PullArgs {
    /// Image reference: `[registry/]repository[:tag|@sha256:…]` (e.g. `alpine:latest`,
    /// `ghcr.io/owner/img:tag`). Docker Hub short names get the `library/` prefix.
    image: String,
    /// Output OCI image-layout directory (created).
    #[arg(long)]
    out: PathBuf,
    /// Platform architecture to select from a multi-arch index.
    #[arg(long, default_value = "riscv64")]
    arch: String,
    /// Registry host override (otherwise taken from the reference, else Docker Hub).
    #[arg(long)]
    registry: Option<String>,
    /// Use plain HTTP instead of HTTPS (local test registries only).
    #[arg(long)]
    insecure: bool,
}

/// Every pull failure is one of these typed variants — never a panic, never a silent partial layout.
#[derive(Debug)]
#[allow(dead_code)] // fields are surfaced through Debug in the CLI + test assertions
pub enum PullError {
    BadRef(String),
    /// A non-success HTTP status the protocol can't recover from.
    Http {
        status: u16,
        url: String,
    },
    /// The auth challenge was missing/unparsable or the token endpoint failed.
    Auth(String),
    Transport(String),
    Json(String),
    /// A blob's bytes do not hash to its descriptor digest (corruption / tamper) — refused.
    DigestMismatch {
        expected: String,
        actual: String,
    },
    /// The index carried no manifest for the requested architecture.
    NoArch(String),
    Io(String),
}

// ── Transport seam ───────────────────────────────────────────────────────────

/// One authenticated registry GET. `bearer` is the anonymous pull token (once obtained). The
/// transport MUST follow redirects (registries 307 blob GETs to a CDN) and surface the response
/// status + `WWW-Authenticate` header (for the 401 auth challenge) rather than turning them into
/// errors.
pub trait Transport {
    fn get(
        &self,
        url: &str,
        accept: &[&str],
        bearer: Option<&str>,
    ) -> Result<HttpResponse, PullError>;
}

pub struct HttpResponse {
    pub status: u16,
    pub www_authenticate: Option<String>,
    pub body: Vec<u8>,
}

// ── Image reference ───────────────────────────────────────────────────────────

#[derive(Debug, PartialEq, Eq)]
pub struct ImageRef {
    pub registry: String,
    pub repository: String,
    /// A tag, or `sha256:…` when referenced by digest.
    pub reference: String,
}

impl ImageRef {
    /// Parse `[registry/]repository[:tag|@digest]`, applying Docker Hub defaults (`library/` prefix
    /// for single-segment official names, `latest` when no tag/digest is given).
    pub fn parse(image: &str, registry_override: Option<&str>) -> Result<ImageRef, PullError> {
        if image.is_empty() {
            return Err(PullError::BadRef("empty image reference".into()));
        }
        // Split an optional registry: the first `/`-segment is a registry iff it looks like a host
        // (contains `.` or `:`, or is `localhost`) — otherwise it's part of a Docker Hub repo path.
        let (mut registry, remainder) = match image.split_once('/') {
            Some((head, rest))
                if head == "localhost" || head.contains('.') || head.contains(':') =>
            {
                (head.to_string(), rest.to_string())
            }
            _ => (DEFAULT_REGISTRY.to_string(), image.to_string()),
        };
        if let Some(r) = registry_override {
            registry = r.to_string();
        }
        // Split the reference: `@sha256:…` (digest) wins over `:tag`.
        let (repo, reference) = if let Some((repo, digest)) = remainder.split_once('@') {
            (repo.to_string(), digest.to_string())
        } else if let Some((repo, tag)) = remainder.rsplit_once(':') {
            // A ':' before a '/' is a registry port, not a tag — but we already stripped the
            // registry, so any ':' here is a tag.
            (repo.to_string(), tag.to_string())
        } else {
            (remainder.clone(), "latest".to_string())
        };
        if repo.is_empty() {
            return Err(PullError::BadRef(format!("no repository in {image:?}")));
        }
        // Docker Hub official single-segment names live under `library/`.
        let repository = if registry == DEFAULT_REGISTRY && !repo.contains('/') {
            format!("library/{repo}")
        } else {
            repo
        };
        Ok(ImageRef {
            registry,
            repository,
            reference,
        })
    }
}

// ── OCI JSON shapes (only the fields the pull needs) ──────────────────────────

#[derive(Deserialize)]
struct Descriptor {
    digest: String,
    #[serde(default)]
    platform: Option<Platform>,
}
#[derive(Deserialize)]
struct Platform {
    #[serde(default)]
    architecture: String,
    #[serde(default)]
    os: String,
}
#[derive(Deserialize)]
struct Index {
    manifests: Vec<Descriptor>,
}
#[derive(Deserialize)]
struct Manifest {
    config: Descriptor,
    layers: Vec<Descriptor>,
}

// ── The pull protocol ─────────────────────────────────────────────────────────

/// What a successful pull wrote — the layout dir plus the platform manifest digest (the layout's
/// single index entry), so a caller can immediately `unpack` it.
#[derive(Debug)]
pub struct Pulled {
    pub layout: PathBuf,
    pub manifest_digest: String,
    pub layer_count: usize,
}

fn base(image: &ImageRef, insecure: bool) -> String {
    let scheme = if insecure { "http" } else { "https" };
    format!("{scheme}://{}/v2/{}", image.registry, image.repository)
}

fn sha256_hex(bytes: &[u8]) -> String {
    format!("sha256:{}", hex(&Sha256::digest(bytes)))
}
fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

fn verify(bytes: &[u8], digest: &str) -> Result<(), PullError> {
    let actual = sha256_hex(bytes);
    if actual != digest {
        return Err(PullError::DigestMismatch {
            expected: digest.to_string(),
            actual,
        });
    }
    Ok(())
}

/// Parse the `Bearer realm=…,service=…,scope=…` challenge into a token URL.
fn token_url_from_challenge(challenge: &str, image: &ImageRef) -> Result<String, PullError> {
    let rest = challenge
        .trim()
        .strip_prefix("Bearer ")
        .ok_or_else(|| PullError::Auth(format!("not a Bearer challenge: {challenge:?}")))?;
    let mut realm = None;
    let mut service = None;
    let mut scope = None;
    for part in rest.split(',') {
        let (k, v) = part
            .split_once('=')
            .ok_or_else(|| PullError::Auth(format!("malformed challenge param: {part:?}")))?;
        let v = v.trim().trim_matches('"').to_string();
        match k.trim() {
            "realm" => realm = Some(v),
            "service" => service = Some(v),
            "scope" => scope = Some(v),
            _ => {}
        }
    }
    let realm = realm.ok_or_else(|| PullError::Auth("challenge missing realm".into()))?;
    // The registry may omit scope; derive the standard pull scope for this repository.
    let scope = scope.unwrap_or_else(|| format!("repository:{}:pull", image.repository));
    let mut url = format!("{realm}?scope={scope}");
    if let Some(service) = service {
        url.push_str(&format!("&service={service}"));
    }
    Ok(url)
}

#[derive(Deserialize)]
struct TokenResponse {
    #[serde(default)]
    token: String,
    #[serde(default)]
    access_token: String,
}

/// GET `url` for a manifest/blob, transparently performing the anonymous-Bearer 401→token→retry
/// dance once. Returns the (verified-by-caller) body of a 2xx response.
fn get_authed<T: Transport>(
    transport: &T,
    image: &ImageRef,
    url: &str,
    accept: &[&str],
    token: &mut Option<String>,
) -> Result<Vec<u8>, PullError> {
    let resp = transport.get(url, accept, token.as_deref())?;
    let resp = if resp.status == 401 {
        let challenge = resp
            .www_authenticate
            .ok_or_else(|| PullError::Auth("401 without a WWW-Authenticate challenge".into()))?;
        let token_url = token_url_from_challenge(&challenge, image)?;
        let tok = transport.get(&token_url, &[], None)?;
        if tok.status != 200 {
            return Err(PullError::Http {
                status: tok.status,
                url: token_url,
            });
        }
        let parsed: TokenResponse =
            serde_json::from_slice(&tok.body).map_err(|e| PullError::Json(e.to_string()))?;
        let bearer = if !parsed.token.is_empty() {
            parsed.token
        } else {
            parsed.access_token
        };
        if bearer.is_empty() {
            return Err(PullError::Auth("token endpoint returned no token".into()));
        }
        *token = Some(bearer);
        transport.get(url, accept, token.as_deref())?
    } else {
        resp
    };
    if resp.status != 200 {
        return Err(PullError::Http {
            status: resp.status,
            url: url.to_string(),
        });
    }
    Ok(resp.body)
}

fn is_index(media_type: &str, bytes: &[u8]) -> bool {
    if media_type.contains("index") || media_type.contains("manifest.list") {
        return true;
    }
    // Fall back to sniffing the JSON when the transport didn't preserve the media type: an index has
    // a `manifests` array, an image manifest has `layers`.
    serde_json::from_slice::<serde_json::Value>(bytes)
        .ok()
        .and_then(|v| v.get("manifests").map(|m| m.is_array()))
        .unwrap_or(false)
}

fn pick_arch<'a>(index: &'a Index, arch: &str) -> Option<&'a Descriptor> {
    index
        .manifests
        .iter()
        .find(|d| {
            d.platform
                .as_ref()
                .is_some_and(|p| p.architecture == arch && (p.os.is_empty() || p.os == "linux"))
        })
        // A single platformless entry (a plain image pushed without an index) is taken as-is.
        .or_else(|| {
            (index.manifests.len() == 1 && index.manifests[0].platform.is_none())
                .then(|| &index.manifests[0])
        })
}

/// Drive the full pull with an injected transport. Pure of any network specifics — this is the
/// unit-tested core.
pub fn pull_with<T: Transport>(
    transport: &T,
    image: &ImageRef,
    arch: &str,
    insecure: bool,
    out: &Path,
) -> Result<Pulled, PullError> {
    let base = base(image, insecure);
    let mut token: Option<String> = None;

    // 1. Top manifest by reference (tag or digest).
    let top_url = format!("{base}/manifests/{}", image.reference);
    let top = get_authed(transport, image, &top_url, MANIFEST_ACCEPT, &mut token)?;

    // 2. If it's an index/manifest-list, pick the platform and fetch that image manifest by digest.
    let (manifest_bytes, manifest_digest) = if is_index("", &top) {
        let index: Index =
            serde_json::from_slice(&top).map_err(|e| PullError::Json(e.to_string()))?;
        let desc = pick_arch(&index, arch).ok_or_else(|| PullError::NoArch(arch.to_string()))?;
        let url = format!("{base}/manifests/{}", desc.digest);
        let bytes = get_authed(transport, image, &url, MANIFEST_ACCEPT, &mut token)?;
        verify(&bytes, &desc.digest)?;
        (bytes, desc.digest.clone())
    } else {
        let digest = sha256_hex(&top);
        (top, digest)
    };

    let manifest: Manifest =
        serde_json::from_slice(&manifest_bytes).map_err(|e| PullError::Json(e.to_string()))?;

    // 3. Fetch + verify config and every layer blob.
    let out = out.to_path_buf();
    let blobs = out.join("blobs").join("sha256");
    std::fs::create_dir_all(&blobs).map_err(|e| PullError::Io(e.to_string()))?;

    write_blob(&out, &manifest_digest, &manifest_bytes)?; // manifest is itself a blob in the layout
    let config = get_blob(transport, image, &base, &manifest.config.digest, &mut token)?;
    write_blob(&out, &manifest.config.digest, &config)?;
    for layer in &manifest.layers {
        let bytes = get_blob(transport, image, &base, &layer.digest, &mut token)?;
        write_blob(&out, &layer.digest, &bytes)?;
    }

    // 4. Emit the single-manifest index the unpacker reads (platform = the requested arch).
    let index = serde_json::json!({
        "schemaVersion": 2,
        "manifests": [{
            "mediaType": "application/vnd.oci.image.manifest.v1+json",
            "digest": manifest_digest,
            "size": manifest_bytes.len(),
            "platform": { "architecture": arch, "os": "linux" }
        }]
    });
    std::fs::write(
        out.join("index.json"),
        serde_json::to_vec_pretty(&index).map_err(|e| PullError::Json(e.to_string()))?,
    )
    .map_err(|e| PullError::Io(e.to_string()))?;

    Ok(Pulled {
        layout: out,
        manifest_digest,
        layer_count: manifest.layers.len(),
    })
}

fn get_blob<T: Transport>(
    transport: &T,
    image: &ImageRef,
    base: &str,
    digest: &str,
    token: &mut Option<String>,
) -> Result<Vec<u8>, PullError> {
    let url = format!("{base}/blobs/{digest}");
    let bytes = get_authed(transport, image, &url, &[], token)?;
    verify(&bytes, digest)?; // never trust a blob unverified
    Ok(bytes)
}

fn write_blob(layout: &Path, digest: &str, bytes: &[u8]) -> Result<(), PullError> {
    let hex = digest
        .strip_prefix("sha256:")
        .ok_or_else(|| PullError::BadRef(format!("bad digest {digest:?}")))?;
    let path = layout.join("blobs").join("sha256").join(hex);
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| PullError::Io(e.to_string()))?;
    }
    std::fs::write(&path, bytes).map_err(|e| PullError::Io(e.to_string()))
}

// ── Live HTTPS transport (ureq + rustls) ──────────────────────────────────────

pub struct UreqTransport {
    agent: ureq::Agent,
}

impl Default for UreqTransport {
    fn default() -> Self {
        Self {
            agent: ureq::AgentBuilder::new()
                .timeout(std::time::Duration::from_secs(60))
                .build(),
        }
    }
}

impl Transport for UreqTransport {
    fn get(
        &self,
        url: &str,
        accept: &[&str],
        bearer: Option<&str>,
    ) -> Result<HttpResponse, PullError> {
        let mut req = self.agent.get(url);
        if !accept.is_empty() {
            req = req.set("Accept", &accept.join(", "));
        }
        if let Some(b) = bearer {
            req = req.set("Authorization", &format!("Bearer {b}"));
        }
        // ureq returns Err(Status) for 4xx/5xx; we need the 401 body+headers, so fold both arms.
        let (status, resp) = match req.call() {
            Ok(resp) => (resp.status(), Some(resp)),
            Err(ureq::Error::Status(code, resp)) => (code, Some(resp)),
            Err(e) => return Err(PullError::Transport(e.to_string())),
        };
        let resp = resp.expect("response present in both arms");
        let www_authenticate = resp.header("WWW-Authenticate").map(str::to_string);
        let mut body = Vec::new();
        resp.into_reader()
            .take(MAX_BLOB_BYTES)
            .read_to_end(&mut body)
            .map_err(|e| PullError::Transport(e.to_string()))?;
        Ok(HttpResponse {
            status,
            www_authenticate,
            body,
        })
    }
}

/// CLI entry: `wasm-vm oci pull <image> --out <layout>`.
pub fn pull(args: PullArgs) -> std::process::ExitCode {
    let image = match ImageRef::parse(&args.image, args.registry.as_deref()) {
        Ok(r) => r,
        Err(e) => {
            eprintln!("oci pull: {e:?}");
            return std::process::ExitCode::FAILURE;
        }
    };
    eprintln!(
        "oci pull: {}/{}:{} → {} ({})",
        image.registry,
        image.repository,
        image.reference,
        args.out.display(),
        args.arch
    );
    match pull_with(
        &UreqTransport::default(),
        &image,
        &args.arch,
        args.insecure,
        &args.out,
    ) {
        Ok(p) => {
            println!(
                "pulled {} ({} layers) to {}",
                p.manifest_digest,
                p.layer_count,
                p.layout.display()
            );
            std::process::ExitCode::SUCCESS
        }
        Err(e) => {
            eprintln!("oci pull failed: {e:?}");
            std::process::ExitCode::FAILURE
        }
    }
}

#[cfg(test)]
#[path = "pull/tests.rs"]
mod tests;
