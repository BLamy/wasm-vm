//! Perf-overhaul regression pin for the CSR file.
//!
//! The overhaul replaced the CSR file's insertion-ordered WARL list with dense slots, added a
//! derived first-entry cache to the PMP unit and packed the Zicntr write flags. None of that may
//! change anything a guest or a snapshot can see. This test drives the CSR file through a long,
//! seeded random program over the public API: Zicsr reads and writes of every implemented CSR (and
//! unimplemented ones) in U/S/M with each operation form, trap delivery, `mret`/`sret`, device
//! `mip` writes, counters, PMP programming, and CPU-section snapshot round-trips. Some round-trips
//! use hostile WARL tables with duplicate, slot-less and unsorted entries. After every step it
//! folds every observable into one FNV-1a digest: access results and traps, the pending interrupt,
//! delegation, handler entries, `satp`, PMP verdicts and the serialized CSR bytes.
//!
//! The golden digests below were NOT computed by the code under test. They were produced by this
//! same generator running against a verbatim copy of the pre-overhaul `csr.rs`/`pmp.rs` (branch
//! point 2bfc6f50, linear WARL list, uncached PMP scan). They reproduce with the dense-slot
//! implementation. A future refactor that shifts any CSR read, WARL legalization, interrupt choice,
//! PMP verdict or snapshot byte breaks this test. Change a golden only for an intentional,
//! documented change to CSR semantics or to the CPU snapshot format, and say why in the commit.
#![cfg(not(feature = "zicsr-stub"))]

use wasm_vm_core::csr::{CsrOp, Priv};
use wasm_vm_core::hart::Hart;
use wasm_vm_core::pmp::PmpAccess;
use wasm_vm_core::resume::ComponentSnapshot;

/// The device under test, reduced to plain integers so one generator can drive any implementation.
trait Dut {
    fn access(
        &mut self,
        addr: u16,
        op: u8,
        src: u64,
        sz: bool,
        rz: bool,
        tval: u64,
    ) -> Result<u64, (u64, u64)>;
    fn set_mode(&mut self, m: u8);
    fn set_mstatus(&mut self, v: u64);
    fn set_sv(&mut self, sv48: bool, sv57: bool);
    fn trap_m(&mut self, e: u64, c: u64, t: u64);
    fn trap_s(&mut self, e: u64, c: u64, t: u64);
    fn mip_bit(&mut self, bit: u64, on: bool);
    fn mret(&mut self);
    fn sret(&mut self);
    fn arm(&mut self);
    fn tick(&mut self);
    fn time(&mut self, t: u64);
    fn csr_bytes(&self) -> Vec<u8>;
    fn restore_csr_bytes(&mut self, b: &[u8]);
    fn pmp_allow_all(&mut self);
    fn pmp_cfg(&mut self, bank: usize, v: u64);
    fn pmp_addr(&mut self, i: usize, v: u64);
    fn read(&mut self, addr: u16) -> u64;
    fn satp(&self) -> u64;
    fn next_int(&self) -> Option<(u64, bool)>;
    fn pend_nonzero(&self) -> bool;
    fn mie_bits(&self) -> u64;
    fn mtvec_base(&self) -> u64;
    fn stvec_base(&self) -> u64;
    fn m_entry(&self, c: u64, i: bool) -> u64;
    fn s_entry(&self, c: u64, i: bool) -> u64;
    fn deleg(&self, c: u64, i: bool) -> bool;
    fn data_priv(&self) -> u8;
    fn pmp_ok(&self, addr: u64, len: u64, acc: u8, mode: u8) -> bool;
}

struct Rng(u64);
impl Rng {
    fn next(&mut self) -> u64 {
        let mut s = self.0;
        s ^= s >> 12;
        s ^= s << 25;
        s ^= s >> 27;
        self.0 = s;
        s.wrapping_mul(0x2545_F491_4F6C_DD1D)
    }
    fn below(&mut self, n: u64) -> u64 {
        self.next() % n
    }
}

