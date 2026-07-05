//! `wasm-vm boot` (E2-T15) — assemble the full `virt` Linux platform and boot an unmodified
//! kernel `Image` + initramfs to an interactive shell.
//!
//! This is the First Light integration path: it wires together every device the earlier
//! Epic-2 tasks built (CLINT, PLIC, 16550 UART, virtio-mmio slots, built-in SBI) exactly as
//! the QEMU `virt` machine does, lays out the boot triple in DRAM
//!
//!   `KERNEL_BASE …Image… | initrd | …gap… | DTB | top-of-DRAM`
//!
//! and enters S-mode at `KERNEL_BASE` with `a0=hartid, a1=DTB` per the ADR-0002 boot
//! contract. Console is bidirectional: guest output (SBI `earlycon=sbi` AND the 16550
//! `ttyS0`) streams to stdout; host stdin feeds the 16550 RX so the busybox shell is
//! interactive. Nothing here is a new device — it is glue over [`wasm_vm_core`].

use std::cell::Cell;
use std::io::{self, Read, Write};
use std::path::PathBuf;
use std::process::ExitCode;
use std::rc::Rc;
use std::sync::mpsc;

use clap::Args;
use wasm_vm_core::dev::console::ConsoleSink;
use wasm_vm_core::{Machine, RunOutcome, platform};

use crate::file_backend;

#[derive(Args)]
pub struct BootArgs {
    /// Path to the flat kernel `Image` (raw Linux/RISC-V boot binary, not an ELF).
    #[arg(long)]
    pub kernel: PathBuf,
    /// Optional initramfs cpio(.gz) — advertised to the kernel via `/chosen` initrd props.
    #[arg(long)]
    pub initrd: Option<PathBuf>,
    /// Kernel command line (`/chosen/bootargs`).
    #[arg(long, default_value = "console=ttyS0 earlycon=sbi")]
    pub append: String,
    /// Attach a virtio-blk drive in slot 0: `file=IMG` or `file=IMG,ro` (mmap-backed).
    #[arg(long)]
    pub drive: Option<String>,
    /// Guest RAM size in MiB (DTB places itself near the top of DRAM).
    #[arg(long, default_value_t = 256)]
    pub ram_mib: usize,
    /// Instruction budget before giving up (exit 102). A full boot is ~hundreds of millions.
    #[arg(long, default_value_t = 4_000_000_000)]
    pub max_instrs: u64,
    /// Instructions per I/O-service quantum (stdin→UART, UART→stdout drain cadence).
    #[arg(long, default_value_t = 200_000)]
    pub quantum: u64,
    /// Do not read host stdin (headless boot: prove the dmesg parade, don't drive the shell).
    #[arg(long)]
    pub no_input: bool,
    /// On a guest reboot, exit (QEMU `-no-reboot` style) instead of re-booting a fresh machine.
    #[arg(long)]
    pub no_reboot: bool,
    /// E2-T19: trace every virtio-blk request to stderr (`blk: <op> sector=N len=M status=S`)
    /// — for debugging fs corruption or stalls. Requires `--drive`.
    #[arg(long)]
    pub blk_log: bool,
    /// E2-T20: disable the always-on interrupt-storm / WFI-deadlock detectors (overhead A/B).
    #[arg(long)]
    pub no_storm_detect: bool,
    /// E2-T20: print the interrupt/trap counters at exit.
    #[arg(long)]
    pub stats: bool,
}

/// Guest console → this process's stdout. Shared with the SBI console channel; a closed pipe
/// latches `broken` and silently stops (never a panic/backtrace).
#[derive(Clone)]
struct SharedStdout {
    out: Rc<io::Stdout>,
    broken: Rc<Cell<bool>>,
}

impl SharedStdout {
    fn write_bytes(&self, bytes: &[u8]) {
        if self.broken.get() || bytes.is_empty() {
            return;
        }
        let mut out = self.out.lock();
        // FLUSH after every write: `io::Stdout` is a LineWriter, so an un-newline-terminated
        // write — the shell prompt `~ # `, a `read`-blocked partial line — otherwise sits in
        // the buffer invisibly until the next '\n'. An interactive console must show each
        // byte as it is produced. The guest prints little, so per-write flush is cheap.
        if out.write_all(bytes).and_then(|()| out.flush()).is_err() {
            self.broken.set(true);
        }
    }
}

