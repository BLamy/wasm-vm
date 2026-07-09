//! `wasm-vm` — the native runner (E0-T18). Assembles RAM + a UART0 stub on stdout + HTIF,
//! loads a bare-metal rv64 ELF, executes until HTIF exit / trap / `--max-instrs`, and can
//! stream the canonical or JSON trace and dump registers + the E0-T17 state digest.
//!
//! Contracts the differential harness (E0-T19/T20) and benchmarks depend on:
//! - **stdout is byte-clean**: guest console bytes go to stdout UNMODIFIED; every
//!   diagnostic goes to stderr, so `cmp` on stdout is meaningful.
//! - **exit status**: guest exit code 0 ⇒ process 0; nonzero guest code ⇒ that code
//!   mod 256 (so a guest exit of 256 ⇒ process 0, documented); trap ⇒ 101 (cause on
//!   stderr); `--max-instrs` reached ⇒ 102. Bad inputs get distinct nonzero codes.
//! - **`retired=<n>`** is printed to stderr at exit for the bench/CI harnesses.

// The Linux boot path needs S-mode + built-in SBI, which the quarantined `zicsr-stub` build
// compiles out — so the whole subcommand is gated the same way (there is no Linux to boot
// without supervisor mode).
#[cfg(not(feature = "zicsr-stub"))]
pub mod boot;
pub mod debug;
pub mod file_backend;
mod trace_json;

use std::cell::Cell;
use std::io::{self, Write};
use std::path::PathBuf;
use std::process::ExitCode;
use std::rc::Rc;

use clap::{Args, Parser, Subcommand};
use wasm_vm_core::bus::mmap::{UART0_BASE, UART0_LEN};
use wasm_vm_core::dev::console::{ConsoleSink, Uart0Stub};
use wasm_vm_core::loader::ElfError;
use wasm_vm_core::trace::{TraceRecord, TraceSink, fmt_canonical};
use wasm_vm_core::{Machine, RunOutcome};

#[derive(Parser)]
#[command(name = "wasm-vm", version, about)]
struct Cli {
    #[command(subcommand)]
    cmd: Cmd,
}

#[derive(Subcommand)]
enum Cmd {
    /// Load a bare-metal rv64 ELF and execute it.
    Run(RunArgs),
    /// E2-T15: boot an unmodified Linux `Image` + initramfs to an interactive shell.
    #[cfg(not(feature = "zicsr-stub"))]
    Boot(boot::BootArgs),
}

#[derive(Args)]
struct RunArgs {
    /// Path to the guest ELF.
    elf: PathBuf,
    /// Maximum instructions to retire before giving up (exit 102).
    #[arg(long, default_value_t = 100_000_000)]
    max_instrs: u64,
    /// Guest RAM size in MiB.
    #[arg(long, default_value_t = 128)]
    ram_mib: usize,
    /// Write the canonical instruction trace here (`-` = stderr).
    #[arg(long)]
    trace: Option<String>,
    /// Write a JSON-lines instruction trace here (`-` = stderr).
    #[arg(long)]
    trace_json: Option<String>,
    /// After the run, dump pc + all registers to stdout (E0-T05 format).
    #[arg(long)]
    dump_regs: bool,
    /// Like `--dump-regs`, plus the E0-T17 `state sha256=<hex>` line.
    #[arg(long)]
    dump_state: bool,
    /// RISCOF (E1-T20): after the run, write the `begin_signature`..`end_signature` region here as
    /// the arch-test signature (one little-endian word per line, lowercase hex).
    #[arg(long)]
    signature: Option<PathBuf>,
    /// Signature word size in bytes (RISCOF default 4; only 4 is supported).
    #[arg(long, default_value_t = 4)]
    signature_granularity: u32,
    /// E2-T11: attach a virtio-blk drive in slot 0: `--drive file=IMG` or
    /// `--drive file=IMG,ro` (mmap-backed; flush = msync).
    #[arg(long)]
    drive: Option<String>,
    /// E2-T14: after the run, print the N hottest PCs ("where is it spinning?").
    #[arg(long, value_name = "N")]
    pc_histogram: Option<usize>,
    /// E2-T14: dump the last N retired instructions (pc + raw) on exit/hang.
    #[arg(long, value_name = "N")]
    trace_last: Option<usize>,
    /// E2-T14: hang watchdog — run in this many-instruction quanta and abort+dump when a
    /// full quantum makes no forward progress (a spin loop).
    #[arg(long, value_name = "QUANTUM")]
    hang_watchdog: Option<u64>,
}

/// Guest console → this process's stdout, streamed (no unbounded buffering). A closed
/// downstream pipe (SIGPIPE, which Rust turns into a `BrokenPipe` error rather than a
/// signal) sets `broken` and silently stops output — never a panic/backtrace.
#[derive(Clone)]
struct StdoutConsole {
    out: Rc<io::Stdout>,
    broken: Rc<Cell<bool>>,
}

