//! E3-T11: verify + compare chunked-image artifact directories — the reproducibility/CDN
//! guarantees the build pipeline must uphold, as native-testable CLI subcommands (the logic
//! lives here, not in a shell script, so it is unit-tested).
//!
//! `chunk-verify <dir>`: the manifest and `chunks/` are mutually consistent — every chunk the
//! manifest names exists and hashes correctly, every file in `chunks/` is referenced by the
//! manifest (no orphans), and no chunk exceeds the manifest's `chunk_size`. This is the load-time
//! integrity contract (corrupt/extra/missing chunk → nonzero exit).
//!
//! `chunk-churn --old <dir> --new <dir>`: what fraction of chunks changed between two builds —
//! the CDN-friendliness metric (a one-package rebuild should leave most chunk hashes untouched;
//! a huge churn means the ext4 layout isn't stable).

use std::collections::BTreeSet;
use std::path::{Path, PathBuf};
use std::process::ExitCode;

use clap::Args;
use wasm_vm_storage::{ImageManifest, Layout};

#[derive(Args)]
pub struct VerifyArgs {
    /// Artifact directory holding `manifest.json` + `chunks/` (split layout).
    dir: PathBuf,
}

#[derive(Args)]
pub struct ChurnArgs {
    /// The previous build's artifact directory.
    #[arg(long)]
    old: PathBuf,
    /// The new build's artifact directory.
    #[arg(long)]
    new: PathBuf,
    /// Fail (exit 3) if the changed-chunk fraction exceeds this percentage. Default off (report
    /// only) — the pipeline sets it (e.g. 50) to catch an unstable ext4 layout.
    #[arg(long)]
    max_churn_pct: Option<f64>,
}

/// The outcome of verifying one artifact directory. Split out from the CLI wrapper so tests can
/// assert on the specific failure, not just an exit code.
#[derive(Debug, PartialEq, Eq)]
pub enum VerifyError {
    ReadManifest(String),
    BadManifest(String),
    /// The manifest is `blob` layout — this checker is for the `split` (per-chunk-file) layout.
    NotSplit,
    /// A chunk named by the manifest is missing from `chunks/`.
    MissingChunk {
        index: usize,
        name: String,
    },
    /// A chunk file's bytes do not hash to the name/manifest entry.
    HashMismatch {
        index: usize,
        name: String,
    },
    /// A chunk file exceeds the manifest's `chunk_size`.
    Oversized {
        name: String,
        len: u64,
        max: u32,
    },
    /// A file in `chunks/` is not referenced by the manifest (orphan → wasted CDN storage /
    /// possible stale artifact).
    OrphanChunk {
        name: String,
    },
}

pub fn verify_dir(dir: &Path) -> Result<usize, VerifyError> {
    let manifest_path = dir.join("manifest.json");
    let text = std::fs::read_to_string(&manifest_path)
        .map_err(|e| VerifyError::ReadManifest(format!("{}: {e}", manifest_path.display())))?;
    let manifest =
        ImageManifest::from_json(&text).map_err(|e| VerifyError::BadManifest(format!("{e:?}")))?;
    if manifest.layout != Layout::Split {
        return Err(VerifyError::NotSplit);
    }

    let chunks_dir = dir.join("chunks");
    // Forward: every manifest chunk exists, hashes right, fits the chunk size.
    let referenced: BTreeSet<&String> = manifest.chunks.iter().collect();
    for (i, name) in manifest.chunks.iter().enumerate() {
        let path = chunks_dir.join(format!("{name}.bin"));
        let bytes = std::fs::read(&path).map_err(|_| VerifyError::MissingChunk {
            index: i,
            name: name.clone(),
        })?;
        if bytes.len() as u64 > u64::from(manifest.chunk_size) {
            return Err(VerifyError::Oversized {
                name: name.clone(),
                len: bytes.len() as u64,
                max: manifest.chunk_size,
            });
        }
        // verify_chunk hashes `bytes` and checks it against manifest.chunks[i] — which, for the
        // split layout, IS the file name. So this confirms bytes ↔ name ↔ manifest all agree.
        if manifest.verify_chunk(i, &bytes).is_err() {
            return Err(VerifyError::HashMismatch {
                index: i,
                name: name.clone(),
            });
        }
    }
    // Reverse: no orphan files in `chunks/` (every file is referenced). Content-addressed names
    // mean a stale/extra file is a real defect (it wastes immutable CDN storage and hints the
    // build wasn't clean).
    if let Ok(rd) = std::fs::read_dir(&chunks_dir) {
        for ent in rd.flatten() {
            let fname = ent.file_name().to_string_lossy().into_owned();
            // Chunk files are named `<hash>.bin`; the manifest stores the bare `<hash>`.
            let bare = fname
                .strip_suffix(".bin")
                .map(str::to_string)
                .unwrap_or(fname.clone());
            if !referenced.contains(&bare) {
                return Err(VerifyError::OrphanChunk { name: fname });
            }
        }
    }
    // Number of DISTINCT chunks (split layout dedupes identical chunks by name).
    Ok(referenced.len())
}

/// `(shared, changed, added, removed, total_new, churn_pct)` between two manifests' chunk SETS.
/// Churn is over the union so add+remove both count — the CDN cares about how many immutable
/// objects a rebuild invalidates/introduces.
pub fn churn(old: &ImageManifest, new: &ImageManifest) -> (usize, usize, usize, usize, usize, f64) {
    let a: BTreeSet<&String> = old.chunks.iter().collect();
    let b: BTreeSet<&String> = new.chunks.iter().collect();
    let shared = a.intersection(&b).count();
    let removed = a.difference(&b).count();
    let added = b.difference(&a).count();
    let union = a.union(&b).count();
    let changed = added + removed;
    let pct = if union == 0 {
        0.0
    } else {
        (changed as f64) * 100.0 / (union as f64)
    };
    (shared, changed, added, removed, b.len(), pct)
}

pub fn run_verify(a: VerifyArgs) -> ExitCode {
    match verify_dir(&a.dir) {
        Ok(n) => {
            println!("chunk-verify: OK — {n} distinct chunks, manifest ↔ chunks/ consistent");
            ExitCode::SUCCESS
        }
        Err(e) => {
            eprintln!("chunk-verify: FAIL — {e:?}");
            ExitCode::from(2)
        }
    }
}

fn load_manifest(dir: &Path) -> Result<ImageManifest, ExitCode> {
    let p = dir.join("manifest.json");
    let text = std::fs::read_to_string(&p).map_err(|e| {
        eprintln!("chunk-churn: cannot read {}: {e}", p.display());
        ExitCode::from(2)
    })?;
    ImageManifest::from_json(&text).map_err(|e| {
        eprintln!("chunk-churn: bad manifest {}: {e:?}", p.display());
        ExitCode::from(2)
    })
}

pub fn run_churn(a: ChurnArgs) -> ExitCode {
    let old = match load_manifest(&a.old) {
        Ok(m) => m,
        Err(c) => return c,
    };
    let new = match load_manifest(&a.new) {
        Ok(m) => m,
        Err(c) => return c,
    };
    let (shared, changed, added, removed, total, pct) = churn(&old, &new);
    println!(
        "chunk-churn: {changed} changed ({added} added, {removed} removed), {shared} shared, \
         {total} total → {pct:.1}% churn"
    );
    if let Some(max) = a.max_churn_pct
        && pct > max
    {
        eprintln!("chunk-churn: FAIL — {pct:.1}% churn exceeds --max-churn-pct {max:.1}");
        return ExitCode::from(3);
    }
    ExitCode::SUCCESS
}
