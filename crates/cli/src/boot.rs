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
use std::path::{Path, PathBuf};
use std::process::ExitCode;
use std::rc::Rc;
use std::sync::mpsc;

use clap::Args;
use wasm_vm_core::dev::console::ConsoleSink;
use wasm_vm_core::trace::{HashSink, NullSink, TraceSink};
use wasm_vm_core::{Machine, RunOutcome, platform};

use crate::file_backend;

/// E4-T15: an opt-in retirement sink that counts the DYNAMIC share of F/D floating-point
/// instructions in a real guest run, to ground the JIT FP-translation policy decision in a
/// measured number rather than an assertion. Enabled only when `WASM_VM_FP_HISTOGRAM` is set in
/// the environment, so the production boot path (which uses `NullSink`) is untouched.
///
/// The classifier is deliberately INDEPENDENT of `wasm_vm_core::decode` — it inspects the raw
/// retired instruction bits directly (the RISC-V opcode map) so it doubles as the adversarial
/// "recompute the F/D share independently" cross-check (E4-T15 verification §1). It handles both
/// 32-bit and RVC 16-bit encodings (in RV64 the only compressed FP ops are C.FLD/C.FSD/C.FLDSP/
/// C.FSDSP — double load/store).
#[derive(Default)]
struct FpShareSink {
    total: u64,
    fp: u64,
    fp_ldst: u64,
    fp_compute: u64,
}

impl FpShareSink {
    /// `true` iff the raw retired instruction bits are an F/D op. Standard RISC-V opcode map:
    /// 32-bit LOAD-FP(0x07)/STORE-FP(0x27)/MADD(0x43)/MSUB(0x47)/NMSUB(0x4b)/NMADD(0x4f)/
    /// OP-FP(0x53); RVC quadrant-0 funct3=001/101 (C.FLD/C.FSD) and quadrant-2 funct3=001/101
    /// (C.FLDSP/C.FSDSP).
    fn is_fp(raw: u32) -> (bool, bool) {
        // returns (is_fp, is_load_store_fp)
        if raw & 0b11 == 0b11 {
            match raw & 0x7f {
                0x07 | 0x27 => (true, true),                       // LOAD-FP / STORE-FP
                0x43 | 0x47 | 0x4b | 0x4f | 0x53 => (true, false), // MADD/MSUB/NMSUB/NMADD/OP-FP
                _ => (false, false),
            }
        } else {
            let quadrant = raw & 0b11;
            let funct3 = (raw >> 13) & 0b111;
            match (quadrant, funct3) {
                (0b00, 0b001) | (0b00, 0b101) => (true, true), // C.FLD / C.FSD
                (0b10, 0b001) | (0b10, 0b101) => (true, true), // C.FLDSP / C.FSDSP
                _ => (false, false),
            }
        }
    }
}

