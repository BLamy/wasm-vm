//! E3-T02 pass 4 tooling: `wasm-vm chunk` — cut a disk image into the E3-T01 chunked format so the
//! browser can boot it via lazy HTTP fetch (`WasmLinux.newChunkedDisk`). Emits a `manifest.json` and,
//! for `split` layout, one content-addressed file per chunk under `chunks/`. For `blob` layout it
//! emits the manifest plus a single `image.blob` (a copy of the input) that the loader Range-fetches.

use std::path::PathBuf;
use std::process::ExitCode;

use clap::Args;
use wasm_vm_storage::{ImageManifest, Layout};

#[derive(Args)]
pub struct ChunkArgs {
    /// Path to the disk image to chunk (e.g. the Alpine ext4 rootfs).
    image: PathBuf,
    /// Output directory for `manifest.json` + `chunks/` (split) or `image.blob` (blob). Created if
    /// absent.
    #[arg(long)]
    out: PathBuf,
    /// Chunk size in bytes (power of two). 128 KiB is the default — small enough that lazy boot
    /// touches only a fraction of the image, large enough to keep the fetch count reasonable.
    #[arg(long, default_value_t = 128 * 1024)]
    chunk_size: u32,
    /// Layout: `split` (one file per chunk, CDN/cache friendly) or `blob` (one file, HTTP Range).
    #[arg(long, default_value = "split")]
    layout: String,
}

pub fn chunk(a: ChunkArgs) -> ExitCode {
    let layout = match a.layout.as_str() {
        "split" => Layout::Split,
        "blob" => Layout::Blob,
        other => {
            eprintln!("wasm-vm chunk: --layout must be 'split' or 'blob', got '{other}'");
            return ExitCode::from(2);
        }
    };

    let image = match std::fs::read(&a.image) {
        Ok(b) => b,
        Err(e) => {
            eprintln!("wasm-vm chunk: cannot read {}: {e}", a.image.display());
            return ExitCode::from(2);
        }
    };

    let manifest = match ImageManifest::from_image(&image, a.chunk_size, layout) {
        Ok(m) => m,
        Err(e) => {
            eprintln!("wasm-vm chunk: {e:?}");
            return ExitCode::from(2);
        }
    };

    if let Err(e) = std::fs::create_dir_all(&a.out) {
        eprintln!("wasm-vm chunk: cannot create {}: {e}", a.out.display());
        return ExitCode::from(2);
    }

    // Manifest first (the loader fetches it before any chunk).
    let manifest_path = a.out.join("manifest.json");
    if let Err(e) = std::fs::write(&manifest_path, manifest.to_json()) {
        eprintln!("wasm-vm chunk: cannot write manifest: {e}");
        return ExitCode::from(2);
    }

    let cs = a.chunk_size as usize;
    match layout {
        Layout::Split => {
            // One immutable, content-addressed file per chunk. verify_chunk on the read side re-checks
            // the hash, so a filename collision or a corrupted CDN entry can never be served as valid.
            let chunks_dir = a.out.join("chunks");
            if let Err(e) = std::fs::create_dir_all(&chunks_dir) {
                eprintln!("wasm-vm chunk: cannot create chunks dir: {e}");
                return ExitCode::from(2);
            }
            for (data, hash) in image.chunks(cs).zip(manifest.chunks.iter()) {
                let path = chunks_dir.join(format!("{hash}.bin"));
                // Skip if already present (content-addressed → identical bytes). Cheap idempotency.
                if path.exists() {
                    continue;
                }
                if let Err(e) = std::fs::write(&path, data) {
                    eprintln!("wasm-vm chunk: cannot write {}: {e}", path.display());
                    return ExitCode::from(2);
                }
            }
        }
        Layout::Blob => {
            // A single file the loader Range-fetches; just copy the image next to the manifest.
            let blob_path = a.out.join("image.blob");
            if let Err(e) = std::fs::write(&blob_path, &image) {
                eprintln!("wasm-vm chunk: cannot write image.blob: {e}");
                return ExitCode::from(2);
            }
        }
    }

    // A one-line summary to stdout (parseable), diagnostics to stderr.
    let n = manifest.chunks.len();
    eprintln!(
        "chunked {} bytes into {n} × {}-byte {} chunks → {}",
        image.len(),
        a.chunk_size,
        a.layout,
        a.out.display()
    );
    println!(
        "{{\"image_len\":{},\"chunk_size\":{},\"chunks\":{n},\"layout\":\"{}\"}}",
        image.len(),
        a.chunk_size,
        a.layout
    );
    ExitCode::SUCCESS
}
