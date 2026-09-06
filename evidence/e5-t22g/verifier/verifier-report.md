# E5-T22g independent verifier report — 2026-09-06

## Scope and identity

- Reviewed exact submitted PR head `20cd787dddbd83cc7d8f2fca64663229fb71e45e`
  against task parent `21f97264e531537cfb5ae40ced7f4de63454eb7c`.
- Runtime implementation is frozen at
  `9c7861d23bec091fa37f8da23cce830154dd1a83`; `20cd787d` adds immutable evidence
  and the implemented submission log, without changing runtime code.
- Claimed hashes recomputed exactly:
  - `cold-clone-final.log`: `a4bf554d6b90113aa59dfc4dc89f338d8e6e3af14150afde5e5ed1b2ec26b3b2`
  - browser results: `f435ae02b64b1e4df87df84a4fc35a1b9ddbcb66fe09450018794752355ddb64`
  - desktop results: `0dcae8efd09f40bbc5e29a058ffdac6cd9f4020f3ffbf1826af82e74b9a5eb8d`
  - demo results: `4d79c86ecd6a41a664a91e670ca2d39bb2607efdba4e7d20337f613ea69ddbe4`
  - v7 image: `811267cbf96c1e055e31063829580432d5e5e343cff1a975f5fc10664cc2e00e`
  - v7 chunk manifest: `935a9fe2bf6022b01ac6147665b9ca59736930b6e265e33069318e4d9cc2ccaa`
  - rebuilt and committed Wasm: `81584279aef8c6719c045b9d979bf532949b8e97c661732ee713112986b2ccab`
- The retained cold clone is still detached at exact head `9c7861d2`; both
  `git diff --exit-code` and `git diff --cached --exit-code` are empty. Its reflog
  records the checkout from `655abd86` to `9c7861d2` before the run, and its
  untracked browser/desktop/demo result hashes exactly equal the committed evidence.
  Fresh verifier reruns did not create a tracked or staged change.

## Preregistered predictions

- **P1 HELD — exact identity.** All worker hashes matched. The retained clone and
  compiled paths in `cold-clone-final.log:71,126,138,195,538,557-588,719-740`
  identify the retained cold checkout; its final artifacts match the committed bytes.
- **P2 HELD — default-off compiled Worker execution.** Chromium records a dedicated
  Worker and 400,000 retirements at `cold/browser/results.json:15-18`; its off phase
  has 3,175 host entries, 6,350 copy calls, 77,736 bytes, zero reads, and zero ns at
  `:19-47`. Firefox independently records the same at `:433-464`.
- **P3 HELD — profiling-on control.** Enabled-after-executor adds 19,056 reads and
  positive state-copy/engine time in Chromium at `:49-77` and Firefox at `:467-495`.
- **P4 HELD — both orderings.** Profiling-before-executor adds 19,050 reads in
  Chromium at `:329-357` and Firefox at `:747-775`; executor-before-profiling is P3.
- **P5 HELD — disable/re-enable.** Chromium's disabled boundary keeps reads fixed at
  19,056 (`:79-107`) and re-enable advances them to 38,112 (`:109-137`); Firefox does
  the same at `:497-555`. The verifier zero-time attack independently repeats a second
  off/on boundary at `verifier/zero-time-results.json:30-48,77-95`.
- **P6 HELD — replacement.** Enabled replacement starts with a fresh zero ledger and
  adds 19,056 reads in Chromium at `:359-387` and Firefox at `:777-805`; the verifier
  attack replaces an already-installed executor while off and observes 3,176 compiled
  host entries with zero reads in both engines at
  `verifier/zero-time-results.json:10-18,57-65`.
- **P7 HELD — fixed-work parity.** Toggled and always-off controls each retire
  1,600,000 with identical register arrays and RAM digest in Chromium at
  `cold/browser/results.json:139-327` and Firefox at `:557-745`; both controls execute
  12,703 compiled host entries, while the off control has zero reads.
- **P8 HELD — diagnostic isolation.** The task-scoped runtime diff changes only
  `JitEntryCostStats`, executor profiling propagation, browser entry-clock calls, and
  JS stats/control exposure. Repository search finds `set_entry_timing` only at
  `crates/core/src/jit.rs:714`, `crates/core/src/lib.rs:956,1852`, and
  `crates/wasm/src/jit_browser.rs:2186`. No scheduler, guest `mtime`, RTC, audio,
  retirement, device-clock, cache, translation, chaining, or persistence code is
  conditioned on the new bit. The device-heavy desktop run independently records
  120,820,545 host entries and 249,952 device boundaries but zero timer reads and ns at
  `cold/desktop/runtime-stats.json:80-92`.
- **P9 HELD — sabotage.** Immutable and fresh Chromium/Firefox runs both reject the
  forced default-on control at the intended `default-off: timing unexpectedly enabled`
  assertion (`cold/browser/results.json:13,431` and
  `verifier/fresh-browser/results.json:13,431`), not via setup or timeout failure.
