# E5-T22f worker submission

Runtime change: `41d9ce2c`. Frozen acceptance:
`844948819f3fd8839cb4edd38e1ec4a0218d70d9`.

```sh
tools/verify/cold_clone.sh --keep --parent \
  /Users/blamy/Documents/Codex/wasm-vm/target/e5-t22f/cold verify-E5-T22f
```

`cold-clone-final.log` is the complete successful pristine-clone command output.
`browser/engine-proof.json` binds the frozen code, unchanged desktop fixture,
production Wasm and `browser/results.json`; raw guest serial, mode observations,
retained-client screenshots and paused-overlap state are in `browser/`.
`demo/` records the same clone's 126/0 built-demo pass.

This submission demonstrates zero cached-instruction audits at unchanged-PMP
S/U transitions while preserving the existing M-mode and revision boundaries.
Its seven browser checks retain the real guest mode, terminal and marker bytes.
The largest full repaint is 8648.725 ms. **E5-T22c's two-second criterion is not
waived or satisfied by this engine-boundary proof.**

`cold-clone-mount-failure.log` is the earlier unsuccessful clone at `fd58010a`.
Docker could not mount the system temporary path; `cold-clone-harness.log`
records tests for the explicit shared-parent correction. No failed result is
relabelled as success. `iteration-pmp-shortcut/README.md` explains the earlier
non-frozen diagnostic CPU capture and its distinct scope.

The fresh verifier's predictions, independent attacks and verdict belong in
`verifier/`. The worker does not issue its own verified verdict.