impl TraceSink for FpShareSink {
    #[inline]
    fn retire(&mut self, r: &wasm_vm_core::trace::TraceRecord) {
        self.total += 1;
        let (is_fp, is_ldst) = Self::is_fp(r.insn);
        if is_fp {
            self.fp += 1;
            if is_ldst {
                self.fp_ldst += 1;
            } else {
                self.fp_compute += 1;
            }
        }
    }
}

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
    /// Attach a virtio-blk drive: `file=IMG` or `file=IMG,ro` (mmap-backed). The first `--drive`
    /// claims slot 0 (`/dev/vda`); repeat the flag to attach further drives after the reserved
    /// net/rng/keyboard slots (`/dev/vdb`, …) — the E4-T03 bench harness attaches its read-only
    /// overlay this way.
    #[arg(long)]
    pub drive: Vec<String>,
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
    /// E5-T11c: arm the deterministic serial evdev proof hook. When the guest prints the
    /// echo-proof `WVM_KB_INJECT` marker, inject one KEY_A make frame followed by one break frame.
    #[arg(long)]
    pub keyboard_proof: bool,
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
    /// E4-T05: enable the predecoded basic-block cache (decode memoization with page-granular
    /// invalidation). Additive and default-off; semantically identical to the legacy path
    /// (proven byte-identical by `predecode_diff`). A perf lever for Phase C measurement.
    #[arg(long)]
    pub block_cache: bool,
    /// E4-T05 Phase C: batch the interrupt/device-sync poll to block boundaries (≤128 instrs)
    /// instead of per-instruction — the CoreMark lever (device sync was 47% of host time per
    /// E4-T02). Requires `--block-cache`. NOT byte-identical to the legacy path by design; timer
    /// latency stays bounded to one block. Default off.
    #[arg(long)]
    pub interrupt_batching: bool,
    /// E4-T29 (NATIVE): attach the wasmtime-backed JIT executor (the reference executor every
    /// jit-runtime test uses) and enable the JIT. Default OFF — with the flag absent NO executor is
    /// constructed and the boot is byte-identical to the interpreter oracle. Turning it on also turns
    /// on the block cache (`set_jit` does) and the block-boundary interrupt poll, matching the proven
    /// test configuration.
    #[arg(long)]
    pub jit: bool,
    /// E4-T29: hotness threshold (executions before a block is nominated for translation). Only
    /// meaningful with `--jit`; unset keeps the core default.
    #[arg(long)]
    pub jit_threshold: Option<u32>,
    /// E4-T18 A/B: with `--jit`, disable direct block→block chaining (chaining defaults ON under
    /// the JIT). The dispatch loop then returns after every compiled block (the E4-T10 behavior),
    /// so `--jit` vs `--jit --no-chain` measures the chaining uplift on the same binary.
    #[arg(long, requires = "jit")]
    pub no_chain: bool,
    /// E4-T19 A/B: cap the number of translated blocks packed into one JIT module. `1` forces
    /// one-block-per-module (unbatched); the default executor value is 64. Only meaningful with
    /// `--jit`.
    #[arg(long, requires = "jit", value_parser = parse_positive_usize)]
    pub jit_batch_size: Option<usize>,
    /// E2-T25: emit a boot phase-timing table (wall ms, retired, MIPS per phase) + per-device
    /// MMIO access counts, as pretty text + JSON, when the boot reaches userland (or at exit).
    #[arg(long)]
    pub profile_boot: bool,
    /// E4-T01: sample the hottest guest PCs + attribute host wall-time per subsystem, printed at
    /// exit (of the first boot). Injects a monotonic `Instant` timer read only on cold paths.
    #[arg(long)]
    pub profile: bool,
    /// E4-T01: resolve the hot PC regions to kernel symbols using a `System.map` file
    /// (`<hex addr> <type> <name>` lines). Only meaningful with `--profile`.
    #[arg(long)]
    pub symbols: Option<PathBuf>,
    /// E4-T01: also emit the profile as a machine-readable `PROFILE_HOTPC_JSON` line on stdout.
    #[arg(long)]
    pub profile_json: bool,
    /// E3-T13: attach a virtio-net device (slot 1) with the loopback backend — the guest sees
    /// `eth0` (MAC 52:54:00:12:34:56); transmitted frames echo back with src/dst MAC swapped.
    #[arg(long)]
    pub net: bool,
    /// E3-T14: attach virtio-net (slot 1) backed by the slirp user-mode network stack instead of
    /// loopback — DHCP configures `eth0`, and guest-initiated TCP/UDP is NATed onto real outbound
    /// sockets, with internal DHCP and host-resolver-backed DNS. Takes precedence over `--net`.
    #[arg(long)]
    pub net_slirp: bool,
    /// Attach a virtio-rng entropy device (slot 2) backed by the OS CSPRNG (`getrandom`). The guest
    /// binds it as `/dev/hwrng` and seeds its CRNG from it. Off by default so deterministic boot
    /// evidence is unaffected; turn it on for network/TLS workloads that need prompt entropy.
    #[arg(long)]
    pub virtio_rng: bool,
    /// DHCP lease advertised by slirp, in seconds. Short values make renewal tests deterministic.
    #[arg(long, default_value_t = wasm_vm_slirp::dhcp::DEFAULT_LEASE_SECS)]
    pub net_slirp_lease_secs: u32,
    /// Link MTU advertised by slirp DHCP option 26.
    #[arg(long, default_value_t = wasm_vm_slirp::dhcp::DEFAULT_MTU)]
    pub net_slirp_mtu: u16,
    /// Host-selected regular file to upload to the guest agent once its private WVFT connection is
    /// ready. Repeat for an ordered queue. The protocol receives only each basename and its bytes.
    #[arg(long, requires = "net_slirp")]
    pub wvft_upload: Vec<PathBuf>,
    /// Host-selected directory that receives guest `vm-download` basenames through WVFT. The guest
    /// cannot escape this root or select any other host path.
    #[arg(long, requires = "net_slirp")]
    pub wvft_download_dir: Option<PathBuf>,
    /// Write compact guest-layer evidence at exit: a rolling digest of every retired instruction,
    /// retired count, and final architectural-state SHA-256. Intended for reopenable verification
    /// of long Linux boots where a full multi-billion-line canonical trace is impractical.
    #[arg(long)]
    pub evidence: Option<PathBuf>,
    /// E3-T12c4: take a whole-machine resume snapshot (`Machine::save_resume`) the first time the
    /// guest console prints `--snapshot-trigger`, write it to this path, and exit 0. The snapshot
    /// quiesces the virtio-blk in-flight set first (E3-T12c2) and refuses (exit 103, no file) if it
    /// cannot — so it is never torn. Pair with a guest `sync` before the trigger so the `--drive`
    /// file matches the snapshotted page cache; resume the blob into a fresh process with
    /// `--resume-from` against the SAME `--drive`.
    #[arg(long, requires = "snapshot_trigger")]
    pub snapshot_out: Option<PathBuf>,
    /// E3-T12c4: the guest-console marker that triggers `--snapshot-out`. Choose an output-only
    /// string the guest prints (e.g. `echo WVSNAP_NOW`) so the command echo can't self-trigger.
    #[arg(long)]
    pub snapshot_trigger: Option<String>,
    /// E3-T12c4: restore a `--snapshot-out` blob into the assembled machine BEFORE running (instead
    /// of a cold kernel boot). The blob's coherence header is validated against this machine first
    /// (E3-T12c3); reopen the SAME `--drive` image the snapshot was taken against.
    #[arg(long)]
    pub resume_from: Option<PathBuf>,
    /// E4 boot-snapshot: stamp the snapshot's coherence `core_hash` (64 hex chars → 32 bytes) so the
    /// shipped browser boot-snapshot binds to the matching wasm build. The browser derives the same
    /// value from its crate version; a mismatch makes the coherence guard reject the snapshot (cold
    /// boot fallback). Requires `--snapshot-out`.
    #[arg(long, requires = "snapshot_out")]
    pub snapshot_core_id: Option<String>,
    /// E4 boot-snapshot: stamp the snapshot's coherence `base_image_hash` (64 hex chars → 32 bytes),
    /// binding it to a specific kernel+initramfs pair. Requires `--snapshot-out`.
    #[arg(long, requires = "snapshot_out")]
    pub snapshot_base_id: Option<String>,
}

/// Decode exactly 32 bytes from a 64-char lowercase/uppercase hex string (the snapshot identity
/// stamp). Returns a clear message on any malformed input.
fn parse_positive_usize(value: &str) -> Result<usize, String> {
    let parsed = value
        .parse::<usize>()
        .map_err(|e| format!("expected a positive integer: {e}"))?;
    if parsed == 0 {
        return Err("expected a positive integer, got 0".to_string());
    }
    Ok(parsed)
}

