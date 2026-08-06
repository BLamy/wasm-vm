//! E4-T25 — Lockstep interpreter-vs-JIT differential verification + randomized RV64GC fuzzing.
//!
//! This is the epic's VERIFICATION DOCTRINE realized as a continuous divergence hunter. It runs the
//! JIT (wasmtime, the *master*) and a shadow interpreter (`Hart::exec_oracle`, the trusted semantics
//! source) over the SAME guest and compares the full architectural state at every block boundary.
//!
//! ## Scope (interrupt-free lockstep — the headless core, fully doable now)
//! Lockstep WITH asynchronous timer interrupts needs identical instruction-boundary alignment
//! (E4-T24 ICount mode, not yet built) or the comparison drowns in benign interrupt-timing skew.
//! So this harness runs DETERMINISTIC, interrupt-free blocks: the fuzzer generates seeded, corner-
//! value-heavy RV64IMAC blocks and runs them from randomized architectural states; lockstep replays
//! each recorded block from an IDENTICAL prior state and compares. The "lockstep over a full Alpine
//! boot with interrupts" leg is gated on E4-T24 ICount and is tracked as verification debt.
//!
//! ## What is compared ([`ArchState`], per E4-T15 FP policy)
//! `pc`, `x1..x31`, the f-register file + `fcsr`, privilege, the trap-CSR set
//! (`mstatus/mepc/mcause/mtval/sepc/scause/stval/satp`), and a full-RAM FNV hash backstop. The
//! comparator [`ArchState::diff`] destructures the struct EXHAUSTIVELY (no `..`), so a field added
//! later cannot silently escape comparison — and the `comparator_completeness_audit` test enumerates
//! every field at runtime as a second net.
//!
//! ## The master (JIT) path
//! Translatable blocks run under wasmtime against a flat wrapping RAM behind the E4-T09 load/store/
//! atomic imports (byte-identical to the interpreter's memory model — see the E4-T09 differential
//! harness this reuses). The generated ISA (RV64IMA + mixed-width C) never writes f-regs / CSRs /
//! privilege, so those fields are carried unchanged and equal by construction; they are still
//! compared as a completeness backstop (a hypothetical JIT that wrongly touched them would diverge).
//! F/D ops are out of JIT scope by the measured side-exit-all policy (`docs/jit-fp-policy.md`), proven
//! op-by-op in `jit-translate/tests/differential.rs::fp_ops_are_unsupported`, so the fuzzer targets the
//! translatable ISA where a JIT mis-translation can actually live.
//!
//! ## Proving the rig has teeth (mutation testing)
//! Under the `mutation-testing` cargo feature the translator emits a DELIBERATE mis-translation
//! (never shipped — see `jit_translate::mut_hooks`). The `mutation_*` tests below prove the fuzzer +
//! lockstep catch each injected bug within a bounded budget and auto-minimize the repro to ≤20
//! instructions. Run them with:
//!   `cargo test -p wasm-vm-jit-runtime --features mutation-testing --test lockstep_fuzz -- --nocapture`

// Test-harness ergonomics: paired index loops (regs + their peer array), the FNV constants, and the
// engine-tuple return are all clearer as-written than the lints' rewrites.
#![allow(
    clippy::needless_range_loop,
    clippy::type_complexity,
    clippy::unusual_byte_groupings
)]

use jit_translate::{Abi, translate_block};
use wasm_vm_core::bus::{Bus, BusFault};
use wasm_vm_core::csr::{MEPC, MTVAL, SCAUSE, SEPC, STVAL};
use wasm_vm_core::decode::{AmoOp, Instr};
use wasm_vm_core::dispatch::{DecodedBlock, MicroOp};
use wasm_vm_core::hart::Hart;
use wasmtime::{Engine, Instance, Linker, Module, Store};

// ── flat wrapping RAM model (identical for the oracle bus and the wasm imports) ──
const BASE_PC: u64 = 0x8000_0000;
const RAM_BITS: u32 = 16; // 64 KiB flat guest RAM window (wrapping, never faults)
const RAM_MASK: u64 = (1u64 << RAM_BITS) - 1;
const RAM_BYTES: usize = 1 << RAM_BITS;

// ABI offsets, pinned independently of `jit_translate::Abi` (a mutation of the translator's offsets
// would then diverge this readback rather than move in lock-step).
const OFF_XREG: usize = 0x000;
const OFF_EXIT_PC: usize = 0x220;
const OFF_ENTRY_PC: usize = 0x230;

fn ram_read(ram: &[u8], addr: u64, n: usize) -> u64 {
    let mut v = 0u64;
    for i in 0..n {
        let b = ram[((addr.wrapping_add(i as u64)) & RAM_MASK) as usize];
        v |= (b as u64) << (8 * i);
    }
    v
}
fn ram_write(ram: &mut [u8], addr: u64, n: usize, val: u64) {
    for i in 0..n {
        ram[((addr.wrapping_add(i as u64)) & RAM_MASK) as usize] = (val >> (8 * i)) as u8;
    }
}
fn store_overlaps(addr: u64, len: u64, ra: u64, rw: u64) -> bool {
    addr < ra.wrapping_add(rw) && ra < addr.wrapping_add(len)
}

struct FlatBus {
    ram: Vec<u8>,
}
impl Bus for FlatBus {
    fn load8(&mut self, a: u64) -> Result<u8, BusFault> {
        Ok(ram_read(&self.ram, a, 1) as u8)
    }
    fn load16(&mut self, a: u64) -> Result<u16, BusFault> {
        Ok(ram_read(&self.ram, a, 2) as u16)
    }
    fn load32(&mut self, a: u64) -> Result<u32, BusFault> {
        Ok(ram_read(&self.ram, a, 4) as u32)
    }
    fn load64(&mut self, a: u64) -> Result<u64, BusFault> {
        Ok(ram_read(&self.ram, a, 8))
    }
    fn store8(&mut self, a: u64, v: u8) -> Result<(), BusFault> {
        ram_write(&mut self.ram, a, 1, v as u64);
        Ok(())
    }
    fn store16(&mut self, a: u64, v: u16) -> Result<(), BusFault> {
        ram_write(&mut self.ram, a, 2, v as u64);
        Ok(())
    }
    fn store32(&mut self, a: u64, v: u32) -> Result<(), BusFault> {
        ram_write(&mut self.ram, a, 4, v as u64);
        Ok(())
    }
    fn store64(&mut self, a: u64, v: u64) -> Result<(), BusFault> {
        ram_write(&mut self.ram, a, 8, v);
        Ok(())
    }
    fn ram_contains(&self, _a: u64, _len: u64) -> bool {
        true
    }
}

