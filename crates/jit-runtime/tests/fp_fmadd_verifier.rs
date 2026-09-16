#[path = "../../../tests/support/jit_fp_fmadd_verifier.rs"]
mod proof;

fn native(_: &wasm_vm_core::Machine) -> Box<dyn wasm_vm_core::jit::CompiledBlockExecutor> {
    Box::new(jit_runtime::WasmtimeExecutor::new())
}
#[test]
fn verifier_native_fmadd_literals() {
    eprintln!(
        "CRITIC_NATIVE_FMADD_LITERALS {:?}",
        proof::literal_goldens(native, false)
    );
}
#[test]
fn verifier_native_fmadd_seeded_aliases_and_illegal() {
    eprintln!(
        "CRITIC_NATIVE_FMADD_SEEDED {:?}",
        proof::seeded_aliases_and_illegal(native, false)
    );
}
#[test]
fn verifier_native_fmadd_control_and_faults() {
    eprintln!(
        "CRITIC_NATIVE_FMADD_CONTROL {:?}",
        proof::control_and_faults(native, false)
    );
}

#[derive(Default)]
struct Probe {
    fmadds: Vec<[i32; 4]>,
    divisions: Vec<[i32; 3]>,
    conversions: Vec<[i64; 3]>,
    arithmetic: Vec<[i32; 4]>,
    to_words: Vec<[i32; 3]>,
}
fn instrumented_linker(engine: &wasmtime::Engine) -> wasmtime::Linker<Probe> {
    let mut linker = wasmtime::Linker::new(engine);
    linker
        .func_wrap("env", "load", |_: i64, _: i32| -> i64 {
            panic!("FMA touched guest memory")
        })
        .unwrap();
    linker
        .func_wrap("env", "store", |_: i64, _: i64, _: i32| -> () {
            panic!("FMA touched guest memory")
        })
        .unwrap();
    linker
        .func_wrap("env", "amo", |_: i64, _: i64, _: i32, _: i32| -> i64 {
            panic!("FMA touched atomics")
        })
        .unwrap();
    linker
        .func_wrap("env", "lr", |_: i64, _: i32| -> i64 {
            panic!("FMA touched reservation state")
        })
        .unwrap();
    linker
        .func_wrap("env", "sc", |_: i64, _: i64, _: i32| -> i64 {
            panic!("FMA touched reservation state")
        })
        .unwrap();
    linker
        .func_wrap(
            "env",
            "fp_to_word_s",
            |mut caller: wasmtime::Caller<'_, Probe>, bits: i32, unsigned: i32, rm: i32| -> i64 {
                assert!((0..2).contains(&unsigned));
                assert!((0..5).contains(&rm));
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
                assert!((0..4).contains(&width));
                assert!((0..5).contains(&rm));
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
                assert!((0..5).contains(&rm));
                caller.data_mut().divisions.push([a, b, rm]);
                wasm_vm_core::jit::fp_div_s(a as u32, b as u32, rm as u8) as i64
            },
        )
        .unwrap();
    linker
        .func_wrap(
            "env",
            "fp_fmadd_s",
            |mut caller: wasmtime::Caller<'_, Probe>, a: i32, b: i32, c: i32, rm: i32| -> i64 {
                assert!((0..5).contains(&rm), "invalid mode reached FMADD helper");
                caller.data_mut().fmadds.push([a, b, c, rm]);
                wasm_vm_core::jit::fp_fmadd_s(a as u32, b as u32, c as u32, rm as u8) as i64
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
fn inspect(bytes: &[u8]) -> (Vec<String>, Vec<(String, u32)>, Vec<u32>) {
    let mut imports = Vec::new();
    let mut exports = Vec::new();
    let mut calls = Vec::new();
    for item in wasmparser::Parser::new(0).parse_all(bytes) {
        match item.unwrap() {
            wasmparser::Payload::ImportSection(section) => {
                for item in section {
                    let import = item.unwrap();
                    if matches!(import.ty, wasmparser::TypeRef::Func(_)) {
                        assert_eq!(import.module, "env");
                        imports.push(import.name.to_string());
                    }
                }
            }
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
                        "host FP opcode {name}"
                    );
                    if let wasmparser::Operator::Call { function_index } = op {
                        calls.push(function_index);
                    }
                }
            }
            _ => (),
        }
    }
    (imports, exports, calls)
}

