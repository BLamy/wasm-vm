//! Full F/D + fflags/frm/fcsr JIT coverage, proven against the interpreter.
//!
//! Every newly translated operation (the remaining single-precision families, all of D, and the
//! inline FP CSR accesses) is executed by generated wasm under wasmtime and by `Hart::exec_oracle`
//! from identical architectural state, and the complete result is compared: every x/f register
//! (raw 64-bit images, so NaN-boxing and canonical-NaN payloads are exact), the precise PC, the
//! trap (cause + tval), `fflags`, `frm`, and `mstatus` (FS/SD dirtying).
//!
//! Operands mix IEEE special values (±0, ±inf, quiet/signaling NaNs with payloads, subnormal and
//! normal boundaries, rounding ties, integer-conversion boundaries) with random bit patterns,
//! improperly NaN-boxed single-precision sources, every static rounding mode including the
//! reserved 5/6, and dynamic `rm = 7` under every `frm` (so reserved dynamic modes trap). FS is
//! driven through Off/Initial/Clean/Dirty. Multi-op random blocks prove flag accumulation across
//! operations, the once-per-block FS guard, rd/rs aliasing, and fcsr writes followed by reads.

use jit_runtime::WasmtimeExecutor;
use wasm_vm_core::Machine;
use wasm_vm_core::bus::mmap::DRAM_BASE;
use wasm_vm_core::csr::{CsrOp, MSTATUS};
use wasm_vm_core::decode::decode;
use wasm_vm_core::dispatch::{DecodedBlock, MicroOp};
use wasm_vm_core::hart::{Exception, Hart, Trap};
use wasm_vm_core::jit::{CompiledBlockExecutor, ExitCode};
use wasm_vm_core::mmio::SystemBus;
use wasm_vm_core::ram::Ram;

// ── encoders ──────────────────────────────────────────────────────────────────
fn fr(funct7: u32, rs2: u32, rs1: u32, rm: u32, rd: u32) -> u32 {
    (funct7 << 25) | (rs2 << 20) | (rs1 << 15) | (rm << 12) | (rd << 7) | 0x53
}
fn fr4(opcode: u32, double: bool, rs3: u32, rs2: u32, rs1: u32, rm: u32, rd: u32) -> u32 {
    (rs3 << 27)
        | (u32::from(double) << 25)
        | (rs2 << 20)
        | (rs1 << 15)
        | (rm << 12)
        | (rd << 7)
        | opcode
}
fn csr(funct3: u32, addr: u32, rs1: u32, rd: u32) -> u32 {
    (addr << 20) | (rs1 << 15) | (funct3 << 12) | (rd << 7) | 0x73
}
const ADDI_X9: u32 = 0x0014_8493; // addi x9, x9, 1

