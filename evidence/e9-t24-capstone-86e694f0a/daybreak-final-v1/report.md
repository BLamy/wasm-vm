I’m beginning the fresh final verifier pass under the stated cold-scope waiver. I’ll first orient on the complete policy, task, exact task diff, current-head metadata-only delta, and PR state; before each evidence/state inspection I’ll record a falsifiable prediction in the verifier scratch log. I will not use nested reviewers, Actions, rr, ssh dev, deployment writes, or any waived cold/performance workload.

Orientation prediction O1: the repository policy and T24 task will classify this as a high-risk, separate-session final verification with status `implemented`; the exact `1d3976…86e694` diff will be limited to capstone verification/docs/test-harness and shipped-site artifacts, while `86e694…93ca76` will contain only the task/queue plus portable worker evidence—no runtime implementation or package-byte changes. I’ll now test that prediction against the full files and complete name/status/diff content.

O1 HELD: T24 is high-risk/implemented; the task range changes no runtime Rust/worker implementation, and the post-recording delta names only the portable report/index plus task/queue metadata. The large recorded-input fixture is declarative evidence, so I’ll parse every record structurally and hash it rather than treating 2,114 JSON lines as executable code. Next prediction O2: complete hunk review will show the only behavioral changes are verification controllers/oracles and small workload harness instrumentation; they will preserve failure/cleanup guards, exact source bindings, and explicitly cover happy, refusal, cancellation, selector, and retention paths without weakening product guards.

The controller review so far confirms fail-closed source/head/dirty checks, immutable inventory hashing, bounded carry-forward, process-group cleanup, fresh persistent profiles, native-byte comparisons, zero-egress routing, and explicit guarded GPU interior capture. Because combined output truncated, I’m not treating O2 as decided yet; I’ll inspect the four harnesses in bounded line ranges and the exact upstream GPU/Rust/build-closure hunks before evidence.

Prediction O3: native PR 625 will be a draft with base PR/branch 624, head commit `93ca76…`, and all 47 stack PRs will remain OPEN/unmerged. A failure of any of those facts is a final-scope finding.

O3 HELD exactly. O2 is now substantially supported: the GPU recorder requires a non-software identity, records real native states, enforces static replay assets/zero sockets, and independently reconstructs the 1 GiB RAM chain and renderer/native/witness commitments; the final UI harness creates empty profiles, hydrates only source, imports without fixture/cache, uses visible controls, and checks exact native bytes. I’m now checking the upstream incremental-ancestry/full-RAM repair and build closure.

Prediction O4: the relevant upstream repair will seed a full RAM image only from a valid full ancestor, apply deltas in ancestry order with strict parent/size/hash checks in JS/Rust, and its built `web/dist` closure will be byte-consistent; it will not permit an incremental checkpoint to masquerade as a full seed.

O4 is HELD for the replay worker hunk: it resolves the authenticated delta ancestry, binds the full base to its checkpoint and renderer, seeds RAM from that full frame, applies ordered delta chunks with page-count and RAM-digest checks, binds each partial frame, and supplies the reconstructed RAM digest to replay. The source/dist worker files carry the same logic and the build stamp is generated from the actual closure. I’m checking the Rust seeding/apply contracts and byte identities next, then I’ll authenticate and interrogate the indexed originals.

Prediction P1 is now active: both portable evidence digests and every indexed original artifact will hash exactly, with no missing/symlinked substitutions, and the reports will bind to 86e rather than merely the metadata head.

The runtime byte pins match exactly: normal Wasm `00159a…`, stamp file `ac6784…`, generated build ID `8a6b47…`; source and dist replay workers are identical. Rust only seeds a fresh exact GPU candidate with no driver/sources and applies RAM deltas only to an admissible exact candidate, so O4 HELD end-to-end.

I’m hashing all 529 indexed files now, including the large retained ext4/native/CAS artifacts. This may take a little while; it is the identity gate before trusting any report fields.

P1 HELD: all 529 indexed files (3,711,194,150 bytes) match their declared sizes and SHA-256s, every component inventory is exact, no indexed file is a symlink, and the portable reports bind code head `86e694…`. I’ll now interrogate concrete original state rather than summaries.

Prediction P2: the software report/oracles will independently agree on exactly 100 UART schedule entries, 10 owned HTTP exchanges with literal 1,024-byte body equality, real `/root/e9-session` file values, final/replay native digest `1a46f5…`, exact position equality, and replay egress `{fetch:0,sockets:0}`.

P2 HELD. The independently re-run wire oracle decoded 113 network events into 10 distinct TCP exchanges, each with one independently hashed 1,024-byte body; the Linux report has 100 scheduled UART offers and final/replay position `(516777216, 516731181, seq 853, before, ordinal 2)`, identical 27,892,012-byte native digest `1a46f5…`, and zero replay fetch/socket egress. The independent ext4 oracle reads `state=e9:after`, fixed entropy, and the tenth HTTP body identically from final and replay.

Prediction P3 is active: the GPU original bytes will prove real `ANGLE/Metal` on Apple M4 Max (not a relabel), one full plus three incremental checkpoints, two incremental-start windows and terminal tail, exact native/RAM/CAS/witness parity, a literal green 16,384-byte readback, and the expected command-error marker without weakening final-frontier continuation guards.

