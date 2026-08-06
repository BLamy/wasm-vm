//! E4-T09 THE differential harness — the ticket's core acceptance criterion.
//!
//! For each block we (1) run it under the INTERPRETER (`Hart::exec_oracle`, the semantics source of
//! truth) from a random initial register state, capturing the final register file + next-PC + exit;
//! (2) translate the same block to WASM, instantiate it under wasmtime with an identical initial
//! `CpuState` image + an identical guest-RAM image behind the load/store imports, call the generated
//! `run`, and read back the register file + next-PC + exit from linear memory; (3) assert they are
//! byte-identical. This is run over thousands of random RV64I blocks plus directed edge cases.
//!
//! The reference is the *real* interpreter: in bare M-mode the load/store path is identity-mapped, so
//! `exec_oracle` covers every RV64I op including memory. Loads/stores in the generated code side-exit
//! to `env.load`/`env.store` imports backed by the SAME flat RAM the oracle bus uses, so memory
//! effects are compared too.

use jit_translate::{Abi, ExitCode, translate_block};
use wasm_vm_core::bus::{Bus, BusFault};
use wasm_vm_core::decode::Instr;
use wasm_vm_core::dispatch::{DecodedBlock, MicroOp};
use wasm_vm_core::hart::Hart;
use wasmtime::{Engine, Instance, Linker, Module, Store};

// ── constants shared by both engines ────────────────────────────────────────
const BASE_PC: u64 = 0x8000_0000; // block entry (virtual == physical in the bare harness)
const RAM_BITS: u32 = 20; // 1 MiB flat guest RAM window (wrapping, never faults)
const RAM_MASK: u64 = (1u64 << RAM_BITS) - 1;

// Hard-coded ABI offsets — DELIBERATELY independent of `jit_translate::Abi` so a mutation of the
// translator's offsets (adversarial #3) diverges this readback instead of moving in lock-step.
const OFF_XREG: usize = 0x000;
const OFF_EXIT_PC: usize = 0x220;

// ── flat wrapping RAM (identical model for the oracle bus and the wasm imports) ──
/// Read `n` little-endian bytes at `addr` with each byte independently address-masked, so a
/// wrap-around access is defined and identical however the caller decomposes it.
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

/// A never-faulting flat RAM bus for the oracle. Every access wraps into the 1 MiB window and
/// misaligned accesses are supported (byte-wise), so no RV64I load/store ever traps.
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
        true // the whole window is RAM → misaligned accesses decompose to bytes, never trap
    }
}

// ── oracle outcome ──────────────────────────────────────────────────────────
struct Outcome {
    regs: [u64; 32],
    pc: u64,
    exit: ExitCode,
    ram: Vec<u8>,
}

/// Run `ops` under the real interpreter from `init`, returning the architectural outcome + the exit
/// code we independently expect the generated block to report.
fn run_oracle(ops: &[MicroOp], has_term: bool, init: &[u64; 32], ram0: &[u8]) -> Outcome {
    let mut h = Hart::default(); // reset → M-mode, bare translation
    for r in 0..32u8 {
        h.regs.write(r, init[r as usize]);
    }
    h.regs.pc = BASE_PC;
    let mut bus = FlatBus { ram: ram0.to_vec() };

    let n = ops.len();
    let mut exit = ExitCode::Fallthrough;
    for (i, op) in ops.iter().enumerate() {
        let is_term = has_term && i == n - 1;
        // Snapshot the pre-terminator state to decide a branch's taken/not-taken exit independently.
        let before = regs_of(&h);
        match h.exec_oracle(&mut bus, op.instr, u64::from(op.len), u64::from(op.raw)) {
            Ok(()) => {
                if is_term {
                    exit = terminator_exit(&op.instr, &before);
                }
            }
            Err(_) => {
                // Only a terminating ecall/ebreak traps (memory never faults in this harness).
                exit = ExitCode::Trap;
                break;
            }
        }
    }
    Outcome {
        regs: regs_of(&h),
        pc: h.regs.pc,
        exit,
        ram: bus.ram,
    }
}

fn regs_of(h: &Hart) -> [u64; 32] {
    let mut r = [0u64; 32];
    for i in 0..32u8 {
        r[i as usize] = h.regs.read(i);
    }
    r
}