/// Every new F/D operation shape, parameterised by `(rd, rs1, rs2, rs3, rm)`.
type Enc = fn(u32, u32, u32, u32, u32) -> u32;
const OPS: &[(&str, Enc, bool)] = &[
    // (name, encoder, carries rm)
    ("fsub.s", |d, a, b, _, rm| fr(0x04, b, a, rm, d), true),
    ("fsqrt.s", |d, a, _, _, rm| fr(0x2c, 0, a, rm, d), true),
    (
        "fmsub.s",
        |d, a, b, c, rm| fr4(0x47, false, c, b, a, rm, d),
        true,
    ),
    (
        "fnmsub.s",
        |d, a, b, c, rm| fr4(0x4b, false, c, b, a, rm, d),
        true,
    ),
    (
        "fnmadd.s",
        |d, a, b, c, rm| fr4(0x4f, false, c, b, a, rm, d),
        true,
    ),
    ("fmin.s", |d, a, b, _, _| fr(0x14, b, a, 0, d), false),
    ("fmax.s", |d, a, b, _, _| fr(0x14, b, a, 1, d), false),
    ("fclass.s", |d, a, _, _, _| fr(0x70, 0, a, 1, d), false),
    ("fcvt.l.s", |d, a, _, _, rm| fr(0x60, 2, a, rm, d), true),
    ("fcvt.lu.s", |d, a, _, _, rm| fr(0x60, 3, a, rm, d), true),
    ("fadd.d", |d, a, b, _, rm| fr(0x01, b, a, rm, d), true),
    ("fsub.d", |d, a, b, _, rm| fr(0x05, b, a, rm, d), true),
    ("fmul.d", |d, a, b, _, rm| fr(0x09, b, a, rm, d), true),
    ("fdiv.d", |d, a, b, _, rm| fr(0x0d, b, a, rm, d), true),
    ("fsqrt.d", |d, a, _, _, rm| fr(0x2d, 0, a, rm, d), true),
    (
        "fmadd.d",
        |d, a, b, c, rm| fr4(0x43, true, c, b, a, rm, d),
        true,
    ),
    (
        "fmsub.d",
        |d, a, b, c, rm| fr4(0x47, true, c, b, a, rm, d),
        true,
    ),
    (
        "fnmsub.d",
        |d, a, b, c, rm| fr4(0x4b, true, c, b, a, rm, d),
        true,
    ),
    (
        "fnmadd.d",
        |d, a, b, c, rm| fr4(0x4f, true, c, b, a, rm, d),
        true,
    ),
    ("fsgnj.d", |d, a, b, _, _| fr(0x11, b, a, 0, d), false),
    ("fsgnjn.d", |d, a, b, _, _| fr(0x11, b, a, 1, d), false),
    ("fsgnjx.d", |d, a, b, _, _| fr(0x11, b, a, 2, d), false),
    ("fmin.d", |d, a, b, _, _| fr(0x15, b, a, 0, d), false),
    ("fmax.d", |d, a, b, _, _| fr(0x15, b, a, 1, d), false),
    ("fcvt.s.d", |d, a, _, _, rm| fr(0x20, 1, a, rm, d), true),
    ("fcvt.d.s", |d, a, _, _, rm| fr(0x21, 0, a, rm, d), true),
    ("feq.d", |d, a, b, _, _| fr(0x51, b, a, 2, d), false),
    ("flt.d", |d, a, b, _, _| fr(0x51, b, a, 1, d), false),
    ("fle.d", |d, a, b, _, _| fr(0x51, b, a, 0, d), false),
    ("fclass.d", |d, a, _, _, _| fr(0x71, 0, a, 1, d), false),
    ("fcvt.w.d", |d, a, _, _, rm| fr(0x61, 0, a, rm, d), true),
    ("fcvt.wu.d", |d, a, _, _, rm| fr(0x61, 1, a, rm, d), true),
    ("fcvt.l.d", |d, a, _, _, rm| fr(0x61, 2, a, rm, d), true),
    ("fcvt.lu.d", |d, a, _, _, rm| fr(0x61, 3, a, rm, d), true),
    ("fcvt.d.w", |d, a, _, _, rm| fr(0x69, 0, a, rm, d), true),
    ("fcvt.d.wu", |d, a, _, _, rm| fr(0x69, 1, a, rm, d), true),
    ("fcvt.d.l", |d, a, _, _, rm| fr(0x69, 2, a, rm, d), true),
    ("fcvt.d.lu", |d, a, _, _, rm| fr(0x69, 3, a, rm, d), true),
    ("fmv.x.d", |d, a, _, _, _| fr(0x71, 0, a, 0, d), false),
    ("fmv.d.x", |d, a, _, _, _| fr(0x79, 0, a, 0, d), false),
    // FP CSR accesses (block terminators): rs1 field doubles as uimm for the *I forms.
    ("csrrw fflags", |d, a, _, _, _| csr(1, 0x001, a, d), false),
    ("csrrs frm", |d, a, _, _, _| csr(2, 0x002, a, d), false),
    ("csrrc fcsr", |d, a, _, _, _| csr(3, 0x003, a, d), false),
    ("csrrwi frm", |d, a, _, _, _| csr(5, 0x002, a, d), false),
    ("csrrsi fflags", |d, a, _, _, _| csr(6, 0x001, a, d), false),
    ("csrrci fcsr", |d, a, _, _, _| csr(7, 0x003, a, d), false),
    ("csrrw fcsr", |d, a, _, _, _| csr(1, 0x003, a, d), false),
    ("csrrs fflags", |d, a, _, _, _| csr(2, 0x001, a, d), false),
];

