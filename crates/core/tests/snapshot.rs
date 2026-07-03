//! E0-T17: deterministic machine-state snapshot + digest.
//!
//! The digest is meant to be independently recomputable (the verifier's
//! `shasum -a 256` attack), so the known-answer digest below was computed OUTSIDE this
//! crate with Python `hashlib.sha256(bytes(i % 251 for i in range(1<<20)))`.

use wasm_vm_core::Machine;
use wasm_vm_core::bus::mmap::{DRAM_BASE, UART0_BASE, UART0_LEN};
use wasm_vm_core::dev::console::{Uart0Stub, VecSink};
use wasm_vm_core::trace::{TraceRecord, TraceSink};

const MIB: usize = 1024 * 1024;
const LOOPS: &[u8] = include_bytes!("../../../guest/prebuilt/loops.elf");

/// SHA-256 of `bytes(i % 251 for i in range(1 MiB))`, computed independently in Python.
const KAT_1MIB_MOD251: &str = "631b84027d6b9e52b539c4e8373622d23032dfadc64d60af87339c9037e4f769";
/// SHA-256 of 1 MiB of zeros (fresh RAM), computed independently in Python.
const ZERO_1MIB: &str = "30e14955ebf1352266dc2ff8067e68104607e750abb9d3b36582b8af909fcb58";

/// Fill an entire RAM with `byte[i] = i % 251`.
fn seed_mod251(m: &mut Machine, len: usize) {
    let pattern: Vec<u8> = (0..len).map(|i| (i % 251) as u8).collect();
    m.bus_mut()
        .ram_mut()
        .write_slice(DRAM_BASE, &pattern)
        .unwrap();
}

#[test]
fn known_answer_digest_matches_independent_python() {
    // Fresh 1 MiB RAM is all zeros: the digest is the KAT for a zero buffer.
    let mut m = Machine::new(MIB);
    assert_eq!(
        m.snapshot().hex_digest(),
        ZERO_1MIB,
        "fresh 1 MiB RAM must hash to the zero-buffer SHA-256"
    );
    // Seed the mod-251 pattern and match the independently computed digest.
    seed_mod251(&mut m, MIB);
    assert_eq!(
        m.snapshot().hex_digest(),
        KAT_1MIB_MOD251,
        "seeded 1 MiB pattern must hash to the committed known answer"
    );
    // hex_digest and mem_digest agree.
    let snap = m.snapshot();
    let hex: String = snap.mem_digest.iter().map(|b| format!("{b:02x}")).collect();
    assert_eq!(hex, snap.hex_digest());
}

#[test]
fn flipping_any_single_byte_changes_the_digest() {
    let mut m = Machine::new(MIB);
    seed_mod251(&mut m, MIB);
    let base = m.snapshot().mem_digest;

    // Deterministic "random" offsets (no rng dep), explicitly including 0 and size-1 —
    // the boundary offsets a partial-coverage digest (e.g. skipping the last page) misses.
    let mut offsets = vec![0usize, MIB - 1];
    let mut x = 0x1234_5678u32;
    for _ in 0..98 {
        // xorshift — pure, reproducible.
        x ^= x << 13;
        x ^= x >> 17;
        x ^= x << 5;
        offsets.push((x as usize) % MIB);
    }

    for &off in &offsets {
        let addr = DRAM_BASE + off as u64;
        let mut orig = [0u8; 1];
        m.bus_mut().ram_mut().read_slice(addr, &mut orig).unwrap();
        m.bus_mut()
            .ram_mut()
            .write_slice(addr, &[orig[0] ^ 0xFF])
            .unwrap();
        assert_ne!(
            m.snapshot().mem_digest,
            base,
            "flipping byte at offset {off} must change the digest"
        );
        // restore so the next flip is isolated.
        m.bus_mut().ram_mut().write_slice(addr, &orig).unwrap();
        assert_eq!(
            m.snapshot().mem_digest,
            base,
            "restore must return the digest"
        );
    }
}

#[test]
fn poking_the_last_ram_byte_changes_the_digest() {
    // Tail-coverage attack: a digest that only covers loaded ELF segments (not all RAM)
    // would be blind to a write at the very end of memory.
    let mut m = Machine::new(64 * 1024);
    let before = m.snapshot().mem_digest;
    let last = DRAM_BASE + (64 * 1024 - 1);
    m.bus_mut().ram_mut().write_slice(last, &[0xAB]).unwrap();
    assert_ne!(
        m.snapshot().mem_digest,
        before,
        "last RAM byte must be in the digest"
    );
}