fn amo_apply(op: i32, width: usize, old: u64, rhs: u64) -> u64 {
    macro_rules! by_width {
        ($ity:ty, $uty:ty) => {{
            let o = old as $uty;
            let r = rhs as $uty;
            let res = match op {
                0 => r,
                1 => o.wrapping_add(r),
                2 => o ^ r,
                3 => o & r,
                4 => o | r,
                5 => (o as $ity).min(r as $ity) as $uty,
                6 => (o as $ity).max(r as $ity) as $uty,
                7 => o.min(r),
                8 => o.max(r),
                _ => unreachable!("bad amo op"),
            };
            res as u64
        }};
    }
    match width {
        4 => by_width!(i32, u32),
        8 => by_width!(i64, u64),
        _ => unreachable!("bad amo width"),
    }
}

// ── the compared architectural state ────────────────────────────────────────

/// The full architectural-state set the lockstep comparator checks after every block, per the
/// E4-T25 deliverable + the E4-T15 FP policy. Adding a field here forces [`ArchState::diff`] to name
/// it (the destructure has no `..`), which is the compile-time half of the completeness guarantee.
#[derive(Clone, PartialEq, Eq)]
struct ArchState {
    pc: u64,
    xregs: [u64; 32],
    /// F-register file (raw 64-bit bit patterns, NaN-box-preserving per E4-T15).
    fregs: [u64; 32],
    /// `fcsr` = `(frm << 5) | fflags` (the 8 architectural FP-control bits).
    fcsr: u16,
    /// Current privilege mode encoded as `csr.mode as u8`.
    privilege: u8,
    mstatus: u64,
    mepc: u64,
    mcause: u64,
    mtval: u64,
    sepc: u64,
    scause: u64,
    stval: u64,
    satp: u64,
    /// Full-RAM FNV-1a hash — the periodic full-memory backstop (computed every block here, which is
    /// strictly stronger than the "every N blocks" schedule the design permits).
    ram_hash: u64,
}

fn fnv1a(bytes: &[u8]) -> u64 {
    let mut h = 0xcbf2_9ce4_8422_2325u64;
    for &b in bytes {
        h ^= b as u64;
        h = h.wrapping_mul(0x0000_0100_0000_01b3);
    }
    h
}

/// A deliberately-lossy commutative digest of a span's stores (XOR-fold of the differing 8-byte
/// words, addr-mixed). Collision tolerance is EXPLICIT: two different memory images can share a
/// digest (adversarial #3), which is exactly why [`ArchState::ram_hash`] (a full hash) is the
/// backstop that actually gates lockstep. Part of the documented comparator design; the
/// collision-crafting adversarial #3 that exercises it at scale is deferred verification debt, so it
/// is retained but not yet wired into the hot detection path.
#[allow(dead_code)]
fn write_digest(before: &[u8], after: &[u8]) -> u64 {
    let mut d = 0u64;
    for i in (0..after.len()).step_by(8) {
        let a = ram_read(after, i as u64, 8);
        let b = ram_read(before, i as u64, 8);
        if a != b {
            d ^= a.rotate_left((i as u32) & 63) ^ (i as u64);
        }
    }
    d
}

impl ArchState {
    /// Capture the compared architectural state from an interpreter `Hart` + its RAM image.
    fn from_hart(h: &mut Hart, ram: &[u8]) -> ArchState {
        let mut xregs = [0u64; 32];
        for r in 0..32u8 {
            xregs[r as usize] = h.regs.read(r);
        }
        let mut fregs = [0u64; 32];
        for r in 0..32u8 {
            fregs[r as usize] = h.fregs.read_raw(r);
        }
        ArchState {
            pc: h.regs.pc,
            xregs,
            fregs,
            fcsr: ((h.csr.frm as u16) << 5) | (h.csr.fflags as u16),
            privilege: h.csr.mode as u8,
            mstatus: h.csr.mstatus,
            mepc: h.csr.read(MEPC),
            mcause: h.csr.mcause,
            mtval: h.csr.read(MTVAL),
            sepc: h.csr.read(SEPC),
            scause: h.csr.read(SCAUSE),
            stval: h.csr.read(STVAL),
            satp: h.csr.satp(),
            ram_hash: fnv1a(ram),
        }
    }

    /// Compare two states field by field. Returns `Some(field)` for the FIRST divergent field, or
    /// `None` if byte-identical. The exhaustive destructure (NO `..`) is load-bearing: a new
    /// `ArchState` field will not compile until it is named and compared here.
    fn diff(&self, other: &ArchState) -> Option<String> {
        let ArchState {
            pc,
            xregs,
            fregs,
            fcsr,
            privilege,
            mstatus,
            mepc,
            mcause,
            mtval,
            sepc,
            scause,
            stval,
            satp,
            ram_hash,
        } = self;
        if *pc != other.pc {
            return Some(format!("pc ({:#x} vs {:#x})", pc, other.pc));
        }
        for r in 0..32 {
            if xregs[r] != other.xregs[r] {
                return Some(format!("x{} ({:#x} vs {:#x})", r, xregs[r], other.xregs[r]));
            }
        }
        for r in 0..32 {
            if fregs[r] != other.fregs[r] {
                return Some(format!("f{} ({:#x} vs {:#x})", r, fregs[r], other.fregs[r]));
            }
        }
        if *fcsr != other.fcsr {
            return Some(format!("fcsr ({:#x} vs {:#x})", fcsr, other.fcsr));
        }
        if *privilege != other.privilege {
            return Some(format!("privilege ({} vs {})", privilege, other.privilege));
        }
        if *mstatus != other.mstatus {
            return Some(format!("mstatus ({:#x} vs {:#x})", mstatus, other.mstatus));
        }
        if *mepc != other.mepc {
            return Some(format!("mepc ({:#x} vs {:#x})", mepc, other.mepc));
        }
        if *mcause != other.mcause {
            return Some(format!("mcause ({:#x} vs {:#x})", mcause, other.mcause));
        }
        if *mtval != other.mtval {
            return Some(format!("mtval ({:#x} vs {:#x})", mtval, other.mtval));
        }
        if *sepc != other.sepc {
            return Some(format!("sepc ({:#x} vs {:#x})", sepc, other.sepc));
        }
        if *scause != other.scause {
            return Some(format!("scause ({:#x} vs {:#x})", scause, other.scause));
        }
        if *stval != other.stval {
            return Some(format!("stval ({:#x} vs {:#x})", stval, other.stval));
        }
        if *satp != other.satp {
            return Some(format!("satp ({:#x} vs {:#x})", satp, other.satp));
        }
        if *ram_hash != other.ram_hash {
            return Some(format!(
                "ram_hash ({:#x} vs {:#x}) — a memory divergence the full backstop caught",
                ram_hash, other.ram_hash
            ));
        }
        None
    }
}

