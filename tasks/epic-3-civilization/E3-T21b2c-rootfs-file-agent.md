---
id: E3-T21b2c
epic: 3
title: Rootfs integration and boot proof for WVFT agent
priority: 321.223
status: verified
depends_on: [E3-T21b2b]
estimate: S
risk: high
capstone: false
---

## Goal
Install and lifecycle the static agent reproducibly in Alpine, then prove the real guest reaches
the verified synthetic endpoint.

## Deliverables
- Deterministic rootfs installation paths, fixed inbox/outbox directories, OpenRC lifecycle, and
  `vm-download` command exposure.
- Image manifest/digest coverage for the binary, configuration, service, and directories.
- A real boot acceptance path through `10.0.2.2:10021`.

## Acceptance criteria
- [ ] Two rootfs builds install identical agent/config/service bytes at deterministic paths and
  produce the expected manifest/digest.
- [ ] A boot test proves service startup, one upload and download hash round trip, timeout cleanup,
  and restart recovery through the real slirp endpoint.
- [ ] The guest exposes no host/public listener and the agent restart leaves no complete-looking
  partial file.

## Adversarial verification
Boot with stale/corrupt partials and commit records, kill/restart the service mid-transfer, inspect
listeners/routes, and compare clean image builds. Any nondeterministic image, public ingress,
incomplete final name, or missing restart recovery refutes.

## Verification log

### 2026-07-27 — worker — implemented
- Exact implementation head: `f7ad63b` (`5a5a6d8` runtime/rootfs integration plus
  `f7ad63b` roadmap and browser evidence).
- Static-agent reproducibility: two independent musl builds produced
  `3df4809320d8fbab3b7d8b68378828e7cd5bb6711b0198cb08d3a598a322e025`; both were
  stripped RISC-V ELF64 static PIE executables.
- Rootfs reproducibility: two clean `tools/build-rootfs.sh` runs produced
  `85ca0ab8fad742dd0fc54538bc7ea489176dd0ebe78bb6c26a73a34873035e1b`; both passed
  `fsck`, package-lock, `FILE-MANIFEST.txt`, ELF-architecture, path, mode, and digest
  checks through `tools/verify/e3-t21b2c-rootfs.sh`.
- Real boot acceptance:
  `cargo test --release -p wasm-vm-cli --test boot_file_agent -- --ignored --nocapture`
  passed (1/1, 178.16s). The installed command booted against the real Alpine
  kernel/rootfs and proved host-to-guest SHA-256 upload, guest-to-host byte-exact
  download, no listener on port 10021, the bounded 30-second host timeout while the
  guest agent was frozen, recovery after a corrupt partial/commit record and service
  restart, a post-restart transfer, and a forced clean poweroff.
- Submission gates passed: `cargo fmt --all --check`; strict clippy for
  `wasm-vm-file-agent`, `wasm-vm-slirp`, and `wasm-vm-cli`; 8 file-agent tests; native
  fixture round trip; 13 slirp file-transfer tests including 100 MiB and real TCP;
  wasm32 build; the E3-T21b2b capability checker; the E3-T21b2c rootfs verifier;
  `cargo check --workspace --all-targets`; task policy; and scoped diff checks.
- Browser proof: `make web-build`, then one local-page load ran the 126-binary suite
  to 126 passed / 0 failed / 126 done with zero console errors. The
  `Bounded host/guest file-transfer agent` roadmap capability was present and visible
  as verified. Screenshot:
  `tasks/epic-3-civilization/e3-t21b2c-browser-roadmap.png`.

Claim: the frozen head reproducibly installs the bounded static WVFT agent, configuration,
OpenRC lifecycle, and guest download wrapper into Alpine; the real guest exchanges
byte-verified files only through the host-selected slirp endpoint, times out boundedly,
exposes no inbound listener, and recovers without promoting a stale partial after service
interruption. The focused boot intentionally uses `init=/bin/sh` to avoid unrelated
OpenRC/getty boot cost; production OpenRC paths and enablement are covered by the
rootfs manifest verifier.

### 2026-07-27 — verifier — VERDICT: needs-evidence

