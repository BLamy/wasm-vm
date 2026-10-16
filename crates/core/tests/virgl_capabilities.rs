#![cfg(feature = "virgl-renderer")]
use std::process::Command;
use wasm_vm_core::dev::virtio::gpu::capabilities::{FormatMask, HostLimits, QualifiedCapabilities};

fn limits() -> HostLimits {
    HostLimits {
        texture_2d: 8192,
        texture_3d: 256,
        texture_cube: 4096,
        array_layers: 1024,
        varying_vectors: 32,
        vertex_attributes: 16,
        uniform_block_bytes: 32768,
        uniform_alignment: 256,
        vertex_samplers: 32,
        fragment_samplers: 16,
        vertex_constant_vectors: 1024,
        fragment_constant_vectors: 1024,
        feedback_components: 128,
        samples: 4,
    }
}
fn mask(values: &[u32]) -> FormatMask {
    let mut mask = FormatMask::default();
    for &value in values {
        mask.insert(value).unwrap();
    }
    mask
}
#[test]
fn complete_wire_matches_independent_pinned_c_abi() {
    let repo = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
    let executable =
        std::env::temp_dir().join(format!("wasm-vm-caps-oracle-{}", std::process::id()));
    let compile = Command::new("cc")
        .current_dir(&repo)
        .args([
            "-std=c11",
            "-Wall",
            "-Wextra",
            "-Werror",
            "tools/virgl-production/caps_oracle.c",
            "-o",
        ])
        .arg(&executable)
        .output()
        .unwrap();
    assert!(
        compile.status.success(),
        "{}",
        String::from_utf8_lossy(&compile.stderr)
    );
    let output = Command::new(&executable).output().unwrap();
    std::fs::remove_file(&executable).unwrap();
    assert!(output.status.success());
    assert_eq!(output.stdout.len(), 1408);
    let caps = QualifiedCapabilities::new(
        limits(),
        mask(&[2, 16, 67]),
        mask(&[2, 67]),
        mask(&[16]),
        mask(&[28, 67]),
        mask(&[2, 16, 67]),
        "wasm-vm WebGL2 VirGL",
    )
    .unwrap();
    assert_eq!(
        caps.to_bytes(),
        output.stdout,
        "every field, padding byte, format mask and unsupported capability"
    );
}
#[test]
fn host_floor_and_format_mask_fail_closed() {
    let mut invalid = limits();
    invalid.uniform_alignment = 3;
    assert!(
        QualifiedCapabilities::new(
            invalid,
            mask(&[]),
            mask(&[]),
            mask(&[]),
            mask(&[]),
            mask(&[]),
            "GPU"
        )
        .is_err()
    );
    let mut invalid = limits();
    invalid.feedback_components = 63;
    assert!(
        QualifiedCapabilities::new(
            invalid,
            mask(&[]),
            mask(&[]),
            mask(&[]),
            mask(&[]),
            mask(&[]),
            "GPU"
        )
        .is_err()
    );
    assert!(FormatMask::default().insert(512).is_err());
    assert!(
        QualifiedCapabilities::new(
            limits(),
            mask(&[]),
            mask(&[]),
            mask(&[]),
            mask(&[]),
            mask(&[]),
            "GPU\0alias"
        )
        .is_err()
    );
}
