//! E3.5-T04e `oci validate` tests — synthetic bundles with in-test ELF headers, covering the
//! adversarial cases the T04b matrix critic taught (dangling / escaping / looping symlinks, wrong
//! arch, binaries outside bin dirs, script entrypoints).
use super::*;
use crate::oci::RuntimeConfig;
use std::path::Path;

#[cfg(unix)]
fn set_exec(p: &Path) {
    use std::os::unix::fs::PermissionsExt;
    std::fs::set_permissions(p, std::fs::Permissions::from_mode(0o755)).unwrap();
}
#[cfg(not(unix))]
fn set_exec(_: &Path) {}

/// Write a minimal ELF header with `machine`/`class` so `elf_ident` reads it.
fn write_elf(path: &Path, machine: u16, class: u8) {
    std::fs::create_dir_all(path.parent().unwrap()).unwrap();
    let mut b = vec![0u8; 24];
    b[..4].copy_from_slice(b"\x7fELF");
    b[4] = class; // EI_CLASS
    b[5] = 1; // EI_DATA = little-endian
    b[6] = 1; // EI_VERSION
    b[16] = 2; // e_type = ET_EXEC (offset 16)
    b[18] = (machine & 0xff) as u8;
    b[19] = (machine >> 8) as u8;
    std::fs::write(path, &b).unwrap();
    set_exec(path);
}

const RISCV: u16 = 0xF3;
const AMD64: u16 = 0x3E;

/// A bundle skeleton: `rootfs/` + `run.json` (argv/env). Returns the bundle dir.
fn make_bundle(td: &Path, argv: &[&str], env: &[&str]) -> std::path::PathBuf {
    let b = td.join("bundle");
    std::fs::create_dir_all(b.join("rootfs")).unwrap();
    let cfg = RuntimeConfig {
        argv: argv.iter().map(|s| s.to_string()).collect(),
        env: env.iter().map(|s| s.to_string()).collect(),
        cwd: "/".into(),
        user: String::new(),
    };
    std::fs::write(b.join("run.json"), serde_json::to_string(&cfg).unwrap()).unwrap();
    b
}

#[test]
fn good_riscv64_absolute_entrypoint_passes() {
    let td = tempfile::tempdir().unwrap();
    let b = make_bundle(td.path(), &["/bin/app"], &[]);
    write_elf(&b.join("rootfs/bin/app"), RISCV, 2);
    assert!(validate_bundle(&b, "riscv64").is_ok());
}

#[test]
fn bare_name_resolved_via_image_path() {
    let td = tempfile::tempdir().unwrap();
    let b = make_bundle(td.path(), &["app"], &["PATH=/opt/bin:/usr/bin"]);
    write_elf(&b.join("rootfs/opt/bin/app"), RISCV, 2);
    assert!(validate_bundle(&b, "riscv64").is_ok());
}

#[test]
fn wrong_arch_elf_is_rejected() {
    let td = tempfile::tempdir().unwrap();
    let b = make_bundle(td.path(), &["/bin/app"], &[]);
    write_elf(&b.join("rootfs/bin/app"), AMD64, 2); // x86-64 entrypoint
    let err = validate_bundle(&b, "riscv64").unwrap_err();
    assert!(
        matches!(err, ValidateError::WrongArch { .. }),
        "got {err:?}"
    );
}

#[test]
fn thirty_two_bit_riscv_is_rejected_for_riscv64() {
    let td = tempfile::tempdir().unwrap();
    let b = make_bundle(td.path(), &["/bin/app"], &[]);
    write_elf(&b.join("rootfs/bin/app"), RISCV, 1); // RV32 (ELFCLASS32)
    let err = validate_bundle(&b, "riscv64").unwrap_err();
    assert!(
        matches!(err, ValidateError::WrongArch { .. }),
        "got {err:?}"
    );
}

#[test]
fn dangling_symlink_entrypoint_is_rejected() {
    let td = tempfile::tempdir().unwrap();
    let b = make_bundle(td.path(), &["/bin/sh"], &[]);
    std::fs::create_dir_all(b.join("rootfs/bin")).unwrap();
    #[cfg(unix)]
    std::os::unix::fs::symlink("/nonexistent/nope", b.join("rootfs/bin/sh")).unwrap();
    let err = validate_bundle(&b, "riscv64").unwrap_err();
    assert!(
        matches!(
            err,
            ValidateError::NotRegularFile(_) | ValidateError::Unresolved(_)
        ),
        "got {err:?}"
    );
}