#[test]
fn snapshot_is_stable_across_zero_steps() {
    let mut m = Machine::new(MIB);
    seed_mod251(&mut m, MIB);
    m.hart_mut().regs.pc = DRAM_BASE + 0x40;
    m.hart_mut().regs.write(10, 0xDEAD_BEEF);
    let a = m.snapshot();
    let b = m.snapshot();
    assert_eq!(
        a, b,
        "two consecutive snapshots (no steps) must be identical"
    );
    assert_eq!(a.pc, DRAM_BASE + 0x40);
    assert_eq!(a.xregs[10], 0xDEAD_BEEF);
    assert_eq!(a.xregs[0], 0, "x0 image is always zero");
}

/// The full Snapshot of `loops.elf` run to exit in exactly 1 MiB of RAM — the fixed
/// cross-build golden. The wasm32 test (`crates/wasm/tests/snapshot.rs`) asserts the same
/// value, so native and wasm are byte-identical transitively (pc, every xreg, digest).
/// RAM size is pinned to 1 MiB because the digest covers the whole (mostly-zero) buffer.
pub fn loops_1mib_golden() -> (u64, [u64; 32], &'static str) {
    let mut xregs = [0u64; 32];
    xregs[1] = 0x8000_002c;
    xregs[2] = 0x8000_2090;
    xregs[5] = 0x8000_0080;
    xregs[6] = 0x0000_000b;
    xregs[10] = 0x0000_0001;
    (
        0x8000_0040,
        xregs,
        "0a18330cadd810ad35dde591012b6a8d4e6fa3d9d5487d30db12fbadde376a48",
    )
}

#[test]
fn loops_snapshot_is_the_cross_build_golden() {
    let mut m = Machine::new(MIB);
    m.load_elf(LOOPS).unwrap();
    assert_eq!(m.run(1_000_000), wasm_vm_core::RunOutcome::Exited(0));
    let snap = m.snapshot();
    let (pc, xregs, digest) = loops_1mib_golden();
    assert_eq!(snap.pc, pc, "loops final pc drifted");
    assert_eq!(snap.xregs, xregs, "loops final register file drifted");
    assert_eq!(
        snap.hex_digest(),
        digest,
        "loops final memory digest drifted"
    );
}

/// Records into a growable trace, for the purity comparison.
#[derive(Default)]
struct Trace(Vec<TraceRecord>);
impl TraceSink for Trace {
    fn retire(&mut self, r: &TraceRecord) {
        self.0.push(*r);
    }
}

fn fresh_loops() -> Machine {
    let mut m = Machine::new(128 * 1024 * 1024);
    m.bus_mut()
        .attach(
            UART0_BASE,
            UART0_LEN,
            Box::new(Uart0Stub::new(VecSink::new())),
        )
        .unwrap();
    m.load_elf(LOOPS).unwrap();
    m
}

#[test]
fn snapshotting_never_perturbs_execution() {
    // Run loops.elf uninterrupted, tracing every retired instruction.
    let mut clean = fresh_loops();
    let mut clean_trace = Trace::default();
    for _ in 0..100_000 {
        if clean.step_traced(&mut clean_trace).is_err() || clean.htif_exit().is_some() {
            break;
        }
    }
    let clean_final = clean.snapshot();

    // Same run, but snapshot() every 100 steps. Purity ⇒ identical trace AND final state.
    let mut poked = fresh_loops();
    let mut poked_trace = Trace::default();
    let mut n = 0u64;
    for _ in 0..100_000 {
        if poked.step_traced(&mut poked_trace).is_err() || poked.htif_exit().is_some() {
            break;
        }
        n += 1;
        if n.is_multiple_of(100) {
            let _ = poked.snapshot(); // observer must not perturb
        }
    }
    let poked_final = poked.snapshot();

    assert_eq!(
        clean_trace.0.len(),
        poked_trace.0.len(),
        "interleaved snapshots changed the retired-instruction count"
    );
    assert!(
        clean_trace.0 == poked_trace.0,
        "interleaved snapshots perturbed the instruction trace"
    );
    assert_eq!(
        clean_final, poked_final,
        "interleaved snapshots changed the final architectural state"
    );
    assert!(
        clean_trace.0.len() > 10,
        "loops.elf should retire real work"
    );
}
