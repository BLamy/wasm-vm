#[path = "../../../tests/support/jit_fp_arithmetic_verifier.rs"]
mod proof;

fn native(_: &wasm_vm_core::Machine) -> Box<dyn wasm_vm_core::jit::CompiledBlockExecutor> {
    Box::new(jit_runtime::WasmtimeExecutor::new())
}

#[test]
fn verifier_native_literal_arithmetic_goldens() {
    eprintln!(
        "CRITIC_NATIVE_ARITHMETIC_GOLDENS {:?}",
        proof::literal_goldens(native, false)
    );
}

#[test]
fn verifier_native_seeded_arithmetic_aliases_and_illegal() {
    eprintln!(
        "CRITIC_NATIVE_ARITHMETIC_SEEDED {:?}",
        proof::seeded_exact_aliases_and_illegal(native, false)
    );
}

#[test]
fn verifier_native_arithmetic_control_handoff_and_faults() {
    eprintln!(
        "CRITIC_NATIVE_ARITHMETIC_CONTROL {:?}",
        proof::control_handoff_and_faults(native, false)
    );
}

#[derive(Default)]
struct Probe {
    calls: Vec<[i32; 4]>,
}

fn instrumented_linker(engine: &wasmtime::Engine) -> wasmtime::Linker<Probe> {
    let mut linker = wasmtime::Linker::new(engine);
    linker
        .func_wrap("env", "load", |_: i64, _: i32| -> i64 {
            panic!("arithmetic touched guest memory")
        })
        .unwrap();
    linker
        .func_wrap("env", "store", |_: i64, _: i64, _: i32| -> () {
            panic!("arithmetic touched guest memory")
        })
        .unwrap();
    linker
        .func_wrap("env", "amo", |_: i64, _: i64, _: i32, _: i32| -> i64 {
            panic!("arithmetic touched atomics")
        })
        .unwrap();
    linker
        .func_wrap("env", "lr", |_: i64, _: i32| -> i64 {
            panic!("arithmetic touched reservation state")
        })
        .unwrap();
    linker
        .func_wrap("env", "sc", |_: i64, _: i64, _: i32| -> i64 {
            panic!("arithmetic touched reservation state")
        })
        .unwrap();
    linker
        .func_wrap(
            "env",
            "fp_arith_s",
            |mut caller: wasmtime::Caller<'_, Probe>,
             a: i32,
             b: i32,
             multiply: i32,
             rm: i32|
             -> i64 {
                assert!(
                    (0..5).contains(&rm),
                    "invalid rounding reached arithmetic helper"
                );
                assert!((0..2).contains(&multiply), "bad arithmetic opcode");
                caller.data_mut().calls.push([a, b, multiply, rm]);
                wasm_vm_core::jit::fp_arith_s(a as u32, b as u32, multiply != 0, rm as u8) as i64
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

#[test]
fn verifier_generated_arithmetic_helper_counts_and_purity() {
    use jit_translate::{Abi, translate_block};
    use wasm_vm_core::bus::mmap::DRAM_BASE;
    use wasm_vm_core::jit::ExitCode;
    let engine = wasmtime::Engine::default();
    let linker = instrumented_linker(&engine);
    let mut cases = 0;
    let mut total_calls = 0;
    for multiply in [false, true] {
        for rm in 0..8_u8 {
            let raw = proof::arithmetic(multiply, 31, 1, 2, rm);
            let bytes = translate_block(
                &proof::block(DRAM_BASE, &[0x0016_0613, raw, 0x0016_8693]),
                &Abi::FROZEN,
            )
            .unwrap();
            assert_eq!(
                function_imports(&bytes),
                ["load", "store", "amo", "lr", "sc", "fp_arith_s"]
                    .map(|name| ("env".to_string(), name.to_string()))
            );
            let mut helper_sites = 0;
            for item in wasmparser::Parser::new(0).parse_all(&bytes) {
                if let wasmparser::Payload::CodeSectionEntry(body) = item.unwrap() {
                    for op in body.get_operators_reader().unwrap() {
                        let op = op.unwrap();
                        let name = format!("{op:?}");
                        assert!(
                            !name.contains("F32") && !name.contains("F64"),
                            "host FP instruction: {name}"
                        );
                        if let wasmparser::Operator::Call { function_index } = op {
                            assert_eq!(
                                function_index, 5,
                                "pure arithmetic block called an unexpected import"
                            );
                            helper_sites += 1;
                        }
                    }
                }
            }
            assert_eq!(helper_sites, 1);
            let module = wasmtime::Module::new(&engine, &bytes).unwrap();
            let mut store = wasmtime::Store::new(&engine, Probe::default());
            let instance = linker.instantiate(&mut store, &module).unwrap();
            let memory = instance.get_memory(&mut store, "mem").unwrap();
            let run = instance
                .get_typed_func::<i32, i32>(&mut store, "run")
                .unwrap();
            for fs in 0..4_u8 {
                for frm in 0..8_u8 {
                    for malformed in [false, true] {
                        memory.data_mut(&mut store).fill(0x5a);
                        // These literal offsets independently pin the old handoff ABI.
                        for r in 0..32 {
                            write_word(
                                memory,
                                &mut store,
                                r * 8,
                                if r == 0 { 0 } else { proof::SENTINEL },
                            );
                        }
                        for r in 0..32 {
                            write_word(memory, &mut store, 0x108 + r * 8, proof::SENTINEL);
                        }
                        let a = if malformed {
                            0xffff_fffe_7f80_0001
                        } else {
                            proof::BOX | 0x3f80_0000
                        };
                        let b = proof::BOX | if multiply { 0x4000_0000 } else { 0x3380_0000 };
                        write_word(memory, &mut store, 0x108 + 8, a);
                        write_word(memory, &mut store, 0x108 + 16, b);
                        let control = 8 | (u64::from(frm) << 5) | if fs == 0 { 0 } else { 0x100 };
                        write_word(memory, &mut store, 0x208, control);
                        write_word(memory, &mut store, 0x230, proof::PC);
                        write_word(memory, &mut store, 0x250, 0);
                        let before = memory.data(&store).to_vec();
                        let old_calls = store.data().calls.len();
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
                        assert_eq!(store.data().calls.len() - old_calls, usize::from(legal));
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
                        if legal {
                            total_calls += 1;
                            assert_eq!(
                                store.data().calls[old_calls],
                                [
                                    if malformed { 0x7fc0_0000 } else { 0x3f80_0000 },
                                    b as i32,
                                    i32::from(multiply),
                                    i32::from(resolved)
                                ]
                            );
                            let result = if malformed {
                                0x7fc0_0000
                            } else if multiply {
                                0x4000_0000
                            } else if resolved >= 3 {
                                0x3f80_0001
                            } else {
                                0x3f80_0000
                            };
                            let flags = u64::from(!malformed && !multiply);
                            assert_eq!(
                                read_word(memory, &store, 0x108 + 31 * 8),
                                proof::BOX | result
                            );
                            assert_eq!(
                                read_word(memory, &store, 0x208),
                                control | flags | 0x200 | (1 << 63)
                            );
                        } else {
                            assert_eq!(read_word(memory, &store, 0x228), u64::from(raw));
                            assert_eq!(read_word(memory, &store, 0x108 + 31 * 8), proof::SENTINEL);
                            assert_eq!(read_word(memory, &store, 0x208), control);
                        }
                        // All bytes outside architectural outputs remain unchanged. There is
                        // no guest bus or scheduler in this harness for the helper to touch.
                        for (offset, (&old, &new)) in
                            before.iter().zip(memory.data(&store)).enumerate()
                        {
                            let allowed = (96..104).contains(&offset)
                                || (104..112).contains(&offset)
                                || (0x200..0x210).contains(&offset)
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
    assert_eq!(cases, 1024);
    assert_eq!(total_calls, 540);
    eprintln!(
        "CRITIC_ARITHMETIC_IMPORT cases={cases} legal_helper_calls={total_calls} illegal_helper_calls=0 import_index=5 integer_wasm_only=true"
    );
}

#[test]
fn verifier_mixed_batch_function_indices_and_unselected_fallbacks() {
    use jit_translate::{Abi, translate_batch, translate_block};
    use wasm_vm_core::bus::mmap::DRAM_BASE;
    let root = proof::block(DRAM_BASE, &[0x0016_0613, 0x0040_006f]);
    let middle = proof::block(
        DRAM_BASE + 8,
        &[proof::arithmetic(false, 3, 1, 2, 3), 0x0040_006f],
    );
    let tail = proof::block(DRAM_BASE + 16, &[0x0016_8693]);
    let chain_abi = Abi {
        direct_chain: true,
        ..Abi::FROZEN
    };
    let bytes = translate_batch(
        &[root.clone(), middle, tail],
        &chain_abi,
        &[[Some(1), None], [Some(2), None], [None, None]],
    )
    .unwrap();
    let engine = wasmtime::Engine::default();
    let module = wasmtime::Module::new(&engine, &bytes).unwrap();
    let mut exports = Vec::new();
    for item in wasmparser::Parser::new(0).parse_all(&bytes) {
        if let wasmparser::Payload::ExportSection(section) = item.unwrap() {
            for item in section {
                let export = item.unwrap();
                if export.kind == wasmparser::ExternalKind::Func {
                    exports.push((export.name.to_string(), export.index));
                }
            }
        }
    }
    assert_eq!(
        exports,
        [
            ("run0".to_string(), 6),
            ("run1".to_string(), 7),
            ("run2".to_string(), 8)
        ]
    );
    let linker = instrumented_linker(&engine);
    let mut store = wasmtime::Store::new(&engine, Probe::default());
    let instance = linker.instantiate(&mut store, &module).unwrap();
    let memory = instance.get_memory(&mut store, "mem").unwrap();
    for (offset, value) in [
        (0x110, proof::BOX | 0x3f80_0000),
        (0x118, proof::BOX | 0x3380_0000),
        (0x208, 0x108),
        (0x230, proof::PC),
        (0x250, 1),
        (0x260, 64),
        (0x240, 64),
    ] {
        write_word(memory, &mut store, offset, value);
    }
    let run = instance
        .get_typed_func::<(i32, i32, i64), i32>(&mut store, "run0")
        .unwrap();
    run.call(&mut store, (0, 1, 0)).unwrap();
    assert_eq!(store.data().calls, [[0x3f80_0000, 0x3380_0000, 0, 3]]);
    assert_eq!(read_word(memory, &store, 12 * 8), 1);
    assert_eq!(read_word(memory, &store, 13 * 8), 1);
    assert_eq!(
        read_word(memory, &store, 0x108 + 3 * 8),
        proof::BOX | 0x3f80_0001
    );
    assert_eq!(read_word(memory, &store, 0x208) & 0xff, 9);
    assert_eq!(read_word(memory, &store, 0x220), proof::PC + 20);
    let integer = translate_block(&root, &Abi::FROZEN).unwrap();
    assert_eq!(function_imports(&integer).len(), 5);
    let unchanged_integer = translate_batch(&[root], &Abi::FROZEN, &[[None, None]]).unwrap();
    assert_eq!(function_imports(&unchanged_integer).len(), 5);
    for raw in [
        0x0800_0053,
        0x1800_0053,
        0x0200_0053,
        0x1200_0053,
        0xc000_0053,
    ] {
        assert!(
            translate_block(&proof::block(DRAM_BASE, &[raw]), &Abi::FROZEN).is_err(),
            "unselected FP parcel {raw:08x} admitted"
        );
    }
    eprintln!(
        "CRITIC_ARITHMETIC_INDICES imports=6 exports=run0:6,run1:7,run2:8 actual_chain=true integer_imports=5 unsupported_families=5"
    );
}
