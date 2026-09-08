# E5-T26f single-process quiet screen — source preflight

**PREFLIGHT VERDICT: BLOCKED on one provenance closure; no browser launch yet.**

This is not an F verdict and does not refute the print-only hypothesis. The reviewed derivation is
otherwise scoped for exactly one RAM-only, nonacceptance screen: it keeps the current proper runner,
the original T0/end and 2,000 ms assertion, the initial 2,000-pixel fixture check, all resident C
identity/FD/PCM gates and the same-child `wait`, while replacing only the post-play printing and its
generic changed-pixel oracle.

## Exact bytes reviewed

- HEAD: `001e80864911863145f2127192bae5df8186e68b`
- factory: `tools/verify/e5-t26f-single-process-quiet-probe.mjs`
  `dcf52ced1640baf7dc3fb7f73bcd5b8ae1253679ea51e09469b1bd4cf3268ec5`
- factory tests: `tools/verify/e5-t26f-single-process-quiet-probe.test.mjs`
  `ee6a5d1c43e6ba5cf29c13530d07215e07bd927ae9104858317dc0f3c0b0f859`
- launcher: `evidence/e5-t26f/single-process-quiet-001e8086/run.mjs`
  `647623aae9c1a6bc886a5dfd2a31669965e120a7713da20387701a0d16e47e88`
- independently derived driver (not written):
  `58b735d6a2225cd6614c192af898d7b4878ae1124f39d2244867274684b3fa73`

The reported 9/9 tests were not rerun in this read-only preflight.

## Held source properties

- **Derivation boundary — HELD.** The factory pins the current proper runner, held quiet driver,
  exact-text oracle and 72x13 template (`tools/verify/e5-t26f-single-process-quiet-probe.mjs:10-15`),
  requires unique substitutions, and records 17 changes (`:62-127`). The transplanted text path
  requires a fresh exact raster, unchanged titlebar, focused canvas, accepted focus, no red marker,
  and the exact ten physical key edges for `play` plus Enter
  (`tools/verify/e5-t26f-quiet-text-probe.mjs:1302-1376`).
- **Protective guest gates — HELD.** The RAM command redefines only
  `e5_print_observation`, after authenticating the old restore and before saving a separately
  derived snapshot (`tools/verify/e5-t26f-quiet-text-probe.mjs:1790-1834`). The installed helper's
  post-restore path still runs the C observer, requires byte-equality with the prepared record,
  feeds finite PCM, closes the FIFO writer and waits for the exact prepared PID before success
  (`tools/guest/e5-t26f-resident-observer.sh:112-135`). Its two pre-save printed records remain in
  the copied sealed state (`:90-103`); only the post call's three `printf`s (`:67-74,119`) are
  suppressed in the derived RAM state.
- **Original interaction boundary — HELD.** T0 remains `firstRestore.completedAt`
  (`tools/verify/e5-t26f-browser-roundtrip.mjs:1707-1727`), end remains frozen immediately after
  fresh non-silent PCM/render checks (`:1849-1871`), and the original final assertion remains
  `postRestoreEnd - postRestoreStart <= 2_000` (`:1924-1936`). The factory test also requires the
  initial fixture's `firstCommand.visualDiffPixels >= 2_000` while removing only the post-play
  heuristic (`tools/verify/e5-t26f-single-process-quiet-probe.test.mjs:113-136`).
- **Seal and knobs — HELD for this launcher.** The factory asserts the closed 05b profile,
  snapshot, runtime and image hashes (`tools/verify/e5-t26f-single-process-quiet-probe.mjs:17-23,89-97`).
  The unchanged proper runner copies the sealed seed to a new iteration and verifies equality,
  never launching the seed (`tools/verify/e5-t26f-browser-roundtrip.mjs:220-239`). The launcher
  scrubs inherited `E5_*`, Cargo and Rust diagnostic variables, then reconstructs the original 05b
  common settings with only required HEAD `001e...`, reuse mode and the new output changed
  (`evidence/e5-t26f/single-process-quiet-001e8086/run.mjs:14-44`). No JIT/cache/clock/profiler,
  pacing, command, image, profile, port or timeout override is introduced.

## Launch blocker

**B1 — three executable imports are not pinned before child spawn.** The proper runner imports
`e5-t22c-cpu-profile.mjs`, `e5-t26f-guest-profile.mjs` and `e5-t26k-decoded-cache.mjs`
(`tools/verify/e5-t26f-browser-roundtrip.mjs:27-32`). The factory rewrites these to absolute file
imports (`tools/verify/e5-t26f-single-process-quiet-probe.mjs:120-126`) but its source-pin set omits
them (`:10-15`), and the test checks only that absolute imports exist and are nonempty
(`tools/verify/e5-t26f-single-process-quiet-probe.test.mjs:194-203`). The launcher pins resident
proof and the guest helper/C/binary, but not these three modules
(`evidence/e5-t26f/single-process-quiet-001e8086/run.mjs:17-31`). Because ESM imports execute before
the generated driver's environment guard, disabled optional knobs do not make mutable imported
bytes inert. Uncommitted drift would retain HEAD `001e...` and evade every current pre-spawn pin.

Minimum closure: add these exact files and hashes to the launcher's pre/post `sourceBindings` check,
before `spawn`:

- `tools/verify/e5-t22c-cpu-profile.mjs`
  `f75fb38299169c662f6f6668d63d17e8ddaf6ec70a19082455e9de121ea5d5d4`
- `tools/verify/e5-t26f-guest-profile.mjs`
  `1b9d202be44aa3c01f770ef5483551be0cfc828631b6cbc78caff53baf70948a`
- `tools/verify/e5-t26k-decoded-cache.mjs`
  `fc6dde980554845fc3d28f5e44dcd0caf0c1659d48b320054a00aeb8e67e9843`

`web/bench/desktop-perf.js` is already covered by the sealed runtime tree digest because `bench/`
is included (`tools/verify/e5-t26f-browser-roundtrip.mjs:167-183`), and resident proof is already
launcher-pinned. After B1 is closed, bind and re-review the final launcher hash; if the factory and
test hashes above remain exact and the target/output paths remain absent, the resulting disposition
can be a scoped go for one screen only. Diagnostic success would still be nonacceptance evidence,
not E5-T26f verification or a performance waiver.

## Incremental addendum — B1 closed

**SCOPED LAUNCH GO for the single invocation above.** The final launcher SHA-256 is
`f8dad67f176ed94fae3c46e3d896ace20c491ef26c8e06ef05730bb19aa0507f`, superseding the
pre-closure launcher hash recorded above. Its only reviewed change is the three demanded exact
bindings at `evidence/e5-t26f/single-process-quiet-001e8086/run.mjs:20-22`. They are members of the
same `sourceBindings` object checked before generation/spawn (`:29-47`) and again after child exit
(`:54`). The three files rehash to the values listed in B1.

Factory and test bytes remain exactly
`dcf52ced1640baf7dc3fb7f73bcd5b8ae1253679ea51e09469b1bd4cf3268ec5` and
`ee6a5d1c43e6ba5cf29c13530d07215e07bd927ae9104858317dc0f3c0b0f859`; HEAD remains
`001e80864911863145f2127192bae5df8186e68b`. Both
`target/e5-t26f/single-process-quiet-001e8086` and the evidence `record/` output were absent at
this check. B1 is closed without changing the derivation, runtime, guards, seal, knobs, T0/end or
2,000 ms cap. Launch authorization remains exactly one RAM-only print-suppression screen through
this final launcher; it grants no repeat, tuning, acceptance, verification or waiver claim.