impl ConsoleSink for SharedStdout {
    fn put_byte(&mut self, b: u8) {
        self.write_bytes(&[b]);
    }
}

/// E2-T16: the host wall clock for the RTC — `SystemTime` nanoseconds since the Unix epoch.
/// Lives in the CLI (not `crates/core`) because core bans host time sources for determinism.
/// A clock before 1970 (unrepresentable) reads back as 0.
struct SystemClock;

impl wasm_vm_core::dev::rtc::WallClock for SystemClock {
    fn now_ns(&self) -> u64 {
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos() as u64)
            .unwrap_or(0)
    }
}

pub fn boot(a: BootArgs) -> ExitCode {
    let kernel = match std::fs::read(&a.kernel) {
        Ok(b) => b,
        Err(e) => {
            eprintln!("wasm-vm: cannot read kernel {}: {e}", a.kernel.display());
            return ExitCode::from(2);
        }
    };
    let initrd = match &a.initrd {
        Some(p) => match std::fs::read(p) {
            Ok(b) => Some(b),
            Err(e) => {
                eprintln!("wasm-vm: cannot read initrd {}: {e}", p.display());
                return ExitCode::from(2);
            }
        },
        None => None,
    };

    // E2-T19 critic advisory: --blk-log without --drive can't trace anything (no blk device).
    if a.blk_log && a.drive.is_none() {
        eprintln!("wasm-vm: --blk-log has no effect without --drive (no virtio-blk device)");
    }

    // Console + stdin reader are created ONCE and shared across reboots; only the Machine (RAM
    // + devices) is rebuilt fresh each boot. The `--drive` file is re-opened per boot, so block
    // state persists across reboot (documented) while RAM does not.
    let console = SharedStdout {
        out: Rc::new(io::stdout()),
        broken: Rc::new(Cell::new(false)),
    };
    let stdin_rx = (!a.no_input).then(spawn_stdin_reader);
    let mut pending: std::collections::VecDeque<u8> = std::collections::VecDeque::new();

    let mut boot_num = 0u32;
    loop {
        boot_num += 1;
        if boot_num > 1 {
            eprintln!("wasm-vm: --- reboot #{} ---", boot_num - 1);
        }
        let (mut m, uart) = match assemble(&a, &kernel, &initrd, &console) {
            Ok(v) => v,
            Err(code) => return code,
        };
        let outcome = run_machine(&a, &mut m, &uart, &console, stdin_rx.as_ref(), &mut pending);
        // Final drain before we act on the outcome.
        let out = uart.borrow_mut().take_output();
        console.write_bytes(&out);
        if a.stats {
            eprint!("{}", m.stats_dump()); // E2-T20
        }

        match outcome {
            RunOutcome::Reset(wasm_vm_core::ExitReason::Reboot) if !a.no_reboot => {
                eprintln!("wasm-vm: guest requested reboot — restarting");
                continue; // fresh machine, same backends
            }
            RunOutcome::Reset(wasm_vm_core::ExitReason::Reboot) => {
                eprintln!("wasm-vm: guest requested reboot (--no-reboot: exiting)");
                return ExitCode::SUCCESS;
            }
            RunOutcome::Reset(wasm_vm_core::ExitReason::PowerOff) => {
                eprintln!("wasm-vm: guest powered off");
                return ExitCode::SUCCESS;
            }
            RunOutcome::Reset(wasm_vm_core::ExitReason::Fail(c)) => {
                eprintln!("wasm-vm: guest signalled failure (code {c})");
                return ExitCode::from((c & 0xff) as u8);
            }
            RunOutcome::Exited(code) => {
                eprintln!("wasm-vm: guest exited {code}");
                return ExitCode::from((code & 0xff) as u8);
            }
            RunOutcome::Trapped(t) => {
                eprintln!(
                    "wasm-vm: unhandled trap {:?} (tval={:#x}, pc={:#x}) — boot aborted",
                    t.cause,
                    t.tval,
                    m.hart().regs.pc,
                );
                return ExitCode::from(101);
            }
            RunOutcome::MaxInstrs => {
                eprintln!("wasm-vm: reached --max-instrs {}", a.max_instrs);
                return ExitCode::from(102);
            }
        }
    }
}

