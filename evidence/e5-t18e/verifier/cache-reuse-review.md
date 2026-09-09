# Bounded cache/reuse review — final verdict deferred

Candidate: `5506f2a514a6a7b90d83eafe8cf39e6d3ff4fd1b`.
Reviewed cache source SHA-256:
`056054b90fe110a99d8847c0e3c0f944835d7a83ae6ca877a3216584a46ef845`.
Reviewed harness SHA-256:
`bbd686c740157b58520cb64c61b1b9bbdaeeca18a63d67c94477ca48114fb37e`.
Predictions were recorded in `cache-reuse-attack-predictions.md` before executing
the attacks below. Source snapshots are preserved alongside it.

## Cache guard — bounded predictions HELD

`cache-guard-attack.json` records an independent Chrome 152.0.7977.76 run on a
disposable 128-KiB immutable chunk, not the recorded image or an emulator:

- C1: Intact actual calibration: four cold transfers each report 131372 network
  bytes; both warm-reload requests report transferSize 0 and body size 131072.
- The actual `readWorkerCache` function also observed two completed network
  requests from one live dedicated worker (JSON line 126).
- C2: Removing only context routing in a disposable exact-source copy leaves
  page CDP cache disabling intact. Calibration rejects the resulting cold worker
  hit with `cold worker reused HTTP cache`, `1 !== 0` (JSON line 122).
- C3: The promoted observer-coverage test rejects empty and truncated timings.
  The independently specified mixed network/cached record is rejected cold,
  accepted warm, and rejected if its summary counters are forged.
- Mutation check: removing only the cold-cache assertion makes that promoted
  reuse regression fail with `Missing expected exception`; the intact module
  passes both tests (JSON lines 151-162). No worker source was edited.

Promoted file: `tools/verify/e5-t18e-cache-verifier.test.mjs`. The dependency
override only supports testing a verifier-owned disposable mutation module.
It is not connected to the worker's Makefile and has not been committed.

These results prove the bounded observer/guard checks, not the still-running
replacement 27-case proof. Per-boot timing coverage and final aggregation remain
NEEDS EVIDENCE until independently inspected. The harness now counts completed
worker resource entries against the guest loader's completed-body fetch count;
`crates/wasm/src/http_fetch.rs:220-225` increments that count after body completion.

## Two reuse-boundary findings

The attack executes the actual extracted reuse branch plus its HEAD source-path
guard with real fs/git operations on miniature disposable repositories. Only the
final `npm ci` call is stubbed; no guard is replaced. No image, build or boot is
run. Every case is checked twice without changing its fixture between checks.

### R3 FAILED — changed image-build inputs can pass reuse

At `tools/verify/e5-t18e-desktop-bringup.mjs:87-91`, the diff allowlist omits
called/mounted image-build inputs. `tools/build-rootfs.sh:51-57` calls the three
static-agent build scripts and `:72-73` mounts container-smoke.sh and wvrun.sh;
`tools/rootfs-inner.sh:684-689` copies the latter scripts into the guest image.

Observed twice in `reuse-boundary-attack.json`:

- `dirty-wvrun-input`, line 331: replacing the tracked working wvrun.sh with
  `#!/bin/sh\nexit 73\n` is accepted, with `buildInputsUnchanged: true` (line 348).
- `committed-builder-input`, line 522: committing that replacement for
  tools/build-file-agent.sh in the disposable current repository also passes,
  with a clean working tree and `buildInputsUnchanged: true` (line 539).

Demand: include the image build's actual transitive inputs in both previous-head
and working-tree comparisons, including the called build scripts, their pinned
linker wrapper, and mounted guest scripts. Re-record this cheap negative proof;
the finding does not require another image build or guest boot.

### R4 FAILED — expected publication is not checked against committed bytes

At harness `:80-82`, both expected and actual publication records come from
mutable working files. The expected anchor is absent from the HEAD source-path
guard and the end-of-run source hash map.

`working-publication-anchor-replaced` (JSON line 713) removes one old-source
digest, changes that old source, recomputes the binding, and writes the altered
publication to both working copies while leaving the current committed anchor
unchanged. The anchor's committed SHA-256 is `92dfa2ef...405865`; its working
SHA-256 is `fc17a411...a8a019` (full values at lines 716-717). The actual branch
accepts twice and records `buildInputsUnchanged: true` (line 730).

Demand: obtain/validate expected bytes against the named HEAD git blob (and bind
the anchor in source/evidence provenance), rather than letting two mutable copies
authenticate each other. Add this cheap negative fixture to the repaired guard
proof. This is a provenance-check refutation, not a guest semantic refutation.

## Controls and actual frozen-input check

R1 HELD: unchanged fixture accepted twice.
R2 HELD: changed tracked crate rejected twice.
R5 HELD: old source and compiled WASM byte mutations each rejected twice.
R6 HELD: changed old inline JIT snippet rejected against the git-bound digest
twice. See JSON case labels at lines 11, 202, 904, 1033 and 1162.

Read-only `reuse-frozen-input-check.json` checks the actual new frozen clone
`/Users/blamy/Documents/Codex/e5-t18e-cache-final.BHmnqG/repo` and old 9ed clone.
Their publication anchor bytes equal the committed `c0ae77aa...73a3c5` record.
The five named mounted/build scripts are byte-identical in both working trees
and both commits. Thus the reproduced bypass conditions are absent from those
checked real inputs; these findings do not establish corruption of the active
proof or invalidate the already-held rebuilt image/runtime.

Unchanged T18a-d, image/rebuild, publication integrity, Docker drills, docs
recovery, and original desktop/cursor/launcher observations remain HELD within
their recorded scopes. Original partial audits were not rerun or rewritten.

## Commands and preservation

`node evidence/e5-t18e/verifier/cache-guard-attack.mjs`

`node evidence/e5-t18e/verifier/reuse-boundary-attack.mjs`

Raw JSON, source snapshots, scripts, predictions, promoted tests and this note
are covered by `cache-reuse-review.SHA256SUMS`. The disposable fixture directories
are retained at the absolute paths recorded in the JSON. No task status, queue,
worker implementation, original clone, image, commit, PR or deployment changed.
Unrelated E6 and dist-manifest dirt remains untouched. No final verdict issued.
