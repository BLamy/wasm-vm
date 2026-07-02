#!/usr/bin/env python3
"""E0-T09 adversarial verifier — spec-first RV64I control-flow model.

Written from the Unprivileged ISA text alone (§2.4/§2.5), NOT from the Rust code:
  - jal: target = pc + sext(imm21); link = pc+4 written only if target 4-aligned;
    misaligned target -> instruction-address-misaligned (cause 0), tval=target.
  - jalr: target = (rs1 + sext(imm12)) & ~1; same alignment rule; link after
    target computation (rd==rs1 uses old rs1).
  - branches: taken -> target = pc + sext(imm13), alignment rule applies ONLY
    when taken; not-taken falls through unconditionally.
Assembles a 50+ instruction torture blob, executes it, and emits a Rust include
file with the words, full pc trace, and final register file.
"""
M64 = (1 << 64) - 1
DRAM_BASE = 0x8000_0000
CODE = DRAM_BASE + 0x1000


def sx(v, bits):
    v &= (1 << bits) - 1
    return v - (1 << bits) if v & (1 << (bits - 1)) else v


# ── encoders (independent re-derivation of the scrambles from the spec tables) ──
def enc_i(imm, rs1, f3, rd, op):
    return ((imm & 0xFFF) << 20) | (rs1 << 15) | (f3 << 12) | (rd << 7) | op

def addi(rd, rs1, imm): return enc_i(imm, rs1, 0, rd, 0b0010011)
def slli(rd, rs1, sh):  return enc_i(sh, rs1, 0b001, rd, 0b0010011)
def add(rd, rs1, rs2):  return (rs2 << 20) | (rs1 << 15) | (rd << 7) | 0b0110011
def lui(rd, imm20):     return ((imm20 & 0xFFFFF) << 12) | (rd << 7) | 0b0110111
def jalr(rd, rs1, imm): return enc_i(imm, rs1, 0, rd, 0b1100111)

def jal(rd, imm):
    u = imm & 0x1FFFFF
    return (((u >> 20) & 1) << 31) | (((u >> 1) & 0x3FF) << 21) | \
           (((u >> 11) & 1) << 20) | (((u >> 12) & 0xFF) << 12) | (rd << 7) | 0b1101111

BR = {"beq": 0, "bne": 1, "blt": 4, "bge": 5, "bltu": 6, "bgeu": 7}
def br(name, rs1, rs2, imm):
    u = imm & 0x1FFF
    return (((u >> 12) & 1) << 31) | (((u >> 5) & 0x3F) << 25) | (rs2 << 20) | \
           (rs1 << 15) | (BR[name] << 12) | (((u >> 1) & 0xF) << 8) | \
           (((u >> 11) & 1) << 7) | 0b1100011


# ── two-pass assembler with labels ──
class Asm:
    def __init__(self, base):
        self.base = base
        self.items = []   # (kind, args) or ("label", name)

    def l(self, name): self.items.append(("label", name))
    def emit(self, fn, *a): self.items.append(("ins", fn, a))

    def assemble(self):
        # pass 1: addresses
        labels, addr = {}, self.base
        for it in self.items:
            if it[0] == "label":
                labels[it[1]] = addr
            else:
                addr += 4
        # pass 2: words
        words, addr = [], self.base
        for it in self.items:
            if it[0] == "label":
                continue
            _, fn, a = it
            a = [labels[x] - addr if isinstance(x, str) else x for x in a]
            words.append((addr, fn(*a) & 0xFFFFFFFF))
            addr += 4
        return words, labels


