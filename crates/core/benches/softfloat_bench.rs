//! E1-T05: throughput of the softfloat backend (native). Numbers feed the comparison table
//! in `docs/design/softfloat.md`. Each bench sums results across a fixed input vector so the
//! optimizer cannot elide the ops. NOTE: the vectors are built with host floats (bench
//! setup only — never the guest datapath), then handed to the backend as raw bits.
use criterion::{Criterion, black_box, criterion_group, criterion_main};
use wasm_vm_core::softfloat::{F32, F64, RoundMode, SoftFloat};

const RNE: RoundMode = RoundMode::Rne;

fn inputs() -> Vec<(u64, u64, u64)> {
    // Deterministic pseudo-random finite doubles (LCG), avoiding inf/nan exponents.
    let mut s: u64 = 0x1234_5678_9abc_def0;
    (0..1024)
        .map(|_| {
            let mut n = || {
                s = s.wrapping_mul(6364136223846793005).wrapping_add(1);
                let mut b = s & 0x7fff_ffff_ffff_ffff;
                if (b >> 52) & 0x7ff == 0x7ff {
                    b &= 0x7fee_ffff_ffff_ffff;
                }
                b | 0x3ff0_0000_0000_0000 // bias toward ~[1,2) so div/sqrt are well-defined
            };
            (n(), n(), n())
        })
        .collect()
}

fn bench_softfloat(c: &mut Criterion) {
    let v = inputs();
    c.bench_function("f64_add", |b| {
        b.iter(|| {
            v.iter().fold(0u64, |acc, &(x, y, _)| {
                acc ^ F64::add(black_box(x), black_box(y), RNE).0
            })
        })
    });
    c.bench_function("f64_mul", |b| {
        b.iter(|| {
            v.iter().fold(0u64, |acc, &(x, y, _)| {
                acc ^ F64::mul(black_box(x), black_box(y), RNE).0
            })
        })
    });
    c.bench_function("f64_div", |b| {
        b.iter(|| {
            v.iter().fold(0u64, |acc, &(x, y, _)| {
                acc ^ F64::div(black_box(x), black_box(y), RNE).0
            })
        })
    });
    c.bench_function("f64_fma", |b| {
        b.iter(|| {
            v.iter().fold(0u64, |acc, &(x, y, z)| {
                acc ^ F64::fma(black_box(x), black_box(y), black_box(z), RNE).0
            })
        })
    });
    c.bench_function("f64_sqrt", |b| {
        b.iter(|| {
            v.iter()
                .fold(0u64, |acc, &(x, _, _)| acc ^ F64::sqrt(black_box(x), RNE).0)
        })
    });
    c.bench_function("f32_sqrt", |b| {
        b.iter(|| {
            v.iter().fold(0u32, |acc, &(x, _, _)| {
                acc ^ F32::sqrt(black_box(x as u32), RNE).0
            })
        })
    });
}

criterion_group!(benches, bench_softfloat);
criterion_main!(benches);
