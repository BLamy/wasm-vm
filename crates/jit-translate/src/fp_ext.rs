//! Full F/D coverage and inline `fflags`/`frm`/`fcsr` CSR accesses.
//!
//! The E5.5-T03t..x work translated a measured single-precision subset with pure helpers that
//! return `result | flags << 32`. This module extends the same discipline to every remaining F/D
//! operation:
//!
//! * **Pure bit operations stay inline** — `FSGNJ*.D`, `FMV.X.D`, `FMV.D.X`, the `FEQ/FLT/FLE.D`
//!   compares (integer-only ordering exactly like the single-precision compare) and the exact
//!   `FCVT.D.W[U]` integer-to-double conversion (a `clz`-normalised bit construction; every 32-bit
//!   integer is exactly representable, so no rounding or flag can arise).
//! * **Everything that rounds or classifies calls a pure helper** that runs the interpreter's own
//!   `softfloat` routine (`wasm_vm_core::jit::fp_op64` / `fp_op32`). A 32-bit result packs with
//!   its flags into one `i64` (`env.fp_op32`); a 64-bit result cannot, so `env.fp_op64` returns
//!   the result and parks the flags in a per-thread mailbox that the very next `env.fp_flags`
//!   call reads. Both calls are adjacent and nothing can run between them.
//!
//! FS and the resolved rounding mode are checked by the caller (`emit_body`) at the precise PC of
//! each instruction, before any source is read, exactly as `Hart::execute` orders its checks.
//! Single-precision sources are NaN-box checked (`push_boxed_f32`) before entering a helper.
//! Every FPR result is published immediately with its dirty-mask bit, and flags accrue into the
//! shared `fp_state` word right after the operation, so every later precise exit observes them.

use super::{
    ALIGN8, Abi, FpHelperImports, Regs, STATE_BASE, push_boxed_f32, push_freg, push_reg,
    push_rounding_mode, set_freg, set_reg,
};
use wasm_emit::{BlockType, FuncBuilder, ValType};
use wasm_vm_core::decode::{FpArithOp, FpCmpOp, FpFusedOp, FpIntWidth, FpSgnjOp, Instr};
use wasm_vm_core::jit::abi::{FP_CSR_WRITTEN, FP_DIRTY};
use wasm_vm_core::jit::fp_op;

/// Which generic helper an instruction needs (if any).
#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) enum Helper {
    /// `env.fp_op64` + `env.fp_flags`.
    Op64,
    /// `env.fp_op32` (packed result/flags).
    Op32,
}

/// The generic helper `instr` is lowered through, or `None` when it is inline or uses one of the
/// established single-precision helpers (`fp_arith_s`, `fp_div_s`, `fp_fmadd_s`, ...).
pub(crate) fn helper_for(instr: &Instr) -> Option<Helper> {
    use Instr::*;
    match instr {
        FpArithS {
            op: FpArithOp::Sub, ..
        }
        | FsqrtS { .. }
        | FpFusedS {
            op: FpFusedOp::Msub | FpFusedOp::Nmsub | FpFusedOp::Nmadd,
            ..
        }
        | FminmaxS { .. }
        | FclassS { .. }
        | FcvtSD { .. }
        | FclassD { .. }
        | FcvtToIntD {
            width: FpIntWidth::W | FpIntWidth::Wu,
            ..
        } => Some(Helper::Op32),
        FcvtToIntS {
            width: FpIntWidth::L | FpIntWidth::Lu,
            ..
        }
        | FpArithD { .. }
        | FsqrtD { .. }
        | FpFusedD { .. }
        | FminmaxD { .. }
        | FcvtDS { .. }
        | FcvtToIntD {
            width: FpIntWidth::L | FpIntWidth::Lu,
            ..
        }
        | FcvtFromIntD {
            width: FpIntWidth::L | FpIntWidth::Lu,
            ..
        } => Some(Helper::Op64),
        _ => None,
    }
}

/// Whether `instr` is one of the ops this module lowers (the caller dispatches to [`emit`]).
pub(crate) fn handles(instr: &Instr) -> bool {
    use Instr::*;
    helper_for(instr).is_some()
        || matches!(
            instr,
            FsgnjD { .. }
                | FmvXD { .. }
                | FmvDX { .. }
                | FpCmpD { .. }
                | FcvtFromIntD {
                    width: FpIntWidth::W | FpIntWidth::Wu,
                    ..
                }
        )
}