fn parse_id32(hex: &str) -> Result<[u8; 32], String> {
    let hex = hex.trim();
    if hex.len() != 64 {
        return Err(format!("expected 64 hex chars, got {}", hex.len()));
    }
    let mut out = [0u8; 32];
    for (i, byte) in out.iter_mut().enumerate() {
        *byte = u8::from_str_radix(&hex[i * 2..i * 2 + 2], 16)
            .map_err(|e| format!("bad hex at byte {i}: {e}"))?;
    }
    Ok(out)
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

/// E4-T01: the monotonic host timer the profiler samples on its cold paths. `Instant`-based (unlike
/// the epoch `SystemClock`), so the elapsed-nanosecond deltas the profiler brackets are non-decreasing.
/// Lives in the CLI because core bans host time sources for determinism.
struct MonotonicTimer {
    start: std::time::Instant,
}

impl MonotonicTimer {
    fn new() -> Self {
        Self {
            start: std::time::Instant::now(),
        }
    }
}

impl wasm_vm_core::prof::HostTimer for MonotonicTimer {
    fn now_ns(&self) -> u64 {
        self.start.elapsed().as_nanos() as u64
    }
}

/// E4-T01: parse a `System.map` (`<hex addr> <type> <name>` lines) into an address-sorted symbol
/// table for resolving hot PCs. Malformed lines are skipped (never a panic).
fn parse_system_map(path: &Path) -> std::io::Result<Vec<(u64, String)>> {
    let text = std::fs::read_to_string(path)?;
    let mut syms: Vec<(u64, String)> = text
        .lines()
        .filter_map(|line| {
            let mut it = line.split_whitespace();
            let addr = u64::from_str_radix(it.next()?, 16).ok()?;
            let _type = it.next()?; // symbol type letter (T/t/D/…) — unused
            let name = it.next()?;
            Some((addr, name.to_string()))
        })
        .collect();
    syms.sort_by_key(|(addr, _)| *addr);
    Ok(syms)
}

/// The symbol whose address is the greatest `<= pc` (nearest-preceding lookup over the sorted table).
fn symbolize(syms: &[(u64, String)], pc: u64) -> Option<&str> {
    let idx = syms.partition_point(|(addr, _)| *addr <= pc);
    (idx > 0).then(|| syms[idx - 1].1.as_str())
}

/// E3-T12c4: watches the guest console stream for the `--snapshot-trigger` marker and, on its FIRST
/// sighting, takes a whole-machine `save_resume` snapshot to `out`. Split-across-quanta safe (keeps a
/// short rolling tail like [`BootProfiler`]). `fired` once the blob is written; `refused` carries the
/// typed reason if the snapshot could not be taken (a non-quiesced machine) or the file write failed —
/// in which case NO blob exists and the boot exits non-zero rather than emit a torn snapshot.
struct SnapshotOnMarker {
    trigger: String,
    out: PathBuf,
    tail: String,
    fired: bool,
    refused: Option<String>,
}

impl SnapshotOnMarker {
    fn new(trigger: String, out: PathBuf) -> Self {
        Self {
            trigger,
            out,
            tail: String::new(),
            fired: false,
            refused: None,
        }
    }

    /// Feed one quantum's console output; if the trigger is seen (and not already fired/refused),
    /// snapshot the machine to `out`. Returns true when the boot should STOP (snapshot taken, or an
    /// unrecoverable refusal). The machine is passed `&mut` because `save_resume` quiesces first.
    fn feed(&mut self, out: &[u8], m: &mut Machine) -> bool {
        if self.fired || self.refused.is_some() {
            return false;
        }
        self.tail.push_str(&String::from_utf8_lossy(out));
        if self.tail.contains(&self.trigger) {
            match m.save_resume() {
                Ok(blob) => match std::fs::write(&self.out, &blob) {
                    Ok(()) => {
                        eprintln!(
                            "wasm-vm: snapshot ({} bytes) written to {} at trigger {:?}",
                            blob.len(),
                            self.out.display(),
                            self.trigger
                        );
                        self.fired = true;
                    }
                    Err(e) => {
                        self.refused = Some(format!("cannot write {}: {e}", self.out.display()));
                    }
                },
                Err(e) => {
                    // A non-quiesced machine (a parked in-flight request that would not drain) is a
                    // typed refusal — never a torn blob (E3-T12c2).
                    self.refused = Some(format!("save_resume refused: {e:?}"));
                }
            }
            return true;
        }
        // Bounded tail: keep enough that a marker split across quanta still matches.
        if self.tail.len() > 512 {
            let mut cut = self.tail.len() - 256;
            while cut < self.tail.len() && !self.tail.is_char_boundary(cut) {
                cut += 1;
            }
            self.tail = self.tail.split_off(cut);
        }
        false
    }
}

/// E4-T29: print the JIT activity summary to stderr after a `--jit` run. Sources every number from
/// the accessors the `Machine`/executor already expose (discovery, chaining, cache/eviction stats),
/// so it works for the CLI-integrated executor exactly as it does in the jit-runtime tests. `jit_active`
/// being false here means the flag was set but discovery/executor never armed — surfaced explicitly so
/// a silent no-op JIT boot can't masquerade as a real one.
pub fn print_jit_stats(m: &Machine) {
    let d = m.discovery_stats();
    let chain = m.chain_stats();
    let cache = m.jit_cache_stats();
    let pause = m.prof_report(0, 0).jit_pause;
    let (modules, est_bytes) = m.jit_registry();
    let (executed, retired_via_jit) = m
        .executor()
        .map(|e| (e.executed_blocks(), e.retired_via_jit()))
        .unwrap_or((0, 0));
    let compiled = m.executor().map(|e| e.compiled_count()).unwrap_or(0);
    eprintln!("=== E4-T29 JIT summary ===");
    eprintln!(
        "jit_active={}  blocks_compiled={}  blocks_executed={}  retired_via_jit={}",
        m.jit_active(),
        compiled,
        executed,
        retired_via_jit,
    );
    eprintln!(
        "discovery: nominated={} deduped={} excluded={} dropped_stale={} dropped_overflow={} queue_hwm={}",
        d.nominated, d.deduped, d.excluded, d.dropped_stale, d.dropped_overflow, d.queue_hwm,
    );
    eprintln!(
        "chaining: links_made={} links_cut={} dispatch_entries={} max_chain_depth={} links_followed={}",
        chain.links_made,
        chain.links_cut,
        chain.dispatch_entries,
        chain.max_chain_depth,
        chain.total_links_followed(),
    );
    eprintln!(
        "cache: modules={} est_bytes={} installs={} retranslations={} evictions={} flushes={} generation={}",
        modules,
        est_bytes,
        cache.installs,
        cache.retranslations,
        cache.evictions,
        cache.flushes,
        cache.generation,
    );
    eprintln!(
        "jit_pause: samples={} sum_ns={} max_ns={} over_target={}",
        pause.count, pause.sum_ns, pause.max_ns, pause.over_target,
    );
    // Machine-readable one-liner for the bench harness / CI to scrape.
    eprintln!(
        "JIT_STATS_JSON {{\"blocks_compiled\":{},\"blocks_executed\":{},\"retired_via_jit\":{},\"links_made\":{},\"dispatch_entries\":{},\"installs\":{},\"evictions\":{},\"jit_pause_count\":{},\"jit_pause_sum_ns\":{},\"jit_pause_max_ns\":{},\"jit_pause_over_target\":{}}}",
        compiled,
        executed,
        retired_via_jit,
        chain.links_made,
        chain.dispatch_entries,
        cache.installs,
        cache.evictions,
        pause.count,
        pause.sum_ns,
        pause.max_ns,
        pause.over_target,
    );
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
    if a.blk_log && a.drive.is_empty() {
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

    // E2-T25: a boot profiler covering the FIRST boot (the baseline). Reboots are not profiled.
    let mut profiler = a.profile_boot.then(BootProfiler::new);
    // E3-T12c4: arm the snapshot-on-marker watcher (requires --snapshot-trigger, enforced by clap).
    let mut snap = match (&a.snapshot_out, &a.snapshot_trigger) {
        (Some(out), Some(trigger)) => Some(SnapshotOnMarker::new(trigger.clone(), out.clone())),
        _ => None,
    };
    let mut keyboard_proof = a.keyboard_proof.then(KeyboardProof::new);

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
        // E3-T12c4: restore a snapshot into the freshly-assembled machine BEFORE running — the
        // coherence header is validated first (E3-T12c3); RAM/CPU/CLINT/virtio transport are
        // overwritten from the blob (the cold kernel placement above is discarded, intentionally).
        if boot_num == 1
            && let Some(path) = &a.resume_from
        {
            let blob = match std::fs::read(path) {
                Ok(b) => b,
                Err(e) => {
                    eprintln!("wasm-vm: cannot read resume blob {}: {e}", path.display());
                    return ExitCode::from(2);
                }
            };
            if let Err(e) = m.load_resume(&blob) {
                eprintln!("wasm-vm: resume refused ({e:?}) — {}", path.display());
                return ExitCode::from(103);
            }
            eprintln!(
                "wasm-vm: resumed {} bytes from {} — continuing guest",
                blob.len(),
                path.display()
            );
        }
        // E4 boot-snapshot: stamp the coherence identity BEFORE the snapshot watcher can fire, so the
        // written blob's header binds to the intended build (`--snapshot-core-id`) and kernel+initramfs
        // (`--snapshot-base-id`). Off these flags the machine keeps its default all-zero identity (the
        // proven E3-T12c round-trip). clap already gates both on `--snapshot-out`.
        if a.snapshot_core_id.is_some() || a.snapshot_base_id.is_some() {
            let core = match &a.snapshot_core_id {
                Some(h) => match parse_id32(h) {
                    Ok(v) => v,
                    Err(e) => {
                        eprintln!("wasm-vm: bad --snapshot-core-id: {e}");
                        return ExitCode::from(2);
                    }
                },
                None => [0u8; 32],
            };
            let base = match &a.snapshot_base_id {
                Some(h) => match parse_id32(h) {
                    Ok(v) => v,
                    Err(e) => {
                        eprintln!("wasm-vm: bad --snapshot-base-id: {e}");
                        return ExitCode::from(2);
                    }
                },
                None => [0u8; 32],
            };
            m.set_snapshot_identity(core, base);
        }
        // E4-T15: opt-in FP-share measurement. When WASM_VM_FP_HISTOGRAM is set, run the boot under
        // the counting sink and emit FP_SHARE_JSON — the dynamic F/D instruction share that grounds
        // the JIT FP-translation policy. Off by default (production path uses NullSink below).
        let fp_hist = std::env::var("WASM_VM_FP_HISTOGRAM").is_ok();
        let mut hash = HashSink::new();
        let outcome = if fp_hist {
            let mut fp = FpShareSink::default();
            let o = run_machine(
                &a,
                &mut m,
                &uart,
                &console,
                stdin_rx.as_ref(),
                &mut pending,
                profiler.as_mut().filter(|_| boot_num == 1),
                snap.as_mut(),
                keyboard_proof.as_mut(),
                &mut fp,
            );
            let pct = if fp.total == 0 {
                0.0
            } else {
                100.0 * fp.fp as f64 / fp.total as f64
            };
            eprintln!(
                "FP_SHARE_JSON {{\"total_retired\":{},\"fp\":{},\"fp_ldst\":{},\"fp_compute\":{},\"fp_pct\":{:.6}}}",
                fp.total, fp.fp, fp.fp_ldst, fp.fp_compute, pct
            );
            o
        } else if a.evidence.is_some() {
            run_machine(
                &a,
                &mut m,
                &uart,
                &console,
                stdin_rx.as_ref(),
                &mut pending,
                profiler.as_mut().filter(|_| boot_num == 1),
                snap.as_mut(),
                keyboard_proof.as_mut(),
                &mut hash,
            )
        } else {
            let mut null = NullSink;
            run_machine(
                &a,
                &mut m,
                &uart,
                &console,
                stdin_rx.as_ref(),
                &mut pending,
                profiler.as_mut().filter(|_| boot_num == 1),
                snap.as_mut(),
                keyboard_proof.as_mut(),
                &mut null,
            )
        };
        // Final drain before we act on the outcome.
        let out = uart.borrow_mut().take_output();
        console.write_bytes(&out);
        // E3-T12c4: the snapshot-on-marker watcher stopped the run — resolve it BEFORE the normal
        // outcome match. A written blob is a clean exit (0); a refusal (non-quiesced machine or a
        // failed write, so NO blob exists) exits non-zero rather than pretend a snapshot was taken.
        if let Some(s) = snap.as_ref() {
            if let Some(err) = &s.refused {
                eprintln!("wasm-vm: {err}");
                return ExitCode::from(103);
            }
            if s.fired {
                eprintln!("wasm-vm: snapshot complete — exiting");
                return ExitCode::SUCCESS;
            }
        }
        if boot_num == 1
            && let Some(p) = profiler.as_ref()
        {
            p.report(&m.bus_mut().device_hits(), m.irq_stats().retired);
        }
        if a.stats {
            eprint!("{}", m.stats_dump()); // E2-T20
        }
        // E4-T29: JIT activity summary at exit (blocks compiled/executed, chaining, cache/eviction).
        if a.jit {
            print_jit_stats(&m);
        }
        // E4-T01: the hot-PC + subsystem-time report for the first boot. `total_ns` is the wall span
        // the machine measured around its own run; CPU-interp is derived from it by subtraction.
        if boot_num == 1 && a.profile {
            let report = m.prof_report(m.prof_total_ns(), 10);
            eprint!("{}", report.to_text());
            if let Some(path) = &a.symbols {
                match parse_system_map(path) {
                    Ok(syms) => {
                        eprintln!("E4-T01 hot symbols (nearest preceding):");
                        for r in &report.top_regions {
                            let name = symbolize(&syms, r.phys_pc).unwrap_or("<unknown>");
                            eprintln!("  {:>6.2}%  0x{:016x}  {name}", r.pct, r.phys_pc);
                        }
                    }
                    Err(e) => eprintln!("wasm-vm: cannot read --symbols {}: {e}", path.display()),
                }
            }
            if a.profile_json {
                println!("PROFILE_HOTPC_JSON {}", report.to_json());
            }
        }
        if let Some(path) = &a.evidence {
            let evidence = format!(
                "wasm-vm boot evidence v1\ntrace fnv64={:016x}\ntrace retired={}\n{}\noutcome={outcome:?}\n",
                hash.hash(),
                hash.retired(),
                m.snapshot().state_sha256_line(),
            );
            if let Err(e) = std::fs::write(path, evidence) {
                eprintln!(
                    "wasm-vm: cannot write boot evidence {}: {e}",
                    path.display()
                );
                return ExitCode::from(74);
            }
        }

        if a.keyboard_proof && keyboard_proof.as_ref().is_some_and(|proof| !proof.injected) {
            eprintln!("wasm-vm: keyboard proof ended before the WVM_KB_INJECT marker was observed");
            return ExitCode::from(1);
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
                // A profiled boot stops itself at the userland marker (also a MaxInstrs return);
                // don't mislabel that as hitting the budget (critic C3).
                if profiler.as_ref().is_some_and(|p| p.done) {
                    eprintln!("wasm-vm: profile complete (stopped at userland marker)");
                    return ExitCode::SUCCESS;
                }
                eprintln!("wasm-vm: reached --max-instrs {}", a.max_instrs);
                return ExitCode::from(102);
            }
        }
    }
}

