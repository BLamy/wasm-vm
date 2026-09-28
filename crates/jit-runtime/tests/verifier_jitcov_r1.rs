//! Verifier (jitcov round 1) attacks that the implementer's fixtures do not target directly:
//!
//! * the INLINE exact `FCVT.D.W[U]` bit construction over a dense sweep of 32-bit integers
//!   (every power of two and its neighbours, plus random words) — no helper is involved, so this
//!   is the one D conversion whose correctness rests purely on generated integer code;
//! * the inline integer-only `FEQ/FLT/FLE.D` ordering over adversarial near-equal pairs
//!   (adjacent ulps, sign mixes, signed zeros, subnormals, sNaN/qNaN);
//! * the native FPR-image elision across a PRECISE TRAP exit: an FP block writes an FPR and then
//!   faults on a load; another block of the same module (same private state memory) must observe
//!   the committed FPR and the accrued flags, never a stale image.
//!
//! Every case is compared bit-for-bit with `Hart::exec_oracle` from identical state.

use wasm_vm_core::Machine;
use wasm_vm_core::bus::mmap::DRAM_BASE;
use wasm_vm_core::csr::{CsrOp, MSTATUS};
use wasm_vm_core::decode::decode;
use wasm_vm_core::dispatch::{DecodedBlock, MicroOp};
use wasm_vm_core::hart::{Exception, Hart, Trap};
use wasm_vm_core::jit::{CompiledBlockExecutor, ExitCode};
use wasm_vm_core::mmio::SystemBus;
use wasm_vm_core::ram::Ram;

fn fr(funct7: u32, rs2: u32, rs1: u32, rm: u32, rd: u32) -> u32 {
    (funct7 << 25) | (rs2 << 20) | (rs1 << 15) | (rm << 12) | (rd << 7) | 0x53
}
fn fld(rd: u32, rs1: u32, imm: i32) -> u32 {
    ((imm as u32) << 20) | (rs1 << 15) | (3 << 12) | (rd << 7) | 0x07
}

fn block(pc: u64, words: &[u32]) -> DecodedBlock {
    let ops: Vec<_> = words
        .iter()
        .map(|&raw| MicroOp {
            raw,
            len: 4,
            instr: decode(raw).unwrap(),
        })
        .collect();
    let len = 4 * ops.len() as u64;
    DecodedBlock::new(pc, ops, len)
}

struct Rng(u64);
impl Rng {
    fn next(&mut self) -> u64 {
        self.0 ^= self.0 << 13;
        self.0 ^= self.0 >> 7;
        self.0 ^= self.0 << 17;
        self.0
    }
}

fn set_fs(m: &mut Machine, fs: u64) {
    m.hart_mut()
        .csr
        .access(MSTATUS, CsrOp::Write, fs << 13, false, false, 0)
        .unwrap();
}

/// Execute `b` once in the JIT and in the interpreter from the machine's current state and
/// require identical architectural results. Returns the (identical) precise trap, if any.
fn lockstep(
    e: &mut dyn CompiledBlockExecutor,
    m: &mut Machine,
    b: &DecodedBlock,
    what: &str,
) -> Option<Trap> {
    let h = m.hart();
    let mut oracle = Hart {
        regs: h.regs.clone(),
        fregs: h.fregs.clone(),
        csr: h.csr.clone(),
        resv: h.resv,
        ..Hart::default()
    };
    let mut bus = SystemBus::new(Ram::new(64 * 1024).unwrap());
    let mut trap = None;
    for op in &b.ops {
        if let Err(t) = oracle.exec_oracle(&mut bus, op.instr, op.len.into(), op.raw.into()) {
            trap = Some(t);
            break;
        }
    }
    let ptr: *mut Machine = m;
    // SAFETY: disjoint hart and bus of one machine for this synchronous call.
    let exit = unsafe {
        e.execute_with_budget(
            b.phys_start,
            (*ptr).hart_mut(),
            (*ptr).bus_mut(),
            256,
            256,
            false,
        )
    }
    .expect("compiled block executes");
    let got_trap = match exit.code {
        ExitCode::IllegalInstruction => Some(Trap {
            cause: Exception::IllegalInstruction,
            tval: exit.exit_info,
        }),
        _ => exit.trap,
    };
    assert_eq!(got_trap, trap, "{what}: trap");
    assert_eq!(exit.next_pc, oracle.regs.pc, "{what}: pc");
    let h = m.hart_mut();
    for r in 0..32 {
        assert_eq!(h.regs.read(r), oracle.regs.read(r), "{what}: x{r}");
        assert_eq!(
            h.fregs.read_raw(r),
            oracle.fregs.read_raw(r),
            "{what}: f{r}"
        );
    }
    assert_eq!(h.csr.fflags, oracle.csr.fflags, "{what}: fflags");
    assert_eq!(h.csr.frm, oracle.csr.frm, "{what}: frm");
    assert_eq!(
        h.csr.read(MSTATUS),
        oracle.csr.read(MSTATUS),
        "{what}: mstatus"
    );
    got_trap
}