const D_SPECIAL: &[u64] = &[
    0,
    0x8000_0000_0000_0000,
    0x7ff0_0000_0000_0000,
    0xfff0_0000_0000_0000,
    0x7ff8_0000_0000_0000,
    0x7ff8_0000_0000_1234,
    0xfff8_0000_0000_0001,
    0x7ff0_0000_0000_0001,
    0x7ff4_0000_0000_0000,
    0xfff0_0000_0000_0001,
    1,
    0x000f_ffff_ffff_ffff,
    0x8000_0000_0000_0001,
    0x0010_0000_0000_0000,
    0x7fef_ffff_ffff_ffff,
    0xffef_ffff_ffff_ffff,
    0x3ff0_0000_0000_0000,
    0xbff0_0000_0000_0000,
    0x3fe0_0000_0000_0000,
    0x3ff8_0000_0000_0000,
    0x4004_0000_0000_0000,
    0xc004_0000_0000_0000,
    0x3ff0_0000_0000_0001,
    0x4009_21fb_5444_2d18,
    0x4340_0000_0000_0000,
    0x4340_0000_0000_0001,
    0x43e0_0000_0000_0000,
    0x43f0_0000_0000_0000,
    0xc1e0_0000_0000_0000,
    0x41df_ffff_ffc0_0000,
    0x41df_ffff_ffe0_0000,
    0x41f0_0000_0000_0000,
    0xc3e0_0000_0000_0000,
    0x3cb0_0000_0000_0000,
    0x0360_0000_0000_0000,
    0x7fe0_0000_0000_0000,
    0x36a0_0000_0000_0000,
    0x47efffffe0000000,
    0x47efffff_f0000000,
    0x380f_ffff_f000_0000,
];

const S_SPECIAL: &[u32] = &[
    0,
    0x8000_0000,
    0x7f80_0000,
    0xff80_0000,
    0x7fc0_0000,
    0x7fc0_1234,
    0x7fa0_0000,
    0x7f80_0001,
    0xff80_0001,
    1,
    0x007f_ffff,
    0x8000_0001,
    0x0080_0000,
    0x7f7f_ffff,
    0xff7f_ffff,
    0x3f80_0000,
    0xbf80_0000,
    0x3f00_0000,
    0x3fc0_0000,
    0x4020_0000,
    0xc020_0000,
    0x3f80_0001,
    0x4f00_0000,
    0x5f00_0000,
    0x5f80_0000,
    0xcf00_0000,
    0xdf00_0000,
];

const X_SPECIAL: &[u64] = &[
    0,
    1,
    u64::MAX,
    0x7fff_ffff,
    0x8000_0000,
    0xffff_ffff,
    0xffff_ffff_8000_0000,
    0x7fff_ffff_ffff_ffff,
    0x8000_0000_0000_0000,
    0x0020_0000_0000_0001,
    0x0000_0000_0000_001f,
    0x0000_0000_0000_00e0,
    0x0000_0000_0000_00ff,
    0x0000_0000_0000_0005,
];