/// The `fflags` / `frm` / `fcsr` CSR addresses the translator inlines.
pub(crate) const fn is_fp_csr(csr: u16) -> bool {
    matches!(csr, 0x001..=0x003)
}

/// A Zicsr instruction on one of the three FP CSRs.
pub(crate) fn is_fp_csr_op(instr: &Instr) -> bool {
    use Instr::*;
    match *instr {
        Csrrw { csr, .. }
        | Csrrs { csr, .. }
        | Csrrc { csr, .. }
        | Csrrwi { csr, .. }
        | Csrrsi { csr, .. }
        | Csrrci { csr, .. } => is_fp_csr(csr),
        _ => false,
    }
}

/// Every F/D op carries the FS requirement; the FP CSR accesses do too (`Csrs::access`).
pub(crate) fn is_fp_family(instr: &Instr) -> bool {
    use Instr::*;
    matches!(
        instr,
        Flw { .. }
            | Fsw { .. }
            | FpArithS { .. }
            | FsqrtS { .. }
            | FpFusedS { .. }
            | FsgnjS { .. }
            | FminmaxS { .. }
            | FpCmpS { .. }
            | FclassS { .. }
            | FmvXW { .. }
            | FmvWX { .. }
            | FcvtToIntS { .. }
            | FcvtFromIntS { .. }
            | Fld { .. }
            | Fsd { .. }
            | FpArithD { .. }
            | FsqrtD { .. }
            | FpFusedD { .. }
            | FsgnjD { .. }
            | FminmaxD { .. }
            | FpCmpD { .. }
            | FclassD { .. }
            | FmvXD { .. }
            | FmvDX { .. }
            | FcvtToIntD { .. }
            | FcvtFromIntD { .. }
            | FcvtSD { .. }
            | FcvtDS { .. }
    ) || is_fp_csr_op(instr)
}

/// The instruction's static `rm` field when `Hart::execute` resolves it (and so may raise an
/// illegal-instruction trap for a reserved/dynamic-invalid mode). `FCVT.D.S` deliberately ignores
/// its `rm` field in the interpreter, so it is excluded.
pub(crate) fn checked_rm(instr: &Instr) -> Option<u8> {
    use Instr::*;
    match *instr {
        FpArithS { rm, .. }
        | FsqrtS { rm, .. }
        | FpFusedS { rm, .. }
        | FcvtToIntS { rm, .. }
        | FcvtFromIntS { rm, .. }
        | FpArithD { rm, .. }
        | FsqrtD { rm, .. }
        | FpFusedD { rm, .. }
        | FcvtToIntD { rm, .. }
        | FcvtFromIntD { rm, .. }
        | FcvtSD { rm, .. } => Some(rm),
        _ => None,
    }
}

/// One helper operand.
#[derive(Clone, Copy)]
enum Src {
    /// Unused operand slot (`i64.const 0`).
    Zero,
    /// Raw 64-bit FPR image (double-precision source).
    Raw(u8),
    /// NaN-box-checked single-precision source.
    Boxed(u8),
    /// Integer register.
    X(u8),
}

fn push_src(f: &mut FuncBuilder, regs: &mut Regs, abi: &Abi, src: Src) {
    match src {
        Src::Zero => f.i64_const(0),
        Src::Raw(r) => push_freg(f, abi, r),
        Src::Boxed(r) => push_boxed_f32(f, abi, r),
        Src::X(r) => push_reg(f, regs, abi, r),
    }
}

/// Push `op, a, b, c, rm` and call a generic helper; leaves its `i64` result on the stack.
fn call_helper(
    f: &mut FuncBuilder,
    regs: &mut Regs,
    abi: &Abi,
    import: u32,
    op: u32,
    srcs: [Src; 3],
    rm: Option<u8>,
) {
    f.i32_const(op as i32);
    for src in srcs {
        push_src(f, regs, abi, src);
    }
    match rm {
        Some(rm) => push_rounding_mode(f, abi, rm),
        None => f.i32_const(0),
    }
    f.call(import);
}