struct Fnv(u64);
impl Fnv {
    fn new() -> Self {
        Fnv(0xcbf2_9ce4_8422_2325)
    }
    fn bytes(&mut self, b: &[u8]) {
        for &x in b {
            self.0 ^= u64::from(x);
            self.0 = self.0.wrapping_mul(0x0000_0100_0000_01B3);
        }
    }
    fn u(&mut self, v: u64) {
        self.bytes(&v.to_le_bytes());
    }
}

const INTERESTING: &[u16] = &[
    0x001, 0x002, 0x003, 0x100, 0x104, 0x105, 0x106, 0x140, 0x141, 0x142, 0x143, 0x144, 0x180,
    0x300, 0x301, 0x302, 0x303, 0x304, 0x305, 0x306, 0x340, 0x341, 0x342, 0x343, 0x344, 0x744,
    0x7A0, 0x7A1, 0x7A2, 0x7A3, 0x7A4, 0x7A5, 0x7C0, 0xB00, 0xB02, 0xC00, 0xC01, 0xC02, 0xC03,
    0xF11, 0xF12, 0xF13, 0xF14, 0x320, 0x7B0, 0x7B1, 0x5A8, 0x14D, 0x3A0, 0x3A1, 0x3A2, 0x3AE,
    0x3B0, 0x3B1, 0x3B2, 0x3B7, 0x3EF,
];
const HOT: &[u16] = &[0x302, 0x303, 0x304, 0x344, 0x104, 0x144, 0x300, 0x100];

fn val(r: &mut Rng) -> u64 {
    match r.below(12) {
        0 => 0,
        1 => !0,
        2 => 1u64 << r.below(64),
        3 => r.next(),
        4 => r.below(16),
        5 => (r.below(16) << 60) | (r.next() & ((1 << 60) - 1)),
        6 => ([0u64, 8, 9, 10][r.below(4) as usize] << 60) | (r.next() & 0xFFF_FFFF),
        7 => 0xAAA,
        8 => r.next() & 0x3FF_FFFF,
        9 => 0x1818_1818_u64.wrapping_mul(r.below(0x100)) & 0x9F9F_9F9F_9F9F_9F9F,
        10 => (0x8000_0000u64 >> 2) | ((1u64 << r.below(24)) - 1),
        _ => r.next() & 0xFFFF,
    }
}

/// Offset of the WARL table count inside the serialized CSR bytes: mode(1) mstatus(8) mcause(8)
/// fflags(1) frm(1).
const WARL_OFF: usize = 19;

fn with_table(bytes: &[u8], table: &[(u16, u64)]) -> Vec<u8> {
    let n_old = u32::from_le_bytes(bytes[WARL_OFF..WARL_OFF + 4].try_into().unwrap()) as usize;
    let tail = &bytes[WARL_OFF + 4 + 10 * n_old..];
    let mut out = bytes[..WARL_OFF].to_vec();
    out.extend_from_slice(&(table.len() as u32).to_le_bytes());
    for (a, v) in table {
        out.extend_from_slice(&a.to_le_bytes());
        out.extend_from_slice(&v.to_le_bytes());
    }
    out.extend_from_slice(tail);
    out
}

