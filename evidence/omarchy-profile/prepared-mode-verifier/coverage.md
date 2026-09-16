# T03ad changed-hunk coverage

Reviewed scope: activation `c3982d3b` through guest head
`545f22ad618fe8f9bd6dea3c4fe4cb6c54cc006e`, plus test-only
`4d3aef8ec125aefe9c00a162619bd9aa0591de36` and worker submission metadata.
No runtime/web/Cargo changes from T03z. The verified claim is the bounded
negative experiment, not a usable prepared pair.

| Changed region | Evidence and classification |
| --- | --- |
| `omarchy-mode-preparation.mjs:8–14` offline options | **Exercised** by R2 runtime receipt and fixed-budget test; physical300s/120s options remain unchanged. |
| `omarchy-mode-preparation.mjs:16–40` header/base/core/gen/delta guard | **Exercised** by the pair guard test's valid fixture and core/base/gen/duplicate/range/truncation/suffix mutations; verifier positive-postprocessor executes it after actual gzip decompression and file hashing. Header-only synthetic RAM is explicitly not guest memory evidence. |
| `omarchy-mode-preparation.mjs:45–62` native terminal pixel ROI | **Exercised** by black/bar/native-position/wrong-position/unmapped/oversize tests and the verifier stale-frame attack's actual pixel callback. This checks native top-left coordinates, consistent with unchanged `web/src/sink/viewport.js`; it does not turn R2's black image into ready evidence. |
| `omarchy-mode-preparation.mjs:64–83` mode/clients/focus orchestration | **Exercised** by R2 through pending-focus timeout. Success and wrong-focus/startup cases are exercised by the helper fixtures. |
| `omarchy-mode-preparation.mjs:84–118` pixel loop, final mode/image, export phase, error/finalization | **Exercised** by success, image-error, export-error and deadline helper fixtures. The stale-frame attack executes the actual serialized pixel function and real wait deadline. R2 exercises actual failure finalization. No success fixture is represented as a real rendered desktop. |
| `omarchy-desktop-live.mjs:27,48–108,406–440` mode admission, owned source/URL/persist flags and closure | **Exercised** by real R1/R2;19 helper hashes independently bind the frozen head. Added usage text, purpose labels and scope-list entries are **waived bookkeeping**. Invalid option guards are direct fail-closed assertions/configuration, no changed runtime semantics. |
| `omarchy-desktop-live.mjs:490–524` owned browser and delivered manifest observer | **Exercised** by real R2; R1 preserves the former missing observer. The actual Chrome fixture extracts both new blocks, verifies the exact response body delivered to the page and rejects trusted keyboard/pointer/wheel events across two navigations. |
| `omarchy-desktop-live.mjs:1010–1116` strict warm capture/body and output paths | **Exercised** by the recorded actual-body fixture, not a duplicate implementation. It asserts pause→persist→two drained samples→save→export, exact warm seed amid decoys, both fixture blocks byte-for-byte, matching base/gen/header and strict no-resume. Running/foreign-seed/stale-decision rejection executes changed failures. The exact DB-selector fixture also covers missing/foreign DB and missing block store. Underlying snapshot persistence implementation is unchanged and carried, not re-proven by these mocks. |
| `omarchy-desktop-live.mjs:1118–1132` separate navigation and pre-start input fence | **Exercised** by R2 and the actual Chrome fence fixture. Parent watchdog test rejects a mode-pair navigation receipt in an input-trial session. |
| `omarchy-desktop-live.mjs:1174–1187` restore/loader/preparation dispatch | **Exercised** by R2 up to the preparation rejection. Callback preparation success/export is exercised in focused actual-helper/body fixtures. Three success-result/return lines are **waived reporting/control glue**: the source returns before all physical-input code, and they cannot grant usable-pair acceptance; actual parent success processing is separately exercised. |
| `omarchy-desktop-live.mjs:1381–1384,1412–1461` early-start failure receipt and owned cleanup | **Exercised** by R1 startup failure and R2 focus failure. Both record normally closed child/browser/client; no watchdog or second context. Added status/error fields are **waived reporting**. Existing fallback kill/error branches are unchanged. |
| `omarchy-prepare-mode.mjs:18–61,83–84` private output, clean env, owned run, identity/input/serial/runtime audit and negative result | **Exercised** by R1/R2. Independent verifier audits reconstruct raw serial and modeset rather than trusting this wrapper's result. Owned-watchdog failures are tested in the helper; unchanged process/file boilerplate and receipt fields are **waived bookkeeping**. |
| `omarchy-prepare-mode.mjs:62–82` positive audit, compressed file checks, decompression/validation and personal-view gate | **Exercised** by `positive-postprocessor-fixture.mjs`, which extracts these actual lines and uses tiny explicitly synthetic gzip files. It asserts the actual output remains `prepared-pair-awaiting-personal-image-verification`, `usablePair:false`. It makes no whole-RAM or guest-image claim. |
| `omarchy-owned-trial.mjs:3–7,41–53` fixed offline phase and allowance isolation | **Exercised** by R2 normal close and deterministic watchdog test:1110000ms only for mode-preparation, no rearming, no combination with post-verdict capture, wrong phase rejected. Existing physical watchdog remains530000ms before any explicitly separate post-verdict allowance. |
| Changed test fixture bindings/selector extraction | **Exercised** by the exact-head48-test run. The cold and physical-input fixtures still execute their actual source paths with new mode flags false. No disabled/ignored tests were introduced. |
| Task/queue, recording scripts, frozen hashes, artifact receipts and logs | **Waived metadata**, independently checked against committed source/actual bytes.21 corrective artifacts and17 R1 artifacts match. No claimed execution comes merely from labels or worker prose. |

## Evidence boundary

Actual smaller scanout adoption and actual black display are proven by R2.
Confirmed smaller-mode focus, a nonblank terminal, export and an actual coherent
prepared pair did not occur. Those are **needs-evidence for any future positive
claim**, not silently waived as successful here. The negative branch is an
explicit acceptance outcome for this task; no repeated guest is demanded just
to cover its synthetic harness success branches.

No full workspace, cold-clone or deployment checks are warranted for unchanged
runtime and private local harness work. No implementation source was edited by
this verifier.
