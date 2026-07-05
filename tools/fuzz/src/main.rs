//! `fuzz` — the E1-T21 differential-fuzzing driver.
//!
//! Generates constrained-random RV64IM instruction streams from a fixed seed, runs each in
//! lockstep against Spike through the E0-T20 canonical-trace harness, and — on any
//! architectural divergence — delta-debugs it to a short, standalone `.S` reproducer
//! checked into `tests/fuzz-regressions/`. Fully reproducible: `--seed N` is a pure
//! function to a stream (see `rng.rs`), so a divergence found on one host reproduces on
//! every host.
//!
//! Subcommands:
//!   gen       Emit the generated `.S` for a seed (no execution) — inspect / hand-run.
//!   run       Lockstep one seed against Spike; exit 0 match, 3 divergence, 2 harness error.
//!   campaign  Sweep a seed range; on the first divergence, minimize + emit a reproducer.

mod harness;
mod isagen;
mod minimize;
mod rng;

use std::path::PathBuf;
use std::process::ExitCode;

use clap::{Parser, Subcommand};

use harness::{Harness, Verdict};
use isagen::Program;

#[derive(Parser)]
#[command(name = "fuzz", about = "Differential RV64IM fuzzer vs Spike (E1-T21)")]
struct Cli {
    #[command(subcommand)]
    cmd: Cmd,
}

#[derive(Subcommand)]
enum Cmd {
    /// Emit the generated assembly for a seed to stdout (or --out), without running it.
    Gen {
        #[arg(long)]
        seed: u64,
        #[arg(long, default_value_t = 256)]
        count: usize,
        #[arg(long)]
        out: Option<PathBuf>,
    },
    /// Generate one seed and run it in lockstep against Spike.
    Run {
        #[arg(long)]
        seed: u64,
        #[arg(long, default_value_t = 256)]
        count: usize,
        #[arg(long, default_value = "rv64im")]
        isa: String,
    },
    /// Sweep seeds [from, to); on the first divergence, minimize and write a reproducer.
    Campaign {
        #[arg(long, default_value_t = 0)]
        from: u64,
        #[arg(long, default_value_t = 64)]
        to: u64,
        #[arg(long, default_value_t = 256)]
        count: usize,
        #[arg(long, default_value = "rv64im")]
        isa: String,
        /// Stop after this many divergences are found + minimized (0 = whole range).
        #[arg(long, default_value_t = 0)]
        max_findings: usize,
    },
}

/// Walk up from the current directory to the wasm-vm checkout root (the dir containing
/// `tools/fuzz/Cargo.toml`). Keeps the tool runnable from anywhere in the tree.
fn find_repo_root() -> std::io::Result<PathBuf> {
    let mut dir = std::env::current_dir()?;
    loop {
        if dir.join("tools/fuzz/Cargo.toml").is_file() {
            return Ok(dir);
        }
        if !dir.pop() {
            return Err(std::io::Error::new(
                std::io::ErrorKind::NotFound,
                "could not locate repo root (no tools/fuzz/Cargo.toml above cwd)",
            ));
        }
    }
}

fn main() -> ExitCode {
    let cli = Cli::parse();
    match run(cli) {
        Ok(code) => code,
        Err(e) => {
            eprintln!("fuzz: {e}");
            ExitCode::from(2)
        }
    }
}

fn run(cli: Cli) -> std::io::Result<ExitCode> {
    match cli.cmd {
        Cmd::Gen { seed, count, out } => {
            let prog = Program::generate(seed, count);
            let text = prog.render();
            match out {
                Some(p) => std::fs::write(&p, text)?,
                None => print!("{text}"),
            }
            Ok(ExitCode::SUCCESS)
        }
        Cmd::Run { seed, count, isa } => {
            let root = find_repo_root()?;
            let h = Harness::new(root, isa)?;
            let prog = Program::generate(seed, count);
            match h.run(&prog, &format!("seed_{seed:016x}"))? {
                Verdict::Match => {
                    println!("MATCH seed={seed:#x} count={count}");
                    Ok(ExitCode::SUCCESS)
                }
                Verdict::Divergence(report) => {
                    println!("DIVERGENCE seed={seed:#x} count={count}");
                    eprintln!("{report}");
                    Ok(ExitCode::from(3))
                }
                Verdict::BuildFailed(msg) => {
                    eprintln!("HARNESS ERROR seed={seed:#x}: {msg}");
                    Ok(ExitCode::from(2))
                }
            }
        }
        Cmd::Campaign {
            from,
            to,
            count,
            isa,
            max_findings,
        } => {
            let root = find_repo_root()?;
            let regr_dir = root.join("tests/fuzz-regressions");
            std::fs::create_dir_all(&regr_dir)?;
            let h = Harness::new(root, isa.clone())?;
            let mut findings = 0usize;
            let mut ran = 0usize;
            for seed in from..to {
                let prog = Program::generate(seed, count);
                ran += 1;
                match h.run(&prog, &format!("seed_{seed:016x}"))? {
                    Verdict::Match => {}
                    Verdict::BuildFailed(msg) => {
                        eprintln!("HARNESS ERROR seed={seed:#x}: {msg}");
                        return Ok(ExitCode::from(2));
                    }
                    Verdict::Divergence(_report) => {
                        findings += 1;
                        println!("DIVERGENCE seed={seed:#x} — minimizing…");
                        let (min, calls) = minimize::ddmin(&prog, |body| {
                            let cand = Program {
                                seed,
                                prologue: prog.prologue.clone(),
                                body: body.to_vec(),
                            };
                            // Re-run the candidate; treat only a clean divergence as "still
                            // reproduces". A build error mid-minimize (should not happen for
                            // straight-line bodies) is conservatively NOT a reproduction.
                            matches!(
                                h.run(&cand, &format!("min_{seed:016x}")),
                                Ok(Verdict::Divergence(_))
                            )
                        });
                        let path = regr_dir.join(format!("seed_{seed:016x}.S"));
                        let header = format!(
                            "# FUZZ REGRESSION (E1-T21)\n\
                             # seed={seed:#x} isa={isa}\n\
                             # minimized {} -> {} instructions in {calls} oracle calls\n\
                             # reproduce: cargo run -p wasm-vm-fuzz -- run --seed {seed} --count {count} --isa {isa}\n",
                            prog.body.len(),
                            min.body.len(),
                        );
                        std::fs::write(&path, format!("{header}{}", min.render()))?;
                        println!(
                            "  -> {} instructions, wrote {}",
                            min.body.len(),
                            path.display()
                        );
                        if max_findings != 0 && findings >= max_findings {
                            break;
                        }
                    }
                }
            }
            println!("campaign: ran {ran} seed(s), {findings} divergence(s)");
            Ok(if findings == 0 {
                ExitCode::SUCCESS
            } else {
                ExitCode::from(3)
            })
        }
    }
}
