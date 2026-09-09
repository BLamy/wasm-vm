# E5-T22e independent verifier: source predictions before frozen handoff

Phase: source review only. No verdict. All predictions below are **NEEDS EVIDENCE**
(an untested prediction, not a task-status recommendation).

Read AGENTS.md and the entire E5-T22e task, then both requested diffs, before
inspecting source dependencies. No worker evidence/logs/captures have been read.
No builds, native/Wasm tests, browser runs, attacks, or sabotage have been run.
Only this verifier note is written; implementation, task/status/queue, commits,
pushes, merges, and deployment are outside this phase's authorization.

## Source identity (provisional, not an exact-head submission)

- Observed HEAD: `fa49796a4c2267f53bf9c464ff225bbca16b79ca`.
- Both reviewed files have unstaged changes; no staged diff for these files was
  present. Worker changes are ongoing, so line references must be reconciled at freeze.
- `crates/core/src/dev/virtio/gpu/mod.rs` SHA-256:
  `2b3be4903c942a6ca28bc2805c0011b15574f20b31df70ce47749dfb250d11ed`.
- `crates/wasm/src/display_tests.rs` SHA-256:
  `acb4b891ad41040309a5b4e48ad5c4214582a8c3ba3431d6622a725e589ee099`.

The runtime hunk at gpu/mod.rs:523 removes assignments to display width, height,
refresh, and EDID. It adds no replacement mutation. New native assertions are at
3176–3223; the prior lifecycle test's expected reset mode changes at 3243–3246.
The actual-Wasm test is added at display_tests.rs:182–229. No added ignore,
disabled assertion, or runtime cfg(test) alternative appears in these diffs.

## Ownership and integration predictions

1. **P1 — monitor survives the actual guest reset (acceptance 1).** Immediately
   after retired `SW zero,112(t0)` with t0 = 0x10008000, and again after the next
   device-service boundary, the monitor remains exactly 901x701 at its pre-reset
   refresh, with all 128 EDID bytes equal to a captured pre-reset copy. Trace must
   show a four-byte zero store at 0x10008070, then the fixture's load at 0x10008100
   producing a0 = 0, with no intervening trap replacing those instructions.
   Check in native and actual Wasm. The direct native test's synthetic 75-Hz
   state must retain 75; the public setDisplay path currently selects 60 Hz.
   Anchors: gpu/mod.rs:523–528, 702–703; mmio.rs:407–410, 312–323;
   display_tests.rs:184–217; wasm/lib.rs:2390–2397.

2. **P2 — independent EDID observation (acceptance 1, EDID attack).** Decode active
   width as byte[56] | ((byte[58] & 0xf0) << 4), height as byte[59] |
   ((byte[61] & 0xf0) << 4), and check a 128-byte block with checksum zero before
   and after reset. All bytes, including identity/descriptors, must remain equal.
   Do not regenerate the sole expected answer with edid_for. If the submission
   claims guest GET_EDID proof, its response after fresh negotiation must contain
   that exact block; reset clears EDID feature negotiation, so GET_EDID before
   renegotiation should retain its existing rejection behavior. Preserve refresh
   metadata exactly; do not demand an exact 60-Hz decoded clock at 4095x4095,
   where the unchanged EDID generator caps pixel clock.
   Anchors: gpu/mod.rs:957–972; mmio.rs:166–168, 316;
   edid.rs:23–35; display_tests.rs:204–217.

3. **P3 — guest allocations and cursor die (acceptance 2).** From nonempty
   resources with attached backing, a bound scanout, and a visible cursor, reset
   yields zero resources/bytes, no scanout, hidden cursor, and no lookup for the
   old resource id. The sink receives a hidden cursor transition for a previously
   visible cursor. A second reset does not resurrect state or publish stale cursor
   pixels. A post-reset operation on the former resource id fails until that id
   is freshly created. Anchors: gpu/mod.rs:531–540, 391–408, 3190–3219.

4. **P4 — pending and already-latched IRQs both clear (acceptance 2).** Exercise
   separately (a) a host config event still pending in GpuState and (b) a config
   event consumed by sync_backend_config_irq, with used-ring IRQ also latched.
   Immediately after status=0: events_read = 0, config_irq_pending = false,
   InterruptStatus at offset 0x060 = 0, and transport irq_level = false. At the
   following machine device boundary, the GPU PLIC source level is low and the
   cleared event cannot reassert without a new host request or new guest work.
   Do not require device reset to clear unrelated PLIC sources or the controller's
   separate claimed bookkeeping. Anchors: gpu/mod.rs:524, 528, 517–520;
   mmio.rs:162–191, 319; core/lib.rs:3928–3933; dev/plic.rs:140–154.

5. **P5 — no deferred old queue work (acceptance 2).** With control and cursor
   queues configured/cached and both kicks pending, status=0 resets transport
   queue configuration and both kick flags. After service_with_cursor, both
   cached ring views are invalidated, reset_pending is consumed, and old ring
   used indices/response sentinels remain unchanged. Reconfigured queues must
   use their new addresses, never the old cache. Anchors: gpu/mod.rs:529–530,
   540, 1733–1756; mmio.rs:318, 320; core/lib.rs:3880–3888. The production
   wrapper explicitly drops both caches before the individual services; the
   single shared reset_pending flag is not by itself a production-path finding.

