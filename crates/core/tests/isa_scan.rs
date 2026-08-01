//! E3.5-T05d ISA investigation: scan a binary's `.text` through the interpreter's OWN
//! `decode()` / `expand_c()` and tally the instructions it rejects. Comparing a binary that
//! SIGILLs in-guest (Docker Hub busybox) against one that runs (Alpine busybox) pinpoints the
//! rv64gc opcode(s) the decoder is missing — no emulator boot needed.
//!
//!   ISA_TEXT=/tmp/isa/busybox.text cargo test -p wasm-vm-core --test isa_scan -- --nocapture

use std::collections::BTreeMap;
use wasm_vm_core::decode::decode;
use wasm_vm_core::decode_c::expand_c;

fn scan(path: &str) {
    let t = match std::fs::read(path) {
        Ok(b) => b,
        Err(e) => {
            println!("SKIP {path}: {e}");
            return;
        }
    };
    // Undecodable 32-bit ops keyed by (opcode[6:0], funct3[14:12], funct7[31:25]); and a raw sample.
    let mut bad32: BTreeMap<(u8, u8, u8), (u64, u32)> = BTreeMap::new();
    let mut badc: BTreeMap<(u8, u8), (u64, u16)> = BTreeMap::new(); // (op[1:0], funct3[15:13])
    let (mut n16, mut n32, mut ok16, mut ok32) = (0u64, 0u64, 0u64, 0u64);
    let mut i = 0usize;
    while i + 2 <= t.len() {
        let parcel = u16::from_le_bytes([t[i], t[i + 1]]);
        if parcel & 0b11 != 0b11 {
            // 16-bit compressed
            n16 += 1;
            match expand_c(parcel) {
                Ok(_) => ok16 += 1,
                Err(_) => {
                    let k = ((parcel & 0b11) as u8, (parcel >> 13) as u8 & 0b111);
                    let e = badc.entry(k).or_insert((0, parcel));
                    e.0 += 1;
                }
            }
            i += 2;
        } else {
            if i + 4 > t.len() {
                break;
            }
            let w = u32::from_le_bytes([t[i], t[i + 1], t[i + 2], t[i + 3]]);
            n32 += 1;
            match decode(w) {
                Ok(_) => ok32 += 1,
                Err(_) => {
                    let k = ((w & 0x7f) as u8, (w >> 12) as u8 & 0b111, (w >> 25) as u8 & 0x7f);
                    let e = bad32.entry(k).or_insert((0, w));
                    e.0 += 1;
                }
            }
            i += 4;
        }
    }
    println!("\n==== {path} ====");
    println!("16-bit: {ok16}/{n16} decoded, {} undecodable kinds", badc.len());
    println!("32-bit: {ok32}/{n32} decoded, {} undecodable kinds", bad32.len());
    let mut v32: Vec<_> = bad32.iter().collect();
    v32.sort_by(|a, b| b.1 .0.cmp(&a.1 .0));
    for ((op, f3, f7), (cnt, sample)) in v32.iter().take(12) {
        println!("  32b UNDECODED x{cnt:<6} opcode=0b{op:07b} funct3={f3} funct7=0b{f7:07b} sample=0x{sample:08x}");
    }
    let mut vc: Vec<_> = badc.iter().collect();
    vc.sort_by(|a, b| b.1 .0.cmp(&a.1 .0));
    for ((op, f3), (cnt, sample)) in vc.iter().take(8) {
        println!("  16b UNDECODED x{cnt:<6} op={op:02b} funct3={f3} sample=0x{sample:04x}");
    }
}

#[test]
fn scan_isa_text() {
    if let Ok(p) = std::env::var("ISA_TEXT") {
        for path in p.split(',') {
            scan(path);
        }
    } else {
        scan("/tmp/isa/busybox.text");
        scan("/tmp/isa/alpine.text");
    }
}