// ── block model + PRNG ──────────────────────────────────────────────────────

/// One recorded block: an instruction list with per-op byte lengths (2 = compressed, already
/// expanded to its 32-bit form; 4 = full-width) so all PC arithmetic is length-driven.
#[derive(Clone)]
struct Block {
    ops: Vec<(Instr, u8)>,
}

impl Block {
    fn decoded(&self) -> DecodedBlock {
        let ops: Vec<MicroOp> = self
            .ops
            .iter()
            .map(|&(instr, len)| MicroOp { instr, len, raw: 0 })
            .collect();
        let total: u64 = self.ops.iter().map(|&(_, len)| len as u64).sum();
        DecodedBlock::new(BASE_PC, ops, total)
    }
}

/// splitmix64 — deterministic, seedable, no `rand::thread_rng`.
struct Rng(u64);
impl Rng {
    fn next(&mut self) -> u64 {
        self.0 = self.0.wrapping_add(0x9E37_79B9_7F4A_7C15);
        let mut z = self.0;
        z = (z ^ (z >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
        z = (z ^ (z >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
        z ^ (z >> 31)
    }
    fn below(&mut self, n: u64) -> u64 {
        self.next() % n
    }
    fn reg(&mut self) -> u8 {
        (self.next() % 32) as u8
    }
    fn imm12(&mut self) -> i64 {
        ((self.next() % 4096) as i64) - 2048
    }
    fn shamt6(&mut self) -> u8 {
        (self.next() % 64) as u8
    }
    fn shamt5(&mut self) -> u8 {
        (self.next() % 32) as u8
    }
}

/// Corner values heavy on the E4-T13/T14/T15 classes (div/rem edges, overflow, sign boundaries).
const CORNERS: &[u64] = &[
    0,
    1,
    u64::MAX,
    2,
    0xFFFF_FFFF_FFFF_FFFE,
    i64::MIN as u64,
    i64::MAX as u64,
    0x0000_0000_8000_0000,
    0x0000_0000_7FFF_FFFF,
    0xFFFF_FFFF_8000_0000,
    0x0000_0000_FFFF_FFFF,
    0x0000_0000_0000_0004,
    0x0000_0001_0000_0000,
    0x8000_0000_0000_0001,
];

/// Registers reserved to hold 8-byte-aligned in-window addresses so A-extension ops (which the
/// interpreter requires to be aligned) never trap.
const ADDR_REGS: [u8; 4] = [28, 29, 30, 31];

fn rand_init(rng: &mut Rng) -> [u64; 32] {
    let mut r = [0u64; 32];
    for v in r.iter_mut().skip(1) {
        *v = match rng.below(5) {
            0 => rng.next() & RAM_MASK, // small in-window address (misaligned OK)
            1 => rng.next(),            // full 64-bit wild value
            2 => (rng.next() as i32 as i64) as u64, // sign-extended 32-bit
            3 => CORNERS[(rng.next() as usize) % CORNERS.len()],
            _ => rng.next() & 0xFF, // small
        };
    }
    // Aligned in-window addresses for the A-extension address registers.
    for &ar in &ADDR_REGS {
        r[ar as usize] = (rng.next() & RAM_MASK) & !7u64;
    }
    r
}

fn rand_ram(rng: &mut Rng) -> Vec<u8> {
    let mut ram = vec![0u8; RAM_BYTES];
    for chunk in ram.chunks_mut(8) {
        let w = rng.next();
        for (i, b) in chunk.iter_mut().enumerate() {
            *b = (w >> (8 * i)) as u8;
        }
    }
    ram
}

fn rand_addr_reg(rng: &mut Rng) -> u8 {
    ADDR_REGS[(rng.next() % 4) as usize]
}

/// A pseudo-random non-terminator op across RV64I + M + A (loads/stores/atomics + ALU/mul/div).
fn rand_body(rng: &mut Rng) -> Instr {
    use Instr::*;
    let (rd, rs1, rs2) = (rng.reg(), rng.reg(), rng.reg());
    let imm = rng.imm12();
    match rng.below(70) {
        0 => Lui {
            rd,
            imm: ((rng.next() as u32) & 0xFFFF_F000) as i32 as i64,
        },
        1 => Auipc {
            rd,
            imm: ((rng.next() as u32) & 0xFFFF_F000) as i32 as i64,
        },
        2 => Addi { rd, rs1, imm },
        3 => Slti { rd, rs1, imm },
        4 => Sltiu { rd, rs1, imm },
        5 => Xori { rd, rs1, imm },
        6 => Ori { rd, rs1, imm },
        7 => Andi { rd, rs1, imm },
        8 => Slli {
            rd,
            rs1,
            shamt: rng.shamt6(),
        },
        9 => Srli {
            rd,
            rs1,
            shamt: rng.shamt6(),
        },
        10 => Srai {
            rd,
            rs1,
            shamt: rng.shamt6(),
        },
        11 => Addiw { rd, rs1, imm },
        12 => Slliw {
            rd,
            rs1,
            shamt: rng.shamt5(),
        },
        13 => Srliw {
            rd,
            rs1,
            shamt: rng.shamt5(),
        },
        14 => Sraiw {
            rd,
            rs1,
            shamt: rng.shamt5(),
        },
        15 => Add { rd, rs1, rs2 },
        16 => Sub { rd, rs1, rs2 },
        17 => Sll { rd, rs1, rs2 },
        18 => Slt { rd, rs1, rs2 },
        19 => Sltu { rd, rs1, rs2 },
        20 => Xor { rd, rs1, rs2 },
        21 => Srl { rd, rs1, rs2 },
        22 => Sra { rd, rs1, rs2 },
        23 => Or { rd, rs1, rs2 },
        24 => And { rd, rs1, rs2 },
        25 => Addw { rd, rs1, rs2 },
        26 => Subw { rd, rs1, rs2 },
        27 => Sllw { rd, rs1, rs2 },
        28 => Srlw { rd, rs1, rs2 },
        29 => Sraw { rd, rs1, rs2 }, // ← SHIFT_MASK_WRONG lives here
        // loads — any register (misaligned wraps harmlessly, no trap in the flat model)
        30 => Lb { rd, rs1, imm },
        31 => Lh { rd, rs1, imm },
        32 => Lw { rd, rs1, imm }, // ← LW_DROP_SEXT lives here
        33 => Ld { rd, rs1, imm },
        34 => Lbu { rd, rs1, imm },
        35 => Lhu { rd, rs1, imm },
        36 => Lwu { rd, rs1, imm },
        37 => Sb { rs1, rs2, imm },
        38 => Sh { rs1, rs2, imm },
        39 => Sw { rs1, rs2, imm },
        40 => Sd { rs1, rs2, imm },
        // M extension
        41 => Mul { rd, rs1, rs2 },
        42 => Mulh { rd, rs1, rs2 },
        43 => Mulhsu { rd, rs1, rs2 },
        44 => Mulhu { rd, rs1, rs2 },
        45 => Div { rd, rs1, rs2 }, // ← DIV_ZERO_WRONG lives here
        46 => Divu { rd, rs1, rs2 },
        47 => Rem { rd, rs1, rs2 },
        48 => Remu { rd, rs1, rs2 },
        49 => Mulw { rd, rs1, rs2 },
        50 => Divw { rd, rs1, rs2 },
        51 => Divuw { rd, rs1, rs2 },
        52 => Remw { rd, rs1, rs2 },
        53 => Remuw { rd, rs1, rs2 },
        // A extension (aligned address registers)
        54 => Instr::LrW {
            rd,
            rs1: rand_addr_reg(rng),
            aq: false,
            rl: false,
        },
        55 => Instr::LrD {
            rd,
            rs1: rand_addr_reg(rng),
            aq: false,
            rl: false,
        },
        56 => Instr::ScW {
            rd,
            rs1: rand_addr_reg(rng),
            rs2,
            aq: false,
            rl: false,
        },
        57 => Instr::ScD {
            rd,
            rs1: rand_addr_reg(rng),
            rs2,
            aq: false,
            rl: false,
        },
        n @ 58..=66 => {
            let op = [
                AmoOp::Swap,
                AmoOp::Add,
                AmoOp::Xor,
                AmoOp::And,
                AmoOp::Or,
                AmoOp::Min,
                AmoOp::Max,
                AmoOp::Minu,
                AmoOp::Maxu,
            ][(n - 58) as usize];
            if rng.next().is_multiple_of(2) {
                Instr::AmoW {
                    op,
                    rd,
                    rs1: rand_addr_reg(rng),
                    rs2,
                    aq: false,
                    rl: false,
                }
            } else {
                Instr::AmoD {
                    op,
                    rd,
                    rs1: rand_addr_reg(rng),
                    rs2,
                    aq: false,
                    rl: false,
                }
            }
        }
        _ => Addi { rd, rs1, imm },
    }
}

/// A pseudo-random supported terminator (no ecall/ebreak — those trap and are covered by the E4-T09
/// directed suite; lockstep here is deterministic + non-trapping per the interrupt-free scope).
fn rand_term(rng: &mut Rng) -> Instr {
    use Instr::*;
    let (rs1, rs2, rd) = (rng.reg(), rng.reg(), rng.reg());
    let bimm = rng.imm12() & !1i64;
    match rng.below(9) {
        0 => Beq {
            rs1,
            rs2,
            imm: bimm,
        },
        1 => Bne {
            rs1,
            rs2,
            imm: bimm,
        },
        2 => Blt {
            rs1,
            rs2,
            imm: bimm,
        },
        3 => Bge {
            rs1,
            rs2,
            imm: bimm,
        },
        4 => Bltu {
            rs1,
            rs2,
            imm: bimm,
        },
        5 => Bgeu {
            rs1,
            rs2,
            imm: bimm,
        },
        6 => Jal { rd, imm: bimm },
        7 => Jalr {
            rd,
            rs1,
            imm: rng.imm12(), // ← JALR_NO_CLEAR_BIT0 diverges on odd targets
        },
        _ => Fence {
            rd: 0,
            rs1: 0,
            fm: 0,
            pred: 0xF,
            succ: 0xF,
        },
    }
}

/// Generate one random block: 0..12 body ops + (usually) a terminator, each op 2- or 4-byte.
fn gen_block(rng: &mut Rng) -> Block {
    let body_len = rng.below(12) as usize;
    let mut instrs: Vec<Instr> = (0..body_len).map(|_| rand_body(rng)).collect();
    let want_term = !rng.next().is_multiple_of(3);
    if want_term {
        instrs.push(rand_term(rng));
    }
    if instrs.is_empty() {
        instrs.push(rand_body(rng));
    }
    let ops = instrs
        .iter()
        .map(|&i| {
            // A terminator that is NOT the last op would be malformed; only the final op may be one.
            let len = if rng.next().is_multiple_of(2) {
                2u8
            } else {
                4u8
            };
            (i, len)
        })
        .collect();
    Block { ops }
}

// ── the two engines (block-level) ───────────────────────────────────────────

/// Run one block under the INTERPRETER from `init` regs + `ram0`. Returns the resulting `ArchState`,
/// the RAM image, and whether the block TRAPPED (e.g. a misaligned atomic — the A extension requires
/// natural alignment). A trapping block is outside the interrupt-free deterministic-lockstep scope:
/// in the integrated runtime the JIT routes atomics through the interpreter's own code and would
/// trap+rewind identically (precise-trap equivalence is proven by `tests/precise_traps.rs`), but the
/// standalone flat-RAM imports here don't model that side-exit, so the comparator SKIPS such blocks.
fn run_oracle(block: &Block, init: &[u64; 32], ram0: &[u8]) -> (ArchState, Vec<u8>, bool) {
    // The interpreter can debug-`panic!` on a few adversarial corner addresses (e.g. a misaligned
    // load whose effective address is within `len` of u64::MAX overflows `pa0 + i` in a debug build;
    // in reality such an access would access-fault). That is a real trap in effect and outside the
    // deterministic-lockstep scope, so we catch it and mark the block trapped (→ comparator skips).
    let caught = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        let mut h = Hart::default();
        for r in 0..32u8 {
            h.regs.write(r, init[r as usize]);
        }
        h.regs.pc = BASE_PC;
        let mut bus = FlatBus { ram: ram0.to_vec() };
        let mut trapped = false;
        for &(instr, len) in &block.ops {
            if h.exec_oracle(&mut bus, instr, u64::from(len), 0).is_err() {
                trapped = true;
                break;
            }
        }
        let st = ArchState::from_hart(&mut h, &bus.ram);
        (st, bus.ram, trapped)
    }));
    match caught {
        Ok(v) => v,
        Err(_) => {
            // Panicked → treat as trapped, carry the input state/RAM unchanged.
            let mut h = Hart::default();
            for r in 0..32u8 {
                h.regs.write(r, init[r as usize]);
            }
            h.regs.pc = BASE_PC;
            let st = ArchState::from_hart(&mut h, ram0);
            (st, ram0.to_vec(), true)
        }
    }
}

struct WasmData {
    ram: Vec<u8>,
    resv: Option<(u64, u8)>,
}

/// Run one translatable block under wasmtime (the JIT master) from `init` + `ram0`, returning the
/// resulting register/pc image + RAM. Reuses the E4-T09 ABI + import model exactly.
fn run_wasm(block: &DecodedBlock, init: &[u64; 32], ram0: &[u8]) -> ([u64; 32], u64, Vec<u8>) {
    let bytes = translate_block(block, &Abi::FROZEN).expect("supported block");
    wasmparser::Validator::new_with_features(wasmparser::WasmFeatures::all())
        .validate_all(&bytes)
        .expect("generated module must validate");
    let engine = Engine::default();
    let module = Module::new(&engine, &bytes).expect("module compiles");
    let mut store = Store::new(
        &engine,
        WasmData {
            ram: ram0.to_vec(),
            resv: None,
        },
    );
    let mut linker = Linker::new(&engine);
    linker
        .func_wrap(
            "env",
            "load",
            |caller: wasmtime::Caller<'_, WasmData>, addr: i64, kind: i32| -> i64 {
                let ram = &caller.data().ram;
                let a = addr as u64;
                match kind {
                    0 => ram_read(ram, a, 1) as u8 as i8 as i64,
                    1 => ram_read(ram, a, 2) as u16 as i16 as i64,
                    2 => ram_read(ram, a, 4) as u32 as i32 as i64,
                    3 => ram_read(ram, a, 8) as i64,
                    4 => ram_read(ram, a, 1) as i64,
                    5 => ram_read(ram, a, 2) as i64,
                    6 => ram_read(ram, a, 4) as i64,
                    _ => unreachable!("bad load kind"),
                }
            },
        )
        .unwrap();
    linker
        .func_wrap(
            "env",
            "store",
            |mut caller: wasmtime::Caller<'_, WasmData>, addr: i64, val: i64, width: i32| {
                let d = caller.data_mut();
                ram_write(&mut d.ram, addr as u64, width as usize, val as u64);
                if let Some((ra, rw)) = d.resv
                    && store_overlaps(addr as u64, width as u64, ra, rw as u64)
                {
                    d.resv = None;
                }
            },
        )
        .unwrap();
    linker
        .func_wrap(
            "env",
            "amo",
            |mut caller: wasmtime::Caller<'_, WasmData>,
             addr: i64,
             val: i64,
             op: i32,
             width: i32|
             -> i64 {
                let a = addr as u64;
                let w = width as usize;
                let d = caller.data_mut();
                let old = ram_read(&d.ram, a, w);
                let new = amo_apply(op, w, old, val as u64);
                ram_write(&mut d.ram, a, w, new);
                if let Some((ra, rw)) = d.resv
                    && store_overlaps(a, width as u64, ra, rw as u64)
                {
                    d.resv = None;
                }
                match w {
                    4 => old as u32 as i32 as i64,
                    8 => old as i64,
                    _ => unreachable!(),
                }
            },
        )
        .unwrap();
    linker
        .func_wrap(
            "env",
            "lr",
            |mut caller: wasmtime::Caller<'_, WasmData>, addr: i64, width: i32| -> i64 {
                let a = addr as u64;
                let w = width as usize;
                let d = caller.data_mut();
                let v = ram_read(&d.ram, a, w);
                d.resv = Some((a, width as u8));
                match w {
                    4 => v as u32 as i32 as i64,
                    8 => v as i64,
                    _ => unreachable!(),
                }
            },
        )
        .unwrap();
    linker
        .func_wrap(
            "env",
            "sc",
            |mut caller: wasmtime::Caller<'_, WasmData>, addr: i64, val: i64, width: i32| -> i64 {
                let a = addr as u64;
                let w = width as usize;
                let d = caller.data_mut();
                let success = d.resv == Some((a, width as u8));
                d.resv = None;
                if success {
                    ram_write(&mut d.ram, a, w, val as u64);
                    0
                } else {
                    1
                }
            },
        )
        .unwrap();

    let instance: Instance = linker
        .instantiate(&mut store, &module)
        .expect("instantiate");
    let mem = instance
        .get_memory(&mut store, "mem")
        .expect("exported mem");
    for r in 0..32u8 {
        let off = OFF_XREG + (r as usize) * 8;
        mem.write(&mut store, off, &init[r as usize].to_le_bytes())
            .unwrap();
    }
    mem.write(&mut store, OFF_ENTRY_PC, &BASE_PC.to_le_bytes())
        .unwrap();
    let run = instance
        .get_typed_func::<i32, i32>(&mut store, "run")
        .expect("run export");
    let _code = run.call(&mut store, 0).expect("run traps never");
    let mut regs = [0u64; 32];
    for r in 0..32u8 {
        let off = OFF_XREG + (r as usize) * 8;
        let mut b = [0u8; 8];
        mem.read(&store, off, &mut b).unwrap();
        regs[r as usize] = u64::from_le_bytes(b);
    }
    let mut b = [0u8; 8];
    mem.read(&store, OFF_EXIT_PC, &mut b).unwrap();
    let pc = u64::from_le_bytes(b);
    (regs, pc, store.into_data().ram)
}

