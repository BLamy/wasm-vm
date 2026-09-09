VERDICT: held

# Release-integrity guard — bounded remediation rereview

Date: 2026-09-07  
Role: bounded critic using the requested Daybreak Blue posture; no delegation, task/status change, or commit  
Base HEAD: `719c6212a5e028523ef70376c864c6411fdf5b48`

## Scope

The guard-only rereview failed to refute the Luna remediation. F1, F2, and F3 from
`release-integrity-review.md` are fixed on the reviewed worktree bytes, and the pre-existing
fail-closed stale-rootfs behavior is retained. No live object was fetched, no credential or
secret source was read, no deploy or build was run, and no implementation, manifest,
`web/pkg`, or `web/dist` byte was changed.

Reviewed SHA-256 digests:

- `tools/deploy-cloudflare.sh`: `e33abdcc39cea9a35dc2993d7f5c93d4efdfa7fe38e9d3c399d2633e8e677eb1`
- `tools/validate-deploy-artifacts.py`: `e4560f8af7e59594182522ce3d06da2fbb8eb121cab7335cfb8113b8d198977b`
- `tools/validate-deploy-artifacts-test.py`: `c612f55a090995028fe8bdccfd7d43a5e3c3d4f4488d1cf01344f28029657e24`
- scoped tracked deploy-script diff: `3d1a61f88a9d1176d869d37f910b57bd38fc16cea773f128560d81a3cb5f7233`

## Prior findings

### F1 — HELD: schema-wide release URLs are rewritten and leftovers fail closed

Prediction: top-level/nested chunked base and profile strings are discovered even though they
are outside `artifacts`; exact rewriting moves them to R2; post-stage validation rejects any
local reference left under a pruned release tree.

Observed:

- Recursive string traversal and release-URL discovery are at
  `tools/validate-deploy-artifacts.py:88-108`.
- Deployment records those URLs before mutation, rewrites both chunked prefixes, prunes both
  trees, and rejects local references beneath every excluded prefix at
  `tools/deploy-cloudflare.sh:106-107,147-172`.
- An independent temporary fixture printed exactly
  `releases/chunked-alpine/manifest.json|releases/chunked-alpine/boot-profile.json`; both exact
  rewrites returned 0 and post-rewrite validation with the pruned-tree rejection option returned 0.
- The deterministic staging fixture exercises the same base/profile shape and asserts the final
  remote values at `tools/validate-deploy-artifacts-test.py:73-136`.

### F2 — HELD: regex collision is removed and final key binding is checked

Prediction: rewriting `releases/kernel/a.bin` cannot alter `releases/kernel/axbin`; two distinct
validated bytes retain their own SHA-derived URLs; sabotaging the second final URL to the first
is rejected.

Observed:

- Rewriting recursively compares complete JSON string values with `value == old` and errors when
  no exact reference exists (`tools/validate-deploy-artifacts.py:121-156`); no manifest rewrite
  uses `sed`.
- The committed fixture uses byte `A`/`a.bin` and byte `B`/`axbin`, then asserts distinct final
  SHA-derived URLs (`tools/validate-deploy-artifacts-test.py:61-136`).
- Queue-to-manifest validation requires each queued source's exact final URL, digest, and size and
  rejects unqueued R2 URLs (`tools/validate-deploy-artifacts.py:159-208`).
- Independent sabotage changed the second entry to the first object's URL. The helper returned 1:

  ```text
  wrong_second_binding_rc=1
  artifact-check: ERROR: queued artifact releases/kernel/axbin is not bound to exact final URL/digest/size: https://r2.example.test/sha256/df7e70e5021544f4834bbee64a9e3789febc4be81470df629cad6ddb03320a5c/releases/kernel/axbin
  binding_attack_harness_rc=0
  ```

### F3 — HELD: browser-significant encoded local paths are rejected

Prediction: `releases/boot-snapshot/%2e%2e/kernel/payload.bin` cannot pass local validation.

Observed: local URL validation now rejects control characters, every percent escape,
backslashes, and dot/empty segments before returning a path
(`tools/validate-deploy-artifacts.py:44-66`). The exact prior `%2e%2e` fixture is asserted to
fail at `tools/validate-deploy-artifacts-test.py:138-152`; the full deterministic test returned 0.

## Retained held checks

- **Stale rootfs remains fail-closed.** Commands were run independently against source manifests:

  ```text
  python3 tools/validate-deploy-artifacts.py --root "$PWD" --reject-remote --manifest web/artifacts.json
  artifacts_json_rc=0
  kernel: 24208896 / af7c4e471ed4dabdbe5a2717d81cc034b511d2b0f7706de66ad9e84e078c7cce
  initramfs: 1151596 / 35a74c93b8a14afd2a1e75a6b8d7d5feaf925ced33e17e80e9197a696649c563
  bootSnapshot: 10983666 / ba3168696638db573173b4d266f5234acd01fb2fabe452cc5a1dfde483a61d33

  python3 tools/validate-deploy-artifacts.py --root "$PWD" --reject-remote --manifest web/artifacts-alpine.json
  artifacts_alpine_rc=1
  expected 805306368, got 536870912

  python3 tools/validate-deploy-artifacts.py --root "$PWD" --reject-remote --manifest web/artifacts-node-alpine.json
  artifacts_node_alpine_rc=1
  expected 805306368, got 536870912
  ```

  Manifest digests were `9e28ead1264e08a806ef7fd3159813163ca26d4caf85071923b20467f3fa35dc`,
  `547c147ccfc57a1d5a3b6818c5c1cc74b3673de2e7dbc13300256d1a5725ff5d`, and
  `86cd0e8049ca1943848bfe3215d36e53e705cdb986b61d37a6aa2e92d5c27543`, respectively;
  `releases/rootfs/alpine-rootfs.ext4` was 536870912 bytes.
- **Malformed boundaries remain fail-closed.** A temporary fixture reran traversal, query,
  fragment, control-character, preflight-remote, and conflicting-declaration cases. Their helper
  return codes were `1,1,1,1,1,1`; the harness returned 0.
- **Content addressing and pre-Pages ordering remain held by code inspection.** Keys are derived
  from validated SHA records (`tools/deploy-cloudflare.sh:121-142`); exact public verification is
  before acceptance and after any upload (`tools/deploy-cloudflare.sh:35-77`); binding validation
  and the complete R2 queue drain precede `wrangler pages deploy`
  (`tools/deploy-cloudflare.sh:162-190`). This rereview made no network claim.
- **Bounded local gates held.** `bash -n tools/deploy-cloudflare.sh`, Python compilation with a
  temporary bytecode cache, and the scoped tracked diff check (`git diff --check --
  tools/deploy-cloudflare.sh tools/validate-deploy-artifacts.py
  tools/validate-deploy-artifacts-test.py`) returned 0.
  `python3 tools/validate-deploy-artifacts-test.py` returned 0 and printed
  `validate-deploy-artifacts tests passed`.

## Guard-only conclusion

The prior three deterministic refutations no longer reproduce, the extra wrong-key binding attack
is rejected, and stale Alpine rootfs declarations still stop validation before rewrite, upload,
or Pages mutation. Verdict for the release-integrity guard only: **held**.
