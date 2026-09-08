# E5-T26i fresh critic — final adversarial report

VERDICT: verified

Prepared against runtime source `99b8e692fddb7b1e82e4175e152ef5682c6b9373`
and final bundle head `faddd274c934e09aec18161758c690a3b87bde8e`.
Worker `implemented` commit `ac63068fbafdd69744ceec3001d044a228ed5ec3`
is the lifecycle handoff for this verdict. The verdict is only for the opt-in
monotonic-clock boundary: it does not make
wall time the default, claim a speedup, waive F's two-second limit, or verify F.

## Result

- **P1 default and atomic selection — HELD.** Omitted and explicit `icount` retain the
  deterministic source; exact `wall` is the only alternate label. Invalid labels,
  invalid realm values, and failed source setup are rejected before machine mutation.
  The native/WASM/browser fixture set passed in `submission/runtime.log` and
  `submission/wasm.log` (SHA-256 `49c8c420a40359d06b6a955793d78c72a9e1ca8d291fc8fa014c1856ed7c7a09`
  and `a219b2a51b9668c43a4f6ba4c08ab7fbc0570bfe96d8f19b6ed8ec5500d0ed3d`).
- **P2 real realm-monotonic source — HELD.** Static inspection found the adapter binds
  the current realm's receiver-correct `performance.now()` and converts monotonic
  milliseconds to nanoseconds; no changed path uses `Date.now`, RTC epoch state, or
  profiler time. Direct and worker guest UART results independently follow that source.
- **P3 busy `rdtime` and ICount control — HELD.** The no-WFI UART fixture records actual
  guest bytes. Direct wall measured `724.990 ms` guest over `724.430 ms` host and worker
  wall `648.285 ms` over `646.490 ms`; the ICount controls were exactly retirement/10.
  Citation: `worker/guest-rdtime.json`, SHA-256
  `e33a52f024c9031f82e3995175f973ed217655f519ea836f8bfbe3c32ecd059e`,
  the four `results[]` elements selected by `(backend, mode)` =
  `(direct, icount)`, `(direct, wall)`, `(worker, icount)`, and `(worker, wall)`.
- **P4 backward jitter — HELD.** Deterministic core and WASM fixtures pin the high-water
  clamp and exact subsequent 10 MHz increment; the critic's independent repeated-rebase
  attack also passed. Citation: `attack-results.md` and
  `novel-repeated-rebase.rs` (SHA-256
  `208d8ad5a715b34a1b83f05c11dd1ffdf02b69333e77137ea35c83b71bb16e77`).
- **P5 pause/resume — HELD.** Direct and worker records preserve the complete state over
  an explicit 500 ms pause and exclude that interval after resume. The pristine rerun
  independently observed exact pauses and resumed wall deltas of `0.0499 ms` direct and
  `39.205 ms` worker. Citation: `pristine-worker-summary.json`, SHA-256
  `3d189afe4a75f5db316109989ecb5ebaad01af9cdda7bd76e00ec35c4e276b38`.
- **P6 ordinary background gap — HELD.** The existing E4-T24 slew/jump policy is
  unchanged; the focused native clock tests cover the ten-minute unpaused gap and jump
  notification while the new rebase tests prove that explicit lifecycle rebases clear
  stale notification without changing guest `mtime`.
- **P7 successful restore — HELD.** Fresh- and same-machine tests preserve restored
  `mtime`/deadline and re-anchor at the new host epoch. The authenticated desktop pair
  restores one identical snapshot, executes without reboot, and reports post-restore
  machine-clock deltas in both modes.
- **P8 rejected restore atomicity — HELD.** Focused tests corrupt CPU, RAM, CLINT, and
  CLOCK inputs and cover WASM refusal; all reject before the post-commit rebase and retain
  the prior clock state/snapshot. The runtime gate records all five new guest-clock tests
  plus the carried CPU/desktop restore suites.
- **P9 portable wire and deterministic oracle — HELD.** Snapshot bytes do not include a
  host timestamp; save does not sample the host clock. Repeated ICount selection and
  restore preserve sub-tick phase and deterministic output. The exact rebuilt WASM digest
  is `30c8f2ab3b1f3c25db77c03d6161d39e55de7ea3d88447f83f5d7942952c3a28`.
- **P10 worker/WASM ownership — HELD.** Page option, worker boot data, loader validation,
  WASM selection, and live state RPC are covered by the 95 JS checks and the direct/worker
  Chromium UART record. `mtime` is returned from the machine as a decimal string; the
  fixture compares guest-emitted `rdtime`, not a requested or cached mode label.