struct Rng(u64);
impl Rng {
    fn next(&mut self) -> u64 {
        self.0 ^= self.0 << 13;
        self.0 ^= self.0 >> 7;
        self.0 ^= self.0 << 17;
        self.0
    }
    fn below(&mut self, n: u64) -> u64 {
        self.next() % n
    }
    fn pick<T: Copy>(&mut self, xs: &[T]) -> T {
        xs[self.below(xs.len() as u64) as usize]
    }
    /// A random FPR image: boxed single, raw double, or an improperly boxed single.
    fn freg(&mut self) -> u64 {
        match self.below(8) {
            0..=2 => 0xffff_ffff_0000_0000 | u64::from(self.pick(S_SPECIAL)),
            3 => 0xffff_ffff_0000_0000 | (self.next() & 0xffff_ffff),
            4 | 5 => self.pick(D_SPECIAL),
            6 => self.next(),
            _ => self.pick(S_SPECIAL).into(), // not NaN-boxed
        }
    }
    fn xreg(&mut self) -> u64 {
        if self.below(3) == 0 {
            self.next()
        } else {
            self.pick(X_SPECIAL)
        }
    }
}

fn block(pc: u64, words: &[u32]) -> DecodedBlock {
    let ops: Vec<_> = words
        .iter()
        .map(|&raw| MicroOp {
            raw,
            len: 4,
            instr: decode(raw).unwrap_or_else(|_| panic!("decode {raw:08x}")),
        })
        .collect();
    let len = 4 * ops.len() as u64;
    DecodedBlock::new(pc, ops, len)
}

fn seed(m: &mut Machine, rng: &mut Rng) {
    let h = m.hart_mut();
    for r in 1..32 {
        h.regs.write(r, rng.xreg());
    }
    for r in 0..32 {
        h.fregs.write_raw(r, rng.freg());
    }
    h.regs.pc = 0x4000_2000;
    // FS: mostly enabled (Initial/Clean/Dirty), sometimes Off.
    let fs = match rng.below(10) {
        0 => 0,
        1 => 1,
        2..=5 => 2,
        _ => 3,
    };
    h.csr
        .access(MSTATUS, CsrOp::Write, fs << 13, false, false, 0)
        .unwrap();
    h.csr.fflags = rng.below(32) as u8;
    h.csr.frm = if rng.below(4) == 0 {
        rng.below(8) as u8
    } else {
        rng.below(5) as u8
    };
}

/// Run `b` in the JIT and in the interpreter from the same state; assert full equality. Returns
/// whether the JIT executed the whole block cleanly (no trap / partial exit).
fn compare(e: &mut WasmtimeExecutor, m: &mut Machine, b: &DecodedBlock, label: &str) -> bool {
    let h = m.hart();
    let mut oracle = Hart {
        regs: h.regs.clone(),
        fregs: h.fregs.clone(),
        csr: h.csr.clone(),
        resv: h.resv,
        ..Hart::default()
    };
    let mut bus = SystemBus::new(Ram::new(64 * 1024).unwrap());
    let translated = jit_translate::translated_len(b);
    let mut trap = None;
    let mut retired = 0u64;
    for op in &b.ops[..translated] {
        match oracle.exec_oracle(&mut bus, op.instr, op.len.into(), op.raw.into()) {
            Ok(()) => retired += 1,
            Err(t) => {
                trap = Some(t);
                break;
            }
        }
    }
    let ptr: *mut Machine = m;
    // SAFETY: the machine owns disjoint hart and bus for this synchronous call.
    let exit = unsafe {
        e.execute_with_budget(
            b.phys_start,
            (*ptr).hart_mut(),
            (*ptr).bus_mut(),
            256,
            256,
            false,
        )
        .expect("compiled block executes")
    };
    let actual_trap = match exit.code {
        ExitCode::IllegalInstruction => Some(Trap {
            cause: Exception::IllegalInstruction,
            tval: exit.exit_info,
        }),
        _ => exit.trap,
    };
    assert_eq!(actual_trap, trap, "{label}: trap");
    assert_eq!(exit.next_pc, oracle.regs.pc, "{label}: precise pc");
    if trap.is_none() && translated < b.ops.len() {
        assert_eq!(exit.code, ExitCode::CallInterp, "{label}: partial exit");
        assert_eq!(
            exit.exit_info,
            ((translated as u64) << 56) | b.phys_start,
            "{label}: partial exit names block + op index"
        );
    }
    let h = m.hart();
    for r in 0..32 {
        assert_eq!(h.regs.read(r), oracle.regs.read(r), "{label}: x{r}");
        assert_eq!(
            h.fregs.read_raw(r),
            oracle.fregs.read_raw(r),
            "{label}: f{r} raw image"
        );
    }
    assert_eq!(h.csr.fflags, oracle.csr.fflags, "{label}: fflags");
    assert_eq!(h.csr.frm, oracle.csr.frm, "{label}: frm");
    let status = m.hart_mut().csr.read(MSTATUS);
    assert_eq!(status, oracle.csr.read(MSTATUS), "{label}: mstatus FS/SD");
    let _ = retired;
    trap.is_none() && translated == b.ops.len()
}

