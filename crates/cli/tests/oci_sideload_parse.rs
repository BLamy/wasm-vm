//! E3.5-T04d CI gate for the `tools/oci-sideload.sh` reference parser. Runs the script's built-in
//! `--selftest` (deterministic, NO network) so CI catches host/repo/tag parsing regressions — e.g.
//! the `nginx:1.27`-mis-read-as-a-host bug the selftest caught during development.
use std::process::Command;

#[test]
fn oci_sideload_ref_parse_selftest() {
    let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .and_then(|p| p.parent())
        .expect("crates/cli → repo root");
    let script = root.join("tools/oci-sideload.sh");
    assert!(script.exists(), "missing {}", script.display());
    let out = Command::new("bash")
        .arg(&script)
        .arg("--selftest")
        .output()
        .expect("run oci-sideload.sh --selftest");
    assert!(
        out.status.success(),
        "oci-sideload ref-parse selftest FAILED:\n--- stdout ---\n{}\n--- stderr ---\n{}",
        String::from_utf8_lossy(&out.stdout),
        String::from_utf8_lossy(&out.stderr),
    );
}
