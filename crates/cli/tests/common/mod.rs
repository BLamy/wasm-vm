//! A minimal RV64 `ET_EXEC` ELF forge + instruction encoders, so the CLI integration
//! tests can synthesize exit-code / trap / spinner / console guests WITHOUT a cross
//! toolchain (the acceptance criteria require a cold clone with only Rust). Emits exactly
//! what `wasm_vm_core::loader` parses: the 64-byte header, one PT_LOAD program header,
//! the code, and — when a `tohost` address is given — a `.strtab`/`.symtab` pair so the
//! HTIF exit watch arms.

#![allow(dead_code)]

pub const DRAM_BASE: u64 = 0x8000_0000;
pub const UART0_THR: u64 = 0x1000_0000;
/// Where the forged guests place their `tohost` word (in RAM, past the code).
pub const TOHOST: u64 = DRAM_BASE + 0x200;

// ── instruction encoders ────────────────────────────────────────────────────
pub fn i_type(imm: i32, rs1: u8, f3: u32, rd: u8, op: u32) -> u32 {
    (((imm as u32) & 0xFFF) << 20) | ((rs1 as u32) << 15) | (f3 << 12) | ((rd as u32) << 7) | op
}
pub fn s_type(imm: i32, rs2: u8, rs1: u8, f3: u32) -> u32 {
    let iu = (imm as u32) & 0xFFF;
    ((iu >> 5) << 25)
        | ((rs2 as u32) << 20)
        | ((rs1 as u32) << 15)
        | (f3 << 12)
        | ((iu & 0x1F) << 7)
        | 0b0100011
}
pub fn b_type(imm: i32, rs2: u8, rs1: u8, f3: u32) -> u32 {
    let u = imm as u32;
    (((u >> 12) & 1) << 31)
        | (((u >> 5) & 0x3F) << 25)
        | ((rs2 as u32) << 20)
        | ((rs1 as u32) << 15)
        | (f3 << 12)
        | (((u >> 1) & 0xF) << 8)
        | (((u >> 11) & 1) << 7)
        | 0b1100011
}
pub fn lui(rd: u8, imm20: u32) -> u32 {
    (imm20 << 12) | ((rd as u32) << 7) | 0b0110111
}
pub fn addi(rd: u8, rs1: u8, imm: i32) -> u32 {
    i_type(imm, rs1, 0b000, rd, 0b0010011)
}
pub fn slli(rd: u8, rs1: u8, shamt: u32) -> u32 {
    i_type(shamt as i32, rs1, 0b001, rd, 0b0010011)
}
pub fn sb(rs2: u8, rs1: u8, imm: i32) -> u32 {
    s_type(imm, rs2, rs1, 0b000)
}
pub fn sd(rs2: u8, rs1: u8, imm: i32) -> u32 {
    s_type(imm, rs2, rs1, 0b011)
}
pub const EBREAK: u32 = 0x0010_0073;
pub const SPIN: u32 = 0x0000_006F; // jal x0, 0

/// `x{reg} = TOHOST` (0x8000_0200) built without a sign-extending `lui`.
fn load_tohost_ptr(reg: u8) -> [u32; 3] {
    [addi(reg, 0, 1), slli(reg, reg, 31), addi(reg, reg, 0x200)]
}

/// Words → little-endian bytes.
pub fn asm(words: &[u32]) -> Vec<u8> {
    words.iter().flat_map(|w| w.to_le_bytes()).collect()
}

// ── ready-made guests ────────────────────────────────────────────────────────

/// Store `(code<<1)|1` to `tohost` then spin: HTIF sees exit `code`.
pub fn guest_exit(code: u64) -> Vec<u8> {
    let val = ((code << 1) | 1) as i32;
    assert!(
        (-2048..2048).contains(&val),
        "exit encoding must fit addi imm"
    );
    let mut w = load_tohost_ptr(6).to_vec(); // x6 = TOHOST
    w.push(addi(5, 0, val)); // x5 = (code<<1)|1
    w.push(sd(5, 6, 0)); // sd x5, 0(x6)
    w.push(SPIN);
    forge(DRAM_BASE, &asm(&w), Some(TOHOST))
}

/// `ebreak` then spin — a precise Breakpoint trap.
pub fn guest_ebreak() -> Vec<u8> {
    forge(DRAM_BASE, &asm(&[EBREAK, SPIN]), None)
}

/// `jal x0, 0` — an infinite loop retiring one instruction forever.
pub fn guest_spin() -> Vec<u8> {
    forge(DRAM_BASE, &asm(&[SPIN]), None)
}

