#!/usr/bin/env python3
"""Spec-first RV64I model (verifier-authored, independent of the Rust code).

Encodes a straight-line program mixing all 11 memory ops with computational ops,
simulates it per the Unprivileged ISA, and emits a Rust integration test that
asserts the FULL register file and a data-window byte dump after N steps.
"""
M64 = (1 << 64) - 1


def sext(v, bits):
    v &= (1 << bits) - 1
    return v - (1 << bits) if v >> (bits - 1) else v


def u64(v):
    return v & M64


# ---- encoders (from the ISA manual, not from the Rust code) ----
def i_type(op, rd, f3, rs1, imm):
    assert -2048 <= imm <= 2047
    return ((imm & 0xFFF) << 20) | (rs1 << 15) | (f3 << 12) | (rd << 7) | op


def s_type(f3, rs1, rs2, imm):
    assert -2048 <= imm <= 2047
    iu = imm & 0xFFF
    return ((iu >> 5) << 25) | (rs2 << 20) | (rs1 << 15) | (f3 << 12) | ((iu & 0x1F) << 7) | 0b0100011


def r_type(op, rd, f3, rs1, rs2, f7):
    return (f7 << 25) | (rs2 << 20) | (rs1 << 15) | (f3 << 12) | (rd << 7) | op


def u_type(op, rd, imm20):
    return ((imm20 & 0xFFFFF) << 12) | (rd << 7) | op


ENC = {
    'lui':   lambda rd, imm20: u_type(0b0110111, rd, imm20),
    'auipc': lambda rd, imm20: u_type(0b0010111, rd, imm20),
    'addi':  lambda rd, rs1, imm: i_type(0b0010011, rd, 0b000, rs1, imm),
    'xori':  lambda rd, rs1, imm: i_type(0b0010011, rd, 0b100, rs1, imm),
    'sltiu': lambda rd, rs1, imm: i_type(0b0010011, rd, 0b011, rs1, imm),
    'slli':  lambda rd, rs1, sh: i_type(0b0010011, rd, 0b001, rs1, sh),
    'srai':  lambda rd, rs1, sh: i_type(0b0010011, rd, 0b101, rs1, sh | 0x400),
    'add':   lambda rd, rs1, rs2: r_type(0b0110011, rd, 0b000, rs1, rs2, 0),
    'sub':   lambda rd, rs1, rs2: r_type(0b0110011, rd, 0b000, rs1, rs2, 0b0100000),
    'xor':   lambda rd, rs1, rs2: r_type(0b0110011, rd, 0b100, rs1, rs2, 0),
    'addw':  lambda rd, rs1, rs2: r_type(0b0111011, rd, 0b000, rs1, rs2, 0),
    'lb':    lambda rd, rs1, imm: i_type(0b0000011, rd, 0b000, rs1, imm),
    'lh':    lambda rd, rs1, imm: i_type(0b0000011, rd, 0b001, rs1, imm),
    'lw':    lambda rd, rs1, imm: i_type(0b0000011, rd, 0b010, rs1, imm),
    'ld':    lambda rd, rs1, imm: i_type(0b0000011, rd, 0b011, rs1, imm),
    'lbu':   lambda rd, rs1, imm: i_type(0b0000011, rd, 0b100, rs1, imm),
    'lhu':   lambda rd, rs1, imm: i_type(0b0000011, rd, 0b101, rs1, imm),
    'lwu':   lambda rd, rs1, imm: i_type(0b0000011, rd, 0b110, rs1, imm),
    'sb':    lambda rs2, rs1, imm: s_type(0b000, rs1, rs2, imm),
    'sh':    lambda rs2, rs1, imm: s_type(0b001, rs1, rs2, imm),
    'sw':    lambda rs2, rs1, imm: s_type(0b010, rs1, rs2, imm),
    'sd':    lambda rs2, rs1, imm: s_type(0b011, rs1, rs2, imm),
}

CODE = 0x8000_0000
DATA = 0x8000_0800