fn observe<D: Dut>(d: &D, h: &mut Fnv, r: &mut Rng) {
    h.bytes(&d.csr_bytes());
    h.u(d.satp());
    h.u(d.mtvec_base());
    h.u(d.stvec_base());
    match d.next_int() {
        None => h.u(0xFFFF),
        Some((c, s)) => {
            h.u(c);
            h.u(u64::from(s));
        }
    }
    h.u(u64::from(d.pend_nonzero()));
    h.u(d.mie_bits());
    h.u(u64::from(d.data_priv()));
    for c in 0..16u64 {
        for i in [false, true] {
            h.u(d.m_entry(c, i));
            h.u(d.s_entry(c, i));
            h.u(u64::from(d.deleg(c, i)));
        }
    }
    for _ in 0..6 {
        let base = match r.below(4) {
            0 => 0x8000_0000u64,
            1 => r.next() & 0xFFFF_FFFF,
            2 => (r.next() & 0x3FF_FFFF) << 2,
            _ => r.next(),
        };
        let addr = base.wrapping_add(r.below(33)).wrapping_sub(16);
        let len = [1u64, 2, 4, 8, 16, 0, 4096][r.below(7) as usize];
        let mode = [0u8, 1, 3][r.below(3) as usize];
        for acc in 0..3u8 {
            h.u(u64::from(d.pmp_ok(addr, len, acc, mode)));
        }
    }
}

/// Drive `d` through `steps` random operations from `seed`; return the folded digest.
fn digest<D: Dut>(d: &mut D, seed: u64, steps: usize) -> u64 {
    let mut r = Rng(seed.wrapping_mul(0x9E37_79B9_7F4A_7C15) | 1);
    let mut h = Fnv::new();
    d.set_sv(r.below(2) == 0, r.below(2) == 0);
    for _ in 0..steps {
        let k = r.below(20);
        h.u(k);
        match k {
            0..=7 => {
                let addr = if r.below(10) == 0 {
                    r.below(0x1000) as u16
                } else if r.below(3) == 0 {
                    HOT[r.below(HOT.len() as u64) as usize]
                } else {
                    INTERESTING[r.below(INTERESTING.len() as u64) as usize]
                };
                let op = (r.next() % 3) as u8;
                let src = val(&mut r);
                let sz = src == 0 || r.below(8) == 0;
                let rz = r.below(3) == 0;
                let tval = r.next();
                match d.access(addr, op, src, sz, rz, tval) {
                    Ok(v) => {
                        h.u(1);
                        h.u(v);
                    }
                    Err((c, t)) => {
                        h.u(2);
                        h.u(c);
                        h.u(t);
                    }
                }
            }
            8 => d.set_mode([0u8, 1, 3][r.below(3) as usize]),
            9 => {
                let v = if r.below(2) == 0 {
                    r.next()
                } else {
                    r.next() & 0xAA
                };
                d.set_mstatus(v);
            }
            10 => {
                let (e, c, t) = (r.next(), r.below(16) | (r.below(2) << 63), r.next());
                d.trap_m(e, c, t);
            }
            11 => {
                let (e, c, t) = (r.next(), r.below(16) | (r.below(2) << 63), r.next());
                d.trap_s(e, c, t);
            }
            12 => {
                let bit = if r.below(4) == 0 {
                    r.below(64)
                } else {
                    [1u64, 3, 5, 7, 9, 11][r.below(6) as usize]
                };
                d.mip_bit(bit, r.below(2) == 0);
            }
            13 => {
                if r.below(2) == 0 {
                    d.mret();
                } else {
                    d.sret();
                }
            }
            14 => match r.below(3) {
                0 => d.arm(),
                1 => d.tick(),
                _ => {
                    let t = r.next();
                    d.time(t);
                }
            },
            15 => {
                let b = d.csr_bytes();
                d.restore_csr_bytes(&b);
            }
            16 if r.below(4) == 0 => {
                let b = d.csr_bytes();
                let len = r.below(8) as usize;
                let mut table = Vec::new();
                for _ in 0..len {
                    let a = match r.below(4) {
                        0 => INTERESTING[r.below(INTERESTING.len() as u64) as usize],
                        1 => [0x344u16, 0x304, 0x303, 0x180, 0x305, 0x105][r.below(6) as usize],
                        2 => r.below(0x1000) as u16,
                        _ => [0x999u16, 0x100, 0x300, 0x7A4, 0x744][r.below(5) as usize],
                    };
                    table.push((a, val(&mut r)));
                }
                d.restore_csr_bytes(&with_table(&b, &table));
            }
            16 | 17 => {
                if r.below(3) == 0 {
                    d.pmp_allow_all();
                } else {
                    let bank = (r.below(8) * 2) as usize;
                    let mut v = 0u64;
                    for k in 0..8 {
                        let x = r.next();
                        let a = if x.is_multiple_of(3) { (x >> 8) % 4 } else { 0 };
                        let l = if x.is_multiple_of(29) { 0x80 } else { 0 };
                        v |= (((x >> 16) & 7) | (a << 3) | l) << (k * 8);
                    }
                    d.pmp_cfg(bank, v);
                }
            }
            18 => {
                let i = r.below(8) as usize;
                let v = val(&mut r);
                d.pmp_addr(i, v);
            }
            _ => {
                for _ in 0..4 {
                    let a = INTERESTING[r.below(INTERESTING.len() as u64) as usize];
                    h.u(d.read(a));
                }
            }
        }
        observe(d, &mut h, &mut r);
    }
    h.0
}

