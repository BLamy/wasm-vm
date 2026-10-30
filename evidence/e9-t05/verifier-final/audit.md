VERDICT: verified

This fresh final review was limited to the remaining pristine-source and public proof.
Runtime, dependency, promoted-test, correctness, coverage, regression, bounded novel-check
and sabotage findings from the prior fresh verifier remain HELD under AGENTS.md's
incremental policy. No program tests or new negative cases were executed, and no runtime
or test code was edited. Predictions preceded each receipt inspection. Read-only evidence
interrogation used Python SHA-256/JSON/raw-byte parsing, Git source comparisons and 16
fresh HTTP byte reads; the accompanying programs write only ignored audit notes.

## Falsifiable predictions and observations

| Prediction | Result and citation |
| --- | --- |
| F0: unchanged prior evidence and source boundaries | **HELD.** All 44 files in the prior final receipt, four external trace/coverage records and five frozen test hashes authenticate. Prior audit SHA-256 is `7077ac57cb73657e127f1430cd2046c1081996b4e62a8b05c96aed60d6dfcb29`. Runtime freeze `4ce36a932feaf171c09cd8b25e90d3fc9ff376ac` to test freeze `7ac83e660cc316440a9e42cf961224f0c24a314a` changes only the declared direct-loader helper beyond evidence/task metadata. Later commits through reviewed parent `fd6ea95575166e9dd976702d04a8ab005e122d1a` add evidence and task catalog/service-worker metadata only. `cold-authentication.json` /source and /prior; `public-authentication.json` /source_boundary_unchanged. |
| F1: exact clean source and scrubbed environment | **HELD.** Cold receipt SHA-256 `6d4f5d414489eff824e17da6a74b1a0dd03b9ac66525d542be4fb50592d7316d`; acceptance SHA-256 `0241e2c0d9704ec478594e61e324dfa2f3df845b20ff8c267b721e9173d106f2`. The retained wrapper creates a new clean detached cone checkout at `7ac83e66`, removes Rust/Cargo/Git overrides, inherits no target/node_modules output, and keeps evidence outside the checkout. The retained checkout is still clean and has no Git alternates. All five outer commands exit zero. `../cold/receipt.json` /head,/commands,/environment and `../cold/wrapper.source.py`; `cold-authentication.json` /source. |
| F2: every original and compact copy authenticates | **HELD.** Cold: 540 listed acceptance payloads plus its report = 541 acceptance originals; 542 outer-listed payloads include those 541 and commands.log, with the outer receipt itself separately authenticated. All 51 compact acceptance copies, one restored alias and three outer copies match, including gzip decompression. Public: all 781 originals, 34 compact files and one restored alias match. Original full trace/profile/raw/native/ext4 paths remain retained. `cold-authentication.json` /originals,/compact; `public-authentication.json` /originals,/compact_files,/aliases. |
| F3: source and commands match the frozen claim | **HELD.** All 42 source hashes agree across cold receipt, acceptance, exact frozen Git blobs, pristine checkout, current source and public provenance. All 20 recorded acceptance commands match the frozen harness and exit zero. Native logs contain no failed test results; the only panic messages are the existing two register should-panic tests, both passing at core-native.log:410–418; :559 reports 399 passed/0 failed. `cold-authentication.json` /commands,/source,/native_recorded_results,/expected_panics. |
| F4: build bytes reproduce | **HELD.** Independent read-only hashing of all 51 runtime inputs in current web, deployable dist and pristine build reproduces runtime `c404e41c43d7912f5ae2886848724d018b515cc5d1a668a15105ba3f54b232bc`; Wasm `71ab136a773611c06e409a7b998c65a477af64b5a42cb056f7b60bd2c165d027`, 1,864,397 bytes. `cold-authentication.json` /builds. |
| F5: exact restored state and atomic outcomes remain recorded | **HELD.** Independently decoded five parts, all 16 native sections and sparse RAM from every final cold/public raw tuple; component digests and exported bytes match the oracle. Cold before/restored frame: 23,815,994 bytes, SHA-256 `0995665f26a010e24a725433ae23d83de5317346fbd187c9a9467c0b77b558d3`. Public: 23,837,160 bytes, SHA-256 `95ec5bad55a328fa55bf97e8543e84089d955450db4616d496a00cbd52807e4b`. Both preserve pending UART, held key [30], saved RAM and actual resumed `memory-before/queued-before`; advanced live guest remains usable after rejected publication/restore. Raw before/restored files are `e9:before\n`, advanced is `e9:after\n`, and the recorded filesystem oracle used the actual reconstructed images and read-only debugfs. `cold-results.json` /tuples,/exact_restore; `public-results.json` /tuples,/exact_restore. |
| F6: bounded I/O, promoted checks and demo/compatibility pass | **HELD.** Both final recordings drain original read/write work without clock advance, stop after the recorded 16 failed passes and recover on the same machine with 49,997 instructions. They retain 16 all-component native refusals, five frame-component refusals, valid paused direct-loader restore at zero instructions, profile/topology rejection with source preservation, one competing append winner and coherent ABA leaf pairs 67/67 and 68/68. Both demo results are 127/0, errors [], verified pip. The unchanged retained accelerated factory qualifies, stays healthy and physically draws in fresh epoch 4 after 2,499,808 instructions. `cold-results.json` and `public-results.json` /io,/critics,/suite,/gpu. |
| F7: public proof authenticates deployed bytes | **HELD.** Public report `6b31a2af91a67ab9f6eac8bec336bc96d9e543fb18ffbddbb18b2be83cf03217` records 04:42:52–04:51:30 UTC at catalog/source head `3508ad16`. Its 16 HTTP asset receipts match frozen dist; 16 additional fresh HTTP reads independently agree byte for byte. Sealed public provenance SHA-256 `013d218a591da579c65e78611069d7072ec736a445c6fecf7b6deb58014e669a` authenticates the exact command, source, logs and packet. Deployment log confirms `https://6545bb6f.wasm-vm.pages.dev`; production is `https://wasm-vm.pages.dev/`. `public-authentication.json` /http,/deployment,/command. |

