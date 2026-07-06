//! E3.5-T01: `wasm-vm oci unpack <layout-dir> <out-dir>` — resolve an OCI image-layout to its
//! linux/riscv64 manifest, verify every blob's sha256 digest, gunzip + untar each layer feeding
//! the shared whiteout applier ([`wasm_vm_storage::oci`]), and write the flattened rootfs.
//!
//! Input is a standard OCI image-layout (`skopeo copy … oci:dir` / `docker save`-style):
//!   `index.json` → a manifest (or a manifest-list we pick linux/riscv64 from) → `config` + N
//!   `layers`, all under `blobs/sha256/<hex>`. The registry PULL that fetches this layout over
//!   HTTP is a later (network) pass; this is the local, deterministic, unit-tested core.

use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::ExitCode;

use clap::Args;
use flate2::read::GzDecoder;
use serde::Deserialize;
use sha2::{Digest, Sha256};
use wasm_vm_storage::oci::{Entry, Node, OciError, Tree, apply_layer};

#[derive(Args)]
pub struct UnpackArgs {
    /// An OCI image-layout directory (`index.json` + `blobs/sha256/…`).
    layout: PathBuf,
    /// Output directory for the flattened rootfs (created; must not escape).
    #[arg(long)]
    out: PathBuf,
    /// Target platform architecture to pick from a manifest list (default riscv64).
    #[arg(long, default_value = "riscv64")]
    arch: String,
}

// The String/field payloads are surfaced through Debug (`{e:?}`) in the CLI + test assertions;
// clippy's dead-code pass doesn't count Debug-only reads, so allow it here.
#[derive(Debug)]
#[allow(dead_code)]
pub enum UnpackError {
    Io(String),
    Json(String),
    /// A blob's bytes do not hash to its digest (corruption / tamper).
    DigestMismatch {
        expected: String,
        actual: String,
    },
    /// No manifest matched the requested architecture.
    NoArch(String),
    BadDigest(String),
    Oci(OciError),
}

impl From<OciError> for UnpackError {
    fn from(e: OciError) -> Self {
        UnpackError::Oci(e)
    }
}

// ── Minimal OCI JSON shapes (only the fields we use) ─────────────────────────────────────────
#[derive(Deserialize)]
struct Descriptor {
    digest: String,
    #[serde(default)]
    #[serde(rename = "mediaType")]
    media_type: String,
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
    layers: Vec<Descriptor>,
}

/// `blobs/sha256/<hex>` for a `sha256:<hex>` digest.
fn blob_path(layout: &Path, digest: &str) -> Result<PathBuf, UnpackError> {
    let hex = digest
        .strip_prefix("sha256:")
        .ok_or_else(|| UnpackError::BadDigest(digest.to_string()))?;
    Ok(layout.join("blobs").join("sha256").join(hex))
}