- **P1 static agent and installed custom bytes — HELD.** Predicted two independent clean target
  directories would produce byte-identical static RISC-V agents matching the committed manifest,
  and that the actual ext4 would contain the claimed paths, modes, bytes, directories, and default
  runlevel link. Observed both builds and the image agent at
  `3df4809320d8fbab3b7d8b68378828e7cd5bb6711b0198cb08d3a598a322e025`;
  `tools/verify/e3-t21b2c-rootfs.sh` passed; direct `7zz` inspection of
  `releases/rootfs/alpine-rootfs.ext4` found the four files, three 0750 directories, and
  `/etc/runlevels/default/wasm-vm-file-agent`, with extracted file hashes matching
  `releases/rootfs/FILE-MANIFEST.txt`. Citation:
  `tools/rootfs-inner.sh:140-172`, `tools/verify/e3-t21b2c-rootfs.sh:8-68`,
  `releases/rootfs/FILE-MANIFEST.txt:1-7`.
- **P1 whole-image double build — NEEDS EVIDENCE.** The acceptance criterion requires two rootfs
  builds with identical image bytes. The worker log gives digest
  `85ca0ab8fad742dd0fc54538bc7ea489176dd0ebe78bb6c26a73a34873035e1b`, and the current ext4
  matches it, but cites no retained build logs or two independently addressable image artifacts.
  The verifier confirmed two independent agent builds, not two complete rootfs builds. Record the
  two clean `tools/build-rootfs.sh` outputs (or a deterministic double-build target) with both
  image hashes at the final head.
- **P2 real endpoint transfer, timeout, listener, and reconnect — HELD.** Predicted the installed
  agent would boot against real Alpine, expose no TCP listener on guest port 10021, upload the
  host-selected source with the independently calculated SHA-256, download byte-identical guest
  data only into the host-selected directory, expire the frozen transfer after the 30-second
  boundary without a final `timeout.bin`, and complete a fresh download after restart. The exact
  ignored boot test passed 1/1 in 120.92 seconds. Citation:
  `crates/cli/tests/boot_file_agent.rs:90-201,212-224`,
  `crates/cli/src/boot.rs:89-100,358-371`,
  `crates/cli/src/file_transfer_fixture.rs:69-150,153-208`.
- **P3 corrupt-record restart recovery — NEEDS EVIDENCE.** Predicted a corrupt commit record
  associated with an existing final basename would quarantine that visible final and commit,
  retain only a private partial, leave zero complete-looking inbox names, and reconnect. The
  submitted test creates only the hidden partial and the bytes `corrupt`, then checks that
  `recovered.bin`—a name never created or encoded—is absent, so a no-op recovery would satisfy the
  assertion (`crates/cli/tests/boot_file_agent.rs:203-210`). In an isolated clone, the verifier
  strengthened that same real boot by creating `recovered.bin`, a private partial, and a corrupt
  63-byte record whose salvageable basename was `recovered.bin`; after restart it required the
  final and commit absent, the partial present, a quarantine entry present, and no visible inbox
  files. The recovery marker did not appear within its 120-second bound and the test failed after
  235.41 seconds. This does not yet distinguish a product failure from a compound shell-predicate
  failure because the submitted harness emits no per-predicate diagnostics. Add the actual
  associated-final attack with one marker/listing per recovery predicate, preserve the transcript
  on failure, and rerun the exact real boot.
- **P4 host path confinement — HELD.** Upload paths enter only through host CLI flags and are
  opened/identity-checked by the host; the protocol receives only the basename and bytes.
  Downloads validate one basename, create an exclusive private sink beneath the host-selected
  directory, refuse replacement, verify length/hash, then publish without replacement. The
  focused fixture test passed. The unchanged E3-T21b2b normalization/framing findings are carried
  forward. Citation:
  `crates/cli/src/file_transfer_fixture.rs:69-150,153-276`,
  `crates/cli/src/net_backend.rs:150-199`.
- **P5 browser binding — NEEDS EVIDENCE.** The committed screenshot visibly shows the green
  `Bounded host/guest file-transfer agent` roadmap item, matching
  `web/roadmap.js:80`. It does not show the Tests tab result or provide a console log/recording, so
  it cannot independently support the claimed `126 passed / 0 failed / 126 done` and zero console
  errors. Attach the single built-page Playwright result (or recording) that contains those
  assertions and the roadmap visibility assertion at the frozen head.
