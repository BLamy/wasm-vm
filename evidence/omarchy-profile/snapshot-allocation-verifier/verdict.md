VERDICT: verified

Task: E5.5-T03al. Independent verifier: `/root/snapshot_allocation_verifier`.
Implementation `512ba6acc9b0293d04d96115372ddef2b1cccfab`; final deployment
artifact `bb3c13dd6014ca15f29fe897b3ba207d65bc67b8`; worker submission
`d6cd685399ed69333b9b3ad738ae190a256bd537`.

- **P1 allocation — HELD.** Predicted the actual R3 1 GiB first save would
  return without trapping. It returns 899,181,735 bytes at unchanged
  3,109,683,200-byte linear memory (`snapshot-allocation-r1/report.json:52-76`).
  The preserved original release-WASM run traps at `SnapshotWriter::section`
  through `handle_alloc_error` (`snapshot-allocation-baseline/report.json`,
  `allocation-stack.json:6-12`). The independent original-source control also
  reproduces geometric growth at `original-allocation-control/attack.log:3`.
- **P2/P2a bytes and state — HELD.** Predicted only the existing console
  shadow/generation restore transition. All 899,181,735 bytes' first, second,
  and third hashes match the independent oracle recorded before final evidence
  (`r3-byte-oracle.json`; `snapshot-allocation-r1/report.json:128-132`). The
  source-derived allowed offsets are independently parsed tag-11 payload+302
  and +312; nothing else is excluded. RAM digest remains
  `7b4695440b7bb6bfaa07b19e90afb758692627bd571fa2d6dd40d2e68e37616b`.
- **P3 persistent path — HELD.** Predicted a real persistent save/read with no
  extra transition. Actual `persistSnapshot`/`readStoredSnapshot` export hashes
  equal the full second save; actual stored restore then produces the exact
  third expected hash (`snapshot-allocation-r1/report.json:129-131,164`).
- **P4 refusals — HELD.** Predicted stale and foreign identities remain refused.
  Actual built-WASM decisions are `stale` and `foreign_image`
  (`snapshot-allocation-r1/report.json:161-164`). Native unchanged-state
  coherence and malformed/dirty restore cases pass
  (`snapshot-allocation-gates/resume-machines.log:220-226`, plus the CPU and
  desktop refusal tests in that log). Four independent native oracle seeds
  also reject altered core, base and generation at every prefix.
- **P5 novel attack — HELD.** Predicted exact framing/bytes and bounded suffix
  allocation across zero/tiny/large sections. The actual frozen module passes
  192 prefix serializations, 4,704 section appends, and 102,904,884 independently
  assembled expected bytes (`candidate-byte-attack/attack.log:1-9`).
- **P6 sabotage — HELD.** Predicted the same regression would reject removal of
  only the new reservation. The isolated candidate passes; the isolated
  reservation-removed module is byte-identical to the original source and
  fails at 131,171 bytes used versus 262,326 capacity
  (`reservation-removed-sabotage/attack.log:3`, `mutation.diff`, `report.json`).
  Neither runtime working tree nor worker test code was modified.
- **P7 coverage — HELD.** Every runtime success-path addition executes during
  full-size direct and persistent saves. The impossible supported-input size
  overflow panic, explanatory comments and generated metadata are individually
  waived with reasons in `coverage.md`. No unproven semantic hunk remains.
- **P8 submission/environment — HELD with inherited failures explicit.**
  Rehashed all 33 worker-sealed files and bound runtime/harness bytes through
  the final artifact head (`available-proof-audit.json`,
  `cold-deploy-audit.json`, `final-audit.json`). Format, affected native/WASM
  lint, 17 format + 49 machine/coherence + 33 native-WASM tests pass. The final
  scrubbed pristine clone rebuilt byte-identical WASM and repeated the full
  direct/persistent acceptance. I personally inspected both 127/0 suite images;
  both browser reports contain zero errors. Recorded deployment and production
  bytes match the final head. `make -k ci` remains exit 2: all five failure
  families reproduce the previous recorded errors on unchanged source. They
  are not relabeled passing. The native instruction wall passes 128/128 and
  the performance smoke passes 58.4 MIPS.
- **P9 scope — HELD.** This verifies export allocation for the pinned R3 guest.
  Repeated restore reaches 4,183,490,560 bytes; this is not a universal guarantee
  for every 1 GiB state. The roadmap and worker claim keep desktop responsiveness
  unresolved. T03aj's fresh-frame pair and T03ak's physical-input deadline still
  need their own recordings.
- **SUITE.** Retain the built-WASM browser acceptance as the regression, plus
  the independent native source-module oracle, isolated sabotage recipe and
  pinned expected hashes as reproducible evidence. Generated native binaries
  are discarded from the committed evidence; source, commands and output remain.

Worker seal (repo-relative 33 paths):
`snapshot-allocation-gates/sha256.txt`, SHA-256
`01786a6b6a15415c7977b4dc23fde07a2e1d82cb1b775340aefe8c888cb42632`.
Verifier scripts and results are independently sealed beside this verdict.
