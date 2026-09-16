#[path = "../../../tests/support/jit_fp_division_verifier.rs"]
mod proof;

fn native(_: &wasm_vm_core::Machine) -> Box<dyn wasm_vm_core::jit::CompiledBlockExecutor> {
    Box::new(jit_runtime::WasmtimeExecutor::new())
}
#[test]
fn verifier_native_division_literals() {
    eprintln!(
        "CRITIC_NATIVE_DIVISION_LITERALS {:?}",
        proof::literal_goldens(native, false)
    );
}
#[test]
fn verifier_native_division_seeded_aliases_and_illegal() {
    eprintln!(
        "CRITIC_NATIVE_DIVISION_SEEDED {:?}",
        proof::seeded_aliases_and_illegal(native, false)
    );
}
#[test]
fn verifier_native_division_control_and_faults() {
    eprintln!(
        "CRITIC_NATIVE_DIVISION_CONTROL {:?}",
        proof::control_and_faults(native, false)
    );
}

#[derive(Default)]
struct Probe {
    divisions: Vec<[i32; 3]>,
    conversions: Vec<[i64; 3]>,
    arithmetic: Vec<[i32; 4]>,
    to_words: Vec<[i32; 3]>,
}
fn instrumented_linker(engine: &wasmtime::Engine) -> wasmtime::Linker<Probe> {
    let mut linker = wasmtime::Linker::new(engine);
    linker
        .func_wrap("env", "load", |_: i64, _: i32| -> i64 {
            panic!("division touched guest memory")
        })
        .unwrap();
    linker
        .func_wrap("env", "store", |_: i64, _: i64, _: i32| -> () {
            panic!("division touched guest memory")
        })
        .unwrap();
    linker
        .func_wrap("env", "amo", |_: i64, _: i64, _: i32, _: i32| -> i64 {
            panic!("division touched atomics")
        })
        .unwrap();
    linker
        .func_wrap("env", "lr", |_: i64, _: i32| -> i64 {
            panic!("division touched reservation state")
        })
        .unwrap();
    linker
        .func_wrap("env", "sc", |_: i64, _: i64, _: i32| -> i64 {
            panic!("division touched reservation state")
        })
        .unwrap();
    linker
        .func_wrap(
            "env",
            "fp_to_word_s",
            |mut caller: wasmtime::Caller<'_, Probe>, bits: i32, unsigned: i32, rm: i32| -> i64 {
                assert!(
                    (0..2).contains(&unsigned),
                    "invalid signedness reached helper"
                );
                assert!((0..5).contains(&rm), "invalid rounding reached helper");
                caller.data_mut().to_words.push([bits, unsigned, rm]);
                wasm_vm_core::jit::fp_to_word_s(bits as u32, unsigned != 0, rm as u8) as i64
            },
        )
        .unwrap();
    linker
        .func_wrap(
            "env",
            "fp_from_int_s",
            |mut caller: wasmtime::Caller<'_, Probe>, value: i64, width: i32, rm: i32| -> i64 {
                assert!((0..4).contains(&width), "invalid width reached helper");
                assert!((0..5).contains(&rm), "invalid rounding reached helper");
                caller
                    .data_mut()
                    .conversions
                    .push([value, i64::from(width), i64::from(rm)]);
                wasm_vm_core::jit::fp_from_int_s(value as u64, width as u8, rm as u8) as i64
            },
        )
        .unwrap();
    linker
        .func_wrap(
            "env",
            "fp_arith_s",
            |mut caller: wasmtime::Caller<'_, Probe>, a: i32, b: i32, mul: i32, rm: i32| -> i64 {
                caller.data_mut().arithmetic.push([a, b, mul, rm]);
                wasm_vm_core::jit::fp_arith_s(a as u32, b as u32, mul != 0, rm as u8) as i64
            },
        )
        .unwrap();
    linker
        .func_wrap(
            "env",
            "fp_div_s",
            |mut caller: wasmtime::Caller<'_, Probe>, a: i32, b: i32, rm: i32| -> i64 {
                assert!(
                    (0..5).contains(&rm),
                    "invalid rounding reached division helper"
                );
                caller.data_mut().divisions.push([a, b, rm]);
                wasm_vm_core::jit::fp_div_s(a as u32, b as u32, rm as u8) as i64
            },
        )
        .unwrap();
    linker
}
fn read_word(memory: wasmtime::Memory, store: &wasmtime::Store<Probe>, offset: usize) -> u64 {
    u64::from_le_bytes(memory.data(store)[offset..offset + 8].try_into().unwrap())
}
fn write_word(
    memory: wasmtime::Memory,
    store: &mut wasmtime::Store<Probe>,
    offset: usize,
    value: u64,
) {
    memory.write(store, offset, &value.to_le_bytes()).unwrap();
}
fn function_imports(bytes: &[u8]) -> Vec<(String, String)> {
    let mut imports = Vec::new();
    for item in wasmparser::Parser::new(0).parse_all(bytes) {
        if let wasmparser::Payload::ImportSection(section) = item.unwrap() {
            for item in section {
                let import = item.unwrap();
                if matches!(import.ty, wasmparser::TypeRef::Func(_)) {
                    imports.push((import.module.to_string(), import.name.to_string()));
                }
            }
        }
    }
    imports
}