/// Build a fresh machine for one boot: RAM + all devices + the boot triple in DRAM, entered at
/// the ADR-0002 contract. Returns the machine and the UART handle, or an `ExitCode` for a fatal
/// setup error. Called once per boot (reboot rebuilds from scratch → devices reset, RAM zeroed).
/// Parse one `--drive` spec (`file=IMG` or `file=IMG,ro`) and open its file backend. Returns the
/// boxed backend, or an `ExitCode` (2) after printing a diagnostic — the same failure shape the
/// single-drive path used before E4-T03 made `--drive` repeatable.
fn open_drive_backend(spec: &str) -> Result<Box<dyn wasm_vm_core::block::BlockBackend>, ExitCode> {
    let (path, ro) = match spec.strip_suffix(",ro") {
        Some(rest) => (rest, true),
        None => (spec, false),
    };
    let Some(path) = path.strip_prefix("file=") else {
        eprintln!("wasm-vm: --drive expects file=IMG[,ro]");
        return Err(ExitCode::from(2));
    };
    let opened = if ro {
        file_backend::FileBackend::open_read_only(Path::new(path))
            .map(|b| Box::new(b) as Box<dyn wasm_vm_core::block::BlockBackend>)
    } else {
        file_backend::FileBackend::open(Path::new(path))
            .map(|b| Box::new(b) as Box<dyn wasm_vm_core::block::BlockBackend>)
    };
    opened.map_err(|e| {
        eprintln!("wasm-vm: cannot open drive {path}: {e}");
        ExitCode::from(2)
    })
}

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
    m.set_block_cache(a.block_cache); // E4-T05: default off; additive decode-cache toggle
    m.set_interrupt_batching(a.interrupt_batching); // E4-T05 Phase C: block-boundary interrupt poll
    // E4-T29 (NATIVE): opt-in JIT. Construct the wasmtime executor exactly as the jit-runtime tests
    // do, then enable the JIT. `set_jit(true)` also turns the block cache on (discovery is the JIT's
    // front end); the block-boundary interrupt poll matches the proven test config. Off by default:
    // when `--jit` is absent the executor stays `None` and `try_jit_block` is a no-op, so the boot is
    // byte-identical to the interpreter oracle.
    if a.jit {
        m.set_executor(Box::new(jit_runtime::WasmtimeExecutor::new()));
        if let Some(k) = a.jit_batch_size {
            m.set_batch_size(k); // E4-T19 A/B: k=1 is the unbatched control
        }
        if let Some(t) = a.jit_threshold {
            m.set_hotness_threshold(t);
        }
        m.set_jit(true);
        m.set_interrupt_batching(true);
        if a.no_chain {
            m.set_chaining(false); // E4-T18 A/B: chain-following off, dispatch per block
        }
    }
    if a.profile {
        m.set_host_timer(Rc::new(MonotonicTimer::new())); // E4-T01: arms profiling + injects the timer
    }

    // --- devices, in dependency order (PLIC before its consumers) ---
    m.enable_clint(10);
    m.enable_plic();
    m.enable_rtc(Box::new(SystemClock));
    m.enable_syscon(); // E2-T17: poweroff/reboot finisher at TEST_BASE
    let uart = m.enable_uart16550();
    // virtio: a real blk device if --drive was given, else the 8 empty mmio slots the DTB
    // advertises (the kernel probes each address; an unbacked window would fault). Slots 1–3 are
    // reserved for net, rng, and the E5-T11 keyboard, so additional disks begin at slot 4. Linux
    // still enumerates the block devices in probe order as /dev/vda, /dev/vdb, … despite the
    // unused virtio-mmio windows between them.
    if a.drive.is_empty() {
        let _ = m.enable_virtio_slots(None);
    } else {
        // First drive claims slot 0 (/dev/vda). E4-T03's extra drive and any later drives use the
        // first slots after the keyboard reservation.
        let first = open_drive_backend(&a.drive[0])?;
        let _ = m.enable_virtio_blk(first);
        for (slot, spec) in (4..).zip(a.drive.iter().skip(1)) {
            let backend = open_drive_backend(spec)?;
            let _ = m.enable_virtio_blk_at(slot, backend);
        }
        if a.blk_log {
            m.enable_blk_log(); // E2-T19: trace requests to stderr
        }
    }
    if a.net_slirp {
        // E3-T14: slirp-backed virtio-net in slot 1 — the guest's frames terminate in the
        // user-mode TCP/IP stack and guest-initiated TCP is NATed onto real outbound sockets.
        let config = crate::net_backend::SlirpConfig {
            lease_secs: a.net_slirp_lease_secs.max(1),
            mtu: a.net_slirp_mtu.clamp(576, 1500),
        };
        let file_transfer = crate::file_transfer_fixture::FileTransferFixture {
            uploads: a.wvft_upload.clone(),
            download_dir: a.wvft_download_dir.clone(),
        };
        let _ = m.enable_virtio_net(Box::new(
            crate::net_backend::SlirpBackend::with_config_and_file_transfer(
                crate::net_backend::GATEWAY_MAC,
                config,
                file_transfer,
            ),
        ));
    } else if a.net {
        // E3-T13: loopback-backed virtio-net in slot 1 (the DTB already advertises all 8
        // slots, so the stock virtio_net driver probes it with no DTB change).
        let _ = m.enable_virtio_net(Box::new(
            wasm_vm_core::dev::virtio::net::LoopbackBackend::new(),
        ));
    }
    if a.virtio_rng {
        // virtio-rng in slot 2, backed by the OS CSPRNG — seeds the guest CRNG promptly.
        let _ = m.enable_virtio_rng(Box::new(crate::os_entropy::OsEntropy));
    }
    // E5-T11c: the concrete keyboard is present on every native Linux boot, so the rebuilt guest
    // can bind /dev/input/event0 before the host's first key injection.
    let _ = m.enable_virtio_keyboard();

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
/// E2-T25 boot profiler. Detects guest phase markers in the console byte stream and, at each
/// marker's FIRST sighting, stamps host wall time (allowed here — this is the CLI, not core, so
/// the determinism gate does not apply) and the retired-instruction count. `report()` then prints
/// a phase table (per-phase wall ms, retired, derived MIPS) and per-device MMIO access counts.
/// The host-time split (CPU vs device handlers vs I/O) comes from an external flamegraph — see
/// docs/perf-baseline.md; the deterministic device counts here cross-check it.
struct BootProfiler {
    start: std::time::Instant,
    tail: String,
    /// (phase label, needle substring); a phase fires on the FIRST line containing its needle.
    markers: Vec<(&'static str, &'static str)>,
    /// (label, wall_ms, retired) at first sighting, in the order phases fired.
    hits: Vec<(&'static str, u128, u64)>,
    seen: Vec<bool>,
    /// Set once a TERMINAL marker (userland reached) fires; the run loop stops profiling boots
    /// here so the total reflects boot-to-userland, not the idle spin that follows under --no-input.
    done: bool,
}

impl BootProfiler {
    fn new() -> Self {
        // Markers present across busybox-initramfs and Alpine boots; unseen ones are simply omitted.
        let markers = vec![
            ("kernel-entry", "Linux version"),
            ("console-up", "printk: console"),
            ("rootfs-mounted", "VFS: Mounted root"),
            ("init-handoff", "Freeing unused kernel"),
            ("busybox-userland", "userland up"),
            ("getty-login", "login:"),
        ];
        let n = markers.len();
        Self {
            start: std::time::Instant::now(),
            tail: String::new(),
            markers,
            hits: Vec::new(),
            seen: vec![false; n],
            done: false,
        }
    }