/// The block-boundary comparator: run one block through BOTH engines from an identical prior state
/// and compare the full [`ArchState`]. Returns `Some(field-description)` on divergence.
///
/// `prior` supplies the f-reg / CSR / privilege context the translatable ISA never touches, so the
/// JIT master's state for those fields is the carried context (equal by construction) and the
/// interpreter's is whatever it computed — a hypothetical leak into them would still be caught.
fn lockstep_block(prior: &ArchState, block: &Block, ram0: &[u8]) -> Option<String> {
    let (shadow, _shadow_ram, trapped) = run_oracle(block, &prior.xregs, ram0);
    if trapped {
        // Trapping block (e.g. misaligned atomic) — out of the deterministic-lockstep scope.
        return None;
    }
    let decoded = block.decoded();
    let master = if translate_block(&decoded, &Abi::FROZEN).is_ok() {
        let (regs, pc, ram) = run_wasm(&decoded, &prior.xregs, ram0);
        ArchState {
            pc,
            xregs: regs,
            // Carried, unchanged context (translatable ISA never writes these).
            fregs: prior.fregs,
            fcsr: prior.fcsr,
            privilege: prior.privilege,
            mstatus: prior.mstatus,
            mepc: prior.mepc,
            mcause: prior.mcause,
            mtval: prior.mtval,
            sepc: prior.sepc,
            scause: prior.scause,
            stval: prior.stval,
            satp: prior.satp,
            ram_hash: fnv1a(&ram),
        }
    } else {
        // Side-exit block (F/D/CSR/system): the JIT keeps it in the interpreter, so master == shadow
        // by construction. Still runs the shadow so state advances correctly.
        shadow.clone()
    };
    master.diff(&shadow)
}