- **P11 conservative JIT and unchanged F boundary — HELD.** Diff inspection found no
  change to residency, tiering, quantum, slew rules, snapshot format, or F's command and
  deadline. Wall mode continues to refuse direct chaining. The desktop comparison is
  unprofiled and uses the unchanged authenticated image, checkpoint, `sh /tmp/a`, input,
  PCM, marker, and two-second assertion.
- **P12 paired desktop sufficiency — HELD.** `browser/comparison.json` authenticates one
  head, runtime, profile, image, and snapshot for both runs (SHA-256
  `0a6d1662c67cd32b5c9fe5f128090a6cfd85b04dc827d1c2b6512279ee476306`).
  ICount advanced `574.7393 ms` while observed over host `4749.320..4808.775 ms`;
  wall advanced `7283.315 ms` over host `7231.100..7309.935 ms`. Both runs restored
  without boot, accepted 20 real keyboard events, produced a terminal marker and 2,850
  changed pixels, completed the shell command to a prompt, and delivered 1,440 attached,
  non-silent PCM frames (`maxAbs = 0.082000732421875`). Their only recorded error is the
  unchanged F assertion `post-restore interaction exceeded 2 seconds`; durations were
  `5028.065 ms` and `7518.450 ms`, so no F timing claim is made.
- **P13 bounded novel attack — HELD.** At a restored `mtime` above JavaScript's exact
  integer range, repeated rebases, an unchanged sample, backward jitter, two +1 ms steps,
  a future deadline, and handoff to ICount all retained their predicted state. The exact
  isolated test passed 1/1; see `attack-results.md`.
- **P14 sabotage — HELD.** Freezing the injected source at zero made the unchanged busy
  `rdtime` test fail immediately (`actual 0`, expected `1,000,000`, exit 101). This proves
  that the regression observes injected host progression rather than a self-derived
  retirement oracle.

## Evidence identity and browser inspection

- Checkpoint JSON SHA-256:
  `04dd944c53926d0b39e16e7366c6dc3f64ce5c92876bcbcf163325bcecbb1c55`.
  It binds snapshot
  `4ebdd9f6edb253d940a93082118068c089c844f985b13e0a7593956d6ccf88fb`,
  runtime `84ef07f7f4ec173dc921a1d91a764f538953600fdccfb3af0eed4aaca57617f9`,
  and profile `778bc49dcdc7551de0b2f6a23e4b32a30ce72dea2c00e425bfdc302820d8fc65`.
- Canonical ICount/wall JSON SHA-256 values:
  `c94e928713c1256dc1e9a71489b23c3e916753dbed1bae9f34dfffddcf5f16f9`
  and `b0e74cf5bc89e3f51235fa2438aefa0d08d427f91cde97826dded60fdf51b81f`.
- Both canonical PNGs are byte-identical, SHA-256
  `cb856b9735c5cf59cee1fb4ba2afc23bf9d4b84d4851bfb8f6f868e8f23ac7c8`.
  Visual inspection shows the real desktop, two terminal windows, `sh /tmp/a`, ALSA
  playback text, the green completion marker, returned prompt, and visible cursor.
- Checkpoint/ICount/wall run-log SHA-256 values are respectively
  `e8401efefb2d7da0b977fbd123320d28f9f1667664c8235b304d310cd9f5f3cd`,
  `76200c938b73a7b12957aaaa0eea640fcdf4fd90d1616bb8401b508e3c8ad4f6`, and
  `dd7a9121f5e28c38d6d384c561ea2d18c951d9e350113af9a3001b561027d8da`.
  Neither restored log contains a reboot, browser/HTTP error, PREPARE error, or XRUN;
  both fail only after the real interaction and PCM checks on F's retained deadline.

## Changed-hunk coverage dispositions