/// Read a blob and VERIFY its bytes hash to `digest` before returning them (never trust a blob
/// unverified — the T01 charter).
fn read_verified(layout: &Path, digest: &str) -> Result<Vec<u8>, UnpackError> {
    let path = blob_path(layout, digest)?;
    let bytes =
        std::fs::read(&path).map_err(|e| UnpackError::Io(format!("{}: {e}", path.display())))?;
    let actual = format!("sha256:{}", hex(&Sha256::digest(&bytes)));
    if actual != *digest {
        return Err(UnpackError::DigestMismatch {
            expected: digest.to_string(),
            actual,
        });
    }
    Ok(bytes)
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

/// Resolve the index → the manifest for `arch` (following a manifest list if present).
fn resolve_manifest(layout: &Path, arch: &str) -> Result<Manifest, UnpackError> {
    let index_text = std::fs::read_to_string(layout.join("index.json"))
        .map_err(|e| UnpackError::Io(format!("index.json: {e}")))?;
    let index: Index =
        serde_json::from_str(&index_text).map_err(|e| UnpackError::Json(e.to_string()))?;

    // Find a manifest whose platform matches `arch` (linux/*), OR if the single top entry is a
    // plain manifest (no platform), use it; OR follow it if it's an index.
    let pick = pick_arch(&index.manifests, arch);
    let desc = pick.ok_or_else(|| UnpackError::NoArch(arch.to_string()))?;
    let bytes = read_verified(layout, &desc.digest)?;

    // The picked descriptor may itself be a manifest-list (nested index) or a manifest.
    if desc.media_type.contains("index") || desc.media_type.contains("manifest.list") {
        let nested: Index = serde_json::from_str(&String::from_utf8_lossy(&bytes))
            .map_err(|e| UnpackError::Json(e.to_string()))?;
        let d2 = pick_arch(&nested.manifests, arch)
            .ok_or_else(|| UnpackError::NoArch(arch.to_string()))?;
        let mbytes = read_verified(layout, &d2.digest)?;
        return serde_json::from_str(&String::from_utf8_lossy(&mbytes))
            .map_err(|e| UnpackError::Json(e.to_string()));
    }
    serde_json::from_str(&String::from_utf8_lossy(&bytes))
        .map_err(|e| UnpackError::Json(e.to_string()))
}

/// Pick the descriptor matching `arch` (preferring linux); fall back to a lone platformless entry.
fn pick_arch<'a>(descs: &'a [Descriptor], arch: &str) -> Option<&'a Descriptor> {
    if let Some(d) = descs.iter().find(|d| {
        d.platform
            .as_ref()
            .is_some_and(|p| p.architecture == arch && (p.os.is_empty() || p.os == "linux"))
    }) {
        return Some(d);
    }
    // No platform info (a single-arch image's index) → the sole manifest.
    if descs.len() == 1 && descs[0].platform.is_none() {
        return Some(&descs[0]);
    }
    None
}

/// Total decompressed bytes we will read from a single layer before treating it as a bomb. Far
/// above any real riscv64 base/database image, well below OOM. Streamed — never buffered whole.
const MAX_LAYER_BYTES: u64 = 8 * 1024 * 1024 * 1024;

/// Parse one layer tar (gzip-sniffed) STREAMING from the decompressor and apply it, refusing to
/// read past `budget` decompressed bytes (the gzip-bomb DoS guard — critic MAJOR 2d; streaming so
/// a bomb never buffers to RAM).
fn apply_layer_tar(tree: &mut Tree, tar_bytes: &[u8]) -> Result<(), UnpackError> {
    apply_layer_tar_capped(tree, tar_bytes, MAX_LAYER_BYTES)
}

fn cap_err(budget: u64) -> UnpackError {
    UnpackError::Io(format!(
        "layer inflates past the {budget}-byte cap (possible decompression bomb)"
    ))
}