/// OR `flags` (an `i64` holding bits 0..4) plus FP_DIRTY into the shared FP state word.
fn accrue_local_flags(f: &mut FuncBuilder, abi: &Abi, flags: u32) {
    f.local_get(STATE_BASE);
    f.local_get(STATE_BASE);
    f.i64_load(ALIGN8, abi.fp_state);
    f.local_get(flags);
    f.i64_const(31);
    f.i64_and();
    f.i64_or();
    f.i64_const(FP_DIRTY as i64);
    f.i64_or();
    f.i64_store(ALIGN8, abi.fp_state);
}

/// Read the mailbox flags of the immediately preceding `fp_op64` call and accrue them.
fn accrue_mailbox_flags(f: &mut FuncBuilder, abi: &Abi, imports: FpHelperImports) {
    let flags = f.local(ValType::I64);
    f.call(imports.flags.expect("fp_op64 users import fp_flags"));
    f.i64_extend_i32_u();
    f.local_set(flags);
    accrue_local_flags(f, abi, flags);
}

/// Accrue the packed flags (bits 32..36) of an `fp_op32` result held in `packed`.
fn accrue_packed_flags(f: &mut FuncBuilder, abi: &Abi, packed: u32) {
    let flags = f.local(ValType::I64);
    f.local_get(packed);
    f.i64_const(32);
    f.i64_shr_u();
    f.local_set(flags);
    accrue_local_flags(f, abi, flags);
}

/// `fp_op64` whose result is an FPR (double image, no boxing).
#[allow(clippy::too_many_arguments)]
fn op64_to_freg(
    f: &mut FuncBuilder,
    regs: &mut Regs,
    abi: &Abi,
    imports: FpHelperImports,
    op: u32,
    srcs: [Src; 3],
    rm: Option<u8>,
    rd: u8,
) {
    let import = imports.op64.expect("selected op imports fp_op64");
    call_helper(f, regs, abi, import, op, srcs, rm);
    set_freg(f, abi, rd);
    accrue_mailbox_flags(f, abi, imports);
}

/// `fp_op64` whose result is an integer register (FCVT.L[U].{S,D}).
#[allow(clippy::too_many_arguments)]
fn op64_to_xreg(
    f: &mut FuncBuilder,
    regs: &mut Regs,
    abi: &Abi,
    imports: FpHelperImports,
    op: u32,
    src: Src,
    rm: u8,
    rd: u8,
) {
    let import = imports.op64.expect("selected op imports fp_op64");
    call_helper(
        f,
        regs,
        abi,
        import,
        op,
        [src, Src::Zero, Src::Zero],
        Some(rm),
    );
    set_reg(f, regs, rd);
    // Conversions update fcsr/FS even when the result goes to x0.
    accrue_mailbox_flags(f, abi, imports);
}

/// `fp_op32` whose single-precision result is NaN-boxed into an FPR.
#[allow(clippy::too_many_arguments)]
fn op32_to_freg(
    f: &mut FuncBuilder,
    regs: &mut Regs,
    abi: &Abi,
    imports: FpHelperImports,
    op: u32,
    srcs: [Src; 3],
    rm: Option<u8>,
    rd: u8,
) {
    let import = imports.op32.expect("selected op imports fp_op32");
    call_helper(f, regs, abi, import, op, srcs, rm);
    super::emit_fp_packed_result(f, abi, rd);
}