#[test]
fn inline_fcvt_d_w_and_wu_are_exact_over_a_dense_integer_sweep() {
    let mut m = Machine::new(64 * 1024);
    let mut e = jit_runtime::WasmtimeExecutor::new();
    // fcvt.d.w f1, x5 (rne) ; fcvt.d.wu f2, x5 (dyn) ; fcvt.d.w f3, x6 (rtz)
    let b = block(
        DRAM_BASE,
        &[
            fr(0x69, 0, 5, 0, 1),
            fr(0x69, 1, 5, 7, 2),
            fr(0x69, 0, 6, 1, 3),
        ],
    );
    e.install(&b);
    assert!(e.is_compiled(b.phys_start));
    let mut values: Vec<u64> = Vec::new();
    for k in 0..64u32 {
        let p = 1u64 << k;
        values.extend([p, p.wrapping_sub(1), p.wrapping_add(1), p.wrapping_neg()]);
    }
    values.extend([
        0,
        u64::MAX,
        0x8000_0000,
        0x7fff_ffff,
        0xffff_ffff,
        0xffff_ffff_8000_0000,
    ]);
    let mut rng = Rng(0x0123_4567_89ab_cdef);
    for _ in 0..40_000 {
        values.push(rng.next());
    }
    set_fs(&mut m, 1);
    for (i, &x) in values.iter().enumerate() {
        let h = m.hart_mut();
        h.regs.pc = DRAM_BASE;
        h.regs.write(5, x);
        h.regs.write(6, x.rotate_left(17));
        h.csr.frm = (i % 5) as u8;
        lockstep(&mut e, &mut m, &b, &format!("fcvt.d.w[u] x={x:#x}"));
    }
    eprintln!("VERIFIER fcvt.d.w/wu values={}", values.len());
}

