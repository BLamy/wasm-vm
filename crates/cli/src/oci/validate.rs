//! E3.5-T04e: `wasm-vm oci validate <bundle>` — a fast, NATIVE preflight that answers "will this
//! bundle actually run?" without a ~7-minute guest boot. It checks the bundle `oci unpack` emits
//! (`rootfs/` + `run.json` + `config/…`) is coherent and correct-arch:
//!   * `run.json` parses and has a non-empty argv,
//!   * argv[0] resolves to a REAL regular executable in the rootfs (absolute / via the image PATH /
//!     through symlinks CLAMPED inside the rootfs — a dangling/looping/escaping symlink or a
//!     directory is NOT resolved),
//!   * that target is arch-correct: an ELF must match the target machine; a `#!`-script's
//!     interpreter (incl. the `env <prog>` argument) must resolve to a matching ELF.
//!
//! ELF arch is parsed directly (e_machine) — no `file(1)` dependency — so this is deterministic and
//! unit-testable in CI (unlike the boot acceptance). The symlink handling learns from the T04b
//! matrix critic: no false-pass on dangling/escape, no host-escape.

use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::ExitCode;

use clap::Args;

use super::RuntimeConfig;

#[derive(Args)]
pub struct ValidateArgs {
    /// A bundle directory (`rootfs/` + `run.json` + `config/`) produced by `oci unpack`.
    bundle: PathBuf,
    /// Expected architecture of the entrypoint binary (default riscv64).
    #[arg(long, default_value = "riscv64")]
    arch: String,
}

#[derive(Debug, PartialEq, Eq)]
pub enum ValidateError {
    NoRootfs(String),
    NoRunJson(String),
    BadRunJson(String),
    /// argv is empty — nothing to exec (image sets neither Entrypoint nor Cmd).
    NoEntrypoint,
    /// argv[0] does not resolve to any existing path in the rootfs.
    Unresolved(String),
    /// The resolved path is a directory / dangling / looping / escapes the rootfs.
    NotRegularFile(String),
    /// Not an ELF and no resolvable `#!` interpreter — not runnable.
    NotRunnable(String),
    /// The entrypoint (or its interpreter) is an ELF of the wrong machine/class.
    WrongArch {
        path: String,
        want: String,
        got: String,
    },
    UnknownArch(String),
}

/// ELF `e_machine` for a Docker/OCI arch string (little-endian, ELF64 assumed for 64-bit arches).
fn expected_machine(arch: &str) -> Option<u16> {
    Some(match arch {
        "riscv64" => 0xF3,           // 243
        "amd64" | "x86_64" => 0x3E,  // 62
        "arm64" | "aarch64" => 0xB7, // 183
        "386" | "i386" => 0x03,
        "arm" => 0x28,     // 40
        "ppc64le" => 0x15, // 21
        "s390x" => 0x16,   // 22
        _ => return None,
    })
}

fn machine_name(m: u16) -> String {
    match m {
        0xF3 => "riscv".into(),
        0x3E => "x86-64".into(),
        0xB7 => "aarch64".into(),
        0x03 => "i386".into(),
        0x28 => "arm".into(),
        0x15 => "ppc64".into(),
        0x16 => "s390".into(),
        other => format!("e_machine=0x{other:x}"),
    }
}

/// Read an ELF header's `(EI_CLASS, e_machine)` if `path` is an ELF, else `None`. Only the leading
/// 20 bytes are read.
fn elf_ident(path: &Path) -> Option<(u8, u16)> {
    let mut buf = [0u8; 20];
    let mut f = std::fs::File::open(path).ok()?;
    let mut read = 0;
    while read < buf.len() {
        match f.read(&mut buf[read..]) {
            Ok(0) => break,
            Ok(n) => read += n,
            Err(_) => return None,
        }
    }
    if read < 20 || &buf[..4] != b"\x7fELF" {
        return None;
    }
    // e_machine is a u16 at offset 18; honor EI_DATA (buf[5]: 1=LE, 2=BE).
    let machine = if buf[5] == 2 {
        u16::from_be_bytes([buf[18], buf[19]])
    } else {
        u16::from_le_bytes([buf[18], buf[19]])
    };
    Some((buf[4], machine))
}