P3 HELD. The retained profile is exactly `ANGLE (Apple, ANGLE Metal Renderer: Apple M4 Max…)`; saved CAS contains `WVGPUB01` plus three `WVKEYF01` deltas; both replay windows start incrementally and the tail reaches transition 690000/retired 689834/seq 38. The independent oracle reconstructs 1 GiB RAM and binds 50 CAS objects, five witness pages, native/renderer/RAM digests, and literal green readback. The guest serial retains `SESSION_EXPECTED_GPU_ERROR_1205` while final inspection and green output succeed. Production guards remain intact: branch capture requires `canContinue`, stable selected identity/position/console/source digest, and inspection does not relax continuation/frontier state.

Prediction P4: the v4 bundle report will show four successful real archive round trips plus each named refusal/cancel/closed-refresh path, with no published partial session and independent native/archive parity.

P4 HELD after correcting the cancellation predicate to the report’s actual field (`retained:false`, not a generic `preserved` flag): four archives import through empty persistent profiles; source/import native digests match; 60 malformed/archive/native attacks fail before writer calls; quota fails and reclaims its orphan; pre-authorize cancellation publishes nothing while commit-durable survives; underreported GPU host limits refuse; closed refresh/GPU preview preserve original state and DOM. The independent archive parser confirms complete closure and byte equality for all four.

Prediction P5/P6 is active: the final live two-profile report, deployment receipt, 14-asset manifest, and live demo report will match their authoritative hashes and show exact source/import middle/+1/final state, physical GPU bindings/green pixel, empty profiles, zero errors/blocked network, deploy exit 0 with clean restored source, and 127/0 on main.

P5/P6 HELD on authenticated originals. The production UI evidence records empty source/import profiles; visible keyframe-go/forward/back; software middle 250,000,000 and +1 parity at 20,181,054 bytes; GPU middle 20,000 and +1 guarded capture parity; final software `1a46f5…` (27,892,012 bytes), final GPU `a4cd6f…` (8,047 bytes), and green `[0,255,0,255]`, with no errors or blocked requests. Deployment exited 0 and restored a clean 86e checkout; all 14 declared public assets and demo 127/0 are authenticated.

I’m adding my own bounded read-only production check now. Prediction: fresh cache-busted GETs for all 14 production assets will still match the recorded hashes and sizes, and the live guide will still state the bounded/waived boundary. No deployment or site write will occur.

The fresh production byte check HELD for all 14 assets. A redundant fifteenth guide fetch without the verifier User-Agent was rate/edge-rejected 403; this does not affect the already successful authenticated guide fetch in the 14-asset loop. I’m rechecking the three scope phrases from the exact live guide bytes with the same bounded request headers, then moving to incremental Daybreak/failure preservation.

Fresh production is confirmed: all 14 cache-busted GETs match the recorded bytes, including current Wasm/stamp, and the live guide hash `96baade…` explicitly says bounded accelerated guests while deferring full Omarchy cold boot and the original performance campaign.

Prediction P7: readiness v5 will remain honestly FAILED solely because GPU interior `inspectSelected` invoked `exactReplayFrontier`; its completed software half will retain exact middle/+1/final parity. The independent interior diagnostic will authorize only guarded continuation capture, reject guard relaxation/fake final checkpoints, and v6 will pass at 86e with the exact GPU sourceDigest/position/native parity.

P7 HELD exactly and incrementally: v5 remains failed only on the GPU frontier diagnostic after a valid visible step; its software case has immutable 20,181,054-byte middle/+1 parity and 27,892,012-byte final parity. The independent Daybreak diagnostic authorizes only guarded branch capture for GPU interior steps and explicitly forbids frontier/private/failed-job relaxation or a fabricated final checkpoint. v6 at 86e passes the missing GPU proof with source/import position, sourceDigest, renderer, pixel, and native parity.

Prediction P8: the carried T23 verdict digest/root and runtime pins will match; prior clone artifacts will preserve their exact FAILED/PARTIAL labels and not be presented as a full passed clone/browser/capacity gate.

P8 HELD within the allowed carry-forward boundary. The T23 top report still hashes `99b50f…`; the normal Wasm/stamp/build bytes are unchanged, and `git diff d653…86e` is empty across the runtime/package paths. The T23 pristine verifier log still ends `status: failed` after its own builds because loopback was EPERM; the T24 worker report explicitly labels that clone proof partial and the older f6ef capacity gate failed, so neither is relabelled as a passed full clone gate. The authoritative T23 final verdict/root are carried as supplied (`dffece…`, `root01a18427…`) across that unchanged boundary.

I’m moving to changed-hunk sufficiency, the required independent bounded attack, and sabotage. Prediction O2/COVERAGE: every claimed executable hunk will be hit by v2/v4/v5/v6/final-production evidence; only declarative/generated docs and fail-closed exception-only arms will need narrow waivers. No ignored test, disabled assertion, or runtime semantic weakening will appear.