impl ConsoleSink for StdoutConsole {
    fn put_byte(&mut self, b: u8) {
        if self.broken.get() {
            return;
        }
        // Lock+write per byte: correctness over speed (guests print little; the trace,
        // not the console, is the volume path). Any write error stops output cleanly.
        if self.out.lock().write_all(&[b]).is_err() {
            self.broken.set(true);
        }
    }
}

/// Trace sink that also counts retirements. Feeds up to two writers (canonical and/or
/// JSON) so `--trace` and `--trace-json` can be given together. Write errors are latched
/// and reported once, at exit.
struct CliSink {
    count: u64,
    canonical: Option<Box<dyn Write>>,
    json: Option<Box<dyn Write>>,
    err: Option<io::Error>,
}

impl TraceSink for CliSink {
    fn retire(&mut self, r: &TraceRecord) {
        self.count += 1;
        if let Some(w) = self.canonical.as_mut()
            && let Err(e) = writeln!(w, "{}", fmt_canonical(r))
        {
            self.err.get_or_insert(e);
        }
        if let Some(w) = self.json.as_mut()
            && let Err(e) = writeln!(w, "{}", trace_json::json_line(r))
        {
            self.err.get_or_insert(e);
        }
    }
}

/// Open a trace destination: `None` → no writer, `-` → stderr, else a created file.
/// A file that cannot be created (unwritable/missing dir) is surfaced, not panicked.
fn open_trace(spec: &Option<String>) -> io::Result<Option<Box<dyn Write>>> {
    match spec.as_deref() {
        None => Ok(None),
        Some("-") => Ok(Some(Box::new(io::stderr()))),
        Some(path) => Ok(Some(Box::new(io::BufWriter::new(std::fs::File::create(
            path,
        )?)))),
    }
}

/// A distinct nonzero exit per ELF-rejection reason, so scripts can tell "not an ELF"
/// from "wrong arch" from "too big for RAM".
fn elf_error_code(e: &ElfError) -> u8 {
    match e {
        ElfError::BadMagic => 65,
        ElfError::WrongClass
        | ElfError::WrongEndian
        | ElfError::WrongMachine
        | ElfError::WrongType => 66,
        ElfError::Truncated => 67,
        ElfError::SegmentOutOfRam => 68,
    }
}

fn main() -> ExitCode {
    // RUST_LOG-gated; silent by default so stdout/stderr stay clean for tests.
    env_logger::init();
    match Cli::parse().cmd {
        Cmd::Run(args) => run(args),
        #[cfg(not(feature = "zicsr-stub"))]
        Cmd::Boot(args) => boot::boot(args),
    }
}