    /// Feed one quantum's console output + the current retired count; record any first-seen markers.
    fn feed(&mut self, out: &[u8], retired: u64) {
        if out.is_empty() {
            return;
        }
        self.tail.push_str(&String::from_utf8_lossy(out));
        for (i, (label, needle)) in self.markers.iter().enumerate() {
            if !self.seen[i] && self.tail.contains(needle) {
                self.seen[i] = true;
                self.hits
                    .push((label, self.start.elapsed().as_millis(), retired));
                // "userland up" (busybox) or "login:" (getty) means the boot is complete.
                if *label == "busybox-userland" || *label == "getty-login" {
                    self.done = true;
                }
            }
        }
        // Keep only a short tail so a marker split across quanta still matches, without unbounded
        // growth. Snap the cut to a char boundary: `from_utf8_lossy` yields valid UTF-8, but a
        // multibyte char (e.g. a U+FFFD from a non-ASCII dmesg byte) straddling `len-256` would make
        // `split_off` PANIC — a profiling flag must never be able to crash the emulator.
        if self.tail.len() > 512 {
            let mut cut = self.tail.len() - 256;
            while cut < self.tail.len() && !self.tail.is_char_boundary(cut) {
                cut += 1;
            }
            self.tail = self.tail.split_off(cut);
        }
    }