- **P10 HELD — demo and desktop/T22c boundary.** Demo evidence reports 126/126 and
  no recorded errors at `cold/demo/demo-suite.json:4-11` (the displayed favicon 404 is
  the repository-policy exception). Desktop evidence identifies exact head and both
  profilers off at `cold/desktop/results.json:3-6`; all seven final mode records have
  matching guest observation, EDID, GPU mode, scanout, canvas and stable pixel digest.
  Timings are `1878.895`, `1501.980`, `2128.855`, `5267.670`, `2746.015`, `1774.195`,
  and `2221.270` ms at `:334-342,995-1003,1668-1676,2353-2361,3050-3058,3759-3767,
  4480-4488`. The explicit >2 s gaps remain at `:5738-5747`; E5-T22c remains blocked.
- **P11 HELD — clean exact-head cold proof.** The transcript is the complete
  acceptance-command output (`cold-clone-final.log:1-800`). Although provenance is not
  echoed inside that output stream, the retained clone, its reflog, empty tracked/staged
  diffs, exact artifact matches, and a fresh `env -i` browser/test rerun bind the run to
  `9c7861d2` without relying on the submitter's summary.
- **P12 HELD — independence and coverage.** No relevant `#[ignore]`, `cfg(test)`
  semantic fork, or golden value derived from the implementation was added. Fixed
  retirement is asserted independently. State parity compares independently constructed
  machines; the timer-read counter is checked separately from ns; sabotage changes
  production profiling state and dies at the off invariant.
- **P13 HELD — zero-valued clock.** A verifier-only dedicated-Worker attack overrides
  `performance.now()` to zero. Both Chromium and Firefox record exactly zero ns but
  19,056 reads when enabled, zero reads when disabled, and another 19,056 reads after
  re-enable (`verifier/zero-time-results.json:5-48,52-95`).

## Hunk-by-hunk coverage classification

- `crates/core/src/jit.rs:521-526` and `:711-714` — **executed/proven** through the
  browser ledger and lifecycle probe; the inert default preserves other executors.
- `crates/core/src/lib.rs:955-957` and `:1849-1856` — **executed/proven** by the native
  lifecycle test (`cold-clone-final.log:502-507`) and both browser ordering/replacement
  cases.
- `crates/wasm/src/jit_browser.rs:95-120,1194,1942-1990,2186-2190` —
  **executed/proven** in off/on browser runs and the independent zero-time attack.
- `crates/wasm/src/jit_browser.rs:738-790` plus invoke copy/fault call-site signature
  changes — **executed/proven** in the device-heavy unprofiled desktop run and the 34
  wasm browser-JIT parity tests (`cold-clone-final.log:602-673`); positive clock/read
  semantics are centralized in the already-proven `timer_now` function.
- `crates/wasm/src/lib.rs:628-646,860-866,1124-1133` — **executed/proven** by both
  dedicated-Worker engines. `WasmLinux::set_profiling` at `:2776-2778` is **waived** as
  an exact one-line delegation to that same exercised helper; it introduces no distinct
  branch, while default-off WasmLinux is covered by the desktop capture.
- `crates/core/tests/jit_entry_timing.rs` and the two verifier scripts —
  **executed/proven**. `web/tests/e4-t39-entry-cost-ledger.spec.js` is **waived** as a
  downstream compatibility assertion for the pre-existing large Node fixture; the same
  new field and positive-read behavior are directly exercised here.
- `Makefile`, task/queue/roadmap manifests and generated bindgen JS/definitions —
  **executed or declarative/generated**. The target ran at `cold-clone-final.log:1-800`;
  generated Wasm/JS were rebuilt, and the Wasm bytes match the committed artifact.
- Immutable JSON, logs and PNGs — **evidence, inspected**. All seven desktop PNG hashes
  and the demo PNG hash match their JSON records. No behavioral hunk is unexecuted,
  dead, or left as `needs-evidence`.

## Commands and results

- Hash verification: `shasum -a 256` over all task-log artifacts, v7 image/manifest,
  cold-clone outputs, and rebuilt/committed Wasm — all exact matches.
- Cold-clone checks: `git -C <retained-clone> rev-parse HEAD`, `status
  --porcelain=v1 --untracked-files=no`, `diff --exit-code`, and `diff --cached
  --exit-code` — exact `9c7861d2`, no tracked/staged changes.
- Fresh browser replay under `env -i` using only explicit Node/system paths, a temporary
  HOME, and explicit Playwright cache: Chromium 152 + Firefox 132 both passed; result
  SHA-256 `de1b0e3ec88b44861306e23ae2d2348b8f36006490c7c25e9d245a5af685a2d7`.
- Targeted scrubbed-env native rerun: `cargo test -p wasm-vm-core --test
  jit_entry_timing --test prof_time_accounting -- --nocapture` — 3 passed, 0 failed.
- Verifier zero-time/replacement attack under `env -i`: both browsers passed; result
  SHA-256 `bba44f4d3659abf601c395ac137b45d913c7dbb756b988796907dbf392f7aaf7`.
- Source/diff searches: no new ignored test, debug-only semantic gate, scheduler/guest
  clock routing, or task-boundary expansion found.

## Suite decision

Retain the worker's deterministic lifecycle test and dual-browser acceptance harness as
permanent regression artifacts. Retain this verifier's zero-time/replacement attack and
result as a replayable golden verifier artifact. No additional production test is needed;
the permitted verifier write scope excludes test-tree promotion and the stable behaviors
are already asserted directly.

## Verdict

**VERDICT: verified.** All preregistered predictions held; no contradiction, uncovered
behavioral hunk, stale evidence, self-licking oracle, or environment dependency survived
the attacks. This verdict does not verify E5-T22c or its separate two-second gate.