/// Emit one of the ops [`handles`] accepts. FS and `rm` were already validated at this PC.
pub(crate) fn emit(
    f: &mut FuncBuilder,
    regs: &mut Regs,
    abi: &Abi,
    instr: Instr,
    imports: FpHelperImports,
) {
    use Instr::*;
    match instr {
        // ── single precision (remaining families) ──
        FpArithS {
            op: FpArithOp::Sub,
            rd,
            rs1,
            rs2,
            rm,
        } => op32_to_freg(
            f,
            regs,
            abi,
            imports,
            fp_op::SUB_S,
            [Src::Boxed(rs1), Src::Boxed(rs2), Src::Zero],
            Some(rm),
            rd,
        ),
        FsqrtS { rd, rs1, rm } => op32_to_freg(
            f,
            regs,
            abi,
            imports,
            fp_op::SQRT_S,
            [Src::Boxed(rs1), Src::Zero, Src::Zero],
            Some(rm),
            rd,
        ),
        FpFusedS {
            op,
            rd,
            rs1,
            rs2,
            rs3,
            rm,
        } => {
            let selector = match op {
                FpFusedOp::Msub => fp_op::FMSUB_S,
                FpFusedOp::Nmsub => fp_op::FNMSUB_S,
                FpFusedOp::Nmadd => fp_op::FNMADD_S,
                FpFusedOp::Madd => unreachable!("FMADD.S uses the established fp_fmadd_s helper"),
            };
            op32_to_freg(
                f,
                regs,
                abi,
                imports,
                selector,
                [Src::Boxed(rs1), Src::Boxed(rs2), Src::Boxed(rs3)],
                Some(rm),
                rd,
            );
        }
        FminmaxS {
            is_max,
            rd,
            rs1,
            rs2,
        } => op32_to_freg(
            f,
            regs,
            abi,
            imports,
            if is_max { fp_op::MAX_S } else { fp_op::MIN_S },
            [Src::Boxed(rs1), Src::Boxed(rs2), Src::Zero],
            None,
            rd,
        ),
        FclassS { rd, rs1 } => {
            class_to_xreg(f, regs, abi, imports, fp_op::CLASS_S, Src::Boxed(rs1), rd)
        }
        FclassD { rd, rs1 } => {
            class_to_xreg(f, regs, abi, imports, fp_op::CLASS_D, Src::Raw(rs1), rd)
        }
        FcvtToIntS { width, rd, rs1, rm } => {
            let op = match width {
                FpIntWidth::L => fp_op::CVT_L_S,
                FpIntWidth::Lu => fp_op::CVT_LU_S,
                _ => unreachable!("FCVT.W[U].S uses the established fp_to_word_s helper"),
            };
            op64_to_xreg(f, regs, abi, imports, op, Src::Boxed(rs1), rm, rd);
        }
        // ── double precision ──
        FpArithD {
            op,
            rd,
            rs1,
            rs2,
            rm,
        } => {
            let selector = match op {
                FpArithOp::Add => fp_op::ADD_D,
                FpArithOp::Sub => fp_op::SUB_D,
                FpArithOp::Mul => fp_op::MUL_D,
                FpArithOp::Div => fp_op::DIV_D,
            };
            op64_to_freg(
                f,
                regs,
                abi,
                imports,
                selector,
                [Src::Raw(rs1), Src::Raw(rs2), Src::Zero],
                Some(rm),
                rd,
            );
        }
        FsqrtD { rd, rs1, rm } => op64_to_freg(
            f,
            regs,
            abi,
            imports,
            fp_op::SQRT_D,
            [Src::Raw(rs1), Src::Zero, Src::Zero],
            Some(rm),
            rd,
        ),
        FpFusedD {
            op,
            rd,
            rs1,
            rs2,
            rs3,
            rm,
        } => {
            let selector = match op {
                FpFusedOp::Madd => fp_op::FMADD_D,
                FpFusedOp::Msub => fp_op::FMSUB_D,
                FpFusedOp::Nmsub => fp_op::FNMSUB_D,
                FpFusedOp::Nmadd => fp_op::FNMADD_D,
            };
            op64_to_freg(
                f,
                regs,
                abi,
                imports,
                selector,
                [Src::Raw(rs1), Src::Raw(rs2), Src::Raw(rs3)],
                Some(rm),
                rd,
            );
        }
        FminmaxD {
            is_max,
            rd,
            rs1,
            rs2,
        } => op64_to_freg(
            f,
            regs,
            abi,
            imports,
            if is_max { fp_op::MAX_D } else { fp_op::MIN_D },
            [Src::Raw(rs1), Src::Raw(rs2), Src::Zero],
            None,
            rd,
        ),
        FcvtDS { rd, rs1, .. } => op64_to_freg(
            f,
            regs,
            abi,
            imports,
            fp_op::CVT_D_S,
            [Src::Boxed(rs1), Src::Zero, Src::Zero],
            None,
            rd,
        ),
        FcvtSD { rd, rs1, rm } => op32_to_freg(
            f,
            regs,
            abi,
            imports,
            fp_op::CVT_S_D,
            [Src::Raw(rs1), Src::Zero, Src::Zero],
            Some(rm),
            rd,
        ),
        FcvtToIntD { width, rd, rs1, rm } => match width {
            FpIntWidth::L | FpIntWidth::Lu => op64_to_xreg(
                f,
                regs,
                abi,
                imports,
                if width == FpIntWidth::L {
                    fp_op::CVT_L_D
                } else {
                    fp_op::CVT_LU_D
                },
                Src::Raw(rs1),
                rm,
                rd,
            ),
            FpIntWidth::W | FpIntWidth::Wu => {
                let import = imports.op32.expect("selected op imports fp_op32");
                let packed = f.local(ValType::I64);
                call_helper(
                    f,
                    regs,
                    abi,
                    import,
                    if width == FpIntWidth::W {
                        fp_op::CVT_W_D
                    } else {
                        fp_op::CVT_WU_D
                    },
                    [Src::Raw(rs1), Src::Zero, Src::Zero],
                    Some(rm),
                );
                f.local_tee(packed);
                // Both signed and unsigned word results are sign-extended (RV64 `.W` rule).
                f.i32_wrap_i64();
                f.i64_extend_i32_s();
                set_reg(f, regs, rd);
                accrue_packed_flags(f, abi, packed);
            }
        },
        FcvtFromIntD { width, rd, rs1, rm } => match width {
            FpIntWidth::W | FpIntWidth::Wu => {
                emit_exact_word_to_double(f, regs, abi, rs1, width == FpIntWidth::W);
                set_freg(f, abi, rd);
            }
            FpIntWidth::L | FpIntWidth::Lu => op64_to_freg(
                f,
                regs,
                abi,
                imports,
                if width == FpIntWidth::L {
                    fp_op::CVT_D_L
                } else {
                    fp_op::CVT_D_LU
                },
                [Src::X(rs1), Src::Zero, Src::Zero],
                Some(rm),
                rd,
            ),
        },
        FsgnjD { op, rd, rs1, rs2 } => {
            const SIGN: i64 = i64::MIN;
            let a = f.local(ValType::I64);
            push_freg(f, abi, rs1);
            f.local_set(a);
            f.local_get(a);
            f.i64_const(i64::MAX);
            f.i64_and();
            push_freg(f, abi, rs2);
            match op {
                FpSgnjOp::J => {}
                FpSgnjOp::Jn => {
                    f.i64_const(-1);
                    f.i64_xor();
                }
                FpSgnjOp::Jx => {
                    f.local_get(a);
                    f.i64_xor();
                }
            }
            f.i64_const(SIGN);
            f.i64_and();
            f.i64_or();
            set_freg(f, abi, rd);
        }
        FmvXD { rd, rs1 } => {
            // Raw 64-bit move; no canonicalization and no FS/flag effect.
            push_freg(f, abi, rs1);
            set_reg(f, regs, rd);
        }
        FmvDX { rd, rs1 } => {
            push_reg(f, regs, abi, rs1);
            set_freg(f, abi, rd);
        }
        FpCmpD { op, rd, rs1, rs2 } => emit_compare_d(f, regs, abi, op, rd, rs1, rs2),
        _ => unreachable!("fp_ext::emit called on an op it does not handle"),
    }
}

