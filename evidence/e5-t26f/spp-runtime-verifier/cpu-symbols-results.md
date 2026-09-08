VERDICT: verified

Verified only the bounded offline sampled attribution below. **F remains unverified and its
CPU diagnostic timing remains FAILED.** No source-candidate or causal/speedup verdict is made.

## Prediction and checks

CP7–CP10 were frozen before mapping inspection in the `cpu-plan.md` extension, digest
`46892f86d4ff62ff19b62c7b267d9f3938499e67f5f58c8a87254bd632e0952a`;
`cpu-symbols-plan.md` records that chronology. No predictions were rewritten after inspection.

Command: `node evidence/e5-t26f/spp-runtime-verifier/cpu-symbols-audit.mjs` — exit0.
It checks actual profile bytes, authenticates all eleven non-custom WASM sections using the
held binder, and independently recomputes every self/inclusive row against both held
`summarize` and Luna's summary. Result SHA-256:
`5ca38c7abca9bbfc2b5886514cb908b26ef6f107d916237f451d1eda150fc329`.

CP7 HELD: executable section IDs `1,2,3,4,5,6,7,9,12,10,11` have identical complete payloads;
1890 function names match. Named companion SHA-256:
`372815edf3bb6a1f72d770d7796353836b87df48c61acb9fb8168e72c1810116`.
Served release: `84b2c17c9b6ab9d86c85912f82bd0b4b4533178fc27a0724d47565cb40974b4d`.
Prior scoped checks authenticated existing Rust input
`89bf2f0ad3306efbf42aaaa0b54dda5aada6110f361d939b3eeca2c300323c2d`, gzip round-trip and
before/after/source pins; no generation was repeated. Luna summary SHA-256:
`cd03d968f470897f30b6bb117f3b63af5bc45c927f26b819a6f384bef8e7b4bd`.

CP8 HELD: profile SHA-256
`21e222eda13169d922c4f1d4135446cd7b6de84b97cc31f2cb7c7afe123e708a`;
2608 samples, denominator **3260775µs**, not nominal sampling interval, hitCount, profile
duration or F elapsed. `sync_plic` function410, nodes13/48, has self/inclusive208905µs:
**6.406605791567955%** of sampled weight. This is not6.407% of F latency.

| Self-frame class | Samples | µs | Share |
| --- | ---: | ---: | ---: |
| Authenticated indexed release | 2495 | 3119632 | 95.671% |
| Unmapped generated WASM | 90 | 112301 | 3.444% |
| Runtime/synthetic | 12 | 15018 | 0.461% |
| JavaScript/other URL | 9 | 11309 | 0.347% |
| Literal release bridges | 2 | 2515 | 0.077% |

Categories conserve samples/weight. Only exact release-URL indexed functions receive names;
41 sampled generated-module URLs remain unmapped. Four raw bridge nodes remain literal;
the served bridge has two self samples/2515µs. Inclusive rows overlap. The hitCount2607 versus
samples2608 discrepancy remains unrepaired.

CP9 HELD with accepted limit: failed preprocessing recorded the wrong baseline hash and no
commands. Original failed script is **NOT RETAINED**; its labeled reconstruction is NOT ORIGINAL.
No reproduction was demanded or executed.

CP10 HELD boundary:4023.1999999284744ms still exceeds2000; partial worker sampling cannot
identify F's cause or predict a PLIC change's speedup. No candidate was reviewed/activated.
Final HEAD remains96ecb801fdf8b67af75cd150db82d115bcf046cd. Runtime, seal and originals untouched.
