//! E4-T05 Phase A — THE key gate: the predecoded block cache must be SEMANTICALLY IDENTICAL
//! to the legacy decode path. Each committed guest is run twice in one binary — cache OFF and
//! cache ON — and the FNV rolling hash of every retirement ([`HashSink`]) plus the retire count
//! and the run outcome must match BYTE-FOR-BYTE. A stale or mis-built block would perturb the
//! trace and fail here even if the guest still "boots".
//!
//! Adversarial angle (E4-T05 verification): a 1-entry cache (pathological eviction — every
//! block build evicts the previous) must ALSO be byte-identical to cache-off. Any divergence
//! between the big-cache and 1-entry runs would indicate a stale-block bug.

use wasm_vm_core::bus::mmap::{UART0_BASE, UART0_LEN};
use wasm_vm_core::dev::console::{Uart0Stub, VecSink};
use wasm_vm_core::trace::HashSink;
use wasm_vm_core::{Machine, RunOutcome};

const HELLO: &[u8] = include_bytes!("../../../guest/prebuilt/hello.elf");
const LOOPS: &[u8] = include_bytes!("../../../guest/prebuilt/loops.elf");
const MEMOPS: &[u8] = include_bytes!("../../../guest/prebuilt/memops.elf");

/// Run `elf` to completion with the block cache configured by `cache`, returning the retire
/// hash, the retire count, and the outcome. `cache = None` ⇒ OFF; `Some(cap)` ⇒ ON with a
/// `cap`-slot cache.
fn run(elf: &[u8], budget: u64, cache: Option<usize>) -> (u64, u64, RunOutcome) {
    let mut m = Machine::new(128 * 1024 * 1024);
    let console = VecSink::new();
    m.bus_mut()
        .attach(UART0_BASE, UART0_LEN, Box::new(Uart0Stub::new(console)))
        .unwrap();
    m.load_elf(elf).unwrap();
    match cache {
        None => m.set_block_cache(false),
        Some(cap) => {
            m.set_block_cache_capacity(cap);
            m.set_block_cache(true);
        }
    }
    let mut sink = HashSink::new();
    let outcome = m.run_traced(budget, &mut sink);
    (sink.hash(), sink.retired(), outcome)
}

/// Run a raw ELF image (no console) to completion under the given cache config.
fn run_bin(elf: &[u8], budget: u64, cache: Option<usize>) -> (u64, u64, RunOutcome) {
    let mut m = Machine::new(64 * 1024 * 1024);
    m.load_elf(elf).unwrap();
    match cache {
        None => m.set_block_cache(false),
        Some(cap) => {
            m.set_block_cache_capacity(cap);
            m.set_block_cache(true);
        }
    }
    let mut sink = HashSink::new();
    let outcome = m.run_traced(budget, &mut sink);
    (sink.hash(), sink.retired(), outcome)
}

/// The instruction-level gate: run EVERY vendored official riscv-tests ELF (every base/M/A/F/D/C
/// op, branches, CSRs, SFENCE, misaligned + illegal traps) cache-OFF vs cache-ON (big AND
/// 1-entry). Identity must hold for every binary — pass OR fail, since even a "failing" microtest
/// runs deterministically and the cache must not change what it does.
#[test]
fn riscv_tests_cache_on_is_byte_identical() {
    let dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../tests/riscv-tests-bin");
    let mut n_bins = 0u32;
    for entry in std::fs::read_dir(&dir).expect("riscv-tests-bin dir") {
        let path = entry.unwrap().path();
        // Skip the manifest / any non-ELF sidecar.
        if path.extension().is_some() || !path.is_file() {
            continue;
        }
        let elf = std::fs::read(&path).unwrap();
        if elf.get(..4) != Some(b"\x7fELF") {
            continue;
        }
        let name = path.file_name().unwrap().to_string_lossy().into_owned();
        let budget = 5_000_000;
        let off = run_bin(&elf, budget, None);
        let big = run_bin(&elf, budget, Some(1 << 12));
        let one = run_bin(&elf, budget, Some(1));
        assert_eq!(off, big, "{name}: big block cache diverged from legacy");
        assert_eq!(off, one, "{name}: 1-entry block cache diverged from legacy");
        n_bins += 1;
    }
    assert!(
        n_bins > 50,
        "expected the full riscv-tests corpus, saw {n_bins}"
    );
    eprintln!("riscv-tests differential: {n_bins} ELFs byte-identical cache-on vs cache-off");
}

/// The gate: for every guest, cache-ON (big cache AND pathological 1-entry cache) must produce
/// the byte-identical retire hash, retire count, and outcome as cache-OFF.
#[test]
fn cache_on_is_byte_identical_to_cache_off() {
    for (name, elf) in [("hello", HELLO), ("loops", LOOPS), ("memops", MEMOPS)] {
        let (h_off, n_off, o_off) = run(elf, 5_000_000, None);
        // The guest must actually run (a degenerate 0-instruction run would trivially "match").
        assert!(
            n_off > 20,
            "{name}: suspiciously short run ({n_off} retires)"
        );
        eprintln!("{name}: {n_off} retires, outcome {o_off:?}, hash {h_off:#018x}");

        let (h_big, n_big, o_big) = run(elf, 5_000_000, Some(1 << 12));
        assert_eq!(
            (h_off, n_off, &o_off),
            (h_big, n_big, &o_big),
            "{name}: big block cache diverged from the legacy path"
        );

        let (h_one, n_one, o_one) = run(elf, 5_000_000, Some(1));
        assert_eq!(
            (h_off, n_off, &o_off),
            (h_one, n_one, &o_one),
            "{name}: 1-entry (pathological) block cache diverged from the legacy path"
        );
    }
}