6. **P6 — reset/re-request determinism (acceptance 3).** Two consecutive guest
   resets preserve the last mode byte-for-byte. Requests for 1x1, 4095x4095,
   901x701, then another odd mode remain deterministic across resets. A same-mode
   request after reset still sets EVENT_DISPLAY and arms one config notification;
   consuming that notification twice returns true then false. A new request
   updates the retained monitor and EDID without resurrecting old resources.
   Compare like-for-like traces and observations from deterministic repeats.
   Anchors: gpu/mod.rs:421–432, 517–540, 3180–3220; display_tests.rs:187.

7. **P7 — constructor and VM isolation (acceptance 3).** A concurrent untouched
   second VM and a second VM constructed after the first VM's mode/reset sequence
   both start at 1280x800, 60 Hz, the unchanged default EDID, zero events and no
   resources. Mutating/resetting either does not mutate the other. Anchors:
   gpu/mod.rs:329–346, 569–575. Defaults remain explicitly initialized per new
   Rc allocation; reset does not replace that allocation.

8. **P8 — browser and recorded instruction proof (acceptance 4).** The final built
   browser worker must execute the guest reset fixture after receiving a
   non-default initial host mode, then read preserved monitor/EDID from its
   actual WasmLinux instance. A cached page/worker variable alone is insufficient.
   The normal built demo must reach 126 passed, zero failed and zero relevant
   console errors, with a capture. The trace/digest and observed GPU state must
   be tied to the frozen code and loaded artifact hashes. Browser harness code
   will be read before its results when the worker hands it off.

## Current test sufficiency questions (not findings or demands on unfinished work)

- The native regression at gpu/mod.rs:3208 invokes VirtioDevice::reset directly.
  It is a useful reset-state test, but cannot establish native status=0 dispatch,
  transport InterruptStatus, PLIC propagation, or invalidation of cached queues.
  Its resource/cursor/kick setup is injected internally, so it does not establish
  guest protocol setup. The existing cursor sink test at 2359–2406 may support
  the unchanged hide callback if its relevant recorded execution carries forward.
- The Wasm fixture executes the MMIO store, but its readback checks events_read,
  not InterruptStatus. It creates a resource without attached backing or cursor,
  has no configured queue caches, and does not assert refreshHz. A null
  displayStats.scanoutResource alone cannot prove the underlying scanout id was
  cleared: wasm/lib.rs:2404–2409 filters missing resources. Native raw-state
  assertions can supply that distinction.
- The native test varies dimensions and performs double resets, but only uses
  backend reset. The Wasm test creates a new instance for each size, immediately
  mutates it, and performs one reset. Neither current added test proves a fresh
  Wasm VM's default state or same-mode post-reset event rearming. Native fresh
  EDID `assert_ne!` at 3223 establishes difference from the changed instance,
  not equality to the default block or refresh.
- Pre/post copied EDID equality is a valid preservation oracle, even though both
  copies come from the device. Add independent interpretation when evaluating
  the bytes; regenerated expected EDID alone is weaker. Prior T22a byte-decoding
  assertions at display_tests.rs:65–74 remain unchanged.
- `WasmLinux::state_digest` (wasm/lib.rs:2739–2741) returns the RAM hash from
  Machine::snapshot. snapshot.rs:11–13, 83–88 explicitly excludes device state
  from that hash. Matching digests alone cannot establish monitor, IRQ, or cursor
  equality. Keep direct GPU observations and trace citations alongside the digest;
  this is an interpretation limit, not a request to change snapshot format.

## Bounded independent attack reserved for after handoff

Use one deterministic reset/reconfiguration scenario with independent odd mode
1373x907 and distinct old/new ring addresses. Begin with live resource/backing,
cursor, both cached queues, and old work ready. Run the pending-event and latched
config+used-IRQ variants; execute two guest status=0 resets, then issue the same
host mode before reconfiguring both queues. Predict one fresh config IRQ,
unchanged EDID, no writes to old ring sentinels, rejection of the stale resource
id, and successful new work only on new rings after negotiation. This combines
P3–P6 at the changed reset boundary and avoids repeating unrelated T22a/b attacks.

After authorization for final verification, sabotage preservation once in an
isolated disposable copy by restoring the old monitor-default reset assignments;
the targeted odd-mode regression must fail for the expected monitor mismatch.
The worker's reported old-code failure has not been read or adopted as my attack.
Do not mutate shared implementation files for sabotage. If a separate monitor
byte can be preserved incorrectly without the final tests detecting it, record
that exact test-sufficiency point rather than broadening into EDID generation.

## Frozen handoff needed before evidence evaluation or verdict

Need the worker's explicit final handoff with frozen commit/diff boundaries,
acceptance commands including make verify-E5-T22e, recorded native/actual-Wasm
logs, reset instruction trace and digest, GPU/EDID/IRQ observations, browser
harness and built-worker/demo captures, artifact hashes, and the scoped final
pristine-clone proof (or concrete commands/environment for its verifier run).
Reconcile any changed source against these predictions before inspecting state.
High-risk exact-head/cold-clone proof, independent attack, and sabotage remain
outstanding; do not rerun the worker's currently active native/Wasm gates.

Carry T22a strict host-input and T22b presentation HELD results forward wherever
code, dependency boundary and evidence digests are unchanged. The present runtime
diff changes monitor retention on reset only; it does not change validation,
frame-sink attachment, pixel publication, renderer, or constructor defaults.
Verify the reset-specific cleanup interaction without reopening unrelated stale
frame or strict-input claims. No T22c compositor/Omarchy/E6 work belongs here.

No GitHub Actions, ssh dev, rr, other physical machines, WebKit, push, merge, or
deployment. Await explicit handoff before recording a verdict or changing any
task/status/queue/commit state.