/// Lexically normalize `path` (collapse `.`/`..`, no filesystem access) → an absolute-looking
/// `/a/b/c`. Used to keep a chased symlink clamped inside the rootfs.
fn norm(path: &str) -> String {
    let mut out: Vec<&str> = Vec::new();
    for part in path.split('/') {
        match part {
            "" | "." => {}
            ".." => {
                out.pop();
            }
            p => out.push(p),
        }
    }
    format!("/{}", out.join("/"))
}

/// Follow a symlink chain WITHIN `rootfs` (absolute links root at `rootfs`; relative links normalize
/// and are clamped under `rootfs`). Returns the final EXISTING path, or `None` on
/// dangling/looping/escaping.
fn chase(rootfs: &Path, start: &Path) -> Option<PathBuf> {
    let root_norm = norm(&rootfs.to_string_lossy());
    let mut p = start.to_path_buf();
    for _ in 0..40 {
        let meta = std::fs::symlink_metadata(&p).ok()?;
        if !meta.file_type().is_symlink() {
            return if p.exists() { Some(p) } else { None };
        }
        let target = std::fs::read_link(&p).ok()?;
        let joined = if target.is_absolute() {
            format!("{}{}", rootfs.to_string_lossy(), target.to_string_lossy())
        } else {
            let parent = p
                .parent()
                .unwrap_or(Path::new("/"))
                .to_string_lossy()
                .into_owned();
            format!("{parent}/{}", target.to_string_lossy())
        };
        let n = norm(&joined);
        // Clamp: must stay under the (normalized) rootfs.
        if n != root_norm && !n.starts_with(&format!("{root_norm}/")) {
            return None;
        }
        p = PathBuf::from(n);
    }
    None // loop
}

/// Resolve argv[0] to an existing regular-or-symlink path in the rootfs (never a directory).
fn resolve_argv0(rootfs: &Path, argv0: &str, path_env: &str) -> Option<PathBuf> {
    let present = |p: &Path| p.symlink_metadata().map(|m| !m.is_dir()).unwrap_or(false);
    if argv0.starts_with('/') {
        let p = rootfs.join(argv0.trim_start_matches('/'));
        return present(&p).then_some(p);
    }
    if argv0.contains('/') {
        let p = rootfs.join(argv0);
        return present(&p).then_some(p);
    }
    for dir in path_env.split(':').filter(|d| !d.is_empty()) {
        let p = rootfs.join(dir.trim_start_matches('/')).join(argv0);
        if present(&p) {
            return Some(p);
        }
    }
    None
}

/// The interpreter path (inside rootfs) of a `#!`-script at `f`, resolving `#!/usr/bin/env prog`
/// to `prog` on `path_env`. `None` if not a shebang or the interpreter can't be found.
fn shebang_interp(rootfs: &Path, f: &Path, path_env: &str) -> Option<PathBuf> {
    let mut head = [0u8; 256];
    let mut file = std::fs::File::open(f).ok()?;
    let n = file.read(&mut head).ok()?;
    let line = &head[..n];
    if !line.starts_with(b"#!") {
        return None;
    }
    let first_line = line.split(|&b| b == b'\n').next().unwrap_or(line);
    let text = String::from_utf8_lossy(&first_line[2..]);
    let mut toks = text.split_whitespace();
    let interp = toks.next()?;
    let target = if interp.ends_with("/env") {
        // `#!/usr/bin/env prog` → resolve prog on PATH.
        let prog = toks.next()?;
        resolve_argv0(rootfs, prog, path_env)?
    } else if interp.starts_with('/') {
        let p = rootfs.join(interp.trim_start_matches('/'));
        if p.symlink_metadata().is_ok() {
            p
        } else {
            return None;
        }
    } else {
        return None;
    };
    chase(rootfs, &target)
}

