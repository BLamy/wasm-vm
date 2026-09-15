#[path = "../../../tests/support/jit_fp_from_integer_verifier.rs"]
mod proof;

fn native(_: &wasm_vm_core::Machine) -> Box<dyn wasm_vm_core::jit::CompiledBlockExecutor> {
    Box::new(jit_runtime::WasmtimeExecutor::new())
}
#[test]
fn verifier_native_conversion_literals() {
    eprintln!(
        "CRITIC_NATIVE_FROM_INT_LITERALS {:?}",
        proof::literal_goldens(native, false)
    );
}
#[test]
fn verifier_native_conversion_seeded_aliases_and_illegal() {
    eprintln!(
        "CRITIC_NATIVE_FROM_INT_SEEDED {:?}",
        proof::seeded_aliases_and_illegal(native, false)
    );
}
#[test]
fn verifier_native_conversion_control_and_faults() {
    eprintln!(
        "CRITIC_NATIVE_FROM_INT_CONTROL {:?}",
        proof::control_and_faults(native, false)
    );
}

#[derive(Default)]
struct Probe {
    conversions: Vec<[i64; 3]>,
    arithmetic: Vec<[i32; 4]>,
}
fn instrumented_linker(engine: &wasmtime::Engine) -> wasmtime::Linker<Probe> {
    let mut linker = wasmtime::Linker::new(engine);
    linker
        .func_wrap("env", "load", |_: i64, _: i32| -> i64 {
            panic!("conversion touched guest memory")
        })
        .unwrap();
    linker
        .func_wrap("env", "store", |_: i64, _: i64, _: i32| -> () {
            panic!("conversion touched guest memory")
        })
        .unwrap();
    linker
        .func_wrap("env", "amo", |_: i64, _: i64, _: i32, _: i32| -> i64 {
            panic!("conversion touched atomics")
        })
        .unwrap();
    linker
        .func_wrap("env", "lr", |_: i64, _: i32| -> i64 {
            panic!("conversion touched reservation state")
        })
        .unwrap();
    linker
        .func_wrap("env", "sc", |_: i64, _: i64, _: i32| -> i64 {
            panic!("conversion touched reservation state")
        })
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
fn probe_golden(kind: u8, source: u64, rm: usize) -> (u64, u64) {
    if source == 0 {
        return (0, 0);
    }
    match (kind, source) {
        (0 | 2, u64::MAX) => (0xbf80_0000, 0),
        (1, u64::MAX) => (
            [
                0x4f80_0000,
                0x4f7f_ffff,
                0x4f7f_ffff,
                0x4f80_0000,
                0x4f80_0000,
            ][rm],
            1,
        ),
        (3, u64::MAX) => (
            [
                0x5f80_0000,
                0x5f7f_ffff,
                0x5f7f_ffff,
                0x5f80_0000,
                0x5f80_0000,
            ][rm],
            1,
        ),
        (0 | 1, 0x8000_0000_0000_0001) => (0x3f80_0000, 0),
        (2, 0x8000_0000_0000_0001) => (
            [
                0xdf00_0000,
                0xdeff_ffff,
                0xdf00_0000,
                0xdeff_ffff,
                0xdf00_0000,
            ][rm],
            1,
        ),
        (3, 0x8000_0000_0000_0001) => (
            [
                0x5f00_0000,
                0x5f00_0000,
                0x5f00_0000,
                0x5f00_0001,
                0x5f00_0000,
            ][rm],
            1,
        ),
        _ => panic!("missing independent literal"),
    }
}

#[test]
fn verifier_generated_conversion_helper_counts_and_purity() {
    use jit_translate::{Abi, translate_block};
    use wasm_vm_core::bus::mmap::DRAM_BASE;
    use wasm_vm_core::jit::ExitCode;
    let engine = wasmtime::Engine::default();
    let linker = instrumented_linker(&engine);
    let mut cases = 0;
    let mut calls = 0;
    for kind in 0..4 {
        for rm in 0..8 {
            for (rs, rd, input) in [
                (31, 0, u64::MAX),
                (0, 31, u64::MAX),
                (31, 31, 0x8000_0000_0000_0001),
            ] {
                let raw = proof::conversion(kind, rd, rs, rm);
                let bytes = translate_block(
                    &proof::block(DRAM_BASE, &[0x0016_0613, raw, 0x0016_8693]),
                    &Abi::FROZEN,
                )
                .unwrap();
                assert_eq!(
                    function_imports(&bytes),
                    ["load", "store", "amo", "lr", "sc", "fp_from_int_s"]
                        .map(|s| ("env".to_string(), s.to_string()))
                );
                let mut sites = 0;
                for item in wasmparser::Parser::new(0).parse_all(&bytes) {
                    if let wasmparser::Payload::CodeSectionEntry(body) = item.unwrap() {
                        for op in body.get_operators_reader().unwrap() {
                            let op = op.unwrap();
                            let name = format!("{op:?}");
                            assert!(
                                !name.contains("F32") && !name.contains("F64"),
                                "host FP opcode: {name}"
                            );
                            if let wasmparser::Operator::Call { function_index } = op {
                                assert_eq!(function_index, 5);
                                sites += 1;
                            }
                        }
                    }
                }
                assert_eq!(sites, 1);
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
                        if rs != 0 {
                            write_word(memory, &mut store, rs as usize * 8, input);
                        }
                        let source = if rs == 0 { 0 } else { input };
                        let control = 8 | (u64::from(frm) << 5) | if fs == 0 { 0 } else { 0x100 };
                        write_word(memory, &mut store, 0x208, control);
                        write_word(memory, &mut store, 0x230, proof::PC);
                        write_word(memory, &mut store, 0x250, 0);
                        let before = memory.data(&store).to_vec();
                        let old_calls = store.data().conversions.len();
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
                        assert_eq!(
                            store.data().conversions.len() - old_calls,
                            usize::from(legal)
                        );
                        assert!(store.data().arithmetic.is_empty());
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
                            calls += 1;
                            assert_eq!(
                                store.data().conversions[old_calls],
                                [source as i64, i64::from(kind), i64::from(resolved)]
                            );
                            let (bits, flags) = probe_golden(kind, source, resolved as usize);
                            assert_eq!(
                                read_word(memory, &store, 0x108 + rd as usize * 8),
                                proof::BOX | bits
                            );
                            assert_eq!(
                                read_word(memory, &store, 0x208),
                                control | flags | 0x200 | (1_u64 << (32 + rd))
                            );
                        } else {
                            assert_eq!(read_word(memory, &store, 0x228), u64::from(raw));
                            assert_eq!(
                                read_word(memory, &store, 0x108 + rd as usize * 8),
                                proof::SENTINEL ^ u64::from(rd)
                            );
                            assert_eq!(read_word(memory, &store, 0x208), control);
                        }
                        for (offset, (&old, &new)) in
                            before.iter().zip(memory.data(&store)).enumerate()
                        {
                            let freg = 0x108 + rd as usize * 8;
                            let allowed = (96..112).contains(&offset)
                                || (freg..freg + 8).contains(&offset)
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
    assert_eq!(cases, 3072);
    assert_eq!(calls, 1620);
    eprintln!(
        "CRITIC_FROM_INT_PURITY cases={cases} legal_helper_calls={calls} illegal_helper_calls=0 import_index=5 integer_wasm_only=true"
    );
}

#[test]
fn verifier_mixed_conversion_arithmetic_function_indices() {
    use jit_translate::{Abi, translate_batch, translate_block};
    use wasm_vm_core::bus::mmap::DRAM_BASE;
    let root = proof::block(DRAM_BASE, &[0x001f_8f93, 0x0040_006f]);
    let convert = proof::block(
        DRAM_BASE + 8,
        &[proof::conversion(3, 0, 31, 3), 0x0040_006f],
    );
    let arithmetic = proof::block(DRAM_BASE + 16, &[0x0000_00d3, 0x0040_006f]); // fadd.s f1,f0,f0
    let tail = proof::block(DRAM_BASE + 24, &[proof::conversion(0, 31, 0, 0)]);
    let abi = Abi {
        direct_chain: true,
        ..Abi::FROZEN
    };
    let bytes = translate_batch(
        &[root.clone(), convert.clone(), arithmetic.clone(), tail],
        &abi,
        &[
            [Some(1), None],
            [Some(2), None],
            [Some(3), None],
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
            "fp_from_int_s"
        ]
        .map(|s| ("env".to_string(), s.to_string()))
    );
    let mut exports = Vec::new();
    let mut call_indices = Vec::new();
    for item in wasmparser::Parser::new(0).parse_all(&bytes) {
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
                    if let wasmparser::Operator::Call { function_index } = op.unwrap() {
                        call_indices.push(function_index);
                    }
                }
            }
            _ => (),
        }
    }
    assert_eq!(
        exports,
        [
            ("run0".to_string(), 7),
            ("run1".to_string(), 8),
            ("run2".to_string(), 9),
            ("run3".to_string(), 10)
        ]
    );
    for index in [5, 6, 8, 9, 10] {
        assert!(
            call_indices.contains(&index),
            "missing actual generated call to {index}"
        );
    }
    let engine = wasmtime::Engine::default();
    let module = wasmtime::Module::new(&engine, &bytes).unwrap();
    let linker = instrumented_linker(&engine);
    let mut store = wasmtime::Store::new(&engine, Probe::default());
    let instance = linker.instantiate(&mut store, &module).unwrap();
    let memory = instance.get_memory(&mut store, "mem").unwrap();
    for (offset, value) in [
        (31 * 8, 1 << 24),
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
    assert_eq!(store.data().conversions, [[0x0100_0001, 3, 3], [0, 0, 0]]);
    assert_eq!(store.data().arithmetic, [[0x4b80_0001, 0x4b80_0001, 0, 0]]);
    assert_eq!(read_word(memory, &store, 31 * 8), 0x0100_0001);
    assert_eq!(read_word(memory, &store, 0x108), proof::BOX | 0x4b80_0001);
    assert_eq!(read_word(memory, &store, 0x110), proof::BOX | 0x4c00_0001);
    assert_eq!(read_word(memory, &store, 0x108 + 31 * 8), proof::BOX);
    assert_eq!(read_word(memory, &store, 0x208) & 0xff, 9);
    assert_eq!(read_word(memory, &store, 0x220), proof::PC + 28);
    for (block, names) in [
        (root, vec!["load", "store", "amo", "lr", "sc"]),
        (
            convert,
            vec!["load", "store", "amo", "lr", "sc", "fp_from_int_s"],
        ),
        (
            arithmetic,
            vec!["load", "store", "amo", "lr", "sc", "fp_arith_s"],
        ),
    ] {
        let single = translate_block(&block, &Abi::FROZEN).unwrap();
        let batch = translate_batch(&[block], &Abi::FROZEN, &[[None, None]]).unwrap();
        let want = names
            .into_iter()
            .map(|name| ("env".to_string(), name.to_string()))
            .collect::<Vec<_>>();
        assert_eq!(function_imports(&single), want);
        assert_eq!(function_imports(&batch), want);
    }
    for raw in [
        0x0800_0053,
        0x1800_0053,
        0x0200_0053,
        0xc000_0053,
        0xd200_0053,
        0x0000_0043,
    ] {
        assert!(
            translate_block(&proof::block(DRAM_BASE, &[raw]), &Abi::FROZEN).is_err(),
            "unselected FP parcel {raw:08x} admitted"
        );
    }
    eprintln!(
        "CRITIC_FROM_INT_INDICES imports=7 exports=run0:7,run1:8,run2:9,run3:10 actual_integer_conversion_arithmetic_conversion_chain=true integer_imports=5 unsupported_families=6"
    );
}