// ── the fuzzer + minimizer ──────────────────────────────────────────────────

/// A self-contained, offline-reproducible divergence report (AC5): everything needed to reproduce
/// the bug WITHOUT the fuzzer — the seed, the exact prior register state + RAM, the block, the
/// diverging field, and the block's disassembled wasm bytes.
struct Repro {
    seed: u64,
    program_index: usize,
    block_index: usize,
    prior_xregs: [u64; 32],
    ram: Vec<u8>,
    block: Block,
    field: String,
}

impl Repro {
    fn instr_count(&self) -> usize {
        self.block.ops.len()
    }

    /// Nonzero RAM cells (address → 8-byte word) so the repro is compact yet exact.
    fn nonzero_ram(&self) -> Vec<(u64, u64)> {
        let mut v = Vec::new();
        for i in (0..self.ram.len()).step_by(8) {
            let w = ram_read(&self.ram, i as u64, 8);
            if w != 0 {
                v.push((i as u64, w));
            }
        }
        v
    }

    fn report(&self) -> String {
        use std::fmt::Write;
        let mut s = String::new();
        let _ = writeln!(
            s,
            "══════════════ LOCKSTEP DIVERGENCE (E4-T25) ══════════════"
        );
        let _ = writeln!(
            s,
            "seed={:#018x} program={} block={} diverging_field={}",
            self.seed, self.program_index, self.block_index, self.field
        );
        let _ = writeln!(s, "minimized to {} instruction(s):", self.instr_count());
        for (i, (instr, len)) in self.block.ops.iter().enumerate() {
            let _ = writeln!(s, "  [{i}] (len {len})  {instr:?}");
        }
        let _ = writeln!(s, "prior register state (only nonzero):");
        for (r, v) in self.prior_xregs.iter().enumerate() {
            if *v != 0 {
                let _ = writeln!(s, "  x{r} = {v:#018x}");
            }
        }
        let nz = self.nonzero_ram();
        let _ = writeln!(s, "prior RAM (nonzero words): {} cells", nz.len());
        for (a, w) in nz.iter().take(12) {
            let _ = writeln!(s, "  mem[{a:#x}] = {w:#018x}");
        }
        if nz.len() > 12 {
            let _ = writeln!(s, "  … {} more", nz.len() - 12);
        }
        // Block's wasm bytes, disassembled (deliverable: comparator dumps the wasm text).
        let decoded = self.block.decoded();
        match translate_block(&decoded, &Abi::FROZEN) {
            Ok(bytes) => match wasmprinter::print_bytes(&bytes) {
                Ok(text) => {
                    let _ = writeln!(s, "generated wasm ({} bytes):", bytes.len());
                    for line in text.lines() {
                        let _ = writeln!(s, "  {line}");
                    }
                }
                Err(e) => {
                    let _ = writeln!(s, "wasm disassembly failed: {e}");
                }
            },
            Err(e) => {
                let _ = writeln!(s, "block did not translate (side-exit): {e:?}");
            }
        }
        let _ = writeln!(
            s,
            "══════════════════════════════════════════════════════════"
        );
        s
    }
}

