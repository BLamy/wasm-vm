use super::*;

#[test]
fn original_stream_output_role_is_explicit_and_bounded() {
    let base = Resource3dMetadata {
        resource_id: 1,
        target: 0,
        format: 64,
        bind: 2048,
        width: 4096,
        height: 1,
        depth: 1,
        array_size: 1,
        last_level: 0,
        nr_samples: 0,
        flags: 0,
    };
    for roles in [2048, 2064, 2080, 2112, 2160] {
        let metadata = Resource3dMetadata {
            bind: roles,
            ..base
        };
        assert_eq!(metadata.sizes(true, true, true, true), Ok((4096, 4096)));
        assert_eq!(
            metadata.sizes(true, true, true, false),
            Err(Control3dError::InvalidParameter)
        );
        eprintln!("NATIVE_STREAM_OUTPUT roles={roles} logical=4096 gpu=4096 historical=refused");
    }
    for metadata in [
        Resource3dMetadata { bind: 2049, ..base },
        Resource3dMetadata { target: 2, ..base },
        Resource3dMetadata { height: 2, ..base },
        Resource3dMetadata { format: 67, ..base },
        Resource3dMetadata {
            last_level: 1,
            ..base
        },
        Resource3dMetadata { width: 0, ..base },
    ] {
        assert_eq!(
            metadata.sizes(true, true, true, true),
            Err(Control3dError::InvalidParameter)
        );
    }
    let edge = Resource3dMetadata {
        width: MAX_RESOURCE_BYTES as u32,
        ..base
    };
    assert_eq!(
        edge.sizes(true, true, true, true),
        Ok((MAX_RESOURCE_BYTES, MAX_RESOURCE_BYTES))
    );
    assert_eq!(
        Resource3dMetadata {
            width: edge.width + 1,
            ..base
        }
        .sizes(true, true, true, true),
        Err(Control3dError::OutOfMemory)
    );
}
