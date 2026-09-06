# Initial rebuilt-image run — cache-control proof gap

Frozen head: `9ed9e0d1c57daf64f6362193bc30b79482dd3258`.
Source checkout: `/Users/blamy/Documents/Codex/e5-t18e-final.20gEr1/repo`.

The image rebuilt byte-identically from committed manifests. All 25 fresh-context
desktop/cursor/Terminal cases and the cache-enabled prime/reload passed with no
browser errors. The original recordings are preserved unchanged here.

However, the page CDP cache-disable setting did not propagate to dedicated
workers. The run therefore does not prove the stronger cache-disabled-worker
claim, regardless of its original `E5T18E_PASS` marker or `passed: true` fields.
The image rebuild and functional observations remain evidence; the corrected
browser proof must supply actual worker cache measurements. No product runtime
or image semantics changed in response to this observer finding.
