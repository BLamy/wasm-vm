VERDICT: verified

E6-T11d74d1 is verified for runtime and final harness commit
`afd26047a3751a55d4bee376ecf668769d06bca5`, submitted in worker commit
`4784111bb4e12c8e948ff6254dd91edbcd34311e`. This reviewer did not implement GPU/runtime code.
No implementation file was changed during review.

The worker archive was reopened independently: 4,269,219 bytes, SHA256
`07c10a5a5ea3c4edeb56ffcac862c1199460e34a81e5699cc1de525131f3b3bd`.
All 418 members are regular safe paths; all 417 manifest entries match their
recorded size and digest. All 132 frozen worker sources match candidate Git
blobs, using committed dist copies for ignored generated package files.

Predictions were recorded before each bounded run. P1–P10 are HELD:

- **P1 continuity.** Predicted the old green front remains until a valid replacement.
  All 4,096 pixels remain RGBA `[0,255,0,255]` after the original native/MMIO rebind,
  before blue arrives. Worker archive member
  `recording/scanout-continuity-repaired01/actual-worker/rebound-before-replacement.json:84`
  (`pixels`), SHA256 `8af2c697d9893ecf71ee5108e0414fc703471c884b16f27b695098b624986407`.
- **P2/P6 ownership and rapid rebind.** Old native sequence `6`, binding `1`, retires
  once as `cancelled`; sequence `8`, binding `3`, retires `drawn`. A revoked callback
  delivered after blue queues leaves green visible and blue pending. Points:
  `rebound-before-replacement.json:26462`, `stale-callback-before-blue.json:94`,
  `fresh-blue.json:26501`; fresh-blue SHA256 `1a9a90ff8679ea0404c9dd1a5bd0c83a777f6a08c3d0d586b138fa0c4702b34e`.
  The independent structured-clone/protocol/main-handler run also rejects stale ACKs.
- **P3 first partial frame.** Predicted a new backing with one-pixel damage replaces
  the complete old backing. Independent fixed and nonfixed retained presenters and
  the ordinary scheduler now agree with every literal pixel. This probe first
  failed with 11/12 old pixels; `headless01/report.json` result 4 preserves that
  refutation, and `headless03-checkpoint-gate/report.json` result 4 holds the repair.
- **P4/P5 recovery and explicit erasure.** Invalidation removes recovery authority;
  actual worker WebGL loss leaves 4,096 transparent pixels, `latest:null` and
  `replayedFrames:0`. Point `actual-worker-context-lost.json:142`, SHA256
  `50dc35a1c34568bfad93aee6e2dfba82c05428a121bd5fa8e146aa0a9015b1f3`. Native disable/re-enable stays blank until
  a fresh original frame. Independent reset/teardown and scheduled paths also hold.
  Synthetic page-backend fallback is explicitly labelled synthetic; the worker
  context-loss evidence uses actual Apple Metal.
- **P7/P8 protocol and invalid input.** Protocol 2 runs through the actual worker;
  stale protocol-1 display/receipt controls and invalid preservation flags reject
  without changing current ownership. Point: final `independent-state-attacks/report.json`,
  results 5 and 7, with exact executed driver and CDP coverage.
- **P9 checkpoint gate.** Active ownership forwards the preservation flag; inactive
  reconstruction suppresses historical frames, and activation explicitly clears
  before a fresh frame. The independent exact-source gate checks hold. Original
  native dev01's dropped argument and transparent frame are preserved separately;
  final actual native worker evidence exercises the repaired real owner wrapper.
- **P10 build and regressions.** The complete no-local clone is at the exact candidate,
  clean after build/acceptance, nonshallow, without alternates or promisor packs;
  independent `git fsck --connectivity-only --no-dangling` succeeds. All 15 selected
  acceptance commands have the expected exit, including the intentional old-clear
  negative. Native GPU/checkpoint tests: 26 passed, none ignored. Protocol/presentation/
  clock tests: 66 passed. Independent Metal pixel checks: 47 assertions in 3 rows;
  independent state checks: 8 HELD groups. Four original software guests complete
  all 10 boot/persistence phases with their original markers and exit 0, including
  both durable-read markers. The ordinary built app records 127 passed / 0 failed,
  no proof exports and zero unexpected browser errors. Its served Wasm digest
  matches the candidate's committed dist.

The required no-blank sabotage is authenticated: only
`web/renderer/virgl-command/production.mjs` differs between healthy and negative
sources, replacing the conditional control with the original unconditional
`clear`. It fails exactly at the between-bind literal-green assertion; this is
not an unrelated error. The sealed independent audit records both hashes.

Coverage covers each runtime hunk through actual native/MMIO delivery and the
independent scheduled, retained, partial, recovery, malformed-input and staged
checks. Comments/formatting have no executable behavior; same-content renderer,
web and dist copies are covered by byte equality. The Make target is a direct
alias to the same recorded Python runner. Existing native/DMA/storage/clock
proofs carry from E6-T11d74c at `baf3d1035eec4e184eb2704bc52c2ce17066b1ed`
by unchanged dependency bytes; selected native regressions were also recorded.

The clone-history portability failures are preserved. The HEAD-only generator
repair passes an independent extra-ref challenge; a scratch legacy `--all`
negative fails it, while advancing real HEAD changes the expected activity.
`tools/test_gen_tasks_json_head.py` promotes that observable regression test.
It passes directly; its old-behavior negative fails at the intended assertion.
The earlier Node 120-second external-chunk timeout is preserved. The final
finite 300-second live-command budget keeps the original marker and exit
predicate, records chunk latency, and makes no restore-speed claim.

The reproducible MMIO supervisor is a graphics boundary fixture. This verdict
makes no Linux/Mesa warm-publication claim. The new worker identity remains
`f76a37284d175ecba88ade0de496d3f232fd7dbeefef166a79c537e6ffc7f6bc`;
no old factory was relabelled. E6-T11d74d and E6-T11d74d2 remain outside this verdict.
The protected user guest was never attached, focused, navigated or terminated.

`review.tar.gz` retains the independent predictions, original refutations,
executed drivers, literal observations, CDP coverage, generator negative,
regression-test receipt and final sealed-submission audit. `review.json` pins it.