/// Write every byte value 0..=255 to the UART THR, then exit 0.
pub fn guest_print_all_bytes() -> Vec<u8> {
    let mut w = vec![
        lui(6, 0x10000),         // x6 = 0x1000_0000 (UART THR)
        addi(5, 0, 0),           // x5 = 0 (byte + counter)
        addi(7, 0, 256),         // x7 = 256 (limit)
        sb(5, 6, 0),             // L: sb x5, 0(x6)
        addi(5, 5, 1),           // x5++
        b_type(-8, 7, 5, 0b100), // blt x5, x7, L
    ];
    w.extend_from_slice(&load_tohost_ptr(28)); // x28 = TOHOST
    w.push(addi(29, 0, 1)); // x29 = 1 → exit 0
    w.push(sd(29, 28, 0));
    w.push(SPIN);
    forge(DRAM_BASE, &asm(&w), Some(TOHOST))
}

// ── the forge ────────────────────────────────────────────────────────────────

fn forge(load_addr: u64, code: &[u8], tohost: Option<u64>) -> Vec<u8> {
    let code_off: u64 = 64 + 56; // ehdr + one phdr
    let str_off = code_off + code.len() as u64;
    let strtab: &[u8] = b"\0tohost\0"; // "tohost" at index 1
    let sym_off = str_off + strtab.len() as u64;
    let sym_size: u64 = 48; // null entry + one real entry, 24 bytes each
    let sh_off = sym_off + sym_size;

    let mut b = vec![0u8; code_off as usize];
    // ELF identification.
    b[0..4].copy_from_slice(&[0x7F, b'E', b'L', b'F']);
    b[4] = 2; // ELFCLASS64
    b[5] = 1; // little-endian
    b[6] = 1; // EI_VERSION
    let put16 =
        |b: &mut [u8], off: usize, v: u16| b[off..off + 2].copy_from_slice(&v.to_le_bytes());
    let put32 =
        |b: &mut [u8], off: usize, v: u32| b[off..off + 4].copy_from_slice(&v.to_le_bytes());
    let put64 =
        |b: &mut [u8], off: usize, v: u64| b[off..off + 8].copy_from_slice(&v.to_le_bytes());
    put16(&mut b, 16, 2); // ET_EXEC
    put16(&mut b, 18, 243); // EM_RISCV
    put32(&mut b, 20, 1); // e_version
    put64(&mut b, 24, load_addr); // e_entry
    put64(&mut b, 32, 64); // e_phoff
    put16(&mut b, 52, 64); // e_ehsize
    put16(&mut b, 54, 56); // e_phentsize
    put16(&mut b, 56, 1); // e_phnum
    // Program header @ 64.
    put32(&mut b, 64, 1); // PT_LOAD
    put32(&mut b, 68, 7); // RWX
    put64(&mut b, 72, code_off); // p_offset
    put64(&mut b, 80, load_addr); // p_vaddr
    put64(&mut b, 88, load_addr); // p_paddr
    put64(&mut b, 96, code.len() as u64); // p_filesz
    put64(&mut b, 104, code.len() as u64); // p_memsz
    put64(&mut b, 112, 8); // p_align

    b.extend_from_slice(code);

    if let Some(tohost) = tohost {
        put64(&mut b, 40, sh_off); // e_shoff
        put16(&mut b, 58, 64); // e_shentsize
        put16(&mut b, 60, 3); // e_shnum (null, symtab, strtab)

        b.extend_from_slice(strtab);
        // symtab: entry 0 = null, entry 1 = { name=1, value=tohost }.
        let mut sym = vec![0u8; 48];
        sym[24..28].copy_from_slice(&1u32.to_le_bytes()); // st_name = 1 ("tohost")
        sym[24 + 8..24 + 16].copy_from_slice(&tohost.to_le_bytes()); // st_value
        b.extend_from_slice(&sym);
        // section headers: [0]=null, [1]=symtab, [2]=strtab.
        let mut sh = vec![0u8; 64 * 3];
        // sh[1] symtab
        sh[64 + 4..64 + 8].copy_from_slice(&2u32.to_le_bytes()); // SHT_SYMTAB
        sh[64 + 24..64 + 32].copy_from_slice(&sym_off.to_le_bytes());
        sh[64 + 32..64 + 40].copy_from_slice(&sym_size.to_le_bytes());
        sh[64 + 40..64 + 44].copy_from_slice(&2u32.to_le_bytes()); // sh_link → strtab (index 2)
        // sh[2] strtab
        sh[128 + 4..128 + 8].copy_from_slice(&3u32.to_le_bytes()); // SHT_STRTAB
        sh[128 + 24..128 + 32].copy_from_slice(&str_off.to_le_bytes());
        sh[128 + 32..128 + 40].copy_from_slice(&(strtab.len() as u64).to_le_bytes());
        b.extend_from_slice(&sh);
    }
    b
}