    /// Map a device window base to a human name via the platform memory map.
    fn device_name(base: u64) -> &'static str {
        use wasm_vm_core::platform::virt::{
            CLINT_BASE, PLIC_BASE, RTC_BASE, UART0_BASE, VIRTIO_BASE,
        };
        match base {
            b if b == UART0_BASE => "uart16550",
            b if b == CLINT_BASE => "clint",
            b if b == PLIC_BASE => "plic",
            b if b == RTC_BASE => "goldfish-rtc",
            b if (VIRTIO_BASE..VIRTIO_BASE + 8 * 0x1000).contains(&b) => "virtio-mmio",
            _ => "other",
        }
    }

    /// Pretty phase table + per-device counts + a JSON blob, to stderr.
    fn report(&self, device_hits: &[(u64, u64)], total_retired: u64) {
        let total_ms = self.start.elapsed().as_millis();
        eprintln!("\n=== E2-T25 boot profile ===");
        eprintln!("phase              wall_ms   d_wall_ms   d_retired      phase_MIPS");
        let (mut pw, mut pr) = (0u128, 0u64);
        let mut json_phases = String::new();
        for (label, wall_ms, retired) in &self.hits {
            let dw = wall_ms.saturating_sub(pw);
            let dr = retired.saturating_sub(pr);
            let mips = if dw > 0 {
                dr as f64 / dw as f64 / 1000.0
            } else {
                0.0
            };
            eprintln!("{label:<18}{wall_ms:>8}{dw:>12}{dr:>12}{mips:>16.2}");
            if !json_phases.is_empty() {
                json_phases.push(',');
            }
            json_phases.push_str(&format!(
                "{{\"phase\":\"{label}\",\"wall_ms\":{wall_ms},\"retired\":{retired},\"phase_mips\":{mips:.2}}}"
            ));
            pw = *wall_ms;
            pr = *retired;
        }
        let overall_mips = if total_ms > 0 {
            total_retired as f64 / total_ms as f64 / 1000.0
        } else {
            0.0
        };
        eprintln!("total: {total_ms} ms, {total_retired} retired, overall {overall_mips:.2} MIPS");
        eprintln!("\nper-device MMIO accesses:");
        let mut json_dev = String::new();
        for (base, hits) in device_hits {
            let name = Self::device_name(*base);
            eprintln!("  {name:<14} {hits:>12}  (@ {base:#x})");
            if !json_dev.is_empty() {
                json_dev.push(',');
            }
            json_dev.push_str(&format!(
                "{{\"device\":\"{name}\",\"base\":\"{base:#x}\",\"accesses\":{hits}}}"
            ));
        }
        eprintln!(
            "\nPROFILE_JSON {{\"total_ms\":{total_ms},\"total_retired\":{total_retired},\"overall_mips\":{overall_mips:.2},\"phases\":[{json_phases}],\"devices\":[{json_dev}]}}"
        );
    }
}

