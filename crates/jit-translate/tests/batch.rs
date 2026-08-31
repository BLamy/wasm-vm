//! E4-T19 AC3 — intra-batch direct-call codegen, asserted in the EMITTED WASM BYTES.
//!
//! A within-batch statically-known edge MUST lower to a direct `call` (opcode `0x10`) into the
//! successor block's function in the SAME module — never `call_indirect` (`0x11`, the cross-batch /
//! dispatch primitive). We build a 2-block batch (block0 `jal`s block1; block1 `jal`s block0), then
//! walk the generated module with `wasmparser` and assert both intra edges are `Operator::Call` to
//! the successor's function index and that NO `Operator::CallIndirect` exists anywhere in the batch.

use jit_translate::{Abi, translate_batch, translate_block};
use wasm_vm_core::decode::Instr;
use wasm_vm_core::dispatch::{DecodedBlock, MicroOp};
use wasmparser::{Operator, Parser, Payload, TypeRef};

fn op(instr: Instr) -> MicroOp {
    MicroOp {
        instr,
        len: 4,
        raw: 0,
    }
}

fn block(phys: u64, instrs: &[Instr]) -> DecodedBlock {
    let ops: Vec<MicroOp> = instrs.iter().copied().map(op).collect();
    let total = 4 * ops.len() as u64;
    DecodedBlock::new(phys, ops, total)
}

/// Collect the operators of every code-section function, in order.
fn functions_ops(bytes: &[u8]) -> Vec<Vec<Operator<'_>>> {
    let mut out = Vec::new();
    for payload in Parser::new(0).parse_all(bytes) {
        if let Payload::CodeSectionEntry(body) = payload.expect("parse") {
            let mut ops = Vec::new();
            let mut reader = body.get_operators_reader().expect("ops reader");
            while !reader.eof() {
                ops.push(reader.read().expect("op"));
            }
            out.push(ops);
        }
    }
    out
}

fn assert_fixed_private_state_memory(bytes: &[u8]) {
    let mut memories = Vec::new();
    for payload in Parser::new(0).parse_all(bytes) {
        if let Payload::MemorySection(section) = payload.expect("parse") {
            memories.extend(section.into_iter().map(|memory| memory.expect("memory")));
        }
    }
    assert_eq!(memories.len(), 1, "SoftMMU module owns one state memory");
    let memory = memories[0];
    assert_eq!(memory.initial, 1);
    assert_eq!(memory.maximum, Some(1));
    assert!(!memory.shared);
    assert!(!memory.memory64);
}

fn assert_growable_imported_guest_memory(bytes: &[u8]) {
    let mut memories = Vec::new();
    for payload in Parser::new(0).parse_all(bytes) {
        if let Payload::ImportSection(section) = payload.expect("parse") {
            for import in section {
                let import = import.expect("import");
                if let TypeRef::Memory(memory) = import.ty {
                    memories.push(memory);
                }
            }
        }
    }
    assert_eq!(memories.len(), 1, "InlineTlb imports one guest memory");
    let memory = memories[0];
    assert_eq!(memory.initial, 1);
    assert_eq!(
        memory.maximum, None,
        "InlineTlb guest memory stays growable"
    );
    assert!(!memory.shared);
    assert!(!memory.memory64);
}

#[test]
fn intra_batch_edge_is_direct_call_not_call_indirect() {
    // block0 @ 0x8000_0000 : addi x1,x1,1 ; jal x0,+4          → block1 (edge 0)
    // block1 @ 0x8000_0008 : addi x2,x2,1 ; jal x0,-12         → block0 (edge 0)
    let b0 = block(
        0x8000_0000,
        &[
            Instr::Addi {
                rd: 1,
                rs1: 1,
                imm: 1,
            },
            Instr::Jal { rd: 0, imm: 4 }, // pc(jal)=..04, +4 → ..08
        ],
    );
    let b1 = block(
        0x8000_0008,
        &[
            Instr::Addi {
                rd: 2,
                rs1: 2,
                imm: 1,
            },
            Instr::Jal { rd: 0, imm: -12 }, // pc(jal)=..0C, -12 → ..00
        ],
    );
    // Both edges are intra-batch: block0.edge0 → local 1, block1.edge0 → local 0.
    let intra = [[Some(1usize), None], [Some(0usize), None]];
    let bytes = translate_batch(&[b0, b1], &Abi::FROZEN, &intra).expect("batch translates");

    // The whole module must be valid WASM.
    wasmparser::Validator::new_with_features(wasmparser::WasmFeatures::all())
        .validate_all(&bytes)
        .expect("batch module must validate");

    let funcs = functions_ops(&bytes);
    assert_eq!(funcs.len(), 2, "one function per block in the batch");

    // The five env.* imports occupy func indices 0..5, so block{i}'s function is index 5+i.
    // block0 must directly CALL block1's function (index 6); block1 must CALL block0's (index 5).
    let mut direct_calls = 0usize;
    let mut indirect_calls = 0usize;
    let want = [6u32, 5u32]; // func0 → run1 (idx6), func1 → run0 (idx5)
    for (i, ops) in funcs.iter().enumerate() {
        let mut saw_want = false;
        for o in ops {
            match o {
                Operator::Call { function_index } => {
                    direct_calls += 1;
                    if *function_index == want[i] {
                        saw_want = true;
                    }
                }
                Operator::CallIndirect { .. } => indirect_calls += 1,
                _ => {}
            }
        }
        assert!(
            saw_want,
            "block{i}'s intra-batch edge must be a direct `call` to func {}",
            want[i]
        );
    }
    assert!(
        direct_calls >= 2,
        "both intra-batch edges must emit a direct call (got {direct_calls})"
    );
    assert_eq!(
        indirect_calls, 0,
        "a within-batch edge must NEVER emit call_indirect (found {indirect_calls})"
    );
}