#[test]
fn verifier_generated_fmadd_helper_counts_and_purity() {
    use jit_translate::{Abi, translate_block};
    use wasm_vm_core::bus::mmap::DRAM_BASE;
    use wasm_vm_core::jit::ExitCode;
    let engine = wasmtime::Engine::default();
    let linker = instrumented_linker(&engine);
    let selected: Vec<_> = proof::GOLDENS
        .iter()
        .filter(|g| {
            g.name == "fused_cancellation"
                || g.name == "intermediate_overflow_cancelled"
                || g.name.starts_with("special_operand_")
                || g.name == "tiny_half_normal_0"
                || g.name == "zero_inf_7fc01234"
                || g.name == "malformed_addend_invalid_product"
        })
        .collect();
    assert_eq!(selected.len(), 20);
    let mut cases = 0;
    let mut calls = 0;
    for rm in 0..8 {
        for rd in [0, 29, 30, 31] {
            let raw = proof::fmadd(rd, 0, 29, 30, rm);
            let bytes = translate_block(
                &proof::block(DRAM_BASE, &[0x0016_0613, raw, 0x0016_8693]),
                &Abi::FROZEN,
            )
            .unwrap();
            let (imports, exports, sites) = inspect(&bytes);
            assert_eq!(imports, ["load", "store", "amo", "lr", "sc", "fp_fmadd_s"]);
            assert_eq!(exports, [("run".to_string(), 6)]);
            assert_eq!(sites, [5]);
            let module = wasmtime::Module::new(&engine, &bytes).unwrap();
            let mut store = wasmtime::Store::new(&engine, Probe::default());
            let instance = linker.instantiate(&mut store, &module).unwrap();
            let memory = instance.get_memory(&mut store, "mem").unwrap();
            let run = instance
                .get_typed_func::<i32, i32>(&mut store, "run")
                .unwrap();
            for g in &selected {
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
                        for (r, v) in [0, 29, 30].into_iter().zip(g.operands) {
                            write_word(memory, &mut store, 0x108 + r * 8, v);
                        }
                        let control = (1_u64 << 52)
                            | 8
                            | (u64::from(frm) << 5)
                            | if fs == 0 { 0 } else { 0x100 };
                        write_word(memory, &mut store, 0x208, control);
                        write_word(memory, &mut store, 0x230, proof::PC);
                        write_word(memory, &mut store, 0x250, 0);
                        let before = memory.data(&store).to_vec();
                        let old_calls = store.data().fmadds.len();
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
                        assert_eq!(store.data().fmadds.len() - old_calls, usize::from(legal));
                        assert!(
                            store.data().arithmetic.is_empty()
                                && store.data().conversions.is_empty()
                                && store.data().to_words.is_empty()
                                && store.data().divisions.is_empty()
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
                            let [a, b, c] = g.operands.map(|v| {
                                if v >> 32 == 0xffff_ffff {
                                    v as i32
                                } else {
                                    0x7fc0_0000
                                }
                            });
                            assert_eq!(
                                store.data().fmadds[old_calls],
                                [a, b, c, i32::from(resolved)]
                            );
                            assert_eq!(
                                read_word(memory, &store, target),
                                proof::BOX | u64::from(g.result[resolved as usize]),
                                "{} mode={resolved}",
                                g.name
                            );
                            assert_eq!(
                                read_word(memory, &store, 0x208),
                                control
                                    | u64::from(g.flags[resolved as usize])
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
                        for (offset, (&old, &new)) in
                            before.iter().zip(memory.data(&store)).enumerate()
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
    }
    assert_eq!(cases, 20480);
    assert_eq!(calls, 10800);
    eprintln!(
        "CRITIC_FMADD_PURITY cases={cases} legal_helper_calls={calls} illegal_helper_calls=0 import_index=5 exact_masks=true integer_wasm_only=true"
    );
}

#[test]
fn verifier_mixed_optional_indices_and_unrelated_admission() {
    use jit_translate::{Abi, translate_batch, translate_block};
    use wasm_vm_core::bus::mmap::DRAM_BASE;
    let engine = wasmtime::Engine::default();
    let linker = instrumented_linker(&engine);
    for mask in 0..16 {
        let mut words = vec![];
        let mut names = vec!["load", "store", "amo", "lr", "sc"];
        if mask & 1 != 0 {
            words.push(0x0000_0253);
            names.push("fp_arith_s");
        }
        if mask & 2 != 0 {
            words.push(0xd00f_82d3);
            names.push("fp_from_int_s");
        }
        if mask & 4 != 0 {
            words.push(0xc010_0ed3);
            names.push("fp_to_word_s");
        }
        if mask & 8 != 0 {
            words.push(0x19e0_0353);
            names.push("fp_div_s");
        }
        words.push(proof::fmadd(31, 0, 30, 29, 0));
        names.push("fp_fmadd_s");
        let block = proof::block(DRAM_BASE, &words);
        for (bytes, name) in [
            (translate_block(&block, &Abi::FROZEN).unwrap(), "run"),
            (
                translate_batch(&[block], &Abi::FROZEN, &[[None, None]]).unwrap(),
                "run0",
            ),
        ] {
            let (imports, exports, sites) = inspect(&bytes);
            assert_eq!(imports, names);
            assert_eq!(exports, [(name.to_string(), names.len() as u32)]);
            for index in 5..names.len() as u32 {
                assert!(sites.contains(&index), "missing helper {index}");
            }
            let module = wasmtime::Module::new(&engine, &bytes).unwrap();
            let mut store = wasmtime::Store::new(&engine, Probe::default());
            let instance = linker.instantiate(&mut store, &module).unwrap();
            let memory = instance.get_memory(&mut store, "mem").unwrap();
            for (offset, value) in [
                (31 * 8, 3),
                (0x108, proof::BOX | 0x3fc0_0000),
                (0x108 + 30 * 8, proof::BOX | 0x3f00_0000),
                (0x108 + 29 * 8, proof::BOX | 0x3e80_0000),
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
            assert_eq!(
                store.data().fmadds,
                [[0x3fc0_0000, 0x3f00_0000, 0x3e80_0000, 0]]
            );
            assert_eq!(
                read_word(memory, &store, 0x108 + 31 * 8),
                proof::BOX | 0x3f80_0000
            );
            assert_eq!(
                read_word(memory, &store, 0x208) & 31,
                u64::from(mask & 4 != 0)
            );
            assert_eq!(
                read_word(memory, &store, 0x208) >> 32,
                0x8000_0000
                    | if mask & 1 != 0 { 16 } else { 0 }
                    | if mask & 2 != 0 { 32 } else { 0 }
                    | if mask & 8 != 0 { 64 } else { 0 }
            );
            assert_eq!(store.data().arithmetic.len(), usize::from(mask & 1 != 0));
            assert_eq!(store.data().conversions.len(), usize::from(mask & 2 != 0));
            assert_eq!(store.data().to_words.len(), usize::from(mask & 4 != 0));
            assert_eq!(store.data().divisions.len(), usize::from(mask & 8 != 0));
        }
    }
    let blocks = [
        proof::block(DRAM_BASE, &[0x001f_8f93, 0x0040_006f]),
        proof::block(DRAM_BASE + 8, &[0xd00f_8053, 0x0040_006f]),
        proof::block(DRAM_BASE + 16, &[0x0000_00d3, 0x0040_006f]),
        proof::block(DRAM_BASE + 24, &[0x1800_8153, 0x0040_006f]),
        proof::block(DRAM_BASE + 32, &[proof::fmadd(31, 2, 0, 1, 0), 0x0040_006f]),
        proof::block(DRAM_BASE + 40, &[0xc01f_8fd3, 0x001f_8f13]),
    ];
    let bytes = translate_batch(
        &blocks,
        &Abi {
            direct_chain: true,
            ..Abi::FROZEN
        },
        &[
            [Some(1), None],
            [Some(2), None],
            [Some(3), None],
            [Some(4), None],
            [Some(5), None],
            [None, None],
        ],
    )
    .unwrap();
    let (imports, exports, calls) = inspect(&bytes);
    assert_eq!(
        imports,
        [
            "load",
            "store",
            "amo",
            "lr",
            "sc",
            "fp_arith_s",
            "fp_from_int_s",
            "fp_to_word_s",
            "fp_div_s",
            "fp_fmadd_s"
        ]
    );
    assert_eq!(
        exports,
        (0..6)
            .map(|i| (format!("run{i}"), 10 + i))
            .collect::<Vec<_>>()
    );
    for index in [5, 6, 7, 8, 9, 11, 12, 13, 14, 15] {
        assert!(calls.contains(&index), "missing mixed call {index}");
    }
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
    assert_eq!(
        store.data().fmadds,
        [[0x4000_0000, 0x4040_0000, 0x40c0_0000, 0]]
    );
    assert_eq!(store.data().to_words, [[0x4140_0000, 1, 0]]);
    assert_eq!(read_word(memory, &store, 31 * 8), 12);
    assert_eq!(read_word(memory, &store, 30 * 8), 13);
    assert_eq!(read_word(memory, &store, 0x208), 0x8000_0007_0000_0308);
    assert_eq!(read_word(memory, &store, 0x220), proof::PC + 48);
    assert_eq!(read_word(memory, &store, 0x248) >> 32, 0xc000_0000);
    let bytes = translate_block(&blocks[0], &Abi::FROZEN).unwrap();
    assert_eq!(inspect(&bytes).0, ["load", "store", "amo", "lr", "sc"]);
    for raw in [
        0xc020_0053,
        0xc030_0053,
        0xc200_0053,
        0xd200_0053,
        0x0800_0053,
        0x1a00_0053,
        0x0200_0053,
        0x0000_0047,
        0x0000_004b,
        0x0000_004f,
        0x0200_0043,
        0x0200_0047,
        0x0200_004b,
        0x0200_004f,
        0x5800_0053,
    ] {
        assert!(
            translate_block(&proof::block(DRAM_BASE, &[raw]), &Abi::FROZEN).is_err(),
            "unselected family {raw:08x}"
        );
    }
    eprintln!(
        "CRITIC_FMADD_INDICES imports=10 exports=run0:10..run5:15 all_optional_combinations=16 mixed_chain_executed=true integer_imports=5 unsupported_families=15"
    );
}
