# E5-T18d evidence provenance

The runtime and guest-image inputs froze at
`c01edca99d3e6a227f51fbca882312b1ed802913`. The browser observer froze at
`5ff7f85727352781f297fff70ba10263ff8646ae`; that incremental commit changes only the
observer, its three unit tests, and the Makefile test command. It does not change
the guest image, emulator, worker, presentation code, or deployed page.

`runtime-artifacts.json` binds the workspace runtime to a from-source build in the
fresh shared-folder clone
`/Users/blamy/Documents/Codex/e5-t18d-final.YlijDe/repo`. The clone was created before
the first acceptance invocation. `RUSTFLAGS`, `RUST_LOG`, and every `CARGO_*`
environment entry were removed from the acceptance environment. Docker requires
a Colima-shared path; an earlier `/private/tmp` clone was not mounted into the
container and produced no accepted Linux evidence.

## Deterministic prechecks

- `native-tests.log`: `cargo test -p wasm-vm-core --features gpu-trace --lib`;
  267 passed, zero failed or ignored.
- `local-fixtures.json`: ten isolated Linux supervisor fixtures, including all
  four task-prescribed fault drills. These process doubles are prechecks, not
  substitutes for the browser guest recordings.
- `cold-clone-prechecks-and-superseded-observer.log`: the exact-clone
  `make verify-E5-T18d` invocation at `c01edca`. It includes the four recovery-policy
  tests, 25 worker-protocol tests, ten supervisor fixtures, nine promoted boundary
  tests, and a from-source WASM build. Its final browser invocation is explicitly
  **not an overall pass**: the broken-config guest passed, but the normal desktop
  was rejected by an incorrect colorful-wallpaper observer. The pinned wallpaper
  is neutral gray. The later observer uses the bright body and contrasting panel,
  and separately rejects blank, flat-gray, and sparse text-console surfaces.

The already-passing runtime gates carry forward across the observer-only change,
as required by the repository's incremental re-verification policy. The final
browser recording uses the corrected observer and is kept separately.

## Immutable image inputs

The committed lock is `tools/image/e5-t18d-desktop-image.json`. Local inputs:

```text
target/e5-t18d/desktop-image-v5/alpine-rootfs.ext4
target/e5-t18d/chunks/desktop-v5/manifest.json
```

The final browser harness checks the ext4 digest, both package/custom-file
manifests, the four installed recovery scripts against source, every served chunk,
and the digest of the complete image reconstructed from those chunks. Each browser
context blocks service workers, disables its HTTP cache, and uses a disposable
nonpersistent guest overlay. No process-double output can satisfy its assertions.

To reproduce the incremental browser recording from the frozen observer head:

```sh
node --test tools/verify/e5-t18d-surface.test.mjs
E5_T18D_REQUIRE_HEAD=5ff7f85727352781f297fff70ba10263ff8646ae \
  E5_T18D_IMAGE_DIR=/absolute/path/to/desktop-image-v5 \
  E5_T18D_DESKTOP_ASSET_DIR=/absolute/path/to/chunks/desktop-v5 \
  E5_T18D_EVIDENCE_DIR=target/e5-t18d-final-proof \
  node tools/verify/e5-t18d-desktop-recovery.mjs
```

Run in the same scrubbed environment described above. The full acceptance target
remains `make verify-E5-T18d`; no independent-machine, WebKit, or rr claim is made.

## Final result

`browser-final.log` ends with `E5T18D_PASS=2`. `desktop-recovery.json` binds both
passing cases to the frozen observer, all source hashes, and the image publication.
The per-case JSON files carry the same binding. Three successful visible compositor
attempts (PIDs 968, 1111, 1236) precede the latched fallback to tty1 getty PID 1361;
the independent broken-config boot reaches getty PID 992 without a start/readiness
claim. `ready-{1,2,3}.png`, `three-crashes.png`, and `broken-config.png` are the raw
Playwright captures, with screenshot and guest-state digests in the report.
