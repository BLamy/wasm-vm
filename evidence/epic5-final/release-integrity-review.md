# Final release integrity guard — bounded critic review

Date: 2026-09-07  
Role: fresh preparatory critic; no task status change  
Base HEAD: `d6570868251ba20c6a06065b34c454df8a7fd4a5`

## Scope and verdict

**PREPARATORY VERDICT: refuted.** The proposed guard is not yet sufficient for the worker's general release-integrity claim. Three deterministic temporary-fixture attacks survive the local checks: schema-external release URLs are ignored, regex-based rewriting can bind a manifest entry to the wrong content-addressed object, and percent-encoded dot segments can make local validation disagree with browser fetch semantics.

This is not a claim that the current production deployment is fixed or presently broken. No deployment was run, no public object was fetched, no secret or credential source was read, and no runtime, manifest, task status, or implementation file was modified. Two independent critics using `gpt-daybreak-blue-latest` reviewed the same bounded surface; the reproductions below were rerun in this session.

Reviewed worktree bytes:

- `tools/deploy-cloudflare.sh`: `4bd0aeb8a93ff24df289e771c6aaa46f009877abf4bd3ab71c30779610e0dad1`
- `tools/validate-deploy-artifacts.py`: `e0047f2cca8aa8d28758176b05a1e3490e12f296f5c3de6ad893af6e7d32b65b`
- `tools/validate-deploy-artifacts-test.py`: `6e9cd79e3d479f3abd039de6513839db08c1a2aeb6dcce907e0bf714ba9ae663`
- `git diff -- tools/deploy-cloudflare.sh`: `267719274b73c552e80aadd862aa205ac53905331c02de3ce69aeab247437cb0`

## Findings

### F1 — FAILED: rewrite and validation lost schema-wide URL coverage

Prediction: after pruning `web/dist/releases/chunked-*`, every manifest reference into those trees is either rewritten to R2 or causes the pre-Pages validation to fail.

Observed: `validate_manifests` iterates only `value["artifacts"]` (`tools/validate-deploy-artifacts.py:85-88`). Deployment rewrites only records returned from that traversal (`tools/deploy-cloudflare.sh:122-143`), removes both chunked trees (`tools/deploy-cloudflare.sh:146-148`), and invokes the same artifacts-only validator afterward (`tools/deploy-cloudflare.sh:150-153`). The removed implementation rewrote every quoted `releases/` string (`git show HEAD:tools/deploy-cloudflare.sh`, line 81), including non-artifact base/profile fields.

Temporary fixture: one valid `artifacts.kernel.url`, plus top-level `chunked.base = releases/chunked-alpine/manifest.json` and `chunked.profile = releases/chunked-alpine/boot-profile.json`. Applying the new preflight, artifact-record rewrite, prune, and post-stage validation produced:

```text
PRINT_RECORDS:
releases/kernel/k<TAB>86be9a55762d316a3026c2836d044f5fc76e34da10e1b45feee5f18be7edb177<TAB>1
POST_VALIDATOR_RC=0
base=releases/chunked-alpine/manifest.json profile=releases/chunked-alpine/boot-profile.json
MISSING releases/chunked-alpine/manifest.json
MISSING releases/chunked-alpine/boot-profile.json
```

Current-scope note: all 11 declarations (8 unique URLs) in the three present `web/artifacts*.json` files put their `releases/` URLs under `artifacts`; no current distinct pair collides under the sed patterns. The checked-in `releases/chunked-alpine/manifest.json` has chunk hashes but no base/profile URL fields, and `web/main.js:2023,2040` currently constructs the production chunk endpoints from `R2_ASSETS`. Therefore this is a reproduced guard/schema regression, not evidence that today's source manifest already contains the bad shape.

Minimal demand: structurally cover the supported base/profile fields (or all schema-recognized release URLs), then fail after pruning if any relative `releases/` reference remains. Add a staging-level regression fixture with non-`artifacts` base/profile references.

### F2 — FAILED: sed regex collision can silently bind an entry to another artifact

Prediction: two locally validated, byte-distinct artifact URLs retain a one-to-one mapping to their own SHA-derived R2 keys after rewriting.

Observed: `rewrite_r2_reference` interpolates the URL directly into a sed basic regular expression (`tools/deploy-cloudflare.sh:108-112`). A fixture used `releases/kernel/a.bin` (byte `A`, SHA `559a...ffd`) and `releases/kernel/axbin` (byte `B`, SHA `df7e...20a5`). The `.` in the first URL matched the `x` in the second URL, so the first rewrite changed both entries. The second rewrite found nothing. Post-stage validation returned success because remote URLs are skipped (`tools/validate-deploy-artifacts.py:89-95`):