/// Build a fresh machine for one boot: RAM + all devices + the boot triple in DRAM, entered at
/// the ADR-0002 contract. Returns the machine and the UART handle, or an `ExitCode` for a fatal
/// setup error. Called once per boot (reboot rebuilds from scratch → devices reset, RAM zeroed).
fn assemble(
    a: &BootArgs,
    kernel: &[u8],
    initrd: &Option<Vec<u8>>,
    console: &SharedStdout,
) -> Result<
    (
        Machine,
        Rc<std::cell::RefCell<wasm_vm_core::dev::uart16550::Uart16550>>,
    ),
    ExitCode,
> {
    let ram_bytes = a.ram_mib.saturating_mul(1024 * 1024);
    let mut m = Machine::new(ram_bytes);
    m.set_storm_detect(!a.no_storm_detect); // E2-T20

    // --- devices, in dependency order (PLIC before its consumers) ---
    m.enable_clint(10);
    m.enable_plic();
    m.enable_rtc(Box::new(SystemClock));
    m.enable_syscon(); // E2-T17: poweroff/reboot finisher at TEST_BASE
    let uart = m.enable_uart16550();
    // virtio: a real blk device if --drive was given, else the 8 empty mmio slots the DTB
    // advertises (the kernel probes each address; an unbacked window would fault).
    if let Some(spec) = &a.drive {
        let (path, ro) = match spec.strip_suffix(",ro") {
            Some(rest) => (rest, true),
            None => (spec.as_str(), false),
        };
        let Some(path) = path.strip_prefix("file=") else {
            eprintln!("wasm-vm: --drive expects file=IMG[,ro]");
            return Err(ExitCode::from(2));
        };
        let backend: Box<dyn wasm_vm_core::block::BlockBackend> = if ro {
            match file_backend::FileBackend::open_read_only(std::path::Path::new(path)) {
                Ok(b) => Box::new(b),
                Err(e) => {
                    eprintln!("wasm-vm: cannot open drive {path}: {e}");
                    return Err(ExitCode::from(2));
                }
            }
        } else {
            match file_backend::FileBackend::open(std::path::Path::new(path)) {
                Ok(b) => Box::new(b),
                Err(e) => {
                    eprintln!("wasm-vm: cannot open drive {path}: {e}");
                    return Err(ExitCode::from(2));
                }
            }
        };
        let _ = m.enable_virtio_blk(backend);
        if a.blk_log {
            m.enable_blk_log(); // E2-T19: trace requests to stderr
        }
    } else {
        let _ = m.enable_virtio_slots(None);
    }

    // Built-in SBI firmware + its console channel (earlycon=sbi / legacy putchar).
    m.enable_builtin_sbi();
    m.sbi_set_console(Box::new(console.clone()));

    // --- lay out the boot triple: Image @ KERNEL_BASE, then initrd, then DTB near top ---
    // Lay out kernel + initrd + DTB and enter S-mode via the SHARED core assembler (same code
    // the wasm boundary uses — the placement lives in exactly one place).
    let initrd_slice = initrd.as_deref();
    let layout = match m.place_and_boot(kernel, initrd_slice, &a.append) {
        Ok(l) => l,
        Err(e) => {
            let msg = match e {
                wasm_vm_core::BootError::KernelTooBig => format!(
                    "kernel ({} bytes) runtime footprint does not fit in {} MiB RAM",
                    kernel.len(),
                    a.ram_mib
                ),
                wasm_vm_core::BootError::InitrdNoFit => format!(
                    "initrd ({} bytes) does not fit between the kernel and the DTB — grow --ram-mib",
                    initrd_slice.map_or(0, |b| b.len())
                ),
                wasm_vm_core::BootError::DtbNoFit => "DTB does not fit in RAM".to_string(),
                wasm_vm_core::BootError::KernelEndOverflow => {
                    "kernel_end too large to align an initrd above".to_string()
                }
                wasm_vm_core::BootError::PlatformInvalid => {
                    format!("invalid platform for {} MiB RAM", a.ram_mib)
                }
                wasm_vm_core::BootError::Load(f) => format!("blob placement failed: {f:?}"),
            };
            eprintln!("wasm-vm: {msg}");
            return Err(ExitCode::from(2));
        }
    };

    eprintln!(
        "wasm-vm: booting kernel={} bytes @ {:#x} (footprint_end={:#x}), initrd={} bytes @ {}, dtb={} bytes @ {:#x}, {} MiB RAM",
        kernel.len(),
        platform::virt::KERNEL_BASE,
        layout.kernel_end,
        initrd.as_ref().map_or(0, |b| b.len()),
        layout.initrd.map_or("none".to_string(), |p| format!(
            "{:#x}..{:#x}",
            p.start, p.end
        )),
        layout.dtb_len,
        layout.dtb_addr,
        a.ram_mib,
    );
    Ok((m, uart))
}