Coverage is holding: v2 executed the direct recording paths and both independent oracles; v4 executed immutable-input inventory carry-forward, controller/source sealing, policy/fmt/docs/guest-fastboot, shipped UI, four-archive matrix, and cleanup; v5 executed the failure-state capture/cleanup arm; v6 executed the GPU selector and guarded interior-capture branch; final production executed both profiles and the `--url` branch. Docs/dist/roadmap are declarative/generated and were built, hash-matched, and rendered live. The 404/path-containment and trace-stop exception arms are narrowly waived as fail-closed harness protection, not product behavior. No ignored test or disabled assertion appeared.

For the bounded novel attack, I will use an independent GPU position not used by v5/v6/production: checkpoint `point-0` at transition 10,000, then visible +1/back in fresh source/import profiles. Prediction P9a: source/import at 10,000 will bind digest `b94f031f…`; +1 states and guarded sourceDigest/native bytes will match independently; back returns exactly; final remains `a4cd6f…`; zero blocked/error requests. A scratch-only harness selector change will be used; original indexed evidence and repository sources remain untouched.

The novel run failed before any app state was created: Chrome launched and immediately closed during `launchPersistentContext`; the preserved scratch report contains the browser lifecycle error and no product assertion ran. I’ll retry once with a fresh output/profile, which is within the bounded attack and does not alter evidence. If launch fails again, I’ll use an independent raw-state/CAS oracle at point-0 instead and report the browser attempt honestly.

Both fresh browser retries failed at Chrome process startup before navigation, so they are preserved as environmental launch failures and not treated as product evidence or contradiction. I will not keep retrying.

I’m substituting the bounded independent raw-state attack at the same novel coordinate. Prediction P9b: for `point-0` transition 10,000, independently hashing `wasm-vm-gpu-guest-state-v1\\0 || u64(len) || native || ramDigest` will equal immutable digest `b94f031f…`; flipping one native byte in memory will not equal any declared point digest. This directly attacks the CPU/RAM/device binding without touching originals. Then I’ll sabotage the new paged oracle using a scratch evidence copy with a one-byte visible-pixel mismatch; prediction P10a: the oracle exits nonzero at its explicit pixel equality guard.

The indexed originals, production artifacts, independent wire/RAM/archive oracles, and the bounded GPU sabotage all held. I’m at the final deterministic gate and metadata step now; the attempted extra browser attack was blocked only by local Chrome exiting before navigation, so I substituted an independent point-0 state mutation attack, which the cryptographic binding rejected.

One gate invocation stopped on a verifier typo—there is no `e9-capstone-bundles.py`; no product check ran or failed at that point. I’m correcting the file list from the actual diff and rerunning the complete narrow gate.

All current narrow source gates are green: JS syntax, Python AST parsing, Rust formatting, the 82-file runtime build closure, five build-closure tests, and all 13 loader fail-closed tests. Correctness and changed-hunk coverage now support acceptance; I’m recording the verifier’s predictions, waivers, sabotage result, and suite disposition before changing status.

The task is now marked verified, with all five acceptance criteria checked. Policy passed before queue regeneration (`active=none`), and the queue rebuilt to 554 verified tasks. I’m doing the final mutation audit now: only T24 and its generated queue entry may differ, original evidence must still hash exactly, and every PR must still be open.

Final mutation audit is clean: only the T24 record and generated queue changed; the sabotaged original report still matches its indexed SHA; PR 625 remains draft/open and all 47 PRs remain open. The repository sandbox denied `.git/index.lock`, so the verified metadata is intentionally left as two uncommitted files for the parent to commit mechanically—nothing was pushed or merged.

VERDICT: verified

Final acceptance is recorded in [E9-T24 task](/Users/blamy/Documents/Codex/.e9-t14-cold-proof-local-9d4b3905/tasks/epic-9-session-time-travel/E9-T24-capstone-local-time-traveler.md:108), with:

- Authenticated 529-file, 3,711,194,150-byte evidence inventory.
- Software Linux input/file/network replay with exact native-state parity and zero egress.
- Real ANGLE/Metal Apple M4 Max bounded-GPU proof, including independent CAS/RAM/native/readback oracles.
- Four archive round trips and cancellation, retention, quota, malformed and host-refusal coverage.
- Actual `https://wasm-vm.pages.dev/` two-profile production proof and fresh matching of all 14 public assets.
- Hunk-by-hunk coverage, independent point-0 mutation attack and successful oracle sabotage.
- Current formatting, syntax, build-closure and 18 focused tests passed.
- Human-waived full Omarchy cold/performance qualification remains explicitly unproven.

T24 is `verified` at [line 6](/Users/blamy/Documents/Codex/.e9-t14-cold-proof-local-9d4b3905/tasks/epic-9-session-time-travel/E9-T24-capstone-local-time-traveler.md:6), and the regenerated [queue](/Users/blamy/Documents/Codex/.e9-t14-cold-proof-local-9d4b3905/tasks/QUEUE.md:494) reports 554/754 verified. All 47 PRs remain open; PR 625 remains draft/open.

The sandbox denied creation of `.git/index.lock`, so the two metadata edits remain uncommitted for mechanical parent commit. Nothing was pushed, deployed, or merged.
