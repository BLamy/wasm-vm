I’ll perform this as a fresh Daybreak prepublication review, read-only against source, task, Git, and evidence. I’ll first map the task and changed boundary, then write timestamped falsifiable predictions before opening any evidence outputs; only the isolated audit directory and scratch tests will be written.

The task is high-risk persistence work and the runtime is frozen at `63374f7c1`; the two later commits are harness-only. I’m now tracing the exact ownership transfer from JS streaming through generated wasm-bindgen glue into Rust preflight/restore, and separating runtime hunks from fixtures, generated artifacts, and declarative copies before freezing predictions.

Predictions are frozen at SHA-256 `d1140ccf…f429b41`. The sharpest source-level risk is ownership/error behavior, not framing logic: generated glue invalidates the JS wrapper before Rust runs, while failed appends should preserve an already-staged prefix. I’ll now test those claims independently and only then reconcile the worker receipts and pristine experiment.

The first direct Node probe exposed an overstrict verifier assumption in my scratch test: a successful restore does not promise byte-identical reserialization, because restore intentionally refreshes/discards host-owned state. That is not a product failure—the acceptance requires byte identity only on refusals. I’m narrowing the oracle to `stateDigest` for successful restore and complete snapshot bytes for every rejection, while preserving the exploratory failure separately.

The independent shipped-Wasm probe now passes: non-zero-offset typed-array views, recoverable failed appends, single-use ownership on every outcome, three coherence refusals, duplicate/overflow TLVs, and a structurally complete late-device invalid boolean all behaved as predicted; every rejection preserved the complete machine snapshot. The cleanup sabotage was detected with exit 1. I’m moving to evidence integrity and the clean-build discrepancy now, without assigning causation from the differing bytes.

The pristine discrepancy is now bounded by evidence, not guesswork: v1 stays FAILED. Its sparse set omitted tracked `rust-toolchain.toml`; the preserved old clone selects Rust 1.98, while the repository pin is 1.96. A new pinned clone rebuilt wasm and matching glue byte-for-byte to the committed artifacts. However, its functional gate also remains FAILED because the sparse checkout omitted the published gzip, so no pristine full restore ran. I’m checking whether that is the only remaining non-publication proof gap and will not relabel either receipt.

The clean-source functional gap is now closed independently without altering either failed receipt: the pinned clean clone’s own wasm and matching glue restored the actual published 634,769,246-byte container directly under Node, with a 16 KiB observed copy maximum, no restore-time memory growth, and the independent 1 GiB RAM digest. Live Cloudflare still serves the old 2,645,647-byte module, so deployment/live verification remains the publication step—not a runtime refutation.

One concurrent repository change appeared after the review: the working-tree HEAD moved from reviewed `0144c662…` to `087c69c5…`. I did not cause it. I’m checking whether it is evidence-only; the verdict remains bound to `0144c662…` unless the new commit is proven not to alter the reviewed runtime or fixtures.

PREPUBLICATION VERDICT: pass

The streamed software restore boundary survived independent actual-Wasm attacks and pristine functional acceptance. The original failed receipts remain preserved; no physical-phone/OOM, RSS reduction, or GPU qualification is claimed.

Publication remains pending: Cloudflare still serves the old wasm. Deploy current PR 626 head `087c69c5…`, verify live hashes plus warm restore/echo, then perform final verification. No task status or implementation files were changed.

Full audit: [audit.md](/private/tmp/e5-5-t07-daybreak-prepublication-v1/audit.md)  
SHA-256: `45cc8530008dca54eb170b02374d71a314651e886b5bd7104e315c46311f14a0`
