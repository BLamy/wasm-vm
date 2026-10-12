//! Literal original dimensional metadata and complete live guest-memory inverses.
use super::*;

type Shape = (u32, u32, u32, u32, u32, &'static [(u32, u32, u32)]);
const SHAPES: &[Shape] = &[
    (3, 5, 3, 7, 1, &[(5, 3, 7), (2, 1, 3), (1, 1, 1)]),
    (4, 5, 5, 1, 6, &[(5, 5, 6), (2, 2, 6), (1, 1, 6)]),
    (7, 5, 3, 1, 7, &[(5, 3, 7), (2, 1, 7), (1, 1, 7)]),
];
fn metadata(shape: Shape) -> Vec<u8> {
    let (target, w, h, d, a, _) = shape;
    let mut raw = image_resource(67, 10, w, h, 2);
    for (at, value) in [(28, target), (48, d), (52, a)] {
        put32(&mut raw, at, value);
    }
    raw
}
fn attachment(entries: &[(u64, u32)]) -> Vec<u8> {
    let mut raw = id_command(0x106, 0, 3);
    put32(&mut raw, 28, entries.len() as u32);
    for &(address, bytes) in entries {
        raw.extend_from_slice(&address.to_le_bytes());
        raw.extend_from_slice(&bytes.to_le_bytes());
        raw.extend_from_slice(&[0; 4]);
    }
    raw
}
fn put_backing(q: &mut Q, entries: &[(u64, u32)], data: &[u8]) {
    let mut cursor = 0;
    for &(at, bytes) in entries {
        q.write(at, &data[cursor..cursor + bytes as usize]);
        cursor += bytes as usize;
    }
    assert_eq!(cursor, data.len());
}
fn get_backing(q: &mut Q, entries: &[(u64, u32)]) -> Vec<u8> {
    entries
        .iter()
        .flat_map(|&(at, n)| q.read(at, n as usize))
        .collect()
}
fn guards(q: &mut Q, entries: &[(u64, u32)]) {
    for &(at, n) in entries {
        assert_eq!(q.read(at - 8, 8), [0xa3; 8]);
        assert_eq!(q.read(at + u64::from(n), 8), [0xa3; 8]);
    }
}
fn layered_exchange(q: &Q, offset: u64, bytes: u32, stride: u32, rows: u32) -> Submit3dExchange {
    let mut e = q.exchange(1, offset, bytes);
    e.rows.row_stride = stride;
    e.rows.row_count = rows;
    e
}
fn layered_transfer(level: u32, box_: [u32; 6], offset: u64, stride: u32, layer: u32) -> Vec<u8> {
    let mut raw = transfer(false, offset, u64::MAX);
    for (i, v) in box_.into_iter().enumerate() {
        put32(&mut raw, 24 + i * 4, v);
    }
    for (at, v) in [(60, level), (64, stride), (68, layer)] {
        put32(&mut raw, at, v);
    }
    raw
}
#[test]
fn dimensional_original_mips_dirty_split_sg_and_full_inverse() {
    for seed in [0x37a1u32, 0x82cd, 0xe419] {
        for &shape in SHAPES {
            let mut q = Q::layered();
            q.sync(&context(), 0x1100);
            let raw = metadata(shape);
            let cost: u64 = shape
                .5
                .iter()
                .map(|&(w, h, d)| u64::from(w * h * d * 4))
                .sum();
            eprintln!(
                "NATIVE_DIMENSIONAL_PREDICTION target={} cost={cost} levels={:?}",
                shape.0, shape.5
            );
            q.sync(&raw, 0x1100);
            record_image(&mut q, "dimensional-create", &raw);
            let state = q.state.borrow().control3d_snapshot().unwrap();
            assert_eq!((state.logical_bytes, state.gpu_bytes), (cost, cost));
            let capacity = 4096;
            let entries = [
                (BACKING, 7),
                (BACKING2, 17),
                (BACKING2 + 0x2000, 53),
                (BACKING2 + 0x4000, 101),
                (BACKING2 + 0x6000, capacity - 178),
            ];
            for &(at, n) in &entries {
                q.write(at - 8, &vec![0xa3; n as usize + 16]);
            }
            q.sync(&attachment(&entries), 0x1100);
            q.sync(&id_command(0x202, 2, 3), 0x1100);
            for (level, &(w, h, d)) in shape.5.iter().enumerate() {
                let row_bytes = w * 4;
                let padded = level % 2 == 0;
                let stride = row_bytes + if padded { 7 } else { 0 };
                let layer = stride * h + if padded { 11 } else { 0 };
                let source: Vec<u8> = (0..capacity)
                    .map(|v| (v.wrapping_mul(71) ^ seed ^ (level as u32 * 43)) as u8)
                    .collect();
                // Deliberately write after attachment: its copied A3 snapshot is stale.
                put_backing(&mut q, &entries, &source);
                let expected: Vec<u8> = (0..d)
                    .flat_map(|z| (0..h).map(move |y| z * layer + y * stride + 5))
                    .flat_map(|at| {
                        source[at as usize..(at + row_bytes) as usize]
                            .iter()
                            .copied()
                    })
                    .collect();
                let up = layered_transfer(
                    level as u32,
                    [0, 0, 0, w, h, d],
                    5,
                    if padded { stride } else { 0 },
                    if padded { layer } else { 0 },
                );
                let work = q.begin(&up);
                assert_eq!(work.resources[0].metadata, state.resources[0].metadata);
                let e = layered_exchange(&q, 5, row_bytes, stride, h);
                let data = q.machine.submit3d_gather_layered(&e, layer, d).unwrap();
                assert_eq!(data, expected);
                assert_eq!(
                    q.machine.submit3d_gather_layered(&e, layer, d),
                    Err(E::InvalidParameter)
                );
                q.finish(&up, Ok(()));
                record_image(&mut q, "dimensional-upload", &up);
                let mut down = up.clone();
                put32(&mut down, 0, 0x206);
                q.begin(&down);
                let e = layered_exchange(&q, 5, row_bytes, stride, h);
                let output: Vec<_> = expected.iter().map(|b| b ^ 0x57).collect();
                q.machine
                    .submit3d_scatter_layered(&e, layer, d, &output)
                    .unwrap();
                assert_eq!(
                    q.used_idx(),
                    q.used,
                    "all scatter happens before completion"
                );
                let mut full = source.clone();
                for z in 0..d {
                    for y in 0..h {
                        let dst = (5 + z * layer + y * stride) as usize;
                        let src = ((z * h + y) * row_bytes) as usize;
                        full[dst..dst + row_bytes as usize]
                            .copy_from_slice(&output[src..src + row_bytes as usize]);
                    }
                }
                assert_eq!(
                    get_backing(&mut q, &entries),
                    full,
                    "every layer/row padding and SG byte"
                );
                guards(&mut q, &entries);
                eprintln!(
                    "NATIVE_DIMENSIONAL_DMA_POINT {{\"seed\":{seed},\"target\":{},\"level\":{level},\"extent\":[{w},{h},{d}],\"offset\":5,\"stride\":{stride},\"layerStride\":{layer},\"source\":{:?},\"gathered\":{:?},\"output\":{:?},\"fullBacking\":{:?}}}",
                    shape.0,
                    hex(&source),
                    hex(&data),
                    hex(&output),
                    hex(&full)
                );
                q.finish(&down, Ok(()));
                record_image(&mut q, "dimensional-readback", &down);
            }
            q.sync(&id_command(0x102, 0, 3), 0x1100);
            let state = q.state.borrow().control3d_snapshot().unwrap();
            assert_eq!(
                (state.logical_bytes, state.gpu_bytes, state.backing_bytes),
                (0, 0, 0)
            );
            eprintln!(
                "NATIVE_DIMENSIONAL_CHECKPOINT target={} seed={seed} machineDigest={}",
                shape.0,
                q.machine.snapshot().hex_digest()
            );
        }
    }
}
#[test]
fn dimensional_refusals_preserve_native_and_host_ownership() {
    for &shape in SHAPES {
        let mut q = Q::layered();
        let valid = metadata(shape);
        let mut changes = vec![
            (32, 66),
            (36, 0),
            (36, 1),
            (36, 16),
            (36, 0x8000000a),
            (40, 0),
            (44, 0),
            (48, 0),
            (52, 0),
            (56, 3),
            (56, 32),
            (56, u32::MAX),
            (60, 1),
            (64, 1),
        ];
        changes.extend(match shape.0 {
            3 => vec![(40, 2049), (44, 2049), (48, 2049), (52, 2)],
            4 => vec![(40, 4), (44, 4), (48, 2), (52, 5), (52, 7)],
            _ => vec![(40, 16385), (44, 16385), (48, 2), (52, 2049)],
        });
        for (at, value) in changes {
            let before = q.state.borrow().control3d_snapshot().unwrap();
            let calls = q.host.borrow().controls.len();
            let mut raw = valid.clone();
            put32(&mut raw, at, value);
            q.sync(&raw, 0x1205);
            assert_eq!(q.state.borrow().control3d_snapshot().unwrap(), before);
            assert_eq!(q.host.borrow().controls.len(), calls);
            record_image(&mut q, "dimensional-refused-metadata", &raw);
        }
        for role in [
            2, 8, 10, 262146, 262152, 262154, 1048578, 1048584, 1048586, 1310722, 1310728, 1310730,
        ] {
            let mut raw = valid.clone();
            put32(&mut raw, 36, role);
            q.sync(&raw, 0x1100);
            q.sync(&id_command(0x102, 0, 3), 0x1100);
        }
        for old_desktop in [false, true] {
            let mut old = Q::with_desktop(old_desktop);
            old.sync(&valid, 0x1205);
            assert!(old.host.borrow().controls.is_empty());
        }
        q.sync(&valid, 0x1100);
        q.sync(&context(), 0x1100);
        q.sync(&attachment(&[(BACKING, 1024)]), 0x1100);
        q.sync(&id_command(0x202, 2, 3), 0x1100);
        let (w, h, d) = shape.5[1];
        for (level, box_, offset, stride, layer) in [
            (3, [0, 0, 0, 1, 1, 1], 0, 0, 0),
            (1, [w, 0, 0, 1, 1, 1], 0, 0, 0),
            (1, [0, h, 0, 1, 1, 1], 0, 0, 0),
            (1, [0, 0, d, 1, 1, 1], 0, 0, 0),
            (1, [0, 0, 0, 0, 1, 1], 0, 0, 0),
            (1, [0, 0, 0, 1, 1, 0], 0, 0, 0),
            (1, [0, 0, 0, w, h, d], 0, w * 4 - 1, 0),
            (1, [0, 0, 0, w, h, d], 0, w * 4, w * h * 4 - 1),
            (1, [0, 0, 0, w, h, d], 1024, 0, 0),
            (1, [0, 0, 0, w, h, d], u64::MAX, 0, 0),
            (1, [0, 0, 0, w, h, d], 0, u32::MAX, 0),
        ] {
            let before = q.state.borrow().control3d_snapshot().unwrap();
            let scheduler = q.mail.inspect();
            let work = q.host.borrow().work.len();
            let raw = layered_transfer(level, box_, offset, stride, layer);
            q.sync(&raw, 0x1205);
            assert_eq!(q.state.borrow().control3d_snapshot().unwrap(), before);
            assert_eq!(q.mail.inspect(), scheduler);
            assert_eq!(q.host.borrow().work.len(), work);
            record_image(&mut q, "dimensional-refused-transfer", &raw);
        }
    }
    let mut q = Q::layered();
    let mut exact = metadata(SHAPES[0]);
    for (at, v) in [(40, 1024), (44, 512), (48, 2), (56, 0)] {
        put32(&mut exact, at, v);
    }
    for id in 1..=8 {
        put32(&mut exact, 24, id);
        q.sync(&exact, 0x1100);
    }
    assert_eq!(
        q.state.borrow().control3d_snapshot().unwrap().gpu_bytes,
        32 * 1024 * 1024
    );
    put32(&mut exact, 24, 9);
    q.sync(&exact, 0x1201);
    put32(&mut exact, 56, 1);
    q.sync(&exact, 0x1201);
    put32(&mut exact, 56, 0);
    put32(&mut exact, 40, 1025);
    q.sync(&exact, 0x1201);
}
#[test]
fn dimensional_layer_exchange_prevalidates_complete_backing_and_arguments() {
    let mut q = Q::layered();
    q.sync(&context(), 0x1100);
    q.sync(&metadata(SHAPES[0]), 0x1100);
    // Raw host exchanges must validate their final padded row before any scatter.
    let entries = [(BACKING, 23), (BACKING2, 233)];
    q.sync(&attachment(&entries), 0x1100);
    q.sync(&id_command(0x202, 2, 3), 0x1100);
    let raw = layered_transfer(0, [1, 1, 1, 2, 2, 3], 5, 11, 27);
    q.begin(&raw);
    let valid = layered_exchange(&q, 5, 8, 11, 2);
    q.write(BACKING, &[0x76; 23]);
    let before = q.machine.snapshot().hex_digest();
    let output = [0x34; 48];
    for (rows, layer, count, n) in [
        (
            Submit3dRows {
                row_bytes: 0,
                ..valid.rows
            },
            27,
            3,
            48,
        ),
        (
            Submit3dRows {
                row_count: 0,
                ..valid.rows
            },
            27,
            3,
            48,
        ),
        (
            Submit3dRows {
                row_count: 16385,
                ..valid.rows
            },
            27,
            3,
            48,
        ),
        (
            Submit3dRows {
                row_stride: 7,
                ..valid.rows
            },
            27,
            3,
            48,
        ),
        (
            Submit3dRows {
                row_stride: u32::MAX,
                ..valid.rows
            },
            u32::MAX,
            3,
            48,
        ),
        (
            Submit3dRows {
                offset: u64::MAX,
                ..valid.rows
            },
            27,
            3,
            48,
        ),
        (valid.rows, 21, 3, 48),
        (valid.rows, 27, 0, 48),
        (valid.rows, 27, 2049, 48),
        (valid.rows, 27, 3, 47),
        (
            Submit3dRows {
                offset: 220,
                ..valid.rows
            },
            27,
            3,
            48,
        ),
    ] {
        let e = Submit3dExchange { rows, ..valid };
        assert_eq!(
            q.machine
                .submit3d_scatter_layered(&e, layer, count, &output[..n]),
            Err(E::InvalidParameter)
        );
        assert_eq!(
            q.machine.snapshot().hex_digest(),
            before,
            "no earlier span is published before late validation"
        );
        assert_eq!(q.mail.inspect().last_exchange, 0);
        assert_eq!(q.used_idx(), q.used);
    }
    let data = q.machine.submit3d_gather_layered(&valid, 27, 3).unwrap();
    assert_eq!(data.len(), 48);
    q.finish(&raw, Ok(()));
    let mut old = Q::new();
    old.setup();
    let p = transfer(false, 0, 7);
    old.begin(&p);
    let e = old.exchange(1, 0, 8);
    assert_eq!(
        old.machine.submit3d_gather_layered(&e, 8, 1),
        Err(E::InvalidParameter)
    );
    assert_eq!(
        old.machine.submit3d_scatter_layered(&e, 8, 1, &[0; 8]),
        Err(E::InvalidParameter)
    );
    old.finish(&p, Err(E::InvalidParameter));
}
