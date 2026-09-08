# E5-T26j fresh-verifier artifacts

Fresh Daybreak Blue verifier evidence for frozen runtime/test head
`cb283f9b3204f99d0bbc9ad44121c4f5da7b8b6a` and metadata-only head
`054bb87f93b490645d5af921207f97af08629113`.

The verifier used one non-hardlinked clone at
`/private/tmp/e5-t26j-critic.pgE4yQ/repo`. Commands streamed to the Codex PTY;
they were not originally redirected to files. `cold-clone.log`,
`novel-oracle.log`, and the sabotage logs preserve the exact command, exit result,
and terminal result lines available from that stream. They do not pretend that a
post-hoc file is a byte-for-byte capture of terminal progress that was never
redirected. The worker's independently recorded full gate transcripts remain at
`../runtime-cb283f9b.log` and `../wasm-cb283f9b.log`, with authenticated digests
in `artifact-digests.txt`.

No verifier change was made to the main source, tests, task status, queue, branch,
commit, served bytes, browser, or tuning. Both source sabotages and the temporary
novel test were confined to the scratch clone and reversed. The clone was clean at
`054bb87f` afterward. All verifier-started compiler/test processes had exited by
08:16:22Z, before the measured desktop arms.

Contents:

- `cold-clone.log`: scrubbed clone commands and observed outcomes.
- `novel-oracle.rs`: exact temporary 256-case full-domain oracle.
- `novel-oracle.log`: its focused result.
- `sabotage-phase.patch` / `.log`: reversible floor-to-ceiling attack and failure.
- `sabotage-forwarding.patch` / `.log`: reversible desktop forwarding attack and failure.
- `provenance.json`: machine-readable run provenance and process-quiescence statement.
- `artifact-digests.txt`: frozen source, build, demo, and tiny-proof SHA-256 values.
- `browser-audit.md`: independent cold-seal, raw-arm, screenshot, and ABBA audit.
- `browser-digests.txt`: SHA-256 checks for the committed cold/ABBA evidence.