/// E5-T11c: deterministic host hook for the serial evdev proof. The guest-side command prints
/// the marker only after it has opened `/dev/input/event0`; the next machine boundary then carries
/// one make frame and one break frame through the real virtio-input eventq.
struct KeyboardProof {
    tail: String,
    injected: bool,
    last_pending_events: Option<usize>,
}

impl KeyboardProof {
    const MARKER: &'static str = "WVM_KB_INJECT";

    fn new() -> Self {
        Self {
            tail: String::new(),
            injected: false,
            last_pending_events: None,
        }
    }

    fn feed(&mut self, out: &[u8], machine: &mut Machine) {
        if self.injected || out.is_empty() {
            return;
        }
        self.tail.push_str(&String::from_utf8_lossy(out));
        if self.tail.contains(Self::MARKER) {
            let Some(state) = machine.keyboard_input() else {
                eprintln!("wasm-vm: keyboard proof marker observed without a keyboard device");
                self.injected = true;
                return;
            };
            let mut state = state.borrow_mut();
            use wasm_vm_core::dev::virtio::input::EV_KEY;
            use wasm_vm_core::dev::virtio::input::keyboard::KEY_A;
            state.inject_event(EV_KEY, KEY_A, 1);
            state.sync();
            state.inject_event(EV_KEY, KEY_A, 0);
            state.sync();
            self.injected = true;
            eprintln!("wasm-vm: keyboard proof injected KEY_A make/break frames");
        }
        if self.tail.len() > 512 {
            let mut cut = self.tail.len() - 256;
            while cut < self.tail.len() && !self.tail.is_char_boundary(cut) {
                cut += 1;
            }
            self.tail = self.tail.split_off(cut);
        }
    }

