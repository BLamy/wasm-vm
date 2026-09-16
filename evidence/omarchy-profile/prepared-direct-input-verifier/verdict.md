VERDICT: verified

**Scope: verified bounded negative diagnostic. Desktop responsiveness is not
verified, and T03q remains gated.**

Frozen implementation `9cc377180921be98f904c3689a1d7c48b9df3947`; submission
`ddb675b2`. Raw report SHA256
`0d4f8f50d2d9e940ce098f744202bcff49ae3c1048b39d692231d1d2c7fa38ea`.
References below to report lines use
`evidence/omarchy-profile/prepared-direct-input-r1/desktop/report.json`.

- **P1–P3 HELD — correct experiment and identity.** Exact AJ compressed pair,
  original R3 kernel/chunk base, and AL runtime match independent fixed pins.
  The real pair routes were served and the guest reports restored at line
  28511. Frozen 26-file dependency closure, actual 30 helper receipts, 96 served
  resources, and all 16 worker-sealed files match. One actual read-only batch
  at 07:12:33.144Z returns the eight required values and exact active Foot at
  07:12:40.434Z; no property write occurs. See `prerequisites.json`,
  `source-audit.json`, `run-audit.json`, report lines 28392 and 28522.
- **P4–P5 HELD — fixed deadlines and physical path.** Startup took 39,406 ms;
  typing took 2,700 ms. All 128 trusted focused-canvas events exactly spell
  the nonce command, with ordered keyboard/sync calls and unique positive
  acknowledgments. No agent or serial nonce write exists. Enter at
  07:12:43.215Z fixes the deadline at 07:14:43.215Z; the input fence acknowledges
  at 07:12:43.216Z. See raw keyboard/fence at lines 28642–28666 and the
  independently reconstructed `run-audit.json` serial/key checks.
- **P6 FAILED as a response hypothesis — honest negative confirmed.** All 32
  independent raw reads return exit 75 with no nonce; none remains pending.
  Failure is recorded at 07:14:43.217Z, two milliseconds after the unchanged
  deadline (report lines 28653–28656). The exact nonce never appears in an
  accepted guest reply. Demand: keep this failed control and replan; it cannot
  admit a desktop or release claim.
- **P7 FAILED as a visible-response hypothesis.** Frames/presents advance
  2→3, but I personally opened `desktop.png`, `prepared-direct.png`, and
  `failure.png`: each shows only the original empty Foot prompt, with no
  typed command or returned command prompt. All three are the same 1280×800
  PNG bytes, SHA256
  `97fc180d4d35c68ca5941dc591afb315220550165469f3c4ead7827989cc2f3f`.
  Failure capture is 07:14:43.257Z (report line 1625). Demand: do not count the
  extra frame as visible input acceptance.
- **P8–P9 HELD — honest result, cleanup, sufficiency.** Child exits 1;
  parent audits the negative result without claiming acceptance. Owned client
  cleanup takes 173 ms and completes without a watchdog. Changed paths are
  covered as detailed in `coverage.md`. The 73 frozen worker tests/two syntax
  checks and 14 verifier pure tests pass. Eight synthetic actual-wrapper
  scenarios cover its failure and nonacceptance branches.
- **Bounded attack HELD.** Seven false-success variants reject on both
  attempts: old pair, mixed delta, absent trusted prepared opt-in, missing
  nonce wire, unrelated RPC nonce, forged complete property receipt over
  partial wire, and late property wire. Two controls hold. Synthetic machine
  acceptance still explicitly requires personal image inspection.
  See `attack.json:17` and `attack.json:45–169`.

Carried evidence: AJ coherent full-RAM/delta export, AL runtime/cold-clone/
deployment, and unchanged AI input/fence proofs match their existing seals;
189 prerequisite evidence entries were rehashed. No broad regression, new
guest, browser, runtime change, push, deployment, or merge was performed.

The failed trial retires 3,109,374,721 instructions, 1,872,851,136 via JIT
(60.2324%); its full 65,536-entry tracking map drops an additional 42,606,858
counts. These observations may motivate the separately planned existing-option
trial, but establish no cause or speedup. Keep the positive desktop gate closed.
