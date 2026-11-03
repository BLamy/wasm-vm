---
id: E5-T29a
epic: 5
title: Assemble the local Ubuntu and Replay Chromium candidate image
priority: 0.381
status: implemented
depends_on: [E0-T34]
estimate: S
risk: medium
capstone: false
---

## Boundary

Offline local image assembly only. APFS-clone the immutable E0-T33 Ubuntu base,
insert the exact E0-T34 runtime and a fixed local test page, and autostart Chromium
through the existing UID-1000 desktop service. Retain the original user accounts,
permissions, sandbox settings, compositor packages and service identity. Do not
change emulator execution, the pre-backport checkpoint, or the current demo profile.
This isolated guest startup/build-tool change is medium risk; it introduces no
host deployment or new identity boundary. Browser rollout is gated by T29b/c.

## Deterministic acceptance

`python3 tools/chromium/build-linux-image.py --output target/replay-chromium-image`

Require the exact base and runtime digests before any mutation and a fresh owned
output directory. Preserve the base unchanged. Read every installed file back
from ext4 and compare its bytes and ownership/mode, run read-only filesystem
checking, and record the final image/chunk identities and build inputs. Missing
inputs, unknown bases, existing outputs and malformed archives must fail clearly.
The command must use local Docker tooling with no network and execute no guest
browser, package installer or downloaded source. Its result is a prepared candidate,
not a claim that Chromium has booted inside wasm-vm.

## Deliverables and gates

A bounded image assembler, startup/test-page files, authenticated chunk manifest,
and assembly receipt. Use Python compilation, shell syntax checks and the direct
image acceptance. This build-tooling task does not expose a new demo path; native
execution is T29b and browser/roadmap/deploy proof is T29c. Neither later task may
start until its dependency is verified.

## Adversarial verification

Medium risk: check all acceptance observations against actual filesystem bytes,
inspect the unprivileged inherited launch path, and invent one bounded bad-input
or ownership attack. No portability or byte-reproducible-toolchain claim is made;
a pristine-clone runtime proof belongs to the rollout boundary, not this local
artifact assembly. Carry the verified source/runtime preservation forward.

## Verification log

### 2026-11-03 — worker — activation

E0-T34 is independently verified at
`6346567e2359b0c01b7791183cb6ed7bac60304f`. The unchanged Ubuntu base has also
reached Weston/Pixman readiness in an ephemeral native wasm-vm pre-check; that
run is not this task's evidence or a Chromium integration claim.

### 2026-11-03 — worker — implemented (offline prerequisite only)

Frozen assembler product: `15bd32fd35382d08599bf54e36870ec1c704c134`. Recorded direct acceptance:
`python3 tools/chromium/build-linux-image.py --output target/replay-chromium-image`.
Receipt and command logs: `evidence/e5-t29a/assembly.json` and `assembly-logs/`.
Worker binding: `evidence/e5-t29a/worker.json`, SHA-256
`cf5d0bcbe4b6294eb065136431d4408f9feec8d5e1827ce82a4bbd4fddacbf9e`.
Image SHA-256: `41127a0f843033df732ff1e1790408a657d76b1d18cb06e05a0c6103d9115228`;
manifest SHA-256: `ee94a280c2fa49a8f0f14a9e47df1c6ec717e0bfeaa78a96da09417ad48c4ac3`.
All 16 installed files were read back from ext4 with matching bytes, UID/GID 0,
expected modes and fixed 2026 timestamps. The inherited UID-1000 desktop service
is byte-identical before/after. Read-only e2fsck proposed no repairs. The base's
initial, cloned and final hashes match; 4,798 unique chunks cover the 8-GiB image.
Python compilation, shell syntax, scoped diff checking and task policy passed.

The startup script is inspected here as packaged payload data. Its execution and
security behavior are NOT promoted by this assembly verdict; they require the
later native/browser qualification. An adapted-path QEMU pre-check exercised its
private control pipe and renderer-status observation, but is not substituted for
wasm-vm execution. No Rust/WASM runtime, active demo, roadmap or deployment changes
occur in this layer.

The user clarified that the final objective is the genuine Replay recording driver
inside wasm-vm. This unrecorded candidate is only a prerequisite. Driver inclusion,
recording output and replay validation are mandatory before the final goal can be
called complete; the next runtime task is being revised accordingly. Private
Replay backend source has been located and is kept ignored and local.
