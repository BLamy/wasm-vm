use super::*;

fn original(target: u32, format: u32, bind: u32) -> Resource3dMetadata {
    Resource3dMetadata {
        resource_id: 100,
        target,
        format,
        bind,
        width: if target == 4 { 5 } else { 7 },
        height: 5,
        depth: 1,
        array_size: if target == 4 { 6 } else { 7 },
        last_level: 2,
        nr_samples: 0,
        flags: 0,
    }
}

#[test]
fn original_depth_fields_costs_and_npot_layers() {
    // Literal original format sizes and complete independently counted chains:
    // cube (25+4+1)*6 =180 texels; array (35+6+1)*7 =294.
    for (format, public, native, cube_bytes, cube_gpu, array_bytes, array_gpu) in [
        (16, 2, 2, 360, 360, 588, 588),
        (18, 4, 4, 720, 720, 1176, 1176),
        (20, 4, 4, 720, 720, 1176, 1176),
        (21, 4, 4, 720, 720, 1176, 1176),
        (126, 8, 16, 1440, 2880, 2352, 4704),
    ] {
        for bind in [1, 8, 9] {
            let cube = original(4, format, bind);
            let array = original(7, format, bind);
            assert_eq!(cube.sizes(true, true, true), Ok((cube_bytes, cube_gpu)));
            assert_eq!(array.sizes(true, true, true), Ok((array_bytes, array_gpu)));
            assert_eq!(cube.transfer_extent(0), Ok((5, 5, 6, public)));
            assert_eq!(cube.transfer_extent(1), Ok((2, 2, 6, public)));
            assert_eq!(cube.transfer_extent(2), Ok((1, 1, 6, public)));
            assert_eq!(array.transfer_extent(0), Ok((7, 5, 7, public)));
            assert_eq!(array.transfer_extent(1), Ok((3, 2, 7, public)));
            assert_eq!(array.transfer_extent(2), Ok((1, 1, 7, public)));
            assert_eq!(
                cube.transfer_extent(3),
                Err(Control3dError::InvalidParameter)
            );
            assert_eq!(
                array.transfer_extent(u32::MAX),
                Err(Control3dError::InvalidParameter)
            );
            for meta in [cube, array] {
                for (desktop, dimensional) in [(false, false), (true, false), (true, true)] {
                    assert_eq!(
                        meta.sizes(desktop, dimensional, false),
                        Err(Control3dError::InvalidParameter)
                    );
                }
            }
            eprintln!(
                "NATIVE_DIMENSIONAL_DEPTH format={format} bind={bind} publicPixel={public} nativePixel={native} cube={cube:?} cubeCosts=({cube_bytes},{cube_gpu}) array={array:?} arrayCosts=({array_bytes},{array_gpu})"
            );
        }
    }
}

#[test]
fn depth_native_budget_neighbors_and_illegal_original_shapes() {
    let mut meta = original(7, 126, 9);
    meta.width = 512;
    meta.height = 512;
    meta.array_size = 1;
    meta.last_level = 0;
    assert_eq!(meta.sizes(true, true, true), Ok((2_097_152, 4_194_304)));
    meta.array_size = 2;
    assert_eq!(
        meta.sizes(true, true, true),
        Err(Control3dError::OutOfMemory)
    );
    meta.array_size = 1;
    meta.width = 513;
    assert_eq!(
        meta.sizes(true, true, true),
        Err(Control3dError::OutOfMemory)
    );
    let base = original(4, 18, 9);
    for bad in [
        Resource3dMetadata {
            target: 3,
            array_size: 1,
            depth: 6,
            ..base
        },
        Resource3dMetadata { target: 6, ..base },
        Resource3dMetadata { format: 19, ..base },
        Resource3dMetadata {
            format: 67,
            bind: 1,
            ..base
        },
        Resource3dMetadata { bind: 10, ..base },
        Resource3dMetadata {
            bind: 9 | (1 << 18),
            ..base
        },
        Resource3dMetadata {
            array_size: 5,
            ..base
        },
        Resource3dMetadata { width: 6, ..base },
        Resource3dMetadata { depth: 2, ..base },
        Resource3dMetadata { width: 0, ..base },
        Resource3dMetadata { height: 0, ..base },
        Resource3dMetadata {
            width: u32::MAX,
            height: u32::MAX,
            ..base
        },
        Resource3dMetadata {
            last_level: 3,
            ..base
        },
        Resource3dMetadata {
            last_level: u32::MAX,
            ..base
        },
        Resource3dMetadata {
            nr_samples: 1,
            ..base
        },
        Resource3dMetadata { flags: 1, ..base },
        Resource3dMetadata {
            target: 7,
            array_size: 2049,
            ..base
        },
    ] {
        assert_eq!(
            bad.sizes(true, true, true),
            Err(Control3dError::InvalidParameter),
            "{bad:?}"
        );
        eprintln!("NATIVE_DIMENSIONAL_DEPTH_REFUSED metadata={bad:?}");
    }
}
