//! E1-T22 (native side): the native build is deterministic, and its per-program fingerprint
//! matches the frozen golden that the wasm32 harness (`crates/wasm/tests/determinism.rs`) asserts
//! too — so native == wasm32 transitively. The fingerprint is the [`HashSink`] rolling trace hash
//! (every guest-visible retire effect) PLUS the [`Machine::snapshot`] RAM SHA-256 — the two
//! together cover executed effects and final memory. FP/i128/atomics/compressed are exercised by
//! the golden corpus; run-to-run reproducibility over the FULL riscv-tests corpus catches any
//! hidden nondeterminism (container iteration order, uninitialized memory, a stray time source).
#![cfg(not(feature = "zicsr-stub"))]
#![cfg(not(target_arch = "wasm32"))]

use std::path::{Path, PathBuf};

use wasm_vm_core::Machine;
use wasm_vm_core::trace::HashSink;

include!("../../../tests/golden/determinism_golden.rs");

fn bin_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../tests/riscv-tests-bin")
}

/// Run a program and return its determinism fingerprint:
/// (trace hash, retired count, RAM digest, final-state hash over f-regs/fcsr/priv/CSRs).
fn fingerprint(elf: &[u8]) -> (u64, u64, String, u64) {
    let mut m = Machine::new(RAM_BYTES);
    m.load_elf(elf).unwrap();
    let mut hs = HashSink::new();
    let _ = m.run_traced(5_000_000, &mut hs);
    let digest = m.snapshot().hex_digest();
    let state = final_state_hash(&mut m);
    (hs.hash(), hs.retired(), digest, state)
}

/// The pinned hazard-prone corpus fingerprints match the frozen golden. Because the wasm32 harness
/// asserts the SAME constants, this is the native leg of the native==wasm equality proof.
#[test]
fn pinned_fingerprints_match_golden() {
    for (name, hash, retired, digest, state) in GOLDEN {
        let elf = std::fs::read(bin_dir().join(name)).unwrap_or_else(|_| panic!("missing {name}"));
        let (h, r, d, s) = fingerprint(&elf);
        assert_eq!(
            h, *hash,
            "{name}: trace hash drift (an intended ISA change? regenerate golden)"
        );
        assert_eq!(r, *retired, "{name}: retire count drift");
        assert_eq!(d, *digest, "{name}: final RAM digest drift");
        assert_eq!(
            s, *state,
            "{name}: final-state (f-regs/fcsr/CSRs) hash drift"
        );
    }
}

/// Every `-p` test ELF produces a byte-identical fingerprint on two consecutive native runs —
/// the global no-nondeterminism guarantee (HashMap iteration, uninit memory, time sources would
/// all break this). Same build, two runs: any difference is a determinism bug. `#[ignore]` — it
/// runs the whole corpus twice (~4 min), so it is the NIGHTLY/dedicated leg (`--ignored`); the
/// fast `pinned_fingerprints_match_golden` covers per-PR determinism.
#[test]
#[ignore = "full-corpus 2x run; nightly leg via tools/determinism_check.sh --full"]
fn full_corpus_is_run_to_run_reproducible() {
    let dir = bin_dir();
    let mut names: Vec<String> = std::fs::read_dir(&dir)
        .unwrap()
        .filter_map(|e| e.ok().map(|e| e.file_name().to_string_lossy().into_owned()))
        .filter(|n| n.starts_with("rv64") && n.contains("-p-") && !n.contains('.'))
        .collect();
    names.sort();
    assert!(
        names.len() >= 120,
        "expected the full -p corpus, found {}",
        names.len()
    );
    for name in &names {
        let bytes = std::fs::read(Path::new(&dir).join(name)).unwrap();
        let a = fingerprint(&bytes);
        let b = fingerprint(&bytes);
        assert_eq!(
            a, b,
            "{name}: not reproducible across two native runs — a nondeterminism bug"
        );
    }
}

/// The HashSink itself is order- and value-sensitive: a one-bit change in any hashed field (pc,
/// insn, rd index, rd value, mem addr/len/store/value) changes the hash, and None/Some sentinels
/// don't collide. Guards the fingerprint against a hash that silently ignores a divergence.
#[test]
fn hash_sink_distinguishes_every_field() {
    use wasm_vm_core::trace::{MemOp, TraceRecord, TraceSink};
    let base = TraceRecord {
        pc: 0x1000,
        insn: 0x00b3,
        rd: Some((5, 42)),
        mem: None,
    };
    let h = |r: &TraceRecord| {
        let mut s = HashSink::new();
        s.retire(r);
        s.hash()
    };
    let h0 = h(&base);
    let variants = [
        TraceRecord { pc: 0x1004, ..base },
        TraceRecord {
            insn: 0x00b7,
            ..base
        },
        TraceRecord {
            rd: Some((6, 42)),
            ..base
        },
        TraceRecord {
            rd: Some((5, 43)),
            ..base
        },
        TraceRecord { rd: None, ..base },
        TraceRecord {
            rd: Some((0, 0)),
            ..base
        }, // "wrote x0=0" ≠ "no write"
        TraceRecord {
            mem: Some(MemOp {
                addr: 0x2000,
                len: 8,
                is_store: true,
                value: 7,
            }),
            ..base
        },
    ];
    for (i, v) in variants.iter().enumerate() {
        assert_ne!(h(v), h0, "variant {i} collided with the base hash");
    }
    // A load vs a store at the same address/len must differ too.
    let load = TraceRecord {
        mem: Some(MemOp {
            addr: 0x2000,
            len: 8,
            is_store: false,
            value: 0,
        }),
        ..base
    };
    let store = TraceRecord {
        mem: Some(MemOp {
            addr: 0x2000,
            len: 8,
            is_store: true,
            value: 0,
        }),
        ..base
    };
    assert_ne!(
        h(&load),
        h(&store),
        "load and store at the same slot collided"
    );
}
