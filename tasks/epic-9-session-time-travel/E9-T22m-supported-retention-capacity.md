---
id: E9-T22m
epic: 9
title: Qualify a supported 16 GiB local retention profile
priority: 524.9220295
status: implemented
depends_on: [E9-T22l]
estimate: S
risk: high
capstone: false
---

## Goal

Allow the unchanged full Omarchy workload to retain its complete local session
history beyond the configured 8 GiB physical payload budget.

## Boundary

Declare and prove the existing production `SessionStore.setRetention` 16 GiB
setting as an explicit local qualification profile, with a browser-quota and
host-free-space preflight. Do not change the storage format, portable archive
bounds, guest image, COW boot overrides, ICount/64 clock, 50M checkpoint
cadence, GPU probe, workload amounts, or original performance budgets. E9-T22c
owns the next complete original workload and replay; this prerequisite does
not pass it with a saved prefix or synthetic desktop.

## Acceptance criteria

- [ ] Independently rehash and account for the retained failed C prefix:
      8,589,076,999 physical bytes at checkpoint 350, 857,593 bytes short of
      8 GiB, with every saved object reachable. Preserve the original failure.
- [ ] Prove a supported 16 GiB setting through the production IndexedDB store,
      including durable reopen, append admission above the old 8 GiB budget,
      graph readability and cleanup, and atomic refusal beyond the new limit.
- [ ] Preflight real persistent Chrome quota and host free space with explicit
      headroom before the long run; fail closed when either is insufficient.
      Keep the 2 GiB production default and 4 GiB portable archive bound.
- [ ] Record scoped high-risk browser and cold-clone evidence at an exact head,
      with a fresh Daybreak adversarial verdict. Update the live demo for any
      user-visible new capacity and deploy it to the main Pages project.

## Deterministic acceptance

`make verify-E9-T22m` checks the retained original prefix, production browser
retention behavior and negative bounds, and the built demo. Run the same
command once from a pristine clone at the final exact head, pointing
`E9_T22M_DESKTOP` at the authenticated retained prefix by absolute path. The
clone is separate from the normal target so it is run once, on the frozen
submission, rather than during every implementation iteration. This is
distinct from `make verify-E9-T22c`.

## Adversarial verification

Attack an absent or corrupt chunk in the saved prefix, false reachability,
insufficient browser quota, inadequate host reserve, metadata arithmetic near
16 GiB, and publication/cleanup after a rejected append. Check that the
test actually exercises the production store and cannot pass by merely raising
a harness constant. Preserve portable refusal above 4 GiB.

## Verification log

### 2026-10-25 — worker — exact-head physical and pristine-clone submission

At clean source head `f7e82bd94051cb372ee30446c139a51d6980c099`,
`E9_OUT=target/evidence/e9-t22m-submission-f7e82bd94 make verify-E9-T22m`
passed the preflight tests, portable-policy Rust test, exact `web/dist` parity,
production Chrome physical-capacity proof, and built-demo check. The browser
report `target/evidence/e9-t22m-submission-f7e82bd94/exact-browser/report.json`
has SHA-256 `a02e73ecfea261d42ebf99c9611e101b26c367c17aa0e23aa457150ade4dc227`;
the main and post-restart browser traces have SHA-256
`97d6a8ef73f695dc285bf538b012c34c9b18ba1bb7426a1127c72e2d82f61bed`
and `a380ce96b5798284846ad41f7c981903deed4faf64864c16fc506f976f2e8305`.
The demo report SHA-256 is
`20d96797341c793dd392e0bb552b004dfca85be9326dffd22ae30ed661a0c5c0`
(127 passed, 0 failed, no browser or HTTP errors).

The same command passed once in pristine sparse clone
`/private/tmp/e9-t22m-cold-f7e82bd94`, detached at the same exact head with
`RUSTFLAGS`, `RUSTDOCFLAGS`, `RUST_LOG` and all `CARGO_*` environment variables
absent, using `E9_T22M_DESKTOP` pointed at the original retained failed C
prefix. Its browser report SHA-256 is
`49c9665f94d5d59c572031e000e1ef106a1512b04030cd88c5d3483c0c31d060`;
its main/reopen traces are
`6f65ef765a277467566b0225caa1da5d94e817e1a58b18b19b97bbdda7e6f8e7` and
`dcc1953a914a2deb100e7f5ee387d9937d47148af1a1a09f3012536b238a9149`;
its demo report is
`4f19908fe789d1656c2ecc93a3a8ae8f7536892b5d9917b37f1b05aad60676e2`
(127 passed, 0 failed). The clone remained clean after building.

