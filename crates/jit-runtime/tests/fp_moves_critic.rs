//! E5.5-T03t independent verifier corpus. Expected bit patterns are computed here
//! without the worker fixture or interpreter's FP helpers.
use jit_runtime::WasmtimeExecutor;
use jit_translate::{Abi, translate_block};
use std::collections::BTreeSet;
use wasm_vm_core::bus::mmap::DRAM_BASE;
use wasm_vm_core::csr::{CsrOp, MSTATUS};
use wasm_vm_core::decode::decode;
use wasm_vm_core::dispatch::{DecodedBlock, MicroOp};
use wasm_vm_core::hart::{Hart, fregs::FRegs};
use wasm_vm_core::jit::{CompiledBlockExecutor, ExitCode};
use wasm_vm_core::mmio::SystemBus;
use wasm_vm_core::ram::Ram;
use wasmparser::{Parser, Payload};

fn encoded(funct7: u32, funct3: u32, rd: u8, rs1: u8, rs2: u8) -> u32 {
    (funct7 << 25)
        | (u32::from(rs2) << 20)
        | (u32::from(rs1) << 15)
        | (funct3 << 12)
        | (u32::from(rd) << 7)
        | 0x53
}

fn decoded(words: &[u32]) -> DecodedBlock {
    DecodedBlock::new(
        DRAM_BASE,
        words
            .iter()
            .map(|&raw| MicroOp {
                instr: decode(raw).expect("legal independent encoding"),
                len: 4,
                raw,
            })
            .collect(),
        words.len() as u64 * 4,
    )
}

fn enable(hart: &mut Hart, fs: u64) {
    hart.csr
        .access(MSTATUS, CsrOp::Write, fs << 13, false, false, 0)
        .unwrap();
}

fn splitmix(state: &mut u64) -> u64 {
    *state = state.wrapping_add(0x9e37_79b9_7f4a_7c15);
    let mut z = *state;
    z = (z ^ (z >> 30)).wrapping_mul(0xbf58_476d_1ce4_e5b9);
    z = (z ^ (z >> 27)).wrapping_mul(0x94d0_49bb_1331_11eb);
    z ^ (z >> 31)
}

fn operand(raw: u64) -> u32 {
    if raw & 0xffff_ffff_0000_0000 == 0xffff_ffff_0000_0000 {
        raw as u32
    } else {
        0x7fc0_0000
    }
}

#[test]
fn critic_exact_nan_payload_and_raw_move_golden() {
    let words = [
        0x2020_8053, // fsgnj.s f0,f1,f2
        encoded(0x70, 0, 31, 0, 0),
        encoded(0x70, 0, 7, 3, 0),
        encoded(0x78, 0, 31, 1, 0),
    ];
    let mut executor = WasmtimeExecutor::new();
    executor.install(&decoded(&words));
    let mut hart = Hart::default();
    enable(&mut hart, 2);
    hart.csr.fflags = 9;
    hart.csr.frm = 7;
    hart.fregs.write_raw(1, 0xffff_ffff_7f81_2345);
    hart.fregs.write_raw(2, 0xffff_ffff_8000_0000);
    hart.fregs.write_raw(3, 0xffff_fffe_8123_4567);
    hart.regs.write(1, 0x1234_5678_8123_4567);
    hart.regs.pc = 0x4000_0040;
    let mut bus = SystemBus::new(Ram::new(64 * 1024).unwrap());
    let exit = executor.execute(DRAM_BASE, &mut hart, &mut bus).unwrap();
    assert_eq!(exit.code, ExitCode::Fallthrough);
    assert_eq!(exit.next_pc, 0x4000_0050);
    assert_eq!(
        hart.fregs.read_raw(0),
        0xffff_ffff_ff81_2345,
        "CRITIC_GOLDEN_SIGNALING_PAYLOAD"
    );
    assert_eq!(hart.regs.read(31), 0xffff_ffff_ff81_2345);
    assert_eq!(hart.regs.read(7), 0xffff_ffff_8123_4567);
    assert_eq!(hart.fregs.read_raw(31), 0xffff_ffff_8123_4567);
    assert_eq!(hart.csr.fflags, 9);
    assert_eq!(hart.csr.frm, 7);
    assert_eq!(hart.csr.fs(), 3);
    eprintln!(
        "CRITIC_GOLDEN f0={:016x} x31={:016x} x7={:016x} f31={:016x}",
        hart.fregs.read_raw(0),
        hart.regs.read(31),
        hart.regs.read(7),
        hart.fregs.read_raw(31)
    );
}