- **COVERAGE:** rootfs installation/manifest hunks, CLI upload/download adapters, live transfer,
  timeout, no-listener marker, and reconnect path were exercised. The corrupt-final recovery
  branch and whole-image double-build claim remain needs-evidence. Declarative comments, CLI help,
  `.gitignore`, and roadmap copy are waived after direct inspection. The new boot test's recovery
  assertion is insufficient because it never constructs the complete-looking final it claims to
  exclude.
- **SUITE:** retain the rootfs verifier, focused fixture tests, slirp transfer tests, and real boot
  target. Promote the associated-final corrupt-record attack into `boot_file_agent.rs`; preserve
  its transcript/artifact listing on failure. No verifier-owned test was committed because the
  stronger scratch version currently fails without identifying which recovery predicate failed.

Commands:

- `bash -n tools/build-rootfs.sh tools/build-file-agent.sh`
- `bash -n tools/rootfs-inner.sh`; `sh -n` on the POSIX rootfs scripts/checker
- two independent `tools/build-file-agent.sh` runs with distinct `CARGO_TARGET_DIR`s, `shasum`,
  `cmp`, and `file`
- `bash tools/verify/e3-t21b2c-rootfs.sh`
- `7zz l -slt` and `7zz x -so ... | shasum -a 256` against the actual ext4
- `cargo test --release -p wasm-vm-cli --test boot_file_agent -- --ignored --nocapture`
- `cargo test -p wasm-vm-file-agent`
- `cargo test -p wasm-vm-cli --bin wasm-vm fixed_source_and_directory_sink_round_trip_without_replacement`
- `cargo test -p wasm-vm-slirp file_transfer`
- `cargo clippy -p wasm-vm-file-agent -p wasm-vm-slirp -p wasm-vm-cli -- -D warnings`
- isolated-clone strengthened corrupt-record real-boot attack
- `cargo fmt --all --check`; `bash tools/verify/e3-t21a-protocol.sh`
- `python3 tools/check_task_policy.py`; `git diff 394c931..f5e8bd3 --check`

### 2026-07-27 — worker — evidence response

- Added `tools/verify/e3-t21b2c-repro.sh`, which refuses to replace prior evidence, performs
  two complete rootfs builds, runs the rootfs verifier after each, retains both 512 MiB ext4
  artifacts and logs, then requires both SHA equality and byte-for-byte `cmp`. The final-head run
  passed with both artifacts at
  `85ca0ab8fad742dd0fc54538bc7ea489176dd0ebe78bb6c26a73a34873035e1b`.
  Reopenable evidence:
  `target/e3-t21b2c-rootfs-repro/{rootfs-a.ext4,rootfs-b.ext4,build-a.log,build-b.log,rootfs-a.sha256,rootfs-b.sha256,result.txt}`.
- Strengthened `boot_file_agent.rs` to create an actual `recovered.bin`, its private partial,
  and a 63-byte commit record with a salvageable basename and deliberately mismatched hash.
  Recovery now emits and checks separate markers for final removal, record removal, private
  partial retention, quarantine creation, and zero visible inbox names, with `ls -la` in the
  failure transcript. The exact real-Alpine test passed 1/1 in 141.52 seconds. The preceding
  diagnostic run demonstrated all five predicates but caught a harness issue: literal `BAD`
  markers in the echoed command could refute their own absence checks. The final version uses
  split input markers so only guest output contains the contiguous assertion token.
- Rebuilt the page at source head `f5612e1` and reran the single browser pass. The Tests view
  visibly records total 126 / passed 126 / failed 0 / done 126; console error collection returned
  `[]`; and the roadmap locator found exactly one visible
  `Bounded host/guest file-transfer agent`. Evidence:
  `tasks/epic-3-civilization/e3-t21b2c-browser-proof.md`,
  `tasks/epic-3-civilization/e3-t21b2c-browser-tests.png`, and the existing roadmap screenshot.