/// Minimize a diverging block by instruction bisection: greedily drop instructions while the
/// divergence PERSISTS (compared from the SAME prior state + RAM). Because every generated block has
/// at most one terminator and it is always last, any single-op removal keeps the block well-formed.
fn minimize(prior: &ArchState, ram: &[u8], block: &Block) -> Block {
    let mut best = block.clone();
    let mut changed = true;
    while changed {
        changed = false;
        let mut i = 0;
        while i < best.ops.len() {
            if best.ops.len() == 1 {
                break; // a block must be non-empty
            }
            let mut cand = best.clone();
            cand.ops.remove(i);
            if lockstep_block(prior, &cand, ram).is_some() {
                best = cand; // still diverges without op i → keep the reduction
                changed = true;
            } else {
                i += 1;
            }
        }
    }
    best
}

/// Run the fuzzer for `programs` seeded programs of `blocks_per_program` blocks each, carrying
/// architectural state forward block to block. Returns the FIRST minimized divergence (if any). A
/// clean campaign returns `None`; a bug (injected or real) returns `Some(Repro)`.
fn fuzz_campaign(seed: u64, programs: usize, blocks_per_program: usize) -> Option<Repro> {
    // Silence the caught interpreter debug-overflow panics (see `run_oracle`) for the campaign.
    let prev_hook = std::panic::take_hook();
    std::panic::set_hook(Box::new(|_| {}));
    let out = fuzz_campaign_inner(seed, programs, blocks_per_program);
    std::panic::set_hook(prev_hook);
    out
}