fn run(a: RunArgs) -> ExitCode {
    let bytes = match std::fs::read(&a.elf) {
        Ok(b) => b,
        Err(e) => {
            eprintln!("wasm-vm: cannot read {}: {e}", a.elf.display());
            return ExitCode::from(2);
        }
    };

    let ram_bytes = a.ram_mib.saturating_mul(1024 * 1024);
    let mut m = Machine::new(ram_bytes);
    // E2-T11: --drive file=IMG[,ro] → PLIC + CLINT + virtio-blk slot 0 (mmap FileBackend).
    if let Some(spec) = &a.drive {
        let (path, ro) = match spec.strip_suffix(",ro") {
            Some(rest) => (rest, true),
            None => (spec.as_str(), false),
        };
        let Some(path) = path.strip_prefix("file=") else {
            eprintln!("wasm-vm: --drive expects file=IMG[,ro]");
            return ExitCode::from(2);
        };
        let backend: Box<dyn wasm_vm_core::block::BlockBackend> = if ro {
            match file_backend::FileBackend::open_read_only(std::path::Path::new(path)) {
                Ok(b) => Box::new(b),
                Err(e) => {
                    eprintln!("wasm-vm: cannot open drive {path}: {e}");
                    return ExitCode::from(2);
                }
            }
        } else {
            match file_backend::FileBackend::open(std::path::Path::new(path)) {
                Ok(b) => Box::new(b),
                Err(e) => {
                    eprintln!("wasm-vm: cannot open drive {path}: {e}");
                    return ExitCode::from(2);
                }
            }
        };
        m.enable_clint(10);
        m.enable_plic();
        let _ = m.enable_virtio_blk(backend);
    }

    let console = StdoutConsole {
        out: Rc::new(io::stdout()),
        broken: Rc::new(Cell::new(false)),
    };
    let broken = console.broken.clone();
    m.bus_mut()
        .attach(UART0_BASE, UART0_LEN, Box::new(Uart0Stub::new(console)))
        .expect("UART0 sits in a fixed, un-contended MMIO slot");

    let img = match m.load_elf(&bytes) {
        Ok(img) => img,
        Err(e) => {
            eprintln!("wasm-vm: {}: {e:?}", a.elf.display());
            return ExitCode::from(elf_error_code(&e));
        }
    };

    let (canonical, json) = match (open_trace(&a.trace), open_trace(&a.trace_json)) {
        (Ok(c), Ok(j)) => (c, j),
        (Err(e), _) | (_, Err(e)) => {
            eprintln!("wasm-vm: cannot open trace output: {e}");
            return ExitCode::from(74); // EX_IOERR-ish
        }
    };

    // E2-T14 boot-debugging path: when any of --pc-histogram / --trace-last / --hang-watchdog
    // is set, run through the DebugSink (optionally quantum-driven for hang detection) and
    // print the diagnostics to stderr. Mutually exclusive with --trace/--trace-json capture
    // (the debugging flags are their own inspection mode).
    if a.pc_histogram.is_some() || a.trace_last.is_some() || a.hang_watchdog.is_some() {
        let mut dbg = debug::DebugSink::new(a.pc_histogram.is_some(), a.trace_last);
        let (outcome, retired, hang_pc) = match a.hang_watchdog {
            Some(q) => match debug::run_with_watchdog(&mut m, &mut dbg, q, a.max_instrs) {
                debug::WatchdogResult::Ended(o, r) => (o, r, None),
                debug::WatchdogResult::Hang { pc, retired } => {
                    (RunOutcome::MaxInstrs, retired, Some(pc))
                }
            },
            None => {
                let o = m.run_traced(a.max_instrs, &mut dbg);
                (o, dbg.retired, None)
            }
        };
        if let Some(pc) = hang_pc {
            eprintln!(
                "wasm-vm: HANG — no forward progress at pc={pc:#018x} after {retired} instrs"
            );
        }
        if let Some(n) = a.pc_histogram {
            eprintln!("=== hottest {n} PCs (symbolize with tools/symbolize.py) ===");
            for (pc, count) in dbg.hottest(n) {
                eprintln!("{count:>12}  {pc:#018x}");
            }
        }
        if let Some(n) = a.trace_last {
            eprintln!(
                "=== last {} retired (pc  insn) ===",
                dbg.last_trace().len().min(n)
            );
            for (pc, insn) in dbg.last_trace() {
                eprintln!("{pc:#018x}  {insn:#010x}");
            }
        }
        eprintln!("retired={retired}");
        return match outcome {
            RunOutcome::Exited(code) => ExitCode::from((code & 0xFF) as u8),
            RunOutcome::Trapped(_) => ExitCode::from(101),
            RunOutcome::MaxInstrs if hang_pc.is_some() => ExitCode::from(103), // distinct: hang
            RunOutcome::MaxInstrs => ExitCode::from(102),
        };
    }

    let mut sink = CliSink {
        count: 0,
        canonical,
        json,
        err: None,
    };
    let outcome = m.run_traced(a.max_instrs, &mut sink);

    // Flush + surface trace-writer errors (a full disk mid-trace must not pass silently).
    let mut trace_io_failed = false;
    for w in [sink.canonical.as_mut(), sink.json.as_mut()]
        .into_iter()
        .flatten()
    {
        if w.flush().is_err() {
            trace_io_failed = true;
        }
    }
    if let Some(e) = sink.err.take() {
        eprintln!("wasm-vm: trace write failed: {e}");
        trace_io_failed = true;
    }

    // Optional state dumps to stdout (skipped if the pipe is already gone).
    if (a.dump_regs || a.dump_state) && !broken.get() {
        let mut so = io::stdout().lock();
        let _ = write!(so, "{}", m.hart().regs);
        if a.dump_state {
            let _ = writeln!(so, "{}", m.snapshot().state_sha256_line());
        }
        let _ = so.flush();
    }

    eprintln!("retired={}", sink.count);

    // RISCOF signature dump (E1-T20): write the begin_signature..end_signature region after the
    // run. Required for the arch-test flow; a run that asked for it but lacks the symbols is a hard
    // error (a non-arch-test ELF), not a silent empty file.
    if let Some(path) = &a.signature {
        match (img.begin_signature, img.end_signature) {
            (Some(begin), Some(end)) => match m.signature(begin, end, a.signature_granularity) {
                Ok(sig) => {
                    if let Err(e) = std::fs::write(path, sig) {
                        eprintln!("wasm-vm: cannot write signature {}: {e}", path.display());
                        return ExitCode::from(74);
                    }
                }
                Err(e) => {
                    eprintln!("wasm-vm: {e}");
                    return ExitCode::from(2);
                }
            },
            _ => {
                eprintln!(
                    "wasm-vm: --signature given but begin_signature/end_signature symbols are absent"
                );
                return ExitCode::from(2);
            }
        }
    }

    if trace_io_failed {
        return ExitCode::from(74);
    }
    match outcome {
        RunOutcome::Exited(code) => ExitCode::from((code & 0xff) as u8),
        RunOutcome::Trapped(t) => {
            eprintln!("wasm-vm: trap {:?} (tval={:#x})", t.cause, t.tval);
            ExitCode::from(101)
        }
        RunOutcome::MaxInstrs => {
            eprintln!("wasm-vm: reached --max-instrs {}", a.max_instrs);
            ExitCode::from(102)
        }
    }
}