The actual cold browser report SHA-256 is `a6877e50369ffa3b2ceabd0c73481b42e1d66ed33453b0e01e0c8d7b10bff4b1`;
its suite, restore, memory, I/O, critic, ABA and GPU results begin at lines
10, 342, 431, 440, 639, 783, 853 respectively
in `target/evidence/e9-t05-cold-final/acceptance/browser/report.json`.
The public report's corresponding points are lines 108, 440,
529, 538, 737, 881, 951 in
`target/evidence/e9-t05-public-final/report.json`. Exact file/line witnesses, raw frame,
RAM and file hashes are preserved in the two results JSON files.

Cold trace SHA-256 `126c6cba825fe66dd9fafcf299fe1c0972ffc7d33a81d20c39708988a2e48d65` has 872 entries;
public trace `6e398b439d41db27271a63d9d6b118bc704e32c052da663599744f2146afbac0` has 1243 entries. Both contain the
recorded trace and authenticated screenshots. Screenshots support visible state only;
raw tuples, resumed guest output and filesystem bytes support checkpoint state.

## Coverage and permanent suite

The prior 94-hunk/22-file coverage classification, narrow declarative/error waivers,
65 native all-component refusals, 32 input continuation schedules, promoted browser
buffer/direct-loader checks and isolated sabotage result are carried unchanged. Their
runtime/dependency/evidence digests authenticate; none is repeated merely because this
final proof was pending. No changed code is newly unproven or dead. The permanent
`make verify-E9-T05` target and already-frozen promoted tests remain the suite artifact.
This verdict is scoped to the admitted single-hart offline software/ICount profile;
accelerated session history, replay and the later saved-session UI remain their own tasks.

No in-scope refutation or evidence gap remains. The retained pristine source checkout is
no longer needed for this verification and may be cleaned up; preserve original evidence
directories because their full traces/profiles/images are referenced by the packets.

Verification metadata checks: `python3 tools/check_task_policy.py` passed with active=none;
`python3 tools/build_queue.py` regenerated 729 tasks / 517 verified; `git diff --check` passed.
No acceptance command was rerun during this final review.