/// FCLASS.{S,D}: the class mask goes to `rd`; FCLASS writes no FP state (no FS dirtying).
fn class_to_xreg(
    f: &mut FuncBuilder,
    regs: &mut Regs,
    abi: &Abi,
    imports: FpHelperImports,
    op: u32,
    src: Src,
    rd: u8,
) {
    let import = imports.op32.expect("selected op imports fp_op32");
    call_helper(f, regs, abi, import, op, [src, Src::Zero, Src::Zero], None);
    f.i64_const(0xffff_ffff);
    f.i64_and();
    set_reg(f, regs, rd);
}

/// Exact FCVT.D.W / FCVT.D.WU from integer bit operations: every 32-bit integer is exactly
/// representable in binary64, so the result is `sign | (1086 - clz(|x|)) << 52 | fraction`, and
/// zero maps to +0 (IEEE: an exact zero conversion is +0 in every rounding mode).
fn emit_exact_word_to_double(
    f: &mut FuncBuilder,
    regs: &mut Regs,
    abi: &Abi,
    rs1: u8,
    signed: bool,
) {
    let x = f.local(ValType::I64);
    let magnitude = f.local(ValType::I64);
    let leading = f.local(ValType::I64);
    push_reg(f, regs, abi, rs1);
    f.i32_wrap_i64();
    if signed {
        f.i64_extend_i32_s();
    } else {
        f.i64_extend_i32_u();
    }
    f.local_set(x);
    if signed {
        // |x| (fits: |INT_MIN| = 2^31).
        f.i64_const(0);
        f.local_get(x);
        f.i64_sub();
        f.local_get(x);
        f.local_get(x);
        f.i64_const(0);
        f.i64_lt_s();
        f.select();
    } else {
        f.local_get(x);
    }
    f.local_tee(magnitude);
    f.i64_clz();
    f.local_set(leading);
    // sign
    if signed {
        f.local_get(x);
        f.i64_const(i64::MIN);
        f.i64_and();
    } else {
        f.i64_const(0);
    }
    // exponent
    f.i64_const(1086);
    f.local_get(leading);
    f.i64_sub();
    f.i64_const(52);
    f.i64_shl();
    f.i64_or();
    // fraction: drop the leading one (shift counts are taken mod 64, so |x| == 1 → shift 0 → 0).
    f.local_get(magnitude);
    f.local_get(leading);
    f.i64_const(1);
    f.i64_add();
    f.i64_shl();
    f.i64_const(12);
    f.i64_shr_u();
    f.i64_or();
    // x == 0 → +0.
    f.i64_const(0);
    f.local_get(x);
    f.i64_eqz();
    f.i32_eqz();
    f.select();
}

