//! Native queue/allocation/span proof only. Browser tests supply actual GPU work.
use super::*;

fn metadata(target: u32, format: u32, bind: u32) -> Vec<u8> {
    let mut raw = image_resource(format, bind, 5, if target == 4 { 5 } else { 3 }, 2);
    put32(&mut raw, 28, target);
    put32(&mut raw, 52, if target == 4 { 6 } else { 7 });
    raw
}

#[test]
fn dimensional_depth_original_machine_costs_and_live_sg_inverses() {
    for seed in [0x37a1u32, 0x82cd, 0xe419] {
        for (fmt, public, native) in [(16, 2, 2), (18, 4, 4), (20, 4, 4), (21, 4, 4), (126, 8, 16)]
        {
            for target in [4, 7] {
                let mut q = Q::dimensional_depth();
                q.sync(&context(), 0x1100);
                let raw = metadata(target, fmt, [1, 8, 9][(seed % 3) as usize]);
                q.sync(&raw, 0x1100);
                let pixels = if target == 4 { 180 } else { 126 };
                let state = q.state.borrow().control3d_snapshot().unwrap();
                assert_eq!(
                    (state.logical_bytes, state.gpu_bytes),
                    (pixels * public, pixels * native)
                );
                record_image(&mut q, "depth-create", &raw);
                let entries = [
                    (BACKING, 7u32),
                    (BACKING2, 17),
                    (BACKING2 + 0x2000, 53),
                    (BACKING2 + 0x4000, 101),
                    (BACKING2 + 0x6000, 3918),
                ];
                let mut attached = id_command(0x106, 0, 3);
                put32(&mut attached, 28, 5);
                for &(at, n) in &entries {
                    q.write(at - 8, &vec![0xa3; n as usize + 16]);
                    attached.extend_from_slice(&at.to_le_bytes());
                    attached.extend_from_slice(&n.to_le_bytes());
                    attached.extend_from_slice(&[0; 4]);
                }
                q.sync(&attached, 0x1100);
                q.sync(&id_command(0x202, 2, 3), 0x1100);
                let levels = if target == 4 {
                    [(5, 5, 6), (2, 2, 6), (1, 1, 6)]
                } else {
                    [(5, 3, 7), (2, 1, 7), (1, 1, 7)]
                };
                for (level, (w, h, d)) in levels.into_iter().enumerate() {
                    let bytes = w * public as u32;
                    let stride = bytes + 7;
                    let layer = stride * h + 11;
                    let source: Vec<u8> = (0..4096u32)
                        .map(|v| (v.wrapping_mul(71) ^ seed ^ (level as u32 * 43)) as u8)
                        .collect();
                    let mut cursor = 0;
                    for &(at, n) in &entries {
                        q.write(at, &source[cursor..cursor + n as usize]);
                        cursor += n as usize;
                    }
                    let expected: Vec<u8> = (0..d)
                        .flat_map(|z| (0..h).map(move |y| 5 + z * layer + y * stride))
                        .flat_map(|at| source[at as usize..(at + bytes) as usize].iter().copied())
                        .collect();
                    let mut up = transfer(false, 5, u64::MAX);
                    for (at, value) in [
                        (36, w),
                        (40, h),
                        (44, d),
                        (60, level as u32),
                        (64, stride),
                        (68, layer),
                    ] {
                        put32(&mut up, at, value);
                    }
                    let work = q.begin(&up);
                    assert_eq!(work.resources[0].metadata, state.resources[0].metadata);
                    let mut exchange = q.exchange(1, 5, bytes);
                    exchange.rows.row_stride = stride;
                    exchange.rows.row_count = h;
                    assert_eq!(
                        q.machine
                            .submit3d_gather_layered(&exchange, layer, d)
                            .unwrap(),
                        expected
                    );
                    assert_eq!(
                        q.machine.submit3d_gather_layered(&exchange, layer, d),
                        Err(E::InvalidParameter)
                    );
                    q.finish(&up, Ok(()));
                    let mut down = up.clone();
                    put32(&mut down, 0, 0x206);
                    q.begin(&down);
                    let mut exchange = q.exchange(1, 5, bytes);
                    exchange.rows.row_stride = stride;
                    exchange.rows.row_count = h;
                    let output: Vec<_> = expected.iter().map(|b| b ^ 0x57).collect();
                    q.machine
                        .submit3d_scatter_layered(&exchange, layer, d, &output)
                        .unwrap();
                    assert_eq!(q.used_idx(), q.used, "scatter precedes used publication");
                    let mut wanted = source.clone();
                    for z in 0..d {
                        for y in 0..h {
                            let src = ((z * h + y) * bytes) as usize;
                            let dst = (5 + z * layer + y * stride) as usize;
                            wanted[dst..dst + bytes as usize]
                                .copy_from_slice(&output[src..src + bytes as usize]);
                        }
                    }
                    let observed: Vec<_> = entries
                        .iter()
                        .flat_map(|&(at, n)| q.read(at, n as usize))
                        .collect();
                    assert_eq!(observed, wanted, "all original SG bytes and padding");
                    for &(at, n) in &entries {
                        assert_eq!(q.read(at - 8, 8), [0xa3; 8]);
                        assert_eq!(q.read(at + u64::from(n), 8), [0xa3; 8]);
                    }
                    q.finish(&down, Ok(()));
                    record_image(&mut q, "depth-inverse", &down);
                    eprintln!(
                        "NATIVE_DIMENSIONAL_DEPTH_EXCHANGE seed={seed} target={target} format={fmt} level={level} publicPixel={public} nativePixel={native} upload={} source={} expected={} output={} full={}",
                        hex(&up),
                        hex(&source),
                        hex(&expected),
                        hex(&output),
                        hex(&observed)
                    );
                }
                q.sync(&id_command(0x102, 0, 3), 0x1100);
                assert_eq!(q.state.borrow().control3d_snapshot().unwrap().gpu_bytes, 0);
            }
        }
    }
}

#[test]
fn historical_machine_profiles_refuse_original_depth_layers() {
    for (desktop, dimensional) in [(false, false), (true, false), (true, true)] {
        let mut q = Q::with_profile(desktop, dimensional);
        for target in [4, 7] {
            for fmt in [16, 18, 20, 21, 126] {
                let before = q.state.borrow().control3d_snapshot().unwrap();
                let callbacks = q.host.borrow().controls.len();
                let raw = metadata(target, fmt, 9);
                q.sync(&raw, 0x1205);
                assert_eq!(q.state.borrow().control3d_snapshot().unwrap(), before);
                assert_eq!(q.host.borrow().controls.len(), callbacks);
                record_image(&mut q, "historical-depth-refusal", &raw);
            }
        }
    }
}