const SEEDS: u64 = 48;
const STEPS: usize = 1500;

/// The Hart's CPU section is `pc(8) x1..x31(248) f0..f31(256) resv(1 when None)` then the CSR bytes.
const CSR_OFF: usize = 8 + 31 * 8 + 32 * 8 + 1;

fn prio(m: u8) -> Priv {
    match m {
        0 => Priv::U,
        1 => Priv::S,
        _ => Priv::M,
    }
}

impl Dut for Hart {
    fn access(
        &mut self,
        addr: u16,
        op: u8,
        src: u64,
        sz: bool,
        rz: bool,
        tval: u64,
    ) -> Result<u64, (u64, u64)> {
        let op = match op {
            0 => CsrOp::Write,
            1 => CsrOp::Set,
            _ => CsrOp::Clear,
        };
        self.csr
            .access(addr, op, src, sz, rz, tval)
            .map_err(|t| (t.cause as u64, t.tval))
    }
    fn set_mode(&mut self, m: u8) {
        self.csr.mode = prio(m);
    }
    fn set_mstatus(&mut self, v: u64) {
        self.csr.mstatus = v;
    }
    fn set_sv(&mut self, sv48: bool, sv57: bool) {
        self.csr.sv48 = sv48;
        self.csr.sv57 = sv57;
    }
    fn trap_m(&mut self, e: u64, c: u64, t: u64) {
        self.csr.deliver_trap_m(e, c, t);
    }
    fn trap_s(&mut self, e: u64, c: u64, t: u64) {
        self.csr.deliver_trap_s(e, c, t);
    }
    fn mip_bit(&mut self, bit: u64, on: bool) {
        self.csr.set_mip_bit(bit, on);
    }
    fn mret(&mut self) {
        self.csr.mret();
    }
    fn sret(&mut self) {
        self.csr.sret();
    }
    fn arm(&mut self) {
        self.csr.arm_counters();
    }
    fn tick(&mut self) {
        self.csr.retire_tick();
    }
    fn time(&mut self, t: u64) {
        self.csr.set_time(t);
    }
    fn csr_bytes(&self) -> Vec<u8> {
        let v = self.to_snapshot();
        assert_eq!(v[CSR_OFF - 1], 0, "reservation must stay empty");
        v[CSR_OFF..].to_vec()
    }
    fn restore_csr_bytes(&mut self, b: &[u8]) {
        let mut v = self.to_snapshot();
        v.truncate(CSR_OFF);
        v.extend_from_slice(b);
        self.restore(&v).expect("CPU section restores");
    }
    fn pmp_allow_all(&mut self) {
        self.csr.pmp.allow_all();
    }
    fn pmp_cfg(&mut self, bank: usize, v: u64) {
        self.csr.pmp.write_cfg(bank, v);
    }
    fn pmp_addr(&mut self, i: usize, v: u64) {
        self.csr.pmp.write_addr(i, v);
    }
    fn read(&mut self, addr: u16) -> u64 {
        self.csr.read(addr)
    }
    fn satp(&self) -> u64 {
        self.csr.satp()
    }
    fn next_int(&self) -> Option<(u64, bool)> {
        self.csr.next_interrupt()
    }
    fn pend_nonzero(&self) -> bool {
        self.csr.mip_and_mie_nonzero()
    }
    fn mie_bits(&self) -> u64 {
        self.csr.mie_bits()
    }
    fn mtvec_base(&self) -> u64 {
        self.csr.mtvec_base()
    }
    fn stvec_base(&self) -> u64 {
        self.csr.stvec_base()
    }
    fn m_entry(&self, c: u64, i: bool) -> u64 {
        self.csr.m_handler_entry(c, i)
    }
    fn s_entry(&self, c: u64, i: bool) -> u64 {
        self.csr.s_handler_entry(c, i)
    }
    fn deleg(&self, c: u64, i: bool) -> bool {
        self.csr.delegates_to_s(c, i)
    }
    fn data_priv(&self) -> u8 {
        self.csr.data_priv() as u8
    }
    fn pmp_ok(&self, addr: u64, len: u64, acc: u8, mode: u8) -> bool {
        let acc = match acc {
            0 => PmpAccess::Read,
            1 => PmpAccess::Write,
            _ => PmpAccess::Exec,
        };
        self.csr.pmp_ok(addr, len, acc, prio(mode))
    }
}