fn apply_layer_tar_capped(
    tree: &mut Tree,
    tar_bytes: &[u8],
    budget: u64,
) -> Result<(), UnpackError> {
    // A stored (uncompressed) tar starts with a ustar header; only inflate on the gzip magic.
    // `Read::take(budget + 1)` bounds the TOTAL bytes pulled from the (possibly bombing) stream;
    // we detect overflow by seeing the reader still has bytes at the cap.
    let gz = tar_bytes.starts_with(&[0x1f, 0x8b]);
    let src: Box<dyn Read> = if gz {
        Box::new(GzDecoder::new(tar_bytes))
    } else {
        Box::new(tar_bytes)
    };
    let count = std::rc::Rc::new(std::cell::Cell::new(0u64));
    let mut counted = CountingRead {
        inner: src.take(budget + 1),
        count: count.clone(),
    };
    // Once the capped stream is exhausted, tar reads fail with EOF; map those to the cap error.
    let over = || count.get() > budget;

    // Single streaming pass: collect ordered member paths + the entry map the applier needs.
    let mut ordered: Vec<String> = Vec::new();
    let mut by_path: std::collections::HashMap<String, Entry> = std::collections::HashMap::new();
    let mut ar = tar::Archive::new(&mut counted);
    for ent in ar.entries().map_err(|e| {
        if over() {
            cap_err(budget)
        } else {
            UnpackError::Io(format!("tar: {e}"))
        }
    })? {
        let mut ent = ent.map_err(|e| {
            if over() {
                cap_err(budget)
            } else {
                UnpackError::Io(format!("tar entry: {e}"))
            }
        })?;
        let raw_path = ent
            .path()
            .map_err(|e| UnpackError::Io(format!("tar path: {e}")))?
            .to_string_lossy()
            .into_owned();
        // A `.wh.` member is a whiteout — recorded in `ordered` only; the applier re-derives it.
        let name = raw_path.rsplit('/').next().unwrap_or("");
        let is_whiteout = name.starts_with(".wh.");
        let hdr = ent.header();
        let mode = hdr.mode().unwrap_or(0o644);
        ordered.push(raw_path.clone());
        if is_whiteout {
            continue;
        }
        let clean = match wasm_vm_storage::oci::safe_path(&raw_path) {
            Ok(c) => c,
            Err(e) => return Err(UnpackError::Oci(e)),
        };
        let entry = match hdr.entry_type() {
            tar::EntryType::Directory => Entry::Dir { path: clean, mode },
            tar::EntryType::Symlink => {
                let target = hdr
                    .link_name()
                    .ok()
                    .flatten()
                    .map(|p| p.to_string_lossy().into_owned())
                    .unwrap_or_default();
                Entry::Symlink {
                    path: clean,
                    target,
                }
            }
            tar::EntryType::Link => {
                let target = hdr
                    .link_name()
                    .ok()
                    .flatten()
                    .map(|p| p.to_string_lossy().into_owned())
                    .unwrap_or_default();
                Entry::Hardlink {
                    path: clean,
                    target,
                }
            }
            _ => {
                let mut data = Vec::new();
                ent.read_to_end(&mut data).map_err(|e| {
                    if over() {
                        cap_err(budget)
                    } else {
                        UnpackError::Io(format!("tar read: {e}"))
                    }
                })?;
                Entry::File {
                    path: clean,
                    mode,
                    data,
                }
            }
        };
        by_path.insert(raw_path, entry);
    }
    // Drop the archive borrow, then confirm we didn't hit the cap (a bomb keeps producing bytes
    // past `budget`, so `count` reaches budget+1).
    // `count` is a shared Rc<Cell> (not borrowed via `ar`), so it can be read directly.
    if count.get() > budget {
        return Err(UnpackError::Io(format!(
            "layer inflates past the {budget}-byte cap (possible decompression bomb)"
        )));
    }

    apply_layer(tree, &ordered, |raw| Ok(by_path.get(raw).cloned())).map_err(UnpackError::Oci)
}

/// A `Read` that counts the bytes it passes through — so we can detect a layer that decompresses
/// past its budget without buffering the whole thing.
struct CountingRead<R: Read> {
    inner: R,
    count: std::rc::Rc<std::cell::Cell<u64>>,
}
impl<R: Read> Read for CountingRead<R> {
    fn read(&mut self, buf: &mut [u8]) -> std::io::Result<usize> {
        let n = self.inner.read(buf)?;
        self.count.set(self.count.get() + n as u64);
        Ok(n)
    }
}

