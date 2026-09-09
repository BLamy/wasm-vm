# Closed existing guest-PC sampler on the current observer fixture

Command: `node evidence/e5-t26f/single-process-guest-profile-001e8086/run.mjs`.
Producer001e8086, original05b sealed desktop, fresh iteration copy, unchanged
installed C/helper/image and served runtime. This is NOT the derived quiet
snapshot. Only existing `E5_T26F_DIAGNOSTIC_GUEST_PROFILE=1` is enabled;
no command/pacing/JIT/cache/clock override, no new runtime instrumentation.
Child exits1 at the unchanged deadline:4427.939999938011ms. Outer0 retains a
valid negative diagnostic, never F acceptance. Raw SHA256
`00017cc094794aacacaa3f4ba993015f335eec11e3ac12cdadb39ec3b7db45ce`.

The existing sampler observes interpreted guest-virtual PCs without PID/ASID,
excludes JIT retirements, and keeps a lossy cumulative top10. It also enables
existing entry-cost timing; the duration is not an unprofiled speedup comparison.
Profile and JIT endpoint RPCs are sequential, not atomic or exact T0/end samples.
After:29036 cumulative samples,1270 collisions,854314 walks. Four kernel-entry/
return regions total1956samples (6.736% of cumulative interpreted samples), not
that share of host time. No static observer-text address appears in the top10;
absence is not zero execution or proof the observer is cheap.

Actual kernel Image SHA256
`af7c4e471ed4dabdbe5a2717d81cc034b511d2b0f7706de66ad9e84e078c7cce`
matches the raw binding and recorded E5-T05b artifact pair. System.map SHA256
`902e3241fbf86bad7f1b45b62cdfbaf2777dd1c53097296f5bdbd0124ec03290`.
`python3 tools/symbolize.py releases/kernel/6.6.63/System.map` with the six
kernel PCs in kernel-symbols.txt maps nearest symbol starts. Tool SHA256
`6aae607bacacea7fb996ecc0b37cc7c3aefef376b2421477a5b70b0afc44c92a`.
64-byte regions can straddle symbols; nearest-start labels are not whole-region
function attribution. User-address ranges have no authenticated process map
in this run and remain unnamed.

Existing validated JIT endpoint deltas:46479903 guest retirements,
18090931 JIT retirements,1316919 engine entries,3318048 direct-chain entries,
502691 dynamic attempts/20838 hits/481853 refusals,345566 installs,
543 submitted members,231 retranslations and84 evictions. These are aggregate
counter differences, not unique PCs or measured causes. They motivate examining
frequent cache/chain invalidation, but do not establish why links were refused
or predict the benefit of any proposed change. Source review, a deterministic
regression and new real-browser evidence are required before promotion.
