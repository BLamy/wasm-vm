//! E3-T11: the chunk-verify / chunk-churn CLI over real artifact directories built by
//! `wasm-vm chunk` — the reproducibility + integrity + CDN-churn guarantees, tested natively
//! with tiny synthetic images (no Docker/rootfs build needed).

use std::process::Command;

use assert_cmd::prelude::*;
use predicates::prelude::*;

fn bin() -> Command {
    Command::cargo_bin("wasm-vm").unwrap()
}

/// Build a chunked artifact dir from `bytes` with a small chunk size.
fn chunk(dir: &std::path::Path, bytes: &[u8], chunk_size: u32) {
    let img = dir.join("img.bin");
    std::fs::write(&img, bytes).unwrap();
    bin()
        .args(["chunk"])
        .arg(&img)
        .args(["--out"])
        .arg(dir.join("art"))
        .args(["--chunk-size", &chunk_size.to_string(), "--layout", "split"])
        .assert()
        .success();
}

#[test]
fn verify_accepts_a_clean_artifact_dir() {
    let td = tempfile::tempdir().unwrap();
    // 10 chunks of distinct content so every chunk file is unique.
    let bytes: Vec<u8> = (0..10_000u32).map(|i| (i % 251) as u8).collect();
    chunk(td.path(), &bytes, 1024);
    bin()
        .args(["chunk-verify"])
        .arg(td.path().join("art"))
        .assert()
        .success()
        .stdout(predicate::str::contains("OK"));
}

#[test]
fn verify_catches_a_corrupted_chunk() {
    let td = tempfile::tempdir().unwrap();
    let bytes: Vec<u8> = (0..10_000u32).map(|i| (i % 251) as u8).collect();
    chunk(td.path(), &bytes, 1024);
    // Flip one byte inside the first chunk file (its name no longer matches its content).
    let chunks = td.path().join("art/chunks");
    let first = std::fs::read_dir(&chunks)
        .unwrap()
        .next()
        .unwrap()
        .unwrap()
        .path();
    let mut data = std::fs::read(&first).unwrap();
    data[0] ^= 0xFF;
    std::fs::write(&first, &data).unwrap();
    bin()
        .args(["chunk-verify"])
        .arg(td.path().join("art"))
        .assert()
        .failure()
        .stderr(predicate::str::contains("HashMismatch"));
}

#[test]
fn verify_catches_a_missing_chunk() {
    let td = tempfile::tempdir().unwrap();
    let bytes: Vec<u8> = (0..10_000u32).map(|i| (i % 251) as u8).collect();
    chunk(td.path(), &bytes, 1024);
    let chunks = td.path().join("art/chunks");
    let first = std::fs::read_dir(&chunks)
        .unwrap()
        .next()
        .unwrap()
        .unwrap()
        .path();
    std::fs::remove_file(&first).unwrap();
    bin()
        .args(["chunk-verify"])
        .arg(td.path().join("art"))
        .assert()
        .failure()
        .stderr(predicate::str::contains("MissingChunk"));
}

#[test]
fn verify_catches_an_orphan_chunk() {
    let td = tempfile::tempdir().unwrap();
    let bytes: Vec<u8> = (0..10_000u32).map(|i| (i % 251) as u8).collect();
    chunk(td.path(), &bytes, 1024);
    // Drop an extra file into chunks/ that the manifest doesn't reference.
    std::fs::write(td.path().join("art/chunks/deadbeef"), b"orphan").unwrap();
    bin()
        .args(["chunk-verify"])
        .arg(td.path().join("art"))
        .assert()
        .failure()
        .stderr(predicate::str::contains("OrphanChunk"));
}

#[test]
fn churn_zero_for_identical_builds_and_measured_for_a_small_change() {
    let td = tempfile::tempdir().unwrap();
    let base: Vec<u8> = (0..20_000u32).map(|i| (i % 251) as u8).collect();

    let a = td.path().join("a");
    std::fs::create_dir_all(&a).unwrap();
    chunk(&a, &base, 1024);

    // Identical rebuild → 0% churn (the reproducibility guarantee).
    let b = td.path().join("b");
    std::fs::create_dir_all(&b).unwrap();
    chunk(&b, &base, 1024);
    bin()
        .args(["chunk-churn", "--old"])
        .arg(a.join("art"))
        .args(["--new"])
        .arg(b.join("art"))
        .assert()
        .success()
        .stdout(predicate::str::contains("0.0% churn"));

    // A one-chunk change: mutate a single 1KiB region → most chunks unchanged (CDN-friendly).
    let mut changed = base.clone();
    for x in changed.iter_mut().take(1024) {
        *x ^= 0x5A;
    }
    let c = td.path().join("c");
    std::fs::create_dir_all(&c).unwrap();
    chunk(&c, &changed, 1024);
    // 20 old chunks; one old cache object is invalidated → 5.0% churn and 95.0% retention.
    // Additions are reported separately rather than double-counting one replacement.
    bin()
        .args(["chunk-churn", "--old"])
        .arg(a.join("art"))
        .args(["--new"])
        .arg(c.join("art"))
        .args(["--max-churn-pct", "50"])
        .assert()
        .success()
        .stdout(predicate::str::contains("5.0% churn"))
        .stdout(predicate::str::contains("95.0% retained"));

    // And the guard TRIPS when the ceiling is set below the actual churn.
    bin()
        .args(["chunk-churn", "--old"])
        .arg(a.join("art"))
        .args(["--new"])
        .arg(c.join("art"))
        .args(["--max-churn-pct", "1"])
        .assert()
        .failure()
        .stderr(predicate::str::contains("exceeds"));
}