/// FEQ/FLT/FLE.D with integer-only ordering (the binary64 twin of the single-precision compare):
/// any NaN compares false; FEQ raises NV only for a signaling NaN, FLT/FLE for any NaN; signed
/// zeros compare equal; same-sign negatives reverse the unsigned bit order.
fn emit_compare_d(
    f: &mut FuncBuilder,
    regs: &mut Regs,
    abi: &Abi,
    op: FpCmpOp,
    rd: u8,
    rs1: u8,
    rs2: u8,
) {
    const MAGNITUDE: i64 = i64::MAX;
    const INFINITY: i64 = 0x7ff0_0000_0000_0000;
    const QUIET: i64 = 0x0008_0000_0000_0000;
    let a = f.local(ValType::I64);
    let b = f.local(ValType::I64);
    let nan_a = f.local(ValType::I32);
    let nan_b = f.local(ValType::I32);
    let invalid = f.local(ValType::I64);
    for (register, bits, nan) in [(rs1, a, nan_a), (rs2, b, nan_b)] {
        push_freg(f, abi, register);
        f.local_tee(bits);
        f.i64_const(MAGNITUDE);
        f.i64_and();
        f.i64_const(INFINITY);
        f.i64_gt_u();
        f.local_set(nan);
    }
    f.local_get(nan_a);
    f.local_get(nan_b);
    f.i32_or();
    f.if_(BlockType::Value(ValType::I32));
    if op == FpCmpOp::Eq {
        for (bits, nan) in [(a, nan_a), (b, nan_b)] {
            f.local_get(nan);
            f.local_get(bits);
            f.i64_const(QUIET);
            f.i64_and();
            f.i64_eqz();
            f.i32_and();
        }
        f.i32_or();
    } else {
        f.i32_const(1);
    }
    f.i64_extend_i32_u();
    f.local_set(invalid);
    f.i32_const(0);
    f.else_();
    f.local_get(a);
    f.local_get(b);
    f.i64_eq();
    f.local_get(a);
    f.local_get(b);
    f.i64_or();
    f.i64_const(MAGNITUDE);
    f.i64_and();
    f.i64_eqz();
    f.i32_or();
    if op != FpCmpOp::Eq {
        f.if_(BlockType::Value(ValType::I32));
        f.i32_const(i32::from(op == FpCmpOp::Le));
        f.else_();
        f.local_get(a);
        f.local_get(b);
        f.i64_xor();
        f.i64_const(0);
        f.i64_lt_s();
        f.if_(BlockType::Value(ValType::I32));
        f.local_get(a);
        f.i64_const(0);
        f.i64_lt_s();
        f.else_();
        f.local_get(a);
        f.i64_const(0);
        f.i64_lt_s();
        f.if_(BlockType::Value(ValType::I32));
        f.local_get(a);
        f.local_get(b);
        f.i64_gt_u();
        f.else_();
        f.local_get(a);
        f.local_get(b);
        f.i64_lt_u();
        f.end();
        f.end();
        f.end();
    }
    f.end();
    f.i64_extend_i32_u();
    set_reg(f, regs, rd);
    // Comparisons dirty FS even with x0 as destination; NV is bit 4.
    f.local_get(invalid);
    f.i64_const(4);
    f.i64_shl();
    f.local_set(invalid);
    accrue_local_flags(f, abi, invalid);
}