a = Asm(CODE)
# ── phase 1: 3-level nested loops, backward branches ──
a.emit(addi, 5, 0, 0)          # x5 acc = 0
a.emit(addi, 6, 0, 3)          # i = 3
a.l("outer")
a.emit(addi, 7, 0, 2)          # j = 2
a.l("mid")
a.emit(addi, 8, 0, 2)          # k = 2
a.l("inner")
a.emit(add, 5, 5, 6)
a.emit(add, 5, 5, 8)
a.emit(addi, 8, 8, -1)
a.emit(lambda i: br("bne", 8, 0, i), "inner")     # backward taken x k
a.emit(addi, 7, 7, -1)
a.emit(lambda i: br("bgeu", 7, 0, i), "midchk")   # always taken, forward
a.emit(addi, 5, 5, 100)                            # must be skipped
a.l("midchk")
a.emit(lambda i: br("bne", 7, 0, i), "mid")        # backward
a.emit(addi, 6, 6, -1)
a.emit(lambda i: br("blt", 0, 6, i), "outer")      # backward, signed
# ── phase 2: predicate boundary battery ──
a.emit(addi, 10, 0, -1)        # x10 = u64::MAX / -1
a.emit(addi, 11, 0, 1)
a.emit(addi, 13, 0, 1)
a.emit(slli, 13, 13, 63)       # x13 = i64::MIN
a.emit(lambda i: br("blt", 13, 11, i), "t1")   # MIN <s 1: taken fwd
a.emit(addi, 5, 5, 100)
a.l("t1")
a.emit(lambda i: br("bltu", 13, 11, i), "bad")  # 0x8000.. <u 1: NOT taken
a.emit(addi, 5, 5, 1)
a.emit(lambda i: br("bge", 11, 13, i), "t2")   # 1 >=s MIN: taken
a.emit(addi, 5, 5, 100)
a.l("t2")
a.emit(lambda i: br("bgeu", 13, 10, i), "bad")  # MIN >=u MAX: NOT taken
a.emit(addi, 5, 5, 2)
a.emit(lambda i: br("beq", 10, 10, i), "t3")   # taken
a.emit(addi, 5, 5, 100)
a.l("t3")
a.emit(lambda i: br("bne", 10, 10, i), "bad")   # NOT taken
a.emit(addi, 5, 5, 4)
a.emit(lambda i: br("bge", 10, 12, i), "bad")   # -1 >=s 0: NOT taken
a.emit(addi, 5, 5, 8)
a.emit(lambda i: br("bgeu", 10, 12, i), "t4")  # MAX >=u 0: taken
a.emit(addi, 5, 5, 100)
a.l("t4")
a.emit(lambda i: br("bltu", 12, 10, i), "t5")  # 0 <u MAX: taken
a.emit(addi, 5, 5, 100)
a.l("t5")
a.emit(lambda i: br("blt", 12, 10, i), "bad")   # 0 <s -1: NOT taken
a.emit(addi, 5, 5, 16)
# ── phase 3: computed jump through a 2-entry table (8-byte blocks) ──
a.emit(addi, 14, 0, 1)         # select entry 1
a.emit(slli, 15, 14, 3)        # offset = 1*8
a.emit(lambda i: jal(16, i), "_anchor")   # jal x16,+4: pc capture (link = _anchor)
a.l("_anchor")
a.emit(lambda d: addi(16, 16, d), "table")  # x16 = _anchor + (table - _anchor) = table
a.emit(add, 16, 16, 15)
a.emit(jalr, 0, 16, 0)         # computed jump into table
a.l("table")
a.emit(addi, 5, 5, 100)        # entry 0 (skipped)
a.emit(lambda i: jal(0, i), "after")
a.emit(addi, 5, 5, 32)         # entry 1 (executed)
a.emit(lambda i: jal(0, i), "after")
a.l("after")
# ── phase 4: call chain 3 deep with ra save/restore ──
a.emit(lambda i: jal(1, i), "fa")
a.emit(addi, 5, 5, 64)         # after return
a.emit(lambda i: jal(0, i), "halt")
a.l("fa")
a.emit(addi, 20, 1, 0)
a.emit(lambda i: jal(1, i), "fb")
a.emit(addi, 1, 20, 0)
a.emit(jalr, 0, 1, 0)          # ret
a.l("fb")
a.emit(addi, 21, 1, 0)
a.emit(lambda i: jal(1, i), "fc")
a.emit(addi, 1, 21, 0)
a.emit(jalr, 0, 1, 0)
a.l("fc")
a.emit(addi, 5, 5, 128)
a.emit(jalr, 0, 1, 0)
a.l("bad")                     # landing pad for never-taken branches
a.emit(addi, 5, 5, 100)
a.l("halt")
a.emit(jal, 0, 0)              # self-loop

