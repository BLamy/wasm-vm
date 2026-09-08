# E5-T26m — interrupt-only inline-cache context changes

Status: implementation in progress; no task verification or speedup claim.
Task: `tasks/epic-5-the-window/E5-T26m-inline-context-interrupt-bits.md`.
Activation commit: `aa03fe85933e9b9730bb747d903bba57c9b13f36`.

The only proposed product change is excluding mstatus bits1/3/5/7 from the
browser inline-cache comparison. Live architectural status, all other cached
authority inputs, interrupt sampling, translator support and chain budgets stay
unchanged. Luna owns code/tests; fresh Daybreak owns adversarial review. Main
coordinates frozen gates, the built-page proof and the single final clean clone.

Preflight: `../e5-t26f/inline-context-candidate/critic-preflight.md`.
Predictions made before worker evidence: `verifier/plan.md`. Both forbid causal
attribution of the existing timing failures or claiming F passes from this task.

Prior closed layers remain distinct:

- PR368, `0c9abdac4e4dcde60eb4815b3fab0fa2d629c25b`: observer correctness and
  actual restore/audio evidence hold; original4.362200-second endpoint fails.
- PR369, `f8ac2c99f5f6bc5f9941fca75af9af5afac32343`: the single print-only
  counterfactual fails at4.101870seconds and is closed. No repeat or promotion.
- Its separate existing guest-PC sampler reports many compiled-engine entries
  and few dynamic-link hits, but does not isolate context invalidation as a
  cause. Kernel-PC labels and all sampling limitations are retained there.

The current task changes an execution-cache boundary, so its final source must
earn its own scoped native/actual-WASM regression proof and built-page screenshot.
Unchanged older tasks and guest-image/C-observer proofs are carried, not rerun.
After this task is independently verified, F still requires fresh exact-runtime
browser evidence and its unchanged two-second, restore/drag/input/audio criteria.
No merge, production release, Omarchy mutation or Epic6 work is authorized by
completion of this prerequisite alone.
