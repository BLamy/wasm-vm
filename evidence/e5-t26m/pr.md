## Scope

Keep browser inline-cache entries and compiled links across changes to only
mstatus SIE/MIE/SPIE/MPIE. Preserve the live architectural status and every
other memory-authority input. No interrupt polling, translation, chain budget,
guest image, clock or scheduling changes.

This is E5-T26m, a bounded prerequisite for the still-unfinished E5-T26f desktop
restore proof. It does not claim a measured speedup or waive the two-second
deadline. No outage-only deployment and no Epic6 work.

## Proof

- All64 raw status bits checked in actual WebAssembly; exactly four preserve
  cache words. Real static/dynamic compiled-target execution and M/S pending
  interrupt precedence compared against interpreter state.
- The original full-status comparison fails the reuse test. One unsafe SUM
  mask mutation fails both the private test and real dynamic-link control.
- Fresh Daybreak mixed ignored+SUM attack passes and is promoted permanently.
- Scoped native/real-WASM gates, built Chromium demo126/0 with no console/HTTP
  errors, and the single final exact-head clean-checkout record are retained
  in `evidence/e5-t26m/` and referenced by the task Verification log.

Runtime freeze: `deb595c78aa96cbcbc674fa3cbe30a7e53dd522f`.
Final promoted-test freeze: `7f007bd28e0d8a73ed46d03c7f9bd803449157ee`.
See the task's independent verdict for final lifecycle status.