#[test]
fn critic_aliases_independent_seeds_and_all_first_op_traps() {
    let operations = [(0x10, 0), (0x10, 1), (0x10, 2), (0x70, 0), (0x78, 0)];
    let aliases = [
        (0, 0, 0),
        (31, 31, 31),
        (2, 1, 2),
        (1, 1, 2),
        (2, 1, 1),
        (31, 0, 31),
        (0, 31, 0),
        (17, 9, 27),
    ];
    let mut executor = WasmtimeExecutor::new();
    let mut bus = SystemBus::new(Ram::new(64 * 1024).unwrap());
    let mut cases = 0_u64;
    let mut disabled = 0_u64;
    let mut digest = 0xcbf2_9ce4_8422_2325_u64;
    for (funct7, funct3) in operations {
        for (rd, rs1, rs2) in aliases {
            let raw = encoded(
                funct7,
                funct3,
                rd,
                rs1,
                if funct7 == 0x10 { rs2 } else { 0 },
            );
            executor.invalidate_all();
            executor.install(&decoded(&[raw]));
            assert!(executor.is_compiled(DRAM_BASE));
            for seed in [
                0x50e2_638f_619a_84d7,
                0x79c4_0dfb_5246_a831,
                0xa81f_659c_302d_47b6,
            ] {
                let mut random = seed;
                for sample in 0..32_u64 {
                    let mut hart = Hart::default();
                    for register in 0..32_u8 {
                        hart.regs.write(register, splitmix(&mut random));
                        let value = splitmix(&mut random);
                        let bits = match sample % 4 {
                            0 => 0xffff_ffff_0000_0000 | (value & 0xffff_ffff),
                            1 => 0xffff_fffe_0000_0000 | (value & 0xffff_ffff),
                            2 => 0xffff_ffff_7f80_0001 | (value & 0x8000_0000),
                            _ => value,
                        };
                        hart.fregs.write_raw(register, bits);
                    }
                    let fs = (sample / 4) % 4;
                    enable(&mut hart, fs);
                    hart.csr.fflags = sample as u8;
                    hart.csr.frm = (sample % 8) as u8;
                    let virtual_pc = 0x4000_0000 + sample * 8;
                    hart.regs.pc = virtual_pc;
                    let mut want_x: [u64; 32] = core::array::from_fn(|r| hart.regs.read(r as u8));
                    let mut want_f: [u64; 32] =
                        core::array::from_fn(|r| hart.fregs.read_raw(r as u8));
                    let mut want_status = hart.csr.mstatus;
                    if fs != 0 {
                        match funct7 {
                            0x10 => {
                                let magnitude = operand(want_f[rs1 as usize]);
                                let source_sign = operand(want_f[rs2 as usize]) >> 31;
                                let sign = match funct3 {
                                    0 => source_sign,
                                    1 => source_sign ^ 1,
                                    2 => source_sign ^ (magnitude >> 31),
                                    _ => unreachable!(),
                                };
                                want_f[rd as usize] = 0xffff_ffff_0000_0000
                                    | u64::from((magnitude & 0x7fff_ffff) | (sign << 31));
                            }
                            0x70 => {
                                if rd != 0 {
                                    want_x[rd as usize] =
                                        want_f[rs1 as usize] as u32 as i32 as i64 as u64;
                                }
                            }
                            0x78 => {
                                want_f[rd as usize] =
                                    0xffff_ffff_0000_0000 | (want_x[rs1 as usize] & 0xffff_ffff)
                            }
                            _ => unreachable!(),
                        }
                        if funct7 != 0x70 {
                            want_status = (want_status & !0x6000) | 0x8000_0000_0000_6000;
                        }
                    }
                    let before = executor.executed_blocks();
                    let exit = executor.execute(DRAM_BASE, &mut hart, &mut bus).unwrap();
                    assert_eq!(executor.executed_blocks(), before + 1);
                    if fs == 0 {
                        disabled += 1;
                        assert_eq!(exit.code, ExitCode::IllegalInstruction);
                        assert_eq!(exit.exit_info, u64::from(raw), "first-op raw mtval");
                        assert_eq!(exit.next_pc, virtual_pc);
                    } else {
                        assert_eq!(exit.code, ExitCode::Fallthrough);
                        assert_eq!(exit.next_pc, virtual_pc + 4);
                    }
                    assert_eq!(
                        exit.retired, 0,
                        "native ABI leaves exact prefix accounting to core"
                    );
                    let actual_x: [u64; 32] = core::array::from_fn(|r| hart.regs.read(r as u8));
                    let actual_f: [u64; 32] =
                        core::array::from_fn(|r| hart.fregs.read_raw(r as u8));
                    assert_eq!(actual_x, want_x, "integer bank raw={raw:08x}");
                    assert_eq!(actual_f, want_f, "FP bank raw={raw:08x}");
                    assert_eq!(hart.csr.mstatus, want_status);
                    assert_eq!(hart.csr.fflags, sample as u8);
                    assert_eq!(hart.csr.frm, (sample % 8) as u8);
                    for word in actual_x.into_iter().chain(actual_f).chain([
                        exit.next_pc,
                        want_status,
                        raw as u64,
                        u64::from(fs != 0),
                    ]) {
                        for byte in word.to_le_bytes() {
                            digest = (digest ^ u64::from(byte)).wrapping_mul(0x100_0000_01b3);
                        }
                    }
                    cases += 1;
                }
            }
        }
    }
    assert_eq!(cases, 3840);
    assert_eq!(disabled, 960);
    eprintln!("CRITIC_CASES cases={cases} disabled={disabled} state_fnv64={digest:016x}");
}