/// Write the flattened tree to `out`, refusing to follow any path outside it (belt-and-suspenders
/// on top of the applier's `safe_path`).
fn write_tree(tree: &Tree, out: &Path) -> Result<usize, UnpackError> {
    std::fs::create_dir_all(out).map_err(|e| UnpackError::Io(format!("{}: {e}", out.display())))?;
    let mut n = 0;
    // Directories first (sorted keys give parents before children).
    for (path, node) in tree {
        let dst = out.join(path);
        if !dst.starts_with(out) {
            return Err(UnpackError::Oci(OciError::UnsafePath(path.clone())));
        }
        // Critic CRITICAL 1a: refuse to write THROUGH a symlink. If any on-disk ancestor of `dst`
        // is a symlink, a std::fs::write would follow it out of the root. The applier already
        // rejects symlink-descent keys; this is the write-side belt so no path can escape even if
        // the tree were built another way.
        if let Some(bad) = symlinked_ancestor_on_disk(out, path) {
            return Err(UnpackError::Oci(OciError::SymlinkTraversal {
                path: path.clone(),
                via: bad,
            }));
        }
        match node {
            Node::Dir { .. } => {
                std::fs::create_dir_all(&dst)
                    .map_err(|e| UnpackError::Io(format!("{}: {e}", dst.display())))?;
            }
            Node::File { data, mode } => {
                if let Some(p) = dst.parent() {
                    std::fs::create_dir_all(p).ok();
                }
                std::fs::write(&dst, data)
                    .map_err(|e| UnpackError::Io(format!("{}: {e}", dst.display())))?;
                // Preserve the tar mode (esp. the exec bit — /bin/sh must be runnable). Mask to
                // permission bits; the type bits come from the node kind.
                #[cfg(unix)]
                {
                    use std::os::unix::fs::PermissionsExt;
                    let _ = std::fs::set_permissions(
                        &dst,
                        std::fs::Permissions::from_mode(mode & 0o7777),
                    );
                }
                n += 1;
            }
            Node::Symlink { target } => {
                if let Some(p) = dst.parent() {
                    std::fs::create_dir_all(p).ok();
                }
                let _ = std::fs::remove_file(&dst);
                #[cfg(unix)]
                std::os::unix::fs::symlink(target, &dst)
                    .map_err(|e| UnpackError::Io(format!("symlink {}: {e}", dst.display())))?;
                n += 1;
            }
        }
    }
    Ok(n)
}

/// The first on-disk ancestor of `<out>/<rel>` that is a symlink (via `symlink_metadata`, which
/// does NOT follow), if any — used to refuse writing through a symlink.
fn symlinked_ancestor_on_disk(out: &Path, rel: &str) -> Option<String> {
    let mut acc = out.to_path_buf();
    let comps: Vec<&str> = rel.split('/').collect();
    // Check every ANCESTOR component (not the leaf — the leaf may legitimately be a symlink).
    for comp in &comps[..comps.len().saturating_sub(1)] {
        acc.push(comp);
        if let Ok(md) = std::fs::symlink_metadata(&acc)
            && md.file_type().is_symlink()
        {
            return Some(
                acc.strip_prefix(out)
                    .unwrap_or(&acc)
                    .to_string_lossy()
                    .into_owned(),
            );
        }
    }
    None
}

/// The library entry point (tested directly): unpack `layout` for `arch` into `out`, returning
/// the flattened tree.
pub fn unpack_to_tree(layout: &Path, arch: &str) -> Result<Tree, UnpackError> {
    let manifest = resolve_manifest(layout, arch)?;
    let mut tree = Tree::new();
    for layer in &manifest.layers {
        let bytes = read_verified(layout, &layer.digest)?; // digest-verified before unpack
        apply_layer_tar(&mut tree, &bytes)?;
    }
    Ok(tree)
}

pub fn unpack(a: UnpackArgs) -> ExitCode {
    match unpack_to_tree(&a.layout, &a.arch) {
        Ok(tree) => match write_tree(&tree, &a.out) {
            Ok(n) => {
                println!(
                    "oci unpack: OK — {} entries ({n} files/links) → {}",
                    tree.len(),
                    a.out.display()
                );
                ExitCode::SUCCESS
            }
            Err(e) => {
                eprintln!("oci unpack: write failed — {e:?}");
                ExitCode::from(2)
            }
        },
        Err(UnpackError::DigestMismatch { expected, actual }) => {
            eprintln!(
                "oci unpack: DIGEST MISMATCH — expected {expected}, got {actual} (corrupt/tampered blob)"
            );
            ExitCode::from(3)
        }
        Err(e) => {
            eprintln!("oci unpack: FAIL — {e:?}");
            ExitCode::from(2)
        }
    }
}

#[cfg(test)]
mod tests;
