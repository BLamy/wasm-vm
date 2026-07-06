//! E3-T02 pass 4: integration test for `wasm-vm chunk` — the image is cut into content-addressed
//! chunk files whose bytes match the manifest hashes and reassemble to the original.

use std::io::Write;

use assert_cmd::Command;

/// Chunk a byte pattern and assert the emitted manifest + chunk files are self-consistent.
#[test]
fn chunk_split_emits_verifiable_chunks() {
    // 5000 bytes, 1024-byte chunks → [1024×4, 904].
    let data: Vec<u8> = (0..5000u32).map(|i| (i % 251) as u8).collect();
    let mut img = tempfile::NamedTempFile::new().unwrap();
    img.write_all(&data).unwrap();
    img.flush().unwrap();
    let out = tempfile::tempdir().unwrap();

    Command::cargo_bin("wasm-vm")
        .unwrap()
        .args([
            "chunk",
            img.path().to_str().unwrap(),
            "--out",
            out.path().to_str().unwrap(),
            "--chunk-size",
            "1024",
            "--layout",
            "split",
        ])
        .assert()
        .success();

    // Manifest parses and declares the right shape.
    let manifest: serde_json::Value =
        serde_json::from_slice(&std::fs::read(out.path().join("manifest.json")).unwrap()).unwrap();
    assert_eq!(manifest["image_len"], 5000);
    assert_eq!(manifest["chunk_size"], 1024);
    let hashes = manifest["chunks"].as_array().unwrap();
    assert_eq!(hashes.len(), 5);

    // Each chunk file exists, its bytes are the right slice, and its filename == sha256(bytes).
    let mut reassembled = Vec::new();
    for (i, h) in hashes.iter().enumerate() {
        let hash = h.as_str().unwrap();
        let bytes = std::fs::read(out.path().join("chunks").join(format!("{hash}.bin"))).unwrap();
        let lo = i * 1024;
        let hi = (lo + 1024).min(data.len());
        assert_eq!(bytes, &data[lo..hi], "chunk {i} bytes");
        // Content-addressed: the filename is the hash of the contents.
        let got: String = <sha2::Sha256 as sha2::Digest>::digest(&bytes)
            .iter()
            .map(|b| format!("{b:02x}"))
            .collect();
        assert_eq!(got, hash, "chunk {i} filename is its content hash");
        reassembled.extend_from_slice(&bytes);
    }
    assert_eq!(reassembled, data, "chunks reassemble to the original image");
}

/// A non-power-of-two chunk size is rejected with a non-zero exit, not a panic.
#[test]
fn chunk_rejects_bad_chunk_size() {
    let mut img = tempfile::NamedTempFile::new().unwrap();
    img.write_all(&[0u8; 100]).unwrap();
    img.flush().unwrap();
    let out = tempfile::tempdir().unwrap();
    Command::cargo_bin("wasm-vm")
        .unwrap()
        .args([
            "chunk",
            img.path().to_str().unwrap(),
            "--out",
            out.path().to_str().unwrap(),
            "--chunk-size",
            "1000",
        ])
        .assert()
        .failure();
}
