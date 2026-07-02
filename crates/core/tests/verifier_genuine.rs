use wasm_vm_core::loader::{ElfError, load_elf};
use wasm_vm_core::ram::Ram;
fn ram() -> Ram {
    Ram::new(64 * 1024).unwrap()
}
#[test]
fn genuine_x86_64_exec_rejected_for_machine() {
    let mut r = ram();
    let e = load_elf(include_bytes!("genuine/x86_64_exec.elf"), &mut r);
    assert_eq!(e, Err(ElfError::WrongMachine), "genuine x86-64 EXEC");
}
#[test]
fn genuine_x86_64_dyn_rejected_for_machine_not_type() {
    let mut r = ram();
    // Real x86-64 PIE: machine=62 AND type=DYN. Precision demands WrongMachine.
    let e = load_elf(include_bytes!("genuine/x86_64_dyn.elf"), &mut r);
    assert_eq!(e, Err(ElfError::WrongMachine), "genuine x86-64 PIE");
}
#[test]
fn genuine_rv32_rejected_for_class() {
    let mut r = ram();
    let e = load_elf(include_bytes!("genuine/rv32.elf"), &mut r);
    assert_eq!(e, Err(ElfError::WrongClass), "genuine rv32");
}
