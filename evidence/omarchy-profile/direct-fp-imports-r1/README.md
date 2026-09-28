# Direct WebAssembly FP imports — bounded speedup, desktop still negative

Runtime/harness freeze: `8c302e1d6cd084ba1034cfd58c7efb9677dc3e46`.
Deployed references/cold/physical: `a3beb0e8dc5da21374a6d59e25658f5db5ce79da`.
Release WASM: `36b4f1ccf9e1437f687eae552aca3290fab7c555dfd7fa9fac6cc3862d87a916`.

Five pure FP functions now link as actual WASM exports; other imports, numerical
backends and generated code are unchanged. Final affected checks pass, including
32 independent private/shared tests, strict type and identity checks, lifetime,
real memory growth and isolated trampoline sabotage. Exact AN evidence carries
by source and digest. Full local CI still fails in the same five inherited
categories; see `ci-failures.json`, not a green workspace claim.

The final same-browser five-pair comparison retires 500065 instructions per run,
499760 compiled. Each arm has identical registers, statistics and RAM digest
c55029e8cbc137ddab4624cc75bfd853a46c1d385f29b173028ac388de31fd94.
Medians are 24.220 ms baseline and 14.235 ms candidate, ratio 0.5877374.
A sole pristine clone reproduces exact WASM, 32 tests and 127/0 live ISA checks;
its independent five-pair median ratio is 0.5949657. Counts of helper occurrences
are derived from the guest; conservative compiled-call lower bounds are recorded.
This benchmark does not prove a desktop latency improvement.

Cloudflare deployment initially timed out twice fetching an unchanged 205 MB
snapshot. Original logs remain. `deploy-recovery.py` downloaded 49 contiguous
ranges with exact Content-Range, length and SHA checks, then verified the complete
original SHA before the same final Pages publication command. Both public
origins match 12 exact files; deployment is 5256a6c7.wasm-vm.pages.dev.

The sole physical trial uses the exact AJ R2 pair, cap 256/recycling ON and the
original display and deadlines. Startup 38108 ms; 128 trusted key events;
Enter 09:55:39.631Z; failure 09:57:39.632Z. All 37 completed reads are exit 75,
none pending. Frames 2→3, but personally inspected images show no typed command
or returned prompt. 3,544,856,799 interval retirements, 71.6276% compiled, are
observations of this negative run. Normal owned cleanup completed.

The original wrapper's post-run geometry assertion also fails and is retained:
it incorrectly requires every damage rectangle to fill the screen. Existing
Resource::flush_rect narrows later updates and JsFrameSink opts into that
behavior. The actual last update is (10,36,118,28); canvas and GPU remain 1280×800,
resource 1280×832. `audit-physical.mjs` audits dimensions and contained damage
separately, rejects 16 geometry mutations, and replays all remaining raw input,
fence, post-verdict profile and cleanup conditions offline. It does not rerun
or relabel the failed trial. All 52 frozen source/harness files remain unchanged.

The subsequent 30,022.968 ms CPU sample has 19977 samples and 5211 nodes. Eleven
non-custom executable sections match the named companion before symbolization.
The 8.743% BlockCache::flush_page self share is diagnostic only; no causal input
claim follows. The next investigation should locate key processing inside the
guest rather than infer consumption from host acknowledgments.