#[test]
fn every_new_fp_op_matches_the_interpreter_across_rounding_modes_and_specials() {
    let mut m = Machine::new(64 * 1024);
    let mut e = WasmtimeExecutor::new();
    let mut rng = Rng(0x9e37_79b9_7f4a_7c15);
    let mut blocks = 0u64;
    let mut clean = 0u64;
    let mut cases = 0u64;
    for &(name, enc, has_rm) in OPS {
        let rms: &[u32] = if has_rm {
            &[0, 1, 2, 3, 4, 5, 6, 7]
        } else {
            &[0]
        };
        for &rm in rms {
            // Register shapes: distinct, rd aliasing a source, and x0/f0 destinations.
            for (d, a, bb, c) in [(4, 1, 2, 3), (1, 1, 2, 3), (0, 2, 2, 1), (31, 30, 29, 28)] {
                let word = enc(d, a, bb, c, rm);
                let b = block(DRAM_BASE + blocks * 0x40, &[word]);
                blocks += 1;
                e.install(&b);
                assert!(e.is_compiled(b.phys_start), "{name} must translate");
                for _ in 0..24 {
                    seed(&mut m, &mut rng);
                    let label = format!("{name} rm={rm} rd={d} rs=({a},{bb},{c}) word={word:08x}");
                    clean += u64::from(compare(&mut e, &mut m, &b, &label));
                    cases += 1;
                }
            }
        }
    }
    assert!(
        clean > cases / 2,
        "most cases must retire cleanly ({clean}/{cases})"
    );
    eprintln!("FP_FULL single-op cases={cases} clean={clean} blocks={blocks}");
}

#[test]
fn random_fp_blocks_accumulate_flags_and_alias_exactly() {
    let mut m = Machine::new(64 * 1024);
    let mut e = WasmtimeExecutor::new();
    let mut rng = Rng(0x2545_f491_4f6c_dd1d);
    let mut cases = 0u64;
    for n in 0..400u64 {
        let len = 1 + rng.below(7) as usize;
        let mut words = Vec::with_capacity(len + 1);
        for _ in 0..len {
            // Mostly FP compute (non-terminator), with the occasional integer op between them.
            loop {
                let (_, enc, has_rm) = rng.pick(OPS);
                let rm = if has_rm {
                    // Mostly valid (static or dynamic), sometimes reserved.
                    match rng.below(10) {
                        0 => 5 + rng.below(2) as u32,
                        1..=3 => 7,
                        _ => rng.below(5) as u32,
                    }
                } else {
                    0
                };
                let regs = [0u32, 1, 2, 3, 4, 5]; // a small pool makes aliasing frequent
                let word = enc(
                    rng.pick(&regs),
                    rng.pick(&regs),
                    rng.pick(&regs),
                    rng.pick(&regs),
                    rm,
                );
                let instr = decode(word).unwrap();
                if !wasm_vm_core::dispatch::is_terminator(&instr) {
                    words.push(word);
                    break;
                }
            }
            if rng.below(4) == 0 {
                words.push(ADDI_X9);
            }
        }
        // End with an FP CSR access (terminator) half of the time.
        if rng.below(2) == 0 {
            let funct3 = rng.pick(&[1u32, 2, 3, 5, 6, 7]);
            let addr = 1 + rng.below(3) as u32;
            words.push(csr(funct3, addr, rng.below(6) as u32, rng.below(6) as u32));
        }
        let b = block(DRAM_BASE + n * 0x80, &words);
        e.install(&b);
        assert!(e.is_compiled(b.phys_start));
        for k in 0..8 {
            seed(&mut m, &mut rng);
            compare(
                &mut e,
                &mut m,
                &b,
                &format!("random block {n}/{k} {words:08x?}"),
            );
            cases += 1;
        }
    }
    eprintln!("FP_FULL random-block cases={cases}");
}