```text
POST_VALIDATOR_RC=0
first=https://r2.example/sha256/559aead0...a08fdffd/releases/kernel/a.bin
second=https://r2.example/sha256/559aead0...a08fdffd/releases/kernel/a.bin
EXPECTED_SECOND_SHA=df7e70e5021544f4834bbee64a9e3789febc4be81470df629cad6ddb03320a5c
```

The R2 queue still contains both validated objects. Consequently, exact public verification of both queued keys would not detect that the published manifest's second entry points to the first key.

Minimal demand: rewrite parsed JSON by exact string equality and assert a bijection between each queued `(source, SHA, size, key)` record and the final manifest reference. Add the two-name collision fixture to a deploy-staging test, not only the helper unit test.

### F3 — FAILED: percent-encoded dot segments pass locally but fetch a different browser path

Prediction: a locally validated Pages-hosted snapshot URL resolves to the same staged file when interpreted by a browser.

Observed: `_local_path` applies `Path(parsed.path).resolve()` without URL percent-decoding or browser-equivalent canonicalization (`tools/validate-deploy-artifacts.py:41-53`). A one-byte small snapshot at the literal path `releases/boot-snapshot/%2e%2e/kernel/payload.bin` passed preflight, was copied through the small-snapshot path (`tools/deploy-cloudflare.sh:130-135`), and passed post-stage validation. Node's standard `URL` parser normalized that manifest URL to `/releases/kernel/payload.bin`, which was absent:

```text
PRE=0 POST=0
RAW=releases/boot-snapshot/%2e%2e/kernel/payload.bin
NORMALIZED=/releases/kernel/payload.bin
RAW_PRESENT
NORMALIZED_MISSING
```

Minimal demand: reject browser-significant encoded dot/separator forms or canonicalize with the same semantics as the consumer before containment, identity, copy, and conflict checks. Add this exact small-snapshot fixture.

## Held checks and bounded non-findings

- **HELD — current fail-closed preflight.** `web/artifacts.json` passed exact size and SHA checks for kernel, initramfs, and busybox snapshot. Untouched `web/artifacts-alpine.json` and `web/artifacts-node-alpine.json` both failed before rewriting with `expected 805306368, got 536870912` for `releases/rootfs/alpine-rootfs.ext4`. Hash verification was not weakened or bypassed.
- **HELD — direct malformed boundaries.** Temporary fixtures for `../payload`, `payload?x=1`, `payload#frag`, a preflight `https://` URL, and conflicting declarations for the same exact URL all returned nonzero with the intended diagnostic (`tools/validate-deploy-artifacts.py:41-52,90-102`).
- **HELD — TAB/LF do not currently produce a publish bypass in the bounded kernel fixture.** `urlsplit` stripped embedded TAB/LF while `--print-records` emitted the original controls raw (`tools/validate-deploy-artifacts.py:160-162`), corrupting the TSV consumed at `tools/deploy-cloudflare.sh:122,158`. Preflight returned 0 when the stripped local path existed, but post-stage returned 1 after the kernel tree was pruned. This malformed protocol deserves direct rejection, but no separate release-integrity failure is claimed from this fixture; F2's structural rewrite demand removes the TSV-to-sed ambiguity.
- **HELD by code order only — content addressing and pre-Pages public checks.** Kernel/initramfs/rootfs and oversized snapshot keys include the validated SHA (`tools/deploy-cloudflare.sh:125-140`). `ensure_r2_object` verifies public bytes before accepting an existing object and again after upload (`tools/deploy-cloudflare.sh:49-76`); the queue drains before `wrangler pages deploy` (`tools/deploy-cloudflare.sh:155-171`). No network verification was performed in this no-deploy review. F2 demonstrates that this ordering does not prove final manifest-to-key binding.
- **HELD — basic gates.** `git diff --check`, `bash -n tools/deploy-cloudflare.sh`, Python compilation with a temporary bytecode cache, and `python3 tools/validate-deploy-artifacts-test.py` all returned 0; the test printed `validate-deploy-artifacts tests passed`.
- **COVERAGE GAP.** `write_manifest` in `tools/validate-deploy-artifacts-test.py:21-22` always emits only `{"artifacts": ...}`. The test exercises helper hash/size/missing/direct-traversal/remote behavior, but it does not execute deployment rewriting, pruning, queue-to-manifest binding, encoded URL behavior, or post-stage validation.

## Minimal release-blocking demands

1. Replace textual sed substitution with parsed, exact structural rewriting and prove one-to-one final manifest binding for every queued object.
2. Restore explicit coverage of chunked base/profile references and reject any relative release URL left beneath a pruned tree.
3. Enforce browser-equivalent URL canonicalization (including encoded dot segments and control-character rejection) before validation and record emission.
4. Add one staging-level deterministic test containing the three fixtures above; rerun the untouched manifests and preserve the current stale-rootfs failure until the manifest and artifact genuinely agree.
