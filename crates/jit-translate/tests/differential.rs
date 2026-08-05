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
        // Mix of RAM-window addresses (so loads/stores hit interesting spots) and wild values.
        *v = match rng.next() % 3 {
            0 => rng.next() & RAM_MASK,             // small in-window address
            1 => rng.next(),                        // full 64-bit
            _ => (rng.next() as i32 as i64) as u64, // sign-extended 32-bit
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

// ── randomized differential ─────────────────────────────────────────────────
fn random_campaign(seed: u64, blocks: usize) {
    let mut rng = Rng(seed);
    for _ in 0..blocks {
        let init = rand_init(&mut rng);
        let ram = rand_ram(&mut rng);
        let body_len = (rng.next() % 8) as usize; // 0..7 body ops
        let mut instrs: Vec<Instr> = (0..body_len).map(|_| rand_alu(&mut rng)).collect();
        let want_term = !rng.next().is_multiple_of(3); // ~2/3 of blocks end in a terminator
        if want_term {
            instrs.push(rand_term(&mut rng));
        }
        if instrs.is_empty() {
            instrs.push(rand_alu(&mut rng)); // a block must be non-empty
        }
        let has_term = is_term_instr(instrs.last().unwrap());
        assert_equiv(&instrs, has_term, &init, &ram, "random block");
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
        let instrs: Vec<Instr> = (0..body_len).map(|_| rand_alu(&mut rng)).collect();
        assert_equiv(&instrs, false, &init, &ram, "long fall-through block");
    }
}
