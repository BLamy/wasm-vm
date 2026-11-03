---
id: E5-T29a
epic: 5
title: Assemble the local Ubuntu and Replay Chromium candidate image
priority: 0.381
status: in-progress
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
