# Full mstatus oracle correction

The initial preflight audit stopped on x22. The prediction file required FS
Dirty and SD, which both held, but the full-register audit implementation had
omitted the independently hardwired UXL/SXL bits. `crates/core/src/csr.rs:182-188`
states and implements UXL = SXL = 2 (RV64). Thus the full mstatus value is
`0x8000000a00006000`, not `0x8000000000006000`.

The original failed checker log is retained as
`benchmark-preflight-initial-inspection.log`. Only this oracle correction was
made; the guest, worker report and runtime were not changed. This is not a
runtime refutation, and the pre-evidence FS/SD prediction is unchanged.
