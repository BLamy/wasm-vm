//! The lockstep harness (E1-T21): turn a generated `.S` program into an ELF and run it
//! through the **existing, already-verified** E0-T20 differential pipeline
//! (`tools/diff/run_diff.sh`), which executes it under our CLI *and* Spike, normalizes both
//! traces into the canonical grammar, and byte-compares ours as a prefix of Spike's.
//!
//! We deliberately reuse that pipeline rather than re-implement Spike parsing here: it is
//! the harness whose correctness E0-T20/E0-T25 already established (boot-ROM trim,
//! trap-aware truncation, prefix semantics). The fuzzer's novelty is the *stimulus*, not
//! the comparison. Assembly uses the Docker toolchain (`run_samepath.sh` → `gcc`), so the
//! rig works from a cold clone with only Docker + Rust.

use std::path::PathBuf;
use std::process::Command;

use crate::isagen::Program;

/// Outcome of running one program in lockstep against Spike.
#[derive(Debug, PartialEq, Eq)]
pub enum Verdict {
    /// Our trace matched Spike's prefix for every retired instruction.
    Match,
    /// A per-instruction architectural divergence (or our-side trap where Spike ran on).
    /// Carries the human-readable report for the log / regression header.
    Divergence(String),
    /// The toolchain could not even build the program (assembler/linker error). Not a CPU
    /// divergence — a generator or environment bug; surfaced loudly, never silently passed.
    BuildFailed(String),
}

/// Paths the harness needs, resolved once from the repo root.
pub struct Harness {
    repo_root: PathBuf,
    work: PathBuf,
    isa: String,
}

impl Harness {
    /// `repo_root` is the wasm-vm checkout; `isa` is the Spike ISA string (e.g. `rv64im`).
    pub fn new(repo_root: PathBuf, isa: impl Into<String>) -> std::io::Result<Self> {
        let work = repo_root.join("tools/fuzz/.work");
        std::fs::create_dir_all(&work)?;
        Ok(Harness {
            repo_root,
            work,
            isa: isa.into(),
        })
    }

    /// Assemble `prog` to an ELF and run it in lockstep. `tag` names the temp files so
    /// concurrent/successive runs don't collide (e.g. the seed, or a minimizer step id).
    pub fn run(&self, prog: &Program, tag: &str) -> std::io::Result<Verdict> {
        let s_path = self.work.join(format!("{tag}.S"));
        let elf_path = self.work.join(format!("{tag}.elf"));
        std::fs::write(&s_path, prog.render())?;

        // 1. Assemble + link via the Docker toolchain gcc, using the compliance linker
        //    script (text.init @ 0x80000000, .tohost section, entry rvtest_entry_point).
        let link = self.repo_root.join("compliance/spike/env/link.ld");
        let march = format!("-march={}", self.isa.to_lowercase());
        let gcc = self.toolchain_cmd(&[
            "riscv64-unknown-elf-gcc",
            &march,
            "-mabi=lp64",
            "-nostdlib",
            "-nostartfiles",
            "-static",
            "-T",
            link.to_str().unwrap(),
            s_path.to_str().unwrap(),
            "-o",
            elf_path.to_str().unwrap(),
        ])?;
        if !gcc.status.success() {
            return Ok(Verdict::BuildFailed(format!(
                "gcc failed for {tag}:\n{}",
                String::from_utf8_lossy(&gcc.stderr)
            )));
        }

        // 2. Run the existing E0-T20 differential harness. Exit 0 = match, 1 = divergence.
        let diff = Command::new("bash")
            .arg(self.repo_root.join("tools/diff/run_diff.sh"))
            .arg(&elf_path)
            .arg("--isa")
            .arg(&self.isa)
            .arg("--level")
            .arg("commit")
            .current_dir(&self.repo_root)
            .output()?;
        match diff.status.code() {
            Some(0) => Ok(Verdict::Match),
            Some(1) => Ok(Verdict::Divergence(format!(
                "{}{}",
                String::from_utf8_lossy(&diff.stdout),
                String::from_utf8_lossy(&diff.stderr)
            ))),
            other => Ok(Verdict::BuildFailed(format!(
                "run_diff.sh exited {other:?} (harness/env error, not a clean divergence):\n{}",
                String::from_utf8_lossy(&diff.stderr)
            ))),
        }
    }

    /// Invoke a command inside the toolchain container at the repo's real absolute path.
    fn toolchain_cmd(&self, args: &[&str]) -> std::io::Result<std::process::Output> {
        Command::new("bash")
            .arg(self.repo_root.join("tools/toolchain/run_samepath.sh"))
            .arg("--")
            .args(args)
            .current_dir(&self.repo_root)
            .output()
    }
}