#[test]
fn fcsr_write_then_read_in_one_chainless_sequence() {
    // fsflags(x5); frflags(x6) must observe the written value; frm writes change the dynamic
    // rounding of the NEXT block (a CSR op ends its block).
    let mut m = Machine::new(64 * 1024);
    let mut e = WasmtimeExecutor::new();
    let write_flags = block(DRAM_BASE, &[csr(1, 0x001, 5, 7)]);
    let write_frm = block(DRAM_BASE + 0x40, &[csr(5, 0x002, 2, 8)]); // fsrmi x8, RDN
    let add_dyn = block(
        DRAM_BASE + 0x80,
        &[fr(0x01, 2, 1, 7, 3), csr(2, 0x003, 0, 6)], // fadd.d f3,f1,f2,dyn ; frcsr x6
    );
    for b in [&write_flags, &write_frm, &add_dyn] {
        e.install(b);
        assert!(e.is_compiled(b.phys_start));
    }
    let mut rng = Rng(7);
    for _ in 0..64 {
        seed(&mut m, &mut rng);
        m.hart_mut()
            .csr
            .access(MSTATUS, CsrOp::Write, 1 << 13, false, false, 0)
            .unwrap();
        m.hart_mut().regs.write(5, rng.next());
        compare(&mut e, &mut m, &write_flags, "fsflags");
        compare(&mut e, &mut m, &write_frm, "fsrmi");
        m.hart_mut().fregs.write_raw(1, 0x3ff0_0000_0000_0000);
        m.hart_mut().fregs.write_raw(2, 0xbca0_0000_0000_0001); // -(2^-53 + tiny): RDN-visible
        compare(&mut e, &mut m, &add_dyn, "fadd.d dyn + frcsr");
        assert_eq!(m.hart().csr.frm, 2);
        assert_eq!(m.hart().regs.read(6) >> 5, 2, "frcsr observes the new frm");
    }
}

#[test]
fn partial_blocks_compile_their_prefix_and_exit_precisely() {
    // A block ending in an untranslatable system CSR access compiles its prefix and hands the
    // CSR op to the interpreter with the exact retired prefix and block/op identity.
    let mut m = Machine::new(64 * 1024);
    let mut e = WasmtimeExecutor::new();
    let csrr_sstatus = csr(2, 0x100, 0, 10);
    let b = block(
        DRAM_BASE,
        &[ADDI_X9, fr(0x09, 2, 1, 0, 3), ADDI_X9, csrr_sstatus],
    );
    let whole_unsupported = block(DRAM_BASE + 0x100, &[csrr_sstatus]);
    e.install(&b);
    e.install(&whole_unsupported);
    assert!(e.is_compiled(b.phys_start));
    assert!(!e.is_compiled(whole_unsupported.phys_start));
    let mut rng = Rng(99);
    for i in 0..128 {
        seed(&mut m, &mut rng);
        compare(&mut e, &mut m, &b, &format!("partial {i}"));
    }
    let coverage = e.translation_coverage();
    assert_eq!(coverage.partial_blocks, 1);
    assert_eq!(coverage.rejected_blocks, 1);
    assert!(coverage.partial_exits > 0);
    assert_eq!(coverage.first_unsupported, vec![("csr:sstatus", 2)]);
}