# (mnemonic, operands...) — straight-line; loads feed later ops; rd==rs1 chains;
# negative store AND load offsets; every width both sign modes.
PROG = [
    ('auipc', 1, 0),            # x1 = CODE
    ('addi',  2, 1, 0x7F8),     # x2 = CODE + 0x7F8
    ('addi',  2, 2, 8),         # rd==rs1 chain: x2 = DATA
    ('lui',   3, 0x12345),      # x3 = 0x12345000
    ('addi',  3, 3, 0x678),     # x3 = 0x12345678
    ('sw',    3, 2, 0),         # [DATA] = 12345678
    ('addi',  4, 0, -1),        # x4 = -1
    ('sd',    4, 2, 8),         # [DATA+8] = FF*8
    ('sb',    3, 2, 16),        # [DATA+16] = 78
    ('sh',    4, 2, 18),        # [DATA+18] = FFFF
    ('lb',    5, 2, 8),         # x5 = -1 (sext 0xFF)
    ('lbu',   6, 2, 8),         # x6 = 0xFF
    ('lh',    7, 2, 18),        # x7 = -1
    ('lhu',   8, 2, 18),        # x8 = 0xFFFF
    ('lw',    9, 2, 0),         # x9 = 0x12345678
    ('lwu',  10, 2, 8),         # x10 = 0xFFFF_FFFF
    ('ld',   11, 2, 8),         # x11 = -1
    ('add',  12, 9, 5),         # dep through loads: 0x12345677
    ('sw',   12, 2, 20),
    ('lw',   13, 2, 20),        # x13 = 0x12345677
    ('addi', 14, 2, 32),        # x14 = DATA+32
    ('sd',   13, 14, -8),       # negative-offset store -> [DATA+24]
    ('ld',   15, 2, 24),        # x15 = 0x12345677
    ('addi', 16, 2, 8),
    ('ld',   16, 16, 0),        # rd==rs1 LOAD: x16 = -1 (value, not address)
    ('sub',  17, 0, 16),        # x17 = 1
    ('sh',    9, 14, -2),       # [DATA+30] = 0x5678
    ('lhu',  18, 14, -2),       # negative-offset load: x18 = 0x5678
    ('slli', 19, 18, 40),       # x19 = 0x5678 << 40
    ('srai', 20, 19, 33),       # x20 = sra
    ('sb',   20, 2, 33),        # byte store at odd addr (legal)
    ('lb',   21, 2, 33),        # x21 = sext of that byte
    ('addw', 22, 9, 11),        # 32-bit add of loaded vals, sext
    ('lwu',  23, 2, 24),        # x23 = 0x12345677
    ('xor',  24, 23, 13),       # 0
    ('sltiu', 25, 24, 1),       # 1
    ('sd',   25, 2, 40),
    ('ld',   26, 2, 40),        # 1
    ('lh',   27, 2, 2),         # 0x1234
    ('lb',   28, 2, 3),         # 0x12
    ('lbu',  29, 2, 1),         # 0x56
]

# ---- simulator (spec semantics) ----
regs = [0] * 32
mem = {}
pc = CODE
words = []
for ins in PROG:
    words.append(ENC[ins[0]](*ins[1:]))


def rd_w(rd, val):
    if rd:
        regs[rd] = u64(val)


def load(addr, size):
    return int.from_bytes(bytes(mem.get(addr + i, 0) for i in range(size)), 'little')


def store(addr, size, val):
    for i, b in enumerate(int(val & ((1 << (8 * size)) - 1)).to_bytes(size, 'little')):
        mem[addr + i] = b


