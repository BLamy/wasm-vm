# Post-capture desktop screen — timing failed

Producer `415db223733214b6c6e7b69b0ad331150969be56`, after independently
verified E5-T26p (PR376). Command:
`env -u RUSTDOCFLAGS node tools/verify/e5-t26f-browser-single-process-observer.mjs`.
Cold0/reuse1/outer0 preserves a diagnostic failure; it is not acceptance.

Original restore T0 `1146.9800000190735`, frozen end `4738.945000052452`:
**3591.9650000333786 ms > 2000 ms — FAILED** at runner line1930.
Raw `reuse/failure-post-restore-interaction-checks.json` SHA256
`1d64b878e1bb426d22dfb94eb75e45dd727dfeb061d36674ae3a7e15c304c90d`.

## Identity and reached evidence

- Release WASM `a3ce02529ae2e6ec175066f4c838451ca7d1472b5f6bd2f5b2d5cbff805c8b42`.
- Runtime tree `21dce9b435890a40278d8935800accbccc0d0c3d59676fe3ce6b47d136471926`.
- Held image `d2fc4eab9bc1b5fe528a2956b58faefb20fcf18e2505c499ecafa8824d390f72`.
- New snapshot `e53e5a3936ef2d35e6ae5e09676dba51cfc59d63ed37dbc56c94998810e6ac9f`,
  2,810,500 bytes, saved/restored first-present CRC `fe94d179`, generation628.
- Retained root
  `/var/folders/nr/cyvk1qc14jj5c081vj1xts000000gn/T/e5-t26f-single-process-observer-Us7LU1`.
- Origin `http://127.0.0.1:61637`; full browser/source/image/profile bindings
  and commands remain in `invocation.json`, cold records and reuse raw output.

Main viewed both `cold/resident-prepared.png` and the failure PNG. The same
prepared PID1000/start30070 appears in pre-1/pre-2/post observations. Physical
`play` records ten matching keyboard/DOM edges, 5749 changed pixels and the
conditional green completion marker. The cursor is rendered at684/392,
hotspot1/1,94 matched pixels, observed774.840ms after T0.

Post-restore audio writes1440 fresh frames; all1440 inspected frames are
non-silent. The audio context is running, unlocked and attached. Immediate PCM
observation is at4704.780ms page time and attachment observation4736.920ms;
these do not establish unsampled first-arrival times. Later coherence,
drag/second reload and complete failed-reuse browser/HTTP error arrays remain
unproven after the unchanged cap failure. F stays unfinished.

## One separate CPU diagnostic

`node evidence/e5-t26f/single-process-observer-415db223/run-cpu.mjs` uses the
existing read-only profiler on a fresh copy of this same head's closed profile.
The driver preserves every original source binding before/after and adds pinned
profiler/JIT/served-WASM/driver identities. No JIT selector, command, clock,
budget, image or endpoint is changed. CPU child1/outer0 retains another cap
failure, **3820.9800000190735ms**, not an acceptance or causal speed comparison.
Raw SHA256 `72e3464f25207800b789a1165c2718357eb1cd57620efdb9aafe22f20a4800da`.
Profile `cpu-default/record/interaction-cpu.json` SHA256
`bff1fb08d40163cc40805dfffd548158d154b41355b75564c6e3e0b8bbf6bbbc`,
2050 samples,3054874us summed sample weight. The profile covers only its recorded
partial interval; it cannot localize inlined work within a sampled function.

Existing `tools/verify/e5-t22c-symbolize-cpu.mjs` binds this profile using
`web/pkg/wasm_vm_wasm_bg.wasm` and the already-authenticated
`evidence/e5-t26p/release-candidate-r1/named.wasm`; no rebuild or second boot.
All11 non-custom sections match and1876 names are recovered. Named digest
`0e99527f97e665b98a5f7fe5710d2075818e4f9f0875aa51ef746894f66ee44f`;
summary `cpu-symbols/cpu-summary.json` SHA256
`becae6c2c18aa0f8f2427a10e075f4af5ce71ad394ca86b10335e14f2063aa4a`.
The named artifact is losslessly archived in P's committed evidence; follow
its `packed-artifacts.json` to reconstruct the cited raw filename.

Largest self weights are Machine.run20.47%, BrowserExecutor.execute_with_budget
9.85%, Hart.execute7.64%, translate_cached6.72%, and BlockDiscovery.on_block_entry
6.45%. These are sampled attribution, not a proven cause or promised speedup.
Independent reviews are under `../capture-runtime-verifier/`.

## Later functional phases — pass, original timing failure retained

`node evidence/e5-t26f/single-process-observer-415db223/run-completion.mjs`
invokes the existing `DIAGNOSTIC_COMPLETE=1` path on another fresh copy of the
same closed checkpoint. It does not change a clock, policy, command or limit.
The original interval is `1126.2799999713898` to `5182.024999976158`,
**4055.7450000047684ms >2000ms**. The same assertion is retained before
continuing and rethrown after writing evidence; child1/outer0 is diagnostic
failure retention, not F acceptance.

`completion/record/diagnostic-completion.json` SHA256
`3aa6d97fc51ece6422e6b04a886ffc124c29f7be6458258169e65ac8ef1ba529`
records `functionalChecksPassed:true`, `timingPassed:false`, `checksPassed:false`,
`acceptance:false`. Both normal and drag coherence audits pass at generation628.
All four drag snapshots are recorded. The real titlebar moves80px and stays at
that translated position while paused; the persisted moving snapshot is
`aaa029fa9347873e4626b281855f607fd133a216cb8c5c102c51052da936885a`,
2,947,491 bytes, CRC `ab6a2f0d`. The second reload restores those exact bytes/CRC
without booting, and the stationary-hover check observes the released guest
pointer without a stuck drag. Complete browser/HTTP error arrays are empty.
Main viewed the completion PNG, SHA256
`cff33549333f1301d593c37dfd30cba4ac0224e233c1f34ea8d8d6e510547e2e`.
These reached functional checks supplement the original screen; they do not
erase its failure or establish the two-second performance claim.

No runtime change occurred during either recording. Any later HEAD/runtime
change invalidates this seal for a new run; never rebind it. No merge,
production deployment, Omarchy mutation or Epic6 work is claimed.
