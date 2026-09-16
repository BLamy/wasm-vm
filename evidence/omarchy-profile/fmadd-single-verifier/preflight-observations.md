# Pre-freeze observations (not final verdict)

The five native tests in `native-first.log` pass against the source hashes in
`native-first.json`: 12,110 literal/sticky cases, 6,144 independent alias and
illegal-mode cases (2,976 rejected), 12 CSR/fault-prefix cases, 20,480 pure
generated-module states (10,800 helper calls and zero calls on illegal paths),
16 optional-import subsets and a full five-helper direct batch chain. There
are no ignored tests. Exact source publication bytes, FPR masks, parcels,
virtual PCs and prefix/suffix state are asserted inside the generated run.

`sabotage.py` changed only the isolated expected fused-cancellation result to
zero. `sabotage-mutant.log` fails at `CRITIC_FMADD_SINGLE_ROUNDING` (exit 101);
the restored isolated source passes (exit 0). The working-tree implementation
was untouched, and `sabotage.json` records source/log hashes and scratch path.

After these passing runs, source coverage review identified a useful distinct
flag-repair arm: smallest normal produced from an exact value just above the
normal boundary under a toward-zero mode. Two signed literal triples were
added to the verifier oracle and committed test constants. The oracle now
contains 175 triples / 875 mode results; the final literal receipt must be
12,250 cases. The final frozen worker submission must execute those additional
cases. No implementation change or unrelated regression rerun is required.
The sabotage witness, assertion, exact first literal and dependency boundary
are unchanged by the two appended literal entries; carry that attack result.