| Changed boundary | Disposition |
| --- | --- |
| `crates/core/src/time.rs`, `crates/core/src/lib.rs` | **Executed.** Focused fresh/same-machine restore, invalid-section atomicity, deadline, ICount, gap, jitter, and independent nonzero repeated-rebase tests cover all new state transitions. |
| `crates/core/tests/guest_clock.rs` | **Executed and retained.** Five focused tests pass in native and shared WASM form; sabotage kills the busy-rate test. |
| `crates/wasm/src/lib.rs`, `crates/wasm/tests/guest_clock.rs` | **Executed.** Native wrapper and eight node-WASM fixtures cover mode selection, state, restore refusal/commit, and realm clock errors; real Chromium executes the same exported route. |
| `web/guest-clock.js` | **Executed.** Unit tests cover exact labels, realm validation, receiver binding, state projection, and errors; direct and worker browser fixtures cover live use. |
| `web/loader.js`, `web/linux-worker-protocol.js` | **Executed.** Direct and whole-worker UART fixtures plus paired desktop runs carry the option through loader, worker boot, WASM, and live state RPC. |
| `web/tests/e5-t26i-guest-clock.test.mjs`, `web/tests/e4-t32-worker-protocol.test.mjs` | **Executed and retained.** Included in the recorded 95/95 JS checks and pristine rerun. |
| `web/desktop-terminal.js` query selection | **Executed.** The paired authenticated desktop runs use `guestClock=icount` and `guestClock=wall` and query live controller state before/after interaction. |
| `web/desktop-terminal.js` `guestClock` public closure | **Waived thin projection.** Page construction executes the added member; its body is a nullable one-line forwarding alias over `controller.guestClockState`, whose semantic RPC/error behavior is directly exercised. It introduces no independent state or branch required by acceptance. |
| `tools/verify/e5-t26f-browser-roundtrip{,.test}.mjs` | **Executed.** Unit guards cover diagnostic flag/default isolation; both authenticated desktop modes execute before/after state capture while preserving the original F assertion. |
| `tools/verify/e5-t26i-clock-worker.mjs` | **Executed twice.** Worker submission and pristine-clone rebuild both pass direct/worker busy UART, pause, live-state, rate, digest, and error checks. |
| `tools/verify/e5-t26i-browser-clock.mjs` | **Executed.** One checkpoint and the paired authenticated restore runs produced `browser/comparison.json`; mismatched binding and missing interaction/PCM paths are hard failures. |
| `Makefile` | **Executed.** Runtime, WASM, JS, build, worker, demo, and authenticated comparison legs have recorded successful invocations; no untested runtime branch is encoded in the recipe. |
| `web/roadmap.js` | **Executed declarative metadata.** Built demo reached 126/0 with zero errors and visibly reported E5-T26i as in progress; JSON/PNG SHA-256 values are `47036998a0d7577fc54455ca8f326134cd9528fd23b2a165e120327b845ae489` / `7ee1ac7b4ddf3ea4f723d7bf0aee03d16d86f15f454a9cdd55c582ffe433bcd8`. |

No changed behavior is left uncovered. Existing E4-T24 slew policy, E5-T26h whole-machine
resume/session fence, and E5-T19a sound lifecycle results remain **HELD** because their
code and dependency boundaries are unchanged.

## Pristine-clone and generated-manifest scope

The one prescribed `--no-local` detached clone at `faddd274` began clean. With
`RUST_LOG`, `RUSTFLAGS`, `RUSTDOCFLAGS`, `CARGO_TARGET_DIR`, and
`CARGO_BUILD_TARGET` scrubbed, the runtime gate, eight node-WASM fixtures, `make web-dist`,
and the rebuilt direct/worker Chromium fixture passed; rebuilt WASM was byte-identical.
Citation: `pristine-clone.md` and `pristine-clone-gates.log` (SHA-256
`31a35e9bac225fa0edafb5a7c50c39ba4caf262a9abe92a2e4a2724203c16401` and
`ed758bd337991996833422aeaebf49945506213a7c8bb81fc2ea52b397a7c65c`).

`web/dist/artifacts.json` and `web/dist/artifacts-node-alpine.json` are an explicit
NO-FIRE scope exception: they were pre-existing user-owned differences, are byte-unchanged
across `65e99f2e..faddd274`, were restored after the build, and were excluded in the worker
README before critic inspection. Neither clock fixture reads them. Their post-build diff
digest and exact regenerated/restored file hashes remain recorded in `pristine-clone.md`;
they are not part of T26i's release-cleanliness claim and create no remediation demand.

## Suite disposition

- Retain the five core/shared-WASM clock fixtures, three WASM wrapper fixtures, JS adapter
  and worker-protocol tests, direct/worker UART runner, and authenticated comparison target.
- Retain `novel-repeated-rebase.rs` as critic evidence only: its nonzero/wrapped-value
  combination is useful, but its individual assertions already compose retained production
  regressions, so no duplicate source test is promoted.
- Discard the sabotage clone after recording; it proves test sensitivity and is intentionally
  invalid implementation code.

No runtime fix or additional evidence is required for E5-T26i. Worker commit
`ac63068fbafdd69744ceec3001d044a228ed5ec3` supplied the separate implemented claim;
the fresh verifier may now promote the task to `verified`.
