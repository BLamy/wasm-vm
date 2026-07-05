//! E0-T19: run the rv64ui-p suite under wasm32 (`wasm-pack test --node`),
//! proving the emulator + CSR stub produce identical pass results off-native.
//! Gated on `zicsr-stub` (the p-env needs it) AND wasm32. The ELF set is the
//! SAME committed binaries the native harness runs, minus the documented skips
//! (fence_i, ma_data). This file is generated — keep it in sync with the bin dir.
#![cfg(all(target_arch = "wasm32", feature = "zicsr-stub"))]

use wasm_bindgen_test::wasm_bindgen_test;
use wasm_vm_core::hart::Exception;
use wasm_vm_core::{Machine, RunOutcome};

const SYS_EXIT: u64 = 93;

/// (name, bytes) for every non-skipped rv64ui-p ELF, embedded for wasm.
const TESTS: &[(&str, &[u8])] = &[
    (
        "rv64ui-p-add",
        include_bytes!("../../../tests/riscv-tests-bin/rv64ui-p-add"),
    ),
    (
        "rv64ui-p-addi",
        include_bytes!("../../../tests/riscv-tests-bin/rv64ui-p-addi"),
    ),
    (
        "rv64ui-p-addiw",
        include_bytes!("../../../tests/riscv-tests-bin/rv64ui-p-addiw"),
    ),
    (
        "rv64ui-p-addw",
        include_bytes!("../../../tests/riscv-tests-bin/rv64ui-p-addw"),
    ),
    (
        "rv64ui-p-and",
        include_bytes!("../../../tests/riscv-tests-bin/rv64ui-p-and"),
    ),
    (
        "rv64ui-p-andi",
        include_bytes!("../../../tests/riscv-tests-bin/rv64ui-p-andi"),
    ),
    (
        "rv64ui-p-auipc",
        include_bytes!("../../../tests/riscv-tests-bin/rv64ui-p-auipc"),
    ),
    (
        "rv64ui-p-beq",
        include_bytes!("../../../tests/riscv-tests-bin/rv64ui-p-beq"),
    ),
    (
        "rv64ui-p-bge",
        include_bytes!("../../../tests/riscv-tests-bin/rv64ui-p-bge"),
    ),
    (
        "rv64ui-p-bgeu",
        include_bytes!("../../../tests/riscv-tests-bin/rv64ui-p-bgeu"),
    ),
    (
        "rv64ui-p-blt",
        include_bytes!("../../../tests/riscv-tests-bin/rv64ui-p-blt"),
    ),
    (
        "rv64ui-p-bltu",
        include_bytes!("../../../tests/riscv-tests-bin/rv64ui-p-bltu"),
    ),
    (
        "rv64ui-p-bne",
        include_bytes!("../../../tests/riscv-tests-bin/rv64ui-p-bne"),
    ),
    (
        "rv64ui-p-jal",
        include_bytes!("../../../tests/riscv-tests-bin/rv64ui-p-jal"),
    ),
    (
        "rv64ui-p-jalr",
        include_bytes!("../../../tests/riscv-tests-bin/rv64ui-p-jalr"),
    ),
    (
        "rv64ui-p-lb",
        include_bytes!("../../../tests/riscv-tests-bin/rv64ui-p-lb"),
    ),
    (
        "rv64ui-p-lbu",
        include_bytes!("../../../tests/riscv-tests-bin/rv64ui-p-lbu"),
    ),
    (
        "rv64ui-p-ld",
        include_bytes!("../../../tests/riscv-tests-bin/rv64ui-p-ld"),
    ),
    (
        "rv64ui-p-ld_st",
        include_bytes!("../../../tests/riscv-tests-bin/rv64ui-p-ld_st"),
    ),
    (
        "rv64ui-p-lh",
        include_bytes!("../../../tests/riscv-tests-bin/rv64ui-p-lh"),
    ),
    (
        "rv64ui-p-lhu",
        include_bytes!("../../../tests/riscv-tests-bin/rv64ui-p-lhu"),
    ),
    (
        "rv64ui-p-lui",
        include_bytes!("../../../tests/riscv-tests-bin/rv64ui-p-lui"),
    ),
    (
        "rv64ui-p-lw",
        include_bytes!("../../../tests/riscv-tests-bin/rv64ui-p-lw"),
    ),
    (
        "rv64ui-p-lwu",
        include_bytes!("../../../tests/riscv-tests-bin/rv64ui-p-lwu"),
    ),
    (
        "rv64ui-p-or",
        include_bytes!("../../../tests/riscv-tests-bin/rv64ui-p-or"),
    ),
    (
        "rv64ui-p-ori",
        include_bytes!("../../../tests/riscv-tests-bin/rv64ui-p-ori"),
    ),
    (
        "rv64ui-p-sb",
        include_bytes!("../../../tests/riscv-tests-bin/rv64ui-p-sb"),
    ),
    (
        "rv64ui-p-sd",
        include_bytes!("../../../tests/riscv-tests-bin/rv64ui-p-sd"),
    ),
    (
        "rv64ui-p-sh",
        include_bytes!("../../../tests/riscv-tests-bin/rv64ui-p-sh"),
    ),
    (
        "rv64ui-p-simple",
        include_bytes!("../../../tests/riscv-tests-bin/rv64ui-p-simple"),
    ),
    (
        "rv64ui-p-sll",
        include_bytes!("../../../tests/riscv-tests-bin/rv64ui-p-sll"),
    ),
    (
        "rv64ui-p-slli",
        include_bytes!("../../../tests/riscv-tests-bin/rv64ui-p-slli"),
    ),
    (
        "rv64ui-p-slliw",
        include_bytes!("../../../tests/riscv-tests-bin/rv64ui-p-slliw"),
    ),
    (
        "rv64ui-p-sllw",
        include_bytes!("../../../tests/riscv-tests-bin/rv64ui-p-sllw"),
    ),
    (
        "rv64ui-p-slt",
        include_bytes!("../../../tests/riscv-tests-bin/rv64ui-p-slt"),
    ),
    (
        "rv64ui-p-slti",
        include_bytes!("../../../tests/riscv-tests-bin/rv64ui-p-slti"),
    ),
    (
        "rv64ui-p-sltiu",
        include_bytes!("../../../tests/riscv-tests-bin/rv64ui-p-sltiu"),
    ),
    (
        "rv64ui-p-sltu",
        include_bytes!("../../../tests/riscv-tests-bin/rv64ui-p-sltu"),
    ),
    (
        "rv64ui-p-sra",
        include_bytes!("../../../tests/riscv-tests-bin/rv64ui-p-sra"),
    ),
    (
        "rv64ui-p-srai",
        include_bytes!("../../../tests/riscv-tests-bin/rv64ui-p-srai"),
    ),
    (
        "rv64ui-p-sraiw",
        include_bytes!("../../../tests/riscv-tests-bin/rv64ui-p-sraiw"),
    ),
    (
        "rv64ui-p-sraw",
        include_bytes!("../../../tests/riscv-tests-bin/rv64ui-p-sraw"),
    ),
    (
        "rv64ui-p-srl",
        include_bytes!("../../../tests/riscv-tests-bin/rv64ui-p-srl"),
    ),
    (
        "rv64ui-p-srli",
        include_bytes!("../../../tests/riscv-tests-bin/rv64ui-p-srli"),
    ),
    (
        "rv64ui-p-srliw",
        include_bytes!("../../../tests/riscv-tests-bin/rv64ui-p-srliw"),
    ),
    (
        "rv64ui-p-srlw",
        include_bytes!("../../../tests/riscv-tests-bin/rv64ui-p-srlw"),
    ),
    (
        "rv64ui-p-st_ld",
        include_bytes!("../../../tests/riscv-tests-bin/rv64ui-p-st_ld"),
    ),
    (
        "rv64ui-p-sub",
        include_bytes!("../../../tests/riscv-tests-bin/rv64ui-p-sub"),
    ),
    (
        "rv64ui-p-subw",
        include_bytes!("../../../tests/riscv-tests-bin/rv64ui-p-subw"),
    ),
    (
        "rv64ui-p-sw",
        include_bytes!("../../../tests/riscv-tests-bin/rv64ui-p-sw"),
    ),
    (
        "rv64ui-p-xor",
        include_bytes!("../../../tests/riscv-tests-bin/rv64ui-p-xor"),
    ),
    (
        "rv64ui-p-xori",
        include_bytes!("../../../tests/riscv-tests-bin/rv64ui-p-xori"),
    ),
];

