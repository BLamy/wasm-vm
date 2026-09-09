# E5-T22f fresh adversarial verification

Date: 2026-09-06. Frozen acceptance head:
`844948819f3fd8839cb4edd38e1ec4a0218d70d9`. Runtime implementation:
`41d9ce2c4590e250dba6d65f792c70cb509273ee`. Scoped base:
`03fdfb24`. Coordinator head `2a279e30` changes only task/queue and evidence
relative to the frozen head; it does not change runtime or harness code.

Predictions were recorded in `daybreak-preregistered-predictions.md` before
opening worker or candidate verifier evidence. The older untracked
`attack-plan.md`, `provisional-review.md`, and failed candidate logs targeted an
earlier head and were not treated as evidence.

## Result

`VERDICT: verified`

- **P1 HELD — unchanged S/U work.** The frozen counter cases at
  `cold-clone-final.log:427,430,432,444,484` pass: 1/16/128/2048 populated
  caches survive 1,000 S/U transitions with zero audited ops and unchanged
  generation, while all four M boundaries inspect 2,048 ops. An independent
  rerun of the five unit cases passed with 0 ignored.
- **P2/P3 HELD — M and effective-revision boundaries.** Focused native runs of
  `pmp`, `predecode_entry_safety`, and the shared E5-T22f fixture passed. The
  retained-cursor observations at `cold-clone-final.log:551-556` are zero
  retirements, `x6=0`, and fault `0x80000004` for cache off/on and both S/U
  directions. Existing M-transition/interior and guest-MRET tests also passed.
- **P4 HELD — trace and state parity.** Native frozen observations at
  `cold-clone-final.log:560-572` show the 2,000-record restore/host sequence
  hash `8907ff1cb93090b5`, RAM digest
  `14118a1afcb43237022d6fb90905fd2420e80af1850fbcee2df81f78a3ecc5e0`,
  and SRET/trap hashes `1046a1baefeab5ca`, `bdacf09cb6d2a951`,
  `eac08f91a4e7b526`, and `107b228d8e75d2b9`. The actual-Wasm five-test run
  passes at `cold-clone-final.log:801-814`. Independent native and actual-Wasm
  reruns also passed; BrowserExecutor reported compiled execution and exact
  full-state parity through its assertion.
- **P5/P6 HELD — map/PTE isolation and novel attack.** Promoted test
  `tests/shared/e5_t22f_verifier.rs` uses seed `0x91e522f06a7bc3d9` and its
  XOR with `0xd1b54a32d192ed03`, 48 boundaries, unlocked RX, locked RX and
  locked R-only TOR maps, capacities 1/64 paired with cache-off machines, and
  the six M/S/U directions. It checks hand-derived retire/fault outcomes,
  supervisor/user/no-X PTE aliases, locked ignored cfg/own/lower-bound writes,
  effective revisions, real cache hits, dirty-state restore, reset, complete
  retire records, hart snapshots and RAM digests. Native and actual-Wasm each
  passed all 576 boundaries with 0 ignored; scoped clippy passes with warnings
  denied.
- **P3 sabotage HELD.** In a disposable archive of `84494881`, the only source
  mutation removed `revision == self.pmp_revision_seen &&` from the new S/U
  shortcut. The other same-state and slow-audit revision predicates remained
  byte-identical. Native result: `su_midblock_revision_revocation` failed for
  S-to-U/cache-on with observed `MaxInstrs` instead of the predicted
  `InstrAccessFault { tval: 2147483652 }`; 0 passed, 1 failed. Actual-Wasm
  result: the ordinary revision fixture and the other three tests passed, while
  the same mid-block fixture alone failed with the identical illicit
  `MaxInstrs`; 4 passed, 1 failed. The production checkout was never mutated.
- **P7 HELD — frozen environment and browser.** The complete clone log SHA-256
  is `886c3cc534514a1c2ae9a9718c8ad9207f7d1b2b3b3091b8c97d07a1ede3ef32`;
  it names head `84494881` at line 1, the scrubbed environment at line 2, and
  terminates with pristine-clone success at line 1564. Recomputed engine tree
  digest `d3ed29d77ae49e1a089847e76cb29e1500e8f96b19afb7534641018b9d79bca3`
  and all 17 recorded source digests match frozen Git objects. Recomputed image,
  package, file, chunk, kernel, results and Wasm digests match
  `browser/engine-proof.json:3-15`. All seven screenshots match their JSON
  digests and visually show the retained desktop; requested mode, guest
  observation, EDID, GPU scanout, accepted viewport and canvas dimensions agree
  for every mode, Weston remains PID 961, foot remains PID 1018, all eight edge
  samples are painted, and the marker hash is unchanged. Results contain no
  browser errors. The built demo records 126 passed, 0 failed and no filtered
  HTTP/browser errors (`demo/demo-suite.json:4-11`). Timings are retained at
  `browser/engine-proof.json:16-58`; the explicit gaps and
  `certifiesE5T22c:false` at lines 60-72 preserve E5-T22c's separate gate.
- **P8 HELD — changed-hunk coverage.** The production shortcut, test-only
  counter initialization/increment/module registration, every new native/Wasm
  fixture, both browser/cold-clone harnesses and the verify target executed.
  Browser/fixture JSON, screenshots, generated Wasm/dist and roadmap metadata
  are declarative or generated outputs bound by the recorded hashes and browser
  run. No acceptance-relevant hunk is unexecuted; comments and task/queue text
  are waived as non-runtime metadata.

## Mock and environment audit

The fixed trace hashes are not the semantic oracle: every cached run is compared
record-for-record and full-state against a cache-disabled machine. The same
hashes appear in the pre-change run, and the scoped runtime diff does not execute
on cache-disabled machines. The independent attack uses a hand-derived outcome
oracle plus cache-off parity, not output generated solely by the changed path.
The retained clone is at the exact frozen head; its only tracked post-run changes
are the two explicitly excluded generated artifact manifests. Browser proof
inputs were clean before and after the run, and cold-clone harness tests cover
committed-versus-dirty input, environment scrubbing, literal target/parent
handling, failure propagation, and owned-child cleanup. No new `#[ignore]` or
disabled assertion exists in the scoped diff; the one ignored long externref
churn test is pre-existing and unrelated to PMP synchronization.

## Independent commands

```text
cargo fmt --check -p wasm-vm-core -p wasm-vm-wasm
cargo clippy -p wasm-vm-core --test pmp_privilege_adversarial --features trace -- -D warnings
cargo clippy -p wasm-vm-wasm --test pmp_privilege_adversarial --target wasm32-unknown-unknown -- -D warnings
cargo test -p wasm-vm-core --lib --features gpu-trace pmp_audit_tests -- --nocapture
cargo test -p wasm-vm-core --test pmp_privilege_audit --test predecode_entry_safety --test pmp --test sv39 --test reset --features trace -- --nocapture
cargo test -p wasm-vm-core --test pmp_privilege_adversarial
wasm-pack test --node crates/wasm --test pmp_privilege_audit -- --nocapture
wasm-pack test --node crates/wasm --test pmp_privilege_adversarial
```

Suite decision: promote the deterministic seeded native/actual-Wasm attack. It
adds permanent PTE, TOR lock, M-boundary, restore/reset and independent-seed
coverage without changing production or harness semantics.