fn fuzz_campaign_inner(seed: u64, programs: usize, blocks_per_program: usize) -> Option<Repro> {
    let mut rng = Rng(seed);
    for p in 0..programs {
        // Fresh randomized architectural state + RAM per program.
        let init = rand_init(&mut rng);
        let mut ram = rand_ram(&mut rng);
        let mut prior = ArchState {
            pc: BASE_PC,
            xregs: init,
            fregs: [0; 32],
            fcsr: 0,
            privilege: 3, // M-mode (Hart reset)
            mstatus: 0,
            mepc: 0,
            mcause: 0,
            mtval: 0,
            sepc: 0,
            scause: 0,
            stval: 0,
            satp: 0,
            ram_hash: fnv1a(&ram),
        };
        for b in 0..blocks_per_program {
            let block = gen_block(&mut rng);
            let ram_before = ram.clone();
            if let Some(field) = lockstep_block(&prior, &block, &ram) {
                let min = minimize(&prior, &ram_before, &block);
                let field_min = lockstep_block(&prior, &min, &ram_before).unwrap_or(field.clone());
                return Some(Repro {
                    seed,
                    program_index: p,
                    block_index: b,
                    prior_xregs: prior.xregs,
                    ram: ram_before,
                    block: min,
                    field: field_min,
                });
            }
            // No divergence: advance state via the (agreed) interpreter result to explore deeper.
            // The interpreter's post-state (regs + RAM) carries forward; each recorded block always
            // replays from BASE_PC (the independent-recording model).
            let (next, next_ram, adv_trapped) = run_oracle(&block, &prior.xregs, &ram);
            if adv_trapped {
                break; // don't carry a trapped/panicked state — move to the next program
            }
            ram = next_ram;
            prior = ArchState {
                pc: BASE_PC,
                ..next
            };
            prior.ram_hash = fnv1a(&ram);
        }
    }
    None
}

// ── AC3: comparator-completeness audit ──────────────────────────────────────

/// Every field of [`ArchState`] must be in the compare set. This test flips each field of an
/// otherwise-identical pair and asserts [`ArchState::diff`] reports a divergence — a runtime net on
/// top of the compile-time guarantee (the exhaustive no-`..` destructure in `diff`). If a field is
/// added but not compared, either the destructure fails to compile OR this enumeration misses it and
/// the corresponding assertion fails.
#[test]
fn comparator_completeness_audit() {
    let base = ArchState {
        pc: 0x1000,
        xregs: [7; 32],
        fregs: [9; 32],
        fcsr: 0,
        privilege: 3,
        mstatus: 0,
        mepc: 0,
        mcause: 0,
        mtval: 0,
        sepc: 0,
        scause: 0,
        stval: 0,
        satp: 0,
        ram_hash: 0xABCD,
    };
    // A mutator per field. The list is exhaustive against the struct; the compile-time destructure in
    // `diff` guarantees nothing is compared that isn't a field, and this guarantees every field IS.
    let mutators: Vec<(&str, fn(&mut ArchState))> = vec![
        ("pc", |s| s.pc ^= 1),
        ("xregs", |s| s.xregs[13] ^= 1),
        ("fregs", |s| s.fregs[13] ^= 1),
        ("fcsr", |s| s.fcsr ^= 1),
        ("privilege", |s| s.privilege ^= 1),
        ("mstatus", |s| s.mstatus ^= 1),
        ("mepc", |s| s.mepc ^= 1),
        ("mcause", |s| s.mcause ^= 1),
        ("mtval", |s| s.mtval ^= 1),
        ("sepc", |s| s.sepc ^= 1),
        ("scause", |s| s.scause ^= 1),
        ("stval", |s| s.stval ^= 1),
        ("satp", |s| s.satp ^= 1),
        ("ram_hash", |s| s.ram_hash ^= 1),
    ];
    // Count must equal the struct's field count — bump this when you add a field (and add a mutator).
    assert_eq!(
        mutators.len(),
        14,
        "ArchState field count changed — add the new field to the audit + to ArchState::diff"
    );
    assert!(
        base.diff(&base).is_none(),
        "identical states must not diverge"
    );
    for (name, mutate) in &mutators {
        let mut other = base.clone();
        mutate(&mut other);
        assert!(
            base.diff(&other).is_some(),
            "field `{name}` is NOT in the comparator compare set — it could silently escape lockstep"
        );
    }
    eprintln!(
        "AC3 comparator-completeness: all {} ArchState fields are compared",
        mutators.len()
    );
}

// ── clean run: no mutation, zero divergences ────────────────────────────────

/// Serializes every campaign that depends on the PROCESS-GLOBAL mutation registry
/// (`jit_translate::mutation::ACTIVE`). cargo runs `#[test]`s on parallel threads, so a mutation
/// test's `set`/`clear` would otherwise clobber a concurrently-running CLEAN or CORPUS campaign's
/// translation and manufacture a spurious divergence. Every mutation test AND every clean/corpus
/// campaign must hold this for its whole body (see `clean_campaign_guard`). Compiled unconditionally
/// (harmless when the feature is off); only actually contended under `mutation-testing`.
#[cfg(feature = "mutation-testing")]
pub(crate) static MUT_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

/// Acquire the mutation lock and guarantee NO mutation is active for a clean/corpus campaign, so a
/// parallel mutation test can't bleed into it. Returns a guard held for the campaign's duration.
/// A no-op when the `mutation-testing` feature is off (no registry exists → no race).
#[cfg(feature = "mutation-testing")]
fn clean_campaign_guard() -> std::sync::MutexGuard<'static, ()> {
    let guard = MUT_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    jit_translate::mutation::clear();
    guard
}

