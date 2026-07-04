// E1-T22 golden determinism fingerprints — the frozen native/wasm equality contract.
//
// Each row is (ELF, trace_hash, retired, RAM_sha256_hex, state_hash) captured at RAM_BYTES:
//   trace_hash  = FNV-1a-64 fold of every retire record {pc, insn, rd idx+val, mem} (HashSink);
//   RAM_sha256  = Snapshot mem_digest of all guest RAM after the run;
//   state_hash  = FNV-1a-64 over the final f-registers, fcsr, privilege, and key privileged CSRs
//                 (via `final_state_hash`) — this is what catches an FP result or CSR that
//                 DIVERGES but is never read back into an x-register/memory (the gap the trace
//                 hash alone would miss).
// Asserted IDENTICALLY by crates/core/tests/determinism.rs (native) and
// crates/wasm/tests/determinism.rs (wasm32) — so native == wasm32 transitively. Corpus is
// hazard-prone: i128 (mulh), softfloat (fadd), atomics (amoadd_d), compressed (rvc). Regenerate
// ONLY on an intended, reviewed ISA-semantics change.
pub const RAM_BYTES: usize = 16 * 1024 * 1024;

/// Fold the final f-registers, fcsr, privilege mode, and the key privileged CSRs into an
/// FNV-1a-64. Shared by BOTH harnesses so the folding is bit-identical on native and wasm32.
pub fn final_state_hash(m: &mut wasm_vm_core::Machine) -> u64 {
    let mut h: u64 = 0xcbf2_9ce4_8422_2325;
    let mut fold = |x: u64| {
        h ^= x;
        h = h.wrapping_mul(0x0000_0100_0000_01b3);
    };
    let hart = m.hart_mut();
    for i in 0..32u8 {
        fold(hart.fregs.read_raw(i)); // f-regs: divergent FP bits caught even if never read back
    }
    fold(hart.csr.mode as u64);
    // fcsr(0x003) + M/S trap + satp + counteren + PMP cfg — the guest-visible privileged state.
    for addr in [
        0x003u16, 0x300, 0x305, 0x341, 0x342, 0x343, 0x340, 0x304, 0x344, 0x303, 0x302, 0x180,
        0x306, 0x106, 0x100, 0x105, 0x141, 0x142, 0x143, 0x140, 0x3a0,
    ] {
        fold(hart.csr.read(addr));
    }
    h
}

pub const GOLDEN: &[(&str, u64, u64, &str, u64)] = &[
    ("rv64ui-p-add", 0xdc77255b7cbcc3ac, 511, "c87d99378e4db17475d1de94c0a5df475ee2f7f8ab67f7d5d79c3505633ed053", 0x566697d2667ae2cb),
    ("rv64um-p-mulh", 0x1ace46bfce960f49, 509, "857c1b14158c0f7fc7a008bec55c091473d3cd8276b9a5cd43b3baf99a375e6d", 0x55dfa84c18bd974b),
    ("rv64ua-p-amoadd_d", 0x04eda8ff7b9c807a, 110, "3901238355754db82f527b31008f42f6ff5cd59ed4c4eef344f93b1bd6427bbe", 0x078f93818699373f),
    ("rv64ud-p-fadd", 0x3bb60ebc5c7fab18, 216, "85e6113119db6c9b507e5addaa69da827bf9b0ad4f070b49e07594cd1a48791b", 0xc1e6bc3355fc6807),
    ("rv64uc-p-rvc", 0x0d8f8c3629b0d096, 302, "c132a82b8c28655f41c693407660d34d005a39b3cf3080030525f2b7eb6bc4d0", 0xf1c5a0d7c239917b),
];