#[test]
fn inline_double_compares_match_softfloat_on_adversarial_pairs() {
    let mut m = Machine::new(64 * 1024);
    let mut e = jit_runtime::WasmtimeExecutor::new();
    // feq.d x5,f1,f2 ; flt.d x6,f1,f2 ; fle.d x7,f1,f2 ; flt.d x8,f2,f1 ; fle.d x9,f2,f1
    let b = block(
        DRAM_BASE,
        &[
            fr(0x51, 2, 1, 2, 5),
            fr(0x51, 2, 1, 1, 6),
            fr(0x51, 2, 1, 0, 7),
            fr(0x51, 1, 2, 1, 8),
            fr(0x51, 1, 2, 0, 9),
        ],
    );
    e.install(&b);
    assert!(e.is_compiled(b.phys_start));
    let seeds: &[u64] = &[
        0,
        0x8000_0000_0000_0000,
        1,
        0x8000_0000_0000_0001,
        0x000f_ffff_ffff_ffff,
        0x0010_0000_0000_0000,
        0x3ff0_0000_0000_0000,
        0xbff0_0000_0000_0000,
        0x7fef_ffff_ffff_ffff,
        0x7ff0_0000_0000_0000,
        0xfff0_0000_0000_0000,
        0x7ff8_0000_0000_0000,
        0x7ff0_0000_0000_0001,
        0xfff4_0000_0000_0000,
    ];
    let mut rng = Rng(0xfeed_face_cafe_beef);
    let mut cases = 0;
    set_fs(&mut m, 2);
    for round in 0..20_000u64 {
        let a = if round % 3 == 0 {
            seeds[(rng.next() % seeds.len() as u64) as usize]
        } else {
            rng.next()
        };
        // b: a itself, an adjacent ulp either way, its negation, or independent.
        let b2 = match rng.next() % 6 {
            0 => a,
            1 => a.wrapping_add(1),
            2 => a.wrapping_sub(1),
            3 => a ^ 0x8000_0000_0000_0000,
            4 => seeds[(rng.next() % seeds.len() as u64) as usize],
            _ => rng.next(),
        };
        let h = m.hart_mut();
        h.regs.pc = DRAM_BASE;
        h.fregs.write_raw(1, a);
        h.fregs.write_raw(2, b2);
        h.csr.fflags = (round % 32) as u8;
        lockstep(&mut e, &mut m, &b, &format!("cmp a={a:#x} b={b2:#x}"));
        cases += 1;
    }
    eprintln!("VERIFIER double compares cases={cases}");
}

#[test]
fn fp_image_elision_survives_a_precise_trap_exit_inside_the_module() {
    let mut m = Machine::new(64 * 1024);
    let mut e = jit_runtime::WasmtimeExecutor::new();
    // A: fdiv.d f3, f1, f2 (dyn) ; fld f4, 0(x5) -> x5 = unmapped: precise load fault after f3.
    let a = block(DRAM_BASE, &[fr(0x0d, 2, 1, 7, 3), fld(4, 5, 0)]);
    // B: fadd.d f5, f3, f4 (rne) ; fmul.d f6, f3, f3 (rtz)
    let b = block(
        DRAM_BASE + 0x40,
        &[fr(0x01, 4, 3, 0, 5), fr(0x09, 3, 3, 1, 6)],
    );
    // C: integer only, same module.
    let c = block(DRAM_BASE + 0x80, &[0x0014_8493]);
    e.install_batch(
        &[a.clone(), b.clone(), c.clone()],
        &[[None, None], [None, None], [None, None]],
    );
    for blk in [&a, &b, &c] {
        assert!(e.is_compiled(blk.phys_start));
    }
    let mut rng = Rng(0x1357_9bdf_2468_ace0);
    for round in 0..500u64 {
        let h = m.hart_mut();
        for r in 1..6 {
            h.fregs.write_raw(r, rng.next());
        }
        h.fregs.write_raw(
            2,
            [0, 0x8000_0000_0000_0000, rng.next()][(round % 3) as usize],
        );
        h.regs.write(5, 0x10); // unmapped: FLD faults precisely
        h.csr.fflags = 0;
        h.csr.frm = (round % 5) as u8;
        set_fs(&mut m, 1 + round % 3);
        m.hart_mut().regs.pc = DRAM_BASE;
        let trap = lockstep(
            &mut e,
            &mut m,
            &a,
            &format!("round {round}: A traps after fdiv"),
        );
        assert_eq!(
            trap.map(|t| t.cause),
            Some(Exception::LoadAccessFault),
            "A must take the precise FLD fault after committing f3"
        );
        m.hart_mut().regs.pc = DRAM_BASE + 0x40;
        lockstep(
            &mut e,
            &mut m,
            &b,
            &format!("round {round}: B after A's trap"),
        );
        m.hart_mut().regs.pc = DRAM_BASE + 0x80;
        lockstep(&mut e, &mut m, &c, &format!("round {round}: C integer"));
        // An interpreter-side write between entries into the same module.
        m.hart_mut().fregs.write_raw(3, rng.next());
        m.hart_mut().regs.pc = DRAM_BASE + 0x40;
        lockstep(
            &mut e,
            &mut m,
            &b,
            &format!("round {round}: B after outside f3 write"),
        );
    }
}
