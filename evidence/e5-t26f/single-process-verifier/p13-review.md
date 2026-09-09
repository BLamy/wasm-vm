# P13 — final scoped clean clone

VERDICT: HELD for same-host clean-clone test availability/portability at `001e80864911863145f2127192bae5df8186e68b`. This does not verify F timing, another host, an RV64 cross-build, image construction or a new browser run.

After the incremental collector review held, executed the single authorized clone via `run-p13.mjs`. `/usr/bin/mktemp -d /private/tmp/e5-t26f-single-process-p13.XXXXXX` allocated the retained directory. `git clone --no-local --no-checkout` transferred repository objects without shared-object alternates, then checked out the exact requested commit detached. Hooks were disabled for clone/checkout; no hook/build workaround edited cloned source.

Retained clone: [repo](/private/tmp/e5-t26f-single-process-p13.j00WpJ/repo). All eight recorded commands exited0 with no signal/error. RUSTFLAGS/RUST_LOG and every CARGO-prefixed variable were absent in the child environment; the inherited RUST_LOG name was actually removed, without logging its value. Other host tools/environment remain those of this Mac. Exact command arrays and environment policy are in [result.json](/Users/blamy/Documents/Codex/wasm-vm/evidence/e5-t26f/single-process-verifier/p13-v1/result.json:1).

Only these test commands ran:

```text
make verify-E5-T26f-single-process-observer
node --test tools/verify/e5-t26f-discovery-observation.test.mjs tools/verify/e5-t26f-compile-queue-observation.test.mjs
```

Results:

- Observer gate: 10,389 sanitized C CHECK invocations, real getppid/retained-parent-FD3 transport, wrong-parent refusal and expected zero-pointer sabotage rejection; **82 Node tests passed**, zero failed/skipped. These are the gate's counts, not all distinct independent cases. [C result](/Users/blamy/Documents/Codex/wasm-vm/evidence/e5-t26f/single-process-verifier/p13-v1/05-observer-gate.stdout:7), [Node total](/Users/blamy/Documents/Codex/wasm-vm/evidence/e5-t26f/single-process-verifier/p13-v1/05-observer-gate.stdout:100).
- Changed collector tests: **18 passed**, zero failed/skipped, including actual committed `0881…` raw-record regression and CLI paths. [Closed collector output](/Users/blamy/Documents/Codex/wasm-vm/evidence/e5-t26f/single-process-verifier/p13-v1/06-collector-tests.stdout:1). Some compile-collector cases intentionally occur in both authorized commands; totals are not claimed as disjoint coverage.
- `git status --porcelain` before and after produced zero bytes; final `git diff --exit-code` exited0 with zero output. No source modifications or workaround were applied. The clone remains intact.

No second clone, Docker/native-container run, cross-build, runtime/core/L/K/ISA suite, image rebuild, browser or profile/tree scan was performed. Previously HELD runtime/image/guest evidence is carried, not recreated. The original wrapper failure, later collector-only repair and failed browser endpoints remain separate facts.

SHA-256:

| Retained artifact | Digest |
| --- | --- |
| Driver | `4c91931c81dc5dcdeefe593c1bb74f3c82cac546cec2ce9bb2f2e43f34556b51` |
| P13 result | `6b5572460e16f5d9e40d16e838c508add1662c5570e7244e36383245a8dffc8f` |
| Observer-gate stdout | `0e22b6a082b0faf3def6edfaa6a663e1199156024dcb2568661724d2f67fa94b` |
| Observer-gate stderr, expected mutant refusal | `0c6355e16b3f0a159c2ad3b61e690f6abf7f3e614a5265db12922c11e9326c4f` |
| Collector stdout | `3fb5577fdfa488ed92f5bf4668f3459041f3cef4299c510c9a7d6c7acc101d6a` |
| Collector stderr, empty | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` |

Writes: `run-p13.mjs`, this report, `p13-v1/` logs/results under the verifier evidence directory, and the explicitly authorized retained `/private/tmp/e5-t26f-single-process-p13.j00WpJ/` clone. No main-workspace implementation/status/queue/commit changes.