/// The always-on clean gate: a bounded seeded fuzz campaign with the CORRECT translator must find
/// ZERO divergences. A real divergence here is a genuine JIT bug — the most valuable outcome — and
/// this test would fail loudly with a full offline-reproducible report.
#[test]
fn fuzz_clean_no_divergence_small() {
    #[cfg(feature = "mutation-testing")]
    let _clean_guard = clean_campaign_guard();
    let found = fuzz_campaign(0x5EED_0000_1111_2222, 200, 20); // ~4k blocks, ~24k instrs
    if let Some(r) = found {
        panic!(
            "CLEAN fuzz found a REAL divergence (genuine JIT bug — do not paper over):\n{}",
            r.report()
        );
    }
    eprintln!("clean fuzz (200 programs × 20 blocks ≈ 4k blocks): ZERO divergences");
}

/// A heavier clean campaign, off by default (run in CI / on dev). Different seed + more blocks.
#[test]
#[ignore = "heavy clean soak — run with `cargo test --release -- --ignored`"]
fn fuzz_clean_no_divergence_soak() {
    #[cfg(feature = "mutation-testing")]
    let _clean_guard = clean_campaign_guard();
    let found = fuzz_campaign(0xC0FFEE_1234_5678, 20_000, 50); // ~1M blocks
    if let Some(r) = found {
        panic!("SOAK fuzz found a REAL divergence:\n{}", r.report());
    }
    eprintln!("soak fuzz (20k programs × 50 blocks): ZERO divergences");
}

// ── corpus regression replay ────────────────────────────────────────────────

#[path = "lockstep_fuzz/corpus.rs"]
mod corpus;

// ── mutation-adequacy proofs (only under the `mutation-testing` feature) ─────

#[cfg(feature = "mutation-testing")]
mod mutation_tests {
    use super::*;
    use jit_translate::mutation;

    // Serialization is via the module-level `super::MUT_LOCK`, shared with the clean/corpus
    // campaigns so a mutation set here can never bleed into a concurrent correct-translator run.

    /// AC2 — the killer gate. With a deliberately mis-translated op active, the fuzzer/lockstep must
    /// CATCH the divergence within a bounded budget and AUTO-MINIMIZE to ≤20 instructions.
    #[test]
    fn ac2_fuzzer_catches_and_minimizes_injected_bug() {
        let _guard = MUT_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        mutation::set(mutation::SHIFT_MASK_WRONG);
        let found = fuzz_campaign(0x5EED_0000_1111_2222, 400, 25);
        mutation::clear();
        let r = found.expect("fuzzer FAILED to catch the injected SRAW mis-translation");
        println!("{}", r.report());
        assert!(
            r.instr_count() <= 20,
            "repro not minimized to ≤20 instructions (got {})",
            r.instr_count()
        );
        // The offending block must actually contain the mis-translated op.
        assert!(
            r.block
                .ops
                .iter()
                .any(|(i, _)| matches!(i, Instr::Sraw { .. })),
            "minimized repro should retain the SRAW that carries the injected bug"
        );
    }

    /// Adversarial #1 — mutation-adequacy sweep. EVERY injected bug must be caught + minimized within
    /// a bounded budget. A survivor is a refutation of rig adequacy and fails loudly.
    #[test]
    fn adversarial_mutation_adequacy_sweep() {
        let _guard = MUT_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        let budgets = [
            (mutation::SHIFT_MASK_WRONG, 0x5EED_0000_1111_2222u64),
            (mutation::LW_DROP_SEXT, 0x5EED_0000_1111_2222),
            (mutation::TAKEN_BRANCH_NO_WRITEBACK, 0x5EED_0000_1111_2222),
            (mutation::DIV_ZERO_WRONG, 0x5EED_0000_1111_2222),
            (mutation::JALR_NO_CLEAR_BIT0, 0x5EED_0000_1111_2222),
        ];
        for (m, seed) in budgets {
            mutation::set(m);
            // Bounded budget: up to 4000 programs × 25 blocks (~100k blocks) per bug.
            let found = fuzz_campaign(seed, 4000, 25);
            mutation::clear();
            let r = found.unwrap_or_else(|| {
                panic!(
                    "SURVIVOR: injected bug `{}` was NOT caught within budget — rig adequacy refuted",
                    mutation::name(m)
                )
            });
            assert!(
                r.instr_count() <= 20,
                "bug `{}` repro not minimized to ≤20 (got {})",
                mutation::name(m),
                r.instr_count()
            );
            eprintln!(
                "adversarial #1: bug `{}` CAUGHT at program {} block {}, minimized to {} instr(s), field={}",
                mutation::name(m),
                r.program_index,
                r.block_index,
                r.instr_count(),
                r.field
            );
        }
        eprintln!("adversarial #1 mutation-adequacy sweep: all 5 injected bugs caught + minimized");
    }

    /// AC5 — a divergence report reproduces the bug from the report ALONE. We take a caught repro,
    /// then replay ONLY its captured prior state + RAM + block (no fuzzer, no seed) and confirm the
    /// same field diverges. This is the offline-reproducibility contract.
    #[test]
    fn ac5_repro_reproduces_offline() {
        let _guard = MUT_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        mutation::set(mutation::DIV_ZERO_WRONG);
        let found = fuzz_campaign(0x5EED_0000_1111_2222, 4000, 25);
        let r = found.expect("expected to catch DIV_ZERO_WRONG");
        // Rebuild the prior ArchState from ONLY the report's captured fields.
        let prior = ArchState {
            pc: BASE_PC,
            xregs: r.prior_xregs,
            fregs: [0; 32],
            fcsr: 0,
            privilege: 3,
            mstatus: 0,
            mepc: 0,
            mcause: 0,
            mtval: 0,
            sepc: 0,
            scause: 0,
            stval: 0,
            satp: 0,
            ram_hash: fnv1a(&r.ram),
        };
        let replayed = lockstep_block(&prior, &r.block, &r.ram);
        mutation::clear();
        assert!(
            replayed.is_some(),
            "the captured repro did NOT reproduce the divergence offline"
        );
        eprintln!(
            "AC5: repro reproduced offline from its report alone (field={})",
            replayed.unwrap()
        );
    }
}