/// The exit code the generated block reports for a non-trapping terminator, derived independently of
/// the translator.
fn terminator_exit(instr: &Instr, before: &[u64; 32]) -> ExitCode {
    use Instr::*;
    let rv = |r: u8| before[r as usize];
    let taken = match instr {
        Beq { rs1, rs2, .. } => rv(*rs1) == rv(*rs2),
        Bne { rs1, rs2, .. } => rv(*rs1) != rv(*rs2),
        Blt { rs1, rs2, .. } => (rv(*rs1) as i64) < (rv(*rs2) as i64),
        Bge { rs1, rs2, .. } => (rv(*rs1) as i64) >= (rv(*rs2) as i64),
        Bltu { rs1, rs2, .. } => rv(*rs1) < rv(*rs2),
        Bgeu { rs1, rs2, .. } => rv(*rs1) >= rv(*rs2),
        Jal { .. } | Jalr { .. } => return ExitCode::BranchTaken,
        Fence { .. } | FenceI => return ExitCode::Fallthrough,
        _ => return ExitCode::Fallthrough,
    };
    if taken {
        ExitCode::BranchTaken
    } else {
        ExitCode::Fallthrough
    }
}

// ── wasm engine ─────────────────────────────────────────────────────────────
struct WasmData {
    ram: Vec<u8>,
}

fn run_wasm(block: &DecodedBlock, init: &[u64; 32], ram0: &[u8]) -> Outcome {
    let bytes = translate_block(block, &Abi::FROZEN).expect("supported block");
    // AC: every generated module passes wasmparser validation.
    wasmparser::Validator::new_with_features(wasmparser::WasmFeatures::all())
        .validate_all(&bytes)
        .expect("generated module must validate");

    let engine = Engine::default();
    let module = Module::new(&engine, &bytes).expect("module compiles");
    let mut store = Store::new(&engine, WasmData { ram: ram0.to_vec() });
    let mut linker = Linker::new(&engine);
    linker
        .func_wrap(
            "env",
            "load",
            |caller: wasmtime::Caller<'_, WasmData>, addr: i64, kind: i32| -> i64 {
                let ram = &caller.data().ram;
                let a = addr as u64;
                match kind {
                    0 => ram_read(ram, a, 1) as u8 as i8 as i64,   // lb
                    1 => ram_read(ram, a, 2) as u16 as i16 as i64, // lh
                    2 => ram_read(ram, a, 4) as u32 as i32 as i64, // lw
                    3 => ram_read(ram, a, 8) as i64,               // ld
                    4 => ram_read(ram, a, 1) as i64,               // lbu
                    5 => ram_read(ram, a, 2) as i64,               // lhu
                    6 => ram_read(ram, a, 4) as i64,               // lwu
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
                let ram = &mut caller.data_mut().ram;
                ram_write(ram, addr as u64, width as usize, val as u64);
            },
        )
        .unwrap();

    let instance: Instance = linker
        .instantiate(&mut store, &module)
        .expect("instantiate");
    let mem = instance
        .get_memory(&mut store, "mem")
        .expect("exported mem");
    // Load the initial CpuState register image.
    for r in 0..32u8 {
        let off = OFF_XREG + (r as usize) * 8;
        mem.write(&mut store, off, &init[r as usize].to_le_bytes())
            .unwrap();
    }
    let run = instance
        .get_typed_func::<i32, i32>(&mut store, "run")
        .expect("run export");
    let code = run.call(&mut store, 0).expect("run traps never");

    // Read back the architectural state from linear memory (writeback correctness AC).
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

    Outcome {
        regs,
        pc,
        exit: exit_from_i32(code),
        ram: store.into_data().ram,
    }
}

fn exit_from_i32(v: i32) -> ExitCode {
    match v {
        0 => ExitCode::Fallthrough,
        1 => ExitCode::BranchTaken,
        2 => ExitCode::Trap,
        other => panic!("unexpected exit code {other} (E4-T09 emits 0/1/2 only)"),
    }
}

// ── block construction ──────────────────────────────────────────────────────
fn op(instr: Instr) -> MicroOp {
    MicroOp {
        instr,
        len: 4,
        raw: 0,
    }
}

fn make_block(instrs: &[Instr]) -> DecodedBlock {
    let ops: Vec<MicroOp> = instrs.iter().copied().map(op).collect();
    let total = 4 * ops.len() as u64;
    DecodedBlock::new(BASE_PC, ops, total)
}

/// Build a block from `(instr, len)` pairs — models a predecoded run of mixed 2-byte (compressed,
/// already expanded to their 32-bit form) and 4-byte instructions. `total_len` is the exact byte
/// span, so the fall-through PC + branch targets + block byte-range all depend on the per-op lengths.
fn make_block_lens(pairs: &[(Instr, u8)]) -> DecodedBlock {
    let ops: Vec<MicroOp> = pairs
        .iter()
        .map(|&(instr, len)| MicroOp { instr, len, raw: 0 })
        .collect();
    let total: u64 = pairs.iter().map(|&(_, len)| len as u64).sum();
    DecodedBlock::new(BASE_PC, ops, total)
}