words, labels = a.assemble()
assert len(words) >= 50, f"only {len(words)} static instructions"

# ── spec-first executor ──
mem = dict(words)
regs = [0] * 32
pc = CODE
trace = []
for _ in range(5000):
    trace.append(pc)
    if pc == labels["halt"]:
        break
    w = mem[pc]
    op = w & 0x7F
    rd = (w >> 7) & 31
    f3 = (w >> 12) & 7
    rs1 = (w >> 15) & 31
    rs2v = regs[(w >> 20) & 31]
    rs1v = regs[rs1]
    npc = (pc + 4) & M64
    if op == 0b0010011:
        if f3 == 0: res = (rs1v + sx(w >> 20, 12)) & M64
        elif f3 == 1: res = (rs1v << ((w >> 20) & 63)) & M64
        else: raise AssertionError("model: unused op-imm")
        if rd: regs[rd] = res
    elif op == 0b0110011:
        if rd: regs[rd] = (rs1v + rs2v) & M64
    elif op == 0b0110111:
        if rd: regs[rd] = sx(((w >> 12) << 12), 32) & M64
    elif op == 0b1101111:  # jal
        imm = sx((((w >> 31) & 1) << 20) | (((w >> 12) & 0xFF) << 12) |
                 (((w >> 20) & 1) << 11) | (((w >> 21) & 0x3FF) << 1), 21)
        tgt = (pc + imm) & M64
        assert tgt % 4 == 0, "torture blob must not trap"
        if rd: regs[rd] = npc
        npc = tgt
    elif op == 0b1100111:  # jalr
        tgt = (rs1v + sx(w >> 20, 12)) & M64 & ~1
        assert tgt % 4 == 0
        if rd: regs[rd] = npc
        npc = tgt
    elif op == 0b1100011:  # branch
        imm = sx((((w >> 31) & 1) << 12) | (((w >> 7) & 1) << 11) |
                 (((w >> 25) & 0x3F) << 5) | (((w >> 8) & 0xF) << 1), 13)
        s1, s2 = sx(rs1v, 64), sx(rs2v, 64)
        taken = {0: rs1v == rs2v, 1: rs1v != rs2v, 4: s1 < s2,
                 5: s1 >= s2, 6: rs1v < rs2v, 7: rs1v >= rs2v}[f3]
        if taken:
            tgt = (pc + imm) & M64
            assert tgt % 4 == 0
            npc = tgt
    else:
        raise AssertionError(f"model: opcode {op:#b}")
    pc = npc
else:
    raise AssertionError("did not reach halt")

print(f"static instrs: {len(words)}, retired: {len(trace)}, acc x5 = {regs[5]}")

with open("torture_data.rs", "w") as f:
    f.write("// GENERATED by spec_model.py — E0-T09 verifier torture blob. Do not edit.\n")
    f.write("pub const TORTURE_BASE: u64 = %#x;\n" % CODE)
    f.write("pub const WORDS: &[(u64, u32)] = &[\n")
    for ad, w in words:
        f.write("    (%#x, %#010x),\n" % (ad, w))
    f.write("];\n")
    f.write("pub const PC_TRACE: &[u64] = &[\n")
    for p in trace:
        f.write("    %#x,\n" % p)
    f.write("];\n")
    f.write("pub const FINAL_REGS: &[u64] = &[\n")
    for v in regs:
        f.write("    %#x,\n" % v)
    f.write("];\n")
print("wrote torture_data.rs")
