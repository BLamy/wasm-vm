# E5-T26f diagnostic-completion results

**VERDICT: HELD for all six preregistered diagnostic-completion predictions; F timing remains FAILED.**

This adjudicates only the predictions frozen in `completion-plan.md` SHA-256
`e5b2a163335b53ffc018e575e1cee6ff624ce3a73c0ba14aad18e8c3298be764`.
The completion is supplemental functional coverage, not F acceptance or verification. The prior
browser and CPU verdicts remain unchanged, no `fVerified:true` is present, and normal full F is
still required.

## Prediction adjudication

1. **Binding and classification — HELD.** The invocation binds HEAD
   `415db223733214b6c6e7b69b0ad331150969be56`, `acceptance:false`, reuse plus
   `DIAGNOSTIC_COMPLETE=1`, and no CPU/JIT/residency/clock/latency/command/ICount selector
   (`completion/invocation.json:2-18`; `diagnostic-completion.json:15-34`). I independently
   rehashed all 20 source bindings: both production WASM copies are the preregistered
   `a3ce02529ae2e6ec175066f4c838451ca7d1472b5f6bd2f5b2d5cbff805c8b42`, helper is
   `5807b908fc1bd84ff19c96e269df6b69ac86d3a62412a032f476dc8ea7f581d9`, and the image itself
   independently hashes to
   `d2fc4eab9bc1b5fe528a2956b58faefb20fcf18e2505c499ecafa8824d390f72`
   (`completion/invocation.json:19-39`; `diagnostic-completion.json:35-79`). The exact driver is
   `ac9d229652a0a2208e0a39e88feb25ff707be88cfc61fb0a1454fa057626e82f`.

   The fresh-copy predicate is a launch-time predicate: the rehashed inner runner refuses a
   changed sealed baseline, creates a new iteration, copies it, and verifies the copied tree before
   launch (`tools/verify/e5-t26f-browser-roundtrip.mjs:232-239`). The closed record identifies new
   `iteration-t8y28a/profile`, equal creator/current heads, and initial profile digest
   `e6df3a0abc0f65583a74d6cc7e43a4226022e7297fc0f4c2067d099bc168f8dc`
   (`diagnostic-completion.json:80-85`). I independently rehashed the still-sealed 816-entry
   baseline to that digest and decoded its 2,810,500-byte envelope to the held snapshot digest
   `e53e5a3936ef2d35e6ae5e09676dba51cfc59d63ed37dbc56c94998810e6ac9f`. The launched copy
   legitimately accumulated browser-profile files afterward; no post-run equality is claimed.

2. **Normal restore coherence — HELD.** The restore is whole-machine `resume`; saved, restored,
   receipt, and current overlay generations are all 628. The receipt says `attempted:true`, the
   coherence audit is `passed`, and `normalRestore.functionalChecksPassed` is true
   (`diagnostic-completion.json:237-258`, `:307-310`). Browser presentation errors are empty
   (`:260-305`).

3. **Original cap retained, then rethrown — HELD as a cap failure.** Original boundaries
   1126.2799999713898 and 5182.024999976158 independently subtract to
   **4055.7450000047684 ms**, exactly the retained value and greater than the unchanged 2,000-ms
   limit. The retained error is the exact `ERR_ASSERTION`, with `actual:false`, `expected:true`,
   and operator `==` (`diagnostic-completion.json:445-478`). The completed report preserves
   `acceptance:false`, `functionalChecksPassed:true`, `timingPassed:false`, and
   `checksPassed:false` (`:2-8`); after writing it, the log rethrows the same assertion at runner
   line 1930 (`completion/run.log:1463-1478`). Child exit is 1 with no signal
   (`completion/exit.json:1`). This remains the F failure; no speed or cause is inferred.

4. **Drag checkpoint chain — HELD.** Before, held, moving, and released snapshots are all present
   with valid SHA-256s and observed generation 628. The measured and paused translations are both
   80 px, the moving snapshot is persisted and paused, and both its Published and BeforeReload
   frozen audits pass with the same envelope SHA and generation (`diagnostic-completion.json:504-601`,
   `:603-623`). The run log places every drag phase after `timing-failed-continuing`, so these are
   later functional observations, not extensions or repairs of the original interval
   (`completion/run.log:29-50`).

5. **Second reload and restored release — HELD.** The second restore uses the moving snapshot SHA,
   reports `fullRepairFrame:true`, reproduces CRC `ab6a2f0d`, contains fetching/instantiating/
   restored but no `booting`, and passes resume coherence at generation 628
   (`diagnostic-completion.json:624-701`). Its display and functional flags are true while
   `checksPassed` remains false solely with the retained timing result (`:703-753`). The guest
   release audit passes: pointer frames advance 0 to 1 with no held buttons; rendered point
   `(669,55)` matches the requested point, the titlebar remains unchanged, and observation continues
   1022.6449999809265 ms after acknowledgement (`:755-810`, `:1018-1084`).

6. **Closed completion evidence — HELD.** The final report has schema
   `wasm-vm.e5-t26f.diagnostic-completion.v1`, functional true/timing false/checks false, and complete
   empty browser and HTTP error arrays (`diagnostic-completion.json:2-13`, `:1393-1397`). The server
   transcript has only the policy-permitted favicon 404s. Both inspected PNGs are consistent with
   their stages: the timing capture preserves the pre-continuation failure screen, while the final
   completion capture shows the restored moved desktop, completed resident playback, and no visual
   contradiction. This changes the formerly deferred coherence/drag/second-reload/hover/error-array
   phases to HELD for this diagnostic coverage only; it does not change F's failed timing verdict.

## Immutable artifact anchors

- `completion/invocation.json` — `fe714e9dd74809df5493b630222e239affe41b9d5fb121943067eaefb4b843be`
- `completion/exit.json` — `0cf195d64edfa93e108082da543b5fe976bc4709e8021c314b822c486255c3d7`
- `completion/run.log` — `3408403b4c9a37f2c6ed0f7ba36d294368ce8e27c0a48626e95e16c01d2c8116`
- `record/diagnostic-completion.json` — `3aa6d97fc51ece6422e6b04a886ffc124c29f7be6458258169e65ac8ef1ba529`
- `record/diagnostic-completion-server.log` — `ee595af885dff8b3acbbcfcac4b9b4516e4e4e3e2cd57dc4759323d0622eea46`
- `record/diagnostic-completion.png` — `cff33549333f1301d593c37dfd30cba4ac0224e233c1f34ea8d8d6e510547e2e`
- `record/diagnostic-completion-timing.json` — `304d63c00f6ccfaeebb2d51a0ff61e056acb23b934591433b83e9ce4d0f890cd`
- `record/diagnostic-completion-timing-server.log` — `370f5332a613bbc3dc7d296f55f4a36d49efb3b988fca0efbd4ec7bef303273f`
- `record/diagnostic-completion-timing.png` — `6a8e71708be3c13112b517f13c68994e871661f9bf49d9af9ec23346ceca6105`

No task status, runtime, harness, source, test, or git state was changed; no suite promotion follows
from this diagnostic.
