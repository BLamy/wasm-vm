# E9-T06 fresh verifier orientation

Prepared 2026-10-18 before reading worker recordings or running program checks.

- Role: fresh critic; no implementation edits.
- Worktree: /Users/blamy/.codex/worktrees/e9-session-contract/wasm-vm.
- Scope: 9120ae84..b97f739cdb161cb16f7d64ca983fb48fea80df76.
- Task: S / medium, status in-progress; E9-T05 is verified.
- Read: AGENTS.md, complete E9-T06 task, complete scoped implementation and harness diff, and T05 frontmatter.
- Scope contains 18 files. Native/session-store/disk-root/runtime/retained GPU factory code is unchanged. Runtime portability, unrelated workspace gates, and a new pristine clone are outside this frontend claim.
- No mutable in-flight worker recordings inspected. No program tests run. No tracked files changed.
- Pending inputs: sealed worker claim/packet; explicit tracked-write interval; final public deployment receipt.

## Falsifiable predictions recorded before evidence

All predictions begin as UNTESTED. A result must cite a recording point or exact artifact digest and relevant source/diff lines.

P0 PROVENANCE: The sealed recorder names the frozen implementation head above, and recomputed hashes of all packet files and cited sources equal the claimed manifest. Its successful commands are from a clean head; the source/dist implementation pairs agree. No ignored/panic-skipping test changes or runtime replacement are hidden in this diff.

P1 DURABLE REAL SESSIONS: After the recorded reload, the list contains the two different IDs created through Start recording. The persisted user name is present. Merely loading/selecting a preview has no active saved-session identity. Renaming changes display metadata, not manifest/checkpoint identity.

P2 EXACT CHOSEN RESTORE: Opening alpha's explicitly chosen non-latest checkpoint produces the same complete raw software-checkpoint byte digest as that stored point, leaves the new controller paused with retiredInstructions=0, and sets active.id/active.point to that stored tuple. A queued UART command remains in the exact tuple. A guest RPC while paused rejects with GUEST_PAUSED and cannot change the captured hash. After Resume, independently reported guest file and shell-memory witnesses match alpha; beta restore matches its distinct bytes and witnesses.

P3 NO FABRICATED HISTORY: Start creates an initial exact checkpoint in a checkpoints-only/rv64-linux-software-v1 session with events=[]; manual capture and stop append explicit points without fabricating an event log. The visible details explicitly limit restoration to checkpoints and disclaim history from before recording. Existing compatible sessions lacking a label or event log remain exact-checkpoint only.

P4 PREVIEW FENCE: If alpha's preview read is delayed and beta is selected later, releasing alpha's read cannot overwrite beta's selected/preview identity. The active alpha controller and raw tuple stay unchanged throughout. Selected preview and actual active machine are separately labeled.

P5 VISIBLE TRANSITIONS: During a recorded capture or restore, data-state is respectively capturing/restoring, aria-busy=true, and controls that could mutate identity are disabled. The steady state returns to ready. No stale asynchronous result labels a stopped/replaced owner as active.

P6 UNAVAILABLE STATES: A structurally valid session carrying an unavailable runtime is incompatible and cannot Open; a missing durable referenced object is incomplete and cannot Open. Names/duration-unknown details do not accidentally convert either state to ready. Selecting either does not alter the existing active checkpoint hash.

P7 STORAGE ERROR PRESERVATION: A label-quota failure renders storage-error, leaves the old persisted name available after refresh, and preserves the active raw checkpoint tuple. Invalid local label JSON on reload renders storage-error while listing all actual stored session rows. Restoring valid metadata recovers the names.

P8 ACCESSIBILITY AND DISPLAY: Native button/select/input/form controls can be reached and activated using keyboard navigation, and focus is visible. Preview details show duration (or unavailable), referenced-data usage, runtime/Wasm/image IDs, and exact-point count. At 390px the library has no horizontal overflow and its labels/actions remain operable. Screenshots substantiate visible text/layout, not just harness messages.

P9 REGRESSION BOUNDARY: The built demo suite records 127 passed/0 failed, no non-favicon console/page errors, and the changed roadmap pip is verified. The ordinary retained GPU boot still produces a qualified, non-lost/non-poisoned GPU with drawn current-epoch retirements. The unchanged factory closure and runtime identity remain authenticated by the existing contract checks, not rebuilt native semantics.

P10 PUBLIC PROOF (PENDING RECEIPT): The final public receipt authenticates deployed changed assets against frozen web/dist bytes and proves the affected page/controls and suite through the public origin. This prediction cannot be marked HELD until that receipt arrives.

## Bounded novel attack, planned before evidence

N1 STALE COMPATIBLE PREVIEW: In a copied Chromium profile, load a compatible saved-session preview, retain an existing paused active guest, then remove the selected target checkpoint object from that copied profile before keyboard-activating Open. Predict admission fails as incomplete/storage-error before owner replacement; active controller identity and raw checkpoint digest remain the prior tuple, and the UI never falsely claims the target active. Use a distinct target session so deleting its point cannot destroy the active point. Record the attack and restore/delete only scratch data. This attacks the new open/admission/ownership boundary without modifying runtime code or original evidence.

## Evidence methods and mock hunt

Authenticate report manifests and raw .checkpoint.gz bytes with independent SHA-256; read Playwright trace events/snapshots and V8 coverage rather than accepting JSON claims alone. Check that alpha/beta witnesses come from real wvmDemo.exec, not fabricated hooks, and the persisted manifests/points come from the actual store. Preview delay and label-quota monkeypatches are bounded scheduling/failure injection; fixtures for foreign runtime/missing object must be distinguishable from genuine alpha/beta. Compare source/dist and inspect harness timeouts, query/network settings, and persistent-origin dependence. Public proof remains pending. Preserve the original browser profile and traces byte-for-byte; copy before any follow-up launch.