    fn observe(&mut self, machine: &Machine) {
        if !self.injected {
            return;
        }
        let Some(state) = machine.keyboard_input() else {
            return;
        };
        let pending = state.borrow().pending_events();
        if self.last_pending_events != Some(pending) {
            eprintln!("wasm-vm: keyboard proof pending events={pending}");
            self.last_pending_events = Some(pending);
        }
    }
}

// These references are the long-lived boot-loop state; bundling them into a one-use context solely
// to satisfy the argument-count style lint would obscure their ownership and widen unrelated churn.
#[allow(clippy::too_many_arguments)]
fn run_machine<T: TraceSink>(
    a: &BootArgs,
    m: &mut Machine,
    uart: &Rc<std::cell::RefCell<wasm_vm_core::dev::uart16550::Uart16550>>,
    console: &SharedStdout,
    stdin_rx: Option<&mpsc::Receiver<Vec<u8>>>,
    pending: &mut std::collections::VecDeque<u8>,
    profiler: Option<&mut BootProfiler>,
    mut snap: Option<&mut SnapshotOnMarker>,
    mut keyboard_proof: Option<&mut KeyboardProof>,
    sink: &mut T,
) -> RunOutcome {
    let mut profiler = profiler;
    let mut total = 0u64;
    loop {
        if total >= a.max_instrs {
            return RunOutcome::MaxInstrs;
        }
        let step = a.quantum.min(a.max_instrs - total);
        let o = m.run_traced(step, sink);
        // Drain UART output → stdout every quantum so the boot log streams live.
        let out = uart.borrow_mut().take_output();
        console.write_bytes(&out);
        if let Some(proof) = keyboard_proof.as_deref_mut() {
            proof.feed(&out, m);
            proof.observe(m);
        }
        // E2-T25: feed the console stream + retired count to the profiler so it can stamp the
        // wall time + retired count at each guest phase marker's first sighting.
        if let Some(p) = profiler.as_deref_mut() {
            p.feed(&out, m.irq_stats().retired);
            // Boot reached userland → stop here so the profile total is boot time, not idle spin.
            if p.done {
                return RunOutcome::MaxInstrs;
            }
        }
        // E3-T12c4: scan for the snapshot trigger; on its first sighting take the resume snapshot
        // (quiesce + save_resume) and STOP — boot() resolves the fired/refused result.
        if let Some(s) = snap.as_deref_mut()
            && s.feed(&out, m)
        {
            return RunOutcome::MaxInstrs;
        }
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

#[cfg(test)]
mod critic_profiler_tests {
    use super::BootProfiler;

    /// SWEEP (E2-T25): regression for critic C2 — a multibyte char (U+FFFD from a non-ASCII
    /// dmesg byte) straddling the tail cut must not panic split_off. No test existed for the fix.
    #[test]
    fn non_ascii_console_bytes_never_panic_the_tail_cut() {
        let mut p = BootProfiler::new();
        // Feed lots of raw 0xFF bytes (each becomes a 3-byte U+FFFD) in awkward chunk sizes so
        // the len-256 cut lands mid-char repeatedly.
        for chunk in [1usize, 3, 7, 127, 255, 511, 513] {
            let bytes = vec![0xFFu8; chunk];
            for _ in 0..20 {
                p.feed(&bytes, 0);
            }
        }
        assert!(p.hits.is_empty(), "no phase markers in noise");
    }

    /// SWEEP (E2-T25): a phase marker split across two quanta must still be detected once,
    /// and a repeated marker must not double-fire.
    #[test]
    fn marker_split_across_quanta_fires_exactly_once() {
        let mut p = BootProfiler::new();
        p.feed(b"Linux ver", 10);
        assert!(p.hits.is_empty(), "half a needle is not a sighting");
        p.feed(b"sion 6.6.63\n", 20);
        assert_eq!(p.hits.len(), 1);
        assert_eq!(p.hits[0].0, "kernel-entry");
        assert_eq!(
            p.hits[0].2, 20,
            "stamped with the retired count at sighting"
        );
        p.feed(b"Linux version 6.6.63 again\n", 30);
        assert_eq!(p.hits.len(), 1, "first sighting only");
    }

    /// SWEEP (E2-T25): the terminal markers stop the profile.
    #[test]
    fn terminal_marker_sets_done() {
        let mut p = BootProfiler::new();
        assert!(!p.done);
        p.feed(b"wasm-vm login: ", 99);
        assert!(p.done, "getty-login is terminal");
    }
}

#[cfg(test)]
mod e4t01_symbolizer_tests {
    use super::symbolize;

    // A tiny address-sorted symbol table like a parsed System.map.
    fn table() -> Vec<(u64, String)> {
        vec![
            (0x8000_0000, "_start".to_string()),
            (0x8000_0100, "memcpy".to_string()),
            (0x8000_0200, "schedule".to_string()),
        ]
    }

    #[test]
    fn resolves_to_the_nearest_preceding_symbol() {
        let t = table();
        // Exactly on a symbol, and anywhere inside its span, resolves to that symbol.
        assert_eq!(symbolize(&t, 0x8000_0100), Some("memcpy"));
        assert_eq!(symbolize(&t, 0x8000_0140), Some("memcpy"));
        assert_eq!(symbolize(&t, 0x8000_01FF), Some("memcpy"));
        assert_eq!(symbolize(&t, 0x8000_0200), Some("schedule"));
        // Past the last symbol still attributes to it (no upper bound in a flat map).
        assert_eq!(symbolize(&t, 0x8000_9999), Some("schedule"));
    }

    #[test]
    fn a_pc_below_every_symbol_is_unknown() {
        let t = table();
        assert_eq!(symbolize(&t, 0x7FFF_FFFF), None);
        assert_eq!(symbolize(&[], 0x8000_0000), None);
    }
}