/// Run one assembled machine to its terminal [`RunOutcome`], executing in quanta while pumping
/// UART output → stdout and host stdin → the UART RX FIFO (rate-limited to its free space so a
/// pasted line can't overrun). `pending` carries un-fed host input across quanta (and reboots).
fn run_machine(
    a: &BootArgs,
    m: &mut Machine,
    uart: &Rc<std::cell::RefCell<wasm_vm_core::dev::uart16550::Uart16550>>,
    console: &SharedStdout,
    stdin_rx: Option<&mpsc::Receiver<Vec<u8>>>,
    pending: &mut std::collections::VecDeque<u8>,
) -> RunOutcome {
    let mut total = 0u64;
    loop {
        if total >= a.max_instrs {
            return RunOutcome::MaxInstrs;
        }
        let step = a.quantum.min(a.max_instrs - total);
        let mut sink = wasm_vm_core::trace::NullSink;
        let o = m.run_traced(step, &mut sink);
        // Drain UART output → stdout every quantum so the boot log streams live.
        let out = uart.borrow_mut().take_output();
        console.write_bytes(&out);
        // E2-T19: drain the virtio-blk request trace → stderr (when --blk-log).
        if a.blk_log {
            for r in m.drain_blk_log() {
                let op = match r.rtype {
                    0 => "IN ",
                    1 => "OUT",
                    4 => "FLUSH",
                    8 => "GET_ID",
                    _ => "?",
                };
                eprintln!(
                    "blk: {op} sector={} len={} status={}",
                    r.sector, r.len, r.status
                );
            }
        }
        // Collect any newly-arrived host input, then feed the FIFO up to its free space.
        if let Some(rx) = stdin_rx {
            while let Ok(chunk) = rx.try_recv() {
                pending.extend(chunk);
            }
            if !pending.is_empty() {
                let mut u = uart.borrow_mut();
                let n = u.rx_free().min(pending.len());
                if n > 0 {
                    let batch: Vec<u8> = pending.drain(..n).collect();
                    u.push_input(&batch);
                }
            }
        }
        match o {
            RunOutcome::MaxInstrs => total += step,
            other => return other,
        }
    }
}

/// Spawn a thread that reads host stdin in chunks and forwards them over a channel. The
/// Machine and its `Rc<RefCell<Uart>>` stay single-threaded on the main thread; only raw
/// bytes (`Send`) cross the boundary.
fn spawn_stdin_reader() -> mpsc::Receiver<Vec<u8>> {
    let (tx, rx) = mpsc::channel();
    std::thread::spawn(move || {
        let mut stdin = io::stdin();
        let mut buf = [0u8; 256];
        loop {
            match stdin.read(&mut buf) {
                Ok(0) | Err(_) => break, // EOF or error: reader retires, boot keeps running
                Ok(n) => {
                    if tx.send(buf[..n].to_vec()).is_err() {
                        break; // main loop gone
                    }
                }
            }
        }
    });
    rx
}
