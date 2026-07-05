//! SBI IPI extension (EID 0x735049 "sPI", spec v2.0 §7): `send_ipi` sets SSIP on the
//! targeted harts. Self-IPI is legal (Linux uses it). Single-hart topology, SMP-shaped:
//! the `(hart_mask, hart_mask_base)` decode is the shared [`super::decode_hart_mask`], so
//! Epic 6 only widens the topology, not the call surface.

use super::{SbiRet, decode_hart_mask};
use crate::hart::Hart;

const FID_SEND_IPI: u64 = 0;

pub fn handle(hart: &mut Hart, fid: u64, args: &[u64; 6]) -> SbiRet {
    match fid {
        FID_SEND_IPI => match decode_hart_mask(args[0], args[1]) {
            // Bit 0 of the (validated) mask targets hart 0: raise SSIP. The guest clears
            // it via its own `sip.SSIP` write (SSIP is S-writable) — edge semantics, no
            // level sync involved.
            Ok(mask) => {
                if mask & 1 != 0 {
                    hart.csr.set_mip_bit(1, true); // SSIP
                }
                SbiRet::ok(0)
            }
            Err(e) => e,
        },
        _ => SbiRet::not_supported(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::csr::{CsrOp, MIP};
    use crate::sbi::{SBI_ERR_INVALID_PARAM, SBI_SUCCESS};

    /// Read mip through the legalized M-mode CSR path.
    fn mip(h: &mut Hart) -> u64 {
        h.csr
            .access(MIP, CsrOp::Set, 0, true, false, 0)
            .expect("M-mode mip read")
    }

    #[test]
    fn self_ipi_sets_ssip_and_masks_validate() {
        let mut h = Hart::new();
        // mask bit0, base 0 → hart 0.
        assert_eq!(handle(&mut h, 0, &[1, 0, 0, 0, 0, 0]).error, SBI_SUCCESS);
        assert_ne!(mip(&mut h) & 0x2, 0, "SSIP raised");
        // "all harts" shorthand: base == u64::MAX.
        let mut h2 = Hart::new();
        assert_eq!(
            handle(&mut h2, 0, &[0, u64::MAX, 0, 0, 0, 0]).error,
            SBI_SUCCESS
        );
        assert_ne!(mip(&mut h2) & 0x2, 0, "all-harts includes hart 0");
        // Empty mask: valid no-op.
        let mut h3 = Hart::new();
        assert_eq!(handle(&mut h3, 0, &[0, 0, 0, 0, 0, 0]).error, SBI_SUCCESS);
        assert_eq!(mip(&mut h3) & 0x2, 0);
        // Errors: base beyond topology; mask naming hart ≥ 1.
        for (mask, base) in [(1u64, 1u64), (2, 0), (0b110, 0), (1, 64)] {
            assert_eq!(
                handle(&mut h3, 0, &[mask, base, 0, 0, 0, 0]).error,
                SBI_ERR_INVALID_PARAM,
                "mask={mask:#x} base={base:#x}"
            );
        }
        // Unknown FID.
        assert_eq!(handle(&mut h3, 9, &[0; 6]), SbiRet::not_supported());
    }
}