#[test]
fn rootfs_escaping_symlink_is_rejected() {
    // A container escape attempt: /bin/app → ../../../../etc/hostname (a HOST file). Must NOT resolve.
    let td = tempfile::tempdir().unwrap();
    let b = make_bundle(td.path(), &["/bin/app"], &[]);
    std::fs::create_dir_all(b.join("rootfs/bin")).unwrap();
    #[cfg(unix)]
    std::os::unix::fs::symlink("../../../../../../etc/hostname", b.join("rootfs/bin/app")).unwrap();
    let err = validate_bundle(&b, "riscv64").unwrap_err();
    assert!(
        matches!(err, ValidateError::NotRegularFile(_)),
        "got {err:?}"
    );
}

#[test]
fn symlinked_entrypoint_chases_within_rootfs() {
    // /bin/sh → busybox (relative), busybox is riscv64. Common alpine shape.
    let td = tempfile::tempdir().unwrap();
    let b = make_bundle(td.path(), &["/bin/sh"], &[]);
    write_elf(&b.join("rootfs/bin/busybox"), RISCV, 2);
    #[cfg(unix)]
    std::os::unix::fs::symlink("busybox", b.join("rootfs/bin/sh")).unwrap();
    assert!(validate_bundle(&b, "riscv64").is_ok());
}

#[test]
fn script_entrypoint_with_riscv64_interpreter_passes() {
    let td = tempfile::tempdir().unwrap();
    let b = make_bundle(td.path(), &["/entry.sh"], &[]);
    std::fs::write(b.join("rootfs/entry.sh"), b"#!/bin/busybox sh\necho hi\n").unwrap();
    set_exec(&b.join("rootfs/entry.sh"));
    write_elf(&b.join("rootfs/bin/busybox"), RISCV, 2);
    assert!(validate_bundle(&b, "riscv64").is_ok());
}

#[test]
fn script_via_env_shebang_resolves_the_program() {
    // `#!/usr/bin/env python` → resolve `python` on PATH → must be a riscv64 ELF.
    let td = tempfile::tempdir().unwrap();
    let b = make_bundle(td.path(), &["/app"], &["PATH=/usr/local/bin:/usr/bin"]);
    std::fs::write(b.join("rootfs/app"), b"#!/usr/bin/env python\nprint(1)\n").unwrap();
    set_exec(&b.join("rootfs/app"));
    write_elf(&b.join("rootfs/usr/local/bin/python"), RISCV, 2);
    assert!(validate_bundle(&b, "riscv64").is_ok());
}

#[test]
fn script_with_wrong_arch_interpreter_is_rejected() {
    let td = tempfile::tempdir().unwrap();
    let b = make_bundle(td.path(), &["/entry.sh"], &[]);
    std::fs::write(b.join("rootfs/entry.sh"), b"#!/bin/busybox sh\n").unwrap();
    set_exec(&b.join("rootfs/entry.sh"));
    write_elf(&b.join("rootfs/bin/busybox"), AMD64, 2); // x86 interpreter
    let err = validate_bundle(&b, "riscv64").unwrap_err();
    assert!(
        matches!(err, ValidateError::WrongArch { .. }),
        "got {err:?}"
    );
}

#[test]
fn missing_rootfs_and_bad_config_are_typed_errors() {
    let td = tempfile::tempdir().unwrap();
    // No rootfs.
    let b = td.path().join("empty");
    std::fs::create_dir_all(&b).unwrap();
    assert!(matches!(
        validate_bundle(&b, "riscv64"),
        Err(ValidateError::NoRootfs(_))
    ));

    // rootfs but no run.json.
    std::fs::create_dir_all(b.join("rootfs")).unwrap();
    assert!(matches!(
        validate_bundle(&b, "riscv64"),
        Err(ValidateError::NoRunJson(_))
    ));

    // empty argv → NoEntrypoint.
    let b2 = make_bundle(td.path(), &[], &[]);
    assert!(matches!(
        validate_bundle(&b2, "riscv64"),
        Err(ValidateError::NoEntrypoint)
    ));
}

#[test]
fn non_runnable_data_entrypoint_is_rejected() {
    let td = tempfile::tempdir().unwrap();
    let b = make_bundle(td.path(), &["/data"], &[]);
    std::fs::write(b.join("rootfs/data"), b"not an elf, not a script").unwrap();
    let err = validate_bundle(&b, "riscv64").unwrap_err();
    assert!(matches!(err, ValidateError::NotRunnable(_)), "got {err:?}");
}

#[test]
fn unknown_arch_is_a_typed_error() {
    let td = tempfile::tempdir().unwrap();
    let b = make_bundle(td.path(), &["/bin/app"], &[]);
    write_elf(&b.join("rootfs/bin/app"), RISCV, 2);
    assert!(matches!(
        validate_bundle(&b, "sparc"),
        Err(ValidateError::UnknownArch(_))
    ));
}