/// `fflags` / `frm` / `fcsr` Zicsr access (a block terminator). Mirrors `Csrs::access` for these
/// three unprivileged, never-read-only CSRs: the write happens for CSRRW[I] always and for the
/// set/clear forms only when the source register/immediate field is nonzero; the old value is
/// returned to `rd`; a write applies the WARL field mask, marks FS dirty and flags the low byte of
/// the state word authoritative (`FP_CSR_WRITTEN`) so the host overwrites — not accrues — fcsr.
pub(crate) fn emit_fp_csr(f: &mut FuncBuilder, regs: &mut Regs, abi: &Abi, instr: Instr) {
    use Instr::*;
    #[derive(Clone, Copy, PartialEq, Eq)]
    enum Kind {
        Write,
        Set,
        Clear,
    }
    enum Source {
        Reg(u8),
        Imm(u8),
    }
    let (kind, rd, source, csr) = match instr {
        Csrrw { rd, rs1, csr } => (Kind::Write, rd, Source::Reg(rs1), csr),
        Csrrs { rd, rs1, csr } => (Kind::Set, rd, Source::Reg(rs1), csr),
        Csrrc { rd, rs1, csr } => (Kind::Clear, rd, Source::Reg(rs1), csr),
        Csrrwi { rd, uimm, csr } => (Kind::Write, rd, Source::Imm(uimm), csr),
        Csrrsi { rd, uimm, csr } => (Kind::Set, rd, Source::Imm(uimm), csr),
        Csrrci { rd, uimm, csr } => (Kind::Clear, rd, Source::Imm(uimm), csr),
        _ => unreachable!("emit_fp_csr on a non-Zicsr op"),
    };
    // (field mask inside the state word's low byte, shift, WARL value mask)
    let (field, shift, warl): (i64, i64, i64) = match csr {
        0x001 => (0x1f, 0, 0x1f),
        0x002 => (0xe0, 5, 0x07),
        0x003 => (0xff, 0, 0xff),
        _ => unreachable!("emit_fp_csr on a non-FP CSR"),
    };
    let writes = match (&source, kind) {
        (_, Kind::Write) => true,
        (Source::Reg(r), _) => *r != 0,
        (Source::Imm(u), _) => *u != 0,
    };
    let state = f.local(ValType::I64);
    let old = f.local(ValType::I64);
    f.local_get(STATE_BASE);
    f.i64_load(ALIGN8, abi.fp_state);
    f.local_tee(state);
    f.i64_const(field);
    f.i64_and();
    if shift != 0 {
        f.i64_const(shift);
        f.i64_shr_u();
    }
    f.local_set(old);
    if writes {
        // Source first (rd may alias rs1; the architectural read precedes the rd write).
        match source {
            Source::Reg(r) => push_reg(f, regs, abi, r),
            Source::Imm(u) => f.i64_const(i64::from(u)),
        }
        match kind {
            Kind::Write => {}
            Kind::Set => {
                f.local_get(old);
                f.i64_or();
            }
            Kind::Clear => {
                f.i64_const(-1);
                f.i64_xor();
                f.local_get(old);
                f.i64_and();
            }
        }
        let new = f.local(ValType::I64);
        f.i64_const(warl);
        f.i64_and();
        if shift != 0 {
            f.i64_const(shift);
            f.i64_shl();
        }
        f.local_set(new);
        f.local_get(STATE_BASE);
        f.local_get(state);
        f.i64_const(!field);
        f.i64_and();
        f.local_get(new);
        f.i64_or();
        f.i64_const((FP_DIRTY | FP_CSR_WRITTEN) as i64);
        f.i64_or();
        f.i64_store(ALIGN8, abi.fp_state);
    }
    if rd != 0 {
        // CSRRW with rd == x0 suppresses the read; for these CSRs the read has no side effect,
        // and x0 discards the value anyway.
        f.local_get(old);
        set_reg(f, regs, rd);
    }
}