/// Golden per-seed digests from the pre-overhaul reference implementation (see the module docs).
const GOLDEN: [u64; SEEDS as usize] = [
    0xa132cfd586a808c0,
    0xc303cbbeeb56c85b,
    0x0e5ac806eedf6442,
    0xc39bae2ab2ce2c14,
    0x1ad807b3ff632516,
    0x1f69b3b6eb852c3d,
    0x1194937ac8ddf4a5,
    0xb7e48dfd036ec4ef,
    0x85d4c52c4ef45222,
    0x6487bfbbcf6ef8e6,
    0x0d8f54e96eae891d,
    0x143aee8746c6b80c,
    0x417a24e24c15e13a,
    0xc5a8a420717ac5df,
    0xdd102764cd31e563,
    0x5324bb08aae4052b,
    0x9639da300c27cb49,
    0x48ab2fb91dbe9357,
    0x6d6ca5f9cf4df722,
    0x427a046c132555d8,
    0x0efaea45496ce67b,
    0xd7352895cda58a14,
    0x428d64170a023977,
    0x0ebb516e86158ce5,
    0xe69ad2196d3a1fb2,
    0xa32c82b76c46fc9b,
    0x4b4406210a1bc851,
    0xc986100e7fbc54ae,
    0x5ba3d7d311c56c9a,
    0x5c2f817e20bdf7b2,
    0x3cd935205db0be8a,
    0x4f7bced7f12f5f68,
    0x3f489527b02f64d3,
    0x4926200a8c062fc7,
    0x51544e2befcb5a0e,
    0x5934d8fc7c7bae83,
    0x95cd9477aed8a46b,
    0xda036e496149734b,
    0x3d5dc2182cc3b106,
    0xe497e8c2675bc849,
    0x8f063b22ee12108f,
    0x0d298ab8a92b714f,
    0x1e08b49bcae8fd68,
    0x35195228610df466,
    0x47af46687d525f93,
    0x88240a4eca52045e,
    0x120faa5172948b5e,
    0x7b5c42ddb5986b0f,
];

#[test]
fn csr_file_matches_pre_overhaul_reference_digests() {
    let mut got = Vec::new();
    for seed in 1..=SEEDS {
        let mut h = Hart::new();
        got.push(digest(&mut h, seed, STEPS));
    }
    for (i, (g, want)) in got.iter().zip(GOLDEN.iter()).enumerate() {
        assert_eq!(
            g,
            want,
            "seed {}: CSR-file behaviour diverged from the pre-overhaul reference",
            i + 1
        );
    }
}