/// The default PATH when an image sets none.
const DEFAULT_PATH: &str = "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin";

/// Validate a bundle for `arch`. Returns a human description of the resolved entrypoint on success.
pub fn validate_bundle(bundle: &Path, arch: &str) -> Result<String, ValidateError> {
    let want = expected_machine(arch).ok_or_else(|| ValidateError::UnknownArch(arch.into()))?;
    let rootfs = bundle.join("rootfs");
    if !rootfs.is_dir() {
        return Err(ValidateError::NoRootfs(rootfs.display().to_string()));
    }
    let run_path = bundle.join("run.json");
    let run_text = std::fs::read_to_string(&run_path)
        .map_err(|e| ValidateError::NoRunJson(format!("{}: {e}", run_path.display())))?;
    let cfg: RuntimeConfig =
        serde_json::from_str(&run_text).map_err(|e| ValidateError::BadRunJson(e.to_string()))?;

    let argv0 = cfg.argv.first().ok_or(ValidateError::NoEntrypoint)?;
    let path_env = cfg
        .env
        .iter()
        .find_map(|e| e.strip_prefix("PATH="))
        .unwrap_or(DEFAULT_PATH);

    let raw = resolve_argv0(&rootfs, argv0, path_env)
        .ok_or_else(|| ValidateError::Unresolved(argv0.clone()))?;
    let target =
        chase(&rootfs, &raw).ok_or_else(|| ValidateError::NotRegularFile(argv0.clone()))?;
    if !target.is_file() {
        return Err(ValidateError::NotRegularFile(argv0.clone()));
    }

    // The exec target: an ELF (check arch), or a #!-script whose interpreter is a matching ELF.
    if let Some((class, machine)) = elf_ident(&target) {
        check_machine(argv0, class, machine, want, arch)?;
        Ok(format!(
            "{argv0} → {}-bit {} ELF",
            elf_bits(class),
            machine_name(machine)
        ))
    } else if let Some(interp) = shebang_interp(&rootfs, &target, path_env) {
        let (class, machine) = elf_ident(&interp).ok_or_else(|| {
            ValidateError::NotRunnable(format!("{argv0}: interpreter not an ELF"))
        })?;
        check_machine(argv0, class, machine, want, arch)?;
        Ok(format!(
            "{argv0} → script → {} ({}-bit {} ELF)",
            interp.file_name().unwrap_or_default().to_string_lossy(),
            elf_bits(class),
            machine_name(machine),
        ))
    } else {
        Err(ValidateError::NotRunnable(argv0.clone()))
    }
}

fn elf_bits(class: u8) -> u8 {
    if class == 2 { 64 } else { 32 }
}

fn check_machine(
    argv0: &str,
    class: u8,
    machine: u16,
    want: u16,
    arch: &str,
) -> Result<(), ValidateError> {
    // 64-bit arches must be ELFCLASS64; the machine must match.
    let want_64 = matches!(want, 0xF3 | 0x3E | 0xB7 | 0x15 | 0x16);
    if machine != want || (want_64 && class != 2) {
        return Err(ValidateError::WrongArch {
            path: argv0.into(),
            want: arch.into(),
            got: format!("{}-bit {}", elf_bits(class), machine_name(machine)),
        });
    }
    Ok(())
}

pub fn validate(a: ValidateArgs) -> ExitCode {
    match validate_bundle(&a.bundle, &a.arch) {
        Ok(desc) => {
            println!("oci validate: OK — runnable ({}): {desc}", a.arch);
            ExitCode::SUCCESS
        }
        Err(e) => {
            eprintln!("oci validate: NOT runnable — {e:?}");
            ExitCode::from(2)
        }
    }
}

#[cfg(test)]
mod tests;
