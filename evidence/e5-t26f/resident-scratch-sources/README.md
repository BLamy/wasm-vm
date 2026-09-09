# Retained negative diagnostic sources

These are exact source copies of the three quiet-print attempts, not supported
entry points or acceptance drivers. Their relative imports belong to their
original location `tools/verify/e5-t26f-quiet-probe-scratch.mjs`. The log headers
record the original commands and scrubbed settings; do not run these copies in
place. A/B were reconstructed from C and authenticated against the original log
hashes, including final-newline bytes.

| Source | SHA-256 |
| --- | --- |
| quiet-A-driver.mjs | 15ab6fa29d5fe36fd93d50e484d0fefeab717c7c80c48089dc6911623584d1b6 |
| quiet-B-driver.mjs | da724a0892afeffab991e3abedda574985a13cb2a45f7351baaa9cbbe2378f98 |
| quiet-C-driver.mjs | 7b827daaf0815570bedbcf9af5683e56899c15d1c2b8d56b9d962fb076b5149f |

A/B accidentally retained the entire snapshot byte object in their reports.
The original raw JSON remains locally untouched. Git retains lossless `gzip -n`
copies instead of the approximately 70-MB expanded JSON. `gzip -dc FILE.json.gz`
recovers the original bytes; compare their digest with the raw-file ledger in
`../resident-profile-localization.md`. No observation was omitted or rewritten.

| Compressed report (relative to parent evidence directory) | SHA-256 |
| --- | --- |
| resident-quiet-probe-3174e1c5/failure-command-quiet-probe-ready-completion.json.gz | de6f894420bfd89e610b18c5f654077f0c7ef5deedf2ba05917e69b45aee0374 |
| resident-quiet-probe-b-3174e1c5/failure-restore-normal-display-checks.json.gz | c380f90dacef21c4cb9940cbffd33b44f93e8352384a42723602adf5662bc475 |

None of A/B/C is a timing pass. A failed before reload, B failed the first CRC,
and C failed the generic repaint-area predicate before the final cap. C's setup
cursor acknowledgment and settlement do not establish the cause of B's mismatch.