Both recordings independently rehashed all 10,268 chunks of the original
8,589,076,999-byte failed prefix. Through the production writer, each imported
that prefix into real IndexedDB, added 2,049 novel objects, charged exactly
17,179,869,184 physical payload bytes, and observed atomic `RetentionLimit`
for byte 17,179,869,185. Chrome's origin usage exceeded 16 GiB. Collection
removed the newly staged objects and the original 152 orphan chunks, preserving
the exact 2,816-object, 10,116-chunk reachable graph; a new Chrome process
reopened revision 637 and the original manifest hash. Each run checked actual
Chrome quota and host free space with a 1 GiB reserve before staging. A fresh
Daybreak read-only attack of the main recording also inspected the closed raw
IndexedDB files: every reachable original chunk hash was present, with no
leftover new test chunk. That profile was then removed for disk space; its
report and traces remain. Chrome denied `navigator.storage.persist()` on this
localhost origin, so this submission claims durable process restart and real
quota, not eviction immunity; eviction recovery belongs to E9-T23.

`bash tools/deploy-cloudflare.sh` published the exact built bundle to the
production `wasm-vm` Pages project. Deployment log SHA-256 is
`e889111d53befcb023a3cfebb3a6d049bd51c4355c40db9306a26a93e573904a`.
Direct GETs of `https://wasm-vm.pages.dev/` assets `index.html`, `app.html`,
`roadmap.js` and `tasks.json` returned byte-for-byte the tested local bundle;
`target/evidence/e9-t22m-live-f7e82bd94.json` SHA-256 is
`753ea6778fdf4e0f4671acd7b344bc32aaef563b30cc798d77d7f63b477190f2`.
The deploy script's temporary manifest URL rewrites were restored after the
public check. The fresh Daybreak final verdict is still required.

### 2026-10-25 — worker — first physical run found original staging orphans

At clean head `b25990107811c03ff7a64f35ee4886cb3c6e12b8`, the
`E9_OUT=target/evidence/e9-t22m-submission-b25990107 make verify-E9-T22m`
run rehashed all 10,268 saved chunks, restored the real 8 GiB prefix into
Chrome, staged 8 GiB of genuinely novel data through the production writer,
reached exactly 17,179,869,184 charged bytes, and observed atomic
`RetentionLimit` for the next byte. Its cleanup assertion then failed before
accepted completion. Report SHA-256:
`c1ebdd337f2989e70105c18d2216619e5e915bc4f2534f592aeb03a1cc3be7f4`;
browser trace SHA-256:
`dd76daea1e171e9498f1674990a41b6b59b5c0ffe7e0f36576078cbfebd694b8`.
No M acceptance is claimed from this failed run.

Independent inspection of the original saved index found 10,116 chunks
referenced by the 2,816 reachable objects and 152 orphan chunks left by the
failed checkpoint (159,383,552 bytes). A separate read-only reopen of the
failed M browser profile after its GC reported exactly 10,116 chunks,
2,816 objects, payload `8,429,693,447`, session revision `637` and the
durable 16 GiB setting. The cleanup oracle now asserts that reachable graph
instead of the raw staged prefix. The closed failed profile and a
reproducible older T22l browser clone were removed for disk space; their
reports/traces and both original source prefixes remain retained. A new
clean-head full run and cold clone are required.

### 2026-10-25 — planning — exact 8 GiB boundary

The unchanged cold C run at `45beaadaa7b4561b127e77796ea3849f981deedb`
failed at its next 50M checkpoint with `RetentionLimit: saved data byte budget`.
The retained `target/evidence/e9-t22c-submission-45beaadaa/desktop/saved/storage.json`
indexes 8,589,076,999 physical bytes, 10,268 chunks and 2,816 reachable
objects; its separate closure report authenticated the objects. Subsequent
exact graph inspection found 152 orphan chunks (159,383,552 bytes) left by
unfinished staging. Chrome's
origin quota was 19,331,787,395 bytes. The complete failed-run report and
Daybreak's guest-state diagnostic remain under that evidence directory and
`target/evidence/e9-t22c-daybreak-capacity-45beaadaa/` respectively. No
full-desktop acceptance is inferred from this prefix.