#[test]
fn critic_generated_fp_subset_contains_only_integer_wasm_operations() {
    let words = [
        0x2020_8053,
        0x2020_9053,
        0x2020_a053,
        0xf000_8053,
        0xe000_8053,
    ];
    let bytes = translate_block(&decoded(&words), &Abi::FROZEN).unwrap();
    wasmparser::Validator::new().validate_all(&bytes).unwrap();
    let mut operations = BTreeSet::new();
    let mut count = 0;
    for payload in Parser::new(0).parse_all(&bytes) {
        if let Payload::CodeSectionEntry(body) = payload.unwrap() {
            let mut reader = body.get_operators_reader().unwrap();
            while !reader.eof() {
                let name = format!("{:?}", reader.read().unwrap());
                assert!(
                    !name.contains("F32") && !name.contains("F64"),
                    "host FP emission: {name}"
                );
                operations.insert(name.split([' ', '{']).next().unwrap().to_string());
                count += 1;
            }
        }
    }
    for required in [
        "I64Load",
        "I64Store",
        "I64ShrU",
        "I64ExtendI32S",
        "I64Or",
        "I64Xor",
    ] {
        assert!(
            operations.contains(required),
            "expected integer operation {required}"
        );
    }
    assert!(count > 100);
    eprintln!(
        "CRITIC_WASM bytes={} instructions={count} operations={operations:?}",
        bytes.len()
    );
}

#[test]
fn critic_freg_identities_remain_distinct_under_concurrent_creation() {
    let threads: Vec<_> = (0..4)
        .map(|_| {
            std::thread::spawn(|| {
                let mut identities = Vec::new();
                for _ in 0..128 {
                    let mut original = FRegs::default();
                    original.write_raw(0, 0);
                    let copied = original.clone();
                    assert!(original == copied);
                    assert_ne!(original.jit_version(), copied.jit_version());
                    identities.extend([original.jit_version().0, copied.jit_version().0]);
                }
                identities
            })
        })
        .collect();
    let identities: Vec<_> = threads
        .into_iter()
        .flat_map(|thread| thread.join().unwrap())
        .collect();
    assert_eq!(identities.len(), 1024);
    let distinct: BTreeSet<_> = identities.into_iter().collect();
    assert_eq!(distinct.len(), 1024);
    assert!(!distinct.contains(&0));
    eprintln!("CRITIC_IDENTITIES threads=4 allocated=1024 unique=1024");
}
