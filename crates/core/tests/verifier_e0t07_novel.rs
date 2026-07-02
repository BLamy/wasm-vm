//! E0-T07 adversarial verifier: invented attacks beyond the task's listed angles.
use wasm_vm_core::bus::Bus;
use wasm_vm_core::bus::mmap::DRAM_BASE;
use wasm_vm_core::hart::Hart;
use wasm_vm_core::mmio::SystemBus;
use wasm_vm_core::ram::Ram;

/// NOVEL 1: hostile FENCE encoding. FENCE's rd/rs1 fields are reserved (spec:
/// ignore); a FENCE word carrying rd=x5 must not clobber x5 regardless of
/// whether decode surfaces the field. If decode rejects it instead, state must
/// still be untouched.
#[test]
fn fence_with_nonzero_rd_bits_cannot_clobber() {
    let word: u32 = 0x0FF0_028F; // fence iorw,iorw but rd field = 5
    let mut hart = Hart::new();
    hart.regs.pc = DRAM_BASE;
    hart.regs.write(5, 0xFACE_FACE_FACE_FACE);
    let mut bus = SystemBus::new(Ram::new(64 * 1024).unwrap());
    bus.store32(DRAM_BASE, word).unwrap();
    let before = format!("{}", hart.regs);
    match hart.step(&mut bus) {
        Ok(()) => {
            assert_eq!(
                hart.regs.read(5),
                0xFACE_FACE_FACE_FACE,
                "fence clobbered x5"
            );
            assert_eq!(hart.regs.pc, DRAM_BASE + 4);
        }
        Err(_) => {
            // decode rejected the reserved-field encoding: fine, but must be pure
            assert_eq!(format!("{}", hart.regs), before);
            assert_eq!(hart.regs.pc, DRAM_BASE);
        }
    }
}

/// NOVEL 2: step() must compose. A real 4-instruction program, stepped
/// sequentially, with the final architectural state checked against hand
/// computation (not against any single-shot harness).
///   lui   x1, 0x80000        ; x1 = 0xFFFF_FFFF_8000_0000
///   addiw x2, x1, -1         ; low32 0x8000_0000 - 1 = 0x7FFF_FFFF -> sext = 0x7FFF_FFFF
///   sub   x3, x0, x2         ; 0 - 0x7FFF_FFFF = 0xFFFF_FFFF_8000_0001
///   sraw  x4, x3, x1         ; low32(x3)=0x8000_0001 asr (x1&0x1F=0) -> sext = 0xFFFF_FFFF_8000_0001
#[test]
fn four_instruction_program_accumulates_correctly() {
    let prog: [u32; 4] = [
        0x8000_00B7, // lui x1, 0x80000
        0xFFF0_811B, // addiw x2, x1, -1
        0x4020_01B3, // sub x3, x0, x2
        0x4011_D23B, // sraw x4, x3, x1
    ];
    let mut hart = Hart::new();
    hart.regs.pc = DRAM_BASE;
    let mut bus = SystemBus::new(Ram::new(64 * 1024).unwrap());
    for (i, w) in prog.iter().enumerate() {
        bus.store32(DRAM_BASE + 4 * i as u64, *w).unwrap();
    }
    for _ in 0..4 {
        hart.step(&mut bus).unwrap();
    }
    assert_eq!(hart.regs.pc, DRAM_BASE + 16);
    assert_eq!(hart.regs.read(1), 0xFFFF_FFFF_8000_0000);
    assert_eq!(hart.regs.read(2), 0x0000_0000_7FFF_FFFF);
    assert_eq!(hart.regs.read(3), 0xFFFF_FFFF_8000_0001);
    assert_eq!(hart.regs.read(4), 0xFFFF_FFFF_8000_0001);
}
