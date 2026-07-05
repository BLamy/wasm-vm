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
use wasm_vm_core::{Machine, RunOutcome, fdt, platform};

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

    let ram_bytes = a.ram_mib.saturating_mul(1024 * 1024);
    let plat = match platform::Platform::try_new(ram_bytes as u64) {
        Ok(p) => p,
        Err(e) => {
            eprintln!("wasm-vm: invalid platform ({} MiB RAM): {e:?}", a.ram_mib);
            return ExitCode::from(2);
        }
    };
    let mut m = Machine::new(ram_bytes);

    // --- devices, in dependency order (PLIC before its consumers) ---
    m.enable_clint(10);
    m.enable_plic();
    m.enable_rtc();
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
        let _ = m.enable_virtio_blk(backend);
    } else {
        let _ = m.enable_virtio_slots(None);
    }

    // Built-in SBI firmware + its console channel (earlycon=sbi / legacy putchar).
    let console = SharedStdout {
        out: Rc::new(io::stdout()),
        broken: Rc::new(Cell::new(false)),
    };
    m.enable_builtin_sbi();
    m.sbi_set_console(Box::new(console.clone()));

    // --- lay out the boot triple: Image @ KERNEL_BASE, then initrd, then DTB near top ---
    let kernel_end = match m.load_kernel_image(&kernel) {
        Ok(end) => end,
        Err(e) => {
            eprintln!(
                "wasm-vm: kernel ({} bytes) does not fit in {} MiB RAM: {e:?}",
                kernel.len(),
                a.ram_mib
            );
            return ExitCode::from(2);
        }
    };

    // The DTB grows by a fixed amount when initrd props are present, so probe its length with
    // a placeholder initrd (same props → identical length), place it, place the initrd below
    // it, then rebuild with the real start/end.
    // RISC-V maps and RESERVES the kernel image in 2 MiB (PMD) granules, so its memblock
    // reservation rounds `kernel_end` up to the next 2 MiB boundary. An initrd placed flush
    // against `image_size` still falls inside that rounded-up reservation → the kernel logs
    // "overlaps in-use memory region" and disables it. Start the initrd on the 2 MiB boundary
    // above the kernel so it clears the reservation entirely.
    // `load_kernel_image` already rejects a `kernel_end` past top-of-RAM, so the round-up
    // below cannot wrap for any real image; `checked_add` keeps that true even for a corrupt
    // header that slipped through — a wrapped-low floor could otherwise place the initrd over
    // the kernel.
    const PMD_SIZE: u64 = 2 * 1024 * 1024;
    let Some(initrd_floor) = kernel_end
        .checked_add(PMD_SIZE - 1)
        .map(|v| v & !(PMD_SIZE - 1))
    else {
        eprintln!("wasm-vm: kernel_end {kernel_end:#x} too large to align an initrd above");
        return ExitCode::from(2);
    };

    let (dtb, dtb_addr, placed_initrd) = match &initrd {
        Some(bytes) => {
            let probe =
                fdt::build_virt_dtb(&plat, &a.append, Some(fdt::Initrd { start: 0, end: 0 }));
            let Some(dtb_addr) = fdt::dtb_placement(&plat, probe.len() as u64) else {
                eprintln!("wasm-vm: DTB does not fit in RAM");
                return ExitCode::from(2);
            };
            let Some(place) = fdt::initrd_placement(initrd_floor, dtb_addr, bytes.len() as u64)
            else {
                eprintln!(
                    "wasm-vm: initrd ({} bytes) does not fit between kernel_end={kernel_end:#x} and DTB={dtb_addr:#x} — grow --ram-mib",
                    bytes.len()
                );
                return ExitCode::from(2);
            };
            let dtb = fdt::build_virt_dtb(&plat, &a.append, Some(place));
            debug_assert_eq!(
                dtb.len(),
                probe.len(),
                "DTB length changed with real initrd"
            );
            (dtb, dtb_addr, Some(place))
        }
        None => {
            let dtb = fdt::build_virt_dtb(&plat, &a.append, None);
            let Some(dtb_addr) = fdt::dtb_placement(&plat, dtb.len() as u64) else {
                eprintln!("wasm-vm: DTB does not fit in RAM");
                return ExitCode::from(2);
            };
            (dtb, dtb_addr, None)
        }
    };

    if let Some(place) = placed_initrd {
        let bytes = initrd.as_ref().expect("initrd present when placed");
        if let Err(e) = m.load_blob(place.start, bytes) {
            eprintln!("wasm-vm: cannot place initrd at {:#x}: {e:?}", place.start);
            return ExitCode::from(2);
        }
    }
    if let Err(e) = m.load_blob(dtb_addr, &dtb) {
        eprintln!("wasm-vm: cannot place DTB at {dtb_addr:#x}: {e:?}");
        return ExitCode::from(2);
    }

    eprintln!(
        "wasm-vm: booting kernel={} bytes @ {:#x} (footprint_end={kernel_end:#x}), initrd={} bytes @ {}, dtb={} bytes @ {:#x}, {} MiB RAM",
        kernel.len(),
        platform::virt::KERNEL_BASE,
        initrd.as_ref().map_or(0, |b| b.len()),
        placed_initrd.map_or("none".to_string(), |p| format!(
            "{:#x}..{:#x}",
            p.start, p.end
        )),
        dtb.len(),
        dtb_addr,
        a.ram_mib,
    );

    // Enter S-mode at KERNEL_BASE with a0=hartid, a1=DTB (ADR 0002 boot contract).
    m.boot_supervisor(0, dtb_addr);

    // --- run loop: execute in quanta, pumping stdin→UART-RX and UART-TX→stdout ---
    let stdin_rx = (!a.no_input).then(spawn_stdin_reader);
    // Host-side pending input: stdin can arrive faster than the guest drains the 16-byte RX
    // FIFO (a pasted command line is >16 bytes), so we buffer here and feed only `rx_free()`
    // bytes per quantum — no host-induced overrun, while true typing speed is unaffected.
    let mut pending: std::collections::VecDeque<u8> = std::collections::VecDeque::new();
    let mut total = 0u64;
    let outcome = loop {
        if total >= a.max_instrs {
            break RunOutcome::MaxInstrs;
        }
        let step = a.quantum.min(a.max_instrs - total);
        let mut sink = wasm_vm_core::trace::NullSink;
        let o = m.run_traced(step, &mut sink);
        // Drain UART output → stdout every quantum so the boot log streams live.
        let out = uart.borrow_mut().take_output();
        console.write_bytes(&out);
        // Collect any newly-arrived host input, then feed the FIFO up to its free space.
        if let Some(rx) = &stdin_rx {
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
            other => break other,
        }
    };
    // Final drain.
    let out = uart.borrow_mut().take_output();
    console.write_bytes(&out);

    match outcome {
        RunOutcome::Exited(code) => {
            eprintln!("wasm-vm: guest exited {code}");
            ExitCode::from((code & 0xff) as u8)
        }
        RunOutcome::Trapped(t) => {
            eprintln!(
                "wasm-vm: unhandled trap {:?} (tval={:#x}, pc={:#x}) — boot aborted",
                t.cause,
                t.tval,
                m.hart().regs.pc,
            );
            ExitCode::from(101)
        }
        RunOutcome::MaxInstrs => {
            // `total` is the sum of quantum sizes run, i.e. run-loop steps — very close to
            // retired instructions but not exact (a quantum that delivers an interrupt spends
            // a step retiring nothing), so it's labelled "steps", not "retired".
            eprintln!(
                "wasm-vm: reached --max-instrs {} (~{total} steps)",
                a.max_instrs
            );
            ExitCode::from(102)
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