/// Pass ⇔ the p-env exits via `li a7,93; ecall` with `a0 == 0`.
fn passes(elf: &[u8]) -> Result<(), String> {
    let mut m = Machine::new(16 * 1024 * 1024);
    m.load_elf(elf).map_err(|e| format!("load: {e:?}"))?;
    match m.run(1_000_000) {
        RunOutcome::Exited(0) => Ok(()),
        RunOutcome::Exited(n) => Err(format!("HTIF exit {n}")),
        RunOutcome::Trapped(t) if t.cause == Exception::EcallFromM => {
            let (a7, a0) = (m.hart().regs.read(17), m.hart().regs.read(10));
            if a7 == SYS_EXIT && a0 == 0 {
                Ok(())
            } else {
                Err(format!("fail case #{}", a0 >> 1))
            }
        }
        other => Err(format!("{other:?}")),
    }
}

#[wasm_bindgen_test]
fn rv64ui_p_suite_passes_on_wasm32() {
    let mut failures = Vec::new();
    for (name, elf) in TESTS {
        if let Err(why) = passes(elf) {
            failures.push(format!("{name}: {why}"));
        }
    }
    assert!(
        failures.is_empty(),
        "{} wasm rv64ui-p failure(s):\n{}",
        failures.len(),
        failures.join("\n")
    );
}