Claim: the verifier's three evidence gaps are now directly reproducible and independently
inspectable. No runtime semantics changed; only the affected real-boot assertion, deterministic
double-build harness, and browser evidence were strengthened, so the prior `HELD` findings remain
applicable under the incremental re-verification rule.

### 2026-07-27 — verifier — VERDICT: verified

- **P1 static agent and installed custom bytes — HELD (carried forward).** The implementation,
  manifests, installed paths, modes, and static-agent digest are unchanged from verifier commit
  `37c06e6`.
- **P1 whole-image double build — HELD.** Predicted the retained artifacts would be two complete,
  independently built 512 MiB images with matching bytes and independently reproducible verifier
  results. Both `rootfs-a.ext4` and `rootfs-b.ext4` are exactly 536,870,912 bytes, independently
  hash to `85ca0ab8fad742dd0fc54538bc7ea489176dd0ebe78bb6c26a73a34873035e1b`,
  and `cmp` reports equality. Both retained logs show all 84 packages installed, clean fsck and
  foreign-ELF scans, identical manifest digests, and `E3-T21b2c rootfs: OK`.
- **P2 endpoint, timeout, listener, and reconnect — HELD (carried forward).** Runtime code and the
  previously exercised transfer, timeout, no-listener, and reconnect paths are unchanged. The
  strengthened exact real-Alpine boot passed 1/1 in the worker response.
- **P3 corrupt-record restart recovery — HELD.** The fixture now constructs a valid 63-byte commit
  record with magic `WVFTCMT1`, name length 13, total length 7, an all-zero deliberately mismatched
  hash, and salvageable name `recovered.bin`; both the visible final and private partial contain
  seven-byte `partial`. It independently requires final and commit removal, partial retention,
  quarantine creation, and zero visible inbox names. The input command splits every failure token
  around shell quotes, so an echoed command cannot satisfy the contiguous failure assertions.
  With recovery deliberately omitted in a bounded verifier sabotage, the same predicates emitted
  `FINAL_BAD`, `COMMIT_BAD`, `QUARANTINE_BAD`, and `VISIBLE_BAD`, proving the strengthened check is
  not self-satisfying.
- **P4 host path confinement — HELD (carried forward).** Host path handling and protocol framing
  are unchanged from `37c06e6`.
- **P5 browser binding — HELD.** The 1280x720 Tests screenshot visibly records total 126, passed
  126, failed 0, and done 126. The prior roadmap screenshot visibly records the verified
  `Bounded host/guest file-transfer agent` capability, while
  `e3-t21b2c-browser-proof.md` separately records console errors `[]` and the exactly-one-visible
  roadmap assertion. There is no `web/` source diff from bound source head `f5612e1` through
  submission head `9351871`.
- **COVERAGE — SUFFICIENT.** The only response changes are the associated-final real-boot fixture,
  deterministic double-build harness, retained artifacts/logs, screenshots, and proof metadata.
  No runtime semantic hunk changed, so all prior `HELD` results carry forward under incremental
  re-verification.
- **SUITE:** promote `tools/verify/e3-t21b2c-repro.sh` and retain the strengthened real-Alpine boot
  fixture and browser proof artifacts.

Commands:

- `shasum -a 256 target/e3-t21b2c-rootfs-repro/rootfs-{a,b}.ext4` — both
  `85ca0ab8fad742dd0fc54538bc7ea489176dd0ebe78bb6c26a73a34873035e1b`.
- `cmp -s target/e3-t21b2c-rootfs-repro/rootfs-a.ext4
  target/e3-t21b2c-rootfs-repro/rootfs-b.ext4` — passed; both files 536,870,912 bytes.
- Independent inspection of `build-a.log`, `build-b.log`, both SHA files, and `result.txt` —
  complete builds and both rootfs verifier runs passed.
- Recovery-disabled marker sabotage using the exact record construction and predicate commands —
  required failure markers appeared; record length 63 and bytes independently inspected with
  `xxd`.
- Visual inspection and SHA-256 of `e3-t21b2c-browser-tests.png` and
  `e3-t21b2c-browser-roadmap.png`; `git diff --quiet f5612e1..9351871 -- web` — passed.
