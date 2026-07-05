//! SBI RFENCE extension (EID 0x52464E43 "RFNC", spec v2.0 §8): remote fences. On our
//! single hart "remote" means "local": `remote_fence_i` routes through the same (currently
//! empty) hook `fence.i` uses so the Epic-4 JIT inherits correctness by construction, and
//! the sfence FIDs flush the Epic-1 TLB for the given range/ASID.

use super::{SbiRet, decode_hart_mask};
use crate::hart::Hart;

const FID_FENCE_I: u64 = 0;
const FID_SFENCE_VMA: u64 = 1;
const FID_SFENCE_VMA_ASID: u64 = 2;

/// Beyond this many 4 KiB pages, flush the whole TLB instead of iterating — over-flushing
/// is always architecturally safe, and Linux's flush_tlb_range batches are small.
const RANGE_FLUSH_CAP_PAGES: u64 = 256;

/// Range flush: `start=0, size=usize::MAX` (and any huge range) = full flush.
fn sfence_range(hart: &mut Hart, start: u64, size: u64, asid: Option<u64>) {
    let pages = size.div_ceil(4096);
    if size == u64::MAX || pages > RANGE_FLUSH_CAP_PAGES {
        hart.tlb.sfence(None, asid);
        return;
    }
    for i in 0..pages {
        hart.tlb.sfence(Some(start + i * 4096), asid);
    }
}

pub fn handle(hart: &mut Hart, fid: u64, args: &[u64; 6]) -> SbiRet {
    // Every RFENCE FID starts with the same hart-mask decode.
    let mask = match decode_hart_mask(args[0], args[1]) {
        Ok(m) => m,
        Err(e) => return e,
    };
    match fid {
        FID_FENCE_I => {
            // Interpreter: no decoded-instruction cache to invalidate YET. This is the
            // single choke point the Epic-4 JIT must hook (same contract as fence.i).
            let _ = mask;
            SbiRet::ok(0)
        }
        FID_SFENCE_VMA => {
            if mask & 1 != 0 {
                sfence_range(hart, args[2], args[3], None);
            }
            SbiRet::ok(0)
        }
        FID_SFENCE_VMA_ASID => {
            if mask & 1 != 0 {
                sfence_range(hart, args[2], args[3], Some(args[4]));
            }
            SbiRet::ok(0)
        }
        // hfence.* (FIDs 3..=6): no H extension — probe answer, never a trap.
        _ => SbiRet::not_supported(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::sbi::{SBI_ERR_INVALID_PARAM, SBI_SUCCESS};

    #[test]
    fn fences_flush_and_masks_validate() {
        let mut h = Hart::new();
        let f0 = h.tlb.flush_count();
        // fence_i: success, no TLB effect.
        assert_eq!(handle(&mut h, 0, &[1, 0, 0, 0, 0, 0]).error, SBI_SUCCESS);
        assert_eq!(h.tlb.flush_count(), f0);
        // sfence_vma full flush (size = MAX).
        assert_eq!(
            handle(&mut h, 1, &[1, 0, 0, u64::MAX, 0, 0]).error,
            SBI_SUCCESS
        );
        assert!(h.tlb.flush_count() > f0, "full flush recorded");
        // Ranged + ASID variants succeed.
        assert_eq!(
            handle(&mut h, 2, &[1, 0, 0x1000, 0x2000, 7, 0]).error,
            SBI_SUCCESS
        );
        // Empty mask: valid, no flush required (success).
        assert_eq!(
            handle(&mut h, 1, &[0, 0, 0, u64::MAX, 0, 0]).error,
            SBI_SUCCESS
        );
        // Bad masks.
        assert_eq!(
            handle(&mut h, 1, &[1, 5, 0, 0, 0, 0]).error,
            SBI_ERR_INVALID_PARAM
        );
        assert_eq!(
            handle(&mut h, 0, &[0b10, 0, 0, 0, 0, 0]).error,
            SBI_ERR_INVALID_PARAM
        );
        // hfence → NOT_SUPPORTED.
        assert_eq!(
            handle(&mut h, 4, &[1, 0, 0, 0, 0, 0]),
            SbiRet::not_supported()
        );
    }
}