for ins in PROG:
    m, a = ins[0], ins[1:]
    if m == 'lui':
        rd_w(a[0], sext(a[1] << 12, 32))
    elif m == 'auipc':
        rd_w(a[0], pc + sext(a[1] << 12, 32))
    elif m == 'addi':
        rd_w(a[0], regs[a[1]] + a[2])
    elif m == 'xori':
        rd_w(a[0], regs[a[1]] ^ u64(a[2]))
    elif m == 'sltiu':
        rd_w(a[0], 1 if regs[a[1]] < u64(a[2]) else 0)
    elif m == 'slli':
        rd_w(a[0], regs[a[1]] << a[2])
    elif m == 'srai':
        rd_w(a[0], sext(regs[a[1]], 64) >> a[2])
    elif m == 'add':
        rd_w(a[0], regs[a[1]] + regs[a[2]])
    elif m == 'sub':
        rd_w(a[0], regs[a[1]] - regs[a[2]])
    elif m == 'xor':
        rd_w(a[0], regs[a[1]] ^ regs[a[2]])
    elif m == 'addw':
        rd_w(a[0], sext(regs[a[1]] + regs[a[2]], 32))
    elif m in ('lb', 'lh', 'lw', 'ld', 'lbu', 'lhu', 'lwu'):
        sz = {'lb': 1, 'lbu': 1, 'lh': 2, 'lhu': 2, 'lw': 4, 'lwu': 4, 'ld': 8}[m]
        addr = u64(regs[a[1]] + a[2])
        assert addr % sz == 0 and DATA <= addr, f'{m} misaligned/oob {addr:#x}'
        v = load(addr, sz)
        rd_w(a[0], v if m in ('lbu', 'lhu', 'lwu', 'ld') else sext(v, 8 * sz))
    elif m in ('sb', 'sh', 'sw', 'sd'):
        sz = {'sb': 1, 'sh': 2, 'sw': 4, 'sd': 8}[m]
        addr = u64(regs[a[1]] + a[2])
        assert addr % sz == 0 and DATA <= addr, f'{m} misaligned/oob {addr:#x}'
        store(addr, sz, regs[a[0]])
    else:
        raise AssertionError(m)
    pc += 4

exp_mem = [mem.get(DATA + i, 0) for i in range(48)]

rs = ',\n    '.join(f'0x{r:016X}' for r in regs)
ws = ', '.join(f'0x{w:08X}' for w in words)
ms = ', '.join(f'0x{b:02X}' for b in exp_mem)
print(f"""// AUTO-GENERATED by the E0-T08 verifier's spec-first Python model (model.py).
//! E0-T08 verifier angle-1 substitute: {len(PROG)}-instruction program mixing all 11
//! memory ops with computational ops, stepped as a PROGRAM; full register file and
//! a 48-byte data window compared against an independent spec-first model.
use wasm_vm_core::bus::Bus;
use wasm_vm_core::hart::Hart;
use wasm_vm_core::mmio::SystemBus;
use wasm_vm_core::ram::Ram;

const CODE: u64 = {CODE:#x};
const DATA: u64 = {DATA:#x};
const PROG: &[u32] = &[{ws}];
const EXPECT_REGS: [u64; 32] = [
    {rs},
];
const EXPECT_MEM: [u8; 48] = [{ms}];

#[test]
fn program_differential_vs_spec_model() {{
    let mut bus = SystemBus::new(Ram::new(64 * 1024).unwrap());
    let mut hart = Hart::new();
    hart.regs.pc = CODE;
    for (i, w) in PROG.iter().enumerate() {{
        bus.store32(CODE + 4 * i as u64, *w).unwrap();
    }}
    for i in 0..PROG.len() {{
        hart.step(&mut bus).unwrap_or_else(|t| panic!("step {{i}} trapped: {{t:?}}"));
    }}
    assert_eq!(hart.regs.pc, CODE + 4 * PROG.len() as u64, "final pc");
    for r in 0..32u8 {{
        assert_eq!(hart.regs.read(r), EXPECT_REGS[r as usize], "x{{r}} mismatch");
    }}
    let mut got = [0u8; 48];
    bus.ram().read_slice(DATA, &mut got).unwrap();
    assert_eq!(got, EXPECT_MEM, "data window mismatch");
}}""")
