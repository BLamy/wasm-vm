---
id: E5-T29a
epic: 5
title: Assemble the local Ubuntu and Replay Chromium candidate image
priority: 0.381
status: verified
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

### 2026-11-03 — verifier — predictions before evidence inspection

- P1: Worker evidence, assembler receipt, command logs and code/input digests will
  bind the prepared result to frozen product `15bd32fd3`; actual image and manifest
  digests will match the submitted values, with browserBootVerified=false.
- P2: All 16 actual ext4 files will match the exact runtime and packaged payload
  bytes, UID/GID 0, expected modes, and all four fixed timestamp fields. The desktop
  launcher will differ only in its autostart command; the inherited desktop unit,
  UID-1000 accounts, base image and existing identity settings will be unchanged.
- P3: Exactly 32,768 manifest entries will cover the 8 GiB image in 256 KiB chunks;
  every image block and all 4,798 unique stored chunks will match their hash names.
  Read-only e2fsck will require no repair, and all container mutation commands will
  be confined to the candidate image and owned work directory with network disabled.
- P4: Missing inputs, a wrong base, an existing output and a malformed untrusted
  runtime will be rejected before output mutation. Bounded novel attack: an output
  lexically below target/ but beneath a symlinked ancestor leading outside it will
  be rejected without creating output or changing an external sentinel.
- P5: The inherited service will launch the packaged wrapper as desktop:desktop;
  the payload and guide will preserve the prepared-image-only boundary. No guest
  startup, real Replay driver, recording/replay, or wasm-vm execution is inferred
  from assembly. T34's unchanged source/runtime evidence carries forward.

### 2026-11-03 — verifier — VERDICT: verified

VERDICT: verified

- P1 frozen evidence — HELD. Worker SHA-256 is
  `cf5d0bcbe4b6294eb065136431d4408f9feec8d5e1827ce82a4bbd4fddacbf9e`.
  All four product hashes match frozen head
  `15bd32fd35382d08599bf54e36870ec1c704c134` and current bytes
  (`worker.json:2,56-60`). Assembly receipt SHA-256 is
  `2e281106ee4e4b1453fe31b90474580e8f2abdada515e5c9ea913ea032717c10`;
  the evidence and retained-output copies are identical. All five source/input
  hashes and all 39 zero-exit command logs match their receipt bindings
  (`assembly.json:6-817`). The initially omitted `desktop-before.sh` archive copy
  was supplied from the digest-matching original at evidence-only commit
  `8c9c7fee50eaf85c3233bdbd0957fe95e444fc3b`; no product rerun was needed.
  Both actual output/work directories are caller-owned mode 0700.
- P2 ext4 contents and inheritance — HELD. Independently dumped all 16 actual
  candidate files using read-only debugfs and matched their bytes to the 13 pinned
  runtime members, current startup/page payloads, and one-line desktop adaptation.
  Every file has the recorded mode, UID/GID 0, and all four timestamps equal
  `0x6ae68100:00000000` (2026-11-01 00:00:00 UTC). Citations:
  `assembly.json:818-947`, `assembly-logs/stat-00.txt` through `stat-15.txt`,
  especially `stat-14.txt:1-10`. Actual base/candidate service, passwd, group,
  package database, Weston binary and Foot binary are byte-identical. The desktop
  launcher changes only its Foot autostart line to the browser wrapper and retains
  root:root 0755 permissions. The unchanged unit invokes dbus-run-session and the
  desktop script as desktop:desktop, confirmed as UID/GID 1000
  (`desktop-service-after.txt:8-15,26`). The actual 8 GiB base still hashes to
  `9a9b656f654ed0a3783385e6bd153775ea56dfe62de85cd8b155ed798c2f9558`,
  and the actual runtime bundle still hashes to the T34 pin.
- P3 image/chunks/filesystem — HELD. Independently streamed the entire candidate:
  SHA-256 `41127a0f843033df732ff1e1790408a657d76b1d18cb06e05a0c6103d9115228`.
  Manifest SHA-256 is
  `ee94a280c2fa49a8f0f14a9e47df1c6ec717e0bfeaa78a96da09417ad48c4ac3`.
  All 32,768 ordered 256 KiB blocks cover exactly 8 GiB and match their manifest
  hashes; all 4,798 unique chunk files match the corresponding image bytes, with
  no extra files. Receipt bindings are at `assembly.json:948-954`. Fresh read-only
  `e2fsck -f -n` exited zero with no repairs, matching the preserved five-pass
  result (`assembly-logs/filesystem-check.txt:1-7`). All 37 container runs have
  network none and only candidate/work mounts; the sole writable disk invocation
  is the recorded debugfs insertion, never the base.
- P4 invalid inputs and novel attack — HELD. Actual CLI runs rejected missing base
  and missing runtime paths with FileNotFoundError, a wrong small base with
  "The exact retained Ubuntu base is required", malformed runtime bytes with
  "The exact verified Chromium runtime bundle is required", and the existing
  prepared directory with "Output already exists". All exited 1 before output
  mutation. Novel attack: created a symlink below target/ pointing to an external
  critic-owned directory, then requested its nonexistent candidate child. The
  real CLI rejected it with "Use a fresh owned output directory below this
  project's target/" at `build-linux-image.py:44-46`. No external candidate was
  created; the sentinel, external directory contents and prepared image metadata
  were unchanged. Temporary attack inputs were removed.
- P5 scope — HELD. Startup shell syntax passes, and its exact installed bytes and
  permissions are proven as payload data. The inherited user/service boundary is
  preserved. T34 product/runtime inputs are unchanged, so its HELD results carry
  forward. The receipt remains `prepared` and `browserBootVerified: false`.
  Execution of the wrapper/page, genuine Replay driver inclusion, recording/replay,
  native wasm-vm execution, demo rollout and performance remain unproven here and
  belong to later tasks. No private backend source or logs were inspected or copied.
- COVERAGE — The frozen recorded happy assembly and independently read-back
  artifacts cover input authentication/output creation, clone, fixed-member
  extraction, desktop adaptation, all write/stat/dump paths, fsck, deduplication
  and final receipt/manifest (`build-linux-image.py:25-190,194-203`). Negative CLI
  cases exercise the pre-mutation guards and require failure at lines 20-22 and
  34-47. Waived lines 191-193: failure-only receipt/logging; no recovery/rollback
  claim is made. Startup shell and HTML hunks are packaged data, with execution
  explicitly deferred; this is not an evidence gap in the prepared-image claim.
  Guide/planning/task/queue hunks are declarative and were inspected directly.
- SUITE — Retain the assembler, authenticated image/chunks, 16 file records and
  39 logs as the repeatable local acceptance artifact. Record the bounded negative
  results here; discard their temporary inputs because they are local guard probes,
  not runtime regressions. No cold clone, rebuild, guest execution, private driver
  build, web deployment or broader unrelated gate was required.

Commands: recorded formal assembler acceptance at the frozen head; independent
SHA-256/manifest/chunk comparison; network-disabled, read-only Docker debugfs
dump/stat for candidate and base plus `e2fsck -f -n`; actual assembler CLI with
missing/wrong inputs, malformed runtime, existing output, and symlinked ancestor;
`bash -n tools/chromium/guest/start-browser.sh`; scoped `git diff --check`.
Evidence paths above are relative to `evidence/e5-t29a/`; the retained candidate
is `target/replay-chromium-image/guest.ext4`.
