//! E0-T07 adversarial verifier: spec-first differential vectors.
//! Expected values computed by an INDEPENDENT Python model (verifier_model.py,
//! unbounded-int, written from the Unprivileged ISA manual) — Spike substitute
//! per angle 1 (Spike unavailable on this host; re-run at E0-T13).
use wasm_vm_core::bus::Bus;
use wasm_vm_core::bus::mmap::DRAM_BASE;
use wasm_vm_core::hart::Hart;
use wasm_vm_core::mmio::SystemBus;
use wasm_vm_core::ram::Ram;

#[test]
fn spec_model_differential() {
    type Vector = (&'static str, u32, &'static [(u8, u64)], u64);
    let vectors: &[Vector] = &[
        (
            "addiw 7FFFFFFF+1",
            0x0011809b,
            &[(3, 0x7fffffff)],
            0xffffffff80000000,
        ),
        (
            "addiw -1 + -1",
            0xfff1809b,
            &[(3, 0xffffffffffffffff)],
            0xfffffffffffffffe,
        ),
        (
            "addiw IMIN + 0",
            0x0001809b,
            &[(3, 0x8000000000000000)],
            0x0000000000000000,
        ),
        (
            "srliw bit31 sh1",
            0x0011d09b,
            &[(3, 0xffffffff80000000)],
            0x0000000040000000,
        ),
        (
            "srliw bit31 sh0",
            0x0001d09b,
            &[(3, 0x80000000)],
            0xffffffff80000000,
        ),
        (
            "subw ->0x80000000",
            0x402180bb,
            &[(3, 0x0), (2, 0x80000000)],
            0xffffffff80000000,
        ),
        (
            "subw 0-1",
            0x402180bb,
            &[(3, 0x0), (2, 0x1)],
            0xffffffffffffffff,
        ),
        (
            "sll shamt 0xFFC1",
            0x002190b3,
            &[(3, 0xf0f), (2, 0xffffffffffffffc1)],
            0x0000000000001e1e,
        ),
        (
            "sll rs2=u64MAX",
            0x002190b3,
            &[(3, 0x1), (2, 0xffffffffffffffff)],
            0x8000000000000000,
        ),
        (
            "sll rs2=64",
            0x002190b3,
            &[(3, 0x1), (2, 0x40)],
            0x0000000000000001,
        ),
        (
            "sllw rs2=0x2F",
            0x002190bb,
            &[(3, 0x1), (2, 0x2f)],
            0x0000000000008000,
        ),
        (
            "sllw rs2=32",
            0x002190bb,
            &[(3, 0x1), (2, 0x20)],
            0x0000000000000001,
        ),
        (
            "sllw 0x10000<<15",
            0x002190bb,
            &[(3, 0x10000), (2, 0xf)],
            0xffffffff80000000,
        ),
        (
            "sraw -64>>4",
            0x4021d0bb,
            &[(3, 0xffffffc0), (2, 0x4)],
            0xfffffffffffffffc,
        ),
        (
            "sraw 0x80000000>>31",
            0x4021d0bb,
            &[(3, 0x80000000), (2, 0x1f)],
            0xffffffffffffffff,
        ),
        (
            "sraw hi-garbage",
            0x4021d0bb,
            &[(3, 0x1234567880000000), (2, 0x4)],
            0xfffffffff8000000,
        ),
        (
            "srlw 0x80000000>>31",
            0x0021d0bb,
            &[(3, 0x80000000), (2, 0x1f)],
            0x0000000000000001,
        ),
        (
            "sra IMIN>>63",
            0x4021d0b3,
            &[(3, 0x8000000000000000), (2, 0x3f)],
            0xffffffffffffffff,
        ),
        (
            "srl IMIN>>63",
            0x0021d0b3,
            &[(3, 0x8000000000000000), (2, 0x3f)],
            0x0000000000000001,
        ),
        (
            "srai -8>>2",
            0x4021d093,
            &[(3, 0xfffffffffffffff8)],
            0xfffffffffffffffe,
        ),
        (
            "srai IMIN>>63",
            0x43f1d093,
            &[(3, 0x8000000000000000)],
            0xffffffffffffffff,
        ),
        ("slli 1<<63", 0x03f19093, &[(3, 0x1)], 0x8000000000000000),
        (
            "sltiu imm=-1 vs MAX",
            0xfff1b093,
            &[(3, 0xffffffffffffffff)],
            0x0000000000000000,
        ),
        (
            "sltiu imm=-1 vs 5",
            0xfff1b093,
            &[(3, 0x5)],
            0x0000000000000001,
        ),
        ("sltiu seqz(0)", 0x0011b093, &[(3, 0x0)], 0x0000000000000001),
        ("sltiu seqz(7)", 0x0011b093, &[(3, 0x7)], 0x0000000000000000),
        (
            "slti imm=-1 vs -2",
            0xfff1a093,
            &[(3, 0xfffffffffffffffe)],
            0x0000000000000001,
        ),
        (
            "slti imm=-1 vs -1",
            0xfff1a093,
            &[(3, 0xffffffffffffffff)],
            0x0000000000000000,
        ),
        (
            "slti IMIN vs -2048",
            0x8001a093,
            &[(3, 0x8000000000000000)],
            0x0000000000000001,
        ),
        (
            "slt IMIN,IMAX",
            0x0021a0b3,
            &[(3, 0x8000000000000000), (2, 0x7fffffffffffffff)],
            0x0000000000000001,
        ),
        (
            "sltu IMIN,IMAX",
            0x0021b0b3,
            &[(3, 0x8000000000000000), (2, 0x7fffffffffffffff)],
            0x0000000000000000,
        ),
        (
            "add IMAX+1",
            0x002180b3,
            &[(3, 0x7fffffffffffffff), (2, 0x1)],
            0x8000000000000000,
        ),
        (
            "sub 0-1",
            0x402180b3,
            &[(3, 0x0), (2, 0x1)],
            0xffffffffffffffff,
        ),
        (
            "addw 7FFFFFFF+1",
            0x002180bb,
            &[(3, 0x7fffffff), (2, 0x1)],
            0xffffffff80000000,
        ),
        (
            "xor mix",
            0x0021c0b3,
            &[(3, 0xf0f0123456789abc), (2, 0xffffffffffffffff)],
            0x0f0fedcba9876543,
        ),
        (
            "or mix",
            0x0021e0b3,
            &[(3, 0xf00000000000000f), (2, 0xff0)],
            0xf000000000000fff,
        ),
        (
            "and mix",
            0x0021f0b3,
            &[(3, 0xff00ff00ff00ff00), (2, 0xff00ff00ff00ff0)],
            0x0f000f000f000f00,
        ),
        (
            "andi imm=-16",
            0xff01f093,
            &[(3, 0xff00ff)],
            0x0000000000ff00f0,
        ),
        (
            "xori imm=-1 (not)",
            0xfff1c093,
            &[(3, 0x123456789abcdef0)],
            0xedcba9876543210f,
        ),
        (
            "sraiw hi-garbage sh4",
            0x4041d09b,
            &[(3, 0x180000000)],
            0xfffffffff8000000,
        ),
        (
            "slliw 0x10001<<31",
            0x01f1909b,
            &[(3, 0x10001)],
            0xffffffff80000000,
        ),
        ("lui 0x80000", 0x800000b7, &[], 0xffffffff80000000),
        ("lui 0xFFFFF", 0xfffff0b7, &[], 0xfffffffffffff000),
        ("auipc wrap to 0", 0x80000097, &[], 0x0000000000000000),
        ("auipc 0x7FFFF", 0x7ffff097, &[], 0x00000000fffff000),
    ];
    for &(name, word, seeds, expected) in vectors {
        let mut hart = Hart::new();
        hart.regs.pc = DRAM_BASE;
        let mut bus = SystemBus::new(Ram::new(64 * 1024).unwrap());
        bus.store32(DRAM_BASE, word).unwrap();
        for &(r, v) in seeds {
            hart.regs.write(r, v);
        }
        hart.step(&mut bus)
            .unwrap_or_else(|t| panic!("{name}: trapped {t:?}"));
        assert_eq!(hart.regs.read(1), expected, "{name} (word {word:#010x})");
        assert_eq!(hart.regs.pc, DRAM_BASE + 4, "{name}: pc");
    }
}
