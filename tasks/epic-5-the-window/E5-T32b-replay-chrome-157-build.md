---
id: E5-T32b
epic: 5
title: Build optimized Replay Chrome 157 for riscv64 with the unbundled driver
priority: 0.3852
status: blocked
blocked_on: Replay's 157.0.8103.0-replay uplift branch compiling upstream (it fails on x64 too; 156 and 158 share the breakage)
depends_on: [E5-T32a]
estimate: S
risk: high
capstone: false
---

## Boundary

Carry the minimum RISC-V port patches forward from the 108 port (E0-T34) onto 157,
preferring upstream riscv64 support where it now exists (V8, seccomp sandbox,
crashpad). Generate the unbundled-driver `record_replay_driver.{cc,h}`. Optimized
release: no symbols, `is_official_build`-equivalent codegen, ThinLTO if it links
within the VM's RAM, otherwise recorded as a measured exclusion.

## Deterministic acceptance

`chrome --version` reports 157.0.8103.0 under QEMU riscv64; headless `--dump-dom`
of `tools/chromium/guest/smoke.html` reports JS, WASM and canvas success with the
renderer sandbox enabled; `tools/privacy/check-no-replay-backend.py` passes on the
packaged output tree.

## Adversarial verification

High risk: confirm the sandbox is actually engaged (seccomp state of the renderer),
prove no driver bytes are embedded, and diff the port patches against the 108
record to justify each carried hunk.

## Verification log

(empty)

### 2026-11-23 — worker — parked while compiling

The first full `ninja -k 0` build round (`tools/chromium/157/build-157.sh`) runs
unattended in the x64 container. The task returns to pending so that E5-T33 can be
submitted and verified under the one-in-flight rule. It is reactivated when the
round finishes.
### 2026-11-23 — worker — build round 1 result (progress note, not a claim)

Round 1 (`ninja -k 0 chrome chrome_sandbox`) compiled about 56k of 94,084 steps
under Rosetta, with 23 failed steps and 37,952 left. All 23 failures had one cause:
Chromium's clang `raw-ptr-plugin` (`check-raw-ref-fields`, on by default in
non-official builds) rejects native reference fields in Replay's own
`base/deterministic_containers.h` (iterator `vector_`) and `base/record_replay.h`
(`AutoLock/AutoUnlockMaybeEventsDisallowed::lock_`). The fix is Chromium's
documented `RAW_PTR_EXCLUSION` annotation on those four fields
(`tools/chromium/157/patches/replay-rawref-exclusions.patch`). It is lint only, with
no codegen change. Turning the check off in GN args was rejected because it would
change every compile command and rebuild every finished step. Before patching,
ninja's deps log showed 0 and 4 compiled dependents of those headers. All 23 failed
objects then compiled cleanly, and round 2 started for the remaining steps.

### 2026-11-23 — worker — blocked: Replay's 157 uplift does not compile on any architecture

Round 2 (after the raw_ref and include fixes, `tools/chromium/157/patches/`) and round
3 (`use_v8_context_snapshot = false`) leave 12 failed steps and 12,553 steps left.
The remaining errors are architecture-independent, and several are in host
(`clang_x64`) objects, so an x64 build of the same branch hits them as well. These
are Replay sources that were not adapted to Chromium 157 APIs:

1. `base/observer_list_threadsafe.h:153` calls `.contains()` on Replay's
   `base::deterministic_unordered_map`, which has none (13 errors, net/ and
   performance_manager/). Release `DCHECK`s still type-check.
2. `third_party/blink/renderer/bindings/core/v8/serialization/serialized_script_value.h:421`
   calls `.get()` on `base::HeapArray`.
3. `components/viz/service/display/record_replay_render.cc:144-164` uses
   `viz::TransferableResource::size`.
4. `content/renderer/render_thread_impl.cc` includes Replay's Blink-internal
   `record_replay_interface.h`, which pulls `*.mojom-blink.h` into content/
   ("File must only be imported inside blink").
5. Replay's `chrome/browser/resources/record_replay` WebUI TypeScript imports
   `//resources/mojo/mojo/public/js/bindings.js`, which no longer exists.
6. `third_party/skia/src/sksl/SkSLPool.cpp:29` has a module-visibility error on
   `pthread_key_create` (`clang_x64`), possibly a knock-on of the above.

The GitHub API shows the same `observer_list_threadsafe.h` /
`deterministic_containers.h` state on `156.0.8078.0-replay` and
`158.0.8127.0-replay`, while the default branch `master` is 108. Repro: in the
E5-T32a workspace (`tools/chromium/workspace-157.json`) with the recorded
patches and args, `third_party/ninja/ninja -C out/RISCV64 -k 0 chrome`. The log
is `/opt/replay-chromium-157/build-round3.log` in container
`replay-chromium-157-x64`.

User decision (2026-11-23): ship Replay Chrome 108, the verified riscv64 build
(E0-T34), for the shared desktop now, and resume 157 when Replay's uplift
compiles. The 157 tree, patches and build container are preserved for that; they
are not deleted.
