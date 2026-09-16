// Fixed finite arithmetic isolates the existing helper-call boundary. Numerical
// corner cases remain covered by the independent FP verifier fixtures.
import assert from "node:assert/strict";

export function mixedFpFixture(iterations = 50000) {
  assert.ok(Number.isInteger(iterations) && iterations >= 400 && iterations <= 1000000);
  const addi = (rd,rs,imm) => ((imm<<20)|(rs<<15)|(rd<<7)|0x13)>>>0;
  const bne = (rs1,rs2,off) => ((((off>>>12)&1)<<31)|(((off>>>5)&63)<<25)|(rs2<<20)|(rs1<<15)|(1<<12)|(((off>>>1)&15)<<8)|(((off>>>11)&1)<<7)|0x63)>>>0;
  const flw = (rd,off) => ((off<<20)|(5<<15)|(2<<12)|(rd<<7)|7)>>>0;
  const fma = (rm,rd,a,b,c) => ((c<<27)|(b<<20)|(a<<15)|(rm<<12)|(rd<<7)|0x43)>>>0;
  const csr = (rd,address) => ((address<<20)|(2<<12)|(rd<<7)|0x73)>>>0;
  const fsd = (rs,off) => (((off>>>5)<<25)|(rs<<20)|(5<<15)|(3<<12)|((off&31)<<7)|0x27)>>>0;
  const ld = (rd,off) => ((off<<20)|(5<<15)|(3<<12)|(rd<<7)|3)>>>0;
  const words = [0x000020b7,0x30009073,0x00105073,0x00215073,
    0x00002297,addi(5,5,-16), ((((iterations+2048)>>>12)<<12)|(6<<7)|0x37)>>>0,
    addi(6,6,(iterations&4095)-(iterations&2048?4096:0)),
    flw(0,0),flw(1,4),flw(2,8),flw(3,12),flw(4,16),flw(5,20),flw(30,24),flw(31,28),
    fma(7,6,0,1,2),fma(1,7,3,4,31),fma(0,8,5,30,31),
    ((0x60<<25)|(4<<15)|(10<<7)|0x53)>>>0, // FCVT.W.S x10,f4 -> 4
    ((0x68<<25)|(10<<15)|(9<<7)|0x53)>>>0, // FCVT.S.W f9,x10 -> 4
    ((9<<20)|(9<<15)|(10<<7)|0x53)>>>0,   // FADD.S f10,f9,f9 -> 8
    ((12<<25)|(9<<20)|(4<<15)|(11<<7)|0x53)>>>0, // FDIV.S f11,f4,f9 -> 1
    fma(0,12,6,31,6),addi(6,6,-1),bne(6,0,-36),
    csr(20,1),csr(21,2),csr(22,0x300),
    ...[6,7,8,9,10,11,12].map((r,i)=>fsd(r,32+i*8)),
    ...[13,14,15,16,17,18,19].map((r,i)=>ld(r,32+i*8)),0x0000006f];
  const elf = Buffer.alloc(0x3060);
  elf.set([0x7f,0x45,0x4c,0x46,2,1,1]);
  elf.writeUInt16LE(2,16);elf.writeUInt16LE(243,18);elf.writeUInt32LE(1,20);
  elf.writeBigUInt64LE(0x80000000n,24);elf.writeBigUInt64LE(64n,32);
  elf.writeUInt16LE(64,52);elf.writeUInt16LE(56,54);elf.writeUInt16LE(1,56);
  elf.writeUInt32LE(1,64);elf.writeUInt32LE(7,68);elf.writeBigUInt64LE(0x1000n,72);
  elf.writeBigUInt64LE(0x80000000n,80);elf.writeBigUInt64LE(0x80000000n,88);
  elf.writeBigUInt64LE(0x2060n,96);elf.writeBigUInt64LE(12288n,104);elf.writeBigUInt64LE(4096n,112);
  words.forEach((word,i)=>elf.writeUInt32LE(word,0x1000+i*4));
  [0x3fc00000,0x3f000000,0x3e800000,0x40000000,0x40800000,0x40400000,0x3e000000,0]
    .forEach((bits,i)=>elf.writeUInt32LE(bits,0x3000+i*4));
  return {elf,words,iterations,retirements:iterations*10+65,
    helperCalls:{fp_arith_s:iterations,fp_from_int_s:iterations,fp_to_word_s:iterations,
      fp_div_s:iterations,fp_fmadd_s:iterations*4},
    expected:[[10,"4"],[13,"ffffffff3f800000"],[14,"ffffffff41000000"],
      [15,"ffffffff3ec00000"],[16,"ffffffff40800000"],[17,"ffffffff41000000"],
      [18,"ffffffff3f800000"],[19,"ffffffff3f800000"],[20,"0"],[21,"2"]]};
}