#[test]
fn static_cross_batch_edge_uses_guarded_funcref_call_when_enabled() {
    // These blocks deliberately have no intra-batch edge. In the browser ABI, a resolved static
    // target is published into the shared virtual-target map and the emitted edge may then use the
    // same guarded call_indirect path as a `jalr` target.
    let b0 = block(0x8000_0000, &[Instr::Jal { rd: 0, imm: 8 }]);
    let b1 = block(0x8000_0008, &[Instr::Jal { rd: 0, imm: -8 }]);
    let mut abi = Abi::INLINE_TLB;
    abi.direct_chain = true;
    abi.dynamic_chain = true;
    abi.dynamic_map_base = 0x10000;
    abi.dynamic_map_mask = 0xff;

    let bytes = translate_batch(&[b0, b1], &abi, &[[None, None], [None, None]])
        .expect("cross-batch browser batch translates");
    wasmparser::Validator::new_with_features(wasmparser::WasmFeatures::all())
        .validate_all(&bytes)
        .expect("cross-batch browser module must validate");

    let funcs = functions_ops(&bytes);
    assert_eq!(funcs.len(), 2);
    let indirect_calls = funcs
        .iter()
        .flat_map(|ops| ops.iter())
        .filter(|op| matches!(op, Operator::CallIndirect { .. }))
        .count();
    assert_eq!(
        indirect_calls, 2,
        "both static cross-batch exits use the guarded funcref call"
    );
}

#[test]
fn fence_i_successor_keeps_static_edge_on_host_return_path() {
    let b0 = block(0x8000_0000, &[Instr::Jal { rd: 0, imm: 8 }]);
    let b1 = block(0x8000_0008, &[Instr::FenceI]);
    let mut abi = Abi::INLINE_TLB;
    abi.direct_chain = true;
    abi.dynamic_chain = true;
    abi.dynamic_map_base = 0x10000;
    abi.dynamic_map_mask = 0xff;

    let bytes = translate_batch(&[b0, b1], &abi, &[[Some(1), None], [None, None]])
        .expect("fence.i browser batch translates");
    let funcs = functions_ops(&bytes);
    let indirect_calls = funcs
        .iter()
        .flat_map(|ops| ops.iter())
        .filter(|op| matches!(op, Operator::CallIndirect { .. }))
        .count();
    assert_eq!(
        indirect_calls, 0,
        "a fence.i successor must not be entered through a guarded chain"
    );
}

#[test]
fn single_block_batch_matches_translate_block_shape() {
    // A batch of one block with no intra edges: valid module, exactly one function, no calls beyond
    // the memory imports (which are not `call` ops), and no call_indirect.
    let b = block(
        0x8000_0000,
        &[
            Instr::Addi {
                rd: 1,
                rs1: 0,
                imm: 7,
            },
            Instr::Jal { rd: 0, imm: 0 }, // self-loop; edge leaves the batch (None)
        ],
    );
    let bytes = translate_batch(&[b], &Abi::FROZEN, &[[None, None]]).expect("translates");
    wasmparser::Validator::new_with_features(wasmparser::WasmFeatures::all())
        .validate_all(&bytes)
        .expect("validates");
    let funcs = functions_ops(&bytes);
    assert_eq!(funcs.len(), 1);
    for o in &funcs[0] {
        assert!(
            !matches!(o, Operator::Call { .. } | Operator::CallIndirect { .. }),
            "a no-intra single-block batch makes no in-module calls"
        );
    }
}

#[test]
fn softmmu_state_memory_is_fixed_for_stable_browser_views() {
    let b = block(
        0x8000_0000,
        &[
            Instr::Addi {
                rd: 1,
                rs1: 1,
                imm: 1,
            },
            Instr::Jal { rd: 0, imm: -4 },
        ],
    );
    let single = translate_block(&b, &Abi::FROZEN).expect("single translates");
    assert_fixed_private_state_memory(&single);
    let batch = translate_batch(core::slice::from_ref(&b), &Abi::FROZEN, &[[None, None]])
        .expect("batch translates");
    assert_fixed_private_state_memory(&batch);

    let inline_single = translate_block(&b, &Abi::INLINE_TLB).expect("inline single translates");
    assert_growable_imported_guest_memory(&inline_single);
    let inline_batch =
        translate_batch(core::slice::from_ref(&b), &Abi::INLINE_TLB, &[[None, None]])
            .expect("inline batch translates");
    assert_growable_imported_guest_memory(&inline_batch);
}