fn check_integer_wasm_and_calls(bytes: &[u8]) -> (Vec<(String, u32)>, Vec<u32>) {
    let mut exports = Vec::new();
    let mut calls = Vec::new();
    for item in wasmparser::Parser::new(0).parse_all(bytes) {
        match item.unwrap() {
            wasmparser::Payload::ExportSection(section) => {
                for item in section {
                    let export = item.unwrap();
                    if export.kind == wasmparser::ExternalKind::Func {
                        exports.push((export.name.to_string(), export.index));
                    }
                }
            }
            wasmparser::Payload::CodeSectionEntry(body) => {
                for op in body.get_operators_reader().unwrap() {
                    let op = op.unwrap();
                    let name = format!("{op:?}");
                    assert!(
                        !name.contains("F32") && !name.contains("F64"),
                        "host FP opcode: {name}"
                    );
                    if let wasmparser::Operator::Call { function_index } = op {
                        calls.push(function_index);
                    }
                }
            }
            _ => (),
        }
    }
    (exports, calls)
}
#[test]
fn verifier_generated_division_helper_counts_and_purity() {
    use jit_translate::{Abi, translate_block};
    use wasm_vm_core::bus::mmap::DRAM_BASE;
    use wasm_vm_core::jit::ExitCode;
    let engine = wasmtime::Engine::default();
    let linker = instrumented_linker(&engine);
    let mut cases = 0;
    let mut calls = 0;
    for rm in 0..8 {
        for (rd, rs1, rs2, a, b, results, flags) in [
            (
                31,
                0,
                30,
                proof::BOX | 0x3f80_0000,
                proof::BOX | 0x4040_0000,
                [
                    0x3eaa_aaab_u32,
                    0x3eaa_aaaa,
                    0x3eaa_aaaa,
                    0x3eaa_aaab,
                    0x3eaa_aaab,
                ],
                [1_u8; 5],
            ),
            (
                0,
                0,
                31,
                0xffff_fffe_7f80_0001,
                proof::BOX | 0x7f80_0001,
                [0x7fc0_0000; 5],
                [16; 5],
            ),
            (
                30,
                0,
                30,
                proof::BOX | 1,
                proof::BOX | 0x4000_0000,
                [0, 0, 0, 1, 1],
                [3; 5],
            ),
            (
                31,
                31,
                0,
                proof::BOX | 0x7f80_0000,
                proof::BOX | 0x8000_0000,
                [0xff80_0000; 5],
                [0; 5],
            ),
            (
                7,
                31,
                7,
                proof::BOX | 0x7f7f_ffff,
                proof::BOX | 0x3f00_0000,
                [
                    0x7f80_0000,
                    0x7f7f_ffff,
                    0x7f7f_ffff,
                    0x7f80_0000,
                    0x7f80_0000,
                ],
                [5; 5],
            ),
            (
                0,
                0,
                0,
                proof::BOX | 0x3f80_0000,
                proof::BOX | 0x3f80_0000,
                [0x3f80_0000; 5],
                [0; 5],
            ),
        ] {
            let raw = proof::division(rd, rs1, rs2, rm);
            let bytes = translate_block(
                &proof::block(DRAM_BASE, &[0x0016_0613, raw, 0x0016_8693]),
                &Abi::FROZEN,
            )
            .unwrap();
            assert_eq!(
                function_imports(&bytes),
                ["load", "store", "amo", "lr", "sc", "fp_div_s"]
                    .map(|s| ("env".to_string(), s.to_string()))
            );
            let (exports, sites) = check_integer_wasm_and_calls(&bytes);
            assert_eq!(exports, [("run".to_string(), 6)]);
            assert_eq!(sites, [5]);
            let module = wasmtime::Module::new(&engine, &bytes).unwrap();
            let mut store = wasmtime::Store::new(&engine, Probe::default());
            let instance = linker.instantiate(&mut store, &module).unwrap();
            let memory = instance.get_memory(&mut store, "mem").unwrap();
            let run = instance
                .get_typed_func::<i32, i32>(&mut store, "run")
                .unwrap();
            for fs in 0..4 {
                for frm in 0..8 {
                    memory.data_mut(&mut store).fill(0x5a);
                    for r in 0..32 {
                        write_word(
                            memory,
                            &mut store,
                            r * 8,
                            if r == 0 { 0 } else { proof::SENTINEL },
                        );
                        write_word(
                            memory,
                            &mut store,
                            0x108 + r * 8,
                            proof::SENTINEL ^ r as u64,
                        );
                    }
                    write_word(memory, &mut store, 0x108 + rs1 as usize * 8, a);
                    write_word(memory, &mut store, 0x108 + rs2 as usize * 8, b);
                    let control =
                        (1_u64 << 52) | 8 | (u64::from(frm) << 5) | if fs == 0 { 0 } else { 0x100 };
                    write_word(memory, &mut store, 0x208, control);
                    write_word(memory, &mut store, 0x230, proof::PC);
                    write_word(memory, &mut store, 0x250, 0);
                    let before = memory.data(&store).to_vec();
                    let old_calls = store.data().divisions.len();
                    let resolved = if rm == 7 { frm } else { rm };
                    let legal = fs != 0 && resolved < 5;
                    let exit = run.call(&mut store, 0).unwrap();
                    assert_eq!(
                        ExitCode::from_i32(exit),
                        if legal {
                            ExitCode::Fallthrough
                        } else {
                            ExitCode::IllegalInstruction
                        }
                    );
                    assert_eq!(store.data().divisions.len() - old_calls, usize::from(legal));
                    assert!(
                        store.data().arithmetic.is_empty()
                            && store.data().conversions.is_empty()
                            && store.data().to_words.is_empty()
                    );
                    assert_eq!(
                        read_word(memory, &store, 12 * 8),
                        proof::SENTINEL.wrapping_add(1)
                    );
                    assert_eq!(
                        read_word(memory, &store, 13 * 8),
                        proof::SENTINEL.wrapping_add(u64::from(legal))
                    );
                    assert_eq!(
                        read_word(memory, &store, 0x220),
                        proof::PC + if legal { 12 } else { 4 }
                    );
                    let target = 0x108 + rd as usize * 8;
                    if legal {
                        calls += 1;
                        assert_eq!(
                            store.data().divisions[old_calls],
                            [
                                if a >> 32 == 0xffff_ffff {
                                    a as i32
                                } else {
                                    0x7fc0_0000
                                },
                                if b >> 32 == 0xffff_ffff {
                                    b as i32
                                } else {
                                    0x7fc0_0000
                                },
                                i32::from(resolved)
                            ]
                        );
                        assert_eq!(
                            read_word(memory, &store, target),
                            proof::BOX | u64::from(results[resolved as usize])
                        );
                        assert_eq!(
                            read_word(memory, &store, 0x208),
                            control
                                | u64::from(flags[resolved as usize])
                                | 0x200
                                | (1_u64 << (32 + rd)),
                            "exact FPR write mask and flag publication"
                        );
                    } else {
                        assert_eq!(read_word(memory, &store, 0x228), u64::from(raw));
                        assert_eq!(
                            read_word(memory, &store, target),
                            u64::from_le_bytes(before[target..target + 8].try_into().unwrap())
                        );
                        assert_eq!(read_word(memory, &store, 0x208), control);
                    }
                    for (offset, (&old, &new)) in before.iter().zip(memory.data(&store)).enumerate()
                    {
                        let allowed = (96..112).contains(&offset)
                            || (target..target + 8).contains(&offset)
                            || (0x208..0x210).contains(&offset)
                            || (0x218..0x230).contains(&offset);
                        if !allowed {
                            assert_eq!(old, new, "unexpected state write at {offset:x}");
                        }
                    }
                    cases += 1;
                }
            }
        }
    }
    assert_eq!(cases, 1536);
    assert_eq!(calls, 810);
    eprintln!(
        "CRITIC_DIVISION_PURITY cases={cases} legal_helper_calls={calls} illegal_helper_calls=0 import_index=5 exact_masks=true integer_wasm_only=true"
    );
}
#[test]
fn verifier_mixed_optional_indices_and_integer_behavior() {
    use jit_translate::{Abi, translate_batch, translate_block};
    use wasm_vm_core::bus::mmap::DRAM_BASE;
    let root = proof::block(DRAM_BASE, &[0x001f_8f93, 0x0040_006f]);
    let convert = proof::block(DRAM_BASE + 8, &[0xd00f_8053, 0x0040_006f]);
    let arithmetic = proof::block(DRAM_BASE + 16, &[0x0000_00d3, 0x0040_006f]);
    let division = proof::block(DRAM_BASE + 24, &[proof::division(31, 1, 0, 0), 0x0040_006f]);
    let tail = proof::block(DRAM_BASE + 32, &[0xc01f_8fd3, 0x001f_8f13]);
    let abi = Abi {
        direct_chain: true,
        ..Abi::FROZEN
    };
    let bytes = translate_batch(
        &[root.clone(), convert, arithmetic, division, tail],
        &abi,
        &[
            [Some(1), None],
            [Some(2), None],
            [Some(3), None],
            [Some(4), None],
            [None, None],
        ],
    )
    .unwrap();
    assert_eq!(
        function_imports(&bytes),
        [
            "load",
            "store",
            "amo",
            "lr",
            "sc",
            "fp_arith_s",
            "fp_from_int_s",
            "fp_to_word_s",
            "fp_div_s"
        ]
        .map(|s| ("env".to_string(), s.to_string()))
    );
    let (exports, calls) = check_integer_wasm_and_calls(&bytes);
    assert_eq!(
        exports,
        (0..5)
            .map(|i| (format!("run{i}"), 9 + i))
            .collect::<Vec<_>>()
    );
    for index in [5, 6, 7, 8, 10, 11, 12, 13] {
        assert!(
            calls.contains(&index),
            "missing actual generated call to {index}"
        );
    }
    let engine = wasmtime::Engine::default();
    let linker = instrumented_linker(&engine);
    let module = wasmtime::Module::new(&engine, &bytes).unwrap();
    let mut store = wasmtime::Store::new(&engine, Probe::default());
    let instance = linker.instantiate(&mut store, &module).unwrap();
    let memory = instance.get_memory(&mut store, "mem").unwrap();
    for (offset, value) in [
        (31 * 8, 2),
        (0x208, 0x108),
        (0x230, proof::PC),
        (0x250, 1),
        (0x260, 64),
        (0x240, 64),
    ] {
        write_word(memory, &mut store, offset, value);
    }
    instance
        .get_typed_func::<(i32, i32, i64), i32>(&mut store, "run0")
        .unwrap()
        .call(&mut store, (0, 1, 0))
        .unwrap();
    assert_eq!(store.data().conversions, [[3, 0, 0]]);
    assert_eq!(store.data().arithmetic, [[0x4040_0000, 0x4040_0000, 0, 0]]);
    assert_eq!(store.data().divisions, [[0x40c0_0000, 0x4040_0000, 0]]);
    assert_eq!(store.data().to_words, [[0x4000_0000, 1, 0]]);
    assert_eq!(read_word(memory, &store, 31 * 8), 2);
    assert_eq!(read_word(memory, &store, 30 * 8), 3);
    assert_eq!(read_word(memory, &store, 0x108), proof::BOX | 0x4040_0000);
    assert_eq!(read_word(memory, &store, 0x110), proof::BOX | 0x40c0_0000);
    assert_eq!(
        read_word(memory, &store, 0x108 + 31 * 8),
        proof::BOX | 0x4000_0000
    );
    assert_eq!(read_word(memory, &store, 0x208), 0x8000_0003_0000_0308);
    assert_eq!(read_word(memory, &store, 0x220), proof::PC + 40);
    assert_eq!(read_word(memory, &store, 0x248) >> 32, 0xc000_0000);
    for mask in 0..8 {
        let mut words = vec![];
        let mut names = vec!["load", "store", "amo", "lr", "sc"];
        if mask & 1 != 0 {
            words.push(0x0000_00d3);
            names.push("fp_arith_s");
        }
        if mask & 2 != 0 {
            words.push(0xd00f_8153);
            names.push("fp_from_int_s");
        }
        if mask & 4 != 0 {
            words.push(0xc010_0ed3);
            names.push("fp_to_word_s");
        }
        words.push(proof::division(31, 0, 30, 0));
        names.push("fp_div_s");
        let block = proof::block(DRAM_BASE, &words);
        for (bytes, name) in [
            (translate_block(&block, &Abi::FROZEN).unwrap(), "run"),
            (
                translate_batch(&[block], &Abi::FROZEN, &[[None, None]]).unwrap(),
                "run0",
            ),
        ] {
            assert_eq!(
                function_imports(&bytes),
                names
                    .iter()
                    .map(|s| ("env".to_string(), s.to_string()))
                    .collect::<Vec<_>>()
            );
            let (exports, sites) = check_integer_wasm_and_calls(&bytes);
            assert_eq!(exports, [(name.to_string(), names.len() as u32)]);
            assert!(sites.contains(&(names.len() as u32 - 1)));
            let module = wasmtime::Module::new(&engine, &bytes).unwrap();
            let mut store = wasmtime::Store::new(&engine, Probe::default());
            let instance = linker.instantiate(&mut store, &module).unwrap();
            let memory = instance.get_memory(&mut store, "mem").unwrap();
            for (offset, value) in [
                (31 * 8, 3),
                (0x108, proof::BOX | 0x3fc0_0000),
                (0x108 + 30 * 8, proof::BOX | 0x3f00_0000),
                (0x208, 0x100),
                (0x230, proof::PC),
            ] {
                write_word(memory, &mut store, offset, value);
            }
            instance
                .get_typed_func::<i32, i32>(&mut store, name)
                .unwrap()
                .call(&mut store, 0)
                .unwrap();
            assert_eq!(store.data().divisions, [[0x3fc0_0000, 0x3f00_0000, 0]]);
            assert_eq!(
                read_word(memory, &store, 0x108 + 31 * 8),
                proof::BOX | 0x4040_0000
            );
            assert_eq!(
                read_word(memory, &store, 0x208) & 31,
                u64::from(mask & 4 != 0)
            );
            assert_eq!(
                read_word(memory, &store, 0x208) >> 32,
                0x8000_0000 | if mask & 1 != 0 { 2 } else { 0 } | if mask & 2 != 0 { 4 } else { 0 }
            );
            assert_eq!(store.data().arithmetic.len(), usize::from(mask & 1 != 0));
            assert_eq!(store.data().conversions.len(), usize::from(mask & 2 != 0));
            assert_eq!(store.data().to_words.len(), usize::from(mask & 4 != 0));
        }
    }
    let bytes = translate_block(&root, &Abi::FROZEN).unwrap();
    assert_eq!(
        function_imports(&bytes),
        ["load", "store", "amo", "lr", "sc"].map(|s| ("env".to_string(), s.to_string()))
    );
    let module = wasmtime::Module::new(&engine, &bytes).unwrap();
    let mut store = wasmtime::Store::new(&engine, Probe::default());
    let instance = linker.instantiate(&mut store, &module).unwrap();
    let memory = instance.get_memory(&mut store, "mem").unwrap();
    write_word(memory, &mut store, 31 * 8, u64::MAX);
    write_word(memory, &mut store, 0x230, proof::PC);
    instance
        .get_typed_func::<i32, i32>(&mut store, "run")
        .unwrap()
        .call(&mut store, 0)
        .unwrap();
    assert_eq!(read_word(memory, &store, 31 * 8), 0);
    assert_eq!(read_word(memory, &store, 0x220), proof::PC + 8);
    assert!(
        store.data().divisions.is_empty()
            && store.data().to_words.is_empty()
            && store.data().arithmetic.is_empty()
            && store.data().conversions.is_empty()
    );
    for raw in [
        0xc020_0053,
        0xc030_0053,
        0xc200_0053,
        0xd200_0053,
        0x0800_0053,
        0x1a00_0053,
        0x0200_0053,
        0x0000_0047,
        0x5800_0053,
    ] {
        assert!(
            translate_block(&proof::block(DRAM_BASE, &[raw]), &Abi::FROZEN).is_err(),
            "unselected FP parcel {raw:08x} admitted"
        );
    }
    eprintln!(
        "CRITIC_DIVISION_INDICES imports=9 exports=run0:9,run1:10,run2:11,run3:12,run4:13 all_optional_combinations=8 mixed_chain_executed=true integer_imports=5 unsupported_families=9"
    );
}
