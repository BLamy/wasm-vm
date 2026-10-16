# Supplemental fresh read-only binding spot-check

After the main verifier completed its 3,524-check audit, a separate fresh child
`/root/graphics_routes/milestone_check/final_binding_spotcheck` inspected final
bindings and the two harness-repair diffs without implementing or editing code.
It returned no semantic or provenance blocker. This is supplemental evidence,
not a delegated task verdict or replacement for the main independent attacks.

Its independently reported checks:

- Final report and receipt SHA-256 match `d99c7d98cd1dee7e34b70c38b7ff480c8718806f5787c98ec96b76bb32f0da3e` and `84c6d8af8e691fc82f0d0778ab6e9a3e73b98750ef74c1d004c8075747552352`.
- Report, receipt and retained clone identify `85962c4956bad75c7703767650b49763fb0e5945`; the retained clone is still clean.
- All 49 acceptance-file hashes, 46 receipt-record hashes, 88 source bindings, validator hash and cold-log hash match.
- Desktop report has empty console/page/request/HTTP/server error arrays. The transcript contains 406 requests, responses and completions, with no failure events or console/HTTP errors. Strict error rejection remains at `tools/virgl-command/scanout-desktop.mjs:276`.
- `f1aeb253..fbceeb4d` changes only receipt validation. `fbceeb4d..85962c49` changes only desktop kernel header/request diagnostics plus diagnostic evidence; runtime is unchanged. Only the immutable kernel gets no-cache; other assets retain no-store. Fresh context, blocked service workers and CDP cache disabling remain active.

The main checkout's later worker/evidence commit `ad88508e` and unrelated
untracked files do not contradict the clean retained recording clone.