fn assert_equiv_lens(
    pairs: &[(Instr, u8)],
    has_term: bool,
    init: &[u64; 32],
    ram0: &[u8],
    label: &str,
) {
    let block = make_block_lens(pairs);
    let o = run_oracle(&block.ops, has_term, init, ram0);
    let w = run_wasm(&block, init, ram0);
    assert_eq!(o.regs, w.regs, "register file diverged: {label}");
    assert_eq!(o.pc, w.pc, "next-PC diverged: {label}");
    assert_eq!(o.exit, w.exit, "exit code diverged: {label}");
    assert!(o.ram == w.ram, "guest RAM diverged: {label}");
}

fn assert_equiv(instrs: &[Instr], has_term: bool, init: &[u64; 32], ram0: &[u8], label: &str) {
    let block = make_block(instrs);
    let o = run_oracle(&block.ops, has_term, init, ram0);
    let w = run_wasm(&block, init, ram0);
    assert_eq!(o.regs, w.regs, "register file diverged: {label}");
    assert_eq!(o.pc, w.pc, "next-PC diverged: {label}");
    assert_eq!(o.exit, w.exit, "exit code diverged: {label}");
    assert!(o.ram == w.ram, "guest RAM diverged: {label}");
}

// ── deterministic RNG (splitmix64) ──────────────────────────────────────────
struct Rng(u64);
impl Rng {
    fn next(&mut self) -> u64 {
        self.0 = self.0.wrapping_add(0x9E37_79B9_7F4A_7C15);
        let mut z = self.0;
        z = (z ^ (z >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
        z = (z ^ (z >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
        z ^ (z >> 31)
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

/// A pseudo-random supported non-terminator RV64I op.
fn rand_alu(rng: &mut Rng) -> Instr {
    use Instr::*;
    let (rd, rs1, rs2) = (rng.reg(), rng.reg(), rng.reg());
    let imm = rng.imm12();
    match rng.next() % 44 {
        0 => Lui {
            rd,
            imm: ((rng.next() as u32) & 0xFFFF_F000) as i32 as i64,
        }, // U-imm, low 12 zero
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
        29 => Sraw { rd, rs1, rs2 },
        30 => Lb { rd, rs1, imm },
        31 => Lh { rd, rs1, imm },
        32 => Lw { rd, rs1, imm },
        33 => Ld { rd, rs1, imm },
        34 => Lbu { rd, rs1, imm },
        35 => Lhu { rd, rs1, imm },
        36 => Lwu { rd, rs1, imm },
        37 => Sb { rs1, rs2, imm },
        38 => Sh { rs1, rs2, imm },
        39 => Sw { rs1, rs2, imm },
        40 => Sd { rs1, rs2, imm },
        41 => Slt { rd, rs1, rs2 },
        42 => Add { rd, rs1, rs2 },
        _ => Addi { rd, rs1, imm },
    }
}

/// A pseudo-random M-extension op (all 13 forms).
fn rand_m(rng: &mut Rng) -> Instr {
    use Instr::*;
    let (rd, rs1, rs2) = (rng.reg(), rng.reg(), rng.reg());
    match rng.next() % 13 {
        0 => Mul { rd, rs1, rs2 },
        1 => Mulh { rd, rs1, rs2 },
        2 => Mulhsu { rd, rs1, rs2 },
        3 => Mulhu { rd, rs1, rs2 },
        4 => Div { rd, rs1, rs2 },
        5 => Divu { rd, rs1, rs2 },
        6 => Rem { rd, rs1, rs2 },
        7 => Remu { rd, rs1, rs2 },
        8 => Mulw { rd, rs1, rs2 },
        9 => Divw { rd, rs1, rs2 },
        10 => Divuw { rd, rs1, rs2 },
        11 => Remw { rd, rs1, rs2 },
        _ => Remuw { rd, rs1, rs2 },
    }
}

/// A body op biased toward M ops (half the time) for the M-heavy campaign.
fn rand_alu_or_m(rng: &mut Rng) -> Instr {
    if rng.next().is_multiple_of(2) {
        rand_m(rng)
    } else {
        rand_alu(rng)
    }
}

/// The corner values the M-extension differential must hammer (as u64 bit patterns).
const CORNERS: &[u64] = &[
    0,
    1,
    u64::MAX, // -1
    2,
    0xFFFF_FFFF_FFFF_FFFE, // -2
    i64::MIN as u64,       // INT64_MIN
    i64::MAX as u64,       // INT64_MAX
    0x0000_0000_8000_0000, // INT32_MIN in low 32
    0x0000_0000_7FFF_FFFF, // INT32_MAX in low 32
    0xFFFF_FFFF_8000_0000, // sign-extended INT32_MIN
    0x0000_0000_FFFF_FFFF, // u32::MAX in low 32
    0x0000_0000_0000_0004, // power of two
    0x0000_0001_0000_0000, // 2^32
    0x8000_0000_0000_0001,
];

/// A pseudo-random supported terminator. Even B-immediates keep targets aligned.
fn rand_term(rng: &mut Rng) -> Instr {
    use Instr::*;
    let (rs1, rs2, rd) = (rng.reg(), rng.reg(), rng.reg());
    let bimm = rng.imm12() & !1i64; // even
    match rng.next() % 9 {
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
            imm: rng.imm12(),
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

fn is_term_instr(instr: &Instr) -> bool {
    use Instr::*;
    matches!(
        instr,
        Beq { .. }
            | Bne { .. }
            | Blt { .. }
            | Bge { .. }
            | Bltu { .. }
            | Bgeu { .. }
            | Jal { .. }
            | Jalr { .. }
            | Fence { .. }
            | FenceI
            | Ecall
            | Ebreak
    )
}

fn rand_init(rng: &mut Rng) -> [u64; 32] {
    let mut r = [0u64; 32];
    for v in r.iter_mut().skip(1) {
        // Mix of RAM-window addresses (so loads/stores hit interesting spots), wild values, and the
        // M-extension corner values (so random M ops actually exercise the div/overflow guards).
        *v = match rng.next() % 4 {
            0 => rng.next() & RAM_MASK,             // small in-window address
            1 => rng.next(),                        // full 64-bit
            2 => (rng.next() as i32 as i64) as u64, // sign-extended 32-bit
            _ => CORNERS[(rng.next() as usize) % CORNERS.len()], // corner value
        };
    }
    r
}

fn rand_ram(rng: &mut Rng) -> Vec<u8> {
    let mut ram = vec![0u8; 1 << RAM_BITS];
    // Seed a small deterministic region with a pattern; leaves are wrapping so any address is valid.
    for chunk in ram.chunks_mut(8) {
        let w = rng.next();
        for (i, b) in chunk.iter_mut().enumerate() {
            *b = (w >> (8 * i)) as u8;
        }
    }
    ram
}

// ── directed edge-case suite ────────────────────────────────────────────────
#[test]
fn directed_edge_cases() {
    use Instr::*;
    let mut init = [0u64; 32];
    // x5..x10 seeded with the nasty values.
    init[6] = 0; // for addiw x5,x6,-1
    init[7] = 0xFFFF_FFFF_8000_0000; // high bits set, low 32 = 0x8000_0000
    init[8] = 1;
    init[9] = 0xFFFF_FFFF_FFFF_FFFF; // -1
    init[10] = 0x1_0000_0000; // bit 32 set, low32 = 0
    init[11] = 0x0000_0000_8000_0000; // BASE_PC-ish
    let ram = vec![0u8; 1 << RAM_BITS];

    // addiw sign-extension: (0 + -1) as i32 = -1 → sext → 0xFFFF...F
    assert_equiv(
        &[Addiw {
            rd: 5,
            rs1: 6,
            imm: -1,
        }],
        false,
        &init,
        &ram,
        "addiw -1 sext",
    );
    // addiw dropping high bits: x10 low32 = 0, +1 → 1
    assert_equiv(
        &[Addiw {
            rd: 5,
            rs1: 10,
            imm: 1,
        }],
        false,
        &init,
        &ram,
        "addiw drops bit32",
    );
    // sllw with high garbage in rs1: only low 32 participate then sign-extend
    assert_equiv(
        &[Sllw {
            rd: 5,
            rs1: 7,
            rs2: 8,
        }],
        false,
        &init,
        &ram,
        "sllw low32 + sext",
    );
    // sra arithmetic vs srl logical with rs2 masked to 6 bits (65 & 63 = 1)
    init[12] = 65;
    assert_equiv(
        &[Sra {
            rd: 5,
            rs1: 9,
            rs2: 12,
        }],
        false,
        &init,
        &ram,
        "sra shamt mask 65->1",
    );
    assert_equiv(
        &[Srl {
            rd: 5,
            rs1: 9,
            rs2: 12,
        }],
        false,
        &init,
        &ram,
        "srl shamt mask 65->1",
    );
    // sll with rs2 >= 64 (masked to 6 bits): 64 & 63 = 0 → no shift
    init[13] = 64;
    assert_equiv(
        &[Sll {
            rd: 5,
            rs1: 9,
            rs2: 13,
        }],
        false,
        &init,
        &ram,
        "sll rs2=64 mask->0",
    );
    // sltu boundary: 0 <u (unsigned)  (-1) = true=1 ; slt signed: 0 < -1 = false=0
    assert_equiv(
        &[Sltu {
            rd: 5,
            rs1: 6,
            rs2: 9,
        }],
        false,
        &init,
        &ram,
        "sltu 0 < -1 = 1",
    );
    assert_equiv(
        &[Slt {
            rd: 5,
            rs1: 6,
            rs2: 9,
        }],
        false,
        &init,
        &ram,
        "slt 0 < -1 = 0",
    );
    // x0 target: write discarded
    assert_equiv(
        &[Addi {
            rd: 0,
            rs1: 9,
            imm: 5,
        }],
        false,
        &init,
        &ram,
        "x0 write discarded",
    );
    // x0 written mid-block then read stays zero
    assert_equiv(
        &[
            Addi {
                rd: 0,
                rs1: 9,
                imm: 5,
            },
            Add {
                rd: 5,
                rs1: 0,
                rs2: 9,
            },
        ],
        false,
        &init,
        &ram,
        "x0 read after write",
    );
    // jalr clears bit 0: (rs1 + imm) & !1
    init[14] = BASE_PC + 3; // odd-ish target
    assert_equiv(
        &[Jalr {
            rd: 1,
            rs1: 14,
            imm: 1,
        }],
        true,
        &init,
        &ram,
        "jalr bit0 clear",
    );
    // jalr rd==rs1: target from OLD rs1, then link overwrites
    assert_equiv(
        &[Jalr {
            rd: 14,
            rs1: 14,
            imm: 0,
        }],
        true,
        &init,
        &ram,
        "jalr rd==rs1",
    );
    // branch taken vs not-taken exits
    assert_equiv(
        &[Beq {
            rs1: 6,
            rs2: 6,
            imm: 16,
        }],
        true,
        &init,
        &ram,
        "beq taken",
    );
    assert_equiv(
        &[Bne {
            rs1: 6,
            rs2: 6,
            imm: 16,
        }],
        true,
        &init,
        &ram,
        "bne not-taken",
    );
    // read-then-write-then-read of the same register (lazy-load / dirty interaction)
    assert_equiv(
        &[
            Add {
                rd: 5,
                rs1: 9,
                rs2: 9,
            },
            Addi {
                rd: 5,
                rs1: 5,
                imm: 1,
            },
            Sub {
                rd: 6,
                rs1: 5,
                rs2: 9,
            },
        ],
        false,
        &init,
        &ram,
        "raw chain",
    );
    // ecall / ebreak → TRAP
    assert_equiv(&[Ecall], true, &init, &ram, "ecall trap");
    assert_equiv(&[Ebreak], true, &init, &ram, "ebreak trap");
    // load then store then load round-trip
    init[15] = 0x400; // in-window address
    assert_equiv(
        &[
            Sd {
                rs1: 15,
                rs2: 9,
                imm: 0,
            },
            Ld {
                rd: 16,
                rs1: 15,
                imm: 0,
            },
        ],
        false,
        &init,
        &ram,
        "sd/ld roundtrip",
    );
    // a dirty local live at the TAKEN branch exit but computed before it (adversarial #2)
    assert_equiv(
        &[
            Addi {
                rd: 5,
                rs1: 9,
                imm: 7,
            },
            Beq {
                rs1: 6,
                rs2: 6,
                imm: 32,
            },
        ],
        true,
        &init,
        &ram,
        "dirty live at taken exit",
    );
    assert_equiv(
        &[
            Addi {
                rd: 5,
                rs1: 9,
                imm: 7,
            },
            Bne {
                rs1: 6,
                rs2: 6,
                imm: 32,
            },
        ],
        true,
        &init,
        &ram,
        "dirty live at fallthrough exit",
    );
}

// ── M-extension corner-case differential (E4-T13) ────────────────────────────
//
// For every M op, cross-product every corner value against every corner value as (rs1, rs2) and
// assert the generated block matches the interpreter — and, critically, that `run` NEVER traps
// (the wasm div/rem trap is refuted by `run_wasm`'s `.expect("run traps never")`, which runs the
// generated code under wasmtime with the trap actually attempted).
#[test]
fn m_extension_corner_cross_product() {
    use Instr::*;
    let ops: &[Instr] = &[
        Mul {
            rd: 5,
            rs1: 1,
            rs2: 2,
        },
        Mulh {
            rd: 5,
            rs1: 1,
            rs2: 2,
        },
        Mulhsu {
            rd: 5,
            rs1: 1,
            rs2: 2,
        },
        Mulhu {
            rd: 5,
            rs1: 1,
            rs2: 2,
        },
        Div {
            rd: 5,
            rs1: 1,
            rs2: 2,
        },
        Divu {
            rd: 5,
            rs1: 1,
            rs2: 2,
        },
        Rem {
            rd: 5,
            rs1: 1,
            rs2: 2,
        },
        Remu {
            rd: 5,
            rs1: 1,
            rs2: 2,
        },
        Mulw {
            rd: 5,
            rs1: 1,
            rs2: 2,
        },
        Divw {
            rd: 5,
            rs1: 1,
            rs2: 2,
        },
        Divuw {
            rd: 5,
            rs1: 1,
            rs2: 2,
        },
        Remw {
            rd: 5,
            rs1: 1,
            rs2: 2,
        },
        Remuw {
            rd: 5,
            rs1: 1,
            rs2: 2,
        },
    ];
    let ram = vec![0u8; 1 << RAM_BITS];
    let mut cases = 0u64;
    for &instr in ops {
        for &x in CORNERS {
            for &y in CORNERS {
                let mut init = [0u64; 32];
                init[1] = x;
                init[2] = y;
                assert_equiv(&[instr], false, &init, &ram, "M corner cross-product");
                cases += 1;
            }
        }
    }
    eprintln!("M-extension corner cross-product: {cases} cases, zero divergences, zero wasm traps");
}

/// The specific mines the ticket names: div-by-zero, *W overflow, 64-bit overflow, mixed-sign MULHSU.
#[test]
fn m_extension_directed_mines() {
    use Instr::*;
    let ram = vec![0u8; 1 << RAM_BITS];
    let case = |x: u64, y: u64, instr: Instr, label: &str| {
        let mut init = [0u64; 32];
        init[1] = x;
        init[2] = y;
        assert_equiv(&[instr], false, &init, &ram, label);
    };
    // div x,y,0 → -1 (no trap)
    case(
        1234,
        0,
        Div {
            rd: 5,
            rs1: 1,
            rs2: 2,
        },
        "div /0 → -1",
    );
    case(
        1234,
        0,
        Divu {
            rd: 5,
            rs1: 1,
            rs2: 2,
        },
        "divu /0 → all-ones",
    );
    case(
        1234,
        0,
        Rem {
            rd: 5,
            rs1: 1,
            rs2: 2,
        },
        "rem /0 → dividend",
    );
    case(
        1234,
        0,
        Remu {
            rd: 5,
            rs1: 1,
            rs2: 2,
        },
        "remu /0 → dividend",
    );
    // divw INT32_MIN,-1 → INT32_MIN (sext), no trap
    case(
        0x0000_0000_8000_0000,
        u64::MAX,
        Divw {
            rd: 5,
            rs1: 1,
            rs2: 2,
        },
        "divw INT32_MIN/-1",
    );
    case(
        0x0000_0000_8000_0000,
        u64::MAX,
        Remw {
            rd: 5,
            rs1: 1,
            rs2: 2,
        },
        "remw INT32_MIN/-1 → 0",
    );
    case(
        0x0000_0000_8000_0000,
        0,
        Divuw {
            rd: 5,
            rs1: 1,
            rs2: 2,
        },
        "divuw /0",
    );
    // rem INT64_MIN,-1 → 0 (no trap)
    case(
        i64::MIN as u64,
        u64::MAX,
        Rem {
            rd: 5,
            rs1: 1,
            rs2: 2,
        },
        "rem INT64_MIN/-1 → 0",
    );
    case(
        i64::MIN as u64,
        u64::MAX,
        Div {
            rd: 5,
            rs1: 1,
            rs2: 2,
        },
        "div INT64_MIN/-1 → INT64_MIN",
    );
    // MULHSU mixed sign: rs1 negative, rs2 with the high bit set (large unsigned)
    case(
        u64::MAX,
        0x8000_0000_0000_0000,
        Mulhsu {
            rd: 5,
            rs1: 1,
            rs2: 2,
        },
        "mulhsu -1 × 2^63",
    );
    case(
        i64::MIN as u64,
        u64::MAX,
        Mulhsu {
            rd: 5,
            rs1: 1,
            rs2: 2,
        },
        "mulhsu INT64_MIN × u64::MAX",
    );
    case(
        u64::MAX,
        u64::MAX,
        Mulh {
            rd: 5,
            rs1: 1,
            rs2: 2,
        },
        "mulh -1 × -1 → 0",
    );
    case(
        u64::MAX,
        u64::MAX,
        Mulhu {
            rd: 5,
            rs1: 1,
            rs2: 2,
        },
        "mulhu -1 × -1 → -2",
    );
}

// ── C-extension PC-arithmetic gate (E4-T13) ──────────────────────────────────
//
// A guest of only compressed instructions (each len 2, already expanded to its 32-bit form by the
// predecoder) ending in `c.bnez` (an expanded `Bne rs2==x0`) whose taken target is pc + 2·k. The
// generated block must compute every PC off the per-op 2-byte length: the fall-through PC, the
// branch target (relative to the 2-byte-aligned instruction PC), and the block byte-range. We check
// the resume PC + registers against the interpreter for BOTH taken and not-taken outcomes.
#[test]
fn c_extension_pc_arithmetic() {
    use Instr::*;
    let ram = vec![0u8; 1 << RAM_BITS];
    // Body: five compressed 16-bit ops (c.li / c.addi-style, modeled as Addi len 2), then c.bnez.
    // c.addi x8, x8, 1  (×5) → x8 = init + 5, all at 2-byte spacing.
    let body: [(Instr, u8); 5] = [
        (
            Addi {
                rd: 8,
                rs1: 8,
                imm: 1,
            },
            2,
        ),
        (
            Addi {
                rd: 8,
                rs1: 8,
                imm: 1,
            },
            2,
        ),
        (
            Addi {
                rd: 8,
                rs1: 8,
                imm: 1,
            },
            2,
        ),
        (
            Addi {
                rd: 8,
                rs1: 8,
                imm: 1,
            },
            2,
        ),
        (
            Addi {
                rd: 8,
                rs1: 8,
                imm: 1,
            },
            2,
        ),
    ];
    // c.bnez x8, target ; target = pc + 2·k. c.bnez expands to `Bne x8, x0, imm`.
    for k in [-4i64, -2, 2, 4, 8] {
        let target_off = 2 * k; // even, 2-byte multiple
        let mut pairs: Vec<(Instr, u8)> = body.to_vec();
        pairs.push((
            Bne {
                rs1: 8,
                rs2: 0,
                imm: target_off,
            },
            2,
        ));

        // Taken: x8 != 0 after the adds.
        let mut init = [0u64; 32];
        init[8] = 3;
        assert_equiv_lens(&pairs, true, &init, &ram, "c.bnez taken pc+2k");

        // Not taken: make x8 == 0 after the +5 adds (start at -5).
        let mut init0 = [0u64; 32];
        init0[8] = (-5i64) as u64;
        assert_equiv_lens(&pairs, true, &init0, &ram, "c.bnez not-taken fallthrough");
    }

    // Mixed 2/4-byte block ending in a compressed jal (c.j → Jal x0, imm, len 2): the link value of a
    // compressed call is pc+2, and the fall-through/byte-range must stay exact across widths.
    let mixed: [(Instr, u8); 4] = [
        (
            Addi {
                rd: 8,
                rs1: 8,
                imm: 7,
            },
            2,
        ), // compressed
        (
            Add {
                rd: 9,
                rs1: 8,
                rs2: 8,
            },
            4,
        ), // full 32-bit
        (
            Addi {
                rd: 10,
                rs1: 9,
                imm: -1,
            },
            2,
        ), // compressed
        (Jal { rd: 1, imm: 6 }, 2), // c.jal: link = pc+2, target = pc+6
    ];
    let init = [0u64; 32];
    assert_equiv_lens(
        &mixed,
        true,
        &init,
        &ram,
        "mixed-width block, c.jal link=pc+2",
    );

    // Compressed jalr (c.jr / c.jalr → Jalr, len 2): link (if any) is pc+2.
    let mut init2 = [0u64; 32];
    init2[14] = BASE_PC + 0x40;
    let cjalr: [(Instr, u8); 2] = [
        (
            Addi {
                rd: 8,
                rs1: 8,
                imm: 1,
            },
            2,
        ),
        (
            Jalr {
                rd: 1,
                rs1: 14,
                imm: 0,
            },
            2,
        ), // c.jalr: link = pc+2
    ];
    assert_equiv_lens(&cjalr, true, &init2, &ram, "c.jalr link=pc+2");

    // Fall-through block of compressed ops with NO terminator: resume PC = base + total_len (2·n).
    let ft: [(Instr, u8); 3] = [
        (
            Addi {
                rd: 8,
                rs1: 8,
                imm: 1,
            },
            2,
        ),
        (
            Addi {
                rd: 9,
                rs1: 9,
                imm: 2,
            },
            2,
        ),
        (
            Addi {
                rd: 10,
                rs1: 10,
                imm: 3,
            },
            2,
        ),
    ];
    assert_equiv_lens(
        &ft,
        false,
        &init,
        &ram,
        "compressed fall-through, pc = base + 2n",
    );
}

// ── randomized differential ─────────────────────────────────────────────────
fn random_campaign(seed: u64, blocks: usize) {
    let mut rng = Rng(seed);
    for _ in 0..blocks {
        let init = rand_init(&mut rng);
        let ram = rand_ram(&mut rng);
        let body_len = (rng.next() % 8) as usize; // 0..7 body ops
        let mut instrs: Vec<Instr> = (0..body_len).map(|_| rand_alu_or_m(&mut rng)).collect();
        let want_term = !rng.next().is_multiple_of(3); // ~2/3 of blocks end in a terminator
        if want_term {
            instrs.push(rand_term(&mut rng));
        }
        if instrs.is_empty() {
            instrs.push(rand_alu(&mut rng)); // a block must be non-empty
        }
        let has_term = is_term_instr(instrs.last().unwrap());
        // Randomly assign each op a 2- or 4-byte length (compressed/uncompressed mix). Both engines
        // use the SAME per-op length, so this exclusively stresses the PC-arithmetic bookkeeping
        // (fall-through PC, branch/jal targets, link values, block byte-range) across mixed widths.
        let pairs: Vec<(Instr, u8)> = instrs
            .iter()
            .map(|&i| (i, if rng.next().is_multiple_of(2) { 2 } else { 4 }))
            .collect();
        assert_equiv_lens(&pairs, has_term, &init, &ram, "random block (mixed widths)");
    }
}

#[test]
fn randomized_differential_small() {
    // A fast always-on gate (runs under the default `cargo test`).
    random_campaign(0xDEAD_BEEF_0000_0001, 3_000);
}

#[test]
#[ignore = "100k-block full campaign — run with `cargo test --release -- --ignored`"]
fn randomized_differential_100k() {
    random_campaign(0x0102_0304_0506_0708, 100_000);
}

/// Deliverable: median translation time per block < 50 µs native (predecode → bytes).
#[test]
fn translation_time_budget() {
    use std::time::Instant;
    let mut rng = Rng(0xF00D_CAFE_BABE_0001);
    // A representative population of ~realistic blocks (a few body ops + a terminator).
    let mut blocks: Vec<DecodedBlock> = Vec::new();
    for _ in 0..5_000 {
        let body_len = 1 + (rng.next() % 8) as usize;
        let mut instrs: Vec<Instr> = (0..body_len).map(|_| rand_alu(&mut rng)).collect();
        instrs.push(rand_term(&mut rng));
        blocks.push(make_block(&instrs));
    }
    let mut times: Vec<u128> = Vec::with_capacity(blocks.len());
    for b in &blocks {
        let t = Instant::now();
        let bytes = translate_block(b, &Abi::FROZEN).expect("supported");
        let ns = t.elapsed().as_nanos();
        std::hint::black_box(&bytes);
        times.push(ns);
    }
    times.sort_unstable();
    let median_ns = times[times.len() / 2];
    let median_us = median_ns as f64 / 1000.0;
    eprintln!(
        "E4-T09 translation time: median = {median_us:.2} µs/block over {} blocks (budget < 50 µs)",
        blocks.len()
    );
    assert!(
        median_us < 50.0,
        "median translation time {median_us:.2} µs exceeds the 50 µs budget"
    );
}

// Adversarial #1: a second campaign with a different seed and a maximum-length block bias.
#[test]
#[ignore = "adversarial long-block campaign — run with --ignored"]
fn randomized_differential_longblocks() {
    let mut rng = Rng(0xA5A5_5A5A_1234_5678);
    for _ in 0..20_000 {
        let init = rand_init(&mut rng);
        let ram = rand_ram(&mut rng);
        let body_len = 40 + (rng.next() % 80) as usize; // long blocks up to ~120 ops
        let instrs: Vec<Instr> = (0..body_len).map(|_| rand_alu_or_m(&mut rng)).collect();
        assert_equiv(&instrs, false, &init, &ram, "long fall-through block");
    }
}
