use super::*;
#[test]
fn original_padded_layers_split_at_exact_sg_boundaries() {
    let entries = [
        BackingEntry {
            addr: 1000,
            length: 7,
        },
        BackingEntry {
            addr: 2000,
            length: 17,
        },
        BackingEntry {
            addr: 3000,
            length: 53,
        },
        BackingEntry {
            addr: 4000,
            length: 179,
        },
    ];
    let rows = Submit3dRows {
        offset: 5,
        row_bytes: 8,
        row_stride: 11,
        row_count: 2,
    };
    let (spans, bytes) = layered_row_spans(rows, 27, 3, &entries).unwrap();
    assert_eq!(bytes, 48);
    assert_eq!(
        spans,
        [
            (1005, 2),
            (2000, 6),
            (2009, 8),
            (3008, 8),
            (3019, 8),
            (3035, 8),
            (3046, 7),
            (4000, 1)
        ]
    );
    eprintln!(
        "NATIVE_DIMENSIONAL_SPANS rows={rows:?} layerStride=27 layers=3 entries={entries:?} spans={spans:?} bytes={bytes}"
    );
    let mut wrap = entries;
    wrap[2].addr = u64::MAX;
    assert_eq!(
        layered_row_spans(rows, 27, 3, &wrap),
        Err(Control3dError::InvalidParameter)
    );
    let excessive = Submit3dRows {
        offset: 0,
        row_bytes: 4_194_305,
        row_stride: 4_194_305,
        row_count: 1,
    };
    assert_eq!(
        layered_row_spans(excessive, 4_194_305, 1, &entries),
        Err(Control3dError::InvalidParameter)
    );
}

// Inject one real host allocation refusal without changing product semantics.
// The flag is thread-local, so concurrent unrelated tests retain System allocation.
std::thread_local! { static REFUSE_NEXT: std::cell::Cell<bool> = const { std::cell::Cell::new(false) }; }
struct FaultAllocator;
#[global_allocator]
static ALLOCATOR: FaultAllocator = FaultAllocator;
unsafe impl std::alloc::GlobalAlloc for FaultAllocator {
    unsafe fn alloc(&self, layout: std::alloc::Layout) -> *mut u8 {
        if REFUSE_NEXT
            .try_with(|flag| flag.replace(false))
            .unwrap_or(false)
        {
            return core::ptr::null_mut();
        }
        unsafe { std::alloc::System.alloc(layout) }
    }
    unsafe fn dealloc(&self, ptr: *mut u8, layout: std::alloc::Layout) {
        unsafe { std::alloc::System.dealloc(ptr, layout) }
    }
}
#[test]
fn dimensional_span_allocation_refusal_is_structured_without_partial_output() {
    let rows = Submit3dRows {
        offset: 5,
        row_bytes: 8,
        row_stride: 11,
        row_count: 2,
    };
    let entries = [BackingEntry {
        addr: 1000,
        length: 256,
    }];
    REFUSE_NEXT.with(|flag| flag.set(true));
    let result = layered_row_spans(rows, 27, 3, &entries);
    assert_eq!(result, Err(Control3dError::OutOfMemory));
    assert!(!REFUSE_NEXT.with(|flag| flag.get()));
    eprintln!(
        "NATIVE_DIMENSIONAL_SPANS_ALLOCATION_REFUSED rows={rows:?} layerStride=27 layers=3 result={result:?} publishedSpans=0"
    );
}

#[test]
fn original_npot_mip_span_records_match_independent_byte_addresses() {
    let entries = [
        BackingEntry {
            addr: 0x80020000,
            length: 7,
        },
        BackingEntry {
            addr: 0x80030000,
            length: 17,
        },
        BackingEntry {
            addr: 0x80032000,
            length: 53,
        },
        BackingEntry {
            addr: 0x80034000,
            length: 101,
        },
        BackingEntry {
            addr: 0x80036000,
            length: 3918,
        },
    ];
    for (target, level, w, h, d) in [
        (3, 0, 5, 3, 7),
        (3, 1, 2, 1, 3),
        (3, 2, 1, 1, 1),
        (4, 0, 5, 5, 6),
        (4, 1, 2, 2, 6),
        (4, 2, 1, 1, 6),
        (7, 0, 5, 3, 7),
        (7, 1, 2, 1, 7),
        (7, 2, 1, 1, 7),
    ] {
        let stride = w * 4 + if level % 2 == 0 { 7 } else { 0 };
        let layer = stride * h + if level % 2 == 0 { 11 } else { 0 };
        let rows = Submit3dRows {
            offset: 5,
            row_bytes: w * 4,
            row_stride: stride,
            row_count: h,
        };
        let (spans, bytes) = layered_row_spans(rows, layer, d, &entries).unwrap();
        let expected: Vec<u64> = (0..d)
            .flat_map(|z| {
                (0..h).flat_map(move |y| (0..w * 4).map(move |x| 5 + z * layer + y * stride + x))
            })
            .map(|n| match n {
                0..=6 => 0x80020000 + u64::from(n),
                7..=23 => 0x80030000 + u64::from(n - 7),
                24..=76 => 0x80032000 + u64::from(n - 24),
                77..=177 => 0x80034000 + u64::from(n - 77),
                _ => 0x80036000 + u64::from(n - 178),
            })
            .collect();
        let actual: Vec<_> = spans
            .iter()
            .flat_map(|&(address, n)| address..address + n as u64)
            .collect();
        assert_eq!(actual, expected);
        assert_eq!(bytes, expected.len());
        eprintln!(
            "NATIVE_DIMENSIONAL_MIP_SPANS target={target} level={level} rows={rows:?} layerStride={layer} layers={d} entries={entries:?} spans={spans:?} bytes={bytes}"
        );
    }
}
